// Focused browser capability probe. Run only with Playwright's installed Chromium.
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
try {
  const page = await browser.newPage({ permissions: ["camera", "microphone"] });
  await page.goto(`file://${process.cwd()}/index.html`);
  const result = await page.evaluate(async () => {
    const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
    const codecs = candidates.filter((type) => MediaRecorder.isTypeSupported(type));
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: codecs[0] });
    const segments = [];
    recorder.ondataavailable = (event) => { if (event.data.size) segments.push(event.data); };
    recorder.start(400);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.stop();
    await stopped;
    const independentlyPlayable = [];
    for (const blob of segments) {
      const video = document.createElement("video");
      const url = URL.createObjectURL(blob);
      video.src = url;
      try {
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve;
          video.onerror = reject;
          setTimeout(() => reject(new Error("metadata timeout")), 1500);
        });
        independentlyPlayable.push(true);
      } catch { independentlyPlayable.push(false); }
      URL.revokeObjectURL(url);
    }
    stream.getTracks().forEach((track) => track.stop());
    return { userAgent: navigator.userAgent, codecs, segmentBytes: segments.map((blob) => blob.size), independentlyPlayable, tracksEndedAfterStop: stream.getTracks().every((track) => track.readyState === "ended") };
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally { await browser.close(); }
