"use client";

import { useEffect, useState } from "react";
import {
    acquireCachedAssetUrl,
    releaseCachedAssetUrl,
    type LocalAssetKind,
} from "@/lib/tauriAsset";

export function useTauriObjectUrl(
    path: string | null | undefined,
    kind: LocalAssetKind = "image",
) {
    const [state, setState] = useState<{
        path: string | null;
        url: string | null;
        error: Error | null;
    }>({
        path: null,
        url: null,
        error: null,
    });

    useEffect(() => {
        if (!path) {
            return;
        }

        let disposed = false;
        let acquired = false;

        acquireCachedAssetUrl(path, kind)
            .then((nextUrl) => {
                if (disposed) {
                    releaseCachedAssetUrl(path);
                    return;
                }

                acquired = true;
                setState({
                    path,
                    url: nextUrl,
                    error: null,
                });
            })
            .catch((cause: unknown) => {
                const nextError = cause instanceof Error ? cause : new Error(String(cause));
                console.error(`Failed to load local ${kind}:`, path, nextError);
                if (!disposed) {
                    setState({
                        path,
                        url: null,
                        error: nextError,
                    });
                }
            });

        return () => {
            disposed = true;
            if (acquired) {
                releaseCachedAssetUrl(path);
            }
        };
    }, [kind, path]);

    const url = path && state.path === path ? state.url : null;
    const error = path && state.path === path ? state.error : null;

    return { url, error };
}
