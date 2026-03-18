export type SourceFormat = "png" | "jpeg" | "heic" | "heif";

export interface NormalizedUpload {
    file: File;
    previewUrl: string;
    dataUrl: string;
    mimeType: "image/png";
    sourceFormat: SourceFormat;
}

const PNG_MIME = "image/png" as const;

const MIME_TO_FORMAT: Record<string, SourceFormat> = {
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/heic": "heic",
    "image/heif": "heif",
};

const EXTENSION_TO_FORMAT: Record<string, SourceFormat> = {
    png: "png",
    jpg: "jpeg",
    jpeg: "jpeg",
    heic: "heic",
    heif: "heif",
};

function detectSourceFormat(file: File): SourceFormat | null {
    const mimeType = file.type.trim().toLowerCase();
    if (mimeType in MIME_TO_FORMAT) {
        return MIME_TO_FORMAT[mimeType];
    }

    const extension = file.name.split(".").pop()?.trim().toLowerCase() ?? "";
    return EXTENSION_TO_FORMAT[extension] ?? null;
}

function toPngFilename(fileName: string): string {
    const trimmed = fileName.trim();
    const baseName = trimmed.replace(/\.[^./\\]+$/, "") || "upload";
    return `${baseName}.png`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Failed to read normalized image data."));
        reader.onload = () => {
            if (typeof reader.result !== "string") {
                reject(new Error("Failed to encode normalized image as a data URL."));
                return;
            }
            resolve(reader.result);
        };
        reader.readAsDataURL(blob);
    });
}

function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(blob);
        const image = new Image();

        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };

        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Failed to decode the selected image."));
        };

        image.src = objectUrl;
    });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error("Failed to convert the selected image to PNG."));
                return;
            }
            resolve(blob);
        }, PNG_MIME);
    });
}

async function rasterizeBlobToPng(blob: Blob): Promise<Blob> {
    const image = await loadImageElement(blob);
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        throw new Error("The selected image has invalid dimensions.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Failed to initialize the image conversion canvas.");
    }

    context.drawImage(image, 0, 0);
    return canvasToBlob(canvas);
}

async function convertHeicToPng(blob: Blob): Promise<Blob> {
    const { heicTo } = await import("heic-to/csp");
    const convertedBlob = await heicTo({
        blob,
        type: PNG_MIME,
    });

    return convertedBlob.type === PNG_MIME
        ? convertedBlob
        : new Blob([convertedBlob], { type: PNG_MIME });
}

export async function normalizeUploadToPng(file: File): Promise<NormalizedUpload> {
    const sourceFormat = detectSourceFormat(file);
    if (!sourceFormat) {
        throw new Error("Unsupported image format. Use PNG, JPEG, HEIC, or HEIF.");
    }

    const pngBlob = sourceFormat === "heic" || sourceFormat === "heif"
        ? await convertHeicToPng(file)
        : await rasterizeBlobToPng(file);

    const normalizedBlob = pngBlob.type === PNG_MIME
        ? pngBlob
        : new Blob([pngBlob], { type: PNG_MIME });

    return {
        file: new File([normalizedBlob], toPngFilename(file.name), {
            type: PNG_MIME,
            lastModified: Date.now(),
        }),
        previewUrl: URL.createObjectURL(normalizedBlob),
        dataUrl: await blobToDataUrl(normalizedBlob),
        mimeType: PNG_MIME,
        sourceFormat,
    };
}
