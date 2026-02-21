"use client";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldAlert, Flame, Droplets, Zap, Shield, Swords, RotateCcw, RefreshCcw } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { Model } from '@/components/RobotViewer';
import { invoke } from '@tauri-apps/api/core';
import { RobotRecord } from '@/types/robot';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls, ContactShadows, Grid, Sparkles } from '@react-three/drei';
import { EffectComposer, Bloom, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';

function BattleRobotModel({ robot, isEnemy, isAttacking }: { robot: RobotRecord, isEnemy: boolean, isAttacking: boolean }) {
    const [idleUrl, setIdleUrl] = useState<string | null>(null);
    const [attackUrl, setAttackUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!robot) return;
        let idleU: string | null = null;
        let attackU: string | null = null;

        async function loadAsset() {
            try {
                const { readFile } = await import('@tauri-apps/plugin-fs');
                const idleData = await readFile(robot.model_path);
                const idleBlob = new Blob([idleData], { type: 'model/gltf-binary' });
                idleU = URL.createObjectURL(idleBlob);
                setIdleUrl(idleU);

                if (robot.attack_model_path) {
                    const attackData = await readFile(robot.attack_model_path);
                    const attackBlob = new Blob([attackData], { type: 'model/gltf-binary' });
                    attackU = URL.createObjectURL(attackBlob);
                    setAttackUrl(attackU);
                } else {
                    setAttackUrl(idleU);
                }
            } catch (e) {
                console.error("Failed to load 3D models from disk:", e);
            }
        }
        loadAsset();

        return () => {
            if (idleU) URL.revokeObjectURL(idleU);
            if (attackU && attackU !== idleU) URL.revokeObjectURL(attackU);
        };
    }, [robot]);

    if (!idleUrl || !attackUrl) return null;

    // We tilt them slightly towards the camera
    const rotationY = isEnemy ? -Math.PI / 2 - 0.2 : Math.PI / 2 + 0.2;
    // We space them out
    const positionX = isEnemy ? 2.5 : -2.5;

    return (
        <group position={[positionX, -1, 0]} rotation={[0, rotationY, 0]}>
            {/* Spotlight directly on the robot */}
            <spotLight position={[0, 5, 2]} intensity={2} color={isEnemy ? "#ff5555" : "#55aaff"} angle={0.5} penumbra={1} castShadow />
            <Model idleUrl={idleUrl} attackUrl={attackUrl} isAttacking={isAttacking} />
        </group>
    );
}

// We'll map the cooking methods to elemental elements
const COMMANDS = [
    { id: 'grill', name: 'GRILL', icon: Flame, color: 'text-red-500', bg: 'bg-red-500/10 hover:bg-red-500/20 border-red-500/50', desc: 'High ATK, Low Speed' },
    { id: 'boil', name: 'BOIL', icon: Droplets, color: 'text-blue-500', bg: 'bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/50', desc: 'Balanced, Healing' },
    { id: 'fry', name: 'FRY', icon: Zap, color: 'text-yellow-500', bg: 'bg-yellow-500/10 hover:bg-yellow-500/20 border-yellow-500/50', desc: 'High Speed, Pierce' },
 ] as const;

type CommandId = typeof COMMANDS[number]["id"];
type RoundOutcome = "player" | "enemy" | "draw";

const BEATS: Record<CommandId, CommandId> = {
    grill: "boil",
    boil: "fry",
    fry: "grill",
};

function pickRandomCommand(): CommandId {
    return COMMANDS[Math.floor(Math.random() * COMMANDS.length)].id;
}

function judgeRound(player: CommandId, enemy: CommandId): RoundOutcome {
    if (player === enemy) return "draw";
    return BEATS[player] === enemy ? "player" : "enemy";
}

function calculateDamage(attackerAtk: number, defenderDef: number): number {
    return Math.max(1, Math.round((attackerAtk - defenderDef / 2) * 1.5));
}

export default function BattlePage() {
    const { selectedPlayerRobot, selectPlayerRobot, selectEnemyRobot, selectedEnemyRobot } = useStore();
    const [robots, setRobots] = useState<RobotRecord[]>([]);
    const [loadingRobots, setLoadingRobots] = useState(false);
    const [loadingEnemy, setLoadingEnemy] = useState(false);
    const [playerHp, setPlayerHp] = useState(0);
    const [enemyHp, setEnemyHp] = useState(0);
    const [isPlayerAttacking, setIsPlayerAttacking] = useState(false);
    const [isEnemyAttacking, setIsEnemyAttacking] = useState(false);
    const [isResolving, setIsResolving] = useState(false);
    const [winner, setWinner] = useState<"player" | "enemy" | null>(null);
    const [roundMessage, setRoundMessage] = useState("プレイヤーロボットを選択してください。");
    const [lastPlayerCommand, setLastPlayerCommand] = useState<CommandId | null>(null);
    const [lastEnemyCommand, setLastEnemyCommand] = useState<CommandId | null>(null);
    const timersRef = useRef<number[]>([]);

    const clearAllTimers = useCallback(() => {
        timersRef.current.forEach((id) => window.clearTimeout(id));
        timersRef.current = [];
    }, []);

    const schedule = useCallback((fn: () => void, delayMs: number) => {
        const id = window.setTimeout(fn, delayMs);
        timersRef.current.push(id);
    }, []);

    const pickEnemy = useCallback((playerId: string, pool: RobotRecord[]) => {
        const candidates = pool.filter((r) => r.id !== playerId);
        if (candidates.length === 0) return null;
        return candidates[Math.floor(Math.random() * candidates.length)];
    }, []);

    const resetBattleState = useCallback((player: RobotRecord, enemy: RobotRecord | null) => {
        clearAllTimers();
        setPlayerHp(player.hp);
        setEnemyHp(enemy?.hp ?? 0);
        setIsPlayerAttacking(false);
        setIsEnemyAttacking(false);
        setIsResolving(false);
        setWinner(null);
        setLastPlayerCommand(null);
        setLastEnemyCommand(null);
        setRoundMessage(enemy ? "行動を選択してください。" : "対戦相手がいません。別のロボットを建造してください。");
    }, [clearAllTimers]);

    const assignEnemyFor = useCallback((player: RobotRecord, pool: RobotRecord[]) => {
        setLoadingEnemy(true);
        const enemy = pickEnemy(player.id, pool);
        selectEnemyRobot(enemy);
        resetBattleState(player, enemy);
        setLoadingEnemy(false);
    }, [pickEnemy, resetBattleState, selectEnemyRobot]);

    useEffect(() => {
        async function loadRobots() {
            setLoadingRobots(true);
            try {
                const data: RobotRecord[] = await invoke('get_all_robots');
                const sorted = data.sort((a, b) => b.created_at - a.created_at);
                setRobots(sorted);
            } catch (e) {
                console.error("Failed to load robots:", e);
                setRoundMessage("ロボットの読み込みに失敗しました。");
            } finally {
                setLoadingRobots(false);
            }
        }
        loadRobots();
    }, []);

    useEffect(() => {
        if (!selectedPlayerRobot || robots.length === 0) return;
        assignEnemyFor(selectedPlayerRobot, robots);
    }, [selectedPlayerRobot, robots, assignEnemyFor]);

    useEffect(() => {
        return () => clearAllTimers();
    }, [clearAllTimers]);

    const handleSelectPlayer = (robot: RobotRecord) => {
        selectPlayerRobot(robot);
    };

    const handleRerollEnemy = () => {
        if (!selectedPlayerRobot) return;
        assignEnemyFor(selectedPlayerRobot, robots);
    };

    const handleRematch = () => {
        if (!selectedPlayerRobot) return;
        resetBattleState(selectedPlayerRobot, selectedEnemyRobot);
    };

    const handleCommand = (cmdId: CommandId) => {
        if (!selectedPlayerRobot || !selectedEnemyRobot || winner || isResolving) return;

        clearAllTimers();
        const enemyCmd = pickRandomCommand();
        const outcome = judgeRound(cmdId, enemyCmd);
        setLastPlayerCommand(cmdId);
        setLastEnemyCommand(enemyCmd);
        setIsResolving(true);

        if (outcome === "draw") {
            setRoundMessage(`あいこ: ${cmdId.toUpperCase()} vs ${enemyCmd.toUpperCase()}。もう一度選択してください。`);
            schedule(() => {
                setIsResolving(false);
                setRoundMessage("行動を選択してください。");
            }, 850);
            return;
        }

        const playerWon = outcome === "player";
        const attacker = playerWon ? selectedPlayerRobot : selectedEnemyRobot;
        const defender = playerWon ? selectedEnemyRobot : selectedPlayerRobot;
        const damage = calculateDamage(attacker.atk, defender.def);
        const nextPlayerHp = playerWon ? playerHp : Math.max(0, playerHp - damage);
        const nextEnemyHp = playerWon ? Math.max(0, enemyHp - damage) : enemyHp;

        setRoundMessage(
            `${playerWon ? "あなた" : "敵"}の${attacker.name}が ${damage} ダメージを与えた。`
        );
        setIsPlayerAttacking(playerWon);
        setIsEnemyAttacking(!playerWon);

        schedule(() => {
            setIsPlayerAttacking(false);
            setIsEnemyAttacking(false);
            setPlayerHp(nextPlayerHp);
            setEnemyHp(nextEnemyHp);

            if (nextEnemyHp <= 0) {
                setWinner("player");
                setRoundMessage("YOU WIN");
                setIsResolving(false);
                return;
            }
            if (nextPlayerHp <= 0) {
                setWinner("enemy");
                setRoundMessage("YOU LOSE");
                setIsResolving(false);
                return;
            }

            setRoundMessage("行動を選択してください。");
            setIsResolving(false);
        }, 1200);
    };

    if (loadingRobots) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center gap-6">
                <Shield size={64} className="text-zinc-600 animate-pulse" />
                <div className="text-center">
                    <h2 className="text-2xl font-black italic text-zinc-400 mb-2">LOADING UNITS</h2>
                    <p className="text-zinc-500">データベースからロボットを読み込み中...</p>
                </div>
            </div>
        );
    }

    if (!selectedPlayerRobot) {
        return (
            <div className="w-full h-full flex flex-col gap-6 max-w-6xl mx-auto">
                <div className="text-center mt-8 mb-2">
                    <h2 className="text-3xl font-black italic text-orange-400">PLAYER A を選択</h2>
                    <p className="text-zinc-500 mt-2">バトルに出すロボットを選んでください。</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {robots.map((robot) => (
                        <button
                            key={robot.id}
                            onClick={() => handleSelectPlayer(robot)}
                            className="bg-zinc-900 border border-zinc-800 hover:border-orange-500/50 rounded-2xl p-4 text-left transition-colors"
                        >
                            <div className="font-bold text-zinc-100 truncate">{robot.name}</div>
                            <div className="mt-2 text-sm text-zinc-500">{robot.lore.slice(0, 56)}...</div>
                            <div className="mt-3 text-xs font-mono text-zinc-400">HP {robot.hp} / ATK {robot.atk} / DEF {robot.def}</div>
                        </button>
                    ))}
                </div>
                {robots.length === 0 && (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                        <ShieldAlert size={48} className="text-zinc-700" />
                        <p className="text-zinc-500">ロボットが未登録です。建造画面でロボットを作成してください。</p>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="w-full h-full flex flex-col gap-4 max-w-7xl mx-auto overflow-hidden">

            {/* Top HUD: Health Bars & Status */}
            <div className="flex items-end justify-between gap-8 px-4 shrink-0">

                {/* Player HP */}
                <div className="flex-1 max-w-sm">
                    <div className="flex justify-between items-end mb-1">
                        <h3 className="font-bold text-lg text-blue-400 truncate pr-2">{selectedPlayerRobot.name}</h3>
                        <span className="font-mono text-xl font-bold text-zinc-100">{playerHp} <span className="text-sm text-zinc-500">/ {selectedPlayerRobot.hp}</span></span>
                    </div>
                    <div className="h-4 w-full bg-zinc-900 rounded-full border border-zinc-700 overflow-hidden relative skew-x-[-10deg]">
                        <div
                            className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-300"
                            style={{ width: `${Math.max(0, (playerHp / selectedPlayerRobot.hp) * 100)}%` }}
                        />
                    </div>
                </div>

                <div className="shrink-0 text-center hidden md:block">
                    <div className="text-3xl font-black italic text-zinc-700 tracking-tighter">VS</div>
                </div>

                {/* Enemy HP */}
                <div className="flex-1 max-w-sm">
                    <div className="flex justify-between items-end mb-1 flex-row-reverse">
                        <h3 className="font-bold text-lg text-red-500 truncate pl-2">
                            {loadingEnemy ? 'SCANNING...' : selectedEnemyRobot ? selectedEnemyRobot.name : 'NO TARGET'}
                        </h3>
                        <span className="font-mono text-xl font-bold text-zinc-100">
                            {enemyHp} <span className="text-sm text-zinc-500">/ {selectedEnemyRobot?.hp || 0}</span>
                        </span>
                    </div>
                    <div className="h-4 w-full bg-zinc-900 rounded-full border border-zinc-700 overflow-hidden relative skew-x-[-10deg]">
                        <div
                            className="absolute top-0 right-0 h-full bg-gradient-to-l from-red-600 to-orange-400 transition-all duration-300"
                            style={{ width: `${selectedEnemyRobot ? Math.max(0, (enemyHp / selectedEnemyRobot.hp) * 100) : 0}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Main 3D Arena Canvas */}
            <div className="flex-1 relative bg-zinc-950 rounded-3xl border border-zinc-800 overflow-hidden shadow-inner">
                {loadingEnemy && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                        <div className="bg-red-950/80 border border-red-900 px-6 py-3 rounded-full flex items-center gap-3 animate-pulse">
                            <Shield className="text-red-500" size={24} />
                            <span className="text-red-500 font-bold tracking-widest text-sm">SCANNING OPPONENT...</span>
                        </div>
                    </div>
                )}

                <Canvas shadows camera={{ position: [0, 2, 8], fov: 45 }}>
                    <color attach="background" args={['#050508']} />

                    {/* Scene Lighting */}
                    <ambientLight intensity={0.2} color="#ffffff" />
                    <directionalLight position={[0, 10, -10]} intensity={1} color="#5555ff" />
                    <pointLight position={[-5, 2, 5]} intensity={2} color="#00ffff" distance={20} />
                    <pointLight position={[5, 2, 5]} intensity={2} color="#ff0044" distance={20} />
                    <Environment preset="night" />

                    {/* Cyber Grid Floor */}
                    <Grid
                        position={[0, -1, 0]}
                        args={[40, 40]}
                        cellSize={1}
                        cellThickness={1}
                        cellColor="#111122"
                        sectionSize={4}
                        sectionThickness={1.5}
                        sectionColor="#00ffff"
                        fadeDistance={25}
                        fadeStrength={1}
                    />

                    {/* Shadow Catcher */}
                    <ContactShadows position={[0, -0.99, 0]} opacity={0.5} scale={20} blur={2.5} far={4} color="#000000" />

                    {/* Ambient Particles */}
                    <Sparkles count={100} scale={15} size={2} speed={0.4} opacity={0.3} color="#00ffff" position={[-3, 2, 0]} />
                    <Sparkles count={100} scale={15} size={2} speed={0.4} opacity={0.3} color="#ff0044" position={[3, 2, 0]} />

                    {/* Camera Control - restrict movement for cinematic feel */}
                    <OrbitControls
                        enablePan={false}
                        enableZoom={true}
                        maxDistance={12}
                        minDistance={4}
                        maxPolarAngle={Math.PI / 2 - 0.05} // Don't go below ground
                        minPolarAngle={Math.PI / 4}
                        target={[0, 0, 0]}
                    />

                    {/* Robots */}
                    <React.Suspense fallback={null}>
                        {selectedPlayerRobot && (
                            <BattleRobotModel robot={selectedPlayerRobot} isEnemy={false} isAttacking={isPlayerAttacking} />
                        )}
                        {selectedEnemyRobot && (
                            <BattleRobotModel robot={selectedEnemyRobot} isEnemy={true} isAttacking={isEnemyAttacking} />
                        )}
                    </React.Suspense>

                    {/* Post Processing for Cyberpunk Vibe */}
                    <EffectComposer>
                        <Bloom luminanceThreshold={0.5} mipmapBlur intensity={1.5} />
                        <ChromaticAberration blendFunction={BlendFunction.NORMAL} offset={new THREE.Vector2(0.002, 0.002)} />
                    </EffectComposer>
                </Canvas>
            </div>

            {/* Bottom HUD: Actions */}
            <div className="shrink-0 bg-zinc-900 border border-zinc-800 p-4 sm:p-6 rounded-3xl">
                <div className="text-center mb-4 flex flex-col gap-2">
                    <span className="text-xs font-mono tracking-widest text-zinc-500 uppercase">Select Combat Protocol</span>
                    <div className="text-sm md:text-base font-semibold text-zinc-200">{roundMessage}</div>
                    {(lastPlayerCommand && lastEnemyCommand) && (
                        <div className="text-xs font-mono text-zinc-400">
                            YOU: {lastPlayerCommand.toUpperCase()} / CPU: {lastEnemyCommand.toUpperCase()}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto">
                    {COMMANDS.map((cmd) => {
                        const Icon = cmd.icon;
                        return (
                            <button
                                key={cmd.id}
                                onClick={() => handleCommand(cmd.id)}
                                disabled={isResolving || winner !== null || !selectedEnemyRobot}
                                className={`relative group overflow-hidden border-2 rounded-2xl p-4 flex flex-col items-center gap-2 transition-all duration-200 ${cmd.bg} ${(isResolving || winner !== null || !selectedEnemyRobot) ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'}`}
                            >
                                <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${cmd.color.replace('text-', 'from-').replace('text-', 'to-')} opacity-0 group-hover:opacity-100 transition-opacity`} />
                                <Icon size={32} className={cmd.color} />
                                <span className={`font-black tracking-widest text-lg md:text-xl ${cmd.color}`}>{cmd.name}</span>
                                <span className="text-xs font-mono text-zinc-400">{cmd.desc}</span>
                            </button>
                        );
                    })}
                </div>

                <div className="mt-4 flex flex-wrap justify-center gap-3">
                    <button
                        onClick={handleRerollEnemy}
                        disabled={isResolving}
                        className={`px-4 py-2 rounded-full border text-sm font-semibold flex items-center gap-2 ${isResolving ? "border-zinc-700 text-zinc-600" : "border-zinc-600 text-zinc-300 hover:border-red-400 hover:text-red-300"}`}
                    >
                        <RefreshCcw size={16} />
                        敵を再抽選
                    </button>
                    <button
                        onClick={handleRematch}
                        disabled={!selectedEnemyRobot || isResolving}
                        className={`px-4 py-2 rounded-full border text-sm font-semibold flex items-center gap-2 ${(!selectedEnemyRobot || isResolving) ? "border-zinc-700 text-zinc-600" : "border-zinc-600 text-zinc-300 hover:border-cyan-400 hover:text-cyan-300"}`}
                    >
                        <RotateCcw size={16} />
                        同じ相手と再戦
                    </button>
                    {winner && (
                        <span className={`px-4 py-2 rounded-full border text-sm font-black flex items-center gap-2 ${winner === "player" ? "text-emerald-300 border-emerald-500/50 bg-emerald-900/20" : "text-red-300 border-red-500/50 bg-red-900/20"}`}>
                            <Swords size={16} />
                            {winner === "player" ? "VICTORY" : "DEFEAT"}
                        </span>
                    )}
                </div>
            </div>

        </div>
    );
}
