"use client";
import React, { useState, useRef } from 'react';
import { UploadCloud, CheckCircle2, ChevronRight, Activity, Cpu, Wrench } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useStore } from '@/store/useStore';
import RobotViewer from '@/components/RobotViewer';

function LocalImage({ path, alt, className }: { path: string, alt: string, className?: string }) {
  const [src, setSrc] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!path) return;
    let url: string | null = null;

    async function load() {
      try {
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const data = await readFile(path);
        const blob = new Blob([data], { type: 'image/png' });
        url = URL.createObjectURL(blob);
        setSrc(url);
      } catch (err) {
        console.error("Failed to load image:", path, err);
      }
    }
    load();

    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);

  if (!src) return <div className={`bg-zinc-800 animate-pulse ${className}`} />;
  return <img src={src} alt={alt} className={className} />;
}

export default function ConstructionPage() {
  // Global Store
  const setIsGenerating = useStore((state) => state.setIsGenerating);

  // Local State
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pipeline State
  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");
  const [pipelineStats, setPipelineStats] = useState<any>(null);
  const [pipelineImages, setPipelineImages] = useState<any>(null);
  const [finishedRobot, setFinishedRobot] = useState<any>(null);

  React.useEffect(() => {
    const unlisteners: (() => void)[] = [];

    const setupListeners = async () => {
      const u1 = await listen<string>("pipeline-progress", (event) => {
        setProgressMsg(event.payload);
      });
      unlisteners.push(u1);

      const u2 = await listen<any>("pipeline-stats", (event) => {
        setPipelineStats(event.payload);
      });
      unlisteners.push(u2);

      const u3 = await listen<any>("pipeline-images", (event) => {
        setPipelineImages(event.payload);
      });
      unlisteners.push(u3);
    };

    setupListeners();

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  };

  const handleFileSelected = (f: File) => {
    setFile(f);
    const objectUrl = URL.createObjectURL(f);
    setPreviewUrl(objectUrl);
  };

  const startPipeline = async () => {
    if (!file) return;

    try {
      setLoading(true);
      setIsGenerating(true);
      setProgressMsg("Reading image data...");
      setPipelineStats(null);
      setPipelineImages(null);
      setFinishedRobot(null);

      const buffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);
      const base64String = btoa(
        Array.from(uint8Array).map(b => String.fromCharCode(b)).join('')
      );
      const mimeType = file.type;
      const dataUri = `data:${mimeType};base64,${base64String}`;

      setProgressMsg("Sending data to Rust backend...");

      const newRobot = await invoke("run_generation_pipeline", {
        base64Image: dataUri,
      });

      // Synchronize new robot with global Zustand state so it appears in Encyclopedia
      useStore.getState().setRobots([
        newRobot as any,
        ...useStore.getState().robots
      ]);

      setFinishedRobot(newRobot);
      setProgressMsg("Construction Complete!");
    } catch (err) {
      console.error(err);
      const errMsg =
        typeof err === "string"
          ? err
          : (err && typeof err === "object" && "message" in err)
            ? String((err as { message?: unknown }).message ?? "Unknown error")
            : "Unknown error";
      setProgressMsg(`Error: ${errMsg}`);
    } finally {
      setLoading(false);
      setIsGenerating(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col gap-6 max-w-7xl mx-auto">
      <header className="mb-2">
        <h1 className="text-4xl font-black italic tracking-tighter text-red-500">CONSTRUCTION DOCK</h1>
        <p className="text-zinc-500 font-mono text-sm uppercase tracking-widest mt-1">Material Conversion Facility</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">

        {/* Dock 1: Upload & Initial Specs */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex flex-col gap-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <span className="text-6xl font-black italic">DOCK 01</span>
          </div>

          <h2 className="text-xl font-bold flex items-center gap-2 z-10">
            <UploadCloud className="text-zinc-500" />
            Material Input
          </h2>

          {/* Drag & Drop Zone */}
          <div
            className={`relative flex-1 rounded-2xl border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center min-h-[250px] p-6 text-center cursor-pointer z-10 ${dragActive ? "border-red-500 bg-red-500/10" : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800"
              }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png, image/jpeg, image/heic"
              onChange={handleChange}
              className="hidden"
            />

            {previewUrl ? (
              <div className="w-full h-full flex flex-col items-center gap-4">
                <img src={previewUrl} alt="Preview" className="h-40 w-40 object-cover rounded-xl shadow-lg border-2 border-zinc-800" />
                <button
                  onClick={(e) => { e.stopPropagation(); startPipeline(); }}
                  disabled={loading}
                  className={`px-8 py-3 rounded-xl font-bold transition-all shadow-lg ${loading ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" : "bg-red-600 hover:bg-red-500 text-white shadow-red-900/50 hover:scale-105"
                    }`}
                >
                  {loading ? "INITIALIZING..." : "INITIATE PIPELINE"}
                </button>
              </div>
            ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mb-4 text-zinc-500 group-hover:text-white transition-colors">
                  <UploadCloud size={32} />
                </div>
                <p className="text-zinc-300 font-medium text-lg">Select Food Target</p>
                <p className="text-zinc-500 text-sm mt-2">Drag and drop an image here, or click to browse.</p>
                <p className="text-zinc-600 text-xs mt-1">Accepts PNG, JPEG, HEIC</p>
              </>
            )}
          </div>

          {/* Stats Preview (Appears post-Gemini analysis) */}
          {pipelineStats && (
            <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800 z-10 animate-fade-in-up">
              <h3 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-orange-400 mb-2">
                {pipelineStats.name}
              </h3>
              <p className="text-xs text-zinc-400 mb-4 line-clamp-2">{pipelineStats.lore}</p>
              <div className="flex justify-between gap-2">
                <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-2 flex-1 text-center">
                  <div className="text-[10px] text-red-500 font-mono">HP</div>
                  <div className="font-black text-red-100">{pipelineStats.hp}</div>
                </div>
                <div className="bg-orange-950/30 border border-orange-900/50 rounded-lg p-2 flex-1 text-center">
                  <div className="text-[10px] text-orange-500 font-mono">ATK</div>
                  <div className="font-black text-orange-100">{pipelineStats.atk}</div>
                </div>
                <div className="bg-blue-950/30 border border-blue-900/50 rounded-lg p-2 flex-1 text-center">
                  <div className="text-[10px] text-blue-500 font-mono">DEF</div>
                  <div className="font-black text-blue-100">{pipelineStats.def}</div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Dock 2: Fabrication & Output */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl flex flex-col relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
            <span className="text-6xl font-black italic">DOCK 02</span>
          </div>

          <div className="p-6 pb-2 z-10">
            <h2 className="text-xl font-bold flex items-center gap-2 mb-6">
              <Wrench className="text-zinc-500" />
              Fabrication Bay
            </h2>

            {/* Pipeline Status Indicator */}
            {(loading || progressMsg) && (
              <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl mb-4 flex items-center gap-4">
                <div className="relative flex shrink-0 h-10 w-10">
                  {loading && <div className="absolute inset-0 rounded-full border-t-2 border-red-500 animate-spin" />}
                  <div className="absolute inset-0 flex items-center justify-center">
                    {loading ? <Activity size={18} className="text-red-500 animate-pulse" /> : <CheckCircle2 size={18} className="text-green-500" />}
                  </div>
                </div>
                <div className="flex-1 truncate">
                  <div className="text-xs font-mono text-zinc-500">SYSTEM STATUS</div>
                  <div className="text-sm font-medium text-red-100 truncate">{progressMsg || "Standby"}</div>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 p-6 pt-0 flex flex-col z-10">
            {/* 3D Viewer or Images */}
            <div className="w-full h-full min-h-[300px] bg-zinc-950 rounded-2xl border border-zinc-800 flex items-center justify-center overflow-hidden relative">
              {!file && !loading && !finishedRobot && (
                <div className="text-zinc-600 font-mono text-sm flex flex-col items-center gap-2">
                  <Cpu size={32} />
                  Awaiting Input Data
                </div>
              )}

              {/* Show interim 2D concept if 3D is still generating */}
              {loading && pipelineImages && !finishedRobot && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <LocalImage path={pipelineImages.image_path} className="w-full h-full object-cover opacity-50 sepia-[.2] hue-rotate-[-30deg]" alt="Concept" />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4 text-center">
                    <span className="bg-red-950/80 text-red-300 text-xs font-mono px-3 py-1 rounded-full border border-red-900/50 backdrop-blur-sm shadow-xl">
                      EXTRUDING 3D MESH...
                    </span>
                  </div>
                </div>
              )}

              {/* Final Result */}
              {finishedRobot && finishedRobot.model_path && (
                <RobotViewer modelPath={finishedRobot.model_path} attackModelPath={finishedRobot.attack_model_path} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
