"use client";
/* eslint-disable @next/next/no-img-element */

import { useTauriObjectUrl } from "@/hooks/useTauriObjectUrl";

type LocalImageProps = {
    path: string;
    alt: string;
    className?: string;
};

export default function LocalImage({ path, alt, className }: LocalImageProps) {
    const { url } = useTauriObjectUrl(path, "image");
    const fallbackClassName = ["bg-zinc-800 animate-pulse", className]
        .filter(Boolean)
        .join(" ");

    if (!path || !url) {
        return <div className={fallbackClassName} />;
    }

    return <img src={url} alt={alt} className={className} loading="lazy" />;
}
