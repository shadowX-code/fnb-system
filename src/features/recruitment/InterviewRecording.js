import { bounded } from "./interviewRecovery.js";
import { supabase } from "../../lib/supabase.ts";
import { recruitmentService } from "./recruitmentService.js";
import {
  recordingStore,
  interviewLocalKey,
} from "./interviewRecordingStore.js";
// Browser timeslice events may be delayed and much larger than the requested interval.
export function* recordingTransportChunks(blob) {
  for (let offset = 0; offset < blob.size; offset += 6 * 1024 * 1024)
    yield blob.slice(offset, offset + 6 * 1024 * 1024);
}
export async function checkRecordingVideo(blob) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video"),
      url = URL.createObjectURL(blob);
    const finish = (error) => {
      clearTimeout(timer);
      video.src = "";
      URL.revokeObjectURL(url);
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(
      () => finish(Error("Recording playback check timed out.")),
      10000,
    );
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      finish(
        video.videoWidth > 0 && video.videoHeight > 0
          ? null
          : Error("Recording contains no playable camera video."),
      );
    video.onerror = () => finish(Error("Recording cannot be played."));
    video.src = url;
    video.load();
  });
}
export class InterviewRecording {
  constructor({ token, clientId, stream, startedAt, onStatus, onLost, audioActivation, recoveryId }) {
    Object.assign(this, {
      token,
      clientId,
      stream,
      startedAt: Date.parse(startedAt),
      onStatus,
      onLost,
      audioActivation,
      recoveryId,
    });
    this.queue = Promise.resolve();
    this.writing = Promise.resolve();
    this.stopping = false;
  }
  static activateAudio() {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    // Called directly from the tap, before any server/IndexedDB await loses activation.
    const ready = context.resume();
    ready.catch(() => {});
    return { context, ready };
  }
  dispose() {
    if (this.unit && !this.stopping) this.stop("recovery_aborted").catch(() => {});
    this.stopping = true;
    clearInterval(this.timer);
    this.remoteSource?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop());
    this.context?.close().catch(() => {});
    this.audioActivation?.context.close().catch(() => {});
  }
  async start({ signal } = {}) {
    const active = () => { if (signal?.aborted) throw Error("Recording recovery was replaced."); };
    signal?.addEventListener("abort", () => this.dispose(), {once:true});
    active();
    const options = ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', "video/mp4"];
    const mime = options.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mime)
      throw Error(
        "This browser cannot record the required MP4 camera evidence. Use current Safari or Chrome.",
      );
    this.attemptKey = await interviewLocalKey(this.token);
    active();
    this.audioActivation ||= InterviewRecording.activateAudio();
    this.context = this.audioActivation.context;
    await bounded(this.audioActivation.ready, "Microphone audio", { signal, timeoutMs: 10000 });
    active();
    if (this.context.state !== "running") throw Error("Microphone audio is suspended. Tap Resume to reacquire it.");
    this.destination = this.context.createMediaStreamDestination();
    this.context.createMediaStreamSource(this.stream).connect(this.destination);
    this.recordingStream = new MediaStream([
      ...this.stream.getVideoTracks(),
      ...this.destination.stream.getAudioTracks(),
    ]);
    this.unit = {
      id: crypto.randomUUID(),
      attemptKey: this.attemptKey,
      mime: "video/mp4",
      closed: false,
      reason: null,
    };
    await recruitmentService.evidence("open", this.token, this.clientId, {
      unit_id: this.unit.id,
      ...(this.recoveryId ? { recovery_id: this.recoveryId } : {}),
    }, signal);
    active();
    await recordingStore.unit(this.unit);
    active();
    this.recorder = new MediaRecorder(this.recordingStream, {
      mimeType: mime,
      videoBitsPerSecond: 450000,
      audioBitsPerSecond: 64000,
    });
    let index = 0,
      totalBytes = 0;
    this.recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      totalBytes += event.data.size;
      for (const blob of recordingTransportChunks(event.data)) {
        const chunk = {
          key: `${this.unit.id}:${index}`,
          unitId: this.unit.id,
          index: index++,
          blob,
          ack: false,
          elapsedEndMs: Math.max(0, Date.now() - this.startedAt),
        };
        this.writing = this.writing.then(() => recordingStore.chunk(chunk));
      }
      if (totalBytes > 100 * 1024 * 1024 && !this.stopping)
        this.onLost("unit_size_limit");
      this.writing
        .then(() => this.drainChunks())
        .catch(() => this.onLost("local_storage_failed"));
    };
    this.recorder.onerror = () => this.onLost("recorder_error");
    this.recorder.onstop = () => this.resolveStop?.();
    this.context.addEventListener("statechange", () => {
      if (!this.stopping && ["suspended", "interrupted"].includes(this.context.state)) this.onLost("audio_context_suspended");
    });
    this.stream.getTracks().forEach(track => track.addEventListener("mute", () => {
      if (!this.stopping) this.onLost("media_track_muted");
    }, {once:true}));
    this.recorder.start(5000);
    this.onStatus("recording");
    this.timer = setInterval(() => this.drainChunks(), 10000);
    this.stream.getTracks().forEach((t) =>
      t.addEventListener(
        "ended",
        () => {
          if (!this.stopping) this.onLost("device_lost");
        },
        { once: true },
      ),
    );
  }
  remote(stream) {
    this.remoteSource?.disconnect();
    if (stream && this.context?.state !== "closed") {
      this.remoteSource = this.context.createMediaStreamSource(stream);
      this.remoteSource.connect(this.destination);
    }
  }
  async drainChunks(unitId = this.unit?.id) {
    while (this.drainPromise) {
      await this.drainPromise;
    }
    this.drainPromise = (async () => {
      try {
        for (const chunk of await recordingStore.chunks(unitId)) {
          if (chunk.ack) continue;
          const payload = {
            unit_id: chunk.unitId,
            index: chunk.index,
            bytes: chunk.blob.size,
          };
          const access = await recruitmentService.evidence(
            "chunk",
            this.token,
            this.clientId,
            payload,
          );
          if (!access.acknowledged) {
            const { error } = await supabase.storage
              .from("recruitment-evidence")
              .uploadToSignedUrl(access.path, access.upload_token, chunk.blob, {
                contentType: "application/octet-stream",
              });
            if (error && !/already exists|duplicate/i.test(error.message))
              throw error;
            await recruitmentService.evidence(
              "chunk_ack",
              this.token,
              this.clientId,
              payload,
            );
          }
          await recordingStore.chunk({ ...chunk, ack: true });
        }
        return true;
      } catch {
        this.onStatus("upload-pending");
        return false;
      }
    })();
    try {
      return await this.drainPromise;
    } finally {
      this.drainPromise = null;
    }
  }
  async stop(reason = "completed") {
    if (this.stopping && this.stopPromise) return this.stopPromise;
    if (!this.unit) {
      this.dispose();
      return "not-started";
    }
    this.stopping = true;
    clearInterval(this.timer);
    this.captureStopped = (async () => {
      let closed = true;
      if (this.recorder && this.recorder.state !== "inactive") {
        closed = await new Promise((resolve) => {
          // Mobile suspension can prevent onstop. Do not hold recovery indefinitely.
          const timer = setTimeout(() => resolve(false), 10000);
          this.resolveStop = () => { clearTimeout(timer); resolve(true); };
          try { this.recorder.stop(); } catch { clearTimeout(timer); resolve(false); }
        });
      }
      // Release hardware before persistence/upload. WebKit close() can remain pending.
      this.stream?.getTracks().forEach((t) => t.stop());
      this.remoteSource?.disconnect();
      this.context?.close().catch(() => {});
      await bounded(this.writing, "Saving recording bytes");
      this.unit = {
        ...this.unit,
        closed,
        reason: closed ? reason : "recorder_stop_unconfirmed",
        elapsedEndMs: Math.max(0, Date.now() - this.startedAt),
      };
      await recordingStore.unit(this.unit);
      return this.unit;
    })();
    this.stopPromise = this.captureStopped.then((unit) =>
      this.uploadUnit(unit),
    );
    return this.stopPromise;
  }
  async uploadUnit(unit) {
    const chunks = await recordingStore.chunks(unit.id);
    const blob = new Blob(
      chunks.map((c) => c.blob),
      { type: "video/mp4" },
    );
    if (!unit.closed || !blob.size || blob.size > 128 * 1024 * 1024) {
      await recruitmentService.evidence("invalid", this.token, this.clientId, {
        unit_id: unit.id,
      });
      await recordingStore.removeUnit(unit.id);
      return "invalid";
    }
    try {
      await checkRecordingVideo(blob);
    } catch {
      await recruitmentService.evidence("invalid", this.token, this.clientId, {
        unit_id: unit.id,
      });
      await recordingStore.removeUnit(unit.id);
      this.onStatus("invalid-recording");
      return "invalid";
    }
    const access = await recruitmentService.evidence(
      "upload",
      this.token,
      this.clientId,
      {
        unit_id: unit.id,
        bytes: blob.size,
        elapsed_end_ms: unit.elapsedEndMs,
        reason: unit.reason,
      },
    );
    if (!access.verified) {
      this.onStatus("uploading");
      if (!(await this.drainChunks(unit.id)))
        throw Error(
          "Recording upload is pending. Retry with a stable connection.",
        );
      await recruitmentService.evidence("assemble", this.token, this.clientId, {
        unit_id: unit.id,
      });
      await recruitmentService.evidence("verify", this.token, this.clientId, {
        unit_id: unit.id,
      });
    }
    await recordingStore.removeUnit(unit.id);
    this.onStatus("verified");
    return "verified";
  }
  async recover({ deferUploads = false, excludeUnit = () => null } = {}) {
    const uploads = [];
    this.attemptKey = await interviewLocalKey(this.token);
    const units = await recordingStore.units(this.attemptKey);
    const state = await recruitmentService.evidence(
      "state",
      this.token,
      this.clientId,
    );
    for (const unit of state.units) {
      if (unit.id === excludeUnit()) continue;
      if (
        ["capturing", "pending"].includes(unit.status) &&
        !units.some((local) => local.id === unit.id)
      ) {
        const chunks = state.chunks.filter((c) => c.unit_id === unit.id);
        if (
          unit.expected_bytes &&
          chunks.length &&
          chunks.every((c) => c.acknowledged_at) &&
          chunks.reduce((sum, c) => sum + Number(c.expected_bytes), 0) ===
            Number(unit.expected_bytes)
        ) {
          uploads.push(async () => {
            await recruitmentService.evidence("assemble", this.token, this.clientId, { unit_id: unit.id });
            await recruitmentService.evidence("verify", this.token, this.clientId, { unit_id: unit.id });
          });
        } else
          await recruitmentService.evidence(
            "abandon",
            this.token,
            this.clientId,
            { unit_id: unit.id },
          );
      }
    }
    for (const unit of units) {
      if (unit.id === excludeUnit()) continue;
      if (unit.closed) uploads.push(() => this.uploadUnit(unit));
      else {
        if (!deferUploads) await recruitmentService.interruption(
          this.token,
          this.clientId,
          "reload_unfinalized_unit",
        );
        const chunks = await recordingStore.chunks(unit.id);
        const recovered = {
          ...unit,
          closed: true,
          reason: "abrupt_reload",
          elapsedEndMs: chunks.at(-1)?.elapsedEndMs || 0,
        };
        await recordingStore.unit(recovered);
        uploads.push(() => this.uploadUnit(recovered));
      }
    }
    this.uploadRecovery = (async () => {
      for (const upload of uploads) await upload();
    })();
    if (!deferUploads) await this.uploadRecovery;
  }
}
