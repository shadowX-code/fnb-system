// Fixed, non-candidate comparison material. No profile, applicant or People data.
export const voices = ["marin", "cedar", "ash", "coral", "sage", "verse"] as const;
export const samples = {
  en: "Welcome to your Service Crew interview with Happiness Kopitiam. I'm FeedX's automated interviewer. The role involves welcoming guests, taking orders and working with the team to serve food. We'll chat for about ten minutes. Could you briefly introduce yourself?",
  ms: "Selamat datang ke sesi temu duga Service Crew di Happiness Kopitiam. Saya penemu duga automatik FeedX. Tugas ini melibatkan menyambut pelanggan, mengambil pesanan dan bekerjasama dengan pasukan untuk menghidangkan makanan. Kita akan berbual sekitar sepuluh minit. Boleh perkenalkan diri anda secara ringkas?",
  zh: "欢迎参加 Happiness Kopitiam 的服务员面试。我是 FeedX 的自动面试官。这份工作主要是接待顾客、帮顾客下单，以及和同事一起送餐。我们会聊大约十分钟。可以先简单介绍一下自己吗？",
  yue: "歡迎你參加 Happiness Kopitiam 嘅服務員面試。我係 FeedX 嘅自動面試官。呢份工主要係招呼客人、幫客人落單，同埋同同事一齊送餐。我哋會傾大約十分鐘。可唔可以先簡單介紹下自己？",
} as const;
export function sampleRequest(body: Record<string, unknown>) {
  if (!voices.includes(body.voice as typeof voices[number]) || !Object.hasOwn(samples, String(body.language))) throw new Error("Choose an available voice and language.");
  return { voice: body.voice as typeof voices[number], language: body.language as keyof typeof samples };
}
export function wav(parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const data = new Uint8Array(44 + size), view = new DataView(data.buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + size, true); text(8, "WAVEfmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, size, true);
  let offset = 44; for (const part of parts) { data.set(part, offset); offset += part.length; }
  return data;
}
