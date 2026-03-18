# Food Fight Robots

Food image in, battle robot out. This project uses `Next.js 16 + React 19` for the UI and `Tauri v2 + Rust` for desktop-side orchestration, storage, and API access.

## What It Does

- Upload a food image in the Construction screen
- Normalize the input to PNG on the frontend for stable cross-platform behavior
- Generate robot stats and lore with Gemini
- Generate a concept image and 3D model with Gemini + Meshy
- Save images, GLB files, and SQLite data under the Tauri app data directory
- Browse generated robots in Encyclopedia and use them in Battle

## Stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS
- 3D: three.js, `@react-three/fiber`, `@react-three/drei`
- Desktop backend: Tauri v2, Rust
- Storage: SQLite via `rusqlite`
- External APIs: Gemini API, Meshy API

## Prerequisites

### Common

- Node.js 20+
- npm
- Rust stable

### Windows

- Microsoft C++ Build Tools
- Microsoft Edge WebView2

Tauri prerequisites:
https://v2.tauri.app/ja/start/prerequisites/

### macOS

- Xcode Command Line Tools

Tauri prerequisites:
https://v2.tauri.app/ja/start/prerequisites/

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and set your API keys:

```env
GEMINI_API_KEY=your_gemini_api_key
MESHY_AI_API_KEY=your_meshy_ai_api_key
```

## Development

Tauri is the primary runtime target for this app.

```bash
npm run tauri:dev
```

If you only want to inspect the frontend shell:

```bash
npm run dev
```

Note: browser-only execution is not the supported runtime for the full app because local file access and desktop commands depend on Tauri APIs.

## Build

Frontend build:

```bash
npm run build
```

Windows bundle:

```bash
npm run tauri:build:win
```

This project is configured to generate an `nsis` installer on Windows.

macOS bundle:

```bash
npm run tauri:build:mac
```

This project is configured to generate `app` and `dmg` bundles on macOS.

## Cross-Platform Notes

- Uploads are normalized to `image/png` before calling Rust, which removes MIME inconsistencies between macOS and Windows.
- HEIC and HEIF input are converted in the browser using `heic-to/csp`.
- Stored local assets are read back through shared Tauri filesystem helpers, with MIME derived from file extension for images and fixed GLB MIME for models.
- Generated app data stays under the Tauri app data directory on each OS.

## Useful Files

- `src/app/construction/page.tsx`
- `src/components/RobotViewer.tsx`
- `src/lib/upload.ts`
- `src/lib/tauriAsset.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/tauri.windows.conf.json`
- `src-tauri/tauri.macos.conf.json`
