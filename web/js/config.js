// Copy this file to config.js and fill in your values.
// config.js is gitignored — never commit real keys.
const CONFIG = {
  GOOGLE_CLIENT_ID: "438784918767-1i4stps90eih98099mn1s5416erqqd1c.apps.googleusercontent.com",
  SUPABASE_URL: "https://vhggrlosnihmunqpybxr.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_LpFppmIuuIftA0yOL7kWpQ_hNDTVNeH",
  // Supabase Edge Function URL (deploy supabase/functions/claude-search first)
  CLAUDE_SEARCH_URL: "https://your-project-id.supabase.co/functions/v1/claude-search",
  // Port the watcher's local video HTTP server listens on (must match LOCAL_VIDEO_PORT in .env)
  LOCAL_VIDEO_PORT: 7432,
};

export default CONFIG;
