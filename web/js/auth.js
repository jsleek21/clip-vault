import CONFIG from './config.js';

let _tokenClient = null;
let _token  = null;
let _expiry = 0;

const STORE_KEY = 'cv_auth';   // { token, expiry, email }

function waitForGIS() {
  return new Promise((resolve) => {
    if (typeof google !== 'undefined') return resolve();
    const prev = window.onGoogleLibraryLoad;
    window.onGoogleLibraryLoad = () => {
      if (typeof prev === 'function') prev();
      resolve();
    };
  });
}

export async function initAuth() {
  await waitForGIS();
  if (_tokenClient) return;
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    callback: () => {},
  });
}

// Restore a previously cached token from localStorage without any GIS call.
// Returns true if a valid cached token was found and restored.
export function restoreCachedToken() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (stored && stored.token && Date.now() < stored.expiry) {
      _token  = stored.token;
      _expiry = stored.expiry;
      return true;
    }
  } catch {}
  return false;
}

// Interactive sign-in — opens the GIS popup (user-initiated only).
// Caches the token in localStorage afterwards.
export function requestToken() {
  return new Promise((resolve, reject) => {
    if (_token && Date.now() < _expiry) return resolve(_token);

    _tokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error));
      _token  = resp.access_token;
      _expiry = Date.now() + (resp.expires_in - 60) * 1000;
      // Persist so the next page load can restore without a popup
      try {
        const stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        localStorage.setItem(STORE_KEY, JSON.stringify({
          ...stored,
          token:  _token,
          expiry: _expiry,
        }));
      } catch {}
      resolve(_token);
    };

    _tokenClient.requestAccessToken({ prompt: '' });
  });
}

export const getToken   = () => _token;
export const isSignedIn = () => !!_token && Date.now() < _expiry;

export async function getUserEmail() {
  if (!_token) return null;
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${_token}` },
    });
    const data = await resp.json();
    // Cache email alongside the token
    if (data.email) {
      try {
        const stored = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        localStorage.setItem(STORE_KEY, JSON.stringify({ ...stored, email: data.email }));
      } catch {}
    }
    return data.email ?? null;
  } catch {
    return null;
  }
}
