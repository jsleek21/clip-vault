import base64
import contextlib
import json
import os
import subprocess
import tempfile
from pathlib import Path
from config import Config


def _ffprobe(path: str) -> dict:
    cmd = [
        Config.FFMPEG_PATH.replace("ffmpeg", "ffprobe"),
        "-v", "quiet", "-print_format", "json",
        "-show_streams", "-show_format",
        str(path),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except Exception:
        return {}


def get_duration(path: str) -> int | None:
    """Return duration in whole seconds via ffprobe, or None on failure."""
    info = _ffprobe(path)
    try:
        return int(float(info["format"]["duration"]))
    except (KeyError, ValueError):
        return None


def get_video_codec(path: str) -> str | None:
    """Return the video codec name (e.g. 'h264', 'hevc') or None."""
    info = _ffprobe(path)
    for stream in info.get("streams", []):
        if stream.get("codec_type") == "video":
            return stream.get("codec_name")
    return None


def process_to_mp4(src_path: str) -> str | None:
    """
    Convert any video file to a web-ready H.264 MP4 with faststart.

    - If the source is already H.264 and is already an .mp4, just ensure
      faststart by doing a fast remux (stream copy + faststart flag).
    - Otherwise re-encode the video track to H.264 (tries NVENC first for
      speed, falls back to libx264).  Audio is always re-encoded to AAC.

    Returns the path to the output .mp4, or None on failure.
    """
    src  = Path(src_path)
    dst  = src.with_stem(src.stem + "_cv").with_suffix(".mp4")

    codec = get_video_codec(src_path)
    print(f"[remuxer] source codec: {codec}")

    already_h264 = (codec == "h264" and src.suffix.lower() == ".mp4")

    if already_h264:
        # Fast path: stream-copy video, just fix container / faststart
        cmd = [
            Config.FFMPEG_PATH,
            "-i", str(src),
            "-map", "0",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k", "-ac", "2",
            "-movflags", "+faststart",
            "-y", str(dst),
        ]
        print("[remuxer] H.264 source — fast remux (stream copy)")
    else:
        # Re-encode to H.264 so Drive can play it without transcoding.
        # Try NVENC (GPU) first — much faster on machines with an NVIDIA GPU.
        # Falls back to libx264 (CPU) if NVENC isn't available.
        for vcodec, label in [("h264_nvenc", "NVENC"), ("libx264", "libx264")]:
            extra = (
                ["-rc:v", "vbr", "-cq:v", "24", "-preset", "p4"]
                if vcodec == "h264_nvenc"
                else ["-crf", "23", "-preset", "fast"]
            )
            cmd = [
                Config.FFMPEG_PATH,
                "-i", str(src),
                "-map", "0:v:0",        # first video track only
                "-map", "0:a?",         # all audio tracks (optional)
                "-c:v", vcodec, *extra,
                "-c:a", "aac", "-b:a", "192k", "-ac", "2",
                "-movflags", "+faststart",
                "-y", str(dst),
            ]
            print(f"[remuxer] encoding to H.264 via {label}…")
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                print(f"[remuxer] done ({label})")
                return str(dst)
            # NVENC failed — try next option
            print(f"[remuxer] {label} failed, trying next…")
        print(f"[remuxer] all encoders failed\n{result.stderr[-2000:]}")
        return None

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[remuxer] FAILED\n{result.stderr[-2000:]}")
        return None
    return str(dst)


# Keep old name as alias so nothing else breaks
def remux_to_mp4(mkv_path: str) -> str | None:
    return process_to_mp4(mkv_path)


def extract_thumbnail_b64(mp4_path: str, time_secs: int = 3) -> str | None:
    """
    Extract a single frame at time_secs and return as a base64 JPEG data URL.
    """
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        thumb_path = f.name
    try:
        cmd = [
            Config.FFMPEG_PATH,
            "-y",
            "-ss", str(time_secs),
            "-i", str(mp4_path),
            "-vframes", "1",
            "-vf", "scale=400:-2",
            "-q:v", "5",
            thumb_path,
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=20)
        if result.returncode == 0 and os.path.getsize(thumb_path) > 0:
            with open(thumb_path, "rb") as f:
                return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()
    except Exception as exc:
        print(f"[thumbnail] {exc}")
    finally:
        with contextlib.suppress(Exception):
            os.unlink(thumb_path)
    return None
