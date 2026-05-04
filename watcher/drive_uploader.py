import os
import pickle
from pathlib import Path

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

SCOPES = ["https://www.googleapis.com/auth/drive.file"]
TOKEN_PATH = "token.pickle"


class DriveUploader:
    def __init__(self, config):
        self.config = config
        self.service = self._authenticate()
        self.inbox_folder_id = self._get_or_create_inbox()

    def _authenticate(self):
        creds = None
        if os.path.exists(TOKEN_PATH):
            with open(TOKEN_PATH, "rb") as f:
                creds = pickle.load(f)
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(
                    self.config.GOOGLE_CREDENTIALS_FILE, SCOPES
                )
                creds = flow.run_local_server(port=0)
            with open(TOKEN_PATH, "wb") as f:
                pickle.dump(creds, f)
        return build("drive", "v3", credentials=creds)

    def _get_or_create_inbox(self) -> str:
        query = (
            "name='inbox' and "
            "mimeType='application/vnd.google-apps.folder' and "
            "trashed=false"
        )
        results = (
            self.service.files()
            .list(q=query, fields="files(id,name)", pageSize=1)
            .execute()
        )
        files = results.get("files", [])
        if files:
            return files[0]["id"]

        folder = (
            self.service.files()
            .create(
                body={
                    "name": "inbox",
                    "mimeType": "application/vnd.google-apps.folder",
                },
                fields="id",
            )
            .execute()
        )
        return folder["id"]

    def upload(self, mp4_path: str) -> str | None:
        """Upload mp4 to Drive /inbox/, make publicly readable, return webViewLink."""
        name = Path(mp4_path).name
        media = MediaFileUpload(mp4_path, mimetype="video/mp4", resumable=True)

        uploaded = (
            self.service.files()
            .create(
                body={"name": name, "parents": [self.inbox_folder_id]},
                media_body=media,
                fields="id,webViewLink",
            )
            .execute()
        )

        self.service.permissions().create(
            fileId=uploaded["id"],
            body={"role": "reader", "type": "anyone"},
        ).execute()

        return uploaded.get("webViewLink")
