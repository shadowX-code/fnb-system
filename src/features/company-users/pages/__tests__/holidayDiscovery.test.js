import { expect, it, vi } from "vitest";
import { allowedDocument, directories, discoverDocuments, boundedFetch } from "../../../../../supabase/functions/payroll-holiday-updates/discovery.js";
const doc = rows => new DOMParser().parseFromString(`<table>${rows}</table>`, "text/html");
const row = (name, href) => `<tr><td>${name}</td><td><a href="${href}">PDF</a></td></tr>`;
it("only follows actual selected-year annual holiday row links, never school calendars", () => {
  const html = doc(row("Hari Kelepasan Am Tahun 2027", "../storage/2026/08/HKA_2027.pdf") + row("Kalendar Persekolahan Tahun 2027", "../storage/school.pdf") + row("Hari Kelepasan Am Tahun 2026", "../storage/2025/08/HKA-2026.pdf"));
  expect(discoverDocuments(html, directories[0], 2027, "MY-08")).toEqual([{ url: "https://www.kabinet.gov.my/storage/2026/08/HKA_2027.pdf", name: "Hari Kelepasan Am Tahun 2027", directory: directories[0] }]);
});
it("filters explicit non-applicable regional gazettes and deduplicates links", () => {
  const a = row("Warta Pemberitahuan Hari Kelepasan Am Tahun 2026 Bagi Semenanjung Malaysia", "../storage/PUB-111_2026.pdf");
  const b = row("Warta Pemberitahuan Hari Kelepasan Am Tahun 2026 Bagi W.P. Labuan", "../storage/PUB-112_2026.pdf");
  expect(discoverDocuments(doc(a + a + b), directories[1], 2026, "MY-08")).toHaveLength(1);
  expect(discoverDocuments(doc(a + b), directories[1], 2026, "MY-15")[0].url).toContain("112");
});
it("rejects hostile hosts, credentials, query strings and changed directory format", () => {
  for (const url of ["http://www.kabinet.gov.my/storage/a.pdf", "https://www.kabinet.gov.my.evil.test/storage/a.pdf", "https://u@www.kabinet.gov.my/storage/a.pdf", "https://www.kabinet.gov.my/storage/a.pdf?q=x", "https://127.0.0.1/storage/a.pdf"]) expect(allowedDocument(url)).toBe(false);
  expect(() => discoverDocuments(doc(row("Hari Kelepasan Am Tahun 2027", "https://evil.test/a.pdf")), directories[0], 2027, "MY-08")).toThrow();
  expect(() => discoverDocuments(new DOMParser().parseFromString("changed", "text/html"), directories[0], 2027, "MY-08")).toThrow();
});
it("does not follow redirects or accept non-PDF and oversized payloads", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1" } }));
  await expect(boundedFetch(directories[0], false, fetcher)).rejects.toThrow();
  expect(fetcher.mock.calls[0][1].redirect).toBe("manual");
  fetcher.mockResolvedValue(new Response("not PDF"));
  await expect(boundedFetch("https://www.kabinet.gov.my/storage/a.pdf", true, fetcher)).rejects.toThrow();
  fetcher.mockResolvedValue(new Response("%PDF-", { headers: { "content-length": "99999999" } }));
  await expect(boundedFetch("https://www.kabinet.gov.my/storage/a.pdf", true, fetcher)).rejects.toThrow();
});
