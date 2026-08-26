import { encodeDeviceMessage, parseDeviceMessage } from "../protocol/deviceProtocol.js";

// Local-development transport only. A disconnect clears its line buffer, and
// reconnect uses only the port the user previously authorized.
export class WebSerialDeviceAdapter {
  constructor({ baudRate = 115200, reconnectDelayMs = 1000, reconnectAttempts = 10, bootstrapDurationMs = 8000, maxBootstrapLineLength = 4096 } = {}) {
    this.baudRate = baudRate; this.reconnectDelayMs = reconnectDelayMs; this.reconnectAttempts = reconnectAttempts;
    this.bootstrapDurationMs = bootstrapDurationMs; this.maxBootstrapLineLength = maxBootstrapLineLength;
    this.port = null; this.reader = null; this.writer = null; this.abortController = null; this.callbacks = {};
    this.writeChain = Promise.resolve();
    this.authorizedInfo = null; this.manualDisconnect = false; this.reconnecting = false; this.reconnectTimer = null;
    this.receivePhase = "BOOTSTRAP"; this.bootstrapStartedAt = 0;
    this.disconnectHandler = (event) => { if (event.target === this.port) this.handleLost(new Error("The device has been lost.")); };
  }
  static isSupported() { return typeof navigator !== "undefined" && "serial" in navigator; }
  static samePort(info, expected) { return Boolean(info && expected && info.usbVendorId === expected.usbVendorId && info.usbProductId === expected.usbProductId); }
  async connect(callbacks) {
    if (!WebSerialDeviceAdapter.isSupported()) throw new Error("Web Serial is unavailable in this browser. Use Chromium over HTTPS or localhost.");
    this.callbacks = callbacks ?? {}; this.manualDisconnect = false; navigator.serial.addEventListener?.("disconnect", this.disconnectHandler);
    const port = await navigator.serial.requestPort(); this.authorizedInfo = port.getInfo?.() ?? null;
    await this.openPort(port, false);
  }
  async openPort(port, recovered) {
    this.port = port; await this.port.open({ baudRate: this.baudRate }); this.writer = this.port.writable.getWriter(); this.abortController = new AbortController();
    this.receivePhase = "BOOTSTRAP"; this.bootstrapStartedAt = Date.now();
    this.readLines(this.abortController.signal);
    if (recovered) await this.callbacks.onReconnect?.(); else await this.callbacks.onOpen?.();
  }
  async readLines(signal) {
    const decoder = new TextDecoder(); let pending = ""; const readingPort = this.port; let reader = null;
    try {
      reader = readingPort.readable.getReader(); this.reader = reader;
      while (!signal.aborted) {
        const { value, done } = await reader.read(); if (done) break;
        pending += decoder.decode(value, { stream: true }); const lines = pending.split(/\r?\n/); pending = lines.pop() ?? "";
        lines.filter(Boolean).forEach((line) => this.receiveLine(line));
        if (pending.length > this.maxBootstrapLineLength) {
          const overflow = pending; pending = ""; this.receiveLine(overflow);
        }
      }
      if (!signal.aborted) await this.handleLost(new Error("The device has been lost."));
    } catch (error) { if (!signal.aborted) await this.handleLost(error); }
    finally { try { reader?.releaseLock(); } catch {} if (this.reader === reader) this.reader = null; }
  }
  receiveLine(line) {
    if (this.receivePhase === "STRICT_PROTOCOL") { this.callbacks.onMessage?.(line); return; }
    try {
      parseDeviceMessage(line);
      this.receivePhase = "STRICT_PROTOCOL";
      this.callbacks.onMessage?.(line);
    } catch {
      const withinBootstrap = Date.now() - this.bootstrapStartedAt <= this.bootstrapDurationMs;
      if (withinBootstrap && line.length <= this.maxBootstrapLineLength) return;
      this.receivePhase = "STRICT_PROTOCOL";
      this.callbacks.onMessage?.(line);
    }
  }
  async send(message) {
    const writer = this.writer;
    if (!writer) throw new Error("Serial device is not connected.");
    const bytes = new TextEncoder().encode(encodeDeviceMessage(message));
    // Playback may have several commands awaiting device ACKs, but canonical
    // JSON-lines still needs a single byte-stream owner. Serialize whole
    // frames before they reach the Web Serial writer; this is independent of
    // credit-window command concurrency.
    const write = this.writeChain.then(async () => {
      if (this.writer !== writer) throw new Error("Serial device is not connected.");
      await writer.write(bytes);
    });
    this.writeChain = write.catch(() => {});
    return write;
  }
  async releaseTransport({ close = false } = {}) {
    this.abortController?.abort(); this.abortController = null; await this.reader?.cancel().catch(() => {}); try { this.reader?.releaseLock(); } catch {} this.reader = null;
    this.writer?.releaseLock(); this.writer = null; if (close && this.port) await this.port.close().catch(() => {});
    this.writeChain = Promise.resolve();
  }
  async handleLost(error) {
    if (this.manualDisconnect || this.reconnecting) return;
    this.reconnecting = true; await this.releaseTransport(); this.callbacks.onDisconnect?.(error); this.reconnectAuthorizedPort();
  }
  async reconnectAuthorizedPort() {
    for (let attempt = 0; !this.manualDisconnect && attempt < this.reconnectAttempts; attempt += 1) {
      await new Promise((resolve) => { this.reconnectTimer = setTimeout(resolve, this.reconnectDelayMs); });
      const ports = await navigator.serial.getPorts(); const port = ports.find((candidate) => WebSerialDeviceAdapter.samePort(candidate.getInfo?.(), this.authorizedInfo));
      if (!port) continue;
      try { await this.openPort(port, true); this.reconnecting = false; return; } catch { /* device may still be enumerating */ }
    }
    this.reconnecting = false; this.callbacks.onReconnectUnavailable?.(new Error("K151 did not reappear. Select Reconnect Device to retry."));
  }
  async reconnect() { if (!this.authorizedInfo) throw new Error("No previously authorized K151 port. Connect K151 over USB first."); this.manualDisconnect = false; this.reconnecting = true; await this.reconnectAuthorizedPort(); }
  async disconnect() { this.manualDisconnect = true; clearTimeout(this.reconnectTimer); this.reconnectTimer = null; navigator.serial.removeEventListener?.("disconnect", this.disconnectHandler); await this.releaseTransport({ close: true }); this.port = null; this.reconnecting = false; }
}
