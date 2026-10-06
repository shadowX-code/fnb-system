import { samples } from "./samples.ts";
import { interviewerProfile } from "../recruitment-realtime/voice.ts";
export const sampleVersion = "opening-v1";
export async function sampleKey(voice: string, language: keyof typeof samples) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      sampleVersion,
      "gpt-realtime-1.5",
      interviewerProfile.version,
      interviewerProfile.instructions,
      voice,
      language,
      samples[language],
    ]),
  );
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
// Authorization is checked by the owning endpoint before any cache access.
// A cache failure never silently spends money on a fresh provider generation.
export async function cachedSample({
  key,
  read,
  claim,
  write,
  release,
  generate,
}: {
  key: string;
  read: () => Promise<Uint8Array | null>;
  claim: (owner: string) => Promise<boolean>;
  write: (audio: Uint8Array) => Promise<void>;
  release: (owner: string) => Promise<void>;
  generate: () => Promise<Uint8Array>;
}) {
  const existing = await read();
  if (existing) return existing;
  const owner = crypto.randomUUID();
  if (!(await claim(owner)))
    throw new Error(
      "This sample is being prepared. Try Play again shortly; no additional generation was started.",
    );
  try {
    // Another worker may have completed between our first read and claim.
    const completed = await read();
    if (completed) return completed;
    const audio = await generate();
    await write(audio);
    return audio;
  } finally {
    await release(owner).catch(() => {});
  }
}
