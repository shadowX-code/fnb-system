# Phase 1 browser media spike

Run `node qa/recruitment/mediaSpike.mjs` with Playwright Chromium and fake camera/microphone. On 2026-09-30, Headless Chromium 140 on macOS returned:

- `getUserMedia({video:true,audio:true})` succeeded with both fake devices.
- `MediaRecorder.isTypeSupported` returned true for WebM VP9/Opus, WebM VP8/Opus, WebM default, and MP4. This reports availability, not cross-browser interoperability.
- A 400 ms `MediaRecorder` timeslice produced three non-empty blobs. Only the **first** blob loaded independently as video metadata; later blobs did not. Raw timeslice blobs therefore cannot be assumed to be separately playable recording files.
- Stopping both tracks moved them to `ended`. This does not establish how physical device loss, OS backgrounding, permission revocation, or incoming calls behave.

Phase 2 should target current Chrome on Android and Safari on iOS as the mobile baseline, with desktop Chrome/Safari for QA. Real-device checks remain required before choosing a codec or media-specific schema. In particular, test whether to upload one resumable container, construct valid independently playable segments, or retain chunks plus a reconstruction manifest. Do not use a bare list of timeslice blobs as playback files.
