import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { build } from "vite";

// Analyze the real production output without replacing dist or changing chunking.
const result = await build({ logLevel: "error", build: { write: false, reportCompressedSize: false } });
const outputs = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output;
const chunks = new Map(outputs.filter((item) => item.type === "chunk").map((item) => [item.fileName, item]));
const initial = new Set();
function visit(file) {
  if (initial.has(file) || !chunks.has(file)) return;
  initial.add(file);
  chunks.get(file).imports.forEach(visit);
}
for (const chunk of chunks.values()) if (chunk.isEntry) visit(chunk.fileName);
const initialModules = [...initial].flatMap((file) => Object.keys(chunks.get(file).modules));
const targets = ["FactoryWorkspacePage.jsx", "InventoryControlPage.jsx", "AssetTrackingPage.jsx"];
for (const target of targets) {
  assert(!initialModules.some((id) => id.endsWith(`/${target}`)), `${target} must remain outside initial dependency closure`);
  assert([...chunks.values()].some((chunk) => !initial.has(chunk.fileName) && Object.keys(chunk.modules).some((id) => id.endsWith(`/${target}`))), `${target} must exist in async output`);
}
const chartFamily = /\/node_modules\/(?:recharts|d3-[^/]+|@reduxjs\/toolkit|react-redux|redux|redux-thunk|reselect|immer|decimal\.js-light)\//;
assert(!initialModules.some((id) => chartFamily.test(id)), "Chart family must remain outside initial dependency closure");
const sizes = (code) => ({ bytes: Buffer.byteLength(code), gzipBytes: gzipSync(code).length });
console.log(JSON.stringify({
  initial: [...initial].map((file) => ({ file, ...sizes(chunks.get(file).code) })),
  async: [...chunks.values()].filter((chunk) => !initial.has(chunk.fileName)).map((chunk) => ({ file: chunk.fileName, ...sizes(chunk.code), imports: chunk.imports, chartModules: Object.keys(chunk.modules).filter((id) => chartFamily.test(id)).length })),
  css: outputs.filter((item) => item.type === "asset" && item.fileName.endsWith(".css")).map((item) => ({ file: item.fileName, ...sizes(item.source) })),
  assertions: "PASS: three feature implementations and chart family are absent from initial closure",
}, null, 2));
