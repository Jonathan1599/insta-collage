# Collage Studio

A local-first Tauri desktop editor for creating Instagram photo collages COZ I COUNLDN'T FIND AN EXISTING SIMPLE APP! Currently supports a 1080 × 1350 portrait canvas, multiple independently editable frames, seven collage layouts, nondestructive crop controls, three image adjustments, project save/open, reset controls, and full-resolution PNG export.

Photos are read from their existing local paths. The app never modifies the source files, has no backend, and makes no network requests.

## Current features

- Native multi-photo JPEG, PNG, and WebP picker
- Single, two-column, two-row, three-column, hero-plus-two, four-grid, and freeform layouts
- Adjustable spacing between collage photos
- Separate Fabric.js frame, clip path, transform, and filter state for every photo
- Click-to-select and double-click crop mode with drag-to-reposition
- Mouse-wheel and slider zoom
- Rotation with automatic cover constraints (no exposed frame areas)
- Brightness, contrast, and saturation adjustments
- Per-frame photo replacement, selected-image reset, and complete-project reset
- Serializable `.json` project save/open with source paths, frame geometry, transforms, filters, and export settings
- 1080 × 1350 PNG export, independent of the displayed editor size

Folder browsing, thumbnail generation, carousel pages, undo/redo, and JPEG/custom-size export remain deferred to later milestones.

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

1. Choose a layout in the left sidebar.
2. Click **Add multiple photos** and select images. Starting from the single layout with several photos automatically chooses a fitting collage layout.
3. Click a frame to select it. Double-click it, or click **Crop selected**, to enter crop mode.
4. Drag the selected image to reposition it. Scroll or use **Zoom** to change its size, and use **Rotation** to rotate it.
5. Press `Escape` or **Finish crop** to leave crop mode. Each frame retains its own crop and adjustments.
6. Use **Save** (or `Cmd/Ctrl+S`) to write a local project JSON file.
7. Choose **Export PNG** to write the 1080 × 1350 result.

Saved projects reference the original image path, so keep the source photo in place if you want the project to reopen without relinking it.

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use is not permitted. This is a source-available license, not an OSI-approved open-source license.
