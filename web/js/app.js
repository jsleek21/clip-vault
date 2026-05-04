import { getToken } from './auth.js';
import {
  fetchUntaggedClips, fetchTaggedClips, updateClip, deleteClip,
  fetchDescriptions, fetchTaxonomy, createTaxonomyItem,
} from './supabase-client.js';
import {
  fileIdFromUrl, getVideoUrl, isDirectUrl, downloadVideoBlob,
} from './drive.js';
import { searchClips } from './claude-search.js';

// ── State ──────────────────────────────────────────────────────────────────────
const state = {
  view:         'inbox',
  untagged:     [],
  tagged:       [],
  taxonomy:     [],       // flat: [{id, name, parent_id, sort_order, color}]
  activeClip:   null,
  selectedCats: new Set(),
  tags:         [],       // free-form tag strings
  libraryFilter: '',
  descSlugs:    [],
};

const $ = (id) => document.getElementById(id);

// ── View management ────────────────────────────────────────────────────────────
function switchView(name) {
  state.view = name;
  document.querySelectorAll('.view').forEach((el) => el.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });
  $(`${name}-view`).classList.remove('hidden');
  if (name === 'library') loadLibrary();
}

// ── User avatar ────────────────────────────────────────────────────────────────
function initUserAvatar(email) {
  const btn   = $('user-btn');
  const popup = $('user-email-popup');
  btn.textContent  = (email?.[0] ?? '?').toUpperCase();
  popup.textContent = email ?? '';
  btn.classList.remove('hidden');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    popup.classList.toggle('hidden');
  });
  document.addEventListener('click', () => popup.classList.add('hidden'));
}

// ── Taxonomy helpers ───────────────────────────────────────────────────────────
function getTaxTree() {
  const map   = {};
  const roots = [];
  for (const t of state.taxonomy) map[t.id] = { ...t, children: [] };
  for (const t of state.taxonomy) {
    if (t.parent_id) map[t.parent_id]?.children.push(map[t.id]);
    else roots.push(map[t.id]);
  }
  return roots;
}

// ── Color helpers ─────────────────────────────────────────────────────────────
function applyChipColor(el, color, active) {
  if (!color) return;
  if (active) {
    el.style.background   = color;
    el.style.borderColor  = color;
    el.style.color        = '#fff';
  } else {
    el.style.background   = color + '18';
    el.style.borderColor  = color + '70';
    el.style.color        = color;
  }
}

function catColor(name) {
  return state.taxonomy.find((t) => t.name === name && !t.parent_id)?.color ?? null;
}

function tagStyle(name, isSubcat) {
  const color = isSubcat
    ? (() => {
        const sub    = state.taxonomy.find((t) => t.name === name && t.parent_id);
        const parent = sub ? state.taxonomy.find((t) => t.id === sub.parent_id) : null;
        return sub?.color || parent?.color || null;
      })()
    : catColor(name);
  if (!color) return '';
  return ` style="background:${color}18;color:${color};border-color:${color}50"`;
}

// ── Category rendering (single-select) ────────────────────────────────────────
function renderCategorySection() {
  const tree    = getTaxTree();
  const chipsEl = $('category-chips');
  chipsEl.innerHTML = '';

  for (const cat of tree) {
    const active = state.selectedCats.has(cat.name);
    const btn = document.createElement('button');
    btn.className   = 'chip' + (active ? ' active' : '');
    btn.textContent = cat.name;
    applyChipColor(btn, cat.color, active);
    btn.addEventListener('click', () => {
      state.selectedCats.has(cat.name)
        ? state.selectedCats.delete(cat.name)
        : state.selectedCats.add(cat.name);
      renderCategorySection();
    });
    chipsEl.appendChild(btn);
  }

  syncConfirmBtn();
}

// ── Free-form tag input ────────────────────────────────────────────────────────
function renderTagInput() {
  const area = $('tag-input-area');
  area.innerHTML = '';

  for (const tag of state.tags) {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    const txt = document.createElement('span');
    txt.className   = 'tag-text';
    txt.textContent = tag;
    const rm = document.createElement('button');
    rm.className   = 'tag-remove';
    rm.textContent = '×';
    rm.title       = 'Remove';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      state.tags = state.tags.filter((t) => t !== tag);
      renderTagInput();
      area.querySelector('.tag-text-input')?.focus();
    });
    pill.appendChild(txt);
    pill.appendChild(rm);
    area.appendChild(pill);
  }

  const input = document.createElement('input');
  input.type        = 'text';
  input.className   = 'tag-text-input';
  input.placeholder = state.tags.length ? '' : 'e.g. KingdomHearts, faceswap-edits…';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.trim().replace(/,$/, '');
      if (val && !state.tags.includes(val)) {
        state.tags.push(val);
        renderTagInput();
        area.querySelector('.tag-text-input')?.focus();
      } else {
        input.value = '';
      }
    } else if (e.key === 'Backspace' && input.value === '' && state.tags.length) {
      state.tags.pop();
      renderTagInput();
      area.querySelector('.tag-text-input')?.focus();
    }
  });
  area.appendChild(input);

  // Clicking the container focuses the input
  area.addEventListener('click', () => input.focus(), { once: true });
}

// ── Thumbnail helpers ──────────────────────────────────────────────────────────
// Derive a consistent hue (0-359) from a string so every clip gets a unique
// gradient placeholder when a real thumbnail isn't available yet.
function clipHue(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
  return Math.abs(h) % 360;
}

function thumbHtml(clip) {
  if (clip.thumbnail_url) {
    return `<img src="${clip.thumbnail_url}" alt=""
               style="width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .3s"
               onload="this.style.opacity=1"
               onerror="this.style.display='none'" />`;
  }
  const h = clipHue(clip.filename);
  return `<div style="width:100%;height:100%;
                       background:linear-gradient(135deg,
                         hsl(${h},28%,20%) 0%,
                         hsl(${(h+50)%360},28%,13%) 100%)"></div>`;
}

// ── Delete clip ────────────────────────────────────────────────────────────────
async function deleteClipById(clip) {
  if (!confirm(`Delete "${clip.filename}"?\nThis removes it from the vault (the local file is untouched).`)) return;
  try {
    await deleteClip(clip.id);
    state.untagged = state.untagged.filter((c) => c.id !== clip.id);
    state.tagged   = state.tagged.filter((c) => c.id !== clip.id);
    if (state.activeClip?.id === clip.id) closeTagger();
    renderInboxGrid();
    renderTaggedGrid();
    toast('Clip deleted', 'success');
  } catch (e) {
    toast('Delete failed', 'error');
    console.error(e);
  }
}

// ── Inbox grid ─────────────────────────────────────────────────────────────────
function renderInboxGrid() {
  $('inbox-badge').textContent = state.untagged.length || '';
  const grid = $('clip-grid');
  grid.innerHTML = '';

  if (!state.untagged.length) {
    $('clip-grid-empty').classList.remove('hidden');
    return;
  }
  $('clip-grid-empty').classList.add('hidden');

  for (const clip of state.untagged) {
    const fileId = fileIdFromUrl(clip.drive_url);
    const card   = document.createElement('div');
    card.className     = 'clip-card' + (state.activeClip?.id === clip.id ? ' selected' : '');
    card.dataset.id    = clip.id;
    card.dataset.fileid = fileId ?? '';
    card.innerHTML = `
      <div class="clip-thumb">${thumbHtml(clip)}</div>
      <div class="clip-info">
        <span class="clip-name">${clip.filename}</span>
        <span class="clip-date">${clip.date ?? ''}</span>
      </div>
      <button class="card-delete-btn" title="Delete clip">🗑</button>`;
    card.addEventListener('click',    () => openTagger(clip));
    card.addEventListener('dblclick', (e) => { e.stopPropagation(); openVideoModal(clip); });
    card.querySelector('.card-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteClipById(clip);
    });
    grid.appendChild(card);
  }
}

// ── Shared video loader ────────────────────────────────────────────────────────
// Resolves the best URL for the clip and sets it on the video element.
// Direct URLs (local server or R2) are set immediately.
// Legacy Drive clips fall back to blob download.
async function loadVideo(clip, videoEl) {
  videoEl.src = '';
  const url = getVideoUrl(clip);

  if (isDirectUrl(url)) {
    videoEl.src = url;   // local server or R2 — instant / fast stream
  } else {
    // Legacy Drive clip: must blob-download with auth
    toast('Loading video…');
    try {
      const fileId = fileIdFromUrl(clip.drive_url);
      videoEl.src = await downloadVideoBlob(fileId, getToken());
    } catch (e) {
      console.error('[video] load failed:', e);
      toast('Could not load video', 'error');
    }
  }
}

// ── Video modal ────────────────────────────────────────────────────────────────
async function openVideoModal(clip) {
  $('modal-filename').textContent = clip.filename;
  $('modal-drive-link').href      = clip.drive_url ?? '#';
  $('video-modal').classList.remove('hidden');
  document.addEventListener('keydown', onModalKey);
  await loadVideo(clip, $('modal-embed'));
}

function closeVideoModal() {
  const v = $('modal-embed');
  v.pause(); v.src = '';
  $('video-modal').classList.add('hidden');
  document.removeEventListener('keydown', onModalKey);
}

function onModalKey(e) { if (e.key === 'Escape') closeVideoModal(); }

// ── Tagger panel ───────────────────────────────────────────────────────────────
function openTagger(clip) {
  state.activeClip = clip;
  state.selectedCats = new Set(clip.categories ?? []);
  state.tags         = [...(clip.subcategories ?? [])];

  $('clip-original-name').textContent = clip.filename;
  $('clip-drive-link').href           = clip.drive_url ?? '#';
  $('game-input').value  = clip.game        ?? '';
  $('desc-input').value  = clip.description ?? '';
  $('notes-input').value = clip.notes       ?? '';

  renderCategorySection();
  renderTagInput();
  $('tagger-panel').classList.remove('hidden');

  // Fire-and-forget; guard against the user switching clips mid-load
  loadVideo(clip, $('clip-embed')).then(() => {
    // If user already moved to another clip, clear the src we just set
    if (state.activeClip?.id !== clip.id) $('clip-embed').src = '';
  });

  document.querySelectorAll('.clip-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.id === clip.id);
  });
}

function closeTagger() {
  const v = $('clip-embed');
  v.pause(); v.src = '';
  $('tagger-panel').classList.add('hidden');
  state.activeClip = null;
  document.querySelectorAll('.clip-card').forEach((c) => c.classList.remove('selected'));
}

function buildFilename(game, desc) {
  const d     = new Date();
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day   = d.getDate();
  const year  = String(d.getFullYear()).slice(-2);
  const g = game.trim().replace(/\s+/g, '');
  const s = desc.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!g || !s) return '';
  return `${month}${day}${year}-${g}-${s}.mp4`;
}

function syncConfirmBtn() {
  const name = buildFilename($('game-input').value, $('desc-input').value);
  $('filename-preview').textContent = name;
  $('confirm-btn').disabled = !name || state.selectedCats.size === 0;
}

async function confirmTag() {
  const clip = state.activeClip;
  if (!clip) return;
  const game  = $('game-input').value.trim();
  const desc  = $('desc-input').value.trim();
  const notes = $('notes-input').value.trim();
  const newName = buildFilename(game, desc);

  $('confirm-btn').disabled    = true;
  $('confirm-btn').textContent = 'Saving…';

  try {
    await updateClip(clip.id, {
      filename:      newName,
      game,
      categories:    [...state.selectedCats],
      subcategories: state.tags,
      description:   desc,
      notes:         notes || null,
      // drive_url stays unchanged — R2 file keeps its _cv.mp4 name
    });

    if (!state.descSlugs.includes(desc)) {
      state.descSlugs.unshift(desc);
      populateDescSuggestions();
    }

    const updatedClip = {
      ...clip,
      filename:      newName,
      game,
      categories:    [...state.selectedCats],
      subcategories: state.tags,
      description:   desc,
      notes:         notes || null,
    };

    // Remove from untagged (new tag) or update in tagged (re-tag)
    state.untagged = state.untagged.filter((c) => c.id !== clip.id);
    const taggedIdx = state.tagged.findIndex((c) => c.id === clip.id);
    if (taggedIdx !== -1) state.tagged[taggedIdx] = updatedClip;

    toast('Saved!', 'success');
    closeTagger();
    renderInboxGrid();
    if (taggedIdx !== -1) renderTaggedGrid();
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
    console.error(err);
  } finally {
    $('confirm-btn').disabled    = false;
    $('confirm-btn').textContent = 'Confirm & Tag';
    syncConfirmBtn();
  }
}

function populateDescSuggestions() {
  const dl = $('desc-suggestions');
  dl.innerHTML = '';
  for (const s of state.descSlugs) {
    const opt = document.createElement('option');
    opt.value = s;
    dl.appendChild(opt);
  }
}

// ── Library ────────────────────────────────────────────────────────────────────
function buildLibraryFilterBar() {
  const bar  = $('library-filter-bar');
  const tree = getTaxTree();
  bar.innerHTML = '';

  const mkBtn = (label, cat) => {
    const btn    = document.createElement('button');
    const active = state.libraryFilter === cat;
    btn.className   = 'filter-btn' + (active ? ' active' : '');
    btn.textContent = label;
    if (cat) applyChipColor(btn, catColor(cat), active);
    btn.addEventListener('click', () => {
      state.libraryFilter = cat;
      buildLibraryFilterBar();
      loadLibrary();
    });
    bar.appendChild(btn);
  };

  mkBtn('All', '');
  for (const cat of tree) mkBtn(cat.name, cat.name);
}

async function loadLibrary() {
  const grid = $('tagged-grid');
  grid.innerHTML = '<div class="spinner"></div>';
  try {
    state.tagged = await fetchTaggedClips(state.libraryFilter || null);
    renderTaggedGrid();
  } catch (err) {
    grid.innerHTML = `<p class="muted center-msg">Error: ${err.message}</p>`;
  }
}

function renderTaggedGrid() {
  const grid = $('tagged-grid');
  grid.innerHTML = '';
  if (!state.tagged.length) {
    grid.innerHTML = '<p class="muted center-msg">No tagged clips yet.</p>';
    return;
  }

  for (const clip of state.tagged) {
    const card = document.createElement('div');
    card.className = 'clip-card';
    card.innerHTML = `
      <div class="clip-thumb">${thumbHtml(clip)}</div>
      <div class="clip-info">
        <span class="clip-name">${clip.filename}</span>
        <span class="clip-game">${clip.game}</span>
        <div class="clip-tags">
          ${(clip.categories    ?? []).map((c) => `<span class="tag"${tagStyle(c, false)}>${c}</span>`).join('')}
          ${(clip.subcategories ?? []).map((s) => `<span class="tag sub"${tagStyle(s, true)}>${s}</span>`).join('')}
        </div>
        <span class="clip-date">${clip.date ?? ''}</span>
      </div>
      <button class="card-delete-btn" title="Delete clip">🗑</button>`;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-delete-btn')) return;
      openTagger(clip);
    });
    card.addEventListener('dblclick', (e) => { e.stopPropagation(); openVideoModal(clip); });
    card.querySelector('.card-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteClipById(clip);
    });
    grid.appendChild(card);
  }
}

// ── Search ─────────────────────────────────────────────────────────────────────
const RECENT_KEY = 'cv_recent_searches';

function getRecentSearches() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); }
  catch { return []; }
}

function saveRecentSearch(q) {
  const prev    = getRecentSearches().filter((s) => s !== q);
  const updated = [q, ...prev].slice(0, 3);
  localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
}

function renderSearchHome() {
  const tree        = getTaxTree();
  const suggestions = [
    'Best highlights',
    'Funny moments',
    'Gameplay fails',
    'Reaction clips',
    'Just chatting moments',
    ...tree.map((c) => c.name),
  ].slice(0, 8);

  const sugEl = $('search-suggestions');
  sugEl.innerHTML = '';
  for (const s of suggestions) {
    const chip = document.createElement('button');
    chip.className   = 'suggestion-chip';
    chip.textContent = s;
    chip.addEventListener('click', () => {
      $('search-input').value = s;
      runSearch();
    });
    sugEl.appendChild(chip);
  }

  renderRecentSearches();
}

function renderRecentSearches() {
  const recent = getRecentSearches();
  const wrap   = $('recent-searches-wrap');
  const el     = $('recent-searches');
  if (!recent.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  el.innerHTML = '';
  for (const s of recent) {
    const chip = document.createElement('button');
    chip.className   = 'recent-chip';
    chip.textContent = s;
    chip.addEventListener('click', () => {
      $('search-input').value = s;
      runSearch();
    });
    el.appendChild(chip);
  }
}

async function runSearch() {
  const q = $('search-input').value.trim();
  if (!q) return;
  saveRecentSearch(q);
  renderRecentSearches();
  $('search-btn').disabled      = true;
  $('search-results').innerHTML = '<div class="spinner"></div>';
  try {
    const results = await searchClips(q);
    renderSearchResults(results);
  } catch (err) {
    $('search-results').innerHTML = `<p class="muted center-msg">Search failed: ${err.message}</p>`;
  } finally {
    $('search-btn').disabled = false;
  }
}

function renderSearchResults(results) {
  const el = $('search-results');
  if (!results.length) { el.innerHTML = '<p class="muted center-msg">No results found.</p>'; return; }
  el.innerHTML = '';
  for (const r of results) {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML = `
      <a href="${r.drive_url}" target="_blank" rel="noopener">${r.filename}</a>
      <div class="result-meta">${r.game} · ${(r.categories ?? []).join(', ')} · ${r.date}</div>
      ${r.reason ? `<div class="result-reason">${r.reason}</div>` : ''}`;
    el.appendChild(card);
  }
}

// ── Toast ──────────────────────────────────────────────────────────────────────
let _toastTimer;
function toast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className   = `show ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => (el.className = ''), 2500);
}

// ── Boot ───────────────────────────────────────────────────────────────────────
async function boot() {
  toast('Loading…');

  const [untagged, slugs, taxonomy] = await Promise.all([
    fetchUntaggedClips(),
    fetchDescriptions(),
    fetchTaxonomy(),
  ]);

  state.untagged  = untagged;
  state.descSlugs = slugs;
  state.taxonomy  = taxonomy;

  populateDescSuggestions();
  buildLibraryFilterBar();
  renderSearchHome();

  $('main-nav').classList.remove('hidden');
  switchView('inbox');
  renderInboxGrid();
}

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  $('panel-close').addEventListener('click', closeTagger);
  $('confirm-btn').addEventListener('click', confirmTag);
  $('skip-btn').addEventListener('click', () => {
    // Skip only makes sense in inbox — find next untagged clip
    const idx  = state.untagged.findIndex((c) => c.id === state.activeClip?.id);
    if (idx === -1) { closeTagger(); return; }  // editing a library clip — just close
    const next = state.untagged[idx + 1];
    next ? openTagger(next) : closeTagger();
  });
  $('game-input').addEventListener('input', syncConfirmBtn);
  $('desc-input').addEventListener('input', syncConfirmBtn);
  $('search-btn').addEventListener('click', runSearch);
  $('search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

  $('modal-close').addEventListener('click', closeVideoModal);
  $('modal-backdrop').addEventListener('click', closeVideoModal);

  boot();
}

init();
