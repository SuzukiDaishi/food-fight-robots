"use client";
import React, { useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

type CachedAssetUrl = {
    url: string;
    refCount: number;
    revokeTimer: number | null;
    loading?: Promise<string>;
};

const assetUrlCache = new Map<string, CachedAssetUrl>();
const ASSET_URL_REVOKE_DELAY_MS = 30_000;

async function createAssetUrlFromPath(path: string): Promise<string> {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const data = await readFile(path);
    const blob = new Blob([data], { type: 'model/gltf-binary' });
    return URL.createObjectURL(blob);
}

async function acquireCachedAssetUrl(path: string): Promise<string> {
    let entry = assetUrlCache.get(path);

    if (!entry) {
        const loading = createAssetUrlFromPath(path);
        entry = { url: "", refCount: 0, revokeTimer: null, loading };
        assetUrlCache.set(path, entry);
        try {
            const url = await loading;
            const current = assetUrlCache.get(path);
            if (!current) {
                URL.revokeObjectURL(url);
                throw new Error(`Asset cache entry disappeared while loading: ${path}`);
            }
            current.url = url;
            delete current.loading;
            entry = current;
        } catch (e) {
            assetUrlCache.delete(path);
            throw e;
        }
    } else if (entry.loading) {
        await entry.loading;
        const current = assetUrlCache.get(path);
        if (!current || !current.url) {
            throw new Error(`Failed to cache asset URL: ${path}`);
        }
        entry = current;
    }

    if (!entry.url) {
        throw new Error(`Missing cached asset URL: ${path}`);
    }

    if (entry.revokeTimer !== null) {
        window.clearTimeout(entry.revokeTimer);
        entry.revokeTimer = null;
    }
    entry.refCount += 1;
    return entry.url;
}

function releaseCachedAssetUrl(path: string): void {
    const entry = assetUrlCache.get(path);
    if (!entry) return;

    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount > 0) return;

    if (entry.revokeTimer !== null) {
        window.clearTimeout(entry.revokeTimer);
    }

    entry.revokeTimer = window.setTimeout(() => {
        const current = assetUrlCache.get(path);
        if (!current || current.refCount > 0 || !current.url) return;
        URL.revokeObjectURL(current.url);
        assetUrlCache.delete(path);
    }, ASSET_URL_REVOKE_DELAY_MS);
}

function pickClip(clips: THREE.AnimationClip[], patterns: RegExp[], fallbackToLongest = false): THREE.AnimationClip | null {
    if (!clips || clips.length === 0) return null;
    const byName = clips.find((clip) => patterns.some((p) => p.test(clip.name)));
    if (byName) return byName;
    if (fallbackToLongest) {
        return clips.reduce((acc, cur) => (cur.duration > acc.duration ? cur : acc), clips[0]);
    }
    return clips[0];
}

function trackNodeName(trackName: string): string {
    const [node] = trackName.split('.');
    return node ?? '';
}

function trackPropertyName(trackName: string): string {
    const parts = trackName.split('.');
    return parts[parts.length - 1] ?? '';
}

function stripRootMotionTracks(clip: THREE.AnimationClip): THREE.AnimationClip {
    const tracks = clip.tracks.filter((track) => {
        const node = trackNodeName(track.name);
        const prop = trackPropertyName(track.name);
        if (!/position/i.test(prop)) return true;
        return !/(root|hips|hip|pelvis|armature)/i.test(node);
    });
    if (tracks.length === clip.tracks.length) return clip;
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function buildCompatibleClip(clip: THREE.AnimationClip, nodeNames: Set<string>): THREE.AnimationClip | null {
    const compatibleTracks = clip.tracks.filter((track) => nodeNames.has(trackNodeName(track.name)));
    if (compatibleTracks.length === 0) return null;
    return new THREE.AnimationClip(clip.name, clip.duration, compatibleTracks);
}

export function Model({ idleUrl, attackUrl, isAttacking }: { idleUrl: string, attackUrl: string, isAttacking: boolean }) {
    const group = useRef<THREE.Group>(null);
    const idleGltf = useGLTF(idleUrl);
    const attackGltf = useGLTF(attackUrl);
    const mixerRef = useRef<THREE.AnimationMixer | null>(null);
    const idleActionRef = useRef<THREE.AnimationAction | null>(null);
    const attackActionRef = useRef<THREE.AnimationAction | null>(null);
    const isAttackingRef = useRef(false);
    const fallbackReturnTimerRef = useRef<number | null>(null);
    const attackStopTimerRef = useRef<number | null>(null);
    const TRANSITION_SECONDS = 0.2;

    const modelScene = React.useMemo(() => {
        const cloned = cloneSkeleton(idleGltf.scene) as THREE.Object3D;
        cloned.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            if (mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) {
                mesh.frustumCulled = false;
            }
        });
        return cloned;
    }, [idleGltf.scene]);
    const sceneNodeNames = React.useMemo(() => {
        const names = new Set<string>();
        modelScene.traverse((obj) => {
            if (obj.name) names.add(obj.name);
        });
        return names;
    }, [modelScene]);

    const combinedAnimations = React.useMemo<THREE.AnimationClip[]>(() => {
        const idleSource = pickClip(
            idleGltf.animations ?? [],
            [/idle/i, /stand/i, /breath/i, /loop/i],
            true
        );
        const attackSource = pickClip(
            attackGltf.animations ?? [],
            [/attack/i, /punch/i, /slash/i, /kick/i, /hit/i],
            false
        ) ?? pickClip(attackGltf.animations ?? [], [], false);

        const clips: THREE.AnimationClip[] = [];
        if (idleSource) {
            const idle = stripRootMotionTracks(idleSource.clone());
            idle.name = "Idle";
            if (idle.tracks.length > 0) {
                clips.push(idle);
            }
        }
        if (attackSource) {
            const attackCandidate = stripRootMotionTracks(attackSource.clone());
            const compatibleAttack = buildCompatibleClip(attackCandidate, sceneNodeNames);
            if (compatibleAttack && compatibleAttack.tracks.length > 0) {
                compatibleAttack.name = "Attack";
                clips.push(compatibleAttack);
            }
        }
        return clips;
    }, [idleGltf.animations, attackGltf.animations, sceneNodeNames]);

    const idleClip = combinedAnimations.find((clip) => clip.name === "Idle") ?? null;
    const attackClip = combinedAnimations.find((clip) => clip.name === "Attack") ?? null;

    const clearReturnTimer = () => {
        if (fallbackReturnTimerRef.current !== null) {
            window.clearTimeout(fallbackReturnTimerRef.current);
            fallbackReturnTimerRef.current = null;
        }
    };

    const clearAttackStopTimer = () => {
        if (attackStopTimerRef.current !== null) {
            window.clearTimeout(attackStopTimerRef.current);
            attackStopTimerRef.current = null;
        }
    };

    const returnToIdle = React.useCallback(() => {
        const idle = idleActionRef.current;
        const attack = attackActionRef.current;
        if (!idle) return;
        idle.enabled = true;
        idle.setEffectiveWeight(1).play();
        if (attack && attack.isRunning()) {
            idle.crossFadeFrom(attack, TRANSITION_SECONDS, true);
            attack.fadeOut(TRANSITION_SECONDS);
            clearAttackStopTimer();
            attackStopTimerRef.current = window.setTimeout(() => {
                attack.stop();
                attackStopTimerRef.current = null;
            }, TRANSITION_SECONDS * 1000 + 30);
        }
        isAttackingRef.current = false;
        clearReturnTimer();
    }, []);

    useEffect(() => {
        const root = group.current;
        if (!root || !idleClip) return;
        const mixer = new THREE.AnimationMixer(root);
        mixerRef.current = mixer;

        const idle = mixer.clipAction(idleClip);
        idle.reset();
        idle.setLoop(THREE.LoopRepeat, Infinity);
        idle.clampWhenFinished = false;
        idle.play();
        idleActionRef.current = idle;

        const attack = attackClip ? mixer.clipAction(attackClip) : null;
        attackActionRef.current = attack;
        isAttackingRef.current = false;

        const onFinished = (e: THREE.Event & { action?: THREE.AnimationAction }) => {
            if (e.action === attackActionRef.current) {
                returnToIdle();
            }            
        };

        mixer.addEventListener("finished", onFinished);        
        return () => {
            clearReturnTimer();
            clearAttackStopTimer();
            mixer.removeEventListener("finished", onFinished);
            mixer.stopAllAction();
            if (idleClip) mixer.uncacheClip(idleClip);
            if (attackClip) mixer.uncacheClip(attackClip);
            mixer.uncacheRoot(root);
            mixerRef.current = null;
            idleActionRef.current = null;
            attackActionRef.current = null;
            isAttackingRef.current = false;
        };
    }, [idleClip, attackClip, returnToIdle]);

    useFrame((_, delta) => {
        mixerRef.current?.update(delta);
        const idle = idleActionRef.current;
        if (!isAttackingRef.current && idle && !idle.isRunning()) {
            idle.reset();
            idle.setEffectiveWeight(1);
            idle.play();
        }
    });

    useEffect(() => {
        const idle = idleActionRef.current;
        const attack = attackActionRef.current;
        if (!idle) return;

        if (isAttacking && !isAttackingRef.current) {
            if (!attack) return;
            isAttackingRef.current = true;
            attack.setLoop(THREE.LoopOnce, 1);
            attack.clampWhenFinished = false;
            attack.enabled = true;
            attack.setEffectiveWeight(1).setEffectiveTimeScale(1);
            attack.reset().play();
            attack.crossFadeFrom(idle, TRANSITION_SECONDS, true);

            clearReturnTimer();
            fallbackReturnTimerRef.current = window.setTimeout(() => {
                returnToIdle();
            }, Math.max(400, attack.getClip().duration * 1000 + 220));
        }

        if (!isAttacking && isAttackingRef.current) {
            returnToIdle();
        }
    }, [isAttacking, returnToIdle]);

    return (
        <group ref={group}>
            <primitive object={modelScene} scale={[1.5, 1.5, 1.5]} position={[0, -1, 0]} />
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
        let disposed = false;
        const acquiredPaths: string[] = [];
        const attackPath = attackModelPath && attackModelPath !== modelPath ? attackModelPath : modelPath;

        const releaseAll = () => {
            for (const path of acquiredPaths) {
                releaseCachedAssetUrl(path);
            }
            acquiredPaths.length = 0;
        };

        async function loadAsset() {
            try {
                const idleUrl = await acquireCachedAssetUrl(modelPath);
                acquiredPaths.push(modelPath);
                if (disposed) {
                    releaseAll();
                    return;
                }
                setIdleAssetUrl(idleUrl);

                let resolvedAttackUrl = idleUrl;
                if (attackPath !== modelPath) {
                    resolvedAttackUrl = await acquireCachedAssetUrl(attackPath);
                    acquiredPaths.push(attackPath);
                    if (disposed) {
                        releaseAll();
                        return;
                    }
                }
                setAttackAssetUrl(resolvedAttackUrl);
            } catch (e) {
                console.error("Failed to load 3D models from disk:", e);
            }
        }

        loadAsset();

        return () => {
            disposed = true;
            releaseAll();
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
                    <Model
                        idleUrl={idleAssetUrl}
                        attackUrl={attackAssetUrl}
                        isAttacking={isAttacking}
                    />
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
