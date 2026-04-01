# Plan: LTX-Desktop + ComfyUI Integration (Direct Electron → ComfyUI)

## Context

LTX-Desktop is a Lightricks Electron + React desktop app for video generation. It has a FastAPI Python backend (localhost:8000) that runs LTX models directly. The goal is to replace the Python backend entirely — the Electron main process talks directly to ComfyUI's API, using the RSLTXVGenerate workflow as the engine. This gives us the nice desktop UI with all our ComfyUI optimizations (temporal upscale, IC-LoRA, audio, 16GB VRAM support).

**Project location:** `/mnt/e/Python/LTX-Desktop`
**RS Nodes location:** `/mnt/c/Users/Richard/Documents/ComfyUI/custom_nodes/rs_nodes/`

## Architecture

```
React Frontend (renderer)
    ↓ IPC (window.electronAPI)
Electron Main Process (ComfyUI client + workflow builder)
    ↓ HTTP + WebSocket (configured ComfyUI URL)
ComfyUI (local or remote)
```

No Python backend. The Electron main process handles workflow building, image upload, progress tracking, and output retrieval directly.

## Scope

### In scope (Phase 1)
- T2V (text-to-video) via ComfyUI
- I2V (image-to-video, first_image) via ComfyUI
- Progress tracking via ComfyUI WebSocket
- Cancel generation
- Health check (ComfyUI alive?)
- Simplified settings (stored locally by Electron)

### Deferred (Phase 2+)
- Middle/last image upload UI slots
- Audio-to-video
- Retake feature
- Text-to-image (removed — user generates externally)

## Implementation

### Electron Layer (New)

#### `electron/comfyui/client.ts` — ComfyUI REST client
- `submitWorkflow(workflow, clientId)` → POST `/prompt` → returns `promptId`
- `uploadImage(filePath)` → POST `/upload/image` (multipart) → returns `{name, subfolder, type}`
- `getHistory(promptId)` → GET `/history/{promptId}` → returns outputs
- `cancel(promptId)` → POST `/queue` with `{delete: [promptId]}`
- `checkHealth()` → GET `/system_stats` → returns boolean
- Configurable `comfyuiUrl` (default `http://localhost:8188`)
- Accepts full URLs or bare `host:port` input, normalizes to HTTP, and probes the exact configured URL before any localhost fallback scan

#### `electron/comfyui/progress.ts` — WebSocket progress tracker
- Connects to `ws://localhost:8188/ws?clientId=<uuid>`
- Maps ComfyUI events to `{phase, progress, currentStep, totalSteps}`:
  - `execution_start` → phase: `inference`, progress: 0
  - `progress` → phase: `inference`, progress: `value/max * 100`
  - `execution_complete` → phase: `complete`, progress: 100
  - `execution_error` → stores error
- `getProgress()` returns current state (polled by frontend)
- `waitForCompletion(promptId)` → Promise resolves on complete/error

#### `electron/comfyui/workflow-builder.ts` — Template patching
- Loads `workflow-template.json`
- `buildWorkflow(params)` patches node inputs:
  - `positive_prompt` ← prompt + camera motion
  - `width`, `height` ← resolution + aspect ratio
  - `num_frames` ← duration × fps
  - `frame_rate` ← fps
  - `seed` ← random or locked
  - `first_image` ← uploaded image ref (if I2V)
- LTX 2.3 GGUF path:
  - main model via `UnetLoaderGGUF`
  - video VAE via standalone `VAELoader`
  - audio VAE via `LTXVAudioVAELoader`
  - standalone LTX text loading via `DualCLIPLoader` or `DualCLIPLoaderGGUF` plus embeddings connector

#### `electron/comfyui/workflow-template.json` — Exported workflow
- RSLTXVGenerate workflow exported from ComfyUI in API format
- Manual step: export from ComfyUI UI

#### `electron/ipc/comfyui-handlers.ts` — Generation IPC handlers
| IPC Channel | Replaces | Behavior |
|---|---|---|
| `comfyui:generate` | `POST /api/generate` | Build workflow → upload images → submit → wait → return video path |
| `comfyui:progress` | `GET /api/generation/progress` | Return cached WebSocket progress |
| `comfyui:cancel` | `POST /api/generate/cancel` | Cancel via ComfyUI queue API |
| `comfyui:health` | `GET /health` | Check ComfyUI `/system_stats` |

#### `electron/ipc/settings-handlers.ts` — Local settings
Settings stored as `{userData}/comfyui-settings.json`:
- `comfyuiUrl`, `seedLocked`, `lockedSeed`, `steps`, `cfg`, `temporalUpscale`

### Frontend Layer (Modified)

#### `frontend/hooks/use-generation.ts`
- `generate()`: `window.electronAPI.generateVideo(params)` instead of HTTP POST
- Progress polling: `window.electronAPI.getGenerationProgress()` instead of HTTP GET
- `cancel()`: `window.electronAPI.cancelGeneration()` instead of HTTP POST
- Remove `generateImage()` (fal.ai T2I)

#### `frontend/hooks/use-backend.ts`
- `checkHealth()`: `window.electronAPI.checkComfyUIHealth()` instead of HTTP
- Remove model management (ComfyUI handles its own models)
- Remove Python process status tracking

#### `frontend/contexts/AppSettingsContext.tsx`
- Settings via IPC instead of HTTP
- Remove API key management, runtime policy
- Simplified `AppSettings` for ComfyUI-relevant settings only

#### `frontend/hooks/use-retake.ts`
- Stub out — returns "not yet supported" error

#### `frontend/views/GenSpace.tsx`
- Remove T2I mode, API key gating, model download UI

### Removed
- `electron/python-backend.ts` — No longer needed
- `electron/python-setup.ts` — No longer needed
- Python backend references in `electron/main.ts` and `electron/ipc/app-handlers.ts`

## RSLTXVGenerate Node Reference

Key inputs:
- `positive_prompt` (STRING), `negative_prompt` (STRING)
- `first_image` (IMAGE, optional), `middle_image` (IMAGE, optional), `last_image` (IMAGE, optional)
- `width`, `height` (INT), `num_frames` (INT), `frame_rate` (INT)
- `seed` (INT), `steps` (INT), `cfg` (FLOAT)
- `temporal_upscale` (BOOLEAN)

Output: VIDEO

## ComfyUI API Reference

### Submit workflow
```
POST http://localhost:8188/prompt
Body: {"prompt": <workflow_json>, "client_id": "<uuid>"}
Response: {"prompt_id": "<uuid>"}
```

### Upload image
```
POST http://localhost:8188/upload/image
Body: multipart form with "image" file field
Response: {"name": "filename.png", "subfolder": "", "type": "input"}
```

### Get history (outputs)
```
GET http://localhost:8188/history/{prompt_id}
Response: {prompt_id: {"outputs": {node_id: {"videos": [{"filename": "...", "subfolder": "...", "type": "output"}]}}}}
```

### Cancel/delete from queue
```
POST http://localhost:8188/queue
Body: {"delete": [prompt_id]}
```

### System stats
```
GET http://localhost:8188/system_stats
```

### WebSocket progress
```
ws://localhost:8188/ws?clientId=<uuid>
Messages:
  {"type": "status", "data": {"status": {"exec_info": {"queue_remaining": N}}}}
  {"type": "execution_start", "data": {"prompt_id": "..."}}
  {"type": "executing", "data": {"node": "node_id", "prompt_id": "..."}}
  {"type": "progress", "data": {"value": N, "max": M, "prompt_id": "..."}}
  {"type": "executed", "data": {"node": "node_id", "output": {...}, "prompt_id": "..."}}
  {"type": "execution_complete", "data": {"prompt_id": "..."}}
  {"type": "execution_error", "data": {"prompt_id": "...", "exception_message": "..."}}
```

## Verification

1. Start ComfyUI and confirm the configured ComfyUI URL is reachable
2. Start LTX-Desktop (`pnpm dev`)
3. App shows "Connected" (health check passes)
4. Enter text prompt → ComfyUI generates video
5. Progress bar updates during generation
6. Output video plays in the app
7. Cancel mid-generation works
8. I2V with first image works
9. `pnpm typecheck:ts` passes
