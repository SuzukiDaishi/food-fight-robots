"use client";
import React, { useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, useAnimations, Environment, Clone } from '@react-three/drei';
import * as THREE from 'three';
import { invoke } from "@tauri-apps/api/core";

export function Model({ idleUrl, attackUrl, isAttacking }: { idleUrl: string, attackUrl: string, isAttacking: boolean }) {
    const group = useRef<THREE.Group>(null);
    const idleGltf = useGLTF(idleUrl);
    const attackGltf = useGLTF(attackUrl);

    // Combine animations and give them explicit names
    const combinedAnimations = React.useMemo(() => {
        const cloned: THREE.AnimationClip[] = [];
        if (idleGltf.animations && idleGltf.animations.length > 0) {
            const idleClip = idleGltf.animations[0].clone();
            idleClip.name = "Idle";
            cloned.push(idleClip);
        }
        if (attackGltf.animations && attackGltf.animations.length > 0) {
            const attackClip = attackGltf.animations[0].clone();
            attackClip.name = "Attack";
            cloned.push(attackClip);
        }
        return cloned;
    }, [idleGltf.animations, attackGltf.animations]);

    const { actions, mixer } = useAnimations(combinedAnimations, group);
    const isAttackingRef = useRef(false);

    // Setup persistent Idle and finish listeners
    useEffect(() => {
        if (!actions || !mixer) return;
        const idle = actions["Idle"];
        const attack = actions["Attack"];

        if (idle) {
            idle.setLoop(THREE.LoopRepeat, Infinity);
            idle.enabled = true;
            idle.reset().play();
        }

        const FADE = 0.15;
        const onFinished = (e: any) => {
            if (e.action === attack && idle && attack) {
                idle.play();
                idle.crossFadeFrom(attack, FADE, true);
                attack.stop();
            }
        };

        mixer.addEventListener("finished", onFinished);

        return () => {
            mixer.removeEventListener("finished", onFinished);
            mixer.stopAllAction();
        };
    }, [actions, mixer]);

    // Handle Attack triggers
    useEffect(() => {
        if (!actions) return;
        const idle = actions["Idle"];
        const attack = actions["Attack"];
        if (!idle || !attack) return;

        if (isAttacking && !isAttackingRef.current) {
            isAttackingRef.current = true;
            const FADE = 0.15;
            attack.setLoop(THREE.LoopOnce, 1);
            attack.clampWhenFinished = false;
            attack.enabled = true;
            attack.reset().play();
            attack.crossFadeFrom(idle, FADE, true);
        } else if (!isAttacking) {
            isAttackingRef.current = false;
        }
    }, [isAttacking, actions]);

    return (
        <group ref={group}>
            <Clone object={idleGltf.scene} scale={[1.5, 1.5, 1.5]} position={[0, -1, 0]} />
        </group>
    );
}

export default function RobotViewer({ modelPath, attackModelPath, overrideAttacking }: { modelPath: string, attackModelPath: string, overrideAttacking?: boolean }) {
    const [idleAssetUrl, setIdleAssetUrl] = React.useState<string | null>(null);
    const [attackAssetUrl, setAttackAssetUrl] = React.useState<string | null>(null);
    const [internalIsAttacking, setInternalIsAttacking] = React.useState(false);

    // Use override if provided, otherwise fallback to internal state
    const isAttacking = overrideAttacking !== undefined ? overrideAttacking : internalIsAttacking;

    useEffect(() => {
        if (!modelPath) return;

        // In Tauri, to load a local file in an <img> or Three.js loader, we must use the custom protocol `asset://`
        // Convert absolute path to an asset URL
        async function loadAsset() {
            try {
                // Tauri v2 allows converting file path to asset url format 
                // format: asset://localhost/path/to/file
                // We need to fetch the file contents as blob and create a local URL.
                // But Three.js loaders sometimes struggle with asset:// directly.
                // Safest cross-platform way is to read the file as an array buffer.
                const { readFile } = await import('@tauri-apps/plugin-fs');

                // Load Idle Model
                const idleData = await readFile(modelPath);
                const idleBlob = new Blob([idleData], { type: 'model/gltf-binary' });
                const idleUrl = URL.createObjectURL(idleBlob);
                setIdleAssetUrl(idleUrl);

                // Load Attack Model dynamically if provided
                if (attackModelPath) {
                    const attackData = await readFile(attackModelPath);
                    const attackBlob = new Blob([attackData], { type: 'model/gltf-binary' });
                    const attackUrl = URL.createObjectURL(attackBlob);
                    setAttackAssetUrl(attackUrl);
                } else {
                    // Fallback identical if no attack model
                    setAttackAssetUrl(idleUrl);
                }
            } catch (e) {
                console.error("Failed to load 3D models from disk:", e);
            }
        }

        loadAsset();

        return () => {
            if (idleAssetUrl) URL.revokeObjectURL(idleAssetUrl);
            if (attackAssetUrl && attackAssetUrl !== idleAssetUrl) URL.revokeObjectURL(attackAssetUrl);
        };
    }, [modelPath, attackModelPath]);

    if (!idleAssetUrl || !attackAssetUrl) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-zinc-950 rounded-xl border border-zinc-800">
                <span className="text-zinc-600 text-sm">Loading 3D Model...</span>
            </div>
        );
    }

    return (
        <div className="w-full h-full relative bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800">
            <Canvas camera={{ position: [0, 2, 5], fov: 45 }}>
                <ambientLight intensity={0.5} />
                <directionalLight position={[10, 10, 10]} intensity={1} />
                <Environment preset="city" />
                <React.Suspense fallback={null}>
                    <Model idleUrl={idleAssetUrl} attackUrl={attackAssetUrl} isAttacking={isAttacking} />
                </React.Suspense>
                <OrbitControls autoRotate={!isAttacking} autoRotateSpeed={2} enablePan={false} maxDistance={10} minDistance={2} />
            </Canvas>

            {overrideAttacking === undefined && (
                <button
                    className={`absolute bottom-4 left-1/2 -translate-x-1/2 px-6 py-2 rounded-full font-bold shadow-lg shadow-black/50 transition-all ${isAttacking ? "bg-red-500 text-white scale-105" : "bg-red-600/80 hover:bg-red-500 text-white hover:scale-105"}`}
                    onMouseDown={() => setInternalIsAttacking(true)}
                    onMouseUp={() => setInternalIsAttacking(false)}
                    onMouseLeave={() => setInternalIsAttacking(false)}
                    onTouchStart={() => setInternalIsAttacking(true)}
                    onTouchEnd={() => setInternalIsAttacking(false)}
                >
                    {isAttacking ? "Oof!" : "ATTACK!"}
                </button>
            )}
        </div>
    );
}
