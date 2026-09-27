export const directories = [
  "https://www.kabinet.gov.my/hari-kelepasan-am/",
  "https://www.kabinet.gov.my/akta-dan-warta/",
];
export function allowedDocument(value) {
  const u = new URL(value);
  return u.protocol === "https:" && u.hostname === "www.kabinet.gov.my" && !u.port && !u.username && !u.password &&
    !u.search && !u.hash && /^\/storage\/[^?#]+\.pdf$/i.test(u.pathname);
}
// A bounded table reader, not a crawler. Never guess a filename or infer holiday dates.
export function discoverDocuments(document, directory, year, geography) {
  if (!directories.includes(directory)) throw new Error("Unapproved official directory.");
  const rows = [...document.querySelectorAll("table tr")];
  if (!rows.length) throw new Error("Official directory format changed. Review required.");
  const annual = directory === directories[0];
  if (!rows.some(row => (annual ? /^Hari Kelepasan Am Tahun\b/i : /^Warta .*Hari Kelepasan Am/i).test((row.querySelector("td")?.textContent || "").trim()))) throw new Error("Official holiday listing format changed.");
  const found = new Map();
  for (const row of rows) {
    const name = (row.querySelector("td")?.textContent || "").replace(/\s+/g, " ").trim();
    if (!new RegExp(`\\b${year}\\b`).test(name)) continue;
    if (annual ? !/^Hari Kelepasan Am Tahun\b/i.test(name) : !/^Warta .*Hari Kelepasan Am/i.test(name)) continue;
    // Annual/Persekutuan+Negeri sources need review for the selected state. Explicit
    // regional supplements are filtered only where directory evidence is unambiguous.
    if (/Labuan/i.test(name) && geography !== "MY-15") continue;
    if (/Semenanjung/i.test(name) && ["MY-12", "MY-13", "MY-15"].includes(geography)) continue;
    const links = [...row.querySelectorAll("a[href]")].map(a => new URL(a.getAttribute("href"), directory).href).filter(allowedDocument);
    if (!links.length) throw new Error("Official holiday listing has no verified document link.");
    for (const url of links) found.set(url, { url, name, directory });
  }
  if (found.size > 12) throw new Error("Too many source candidates. Review required.");
  return [...found.values()];
}

export async function boundedFetch(url, pdf, fetcher = fetch) {
  if (!(pdf ? allowedDocument(url) : directories.includes(url))) throw new Error("Unapproved source.");
  // No redirects: an unexpected redirect is a source-maintenance exception, not
  // permission to leave the approved surface (including redirects to private IPs).
  const response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error("Official source unavailable or redirected.");
  const maximum = pdf ? 5242880 : 2097152;
  if (Number(response.headers.get("content-length")) > maximum) throw new Error("Official source too large.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Official source is empty.");
  const chunks = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maximum) throw new Error("Official source too large."); chunks.push(value); }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (pdf && new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("Official link did not return a PDF.");
  return bytes;
}
