/* ============ Redia Play — Core App ============ */

const state = {
  library: [],
  playlists: [],
  queue: [],
  current: null,
  currentPlaylistId: null,
  controlsTimer: null,
  ambientTimer: null,
  sleepTimer: null,
  highlightPeaks: [],
  view: 'grid',
  sortBy: 'dateAdded',
  filter: 'all',
  multiSelect: false,
  selectedIds: new Set(),
  recentSearches: [],
  longPressTimer: null,
  wasSpeedBoosted: false,
  displayMode: 'contain',
  rotation: 0,
  settings: {
    theme:'violet', light:false, ambient:true, reduceMotion:false,
    perVideoSpeed:true, autoNext:true, skipDuration:10,
    gestureSwipe:true, longPressSpeed:true, haptics:true,
    brightness:100, contrast:100, saturation:100, warmth:0,
    bassDb:0, midDb:0, trebleDb:0, wide:false, mono:false, balance:0,
    highlights:true, subSize:22, subBg:60, subColor:'#ffffff', subDelay:0, volumeBoost:100
  }
};

const $ = id => document.getElementById(id);
const THEMES = {
  violet:['#8b5cf6','#22d3ee'], obsidian:['#5b6b7c','#a3b8cc'], crimson:['#ef4444','#f97316'],
  emerald:['#10b981','#34d399'], gold:['#f59e0b','#fbbf24'], royal:['#6366f1','#ec4899'],
  ocean:['#0ea5e9','#06b6d4'], neon:['#d946ef','#22d3ee']
};

/* ---------- persistence ---------- */
function loadMeta(){ try{ return JSON.parse(localStorage.getItem('redia_meta')||'{}'); }catch(e){ return {}; } }
function saveMeta(meta){ localStorage.setItem('redia_meta', JSON.stringify(meta)); }
function loadSettings(){ try{ const s=JSON.parse(localStorage.getItem('redia_settings')); if(s) Object.assign(state.settings,s); }catch(e){} }
function saveSettings(){ localStorage.setItem('redia_settings', JSON.stringify(state.settings)); }
function loadPlaylists(){ try{ return JSON.parse(localStorage.getItem('redia_playlists')||'[]'); }catch(e){ return []; } }
function savePlaylists(){ localStorage.setItem('redia_playlists', JSON.stringify(state.playlists)); }
function loadSearches(){ try{ return JSON.parse(localStorage.getItem('redia_searches')||'[]'); }catch(e){ return []; } }
function saveSearches(){ localStorage.setItem('redia_searches', JSON.stringify(state.recentSearches.slice(0,8))); }

/* ---------- navigation ---------- */
function navTo(screenId){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $(screenId).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.nav===screenId));
  $('bottomNav').style.display = (screenId==='playerScreen') ? 'none' : 'flex';
  if(screenId==='homeScreen') renderHome();
  if(screenId==='libraryScreen') renderLibrary();
  if(screenId==='playlistsScreen') renderPlaylists();
  if(screenId==='musicScreen') $('youtubeKeyBanner').classList.toggle('hidden', MusicEngine.hasKey());
}
document.querySelectorAll('[data-nav]').forEach(el=>{
  el.addEventListener('click', ()=> { haptic(); navTo(el.dataset.nav); });
});

function greet(){
  const h = new Date().getHours();
  $('greetText').textContent = h<12 ? 'Good morning' : h<17 ? 'Good afternoon' : 'Good evening';
}

/* ================= LIBRARY DATA ================= */
$('folderInput').addEventListener('change', handleFiles);
$('fileInput').addEventListener('change', handleFiles);

function handleFiles(e){
  const files = Array.from(e.target.files).filter(f => f.type.startsWith('video/'));
  if(!files.length){ if(e.target.files.length) flashSeekGlobal('No playable video files in that selection','error'); return; }
  ingestFiles(files);
  e.target.value = '';
}

function ingestFiles(files, opts){
  opts = opts || {};
  const meta = loadMeta();
  let added = 0;
  const newItems = [];
  files.forEach(file => {
    const key = file.name + '_' + file.size;
    if(state.library.find(i=>i.id===key)) return;
    const url = URL.createObjectURL(file);
    const m = meta[key] || {};
    const item = {
      id:key, name:file.name.replace(/\.[^/.]+$/,''), file, url, thumb:m.thumb||null,
      duration:0, lastPos:m.lastPos||0, favorite:m.favorite||false, plays:m.plays||0,
      dateAdded: m.dateAdded || Date.now(), size:file.size, type:file.type,
      lastModified:file.lastModified, bookmarks:m.bookmarks||[], speed:m.speed||1
    };
    state.library.push(item);
    generateThumb(item);
    newItems.push(item);
    added++;
  });
  if(added){ saveAllMeta(); if(!opts.silent) flashSeekGlobal(added+' video'+(added>1?'s':'')+' added','success'); }
  renderHome(); renderLibrary();

  // persist actual bytes so the library survives a full app close (see blob-store.js)
  if(!opts.skipPersist){
    newItems.forEach(item => {
      BlobStore.put(item.id, item.file).catch(() => {
        flashSeekGlobal('"'+item.name+'" is too large to remember permanently — it will play now but needs re-adding next time', 'error');
      });
    });
  }
}

/* restore full library from local byte-storage on app start — no picker, no prompt */
async function restoreFromBlobStore(){
  try{
    const records = await BlobStore.getAll();
    if(!records.length) return;
    const files = records.map(r => {
      try{ return new File([r.blob], r.name, { type:r.type, lastModified:r.lastModified }); }
      catch(e){ return r.blob; } // some WebViews may not support the File constructor — the Blob itself still works for playback
    });
    ingestFiles(files, { silent:true, skipPersist:true });
  }catch(e){ /* IndexedDB unavailable — library just starts empty this session */ }
}
function flashSeekGlobal(text, type){
  // lightweight toast usable outside the player screen too
  let toast = document.getElementById('globalToast');
  if(!toast){
    toast = document.createElement('div');
    toast.id='globalToast';
    toast.style.cssText='position:fixed;left:50%;bottom:100px;transform:translateX(-50%);z-index:60;padding:11px 20px;border-radius:30px;font-size:13px;font-weight:700;color:#fff;transition:opacity .25s;pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.style.background = type==='error' ? 'rgba(239,68,68,.9)' : type==='success' ? 'rgba(34,197,94,.9)' : 'rgba(20,20,26,.85)';
  toast.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{ toast.style.opacity='0'; }, 2200);
}
function saveAllMeta(){
  const meta = {};
  state.library.forEach(i=>{
    meta[i.id] = { lastPos:i.lastPos, favorite:i.favorite, plays:i.plays, dateAdded:i.dateAdded, bookmarks:i.bookmarks, speed:i.speed };
  });
  saveMeta(meta);
}

function generateThumb(item){
  const v = document.createElement('video');
  v.src = item.url; v.muted = true; v.playsInline = true;
  v.addEventListener('loadeddata', () => {
    item.duration = v.duration || 0;
    v.currentTime = Math.min(2, (v.duration||2)*0.1);
  });
  v.addEventListener('seeked', () => {
    // capture at the video's own aspect ratio (capped at 640px on the longer
    // side) instead of forcing a fixed portrait crop — cards of different
    // shapes (square grid vs 16:9 home rail) then crop this via CSS
    // object-fit:cover, which stays sharp; forcing one crop shape up front
    // was what caused the blur on the differently-shaped home rail cards.
    const vw=v.videoWidth||16, vh=v.videoHeight||9;
    const maxDim = 640;
    const scale = Math.min(maxDim/vw, maxDim/vh, 1) || 1;
    const cw = Math.max(1, Math.round(vw*scale));
    const ch = Math.max(1, Math.round(vh*scale));
    const canvas = document.createElement('canvas');
    canvas.width=cw; canvas.height=ch;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(v, 0, 0, cw, ch);
    item.thumb = canvas.toDataURL('image/jpeg',0.85);
    renderHome(); renderLibrary();
  }, {once:true});
}

function fmtSize(bytes){
  if(!bytes) return '';
  const mb = bytes/1048576;
  return mb>1024 ? (mb/1024).toFixed(2)+' GB' : mb.toFixed(0)+' MB';
}
function fmt(t){ if(!isFinite(t)) return '0:00'; const h=Math.floor(t/3600), m=Math.floor((t%3600)/60), s=Math.floor(t%60);
  return h>0 ? `${h}:${m<10?'0':''}${m}:${s<10?'0':''}${s}` : `${m}:${s<10?'0':''}${s}`; }

/* ================= HOME ================= */
function renderHome(){
  greet();
  $('homeEmpty').classList.toggle('gone', state.library.length>0);
  const continueList = state.library.filter(i=>i.lastPos>5 && i.duration && i.lastPos<i.duration*0.95).sort((a,b)=>b.lastPos-a.lastPos);
  const recentList = [...state.library].sort((a,b)=>b.dateAdded-a.dateAdded).slice(0,12);
  const mostList = state.library.filter(i=>i.plays>0).sort((a,b)=>b.plays-a.plays).slice(0,12);
  const favList = state.library.filter(i=>i.favorite);
  fillRail('continueRow','continueRail', continueList, true);
  fillRail('recentRow','recentRail', recentList);
  fillRail('mostRow','mostRail', mostList);
  fillRail('favRow','favRail', favList);
}
function fillRail(rowId, railId, items, big){
  $(rowId).classList.toggle('hidden', items.length===0);
  const rail = $(railId); rail.innerHTML='';
  items.forEach(item=>{ const c=makeCard(item); c.classList.add('rail-card'); rail.appendChild(c); });
}

/* ================= LIBRARY ================= */
$('viewToggleBtn').onclick = () => {
  state.view = state.view==='grid' ? 'list' : 'grid';
  $('viewToggleBtn').querySelector('use').setAttribute('href', state.view==='grid' ? '#i-grid' : '#i-list');
  renderLibrary();
};
$('multiSelectBtn').onclick = () => {
  state.multiSelect = !state.multiSelect;
  state.selectedIds.clear();
  $('multiActionBar').classList.toggle('hidden', !state.multiSelect);
  renderLibrary();
};
$('sortSelect').addEventListener('change', e => { state.sortBy = e.target.value; renderLibrary(); });
document.querySelectorAll('.chip[data-filter]').forEach(chip=>{
  chip.onclick = () => {
    haptic();
    document.querySelectorAll('.chip[data-filter]').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
    state.filter = chip.dataset.filter;
    renderLibrary();
  };
});
document.querySelector('.chip[data-filter="all"]')?.classList.add('active');

function getSortedFiltered(){
  let items = [...state.library];
  if(state.filter==='favorite') items = items.filter(i=>i.favorite);
  if(state.filter==='unwatched') items = items.filter(i=>i.lastPos<5);
  if(state.filter==='unfinished') items = items.filter(i=>i.lastPos>5 && i.duration && i.lastPos<i.duration*0.95);
  switch(state.sortBy){
    case 'name': items.sort((a,b)=>a.name.localeCompare(b.name)); break;
    case 'nameDesc': items.sort((a,b)=>b.name.localeCompare(a.name)); break;
    case 'duration': items.sort((a,b)=>b.duration-a.duration); break;
    case 'size': items.sort((a,b)=>b.size-a.size); break;
    case 'mostPlayed': items.sort((a,b)=>b.plays-a.plays); break;
    default: items.sort((a,b)=>b.dateAdded-a.dateAdded);
  }
  return items;
}

function renderLibrary(){
  const items = getSortedFiltered();
  $('libraryEmpty').classList.toggle('gone', state.library.length>0);
  if(state.view==='grid'){
    $('libraryGrid').classList.remove('hidden'); $('libraryList').classList.add('hidden');
    const grid = $('libraryGrid'); grid.innerHTML='';
    items.forEach(item => grid.appendChild(makeCard(item)));
  } else {
    $('libraryGrid').classList.add('hidden'); $('libraryList').classList.remove('hidden');
    const list = $('libraryList'); list.innerHTML='';
    items.forEach(item => list.appendChild(makeListRow(item)));
  }
}

function makeCard(item){
  const card = document.createElement('div');
  card.className='card' + (state.selectedIds.has(item.id) ? ' selected':'');
  const pct = item.duration ? Math.min(100,(item.lastPos/item.duration)*100) : 0;
  card.innerHTML = `
    ${item.thumb ? `<img src="${item.thumb}">` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#666;font-size:12px;">Loading…</div>`}
    ${item.favorite ? `<div class="fav-mark"><svg class="ic"><use href="#i-heart-fill"/></svg></div>` : ''}
    ${state.multiSelect ? `<div class="select-mark"><svg class="ic"><use href="#i-check"/></svg></div>` : ''}
    <div class="card-overlay">
      <div class="card-title">${item.name}</div>
      <div class="card-meta">${fmt(item.duration)}${item.size ? ' · '+fmtSize(item.size) : ''}</div>
      ${pct>0 ? `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>` : ''}
    </div>`;
  card.onclick = () => {
    if(state.multiSelect){
      if(state.selectedIds.has(item.id)) state.selectedIds.delete(item.id); else state.selectedIds.add(item.id);
      $('selectCount').textContent = state.selectedIds.size+' selected';
      renderLibrary();
    } else {
      buildQueueFrom(item);
      openPlayer(item);
    }
  };
  return card;
}
function makeListRow(item){
  const row = document.createElement('div');
  row.className='list-row';
  row.innerHTML = `
    <img class="list-thumb" src="${item.thumb||''}">
    <div class="list-info">
      <div class="list-title">${item.name}</div>
      <div class="list-meta">${fmt(item.duration)} · ${fmtSize(item.size)}${item.favorite?' · ♥':''}</div>
    </div>`;
  row.onclick = () => { buildQueueFrom(item); openPlayer(item); };
  return row;
}

/* ---------- multi-select bulk actions ---------- */
$('bulkFavBtn').onclick = () => {
  state.selectedIds.forEach(id=>{ const it=state.library.find(i=>i.id===id); if(it) it.favorite=true; });
  saveAllMeta(); renderLibrary(); renderHome();
};
$('bulkDeleteBtn').onclick = () => {
  state.selectedIds.forEach(id => BlobStore.remove(id).catch(()=>{}));
  state.library = state.library.filter(i=>!state.selectedIds.has(i.id));
  state.selectedIds.clear(); saveAllMeta(); renderLibrary(); renderHome();
};
$('bulkPlaylistBtn').onclick = () => {
  if(!state.playlists.length){ alert('Create a playlist first from the Playlists tab.'); return; }
  const name = prompt('Add to which playlist?\n'+state.playlists.map(p=>p.name).join(', '));
  const pl = state.playlists.find(p=>p.name===name);
  if(pl){ state.selectedIds.forEach(id=>{ if(!pl.videoIds.includes(id)) pl.videoIds.push(id); }); savePlaylists(); }
};

/* ================= SEARCH ================= */
$('searchInput').addEventListener('input', e => renderSearch(e.target.value));
$('voiceSearchBtn').onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ flashSeek('Voice search not supported on this device','error'); return; }
  const rec = new SR(); rec.lang='en-IN'; rec.start();
  rec.onresult = (e) => { const text = e.results[0][0].transcript; $('searchInput').value = text; renderSearch(text); };
};
function renderSearch(q){
  const results = $('searchResults'); results.innerHTML='';
  if(!q){ renderRecentSearches(); return; }
  $('recentSearches').innerHTML='';
  const matches = state.library.filter(i=>i.name.toLowerCase().includes(q.toLowerCase()));
  matches.forEach(item => results.appendChild(makeCard(item)));
  if(q.length>1 && !state.recentSearches.includes(q)){
    state.recentSearches.unshift(q); saveSearches();
  }
}
function renderRecentSearches(){
  const el = $('recentSearches'); el.innerHTML='';
  $('searchResults').innerHTML='';
  if(!state.recentSearches.length) return;
  el.innerHTML = '<h2>Recent Searches</h2>' + state.recentSearches.map(s=>`<span class="search-tag" data-q="${s}">${s}</span>`).join('');
  el.querySelectorAll('.search-tag').forEach(tag=>{
    tag.onclick = () => { $('searchInput').value = tag.dataset.q; renderSearch(tag.dataset.q); };
  });
}

/* ================= MUSIC ================= */
let musicDebounce = null;
$('musicSearchInput').addEventListener('input', e => {
  clearTimeout(musicDebounce);
  const term = e.target.value.trim();
  $('musicResults').innerHTML = '';
  $('musicStatus').textContent = '';
  if(!term) return;
  musicDebounce = setTimeout(() => runMusicSearch(term), 500);
});
async function runMusicSearch(term){
  if(!MusicEngine.hasKey()){
    $('musicStatus').textContent = 'Music search is not set up yet.';
    return;
  }
  $('musicStatus').textContent = 'Searching…';
  const { results, error } = await MusicEngine.search(term);
  $('musicStatus').textContent = error ? error : (results.length ? `${results.length} results` : 'No results — try a different search');
  renderMusicResults(results);
}
function renderMusicResults(results){
  const list = $('musicResults'); list.innerHTML='';
  results.forEach(track => {
    const row = document.createElement('div');
    row.className = 'list-row music-row';
    row.innerHTML = `
      <img class="list-thumb" src="${track.thumb||''}">
      <div class="list-info">
        <div class="list-title">${decodeEntities(track.title)||'Untitled'}</div>
        <div class="list-meta">${decodeEntities(track.artist)||''}</div>
      </div>`;
    row.onclick = () => {
      const meta = { title: track.title, artist: track.artist, thumb: track.thumb };
      playFromAnyLink('https://www.youtube.com/watch?v='+track.playId, meta);
    };
    list.appendChild(row);
  });
}

/* ================= PLAYLISTS ================= */
$('createPlaylistBtn').onclick = () => {
  const name = prompt('Playlist name:');
  if(!name) return;
  state.playlists.push({ id:'pl_'+Date.now(), name, videoIds:[] });
  savePlaylists(); renderPlaylists();
};
function renderPlaylists(){
  const grid = $('playlistGrid'); grid.innerHTML='';
  $('playlistEmpty').classList.toggle('gone', state.playlists.length>0);
  state.playlists.forEach(pl => {
    const card = document.createElement('div');
    card.className='card';
    const cover = pl.videoIds.map(id=>state.library.find(v=>v.id===id)).find(v=>v&&v.thumb);
    card.innerHTML = `${cover?`<img src="${cover.thumb}">`:`<div style="width:100%;height:100%;background:linear-gradient(135deg,var(--accent),var(--accent-2))"></div>`}
      <div class="card-overlay"><div class="card-title">${pl.name}</div><div class="card-meta">${pl.videoIds.length} videos</div></div>`;
    card.onclick = () => openPlaylistDetail(pl.id);
    grid.appendChild(card);
  });
}
function openPlaylistDetail(id){
  state.currentPlaylistId = id;
  const pl = state.playlists.find(p=>p.id===id);
  $('playlistDetailTitle').textContent = pl.name;
  const list = $('playlistDetailList'); list.innerHTML='';
  pl.videoIds.forEach(vid => {
    const item = state.library.find(v=>v.id===vid);
    if(!item) return;
    const row = makeListRow(item);
    row.onclick = () => { state.queue = pl.videoIds.filter(id=>id!==item.id).map(id=>state.library.find(v=>v.id===id)).filter(Boolean); openPlayer(item); };
    list.appendChild(row);
  });
  navTo('playlistDetailScreen');
}
$('playlistBackBtn').onclick = () => navTo('playlistsScreen');
$('deletePlaylistBtn').onclick = () => {
  state.playlists = state.playlists.filter(p=>p.id!==state.currentPlaylistId);
  savePlaylists(); navTo('playlistsScreen');
};

/* ================= QUEUE ================= */
function buildQueueFrom(item){
  const items = getSortedFiltered();
  const idx = items.findIndex(i=>i.id===item.id);
  state.queue = items.slice(idx+1);
}
function renderQueueMenu(){
  const list = $('queueList'); list.innerHTML='';
  if(!state.queue.length){ list.innerHTML = `<div class="pop-item" style="color:var(--text-dim)">Queue is empty</div>`; return; }
  state.queue.forEach((item,idx) => {
    const row = document.createElement('div');
    row.className='queue-row';
    row.innerHTML = `<img src="${item.thumb||''}"><span style="flex:1">${item.name}</span>`;
    row.onclick = () => { state.queue.splice(0,idx+1); openPlayer(item); togglePop(''); };
    list.appendChild(row);
  });
}
function playNextInQueue(){
  if(!state.queue.length) return false;
  const next = state.queue.shift();
  openPlayer(next);
  return true;
}

/* ================= PLAYER ================= */
const video = $('video');

async function openPlayer(item){
  savePosition();
  hideUpNext();
  state.current = item;
  item.plays = (item.plays||0)+1;
  $('nowPlayingTitle').textContent = item.name;
  updateFavIcon();
  navTo('playerScreen');
  applyColorFilters();
  setDisplayMode('contain');
  setRotation(0);
  $('embedFrame').classList.add('hidden'); $('embedFrame').src='';
  $('externalOpenOverlay').classList.add('hidden');
  $('embedFallbackBtn').classList.add('hidden');
  video.classList.remove('hidden');
  hideAudioArtwork();
  $('downloadBtn').classList.add('hidden');
  ['rewindBtn','forwardBtn','playPauseBtn','seekbar','speedBtn','displayModeBtn','rotateBtn','subtitleBtn','audioTrackBtn','bookmarkBtn','shotBtn','infoBtn'].forEach(id=>{ $(id).classList.remove('disabled'); });

  try{
    const playUrl = await FormatEngine.getPlayableUrl(
      item,
      msg => { $('convertStatus').textContent = msg; },
      () => $('convertOverlay').classList.remove('hidden'),
      () => $('convertOverlay').classList.add('hidden')
    );
    video.src = playUrl;
    video.addEventListener('loadedmetadata', function onMeta(){
      video.currentTime = item.lastPos || 0;
      video.playbackRate = (state.settings.perVideoSpeed && item.speed) ? item.speed : 1;
      $('speedBtn').textContent = video.playbackRate+'x';
      video.removeEventListener('loadedmetadata', onMeta);
      checkAudioOnly();
      setupAudioTracks();
    });
    video.play().then(()=>{ AudioEngine.ensureContext(video); AudioEngine.resume(); applyAudioSettings(); updateMediaSession(); }).catch(()=>{});
    resetControlsTimer();
    startAmbient();
    saveAllMeta();
    if(state.settings.highlights && item.file){
      AudioEngine.scanHighlights(item.file, item.duration, peaks => { state.highlightPeaks=peaks; renderHighlights(); });
    } else { state.highlightPeaks=[]; renderHighlights(); }
  }catch(err){
    $('convertOverlay').classList.add('hidden');
    flashSeek('Could not play this file','error');
    setTimeout(() => navTo('libraryScreen'), 1200);
  }
}
video.addEventListener('ended', () => {
  if(state.settings.autoNext && state.queue.length){
    showUpNext();
  }
});

/* ---------- Up Next countdown (replaces the old silent auto-skip) ---------- */
let upNextInterval = null;
function showUpNext(){
  const next = state.queue[0];
  if(!next) return;
  $('upNextThumb').src = next.thumb || '';
  $('upNextTitle').textContent = next.name;
  $('upNextCard').classList.remove('hidden');
  let remaining = 10;
  $('upNextCountdown').textContent = remaining;
  clearInterval(upNextInterval);
  upNextInterval = setInterval(() => {
    remaining--;
    $('upNextCountdown').textContent = Math.max(remaining,0);
    if(remaining<=0){ clearInterval(upNextInterval); advanceToNext(); }
  }, 1000);
}
function hideUpNext(){ $('upNextCard').classList.add('hidden'); clearInterval(upNextInterval); }
function advanceToNext(){ hideUpNext(); playNextInQueue(); }
$('upNextCancel').onclick = hideUpNext;
$('upNextPlay').onclick = advanceToNext;

$('netPlayBtn').onclick = () => {
  const url = $('netUrlInput').value.trim();
  if(!url) return;
  playFromAnyLink(url);
};
$('addLinkBtn').onclick = () => { $('addLinkModal').classList.remove('hidden'); $('addLinkInput').value=''; $('linkPreview').classList.add('hidden'); $('addLinkInput').focus(); };
$('addLinkCancel').onclick = () => $('addLinkModal').classList.add('hidden');
$('addLinkPlay').onclick = () => {
  const url = $('addLinkInput').value.trim();
  if(!url) return;
  $('addLinkModal').classList.add('hidden');
  playFromAnyLink(url);
};
let linkPreviewDebounce = null;
$('addLinkInput').addEventListener('input', e => {
  clearTimeout(linkPreviewDebounce);
  const url = e.target.value.trim();
  if(!url){ $('linkPreview').classList.add('hidden'); return; }
  linkPreviewDebounce = setTimeout(() => fetchLinkPreview(url), 500);
});
async function fetchLinkPreview(url){
  try{
    const res = await fetch('https://noembed.com/embed?url='+encodeURIComponent(url));
    const data = await res.json();
    if(data && (data.title || data.thumbnail_url)){
      $('linkPreviewImg').src = data.thumbnail_url || '';
      $('linkPreviewTitle').textContent = data.title || url;
      $('linkPreviewSource').textContent = data.provider_name || new URL(url).hostname;
      $('linkPreview').classList.remove('hidden');
    } else {
      $('linkPreview').classList.add('hidden');
    }
  }catch(e){ $('linkPreview').classList.add('hidden'); }
}

/* ---------- detect embeddable platform links vs direct file links ---------- */
/* This whole referrer problem was only ever caused by running on a file://
   origin (no page ever has a referrer under file://, and no proxy trick can
   invent one). Now that this app is hosted on a real https:// origin (e.g.
   GitHub Pages), the page itself CAN send YouTube a real referrer — so
   YouTube's own nocookie embed is tried directly, no proxy needed. This
   still won't work if you open the app from a file:// build again (the old
   packaged-app case) — EMBED_PROXY below is the fallback for exactly that
   scenario; see js/EMBED_PROXY_SETUP.md if you ever need it. */
const EMBED_PROXY = '';
function viaProxy(targetUrl){ return EMBED_PROXY + targetUrl; }
function isHttpOrigin(){ return location.protocol === 'http:' || location.protocol === 'https:'; }

function detectEmbed(url){
  try{
    const u = new URL(url);
    const host = u.hostname.replace('www.','');
    if(host==='youtube.com' || host==='m.youtube.com'){
      const id = u.searchParams.get('v') || (u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2] : null);
      if(!id) return null;
      if(isHttpOrigin()) return `https://www.youtube-nocookie.com/embed/${id}`;
      if(EMBED_PROXY) return viaProxy(`https://www.youtube-nocookie.com/embed/${id}`);
      return null;
    }
    if(host==='youtu.be'){
      const id = u.pathname.slice(1);
      if(!id) return null;
      if(isHttpOrigin()) return `https://www.youtube-nocookie.com/embed/${id}`;
      if(EMBED_PROXY) return viaProxy(`https://www.youtube-nocookie.com/embed/${id}`);
      return null;
    }
    if(host==='vimeo.com'){
      const id = u.pathname.split('/').filter(Boolean)[0];
      if(id) return `https://player.vimeo.com/video/${id}`;
    }
    if(host==='facebook.com' || host==='fb.watch'){
      return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0`;
    }
    if(host==='instagram.com'){
      const clean = url.split('?')[0];
      return clean.replace(/\/$/,'') + '/embed';
    }
    if(host==='tiktok.com'){
      const parts = u.pathname.split('/').filter(Boolean);
      const vid = parts[parts.length-1];
      if(vid && /^\d+$/.test(vid)) return `https://www.tiktok.com/player/v1/${vid}`;
    }
    if(host==='x.com' || host==='twitter.com'){
      return `https://platform.twitter.com/embed/Tweet.html?url=${encodeURIComponent(url)}`;
    }
    if(host==='dailymotion.com'){
      const id = u.pathname.split('/video/')[1];
      if(id) return `https://www.dailymotion.com/embed/video/${id.split('_')[0]}`;
    }
    if(host==='twitch.tv'){
      const parts = u.pathname.split('/').filter(Boolean);
      if(parts[0]==='videos') return `https://player.twitch.tv/?video=${parts[1]}&parent=${location.hostname||'localhost'}`;
      return `https://player.twitch.tv/?channel=${parts[0]}&parent=${location.hostname||'localhost'}`;
    }
    if(host==='soundcloud.com'){
      return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}`;
    }
    if(host==='reddit.com'){
      return `https://www.redditmedia.com/mediaembed/${u.pathname.split('/comments/')[1]?.split('/')[0]||''}`;
    }
    if(host==='streamable.com'){
      const id = u.pathname.split('/').filter(Boolean)[0];
      if(id) return `https://streamable.com/e/${id}`;
    }
    if(host==='drive.google.com'){
      const m = u.pathname.match(/\/d\/([^/]+)/);
      if(m) return `https://drive.google.com/file/d/${m[1]}/preview`;
    }
  }catch(e){}
  return null;
}

/* opens a URL outside this app entirely (system browser / the device's own
   YouTube app if installed) — used as the guaranteed-working fallback for
   YouTube, since this app runs on a file:// origin and YouTube's player now
   requires a real HTTP referrer that a file:// page can never send, no
   matter what markup or headers this project sets. */
function openExternal(url){
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
}
/* some titles/descriptions come back from APIs with literal HTML entities
   (e.g. &quot;) already baked into the text — decode them so they render
   as real characters instead of showing the escaped code literally. */
function decodeEntities(str){
  if(!str) return str;
  const ta = document.createElement('textarea');
  ta.innerHTML = str;
  return ta.value;
}

function playFromAnyLink(url, meta){
  savePosition();
  hideUpNext();
  meta = meta || {};
  meta.title = decodeEntities(meta.title);
  meta.artist = decodeEntities(meta.artist);
  let host = '';
  try{ host = new URL(url).hostname.replace('www.',''); }catch(e){}
  const isYouTube = host==='youtube.com' || host==='m.youtube.com' || host==='youtu.be';
  const embedUrl = detectEmbed(url);
  state.current = { id:'net_'+url, name: meta.title || (embedUrl ? 'Embedded video' : (isYouTube ? 'YouTube video' : 'Network Stream')), file:null, url, thumb:meta.thumb||null, duration:0, lastPos:0, favorite:false, isNetwork:true, size:0 };
  state.queue = [];
  $('nowPlayingTitle').textContent = state.current.name;
  updateFavIcon();
  navTo('playerScreen');
  hideAudioArtwork();
  $('externalOpenOverlay').classList.add('hidden');
  $('embedFallbackBtn').classList.add('hidden');

  if(isYouTube && !embedUrl){
    // no proxy configured (see EMBED_PROXY_SETUP.md) — this path is proven to
    // work every time, unlike guessing at another public proxy that might
    // fail the same way corsproxy.io and corsfix.com did.
    video.pause(); video.removeAttribute('src'); video.classList.add('hidden');
    $('embedFrame').classList.add('hidden'); $('embedFrame').src='';
    $('downloadBtn').classList.add('hidden');
    ['rewindBtn','forwardBtn','playPauseBtn','seekbar','speedBtn','displayModeBtn','rotateBtn','subtitleBtn','audioTrackBtn','bookmarkBtn','shotBtn','infoBtn'].forEach(id=>{ $(id).classList.add('disabled'); });
    $('externalThumb').src = meta.thumb || '';
    $('externalTitle').textContent = state.current.name;
    $('externalOpenOverlay').classList.remove('hidden');
    $('externalOpenBtn').onclick = () => openExternal(url);
    resetControlsTimer();
  } else if(embedUrl){
    video.pause(); video.removeAttribute('src'); video.classList.add('hidden');
    $('embedFrame').src = embedUrl;
    $('embedFrame').classList.remove('hidden');
    $('downloadBtn').classList.add('hidden');
    // most native controls don't apply to a third-party embedded player
    ['rewindBtn','forwardBtn','playPauseBtn','seekbar','speedBtn','displayModeBtn','rotateBtn','subtitleBtn','audioTrackBtn','bookmarkBtn','shotBtn','infoBtn'].forEach(id=>{ $(id).classList.add('disabled'); });
    // small always-available escape hatch: the proxy this routes through
    // (needed because this app's file:// origin can't send YouTube the
    // referrer it now requires) is a third-party service and can go down,
    // and some videos (age-restricted/region-locked) can't play in *any*
    // embedded player regardless — this stays one tap away instead of
    // leaving a dead player with no way out.
    $('embedFallbackBtn').classList.remove('hidden');
    $('embedFallbackBtn').onclick = () => openExternal(url);
    resetControlsTimer();
  } else {
    $('embedFrame').classList.add('hidden'); $('embedFrame').src='';
    video.classList.remove('hidden');
    ['rewindBtn','forwardBtn','playPauseBtn','seekbar','speedBtn','displayModeBtn','rotateBtn','subtitleBtn','audioTrackBtn','bookmarkBtn','shotBtn','infoBtn'].forEach(id=>{ $(id).classList.remove('disabled'); });
    applyColorFilters();
    video.src = url;
    video.addEventListener('loadedmetadata', checkAudioOnly, {once:true});
    video.play().then(()=>{ AudioEngine.ensureContext(video); AudioEngine.resume(); applyAudioSettings(); updateMediaSession(); }).catch(()=>{});
    resetControlsTimer(); startAmbient();
    $('downloadBtn').classList.remove('hidden');
    $('downloadBtn').onclick = () => {
      const a = document.createElement('a');
      const guessedExt = (url.split('?')[0].match(/\.([a-zA-Z0-9]{2,4})$/) || [,'mp4'])[1];
      a.href = url; a.download = (state.current && state.current.name ? state.current.name : 'redia-video') + '.' + guessedExt; a.target='_blank'; a.rel='noopener';
      document.body.appendChild(a); a.click(); a.remove();
    };
  }
  state.highlightPeaks=[]; renderHighlights();
}

/* ---------- audio-only "now playing" artwork (replaces the plain black screen) ---------- */
function checkAudioOnly(){
  if(video.videoWidth===0 && video.videoHeight===0){ showAudioArtwork(); }
  else { hideAudioArtwork(); }
}
function showAudioArtwork(){
  const art = $('audioArtwork');
  const thumb = state.current && state.current.thumb;
  $('audioArtworkImg').src = thumb || '';
  $('audioArtworkImg').classList.toggle('hidden', !thumb);
  $('audioArtworkFallback').classList.toggle('hidden', !!thumb);
  $('audioArtworkBg').style.backgroundImage = thumb ? `url(${thumb})` : 'none';
  $('audioArtworkTitle').textContent = (state.current && state.current.name) || '';
  art.classList.remove('hidden');
  startVisualizer();
}
function hideAudioArtwork(){ $('audioArtwork').classList.add('hidden'); stopVisualizer(); }

let visualizerRAF = null;
function startVisualizer(){
  stopVisualizer();
  const canvas = $('visualizerCanvas');
  const ctx2d = canvas.getContext('2d');
  function resize(){ canvas.width = canvas.clientWidth * devicePixelRatio; canvas.height = canvas.clientHeight * devicePixelRatio; }
  resize();
  function draw(){
    const data = AudioEngine.getFrequencyData();
    ctx2d.clearRect(0,0,canvas.width,canvas.height);
    if(data){
      const barCount = data.length;
      const barWidth = canvas.width / barCount * 0.7;
      const gap = canvas.width / barCount * 0.3;
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || '#22d3ee';
      ctx2d.fillStyle = accent;
      for(let i=0;i<barCount;i++){
        const h = Math.max(3, (data[i]/255) * canvas.height);
        const x = i*(barWidth+gap);
        ctx2d.fillRect(x, canvas.height-h, barWidth, h);
      }
    }
    visualizerRAF = requestAnimationFrame(draw);
  }
  draw();
}
function stopVisualizer(){ if(visualizerRAF) cancelAnimationFrame(visualizerRAF); visualizerRAF=null; }

$('backBtn').onclick = () => {
  savePosition();
  video.pause();
  hideUpNext();
  hideAudioArtwork();
  $('embedFrame').src=''; $('embedFrame').classList.add('hidden');
  $('externalOpenOverlay').classList.add('hidden');
  $('embedFallbackBtn').classList.add('hidden');
  stopAmbient();
  clearTimeout(state.sleepTimer);
  navTo('homeScreen');
};

function savePosition(){
  if(!state.current || state.current.isNetwork) return;
  state.current.lastPos = video.currentTime;
  saveAllMeta();
}
video.addEventListener('timeupdate', () => { updateTimeUI(); if(Math.floor(video.currentTime)%5===0) savePosition(); });
window.addEventListener('beforeunload', savePosition);

/* play/pause */
$('playPauseBtn').onclick = togglePlay;
function togglePlay(){
  if(video.paused){ video.play(); setIcon('playPauseBtn','i-pause'); }
  else { video.pause(); setIcon('playPauseBtn','i-play'); }
  resetControlsTimer();
}
function setIcon(btnId, symbolId){ $(btnId).querySelector('use').setAttribute('href', '#'+symbolId); }
video.addEventListener('play', ()=> setIcon('playPauseBtn','i-pause'));
video.addEventListener('pause', ()=> setIcon('playPauseBtn','i-play'));

/* skip */
$('rewindBtn').onclick = () => { video.currentTime = Math.max(0,video.currentTime-state.settings.skipDuration); haptic(); resetControlsTimer(); };
$('forwardBtn').onclick = () => { video.currentTime = Math.min(video.duration,video.currentTime+state.settings.skipDuration); haptic(); resetControlsTimer(); };
$('rwLabel').textContent = state.settings.skipDuration;
$('fwLabel').textContent = state.settings.skipDuration;

/* seekbar + highlights */
function updateTimeUI(){
  if(!video.duration) return;
  $('seekbar').value = (video.currentTime/video.duration)*100;
  $('currentTime').textContent = fmt(video.currentTime);
  $('durationTime').textContent = fmt(video.duration);
  if(video.buffered.length){
    const end = video.buffered.end(video.buffered.length-1);
    $('bufferedBar').style.width = ((end/video.duration)*100)+'%';
  }
}
$('seekbar').addEventListener('input', e => { if(video.duration) video.currentTime=(e.target.value/100)*video.duration; resetControlsTimer(); });
function renderHighlights(){
  const track = $('highlightTrack'); track.innerHTML='';
  if(!video.duration || !state.highlightPeaks.length) return;
  state.highlightPeaks.forEach(sec => {
    const dot = document.createElement('div');
    dot.style.cssText = `position:absolute;top:0;width:3px;height:4px;border-radius:2px;background:var(--accent-2);left:${(sec/video.duration)*100}%;`;
    track.appendChild(dot);
  });
}
video.addEventListener('loadedmetadata', renderHighlights);

/* favorite */
function updateFavIcon(){ setIcon('favBtn', state.current && state.current.favorite ? 'i-heart-fill' : 'i-heart'); }
$('favBtn').onclick = () => {
  if(!state.current || state.current.isNetwork) return;
  state.current.favorite = !state.current.favorite;
  updateFavIcon(); saveAllMeta(); haptic();
};

/* fullscreen / PiP / mute */
$('fullscreenBtn').onclick = async () => {
  const s=$('playerStage');
  if(!document.fullscreenElement){
    try{ await s.requestFullscreen?.(); }catch(e){}
    try{ await screen.orientation.lock('landscape'); }catch(e){ /* some devices/WebViews restrict lock; fullscreen still applies */ }
  } else {
    try{ screen.orientation.unlock?.(); }catch(e){}
    document.exitFullscreen?.();
  }
};
$('pipBtn').onclick = async () => { try{ if(document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.requestPictureInPicture(); }catch(e){} };
$('volumeBtn').onclick = () => { video.muted=!video.muted; setIcon('volumeBtn', video.muted?'i-mute':'i-volume'); };

/* ---------- speed ---------- */
const SPEED_PRESETS=[0.25,0.5,0.75,1,1.25,1.5,1.75,2,2.5,3,4];
$('speedPresets').innerHTML = SPEED_PRESETS.map(s=>`<span data-s="${s}" class="${s===1?'active':''}">${s}x</span>`).join('');
$('speedBtn').onclick = () => togglePop('speedMenu');
$('speedPresets').addEventListener('click', e => {
  if(e.target.dataset.s){ setSpeed(parseFloat(e.target.dataset.s)); document.querySelectorAll('#speedPresets span').forEach(s=>s.classList.toggle('active', s===e.target)); }
});
$('speedSlider').addEventListener('input', e => setSpeed(parseFloat(e.target.value)));
$('pitchPreserve').addEventListener('change', e => { try{ video.preservesPitch=e.target.checked; video.mozPreservesPitch=e.target.checked; }catch(err){} });
function setSpeed(sp){
  video.playbackRate = sp;
  $('speedVal').textContent = sp.toFixed(2)+'x';
  $('speedBtn').textContent = sp+'x';
  $('speedSlider').value = sp;
  if(state.settings.perVideoSpeed && state.current && !state.current.isNetwork){ state.current.speed = sp; saveAllMeta(); }
}

/* ---------- long-press 2x boost ---------- */
$('zoneCenter').addEventListener('touchstart', () => {
  if(!state.settings.longPressSpeed) return;
  state.longPressTimer = setTimeout(()=>{
    state.wasSpeedBoosted = true;
    video.playbackRate = 2;
    $('speedBoostBadge').classList.remove('hidden');
    haptic();
  }, 450);
}, {passive:true});
$('zoneCenter').addEventListener('touchend', () => {
  clearTimeout(state.longPressTimer);
  if(state.wasSpeedBoosted){
    video.playbackRate = state.current && state.current.speed ? state.current.speed : 1;
    $('speedBoostBadge').classList.add('hidden');
    state.wasSpeedBoosted = false;
  }
});

/* ---------- display mode ---------- */
$('displayModeBtn').onclick = () => togglePop('displayModeMenu');
document.querySelectorAll('#displayModeMenu .pop-item').forEach(el=>{
  el.onclick = () => { setDisplayMode(el.dataset.mode); togglePop(''); };
});
function setDisplayMode(mode){
  state.displayMode = mode;
  video.classList.remove('mode-cover','mode-fill','mode-zoom','mode-original');
  if(mode==='cover') video.classList.add('mode-cover');
  else if(mode==='fill') video.classList.add('mode-fill');
  else if(mode==='zoom') video.classList.add('mode-zoom');
  else if(mode==='original') video.classList.add('mode-original');
}

/* ---------- rotation ---------- */
$('rotateBtn').onclick = () => setRotation((state.rotation+90)%360);
function setRotation(deg){
  state.rotation = deg;
  $('videoWrap').style.transform = deg ? `rotate(${deg}deg)` : '';
}

/* ---------- subtitles ---------- */
$('subtitleBtn').onclick = () => togglePop('subtitleMenu');
$('loadSubtitleItem').onclick = () => $('subtitleInput').click();
$('subtitleInput').addEventListener('change', e => {
  const file = e.target.files[0]; if(!file) return;
  const url = URL.createObjectURL(file);
  document.querySelectorAll('track').forEach(t=>t.remove());
  const track = document.createElement('track');
  track.kind='subtitles'; track.label=file.name; track.srclang='en'; track.src=url; track.default=true;
  video.appendChild(track);
  setTimeout(()=>{ if(video.textTracks[0]) video.textTracks[0].mode='showing'; applySubtitleStyle(); }, 300);
  togglePop('');
});
$('subDelay').addEventListener('input', e => {
  state.settings.subDelay = parseFloat(e.target.value);
  $('subDelayVal').textContent = state.settings.subDelay.toFixed(1)+'s';
  saveSettings();
  // shift cue timings by delay (best-effort, applies to currently loaded track)
  if(video.textTracks[0] && video.textTracks[0].cues){
    Array.from(video.textTracks[0].cues).forEach(cue=>{
      if(cue._origStart===undefined){ cue._origStart=cue.startTime; cue._origEnd=cue.endTime; }
      cue.startTime = Math.max(0, cue._origStart + state.settings.subDelay);
      cue.endTime = Math.max(0, cue._origEnd + state.settings.subDelay);
    });
  }
});

/* ---------- audio tracks + EQ presets ---------- */
function setupAudioTracks(){
  const list = $('audioTrackList'); list.innerHTML='';
  if(video.audioTracks && video.audioTracks.length>1){
    for(let i=0;i<video.audioTracks.length;i++){
      const t = video.audioTracks[i];
      const row = document.createElement('div');
      row.className='pop-item'+(t.enabled?' active':'');
      row.textContent = t.label || t.language || ('Track '+(i+1));
      row.onclick = () => { for(let j=0;j<video.audioTracks.length;j++) video.audioTracks[j].enabled=(j===i); setupAudioTracks(); };
      list.appendChild(row);
    }
  } else {
    list.innerHTML = `<div class="pop-item" style="color:var(--text-dim)">Single audio track</div>`;
  }
}
$('audioTrackBtn').onclick = () => togglePop('audioTrackMenu');
const EQ_PRESETS = {
  flat:{bassDb:0,midDb:0,trebleDb:0}, bass:{bassDb:9,midDb:1,trebleDb:0}, treble:{bassDb:0,midDb:1,trebleDb:8},
  vocal:{bassDb:-3,midDb:7,trebleDb:2}, movie:{bassDb:4,midDb:0,trebleDb:3}, night:{bassDb:-6,midDb:2,trebleDb:-4}
};
$('eqPresetSelect').addEventListener('change', e => {
  Object.assign(state.settings, EQ_PRESETS[e.target.value]);
  ['eqBass','eqMid','eqTreble'].forEach(id=>{}); syncEqSlidersFromState(); applyAudioSettings(); saveSettings();
});
$('eqMono').addEventListener('change', e => { state.settings.mono=e.target.checked; applyAudioSettings(); saveSettings(); });
$('eqWide').addEventListener('change', e => { state.settings.wide=e.target.checked; applyAudioSettings(); saveSettings(); });
function syncEqSlidersFromState(){
  $('eqBass').value=state.settings.bassDb; $('eqMid').value=state.settings.midDb; $('eqTreble').value=state.settings.trebleDb;
}

/* ---------- bookmarks ---------- */
$('bookmarkBtn').onclick = () => { renderBookmarks(); togglePop('bookmarkMenu'); };
$('addBookmarkBtn').onclick = () => {
  if(!state.current || state.current.isNetwork) return;
  const label = prompt('Bookmark label (optional):', fmt(video.currentTime)) || fmt(video.currentTime);
  state.current.bookmarks = state.current.bookmarks || [];
  state.current.bookmarks.push({ t: video.currentTime, label });
  saveAllMeta(); renderBookmarks(); haptic(); flashSeek('Bookmark added','success');
};
function renderBookmarks(){
  const list = $('bookmarkList'); list.innerHTML='';
  const bms = (state.current && state.current.bookmarks) || [];
  if(!bms.length){ list.innerHTML = `<div class="pop-item" style="color:var(--text-dim)">No bookmarks yet</div>`; return; }
  bms.sort((a,b)=>a.t-b.t).forEach((b,idx)=>{
    const row = document.createElement('div');
    row.className='bookmark-row';
    row.innerHTML = `<span>${b.label} · ${fmt(b.t)}</span>`;
    const del = document.createElement('button');
    del.innerHTML = '✕'; del.style.cssText='color:var(--text-dim);font-size:12px;';
    del.onclick = (ev) => { ev.stopPropagation(); state.current.bookmarks.splice(idx,1); saveAllMeta(); renderBookmarks(); };
    row.appendChild(del);
    row.onclick = () => { video.currentTime = b.t; togglePop(''); };
    list.appendChild(row);
  });
}

/* ---------- screenshot ---------- */
$('shotBtn').onclick = () => {
  const canvas = $('shotCanvas');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  try{
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    const link = document.createElement('a');
    link.download = (state.current?state.current.name:'redia-shot') + '_' + Math.floor(video.currentTime) + 's.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    $('flashOverlay').classList.remove('hidden'); $('flashOverlay').classList.add('flash');
    setTimeout(()=>{ $('flashOverlay').classList.remove('flash'); $('flashOverlay').classList.add('hidden'); }, 400);
    haptic();
  }catch(e){ flashSeek('Screenshot unavailable for this source','error'); }
};

/* ---------- video info ---------- */
$('infoBtn').onclick = () => {
  const it = state.current; if(!it) return;
  const lines = [
    ['File name', it.name],
    ['Duration', fmt(video.duration)],
    ['Resolution', video.videoWidth+' × '+video.videoHeight],
    ['File size', fmtSize(it.size)],
    ['Type', it.type||'network stream'],
    ['Modified', it.lastModified ? new Date(it.lastModified).toLocaleDateString() : '—'],
    ['Playback speed', video.playbackRate+'x'],
  ];
  $('infoContent').innerHTML = lines.map(([k,v])=>`<div class="info-line"><span>${k}</span><span>${v}</span></div>`).join('');
  togglePop('infoSheet');
};

/* ---------- queue popover ---------- */
$('queueBtn').onclick = () => { renderQueueMenu(); togglePop('queueMenu'); };

/* ---------- popover management ---------- */
const ALL_POPS = ['speedMenu','displayModeMenu','subtitleMenu','audioTrackMenu','bookmarkMenu','queueMenu','infoSheet'];
function togglePop(id){
  ALL_POPS.forEach(p => { if(p!==id) $(p).classList.add('hidden'); });
  if(id) $(id).classList.toggle('hidden');
}

document.addEventListener('fullscreenchange', () => {
  if(!document.fullscreenElement){ try{ screen.orientation.unlock?.(); }catch(e){} }
});

/* ---------- controls auto-hide ---------- */
function resetControlsTimer(){
  const overlay = $('controlsOverlay');
  overlay.classList.remove('hide');
  clearTimeout(state.controlsTimer);
  state.controlsTimer = setTimeout(()=>{ if(!video.paused) overlay.classList.add('hide'); }, 3500);
}
$('zoneCenter').addEventListener('click', () => {
  toggleControlsOrClosePops();
});

/* real cause of "second tap doesn't hide controls": the visible controls-overlay
   sits on top of the gesture-layer and swallows taps landing on its empty gap
   areas (between the top/center/bottom control groups) since it had no handler
   of its own — so this listens directly on the overlay and only skips taps that
   land on an actual button, letting every other tap toggle it closed. */
$('controlsOverlay').addEventListener('click', (e) => {
  if(e.target.closest('button, input, label, a')) return;
  toggleControlsOrClosePops();
});

/* double-tap seek + single-tap toggle controls (unified so left/right zones also toggle) */
function toggleControlsOrClosePops(){
  if(!ALL_POPS.every(p => $(p).classList.contains('hidden'))){ togglePop(''); return; }
  const overlay = $('controlsOverlay');
  overlay.classList.toggle('hide');
  if(!overlay.classList.contains('hide')) resetControlsTimer();
}
function makeTapZone(el, onDoubleTap){
  let tapTimer = null;
  el.addEventListener('click', () => {
    if(tapTimer){
      clearTimeout(tapTimer); tapTimer = null;
      onDoubleTap();
    } else {
      tapTimer = setTimeout(() => { tapTimer = null; toggleControlsOrClosePops(); }, 260);
    }
  });
}
makeTapZone($('zoneLeft'), () => { video.currentTime=Math.max(0,video.currentTime-state.settings.skipDuration); flashSeek('⏪ '+state.settings.skipDuration+'s'); haptic(); });
makeTapZone($('zoneRight'), () => { video.currentTime=Math.min(video.duration,video.currentTime+state.settings.skipDuration); flashSeek(state.settings.skipDuration+'s ⏩'); haptic(); });
function flashSeek(text, type){ const el=$('seekFlash'); el.textContent=text; el.className='seek-flash glass show'+(type?' '+type:''); setTimeout(()=>el.classList.remove('show'),600); }

/* swipe gestures */
const gesture = { active:false, startY:0, startVal:0, type:null };
function attachSwipe(el, type){
  el.addEventListener('touchstart',e=>{
    if(!state.settings.gestureSwipe) return;
    const t=e.touches[0];
    gesture.active=true; gesture.startY=t.clientY; gesture.type=type;
    gesture.startVal = type==='volume' ? video.volume : brightnessVal;
  },{passive:true});
  el.addEventListener('touchmove',e=>{
    if(!gesture.active) return;
    const t=e.touches[0];
    const delta=(gesture.startY-t.clientY)/250;
    let val=Math.min(1,Math.max(0, gesture.startVal+delta));
    if(type==='volume'){ video.volume=val; video.muted=val===0; showGesture('🔊',val); }
    else { setBrightness(val); showGesture('🔆',val); }
  },{passive:true});
  el.addEventListener('touchend',()=>{ gesture.active=false; $('gestureIndicator').classList.add('hidden'); });
}
attachSwipe($('zoneRight'),'volume');
attachSwipe($('zoneLeft'),'brightness');
let brightnessVal=1;
function setBrightness(v){ brightnessVal=v; applyColorFilters(); }
function showGesture(icon,val){ $('gestureIndicator').classList.remove('hidden'); $('giIcon').textContent=icon; $('giFill').style.height=(val*100)+'%'; }
function haptic(){ if(state.settings.haptics) AudioEngine.haptic(12); }

/* ---------- background/lock-screen playback (Media Session API) ---------- */
/* This is the real, correct mechanism for "keep playing when the screen is
   off or the app is backgrounded" on mobile web — it tells the OS this is
   legitimate media playback, which is what keeps audio going and shows
   proper lock-screen/notification controls (play/pause/seek/skip), the same
   system every music PWA relies on. It only meaningfully controls audio
   continuing in the background — a video's picture pausing when the screen
   is off is expected everywhere (there's nothing to see), the audio track
   is what actually matters here and is what this keeps alive. */
function updateMediaSession(){
  if(!('mediaSession' in navigator)) return;
  const item = state.current;
  if(!item) return;
  const artwork = item.thumb ? [
    { src: item.thumb, sizes: '512x512', type: 'image/jpeg' }
  ] : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: item.name || 'Redia Play',
    artist: 'Redia Play',
    artwork
  });
  navigator.mediaSession.setActionHandler('play', () => { video.play(); });
  navigator.mediaSession.setActionHandler('pause', () => { video.pause(); });
  navigator.mediaSession.setActionHandler('seekbackward', () => { video.currentTime = Math.max(0, video.currentTime - state.settings.skipDuration); });
  navigator.mediaSession.setActionHandler('seekforward', () => { video.currentTime = Math.min(video.duration||Infinity, video.currentTime + state.settings.skipDuration); });
  navigator.mediaSession.setActionHandler('previoustrack', null);
  navigator.mediaSession.setActionHandler('nexttrack', state.queue.length ? () => playNextInQueue() : null);
}
function syncMediaSessionPlaybackState(){
  if(!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = video.paused ? 'paused' : 'playing';
}
video.addEventListener('play', syncMediaSessionPlaybackState);
video.addEventListener('pause', syncMediaSessionPlaybackState);
video.addEventListener('timeupdate', () => {
  if(!('mediaSession' in navigator) || !video.duration || isNaN(video.duration)) return;
  try{
    navigator.mediaSession.setPositionState({
      duration: video.duration,
      playbackRate: video.playbackRate || 1,
      position: Math.min(video.currentTime, video.duration)
    });
  }catch(e){}
});

/* ---------- color filters ---------- */
function applyColorFilters(){
  const s = state.settings;
  const gestureBrightness = 40 + brightnessVal*60;
  video.style.filter =
    `brightness(${(s.brightness/100)*(gestureBrightness/100)}) contrast(${s.contrast}%) saturate(${s.saturation}%) ` +
    `sepia(${s.warmth>0? s.warmth/3 : 0}%) hue-rotate(${s.warmth<0? s.warmth*0.6:0}deg)`;
}
const COLOR_PRESETS = {
  Original:{brightness:100,contrast:100,saturation:100,warmth:0},
  Cinema:{brightness:95,contrast:115,saturation:90,warmth:-10},
  Vivid:{brightness:105,contrast:120,saturation:140,warmth:5},
  Warm:{brightness:100,contrast:105,saturation:110,warmth:25},
  Cool:{brightness:100,contrast:105,saturation:105,warmth:-25},
  Night:{brightness:70,contrast:90,saturation:80,warmth:-15}
};
$('colorPresets').innerHTML = Object.keys(COLOR_PRESETS).map(n=>`<span data-p="${n}">${n}</span>`).join('');
$('colorPresets').addEventListener('click', e=>{
  const p = COLOR_PRESETS[e.target.dataset.p]; if(!p) return;
  Object.assign(state.settings, p);
  $('setBrightness').value=p.brightness; $('setContrast').value=p.contrast; $('setSaturation').value=p.saturation; $('setWarmth').value=p.warmth;
  document.querySelectorAll('#colorPresets span').forEach(s=>s.classList.toggle('active', s===e.target));
  applyColorFilters(); saveSettings();
});

/* ---------- ambient dynamic lighting ---------- */
const ambientCanvas = $('ambientCanvas');
const actx = ambientCanvas.getContext('2d', { willReadFrequently:true });
function startAmbient(){ stopAmbient(); if(!state.settings.ambient) return; state.ambientTimer=setInterval(sampleAmbient,1400); }
function stopAmbient(){ clearInterval(state.ambientTimer); }
function sampleAmbient(){
  if(video.paused || video.readyState<2) return;
  try{
    actx.drawImage(video,0,0,16,9);
    const data = actx.getImageData(0,0,16,9).data;
    let r1=0,g1=0,b1=0,r2=0,g2=0,b2=0,n1=0,n2=0;
    for(let i=0;i<data.length;i+=4){
      const x=(i/4)%16;
      if(x<8){ r1+=data[i];g1+=data[i+1];b1+=data[i+2];n1++; } else { r2+=data[i];g2+=data[i+1];b2+=data[i+2];n2++; }
    }
    document.documentElement.style.setProperty('--ambient-1', `rgb(${r1/n1|0},${g1/n1|0},${b1/n1|0})`);
    document.documentElement.style.setProperty('--ambient-2', `rgb(${r2/n2|0},${g2/n2|0},${b2/n2|0})`);
  }catch(e){}
}

/* ---------- audio settings application ---------- */
function applyAudioSettings(){
  const s = state.settings;
  AudioEngine.setEQ({ bassDb:s.bassDb, midDb:s.midDb, trebleDb:s.trebleDb });
  AudioEngine.setWide(s.wide);
  AudioEngine.setBoost((s.volumeBoost||100)/100);
}

/* ---------- subtitle style ---------- */
function applySubtitleStyle(){
  const s = state.settings;
  let styleTag = document.getElementById('dynamicSubStyle');
  if(!styleTag){ styleTag=document.createElement('style'); styleTag.id='dynamicSubStyle'; document.head.appendChild(styleTag); }
  styleTag.textContent = `video::cue{font-size:${s.subSize}px;color:${s.subColor};background:rgba(0,0,0,${s.subBg/100});font-weight:600;}`;
}

/* ================= PLAYER QUICK SETTINGS DRAWER ================= */
$('playerSettingsBtn').onclick = () => $('settingsDrawer').classList.remove('hidden');
$('closeSettingsBtn').onclick = () => $('settingsDrawer').classList.add('hidden');
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active'); $('tab-'+btn.dataset.tab).classList.add('active');
  };
});
function bindRange(id,key,cb){
  $(id).value = state.settings[key];
  $(id).addEventListener('input', e => { state.settings[key]=parseFloat(e.target.value); saveSettings(); if(cb) cb(); });
}
bindRange('setBrightness','brightness',applyColorFilters);
bindRange('setContrast','contrast',applyColorFilters);
bindRange('setSaturation','saturation',applyColorFilters);
bindRange('setWarmth','warmth',applyColorFilters);
$('resetColorBtn').onclick = () => {
  Object.assign(state.settings, COLOR_PRESETS.Original);
  $('setBrightness').value=100; $('setContrast').value=100; $('setSaturation').value=100; $('setWarmth').value=0;
  applyColorFilters(); saveSettings();
};
bindRange('eqBass','bassDb',applyAudioSettings);
bindRange('eqMid','midDb',applyAudioSettings);
bindRange('eqTreble','trebleDb',applyAudioSettings);
bindRange('eqBalance','balance',applyAudioSettings);
$('volumeBoost').value = state.settings.volumeBoost;
$('volumeBoostVal').textContent = state.settings.volumeBoost+'%';
$('volumeBoost').addEventListener('input', e => {
  state.settings.volumeBoost = parseInt(e.target.value);
  $('volumeBoostVal').textContent = state.settings.volumeBoost+'%';
  applyAudioSettings(); saveSettings();
});
$('setHighlights').checked = state.settings.highlights;
$('setHighlights').addEventListener('change', e => { state.settings.highlights=e.target.checked; saveSettings(); });
bindRange('subSize','subSize',applySubtitleStyle);
bindRange('subBg','subBg',applySubtitleStyle);
document.querySelectorAll('.swatch').forEach(sw=>{
  sw.onclick = () => { document.querySelectorAll('.swatch').forEach(s=>s.classList.remove('active')); sw.classList.add('active');
    state.settings.subColor=sw.dataset.color; applySubtitleStyle(); saveSettings(); };
});

/* close popups on outside tap */
document.addEventListener('click', e => {
  ALL_POPS.forEach(id=>{ const el=$(id); if(el && !el.classList.contains('hidden') && !el.contains(e.target)){
    const btnMap={speedMenu:'speedBtn',displayModeMenu:'displayModeBtn',subtitleMenu:'subtitleBtn',audioTrackMenu:'audioTrackBtn',bookmarkMenu:'bookmarkBtn',queueMenu:'queueBtn',infoSheet:'infoBtn'};
    if(e.target.id !== btnMap[id] && !e.target.closest('#'+btnMap[id])) el.classList.add('hidden');
  }});
});

/* ================= FULL SETTINGS PAGE ================= */
Object.keys(THEMES).forEach((name)=>{
  const sw = document.createElement('div');
  sw.className='theme-sw'+(state.settings.theme===name?' active':'');
  sw.style.background = `linear-gradient(135deg,${THEMES[name][0]},${THEMES[name][1]})`;
  sw.onclick = () => {
    state.settings.theme = name;
    document.querySelectorAll('.theme-sw').forEach(s=>s.classList.remove('active'));
    sw.classList.add('active');
    applyTheme(); saveSettings();
  };
  $('themeSwatches').appendChild(sw);
});
function applyTheme(){
  const [a1,a2] = THEMES[state.settings.theme] || THEMES.violet;
  document.documentElement.style.setProperty('--accent', a1);
  document.documentElement.style.setProperty('--accent-2', a2);
  document.documentElement.style.setProperty('--ambient-1', a1);
  document.documentElement.style.setProperty('--ambient-2', a2);
}
$('lightModeToggle').checked = state.settings.light;
$('lightModeToggle').addEventListener('change', e => { state.settings.light=e.target.checked; document.body.classList.toggle('light', e.target.checked); saveSettings(); });
$('setAmbient').checked = state.settings.ambient;
$('setAmbient').addEventListener('change', e => { state.settings.ambient=e.target.checked; if(e.target.checked) startAmbient(); else stopAmbient(); saveSettings(); });
$('setReduceMotion').checked = state.settings.reduceMotion;
document.body.classList.toggle('no-motion', state.settings.reduceMotion);
$('setReduceMotion').addEventListener('change', e => { state.settings.reduceMotion=e.target.checked; document.body.classList.toggle('no-motion', e.target.checked); saveSettings(); });
$('setPerVideoSpeed').checked = state.settings.perVideoSpeed;
$('setPerVideoSpeed').addEventListener('change', e => { state.settings.perVideoSpeed=e.target.checked; saveSettings(); });
$('setAutoNext').checked = state.settings.autoNext;
$('setAutoNext').addEventListener('change', e => { state.settings.autoNext=e.target.checked; saveSettings(); });
$('setSkipDuration').value = state.settings.skipDuration;
$('setSkipDuration').addEventListener('change', e => { state.settings.skipDuration=parseInt(e.target.value); $('rwLabel').textContent=state.settings.skipDuration; $('fwLabel').textContent=state.settings.skipDuration; saveSettings(); });
$('setGestureSwipe').checked = state.settings.gestureSwipe;
$('setGestureSwipe').addEventListener('change', e => { state.settings.gestureSwipe=e.target.checked; saveSettings(); });
$('setLongPressSpeed').checked = state.settings.longPressSpeed;
$('setLongPressSpeed').addEventListener('change', e => { state.settings.longPressSpeed=e.target.checked; saveSettings(); });
$('setHaptics').checked = state.settings.haptics;
$('setHaptics').addEventListener('change', e => { state.settings.haptics=e.target.checked; saveSettings(); });
$('clearCacheBtn').onclick = () => { indexedDB.deleteDatabase('redia_format_cache'); alert('Cache cleared'); };


$('clearLibraryBtn').onclick = () => {
  if(!confirm('This removes every video remembered on this device (files themselves are untouched, you\'ll just need to re-add them). Continue?')) return;
  BlobStore.clear().then(() => { flashSeekGlobal('Library storage cleared','success'); updateStorageUsageText(); });
};
function updateStorageUsageText(){
  BlobStore.estimateUsage().then(est => {
    if(est && est.usage!==undefined){
      const usedMB = (est.usage/1048576).toFixed(0);
      const quotaMB = est.quota ? (est.quota/1048576).toFixed(0) : null;
      $('storageUsageText').textContent = quotaMB ? `${usedMB} MB used of ~${quotaMB} MB available` : `${usedMB} MB used`;
    } else {
      $('storageUsageText').textContent = 'Not available on this device';
    }
  }).catch(()=>{ $('storageUsageText').textContent = 'Not available on this device'; });
}
updateStorageUsageText();

/* ================= INIT ================= */
loadSettings();
state.playlists = loadPlaylists();
state.recentSearches = loadSearches();
applyTheme();
document.body.classList.toggle('light', state.settings.light);
applySubtitleStyle();
navTo('homeScreen');
restoreFromBlobStore();

// only registers when served over http(s) (GitHub Pages, etc.) — silently
// does nothing under file://, so this is safe to leave in either way
if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
}
