export type LocalAssetKind = "image" | "model";

type CachedAssetUrl = {
    url: string;
    refCount: number;
    revokeTimer: number | null;
    loading?: Promise<string>;
};

const ASSET_URL_REVOKE_DELAY_MS = 30_000;
const assetUrlCache = new Map<string, CachedAssetUrl>();

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
    bmp: "image/bmp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
};

function getPathExtension(path: string): string {
    const cleanPath = path.split(/[?#]/, 1)[0] ?? path;
    const fileName = cleanPath.split(/[/\\]/).pop() ?? cleanPath;
    const segments = fileName.split(".");
    return segments.length > 1 ? segments.pop()?.toLowerCase() ?? "" : "";
}

function getMimeTypeForAsset(path: string, kind: LocalAssetKind): string {
    if (kind === "model") {
        return "model/gltf-binary";
    }

    const extension = getPathExtension(path);
    return IMAGE_MIME_BY_EXTENSION[extension] ?? "image/png";
}

async function createAssetUrlFromPath(path: string, kind: LocalAssetKind): Promise<string> {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const data = await readFile(path);
    const blob = new Blob([data], { type: getMimeTypeForAsset(path, kind) });
    return URL.createObjectURL(blob);
}

export async function acquireCachedAssetUrl(
    path: string,
    kind: LocalAssetKind = "image",
): Promise<string> {
    let entry = assetUrlCache.get(path);

    if (!entry) {
        const loading = createAssetUrlFromPath(path, kind);
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
        } catch (error) {
            assetUrlCache.delete(path);
            throw error;
        }
    } else if (entry.loading) {
        await entry.loading;
        const current = assetUrlCache.get(path);
        if (!current?.url) {
            throw new Error(`Failed to cache asset URL: ${path}`);
        }
        entry = current;
    }

    if (!entry?.url) {
        throw new Error(`Missing cached asset URL: ${path}`);
    }

    if (entry.revokeTimer !== null) {
        window.clearTimeout(entry.revokeTimer);
        entry.revokeTimer = null;
    }

    entry.refCount += 1;
    return entry.url;
}

export function releaseCachedAssetUrl(path: string): void {
    const entry = assetUrlCache.get(path);
    if (!entry) {
        return;
    }

    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount > 0) {
        return;
    }

    if (entry.revokeTimer !== null) {
        window.clearTimeout(entry.revokeTimer);
    }

    entry.revokeTimer = window.setTimeout(() => {
        const current = assetUrlCache.get(path);
        if (!current || current.refCount > 0) {
            return;
        }

        if (current.url) {
            URL.revokeObjectURL(current.url);
        }
        assetUrlCache.delete(path);
    }, ASSET_URL_REVOKE_DELAY_MS);
}
