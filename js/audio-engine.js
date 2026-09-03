/* ============ Redia Play — Audio Engine ============
   Real Web Audio API chain: source -> bass/mid/treble filters -> optional
   stereo widener -> destination. Also does a lightweight loudness scan
   (RMS per second) to place "Smart Highlight" markers on the seekbar —
   this is an audio-loudness heuristic, not scene/dialogue recognition.
*/
const AudioEngine = (() => {
  let ctx = null, sourceNode = null, bass, mid, treble, widenerL, widenerR, merger, splitter, connectedEl = null, boostGain, boostLimiter, analyser;

  function ensureContext(videoEl){
    if(ctx && connectedEl === videoEl) return;
    if(ctx){ try{ ctx.close(); }catch(e){} }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = ctx.createMediaElementSource(videoEl);
    connectedEl = videoEl;

    bass = ctx.createBiquadFilter(); bass.type='lowshelf'; bass.frequency.value=200;
    mid = ctx.createBiquadFilter(); mid.type='peaking'; mid.frequency.value=1000; mid.Q.value=0.9;
    treble = ctx.createBiquadFilter(); treble.type='highshelf'; treble.frequency.value=4000;

    splitter = ctx.createChannelSplitter(2);
    merger = ctx.createChannelMerger(2);
    widenerL = ctx.createGain(); widenerR = ctx.createGain();
    widenerL.gain.value = 1; widenerR.gain.value = 1;

    // volume boost stage (100%-600%) — a limiter sits after it so pushing past
    // 100% doesn't just harshly clip the audio, same approach volume-booster
    // extensions use.
    boostGain = ctx.createGain(); boostGain.gain.value = 1;
    boostLimiter = ctx.createDynamicsCompressor();
    boostLimiter.threshold.value = -6; boostLimiter.knee.value = 12;
    boostLimiter.ratio.value = 12; boostLimiter.attack.value = 0.003; boostLimiter.release.value = 0.25;

    sourceNode.connect(bass).connect(mid).connect(treble);
    treble.connect(splitter);
    splitter.connect(widenerL, 0);
    splitter.connect(widenerR, 1);
    widenerL.connect(merger, 0, 0);
    widenerR.connect(merger, 0, 1);
    merger.connect(boostGain);
    boostGain.connect(boostLimiter);
    boostLimiter.connect(ctx.destination);

    analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    boostLimiter.connect(analyser);
  }

  function getFrequencyData(){
    if(!analyser) return null;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    return data;
  }

  function setEQ({ bassDb=0, midDb=0, trebleDb=0 }){
    if(!ctx) return;
    bass.gain.value = bassDb;
    mid.gain.value = midDb;
    treble.gain.value = trebleDb;
  }

  /* multiplier: 1 = 100% (normal, untouched), up to 6 = 600% */
  function setBoost(multiplier){
    if(!ctx) return;
    boostGain.gain.value = Math.max(1, Math.min(6, multiplier));
  }

  function setWide(enabled){
    if(!ctx) return;
    // simple perceived-widening via slight gain differential + panner-esque split
    widenerL.gain.value = enabled ? 1.15 : 1;
    widenerR.gain.value = enabled ? 1.15 : 1;
  }

  function resume(){ if(ctx && ctx.state==='suspended') ctx.resume(); }

  /* ---------- loudness-based highlight scan ---------- */
  async function scanHighlights(file, durationHint, onDone){
    try{
      const arrayBuf = await file.arrayBuffer();
      const offlineCtxProto = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if(!offlineCtxProto) return onDone([]);
      const tmpCtx = new (window.AudioContext||window.webkitAudioContext)();
      const audioBuffer = await tmpCtx.decodeAudioData(arrayBuf.slice(0));
      tmpCtx.close();

      const data = audioBuffer.getChannelData(0);
      const sr = audioBuffer.sampleRate;
      const chunkSize = sr; // 1 second chunks
      const chunks = Math.floor(data.length / chunkSize);
      const loudness = [];
      for(let i=0;i<chunks;i++){
        let sum=0;
        const start = i*chunkSize;
        for(let j=0;j<chunkSize;j+=50){ // sample sparsely for speed
          const v = data[start+j] || 0;
          sum += v*v;
        }
        loudness.push(Math.sqrt(sum/(chunkSize/50)));
      }
      // find peaks: local maxima above 75th percentile
      const sorted = [...loudness].sort((a,b)=>a-b);
      const threshold = sorted[Math.floor(sorted.length*0.8)] || 0;
      const peaks = [];
      for(let i=1;i<loudness.length-1;i++){
        if(loudness[i] > threshold && loudness[i] >= loudness[i-1] && loudness[i] >= loudness[i+1]){
          peaks.push(i); // seconds
        }
      }
      onDone(peaks);
    }catch(e){
      console.log('Highlight scan skipped', e);
      onDone([]);
    }
  }

  function haptic(pattern=10){
    try{ navigator.vibrate && navigator.vibrate(pattern); }catch(e){}
  }

  return { ensureContext, setEQ, setWide, setBoost, resume, scanHighlights, haptic, getFrequencyData };
})();
