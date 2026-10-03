import { supabase } from "../../lib/supabase.ts";
import { recruitmentService } from "./recruitmentService.js";
import {
  recordingStore,
  interviewLocalKey,
} from "./interviewRecordingStore.js";
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
  constructor({ token, clientId, stream, startedAt, onStatus, onLost }) {
    Object.assign(this, {
      token,
      clientId,
      stream,
      startedAt: Date.parse(startedAt),
      onStatus,
      onLost,
    });
    this.queue = Promise.resolve();
    this.writing = Promise.resolve();
    this.stopping = false;
  }
  async start() {
    const options = ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', "video/mp4"];
    const mime = options.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mime)
      throw Error(
        "This browser cannot record the required MP4 camera evidence. Use current Safari or Chrome.",
      );
    this.attemptKey = await interviewLocalKey(this.token);
    this.context = new (window.AudioContext || window.webkitAudioContext)();
    await this.context.resume();
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
    });
    await recordingStore.unit(this.unit);
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
      if (totalBytes > 100 * 1024 * 1024 && !this.stopping)
        this.onLost("unit_size_limit");
      const chunk = {
        key: `${this.unit.id}:${index}`,
        unitId: this.unit.id,
        index: index++,
        blob: event.data,
        ack: false,
        elapsedEndMs: Math.max(0, Date.now() - this.startedAt),
      };
      this.writing = this.writing.then(() => recordingStore.chunk(chunk));
      this.writing
        .then(() => this.drainChunks())
        .catch(() => this.onLost("local_storage_failed"));
    };
    this.recorder.onerror = () => this.onLost("recorder_error");
    this.recorder.onstop = () => this.resolveStop?.();
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
    if (this.drainPromise) {
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
    if (this.stopping) return this.stopPromise;
    this.stopping = true;
    clearInterval(this.timer);
    this.captureStopped = (async () => {
      if (this.recorder?.state !== "inactive") {
        await new Promise((resolve) => {
          this.resolveStop = resolve;
          this.recorder.stop();
        });
      }
      await this.writing;
      this.stream.getTracks().forEach((t) => t.stop());
      this.unit = {
        ...this.unit,
        closed: true,
        reason,
        elapsedEndMs: Math.max(0, Date.now() - this.startedAt),
      };
      await recordingStore.unit(this.unit);
      this.remoteSource?.disconnect();
      await this.context?.close();
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
    if (!unit.closed || !blob.size) {
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
  async recover() {
    this.attemptKey = await interviewLocalKey(this.token);
    const units = await recordingStore.units(this.attemptKey);
    const state = await recruitmentService.evidence(
      "state",
      this.token,
      this.clientId,
    );
    for (const unit of state.units) {
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
          await recruitmentService.evidence(
            "assemble",
            this.token,
            this.clientId,
            { unit_id: unit.id },
          );
          await recruitmentService.evidence(
            "verify",
            this.token,
            this.clientId,
            { unit_id: unit.id },
          );
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
      if (unit.closed) await this.uploadUnit(unit);
      else {
        await recruitmentService.interruption(
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
        await this.uploadUnit(recovered);
      }
    }
  }
}
