// One native playback element owner per fresh generation. A running Web Audio
// context alone does not unlock HTML audio on WebKit.
const owners = new WeakMap();
export const interviewPlaybackOwner = element => element && owners.get(element);
export function activateInterviewPlayback(element, context) {
  if (!element || !context?.createMediaStreamDestination) return null;
  const previous = owners.get(element);
  previous?.dispose();
  const destination = context.createMediaStreamDestination();
  const silence = context.createConstantSource();
  silence.offset.value = 0;
  silence.connect(destination); silence.start();
  const audioSession = navigator.audioSession;
  const previousType = audioSession?.type;
  try { if (audioSession) audioSession.type = "play-and-record"; } catch { /* Optional browser capability. */ }
  const owner = {
    ready: null,
    dispose() {
      if (owner.disposed) return;
      owner.disposed = true;
      silence.stop(); silence.disconnect();
      destination.stream.getTracks().forEach(track => track.stop());
      if (owners.get(element) !== owner) return;
      owners.delete(element);
      element.pause(); element.srcObject = null;
      try { if (audioSession?.type === "play-and-record") audioSession.type = previousType; } catch { /* Optional browser capability. */ }
    },
  };
  owners.set(element, owner);
  element.playsInline = true; element.muted = false;
  element.srcObject = destination.stream;
  // Must execute in the Start/Continue gesture, before any unrelated await.
  try { owner.ready = Promise.resolve(element.play()); } catch (error) { owner.dispose(); throw error; }
  owner.ready.catch(() => {});
  return owner;
}
