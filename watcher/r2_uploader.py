"""
Cloudflare R2 uploader (S3-compatible API via boto3).
Replaces drive_uploader.py — no OAuth dance, just a key pair.
"""

from pathlib import Path

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from config import Config


class R2Uploader:
    def __init__(self):
        self._client = boto3.client(
            "s3",
            endpoint_url=f"https://{Config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
            aws_access_key_id=Config.R2_ACCESS_KEY_ID,
            aws_secret_access_key=Config.R2_SECRET_ACCESS_KEY,
            region_name="auto",
        )

    def upload(self, mp4_path: str) -> str | None:
        """Upload mp4 to R2 and return its public URL, or None on failure."""
        name = Path(mp4_path).name
        try:
            self._client.upload_file(
                mp4_path,
                Config.R2_BUCKET_NAME,
                name,
                ExtraArgs={"ContentType": "video/mp4"},
            )
            url = f"{Config.R2_PUBLIC_URL.rstrip('/')}/{name}"
            print(f"[R2] Uploaded {name} → {url}")
            return url
        except (BotoCoreError, ClientError) as exc:
            print(f"[R2] Upload failed for {name}: {exc}")
            return None
