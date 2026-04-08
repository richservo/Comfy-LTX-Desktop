# Comfy LTX Desktop

A desktop app for AI video and image generation using LTX models via ComfyUI. Fork of [LTX Desktop](https://github.com/Lightricks/LTX-Desktop) rebuilt around a ComfyUI backend instead of a standalone Python server.

> **Status: Beta.** Expect breaking changes.

## Features

### Generation
- **Text-to-video** generation via ComfyUI
- **Image-to-video** generation with first/middle/last frame support and per-frame strength controls
- **Text-to-image** generation (single latent frame extraction at full 1080p resolution)
- **Audio-to-video** generation
- **Video retake** (re-generate sections of existing video)
- **Reference images** — upload up to 6 reference images to guide text-to-video generation
- **Prompt enhance** — toggle to expand prompts with detail before generation
- **Negative prompt** — editable negative prompt field
- **Seed control** — specify seeds for reproducible generation
- **Image variations** — generate multiple variations from text-to-image

### Alternative Image Generators
- **Z-Image** — alternative image generation model (detected automatically)
- **Gemini 3 Pro** — Google Gemini image generation with configurable model, aspect ratio, and image size (1K/2K/4K)

### Upscaling
- **Spatial upscale** (2x resolution) with configurable denoise strength
- **Temporal upscale** (2x frame count)
- **4K RTX Super Resolution** — NVIDIA RTX-powered upscale from 1080p to 4K (see [4K output](#4k-output))

### Rediffusion & Masking
- **Paint mask mode** — manual mask painting with brush/eraser, feather control, and undo
- **SAM3 segmentation** — text-prompted automatic mask generation
- **Subject & face detection** — pre-built mask modes via segmentation
- **Mask strength & dilation** — fine-grained control over mask-guided rediffusion

### Models & Inference
- **Model selector dropdowns** — choose checkpoint, text encoder, VAE, upscalers, and LoRA from what's installed in ComfyUI
- **LoRA support** — dynamic LoRA selection with per-model strength sliders
- **Sampler selection** — all samplers available in your ComfyUI install (including custom ones like res samplers)
- **Ollama prompt formatter** — local LLM reformats prompts into optimized tag format
- **Film grain** post-processing with intensity and grain size controls (persistent across sessions)
- **Camera motion** — optional camera movement prompt suffix

### Video Editor
- **Timeline** with gap-fill, rolling edits, and project management
- **Timeline markers** — add, edit, and delete markers with color/description (M key)
- **Heal cut** — Delete key on redundant cut points rejoins clips
- **Volume automation** — keyframe-based per-track volume control
- **Cross dissolve** — configurable fade between clips with rendering
- **Rendered preview system** — smooth timeline scrubbing with pre-rendered previews
- **Stack relinking** — re-link inference stacks to different source clips
- **Guide video mode** — multi-image stacks for frame-by-frame guidance
- **Audio-only inference stacks**
- **Export with in/out points**, CRF quality control, and real-time progress
- **Load settings from renders** — restore generation parameters from previously rendered videos
- **Generation metadata embedding** — settings saved into video files via ffmpeg
- **Progress labels** — stage-aware progress ("Generating first frame", "Generating video", "Rediffusing")

## Requirements

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) running and accessible (default: `http://localhost:8188`)
- NVIDIA GPU with sufficient VRAM (16GB+ recommended, 24GB+ for 1080p with upscale)
- LTX model weights (downloaded automatically during first-run setup)

The following custom nodes are installed automatically on first launch:
- [rs-nodes](https://github.com/richservo/rs-nodes) — core generation workflows
- [RES4LYF](https://github.com/ClownsharkBatwing/RES4LYF) — advanced samplers (res_2s, etc.)
- [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite)
- [ComfyUI-RMBG](https://github.com/1038lab/ComfyUI-RMBG) — background removal
- [ComfyUI-Impact-Pack](https://github.com/ltdrdata/ComfyUI-Impact-Pack) — SAM segmentation
- [ComfyUI_essentials](https://github.com/cubiq/ComfyUI_essentials) — utility nodes

## Install

Prerequisites: [Node.js](https://nodejs.org/) (v18+), [Git](https://git-scm.com/), and [ComfyUI](https://github.com/comfyanonymous/ComfyUI) already installed and working.

### Windows (easy)

1. Install [Node.js](https://nodejs.org/) (LTS) and [Git](https://git-scm.com/) if you don't have them
2. Clone this repo (or download ZIP and extract):
   ```
   git clone https://github.com/richservo/Comfy-LTX-Desktop.git
   ```
3. Double-click **`start.bat`** — it installs everything and launches the app

To launch again later, just double-click `start.bat` again.

### Manual / macOS / Linux

```bash
git clone https://github.com/richservo/Comfy-LTX-Desktop.git
cd Comfy-LTX-Desktop
npm install -g pnpm   # if you don't have pnpm
pnpm install
pnpm dev
```

### First launch

On first launch, the setup wizard will:
1. Ask you to accept the LTX-2 Community License
2. Ask you to point to your ComfyUI installation directory
3. Download any missing LTX model weights
4. Auto-install the required custom nodes into ComfyUI

If custom nodes are missing on a subsequent launch (e.g. deleted externally), the app will automatically re-enter setup mode to reinstall them.

> **Note:** ComfyUI must be running before you launch the app (default: `http://localhost:8188`).

## Architecture

Three-layer Electron app:

- **Frontend** (`frontend/`): React 18 + TypeScript + Tailwind CSS
- **Electron** (`electron/`): Main process — IPC handlers, ComfyUI client, workflow builder, ffmpeg integration
- **ComfyUI**: External process — handles all ML inference via the API workflow system

```
Frontend (React) ──IPC──> Electron Main ──HTTP/WS──> ComfyUI
                              │
                         ffmpeg, file I/O
```

### Key components

| Component | Purpose |
|---|---|
| `electron/comfyui/client.ts` | ComfyUI API client (upload, submit, history, download) |
| `electron/comfyui/workflow-builder.ts` | Builds API workflow JSON from generation params |
| `electron/comfyui/workflow-template.json` | Base workflow template with all nodes |
| `electron/comfyui/progress.ts` | WebSocket progress tracking with stage-aware labels |
| `electron/ipc/comfyui-handlers.ts` | IPC handlers for generate, cancel, progress, model lists |
| `electron/ipc/settings-handlers.ts` | Persistent settings (models, inference, ollama, film grain) |
| `frontend/views/Playground.tsx` | Main generation UI |
| `frontend/components/SettingsModal.tsx` | Settings with General, Inference, Models, and About tabs |

## Settings

### Inference (Settings > Inference)

- **Steps** — inference step count (default: 30)
- **CFG Scale** — classifier-free guidance strength
- **Sampler** — noise sampling algorithm (fetched from ComfyUI, default: euler_ancestral)
- **Ollama Prompt Formatter** — toggle + URL/model config

> **Quality tip:** The defaults are tuned for speed. For significantly higher quality, try **30 steps** with **res_2s** sampling (included with rs-nodes, which is auto-installed on first launch). It takes roughly 50% longer but the quality improvement is dramatic.

### Models (Settings > Models)

Dropdowns populated from ComfyUI's `/object_info` API:

- **Checkpoint** — main model (shared across checkpoint loader, text encoder loader, VAE loader)
- **Audio VAE Checkpoint** — can differ from main checkpoint
- **Text Encoder** — text encoding model
- **Spatial Upscaler** / **Temporal Upscaler** — upscale models
- **Upscale LoRA** — LoRA applied during spatial upscale

### Playground controls

- **Resolution**: 540p, 720p, 1080p, 4K (see [4K output](#4k-output) below)
- **Aspect Ratio**: 16:9, 9:16, 1:1, 4:3, 3:4
- **Duration**: video length in seconds
- **FPS**: frame rate
- **Camera Motion**: optional camera movement prompt suffix
- **First/Middle/Last Frame**: optional keyframe images with strength sliders
- **Reference Images**: up to 6 reference images for guided generation
- **Audio**: optional audio input (forces pro model)
- **Spatial Upscale**: 2x resolution with denoise slider (0-1)
- **Temporal Upscale**: 2x frame count
- **Film Grain**: intensity and grain size controls (persistent across sessions)
- **LoRA**: add multiple LoRAs with individual strength sliders

### Image generation

Uses the same LTX pipeline — generates a single latent frame (9 frames minimum) at 1080p, extracts frame 0 as PNG. Quality presets control step count:

- **Fast**: 10 steps
- **Balanced**: 20 steps (default)
- **High**: 40 steps

### 4K output

4K output requires the **RTX Video Super Resolution** custom node. All other resolutions (540p, 720p, 1080p) and features work without it.

When the node is detected in your ComfyUI installation, the 4K option automatically appears in the resolution dropdown. It uses NVIDIA's RTX Video Super Resolution technology to upscale 1080p output to 4K as a post-processing step.

**To install:**

1. Open **ComfyUI Manager** in your ComfyUI browser interface
2. Search for **RTX Video Super Resolution** in the node registry
3. Install it and restart ComfyUI
4. Relaunch LTX Desktop — the 4K option will appear in the resolution dropdown

> **Note:** Requires an NVIDIA RTX GPU.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `M` | Add timeline marker |
| `Delete` | Heal cut (rejoin clips at cut point) |
| `Shift+X` | Fit timeline to view |

## Development

Prerequisites: Node.js, pnpm, Python 3.12+, uv, Git

```bash
# Setup
pnpm setup:dev:win   # Windows
pnpm setup:dev:mac   # macOS

# Run
pnpm dev

# Debug (Electron inspector + Python debugpy)
pnpm dev:debug

# Type check
pnpm typecheck

# Backend tests
pnpm backend:test
```

## Acknowledgments

- [LTX Desktop](https://github.com/Lightricks/LTX-Desktop) by [Lightricks](https://github.com/Lightricks) — the original desktop app this fork is based on
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) by [comfyanonymous](https://github.com/comfyanonymous) — the backend powering all inference
- [RES4LYF](https://github.com/ClownsharkBatwing/RES4LYF) by [ClownsharkBatwing](https://github.com/ClownsharkBatwing) — advanced samplers including res_2s (auto-installed)
- [LTX-Video](https://github.com/Lightricks/LTX-Video) by [Lightricks](https://github.com/Lightricks) — the LTX model architecture

## License

Apache-2.0 — see [`LICENSE.txt`](LICENSE.txt).

Model weights are downloaded separately and may be governed by additional licenses/terms.
