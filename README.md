# Comfy LTX Desktop

A desktop app for AI video and image generation using LTX models via ComfyUI. Fork of [LTX Desktop](https://github.com/Lightricks/LTX-Desktop) rebuilt around a ComfyUI backend instead of a standalone Python server.

> **Status: Beta.** Expect breaking changes.

## Features

- **Text-to-video** generation via ComfyUI
- **Image-to-video** generation with first/last frame support and per-frame strength controls
- **Text-to-image** generation (single latent frame extraction at full 1080p resolution)
- **Audio-to-video** generation
- **Video retake** (re-generate sections of existing video)
- **Spatial upscale** (2x resolution) with configurable denoise strength
- **Temporal upscale** (2x frame count)
- **Film grain** post-processing with persistent settings
- **Ollama prompt formatter** — local LLM reformats prompts into optimized tag format with positive/negative generation
- **Model selector dropdowns** — choose checkpoint, text encoder, VAE, upscalers, and LoRA from what's installed in ComfyUI
- **Sampler selection** — all samplers available in your ComfyUI install (including custom ones like res samplers)
- **Generation metadata embedding** — settings saved into video files via ffmpeg, loadable for re-use
- **Progress labels** — stage-aware progress ("Generating first frame", "Generating video", "Rediffusing")
- **Video Editor** with timeline, gap-fill, and project management

## Requirements

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) running and accessible (default: `http://localhost:8188`)
- NVIDIA GPU with sufficient VRAM (16GB+ recommended, 24GB+ for 1080p with upscale)
- LTX model weights (downloaded automatically during first-run setup)

The required [rs-nodes](https://github.com/richservo/rs-nodes) custom nodes are installed automatically on first launch.

## Install

1. Download the latest release from [Releases](../../releases), or run from source (see Development below)
2. Install and launch
3. First-run setup will guide you through pointing to your ComfyUI installation
4. Missing model weights can be downloaded during setup

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

- **Resolution**: 540p, 720p, 1080p
- **Aspect Ratio**: 16:9, 9:16, 1:1, 4:3, 3:4
- **Duration**: video length in seconds
- **FPS**: frame rate
- **Camera Motion**: optional camera movement prompt suffix
- **First/Last Frame**: optional keyframe images with strength sliders
- **Audio**: optional audio input (forces pro model)
- **Spatial Upscale**: 2x resolution with denoise slider (0-1)
- **Temporal Upscale**: 2x frame count
- **Film Grain**: intensity and grain size controls (persistent across sessions)

### Image generation

Uses the same LTX pipeline — generates a single latent frame (9 frames minimum) at 1080p, extracts frame 0 as PNG. Quality presets control step count:

- **Fast**: 10 steps
- **Balanced**: 20 steps (default)
- **High**: 40 steps

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
