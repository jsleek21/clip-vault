"""
Transcribes a video clip using faster-whisper (runs fully locally, no API key).
Audio is extracted to a small mono WAV first via ffmpeg.

The WhisperModel is loaded once and reused for all clips in the session.
First run will download the model weights (~500 MB for 'small').
"""

import subprocess
import tempfile
from pathlib import Path

from config import Config

_model = None  # loaded lazily on first transcription


def _get_model():
    global _model
    if _model is None:
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            print("[Transcribe] faster-whisper not installed — run: pip install faster-whisper")
            return None
        print(f"[Transcribe] Loading Whisper model '{Config.WHISPER_MODEL}' (first run downloads weights)…")
        _model = WhisperModel(Config.WHISPER_MODEL, device="cpu", compute_type="int8")
        print("[Transcribe] Model ready.")
    return _model


def transcribe(mp4_path: str) -> str | None:
    """Return the transcript text for the given MP4, or None on failure."""
    model = _get_model()
    if model is None:
        return None

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    audio_path = tmp.name
    tmp.close()

    try:
        # Extract mono 16kHz WAV — optimal format for Whisper
        proc = subprocess.run(
            [
                Config.FFMPEG_PATH, "-y",
                "-i", mp4_path,
                "-vn",
                "-ac", "1",
                "-ar", "16000",
                "-f", "wav",
                audio_path,
            ],
            capture_output=True,
            timeout=120,
        )
        if proc.returncode != 0:
            print(f"[Transcribe] ffmpeg failed: {proc.stderr.decode(errors='replace')[:200]}")
            return None

        print(f"[Transcribe] Transcribing {Path(mp4_path).name}…")
        segments, _ = model.transcribe(audio_path, beam_size=5)
        text = " ".join(seg.text.strip() for seg in segments).strip()

        if text:
            print(f"[Transcribe] {len(text)} chars — {text[:80]}{'…' if len(text) > 80 else ''}")
        else:
            print("[Transcribe] No speech detected.")

        return text or None

    except Exception as exc:
        print(f"[Transcribe] Error: {exc}")
        return None
    finally:
        Path(audio_path).unlink(missing_ok=True)
