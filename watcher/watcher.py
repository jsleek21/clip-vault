"""
Clip Vault – local watcher
Watches a folder for new .mkv / .mp4 files, re-encodes to H.264 MP4 via
ffmpeg, uploads to Cloudflare R2, then serves the processed files over a
tiny local HTTP server so the web tagger loads instantly.
"""

import http.server
import os
import queue
import shutil
import threading
import time
from pathlib import Path

try:
    import pystray
    from PIL import Image, ImageDraw
    _TRAY_AVAILABLE = True
except ImportError:
    _TRAY_AVAILABLE = False

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from config import Config
from r2_uploader import R2Uploader
from remuxer import extract_thumbnail_b64, get_duration, process_to_mp4
from supabase_writer import clip_exists, insert_pending_clip


# ---------------------------------------------------------------------------
# Local HTTP file server (serves processed clips to the web tagger)
# ---------------------------------------------------------------------------

class _VideoHandler(http.server.SimpleHTTPRequestHandler):
    """Serve files from CLIPS_FOLDER with CORS + Range-request support."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Config.CLIPS_FOLDER), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range")
        self.send_header("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, fmt, *args):
        pass  # silence per-request logs


def _start_video_server() -> http.server.HTTPServer:
    Config.CLIPS_FOLDER.mkdir(parents=True, exist_ok=True)
    server = http.server.HTTPServer(("127.0.0.1", Config.LOCAL_VIDEO_PORT), _VideoHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"[ClipVault] Local video server → http://localhost:{Config.LOCAL_VIDEO_PORT}/")
    return server


# ---------------------------------------------------------------------------
# File-system watcher
# ---------------------------------------------------------------------------

class ClipHandler(FileSystemEventHandler):
    def __init__(self, job_queue: queue.Queue):
        self._queue = job_queue
        self._seen: set[str] = set()

    def _enqueue(self, path: str):
        if path.lower().endswith((".mkv", ".mp4")) and path not in self._seen:
            self._seen.add(path)
            self._queue.put(path)

    def on_created(self, event):
        if not event.is_directory:
            self._enqueue(event.src_path)

    def on_moved(self, event):
        if not event.is_directory:
            self._enqueue(event.dest_path)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def wait_for_stable(path: str, stable_secs: float = 2.0, timeout: float = 300.0) -> bool:
    """Block until the file size stops changing (write finished) or timeout."""
    deadline = time.monotonic() + timeout
    last_size = -1
    stable_since: float | None = None

    while time.monotonic() < deadline:
        try:
            size = os.path.getsize(path)
        except OSError:
            time.sleep(1)
            continue

        if size == last_size:
            if stable_since is None:
                stable_since = time.monotonic()
            elif time.monotonic() - stable_since >= stable_secs:
                return True
        else:
            last_size = size
            stable_since = None

        time.sleep(1)

    return False


# ---------------------------------------------------------------------------
# Background worker
# ---------------------------------------------------------------------------

def worker(job_queue: queue.Queue, uploader: R2Uploader, set_status):
    while True:
        src_path = job_queue.get()
        if src_path is None:
            break

        stem = Path(src_path).stem
        name = Path(src_path).name

        try:
            set_status(f"Waiting  {name}")
            if not wait_for_stable(src_path):
                set_status(f"Timeout  {name}")
                continue

            if clip_exists(stem):
                set_status(f"Skip (exists)  {name}")
                print(f"[ClipVault] Skipping {name} — already in database")
                continue

            set_status(f"Encoding  {name}")
            mp4_path = process_to_mp4(src_path)
            if not mp4_path:
                set_status("Encode failed")
                continue

            duration      = get_duration(mp4_path)
            thumbnail_url = extract_thumbnail_b64(mp4_path)

            set_status(f"Uploading  {Path(mp4_path).name}")
            r2_url = uploader.upload(mp4_path)

            # Move processed file to CLIPS_FOLDER so local server can serve it.
            # Do this regardless of upload success so local playback always works.
            Config.CLIPS_FOLDER.mkdir(parents=True, exist_ok=True)
            dest = Config.CLIPS_FOLDER / Path(mp4_path).name
            shutil.move(mp4_path, dest)

            if r2_url:
                insert_pending_clip(Path(dest).name, r2_url, duration, thumbnail_url)
                set_status(f"Done  {dest.name}")
            else:
                set_status("Upload failed — saved locally only")

        except Exception as exc:
            set_status(f"Error: {exc}")
            print(f"[ClipVault] Worker error: {exc}")
        finally:
            job_queue.task_done()


# ---------------------------------------------------------------------------
# System-tray icon
# ---------------------------------------------------------------------------

def _make_icon():
    img = Image.new("RGB", (64, 64), (20, 20, 20))
    d = ImageDraw.Draw(img)
    d.rectangle([6, 14, 58, 50], fill=(0, 140, 255), outline=(255, 255, 255), width=2)
    d.polygon([(20, 20), (20, 44), (48, 32)], fill=(255, 255, 255))
    return img


def _run_with_tray(observer, job_queue, set_status, _status):
    def on_quit(icon, _item):
        job_queue.put(None)
        observer.stop()
        icon.stop()

    icon = pystray.Icon(
        "ClipVault",
        _make_icon(),
        "Clip Vault",
        menu=pystray.Menu(
            pystray.MenuItem(lambda _: _status["text"], action=None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", on_quit),
        ),
    )
    icon.run()


def _run_headless(observer, job_queue, set_status):
    print("[ClipVault] Running in console mode. Press Ctrl+C to stop.")
    try:
        while observer.is_alive():
            time.sleep(1)
    except KeyboardInterrupt:
        print("[ClipVault] Stopping…")
    finally:
        job_queue.put(None)
        observer.stop()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    Config.WATCH_FOLDER.mkdir(parents=True, exist_ok=True)
    Config.CLIPS_FOLDER.mkdir(parents=True, exist_ok=True)

    _start_video_server()

    uploader = R2Uploader()
    job_queue: queue.Queue[str | None] = queue.Queue()

    _status = {"text": "Idle"}

    def set_status(msg: str):
        _status["text"] = msg
        print(f"[ClipVault] {msg}")

    threading.Thread(target=worker, args=(job_queue, uploader, set_status), daemon=True).start()

    handler = ClipHandler(job_queue)
    observer = Observer()
    observer.schedule(handler, str(Config.WATCH_FOLDER), recursive=False)
    observer.start()
    set_status(f"Watching {Config.WATCH_FOLDER}")

    # Queue any clips already in the watch folder at startup
    existing = (list(Config.WATCH_FOLDER.glob("*.mkv"))
                + list(Config.WATCH_FOLDER.glob("*.mp4")))
    if existing:
        set_status(f"Found {len(existing)} existing file(s) — queuing…")
        for p in existing:
            handler._enqueue(str(p))

    if _TRAY_AVAILABLE:
        _run_with_tray(observer, job_queue, set_status, _status)
    else:
        _run_headless(observer, job_queue, set_status)

    observer.join()


if __name__ == "__main__":
    main()
