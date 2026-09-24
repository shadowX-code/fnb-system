import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const publicFile = (name) => resolve(process.cwd(), "public", name);

function pngDimensions(name) {
  const data = readFileSync(publicFile(name));
  expect(data.subarray(1, 4).toString()).toBe("PNG");
  return `${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`;
}

function pngSha256(name) {
  return createHash("sha256").update(readFileSync(publicFile(name))).digest("hex");
}

describe("Crew Web App icon", () => {
  it("uses source-derived PWA sizes and a dedicated Apple icon", () => {
    const manifest = JSON.parse(readFileSync(publicFile("crew.webmanifest"), "utf8"));
    expect(manifest.icons.map(({ src, sizes, type }) => ({ src, sizes, type }))).toEqual([
      { src: "/crew-app-icon-v2-192.png", sizes: "192x192", type: "image/png" },
      { src: "/crew-app-icon-v2-512.png", sizes: "512x512", type: "image/png" },
    ]);
    expect(manifest.icons.find(({ sizes }) => sizes === "512x512")?.purpose).toBe("any maskable");
    expect(pngDimensions("crew-app-icon-source.png")).toBe("1254x1254");
    expect(pngDimensions("crew-app-icon-v2-192.png")).toBe("192x192");
    expect(pngDimensions("crew-app-icon-v2-512.png")).toBe("512x512");
    expect(pngDimensions("crew-app-icon-v2-180.png")).toBe("180x180");
    expect(pngSha256("crew-app-icon-source.png")).toBe("ffcb386ad86805d65902cd2a7822befa0b324d7e37dd7858f0e1b5c0f23d6317");
    for (const size of [180, 192, 512]) {
      expect(existsSync(publicFile(`crew-app-icon-${size}.png`))).toBe(false);
    }
    const app = readFileSync(resolve(process.cwd(), "src/app/App.jsx"), "utf8");
    expect(app).toContain('["link", "icon", "/crew-app-icon-v2-192.png", "192x192"]');
    expect(app).toContain('["link", "apple-touch-icon", "/crew-app-icon-v2-180.png", "180x180"]');
  });
});
