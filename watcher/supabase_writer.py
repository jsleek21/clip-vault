import json
import urllib.parse
import urllib.request
import urllib.error
from datetime import date
from pathlib import Path

from config import Config


def clip_exists(stem: str) -> bool:
    """
    Return True if a clip whose filename starts with `stem` already exists
    in Supabase.  Catches both untagged originals ({stem}_cv.mp4) and any
    renamed/tagged version that still contains the stem.
    Skips the check and returns False if Supabase isn't configured.
    """
    if not Config.SUPABASE_URL or not Config.SUPABASE_ANON_KEY:
        return False
    try:
        # Use ilike (case-insensitive LIKE) to match filenames that start with stem
        q   = urllib.parse.quote(f"{stem}%")
        url = (
            f"{Config.SUPABASE_URL.rstrip('/')}/rest/v1/clips"
            f"?filename=ilike.{q}&select=id&limit=1"
        )
        req = urllib.request.Request(
            url,
            headers={
                "apikey":        Config.SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {Config.SUPABASE_ANON_KEY}",
            },
        )
        with urllib.request.urlopen(req) as resp:
            rows = json.loads(resp.read())
            return len(rows) > 0
    except Exception as exc:
        print(f"[Supabase] clip_exists check failed: {exc}")
        return False   # if we can't check, allow the upload


def insert_pending_clip(
    filename: str,
    drive_url: str,
    duration: int | None,
    thumbnail_url: str | None = None,
) -> str | None:
    """
    Insert a pending (untagged) clip row into Supabase.
    Returns the new row's UUID, or None on failure.
    The web tagger will later UPDATE this row with game/categories/description.
    """
    if not Config.SUPABASE_URL or not Config.SUPABASE_ANON_KEY:
        print("[Supabase] SUPABASE_URL or SUPABASE_ANON_KEY not set — skipping DB insert")
        return None

    payload = {
        "filename": filename,
        "date": date.today().isoformat(),
        "game": "",
        "categories": [],
        "description": "",
        "drive_url": drive_url,
        "duration": duration,
        "thumbnail_url": thumbnail_url,
        "tagged_by": None,
        "notes": None,
    }

    url = f"{Config.SUPABASE_URL.rstrip('/')}/rest/v1/clips"
    data = json.dumps(payload).encode()

    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": Config.SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {Config.SUPABASE_ANON_KEY}",
            "Prefer": "return=representation",
        },
    )

    try:
        with urllib.request.urlopen(req) as resp:
            rows = json.loads(resp.read())
            row_id = rows[0]["id"] if rows else None
            print(f"[Supabase] Inserted clip row {row_id} for {filename}")
            return row_id
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        print(f"[Supabase] HTTP {exc.code}: {body}")
    except Exception as exc:
        print(f"[Supabase] Error: {exc}")

    return None
