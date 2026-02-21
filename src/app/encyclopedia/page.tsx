"use client";
import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search, Database, Clock, Crosshair, Shield, Heart } from 'lucide-react';
import RobotViewer from '@/components/RobotViewer';
import { RobotRecord } from '@/types/robot';
import { useStore } from '@/store/useStore';

// Helper component to securely load local images via Tauri filesystem API 
function LocalImage({ path, alt, className }: { path: string, alt: string, className?: string }) {
    const [src, setSrc] = useState<string | null>(null);

    useEffect(() => {
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


export default function EncyclopediaPage() {
    const [robots, setRobots] = useState<RobotRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedRobot, setSelectedRobot] = useState<RobotRecord | null>(null);

    useEffect(() => {
        async function loadRobots() {
            try {
                const data: RobotRecord[] = await invoke('get_all_robots');
                // Sort newest first
                const sorted = data.sort((a, b) => b.created_at - a.created_at);
                setRobots(sorted);
                useStore.getState().setRobots(sorted); // Hydrate global store
                if (sorted.length > 0 && !selectedRobot) {
                    setSelectedRobot(sorted[0]);
                }
            } catch (e) {
                console.error("Failed to load robots:", e);
            } finally {
                setLoading(false);
            }
        }
        loadRobots();
    }, []);

    const filteredRobots = robots.filter(r =>
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.lore.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="w-full h-full flex flex-col gap-6 max-w-7xl mx-auto">
            <header className="mb-2 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-4xl font-black italic tracking-tighter text-blue-500">ENCYCLOPEDIA</h1>
                    <p className="text-zinc-500 font-mono text-sm uppercase tracking-widest mt-1">Robot Database & Specifications</p>
                </div>

                <div className="relative w-full md:w-64">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                        type="text"
                        placeholder="Search database..."
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </header>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 h-full overflow-hidden">

                {/* Left Col: Grid List */}
                <div className="lg:col-span-1 bg-zinc-900 border border-zinc-800 rounded-3xl p-4 flex flex-col gap-4 overflow-hidden relative">

                    <h2 className="text-lg font-bold flex items-center gap-2 border-b border-zinc-800 pb-3">
                        <Database size={18} className="text-blue-500" />
                        Archived Units ({filteredRobots.length})
                    </h2>

                    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-3">
                        {loading ? (
                            <div className="text-center text-zinc-500 py-10 animate-pulse">Accessing Database...</div>
                        ) : filteredRobots.length === 0 ? (
                            <div className="text-center text-zinc-500 py-10">No matching records found.</div>
                        ) : (
                            filteredRobots.map(robot => (
                                <button
                                    key={robot.id}
                                    onClick={() => setSelectedRobot(robot)}
                                    className={`flex items-center gap-4 p-3 rounded-xl border text-left transition-all ${selectedRobot?.id === robot.id
                                        ? "bg-blue-900/20 border-blue-500/50 shadow-[0_0_15px_-3px_rgba(59,130,246,0.2)]"
                                        : "bg-zinc-950 border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/50"
                                        }`}
                                >
                                    <LocalImage path={robot.image_path} className="w-16 h-16 rounded-lg object-cover border border-zinc-800 shrink-0" alt={robot.name} />
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-zinc-100 truncate">{robot.name}</h3>
                                        <div className="flex gap-3 mt-1 text-xs font-mono text-zinc-500">
                                            <span className="flex items-center gap-1"><Heart size={10} /> {robot.hp}</span>
                                            <span className="flex items-center gap-1"><Crosshair size={10} /> {robot.atk}</span>
                                            <span className="flex items-center gap-1"><Shield size={10} /> {robot.def}</span>
                                        </div>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Right Col: Detail View */}
                <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-3xl flex flex-col relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                        <span className="text-6xl font-black italic text-blue-500">SPEC_VIEW</span>
                    </div>

                    {selectedRobot ? (
                        <div className="flex-1 flex flex-col h-full overflow-y-auto z-10 p-6">

                            {/* Header */}
                            <div className="mb-6">
                                <h2 className="text-3xl font-black italic text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
                                    {selectedRobot.name}
                                </h2>
                                <div className="flex flex-wrap gap-4 mt-3 text-xs font-mono text-zinc-400">
                                    <span className="flex items-center gap-1 bg-zinc-950 px-2 py-1 rounded border border-zinc-800">
                                        ID: {selectedRobot.id.split('-')[0]}
                                    </span>
                                    <span className="flex items-center gap-1 bg-zinc-950 px-2 py-1 rounded border border-zinc-800">
                                        <Clock size={12} />
                                        {new Date(selectedRobot.created_at * 1000).toLocaleDateString()}
                                    </span>
                                </div>
                            </div>

                            {/* 3D Viewer Area */}
                            <div className="w-full h-[400px] shrink-0 bg-zinc-950 rounded-2xl border border-zinc-800 flex justify-center overflow-hidden relative mb-6">
                                <RobotViewer modelPath={selectedRobot.model_path} attackModelPath={selectedRobot.attack_model_path} />
                            </div>

                            {/* Stats Grid */}
                            <div className="grid grid-cols-3 gap-4 mb-6 shrink-0">
                                <div className="bg-red-950/20 border border-red-900/30 rounded-xl p-4 text-center">
                                    <div className="text-xs text-red-500 font-mono mb-1 flex justify-center gap-1 items-center"><Heart size={14} /> HP</div>
                                    <div className="text-2xl font-black text-red-100">{selectedRobot.hp}</div>
                                </div>
                                <div className="bg-orange-950/20 border border-orange-900/30 rounded-xl p-4 text-center">
                                    <div className="text-xs text-orange-500 font-mono mb-1 flex justify-center gap-1 items-center"><Crosshair size={14} /> ATK</div>
                                    <div className="text-2xl font-black text-orange-100">{selectedRobot.atk}</div>
                                </div>
                                <div className="bg-blue-950/20 border border-blue-900/30 rounded-xl p-4 text-center">
                                    <div className="text-xs text-blue-500 font-mono mb-1 flex justify-center gap-1 items-center"><Shield size={14} /> DEF</div>
                                    <div className="text-2xl font-black text-blue-100">{selectedRobot.def}</div>
                                </div>
                            </div>

                            {/* Lore & Materials */}
                            <div className="flex flex-col md:flex-row gap-6 shrink-0">

                                <div className="flex-1 bg-zinc-950 p-5 rounded-2xl border border-zinc-800">
                                    <h4 className="text-sm font-bold text-zinc-300 mb-3 border-b border-zinc-800 pb-2">DATA ARCHIVE</h4>
                                    <p className="text-sm text-zinc-400 leading-relaxed font-serif">
                                        {selectedRobot.lore}
                                    </p>
                                </div>

                                <div className="w-full md:w-32 flex flex-col gap-3 shrink-0">
                                    <div className="text-center">
                                        <div className="text-[10px] font-mono text-zinc-500 mb-1">Source Material</div>
                                        <LocalImage path={selectedRobot.original_image_path} className="w-full aspect-square object-cover rounded-xl border border-zinc-800" alt="Material" />
                                    </div>
                                    <div className="text-center">
                                        <div className="text-[10px] font-mono text-zinc-500 mb-1">Concept Blueprint</div>
                                        <LocalImage path={selectedRobot.image_path} className="w-full aspect-square object-cover rounded-xl border border-zinc-800" alt="Blueprint" />
                                    </div>
                                </div>
                            </div>

                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 gap-4">
                            <Database size={48} className="opacity-50" />
                            <p className="font-mono text-sm">Select a unit from the archive to view specifications</p>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
