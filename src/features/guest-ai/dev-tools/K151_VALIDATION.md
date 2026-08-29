# K151 bridge validation record — 2026-08-22

## Current ESP-IDF runtime validation — supersedes earlier capability statuses

- **Startup Foundation: PASS.** The ESP-IDF `0.5.0-idf` bridge in `ota_0` has real USB protocol, `device_connected`, capability status, heartbeat, stable heap/stack, and the human no-unexpected-servo-movement gate.
- **Audio initialization: PASS.** The factory-aligned I2S0/ES7210/AW88298 initialization no longer reports `ESP_ERR_INVALID_ARG`; this is initialization-only evidence, not speaker or microphone capture validation.
- **LCD physical rendering: PASS.** FT6336 identifies the actual panel as ILI9342C (`firm=0x10`, `vendor=0x11`); the factory source uses the generic ILI9341 driver path for this variant and reserves the custom table for ILI9342E only. Human validation of the diagnostic firmware confirmed black → white → red → green → blue → RGB bands → visible neutral face, with correct final display output.
- **Servo X / Servo Y physical validation: PASS.** See the recorded strict-ACK/readback and human physical-validation evidence below. Device capability status remains `partial` because it intentionally reports only device-side runtime evidence.
- **Speaker physical validation: PASS.** On the Speaker Diagnostic firmware, one 120 ms / 880 Hz tone was physically audible to the operator. Before PCM transmission the bridge verified an AW88298 chip ID of `0x1852`; it recorded `SYSST=0x0311`, `SYSCTRL=0x4040`, `SYSCTRL2=0x0008`, `I2S=0x3C05`, `volume=0x1864`, `HAGC=0x040A`, `VDD=0x02E6`, and `PVDD=0x016F`. I2S TX was enabled and wrote the complete `5760/5760` bytes in 64 ms without I2S warnings. This result combines device runtime evidence with human audibility confirmation.
- **Microphone and Camera: not yet runtime validated.** They remain partial; no capture, streaming, or AI functionality was started in this validation.
- The validated implementation uses a persistent 320×240 DMA/internal-RAM frame buffer, waits for the ESP LCD color-transfer completion callback before reuse and before each marker, applies the factory PMIC/AW9523 power/reset settle sequence, and uses the factory LVGL-compatible byte-swapped RGB565 wire order. The protocol continues to report display as runtime `partial` until a future device-side evidence model explicitly supports this human physical-validation state.

## Earlier validation history

## ESP-IDF Servo physical validation — 0.5.0-idf

- **Servo communication: PASS.** The active `ota_0` Servo Discovery bridge verified factory-compatible FEETECH UART1 communication at 1 Mbps (GPIO 6/7) before allowing a position write. Both servo IDs completed ping, present-position, and torque-state reads: yaw ID 1 (`467`, torque enabled) and pitch ID 2 (`619`, torque enabled). The validator rejects TX echo by validating response header, ID, response length, status and checksum.
- **Servo X / yaw physical validation: PASS.** Human validation confirmed visible, directionally correct and smooth left, return, right and final-return steps, with no collision, sustained buzz, abnormal noise or jitter. Runtime evidence: baseline `453`; left target/readback `393/404`; return `454/446`; right `514/505`; final return `454/462`. Every goal-position packet received a strict zero-status ACK.
- **Servo Y / pitch physical validation: PASS.** Factory mapping was checked: an increasing pitch raw position is the upward direction. Human validation confirmed visible, directionally correct and smooth up, return, down and final-return steps, with no collision, sustained buzz, abnormal noise or jitter. Runtime evidence: baseline `618`; up `680/677`; return `617/615`; down `560/560`; final return `617/614`. Every goal-position packet received a strict zero-status ACK.
- **Scope constraint:** `set_gaze` currently writes both axes. During the yaw sequence pitch was held at `620` (+1 from its observed baseline); during the pitch sequence yaw was held at `460` (within two ticks of its observed position). Readback confirmed no directional test was performed on the held axis. A future protocol revision may expose a canonical single-axis action; none was added during validation.
- The device-side capability status intentionally remains `partial` for both axes: its runtime self-evidence reports communication/discovery only. The PASS results above depend on separate recorded human physical-validation evidence.

## Servo communication correction — local candidate, not flashed

- The initial `set_gaze` center commands returned `ok`, but human observation confirmed no physical movement. They remain **Servo X/Y PARTIAL**; center physical validation is **FAIL**.
- Root cause: the bridge accepted any UART response with at least four bytes starting `FF FF` as an ACK. That is insufficient and can accept an echoed outbound packet; it did not validate response ID, response length, status byte, or checksum. `gaze_applied` was therefore misleading.
- Factory v1.5.1 confirms the electrical baseline is `UART_NUM_1`, 1 Mbps, TX GPIO 6/RX GPIO 7, yaw ID 1, pitch ID 2, SCSCL big-endian words, and goal-position register 42. The bridge packet encoder matches that write layout, but its ACK validation did not match factory `SCS::Ack` behavior.
- The new unflashed candidate replaces the weak ACK test with complete factory-compatible SCSCL status/read validation, adds non-motion ping + present-position + torque-state discovery, and blocks all position writes until both IDs complete discovery in the current boot. `request_capability_test:servo_x|servo_y` now performs discovery rather than centering the robot. A future `set_gaze` can report success only after a full zero-status ACK validates ID/length/checksum.

## Flash scope and recovery

- Guest AI Bridge v0.1.0 was written only to `ota_0 @ 0x20000`, then the LCD correction was written to the same slot.
- LCD correction binary SHA-256: `ceb2e491a6b370682d545909e4b45281f857d0dc67597002aaea320f601f09e7`.
- Each device write was verified by esptool and complete readback matched the corresponding binary byte-for-byte.
- The only other write was the second `otadata` sector at `0xE000`, adding valid sequence `3` to select `ota_0` for this test boot.
- No bootloader, partition table, NVS, `ota_1`, assets, coredump, or full-chip erase was performed.
- Post-flash `ota_1` readback matched its pre-flash backup byte-for-byte (`c2bd2ea71256a39c5c19b7e6763c139b8d9313c93af0febd91a6fb2422e3deb5`), so the StackChan v1.5.1 fallback remains intact. The full backup and recovery runbook are in `hardware/firmware/dev-tools/recovery/`.

## Bridge boot and canonical protocol

- Bootloader reported `Loaded app from partition at offset 0x20000`.
- Handshake: `device_connected`, device ID `k151-0C4DD78FEE68`, model `M5Stack StackChan K151`, bridge version `0.1.0`, protocol `1.0`.
- Capability report originally marked display/servo X/servo Y/speaker `pass`; LCD was corrected and has passed physical validation. Microphone/Wi-Fi remain `partial`; camera is not yet validated.
- All events are UTF-8 newline-delimited JSON and match the canonical Guest AI Device Protocol v1 contract.

## Minimal hardware validation

| Capability | Result | Evidence / limitation |
| --- | --- | --- |
| LCD expressions | PASS | Corrected bridge explicitly wakes/configures the CoreS3 panel and draws a `neutral` boot baseline. Human validation confirmed reset baseline, all five expressions (`neutral`, `happy`, `listening`, `thinking`, `speaking`), correct orientation, no persistent flicker, and no visible ghosting. |
| Servo X | PARTIAL | Center → -20° → center → +20° → center returned `ok` at low speed. Host clamp is conservative ±90° versus the BSP ±128° range. Physical interference/noise requires human observation. |
| Servo Y | PARTIAL | Center → 55° → center → 35° → center returned `ok`; bridge retains the 5–85° safe range. Physical movement needs human observation. |
| Speaker | PARTIAL | One `request_capability_test:speaker` returned `ok` and requested the single 120 ms 880 Hz tone. Audibility needs human confirmation. |
| Microphone | PARTIAL | M5Unified API completed a 256-sample request, but returned `peak=0; mean_square=0`. This is not accepted as a physical capture. Source is corrected (built but not flashed) so future reports will not mark PASS until non-zero sampled data is observed. Official K151 factory HAL instead configures ES7210 through its CoreS3 audio codec on I2S0/TDM. |
| Camera | PARTIAL | Official K151 HAL identifies a GC0308 on the shared CoreS3 I2C bus and uses ESP-IDF `esp_video` DVP. The Arduino `esp_camera` single-frame attempt failed safely with `ESP_ERR_NOT_FOUND`, preceded by `i2c driver not installed`; no crash or reset occurred. This identifies an adapter/runtime incompatibility, not a successful frame capture. |
| Wi-Fi transport | NOT TESTED | Explicitly deferred. |
| Telemetry | PASS | Heartbeats now emit `robot_state`, `uptime_ms`, `free_heap`, and `min_free_heap`. On v0.2.0, three consecutive startup heartbeats held at `free_heap=340384`, `min_free_heap=337208`; after Mic/Camera requests, bridge remained alive at `free_heap=332076`, `min_free_heap=329156`. |
| Stability | PASS | 121 consecutive v0.1.0 heartbeats over 600.358 seconds; 5.002–5.003 s cadence, IDLE state, no serial disconnect, reset, watchdog, panic, or error event. The v0.2.0 Mic/Camera failures were contained command errors and the heartbeat continued. |

## Console validation constraint

The same canonical frames were proven against the real K151 over USB. The local FeedX Developer Device Console was started but could not render because the local dev process lacked `VITE_SUPABASE_URL`; no fake Supabase values or production/staging deployment were used. Browser WebSerial permission was therefore not exercised in this run.

## Safety notes

- Opening a USB-Serial/JTAG client can produce a normal `USB_UART_CHIP_RESET` banner. After reset, the bridge consistently booted from `ota_0` and resumed its handshake/heartbeat.
- A malformed frame during initial serial-session setup was safely rejected with an `error` event; after the handshake the valid command retry succeeded. Host clients must wait for `device_connected` before issuing controls, which the WebSerial session adapter already requires.
