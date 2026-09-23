import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const publicFile = (name) => resolve(process.cwd(), "public", name);

function pngDimensions(name) {
  const data = readFileSync(publicFile(name));
  expect(data.subarray(1, 4).toString()).toBe("PNG");
  return `${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`;
}

describe("Crew Web App icon", () => {
  it("uses source-derived PWA sizes and a dedicated Apple icon", () => {
    const manifest = JSON.parse(readFileSync(publicFile("crew.webmanifest"), "utf8"));
    expect(manifest.icons.map(({ src, sizes, type }) => ({ src, sizes, type }))).toEqual([
      { src: "/crew-app-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/crew-app-icon-512.png", sizes: "512x512", type: "image/png" },
    ]);
    expect(pngDimensions("crew-app-icon-source.png")).toBe("1254x1254");
    expect(pngDimensions("crew-app-icon-192.png")).toBe("192x192");
    expect(pngDimensions("crew-app-icon-512.png")).toBe("512x512");
    expect(pngDimensions("crew-app-icon-180.png")).toBe("180x180");
    const app = readFileSync(resolve(process.cwd(), "src/app/App.jsx"), "utf8");
    expect(app).toContain('["link", "apple-touch-icon", "/crew-app-icon-180.png", "180x180"]');
  });
});
