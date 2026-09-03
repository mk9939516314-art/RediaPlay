/* ============ Redia Play — Format Engine ============
   Strategy:
   1. Try native <video> playback first (fast, hardware-decoded — covers
      MP4/H.264/H.265, WebM/VP8/VP9/AV1, MOV, M4V, most modern formats).
   2. If the browser rejects the format (video 'error' event, code 4 =
      MEDIA_ERR_SRC_NOT_SUPPORTED), fall back to FFmpeg.wasm running
      fully on-device (no upload, nothing leaves the phone):
        a) fast remux attempt (-c copy) — just repackages the container,
           near-instant, works for MKV/AVI/FLV/TS/3GP wrapping an
           already-supported codec.
        b) if remux still fails to play, full transcode
           (-c:v libx264 -c:a aac) — slower but decodes virtually any
           codec FFmpeg supports (DivX/Xvid, WMV, RealVideo, older
           MPEG-2/4, etc.)
   3. Converted result is cached in IndexedDB keyed by file id+size, so
      the same file never needs re-converting.
   Note: nothing that requires an actual paid/DRM license (e.g. widevine
   protected files) can be decoded by any player without that license —
   this covers every open/unencrypted format FFmpeg supports, which is
   effectively everything in common circulation.
*/

const FormatEngine = (() => {
  const DB_NAME = 'redia_format_cache';
  const STORE = 'converted';
  let ffmpegInstance = null;
  let ffmpegLoading = null;

  /* ---------- IndexedDB cache for converted blobs ---------- */
  function openDB(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function cacheGet(key){
    try{
      const db = await openDB();
      return await new Promise((res,rej)=>{
        const tx = db.transaction(STORE,'readonly');
        const r = tx.objectStore(STORE).get(key);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => rej(r.error);
      });
    }catch(e){ return null; }
  }
  async function cacheSet(key, blob){
    try{
      const db = await openDB();
      await new Promise((res,rej)=>{
        const tx = db.transaction(STORE,'readwrite');
        tx.objectStore(STORE).put(blob, key);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
    }catch(e){ /* ignore cache failures */ }
  }

  /* ---------- lazy-load ffmpeg.wasm (single-thread build, no special headers needed) ---------- */
  function loadScript(src){
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  async function getFFmpeg(onLog){
    if(ffmpegInstance) return ffmpegInstance;
    if(!ffmpegLoading){
      ffmpegLoading = (async () => {
        if(!window.FFmpeg){
          await loadScript('https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js');
        }
        const { createFFmpeg } = window.FFmpeg;
        const instance = createFFmpeg({
          log: false,
          corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
          progress: ({ ratio }) => { if(onLog && ratio>=0) onLog(ratio); }
        });
        await instance.load();
        ffmpegInstance = instance;
        return instance;
      })();
    }
    return ffmpegLoading;
  }

  /* ---------- test if native playback actually works ---------- */
  function testNativePlayback(url, timeoutMs=4000){
    return new Promise((resolve) => {
      const probe = document.createElement('video');
      probe.muted = true; probe.playsInline = true; probe.preload = 'auto';
      let done = false;
      const finish = (ok) => { if(done) return; done = true; cleanup(); resolve(ok); };
      const cleanup = () => { probe.src=''; probe.removeAttribute('src'); };
      probe.addEventListener('loadeddata', () => finish(true), {once:true});
      probe.addEventListener('error', () => finish(false), {once:true});
      setTimeout(() => finish(false), timeoutMs);
      probe.src = url;
    });
  }

  /* ---------- conversion ---------- */
  async function convert(file, statusCb){
    const ffmpeg = await getFFmpeg((ratio) => {
      if(statusCb) statusCb(`Converting… ${Math.round(ratio*100)}%`);
    });
    const { fetchFile } = window.FFmpeg;
    const inName = 'input' + (file.name.match(/\.[^/.]+$/)?.[0] || '.dat');
    const outName = 'output.mp4';

    ffmpeg.FS('writeFile', inName, await fetchFile(file));

    // 1) fast remux (container repackage only, no re-encode)
    if(statusCb) statusCb('Trying quick remux…');
    let ok = true;
    try{
      await ffmpeg.run('-i', inName, '-c', 'copy', '-movflags', '+faststart', outName);
    }catch(e){ ok = false; }

    let data = ok ? ffmpeg.FS('readFile', outName) : null;

    if(!ok || !data || data.length < 1000){
      // 2) full transcode fallback — decodes virtually any codec
      if(statusCb) statusCb('Converting video (first time only)…');
      try{ ffmpeg.FS('unlink', outName); }catch(e){}
      await ffmpeg.run(
        '-i', inName,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '160k',
        '-movflags', '+faststart',
        outName
      );
      data = ffmpeg.FS('readFile', outName);
    }

    try{ ffmpeg.FS('unlink', inName); ffmpeg.FS('unlink', outName); }catch(e){}

    return new Blob([data.buffer], { type: 'video/mp4' });
  }

  /* ---------- public: resolve a playable URL for any file ---------- */
  async function getPlayableUrl(item, statusCb, showConverting, hideConverting){
    const cacheKey = item.id;

    // already converted before?
    const cached = await cacheGet(cacheKey);
    if(cached){
      return URL.createObjectURL(cached);
    }

    // try native first
    const nativeOk = await testNativePlayback(item.url);
    if(nativeOk){
      return item.url;
    }

    // fallback to ffmpeg conversion
    if(showConverting) showConverting();
    try{
      const blob = await convert(item.file, statusCb);
      await cacheSet(cacheKey, blob);
      if(hideConverting) hideConverting();
      return URL.createObjectURL(blob);
    }catch(err){
      if(hideConverting) hideConverting();
      console.error('Conversion failed', err);
      throw err;
    }
  }

  return { getPlayableUrl };
})();
