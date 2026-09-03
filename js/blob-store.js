/* ============ Redia Play — Blob Store ============
   This is a different approach than the File System Access API (which
   Android doesn't support — see README). Instead of trying to remember
   a *path* on disk, this stores the actual video file's bytes inside
   IndexedDB, which is a widely-supported browser database with no
   Android/WebView gap. Once a video is added, its bytes live in this
   database — the app can rebuild the full library on next launch with
   zero prompts and zero re-picking, because it isn't reading from your
   phone's file system again at all; it's reading its own local copy.

   Trade-off, stated plainly: this duplicates the video's storage
   footprint inside the app's data (so a 2GB video uses another ~2GB
   here). Mobile WebViews typically allow the app a multi-GB quota, but
   very large libraries can hit it — if a file fails to store (quota
   exceeded), it still plays for the current session, it just won't
   survive an app close, and we tell you which one so it's not a silent
   loss.
*/
const BlobStore = (() => {
  const DB_NAME = 'redia_video_store';
  const STORE = 'videos';

  function idbOpen(){
    return new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(id, file){
    const db = await idbOpen();
    return new Promise((resolve,reject)=>{
      const tx = db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put({ blob:file, name:file.name, type:file.type, lastModified:file.lastModified }, id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAll(){
    const db = await idbOpen();
    return new Promise((resolve,reject)=>{
      const tx = db.transaction(STORE,'readonly');
      const store = tx.objectStore(STORE);
      const results = [];
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if(cursor){ results.push({ id:cursor.key, ...cursor.value }); cursor.continue(); }
        else resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function remove(id){
    const db = await idbOpen();
    return new Promise((resolve,reject)=>{
      const tx = db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clear(){
    const db = await idbOpen();
    return new Promise((resolve,reject)=>{
      const tx = db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function estimateUsage(){
    if(navigator.storage && navigator.storage.estimate){
      try{ return await navigator.storage.estimate(); }catch(e){ return null; }
    }
    return null;
  }

  return { put, getAll, remove, clear, estimateUsage };
})();
