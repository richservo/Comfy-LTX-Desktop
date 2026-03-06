// Python backend — disabled in ComfyUI integration (ComfyUI replaces the Python backend)
export function getPythonPath(): string { return '' }
export function startPythonBackend(): void { /* no-op */ }
export function stopPythonBackend(): void { /* no-op */ }
export function isPythonReady(): boolean { return false }
