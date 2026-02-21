"use client";
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Hammer, Book, Swords } from 'lucide-react';
import { useStore } from '@/store/useStore';

export default function MainLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isGenerating = useStore((state) => state.isGenerating);

    const navItems = [
        { label: "Home", href: "/", icon: Home },
        { label: "Construction", href: "/construction", icon: Hammer },
        { label: "Encyclopedia", href: "/encyclopedia", icon: Book },
        { label: "Battle Arena", href: "/battle", icon: Swords },
    ];

    return (
        <div className="flex h-screen w-full bg-zinc-950 text-zinc-100 font-sans selection:bg-red-500/30 overflow-hidden">

            {/* Sidebar Navigation */}
            <aside className="w-20 md:w-64 border-r border-zinc-800 bg-zinc-900/50 flex flex-col items-center md:items-stretch py-6 backdrop-blur-md z-50">
                <div className="px-4 mb-8 hidden md:block">
                    <h1 className="text-xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-red-500 to-orange-400">
                        FOOD FIGHT<br />ROBOTS
                    </h1>
                </div>

                <nav className="flex-1 flex flex-col gap-2 px-2 md:px-4">
                    {navItems.map((item) => {
                        const isActive = pathname === item.href;
                        const Icon = item.icon;

                        // Disable navigation if we are actively generating a robot
                        if (isGenerating && !isActive) {
                            return (
                                <div key={item.href} className="flex items-center gap-3 px-3 py-3 rounded-lg text-zinc-600 cursor-not-allowed">
                                    <Icon size={20} />
                                    <span className="hidden md:block font-bold tracking-wide">{item.label}</span>
                                </div>
                            );
                        }

                        return (
                            <Link key={item.href} href={item.href} className={`flex items-center justify-center md:justify-start gap-3 px-3 py-3 rounded-lg transition-all duration-200 ${isActive
                                ? "bg-red-500/10 text-red-500 border border-red-500/30 shadow-[0_0_15px_-3px_rgba(239,68,68,0.3)]"
                                : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50"
                                }`}>
                                <Icon size={20} className={isActive ? "animate-pulse" : ""} />
                                <span className="hidden md:block font-bold tracking-wide text-sm">{item.label}</span>
                            </Link>
                        );
                    })}
                </nav>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 relative overflow-y-auto">
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none z-0" />
                <div className="relative z-10 w-full h-full p-4 md:p-8">
                    {children}
                </div>
            </main>
        </div>
    );
}
