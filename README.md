# Collage Studio

A local-first Tauri desktop editor for creating Instagram photo collages COZ I COUNLDN'T FIND AN EXISTING SIMPLE APP! Currently supports one 1080 × 1350 portrait canvas, one independent frame, nondestructive crop controls, three image adjustments, project save/open, reset controls, and full-resolution PNG export.

Photos are read from their existing local paths. The app never modifies the source files, has no backend, and makes no network requests.

## Current features

- Native JPEG, PNG, and WebP photo picker
- Separate Fabric.js frame and clipped image objects
- Double-click crop mode with drag-to-reposition
- Mouse-wheel and slider zoom
- Rotation with automatic cover constraints (no exposed frame areas)
- Brightness, contrast, and saturation adjustments
- Selected-image and complete-project reset
- Serializable `.json` project save/open with source paths, frame geometry, transforms, filters, and export settings
- 1080 × 1350 PNG export, independent of the displayed editor size

Folder browsing, thumbnail generation, multiple templates, carousel pages, undo/redo, and JPEG/custom-size export are intentionally deferred until the single-frame crop interaction is validated.

## Prerequisites

- Node.js 20 or newer
- Rust stable toolchain (Cargo 1.85 or newer)
- [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS

## Setup

```bash
npm install
```

## Run the desktop app

```bash
npm run tauri dev
```

The regular Vite command (`npm run dev`) can render the interface in a browser, but native open/save/export actions require the Tauri desktop runtime.

## Checks and builds

```bash
npm run check
npm run lint
npm run build
npm run tauri build
```

## How to use

1. Choose **Select a photo** in the left sidebar.
2. Double-click the blue frame, or click **Crop photo**, to enter crop mode.
3. Drag the image to reposition it. Scroll or use **Zoom** to change its size, and use **Rotation** to rotate it.
4. Press `Escape` or **Finish crop** to leave crop mode.
5. Use **Save** (or `Cmd/Ctrl+S`) to write a local project JSON file.
6. Choose **Export PNG** to write the 1080 × 1350 result.

Saved projects reference the original image path, so keep the source photo in place if you want the project to reopen without relinking it.
