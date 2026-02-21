import Link from "next/link";
import { Hammer, Book, Swords } from "lucide-react";

export default function HomePage() {
    return (
        <div className="w-full h-full flex items-center justify-center pt-20">
            <div className="max-w-4xl w-full flex flex-col items-center gap-12 text-center">

                <header className="space-y-4">
                    <h1 className="text-6xl md:text-8xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-red-500 to-orange-400">
                        FOOD FIGHT<br />ROBOTS
                    </h1>
                    <p className="text-zinc-400 text-lg md:text-2xl font-mono">
                        EAT. CONSTRUCT. DESTROY.
                    </p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full px-4">
                    <Link href="/construction" className="group relative bg-zinc-900 border border-zinc-800 p-8 rounded-2xl hover:border-red-500/50 transition-all hover:-translate-y-2 hover:shadow-[0_10px_40px_-10px_rgba(239,68,68,0.3)] duration-300">
                        <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />
                        <Hammer size={48} className="mx-auto text-zinc-600 group-hover:text-red-500 mb-6 transition-colors" />
                        <h2 className="text-2xl font-bold tracking-tight mb-2">Construction</h2>
                        <p className="text-zinc-500 text-sm">Convert food imagery into combat-ready mechas.</p>
                    </Link>

                    <Link href="/encyclopedia" className="group relative bg-zinc-900 border border-zinc-800 p-8 rounded-2xl hover:border-blue-500/50 transition-all hover:-translate-y-2 hover:shadow-[0_10px_40px_-10px_rgba(59,130,246,0.3)] duration-300">
                        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />
                        <Book size={48} className="mx-auto text-zinc-600 group-hover:text-blue-500 mb-6 transition-colors" />
                        <h2 className="text-2xl font-bold tracking-tight mb-2">Encyclopedia</h2>
                        <p className="text-zinc-500 text-sm">Review specs and lore of your generated arsenal.</p>
                    </Link>

                    <Link href="/battle" className="group relative bg-zinc-900 border border-zinc-800 p-8 rounded-2xl hover:border-orange-500/50 transition-all hover:-translate-y-2 hover:shadow-[0_10px_40px_-10px_rgba(249,115,22,0.3)] duration-300">
                        <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />
                        <Swords size={48} className="mx-auto text-zinc-600 group-hover:text-orange-500 mb-6 transition-colors" />
                        <h2 className="text-2xl font-bold tracking-tight mb-2">Battle Arena</h2>
                        <p className="text-zinc-500 text-sm">Test your creations against AI adversaries.</p>
                    </Link>
                </div>

            </div>
        </div>
    );
}
