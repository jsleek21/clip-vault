import CONFIG from './config.js';
import { getToken } from './auth.js';

// ── Internal Drive API helper (used only for legacy Drive clips) ──────────────
async function _driveApi(path, opts = {}) {
  const resp = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
  if (!resp.ok) throw new Error(`Drive ${resp.status}: ${await resp.text()}`);
  return resp.status === 204 ? null : resp.json();
}

// ── Video URL resolution ───────────────────────────────────────────────────────

// Is this URL from Google Drive (legacy) rather than R2?
function _isDriveUrl(url) {
  return url && (url.includes('drive.google.com') || url.includes('googleapis.com'));
}

// Is the web app running on the local machine?
function _isLocal() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

// Extract the stored filename from a video URL (last path segment).
// Works for both R2 URLs and legacy Drive URLs; falls back to clip.filename.
function _storedFilename(clip) {
  const url = clip.drive_url;
  if (!url) return clip.filename;
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop());
  } catch {
    return clip.filename;
  }
}

/**
 * Return the best video URL for a clip:
 *   - On localhost → local file server (instant, no network)
 *   - Elsewhere    → R2 public URL (direct HTTP streaming, Range requests work)
 *   - Legacy Drive → falls back to Drive (uses downloadVideoBlob)
 */
export function getVideoUrl(clip) {
  if (_isLocal()) {
    const fname = _storedFilename(clip);
    return `http://localhost:${CONFIG.LOCAL_VIDEO_PORT}/${encodeURIComponent(fname)}`;
  }
  return clip.drive_url ?? null;
}

/** True when the URL can be used as <video src> directly without auth. */
export function isDirectUrl(url) {
  return !!url && !_isDriveUrl(url);
}

// ── Legacy Drive blob download (only needed for old Drive-hosted clips) ───────
const _blobCache = new Map();

export async function downloadVideoBlob(fileId, token) {
  if (_blobCache.has(fileId)) return _blobCache.get(fileId);
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&acknowledgeAbuse=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) throw new Error(`Drive ${resp.status}`);
  const blob = await resp.blob();
  const url  = URL.createObjectURL(blob);
  _blobCache.set(fileId, url);
  console.log(`[blob] cached Drive file ${fileId} (${(blob.size / 1e6).toFixed(1)} MB)`);
  return url;
}

// ── Helpers kept for legacy flow ──────────────────────────────────────────────
export function fileIdFromUrl(webViewLink) {
  return webViewLink?.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? null;
}

export function previewUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

// ── Drive folder helpers (no longer used in main flow, kept for reference) ────
export async function getFolderIdByName(name) {
  const q = encodeURIComponent(
    `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const data = await _driveApi(`files?q=${q}&fields=files(id)&pageSize=1`);
  return data.files[0]?.id ?? null;
}

export async function getOrCreateFolder(name) {
  const id = await getFolderIdByName(name);
  if (id) return id;
  const folder = await _driveApi('files', {
    method: 'POST',
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return folder.id;
}

export async function renameAndMoveFile(fileId, newName, fromFolderId, toFolderId) {
  const params = new URLSearchParams({
    addParents: toFolderId, removeParents: fromFolderId, fields: 'id,name,webViewLink',
  });
  return _driveApi(`files/${fileId}?${params}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: newName }),
  });
}
