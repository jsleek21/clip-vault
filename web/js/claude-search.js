import CONFIG from './config.js';

export async function searchClips(query) {
  const resp = await fetch(CONFIG.CLAUDE_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) throw new Error(`Search ${resp.status}: ${await resp.text()}`);
  return resp.json();
}
