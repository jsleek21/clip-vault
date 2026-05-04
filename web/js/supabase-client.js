import CONFIG from './config.js';

const BASE = `${CONFIG.SUPABASE_URL}/rest/v1`;
const HEADERS = {
  apikey: CONFIG.SUPABASE_ANON_KEY,
  Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

async function sb(path, opts = {}) {
  const resp = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...HEADERS, ...opts.headers },
  });
  if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${await resp.text()}`);
  return resp.status === 204 ? null : resp.json();
}

// Pending clips have an empty game field
export const fetchUntaggedClips = () =>
  sb('/clips?game=eq.&order=created_at.asc');

export const updateClip = (id, patch) =>
  sb(`/clips?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });

export async function fetchDescriptions() {
  const rows = await sb('/clips?select=description&description=neq.&order=created_at.desc&limit=300');
  return [...new Set(rows.map((r) => r.description).filter(Boolean))];
}

// Tagged clips for library, optional category filter
export function fetchTaggedClips(categoryFilter = null) {
  let path = '/clips?game=neq.&order=date.desc&limit=500';
  if (categoryFilter) {
    path += `&categories=cs.${encodeURIComponent(`{"${categoryFilter}"}`)}`;
  }
  return sb(path);
}

// Taxonomy
export const fetchTaxonomy = () =>
  sb('/taxonomy?order=sort_order.asc,name.asc');

export const deleteClip = (id) =>
  sb(`/clips?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });

export async function createTaxonomyItem(name, parentId = null, color = null) {
  const rows = await sb('/taxonomy', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name, parent_id: parentId, ...(color ? { color } : {}) }),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}
