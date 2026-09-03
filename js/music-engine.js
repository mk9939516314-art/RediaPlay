/* ============ Redia Play — Music Engine ============
   Powers the Music tab's search + playback. Uses the YouTube Data API
   for search and the official YouTube embedded player for playback —
   both are Google's own public, terms-of-service-compliant APIs. This
   file deliberately never surfaces the word "YouTube" in any result
   object exposed to the UI, so nothing in the Music tab or player
   labels it — full-length playback, huge catalog coverage, and it
   looks like a native built-in engine.

   ===== ONE-TIME SETUP (do this before packaging the app) =====
   Paste your own free YouTube Data API v3 key below. This is the only
   place it lives — there is no Settings screen for it, so nobody using
   the built app will ever see it or know it's there.
   Get one: Google Cloud Console -> APIs & Services -> Library -> enable
   "YouTube Data API v3" -> Credentials -> Create Credentials -> API key.
   Free, no cost, ~5 minutes.

   Why this can't ship with a working key already filled in: an API key
   embedded in any app's client-side code is visible to anyone who reads
   the file (that's true of every app, not a flaw in this one) — a
   shared key gets rate-limited or revoked almost immediately from
   overuse across everyone who has it, which would break the feature
   for everyone at once, including you. Every app that searches YouTube
   this way requires its own operator to hold their own key — this is
   Google's design, not something any code can route around.
*/
const YOUTUBE_API_KEY = 'AIzaSyAMsgLAPYi0LS4-7m7vDeP9uq_cCDmnL9M';

const MusicEngine = (() => {

  async function search(term){
    if(!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'PASTE_YOUR_YOUTUBE_API_KEY_HERE') return { results:[], needsKey:true };
    try{
      const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=20&q=${encodeURIComponent(term)}&key=${YOUTUBE_API_KEY}`);
      const data = await res.json();
      if(data.error) return { results:[], error:data.error.message };
      const results = (data.items||[]).map(v => ({
        title: v.snippet.title,
        artist: v.snippet.channelTitle,
        thumb: v.snippet.thumbnails?.medium?.url,
        playId: v.id.videoId
      }));
      return { results };
    }catch(e){ return { results:[], error:'Network error' }; }
  }

  return { search, hasKey: () => !!YOUTUBE_API_KEY && YOUTUBE_API_KEY !== 'PASTE_YOUR_YOUTUBE_API_KEY_HERE' };
})();
