import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSerialDeviceAdapter } from "../device/adapters/WebSerialDeviceAdapter.js";

function port(info = { usbVendorId: 0x303a, usbProductId: 0x1001 }) {
  let controller; const stream = new ReadableStream({ start(value) { controller = value; }, cancel() {} });
  return { getInfo: () => info, readable: stream, writable: new WritableStream({ write() {} }), open: vi.fn(async () => {}), close: vi.fn(async () => {}), push: (line) => controller.enqueue(new TextEncoder().encode(line)) };
}

afterEach(() => vi.unstubAllGlobals());

describe("Web Serial reconnect boundary", () => {
  it("reopens only the previously authorized port and invokes snapshot recovery", async () => {
    const authorized = port(); const other = port({ usbVendorId: 1, usbProductId: 2 }); const listeners = new Map();
    vi.stubGlobal("navigator", { serial: {
      requestPort: vi.fn(async () => authorized), getPorts: vi.fn(async () => [other, authorized]),
      addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: () => {},
    } });
    const onOpen = vi.fn(); const onReconnect = vi.fn(); const onDisconnect = vi.fn();
    const adapter = new WebSerialDeviceAdapter({ reconnectDelayMs: 0, reconnectAttempts: 1 });
    await adapter.connect({ onOpen, onReconnect, onDisconnect });
    await adapter.handleLost(new Error("lost")); await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onOpen).toHaveBeenCalledTimes(1); expect(onDisconnect).toHaveBeenCalledTimes(1); expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(authorized.open).toHaveBeenCalledTimes(2); expect(other.open).not.toHaveBeenCalled();
    await adapter.disconnect();
  });

  it("clears the reader path rather than carrying a partial frame across a lost device", async () => {
    const authorized = port(); vi.stubGlobal("navigator", { serial: { requestPort: vi.fn(async () => authorized), getPorts: vi.fn(async () => []), addEventListener() {}, removeEventListener() {} } });
    const adapter = new WebSerialDeviceAdapter({ reconnectDelayMs: 0, reconnectAttempts: 0 });
    await adapter.connect({ onOpen() {}, onDisconnect() {}, onReconnectUnavailable() {} });
    await adapter.handleLost(new Error("lost"));
    expect(adapter.reader).toBeNull(); expect(adapter.writer).toBeNull();
    await adapter.disconnect();
  });

  it("silently discards bounded early boot text and activates strict mode on the first canonical frame", async () => {
    const authorized = port(); vi.stubGlobal("navigator", { serial: { requestPort: vi.fn(async () => authorized), getPorts: vi.fn(async () => []), addEventListener() {}, removeEventListener() {} } });
    const onMessage = vi.fn(); const adapter = new WebSerialDeviceAdapter({ reconnectAttempts: 0 });
    await adapter.connect({ onOpen() {}, onMessage });
    adapter.receiveLine("I (1134) app: early startup");
    expect(onMessage).not.toHaveBeenCalled(); expect(adapter.receivePhase).toBe("BOOTSTRAP");
    adapter.receiveLine(JSON.stringify({ protocol_version: "1.0", message_id: "m", type: "heartbeat", sent_at: "now", payload: {} }));
    expect(adapter.receivePhase).toBe("STRICT_PROTOCOL"); expect(onMessage).toHaveBeenCalledTimes(1);
    adapter.receiveLine("I (runtime) must now fail strict parsing");
    expect(onMessage).toHaveBeenCalledTimes(2); await adapter.disconnect();
  });

  it("bounds bootstrap text before escalating later non-protocol input to strict mode", () => {
    const onMessage = vi.fn(); const adapter = new WebSerialDeviceAdapter({ bootstrapDurationMs: 0, maxBootstrapLineLength: 8 });
    adapter.callbacks = { onMessage }; adapter.bootstrapStartedAt = Date.now() - 1;
    adapter.receiveLine("not-json");
    expect(adapter.receivePhase).toBe("STRICT_PROTOCOL"); expect(onMessage).toHaveBeenCalledWith("not-json");
  });

  it("serializes complete canonical JSON-lines writes while command ACKs are concurrently pending", async () => {
    const deferred = []; const write = vi.fn(() => new Promise((resolve) => deferred.push(resolve)));
    const adapter = new WebSerialDeviceAdapter(); adapter.writer = { write };
    const first = adapter.send({ protocol_version: "1.0", message_id: "one", type: "audio_playback_chunk", sent_at: "now", payload: {} });
    const second = adapter.send({ protocol_version: "1.0", message_id: "two", type: "audio_playback_chunk", sent_at: "now", payload: {} });
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    deferred.shift()(); await first; await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(2);
    deferred.shift()(); await second;
    expect(new TextDecoder().decode(write.mock.calls[0][0])).toContain('"message_id":"one"');
    expect(new TextDecoder().decode(write.mock.calls[1][0])).toContain('"message_id":"two"');
  });
});
