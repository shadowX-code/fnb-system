export const NOTIFICATION_SOUND_READY = 'feedx:notification-sound-ready';
const controllers = new Map();
const RECENT_MS = 90_000;
const defaults = { enabled: false, volume: 0.25 };
function preferences(value) {
  return { enabled: value?.enabled === true, volume: Number.isFinite(value?.volume) ? Math.max(0, Math.min(1, value.volume)) : defaults.volume };
}

// Audio, local preferences and cross-tab coordination live here, never in a business command.
export function createNotificationSound(identity, env = {}) {
  const host = env.window ?? window;
  let storage=env.storage;try { storage ??= host.localStorage; } catch {}
  const locks = env.locks ?? host.navigator?.locks;
  const Audio = env.AudioContext ?? host.AudioContext ?? host.webkitAudioContext;
  const key = `feedx.notifications.sound.${identity}`, seenKey = `${key}.seen`;
  const listeners = new Set(), sources = new Set();
  let context, active = false, disposed = false, baseline = true, startedAt = 0, lastObserved = 0, lastReceived = 0;
  let state;
  function read(key, fallback) { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } }
  const available = Boolean(identity && storage && Audio && locks?.request);
  state = { ...preferences(read(key, defaults)), available, ready: false, error: '' };
  function emit(patch = {}) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); }
  function save(patch) {
    const next = preferences({ ...state, ...patch });
    try { storage.setItem(key, JSON.stringify(next)); } catch { emit({ error: 'Browser storage is unavailable. Sounds stay off.' }); return false; }
    emit({ ...next, error: '' }); return true;
  }
  function stopSounds() {
    for(const source of sources) { try { source.oscillator.stop(); } catch {} source.oscillator.disconnect();source.gain.disconnect(); }
    sources.clear();
  }
  function storageChanged(event) {
    if(event.key !== key) return;
    const next = preferences(read(key, defaults));
    baseline = true;
    emit(next);
    if(!next.enabled||!next.volume)stopSounds();
    if(!next.enabled) { context?.suspend().catch(()=>{}); emit({ ready: false }); }
  }
  function statusChanged() { emit({ ready: state.enabled && context?.state === 'running' }); }
  function tone(kind) {
    if(!state.enabled || !state.ready || !state.volume || context?.state !== 'running') return false;
    const start = context.currentTime, gain = context.createGain(), oscillator = context.createOscillator();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(state.volume * 0.18, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(kind === 'handoff' ? 740 : 620, start);
    oscillator.frequency.setValueAtTime(kind === 'handoff' ? 880 : 740, start + 0.09);
    oscillator.connect(gain); gain.connect(context.destination);
    const source={oscillator,gain};sources.add(source);
    oscillator.onended = () => { sources.delete(source);oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(start); oscillator.stop(start + 0.24);
    return true;
  }
  async function enable() {
    if(!available || disposed) return;
    baseline = true;
    try {
      context ??= new Audio();
      context.onstatechange = statusChanged;
      await context.resume();
      if(disposed) return;
      if(context.state !== 'running') throw new Error('Click Enable sounds again to allow audio in this tab.');
      if(save({ enabled: true })) {
        statusChanged();
        host.dispatchEvent(new Event(NOTIFICATION_SOUND_READY));
      }
    } catch { emit({ ready: false, error: 'Audio is blocked. Check browser sound permissions, then enable again.' }); }
  }
  async function observe(snapshot) {
    const at = Date.parse(snapshot?.observed_at);
    if(!Number.isFinite(at)) return;
    const receivedNow=(env.now??Date.now)(),localGap=lastReceived?receivedNow-lastReceived:0;lastReceived=receivedNow;
    if(baseline || !lastObserved || at-lastObserved > RECENT_MS || localGap > RECENT_MS) {
      startedAt = at; baseline = false; lastObserved = at; return;
    }
    if(at < lastObserved) return;
    lastObserved = at;
    if(!active || !state.enabled || !state.ready || !available || !state.volume) return;
    const candidates = (snapshot.sound_events || []).filter(event => {
      const received = Date.parse(event.created_at), occurred = Date.parse(event.occurred_at);
      return ['inbound','handoff'].includes(event.kind) && typeof event.id === 'string' && event.id.length <= 100 &&
        received > startedAt && received <= at && occurred > at-RECENT_MS && occurred <= at &&
        !event.automatic_candidate;
    });
    if(!candidates.length) return;
    try {
      await locks.request(`feedx.notification-sound.${identity}`, {ifAvailable:true}, lock => {
        if(!lock)return;
        if(disposed || !active || !state.enabled || !state.ready || context?.state !== 'running') return;
        if(!preferences(read(key,defaults)).enabled)return;
        const raw=storage.getItem(seenKey);
        const records = raw===null?[]:JSON.parse(raw);
        if(!Array.isArray(records)) return;
        const seen = records.filter(row => typeof row?.id === 'string' && Number.isFinite(row.at) && row.at >= at-300_000);
        const fresh = candidates.filter(event => !seen.some(row => row.id === event.id));
        if(!fresh.length) return;
        // Claim before playing: a retry must never replay a tone after an uncertain browser outcome.
        storage.setItem(seenKey, JSON.stringify([...seen, ...fresh.map(event=>({id:event.id,at}))].slice(-300)));
        tone(fresh.some(event=>event.kind==='handoff') ? 'handoff' : 'inbound');
      });
    } catch { emit({ ready:false,error: 'Sounds paused. Browser storage or tab coordination is unavailable.' }); }
  }
  function subscribe(listener) {
    if(!listeners.size) host.addEventListener('storage', storageChanged);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if(!listeners.size) {
        host.removeEventListener('storage', storageChanged);
        active = false; baseline = true;
        stopSounds();context?.close().catch(()=>{}); context = undefined;
        emit({ ready: false });
      }
    };
  }
  return {
    subscribe, getSnapshot:()=>state, observe,
    setActive(value) { if(active !== value) baseline=true; active=value; },
    enable,
    disable() { baseline=true; save({enabled:false});stopSounds(); context?.suspend().catch(()=>{}); emit({enabled:false,ready:false}); },
    setVolume(volume) { const unmuting=!state.volume&&volume>0;if(!volume)stopSounds();save({volume});if(unmuting){baseline=true;host.dispatchEvent(new Event(NOTIFICATION_SOUND_READY));} },
    preview() { try { return tone('inbound'); } catch { emit({ready:false,error:'Audio is unavailable. Enable sounds again.'}); return false; } },
    dispose() { disposed=true; active=false;stopSounds(); context?.close().catch(()=>{}); host.removeEventListener('storage',storageChanged); },
  };
}
export function notificationSoundFor(identity) {
  if(!controllers.has(identity)) controllers.set(identity, createNotificationSound(identity));
  return controllers.get(identity);
}
