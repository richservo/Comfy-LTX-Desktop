"""
Transcribe audio using faster-whisper.
Auto-installs faster-whisper if not present.

Usage: python transcribe.py <audio_file_path> [model_size]
Outputs JSON: {"text": "transcription...", "error": null}
"""
import sys
import os
import json
import subprocess


def _setup_cuda():
    """Import torch to initialize CUDA DLL search paths before faster-whisper."""
    try:
        import torch  # noqa: F401 — importing torch registers its DLL directory
    except ImportError:
        pass


def ensure_faster_whisper():
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "faster-whisper"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True


def transcribe(audio_path: str, model_size: str = "base") -> dict:
    try:
        _setup_cuda()
        ensure_faster_whisper()
        from faster_whisper import WhisperModel

        # Try CUDA first, fall back to CPU if CUDA libs are missing
        try:
            model = WhisperModel(model_size, device="cuda", compute_type="float16")
        except Exception:
            model = WhisperModel(model_size, device="cpu", compute_type="int8")

        segments, _info = model.transcribe(audio_path, beam_size=5)
        text = " ".join(seg.text.strip() for seg in segments)
        return {"text": text, "error": None}
    except Exception as e:
        return {"text": None, "error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"text": None, "error": "Usage: transcribe.py <audio_path> [model_size]"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "base"
    result = transcribe(audio_path, model_size)
    print(json.dumps(result))
