import { bounded } from "./interviewRecovery.js";
import { useCallback, useEffect, useRef, useState } from "react";

function deviceError(error) {
  if (!navigator.mediaDevices?.getUserMedia) return "This browser cannot access a camera and microphone.";
  if (["NotAllowedError", "PermissionDeniedError"].includes(error?.name)) return "Camera or microphone access was denied. Allow both devices in your browser settings and try again.";
  if (["NotFoundError", "DevicesNotFoundError"].includes(error?.name)) return "A camera and microphone are both required. Connect the missing device and try again.";
  if (["NotReadableError", "TrackStartError"].includes(error?.name)) return "A device is unavailable or is in use by another app. Close that app and try again.";
  return "Device check failed. Reconnect your camera and microphone, then try again.";
}

export function useInterviewDevices() {
  const [state, setState] = useState({ status: "idle", error: "", cameras: [], microphones: [], level: 0, cameraId: "", microphoneId: "" });
  const streamRef = useRef(null);
  const audioRef = useRef(null);
  const frameRef = useRef(0);
  const previewRef = useRef(null);
  const generationRef = useRef(0);

  const stop = useCallback(() => {
    generationRef.current += 1;
    cancelAnimationFrame(frameRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
    audioRef.current?.close?.().catch(() => {});
    audioRef.current = null;
    setState((current) => ({ ...current, status: "idle", level: 0 }));
  }, []);

  const start = useCallback(async ({ cameraId = "", microphoneId = "", signal, meter = true } = {}) => {
    if (!navigator.mediaDevices?.getUserMedia) { setState((current) => ({ ...current, status: "unsupported", error: deviceError() })); return; }
    const generation = ++generationRef.current;
    signal?.addEventListener("abort", () => { if (generation === generationRef.current) stop(); }, {once:true});
    setState((current) => ({ ...current, status: "checking", error: "" }));
    let stream;
    try {
      stream = await bounded(navigator.mediaDevices.getUserMedia({ video: cameraId ? { deviceId: { exact: cameraId } } : { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } }, audio: microphoneId ? { deviceId: { exact: microphoneId }, echoCancellation: true, noiseSuppression: true } : { echoCancellation: true, noiseSuppression: true } }), "Camera and microphone", {signal,timeoutMs:15000,onLate:value=>value.getTracks().forEach(track=>track.stop())});
      if (generation !== generationRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
      audioRef.current?.close?.().catch(() => {});
      streamRef.current = stream;
      if (previewRef.current) { previewRef.current.srcObject = stream; previewRef.current.play?.().catch(() => {}); }
      stream.getTracks().forEach((track) => { track.onended = () => { if (generation === generationRef.current) setState((current) => ({ ...current, status: "lost", error: `${track.kind === "video" ? "Camera" : "Microphone"} disconnected. Recheck both devices.` })); }; });
      const devices = meter ? await bounded(navigator.mediaDevices.enumerateDevices?.() || Promise.resolve([]), "Device list", {signal,timeoutMs:3000}).catch(() => []) : [];
      if (generation !== generationRef.current) { stream.getTracks().forEach(track=>track.stop()); return; }
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (meter && AudioContextClass) {
        const context = new AudioContextClass(); audioRef.current = context;
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser(); analyser.fftSize = 512; source.connect(analyser);
        const values = new Uint8Array(analyser.fftSize);
        const update = () => { if (generation !== generationRef.current) return; analyser.getByteTimeDomainData(values); const rms = Math.sqrt(values.reduce((sum, value) => sum + (value - 128) ** 2, 0) / values.length) / 128; setState((current) => ({ ...current, level: Math.min(1, rms * 6) })); frameRef.current = requestAnimationFrame(update); };
        update();
      }
      setState((current) => ({ ...current, status: "ready", error: "", cameras: devices.filter((x) => x.kind === "videoinput"), microphones: devices.filter((x) => x.kind === "audioinput"), cameraId: stream.getVideoTracks()[0]?.getSettings().deviceId || cameraId, microphoneId: stream.getAudioTracks()[0]?.getSettings().deviceId || microphoneId }));
      return stream;
    } catch (error) {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (generation === generationRef.current) setState((current) => ({ ...current, status: "error", error: deviceError(error) }));
    }
  }, [stop]);

  useEffect(() => {
    const changed = () => { if (streamRef.current && streamRef.current.getTracks().some((track) => track.readyState === "ended")) setState((current) => ({ ...current, status: "lost", error: "A device disconnected. Recheck both devices." })); };
    navigator.mediaDevices?.addEventListener?.("devicechange", changed);
    return () => { navigator.mediaDevices?.removeEventListener?.("devicechange", changed); generationRef.current += 1; cancelAnimationFrame(frameRef.current); streamRef.current?.getTracks().forEach((track) => track.stop()); audioRef.current?.close?.().catch(() => {}); };
  }, []);

  return { state, start, stop, previewRef, streamRef };
}
