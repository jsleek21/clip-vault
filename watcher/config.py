import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env", override=True)


class Config:
    # ── Folders ───────────────────────────────────────────────────
    WATCH_FOLDER = Path(os.getenv("WATCH_FOLDER", r"C:\Users\wildc\Videos\clips"))
    # Processed _cv.mp4 files are moved here after upload so the watch
    # folder stays clean.  The local HTTP server serves from this folder.
    CLIPS_FOLDER = Path(os.getenv("CLIPS_FOLDER",
                                  str(Path(os.getenv("WATCH_FOLDER",
                                                     r"C:\Users\wildc\Videos\clips")).parent
                                      / "clips_served")))

    # ── ffmpeg ────────────────────────────────────────────────────
    FFMPEG_PATH = os.getenv("FFMPEG_PATH", "ffmpeg")

    # ── Supabase ──────────────────────────────────────────────────
    SUPABASE_URL      = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")

    # ── Cloudflare R2 ─────────────────────────────────────────────
    R2_ACCOUNT_ID      = os.getenv("R2_ACCOUNT_ID", "")
    R2_ACCESS_KEY_ID   = os.getenv("R2_ACCESS_KEY_ID", "")
    R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
    R2_BUCKET_NAME     = os.getenv("R2_BUCKET_NAME", "clipvault")
    # Public URL for the bucket — either the r2.dev subdomain or your custom domain.
    # e.g. https://pub-abc123.r2.dev  or  https://clips.yourdomain.com
    R2_PUBLIC_URL      = os.getenv("R2_PUBLIC_URL", "")

    # ── Local video server ────────────────────────────────────────
    LOCAL_VIDEO_PORT = int(os.getenv("LOCAL_VIDEO_PORT", "7432"))

    # ── Transcription (faster-whisper, runs locally) ──────────────
    # Model size: tiny / base / small / medium / large-v3
    # small is a good balance of speed and accuracy; medium for better results
    WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")

    # ── Legacy (no longer used, kept so old .env files don't crash) ──
    GOOGLE_CREDENTIALS_FILE = os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json")
    DELETE_MP4_AFTER_UPLOAD = False  # files are moved to CLIPS_FOLDER, never deleted
