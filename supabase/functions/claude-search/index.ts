import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_KEY   = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SVCKEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { query } = await req.json();
    if (!query?.trim()) return json([]);

    const sb = createClient(SUPABASE_URL, SUPABASE_SVCKEY);

    // FTS candidates
    const { data: fts } = await sb
      .from("clips")
      .select("id,filename,game,categories,description,date,drive_url,notes")
      .textSearch("search_vector", query, { type: "websearch" })
      .limit(30);

    // Recent clips as fallback context
    const { data: recent } = await sb
      .from("clips")
      .select("id,filename,game,categories,description,date,drive_url")
      .order("created_at", { ascending: false })
      .limit(20);

    // Deduplicate
    const seen = new Set<string>();
    const clips = [...(fts ?? []), ...(recent ?? [])].filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    if (!clips.length) return json([]);

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":          ANTHROPIC_KEY,
        "anthropic-version":  "2023-06-01",
        "content-type":       "application/json",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: [
          "You are a clip search assistant for a gaming clip library.",
          "Given a natural-language query and a list of clips, return the IDs of matching clips with a short reason.",
          'Respond with valid JSON only: {"results":[{"id":"...","reason":"..."}]}',
          "Return only clips that genuinely match. Rank best matches first.",
        ].join(" "),
        messages: [{
          role:    "user",
          content: `Query: "${query}"\n\nClips:\n${JSON.stringify(clips, null, 2)}`,
        }],
      }),
    });

    const claudeData = await claudeResp.json();
    const raw        = claudeData.content?.[0]?.text ?? "{}";
    const match      = raw.match(/\{[\s\S]*\}/);
    const parsed     = JSON.parse(match?.[0] ?? "{}");

    const results = (parsed.results ?? [])
      .map(({ id, reason }: { id: string; reason: string }) => {
        const clip = clips.find((c) => c.id === id);
        return clip ? { ...clip, reason } : null;
      })
      .filter(Boolean);

    return json(results);
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
