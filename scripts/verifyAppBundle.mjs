import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { build } from "vite";

// Analyze the real production output without replacing dist or changing chunking.
const result = await build({ logLevel: "error", build: { write: false, reportCompressedSize: false } });
const outputs = Array.isArray(result) ? result.flatMap((item) => item.output) : result.output;
const chunks = new Map(outputs.filter((item) => item.type === "chunk").map((item) => [item.fileName, item]));
function closure(roots) {
  const files = new Set();
  function visit(file) {
    if (files.has(file) || !chunks.has(file)) return;
    files.add(file);
    chunks.get(file).imports.forEach(visit);
  }
  roots.forEach(visit);
  return files;
}
const initial = closure([...chunks.values()].filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName));
function workspaceClosure(module) {
  const owner = [...chunks.values()].find((chunk) => Object.keys(chunk.modules).some((id) => id.endsWith(module)));
  assert(owner, `${module} must exist in output`);
  assert(!initial.has(owner.fileName), `${module} must be lazy from bootstrap`);
  return closure([...initial, owner.fileName]);
}
const admin = workspaceClosure("/src/app/AdminApp.jsx");
const crew = workspaceClosure("/src/app/CrewEntry.jsx");
const modules = (files) => [...files].flatMap((file) => Object.keys(chunks.get(file).modules));
function excludes(files, paths, label) {
  for (const path of paths) assert(!modules(files).some((id) => id.endsWith(path)), `${label} must exclude ${path}`);
}
excludes(initial, ["/src/auth/AuthContext.jsx", "/src/app/routes.jsx", "/CrewMobileApp.jsx", "/src/i18n/index.js"], "Bootstrap");
excludes(crew, ["/src/auth/AuthContext.jsx", "/src/app/routes.jsx", "/src/app/AdminApp.jsx", "/src/layouts/AppShell.jsx", "/ReportsPage.jsx"], "Crew initial");
excludes(admin, ["/CrewMobileApp.jsx", "/CrewHomeMobile.jsx", "/src/app/CrewEntry.jsx", "/hooks/useCrewSession.js"], "Admin initial");
assert(!modules(crew).some((id) => !id.endsWith(".css") && (/\/src\/(?:auth|layouts)\//.test(id) || /\/src\/features\/(?:sales-purchase\/pages|crew\/pages|reports\/pages)\//.test(id))), "Crew initial must exclude Admin auth, shell and page implementations");
for (const shared of ["/CrewOperationsMobile.jsx", "/CrewTaskBlockRenderer.jsx", "/CrewSopDocument.jsx", "/src/i18n/index.js"]) {
  const owners = [...chunks.values()].filter((chunk) => Object.keys(chunk.modules).some((id) => id.endsWith(shared)));
  assert.equal(owners.length, 1, `${shared} must have one emitted implementation`);
  assert(admin.has(owners[0].fileName) && crew.has(owners[0].fileName), `${shared} must remain genuinely shared`);
}
excludes(crew, ["/CrewGrowthMobile.jsx", "/CrewRewardMobile.jsx", "/CrewLearningMobile.jsx", "/CrewCashCheckoutMobile.jsx", "/CrewLeaveMobile.jsx"], "Crew secondary lazy boundaries");
assert(!modules(admin).some((id) => /\/node_modules\/(?:gsap|@gsap\/react)\//.test(id)), "GSAP must stay outside Admin initial");
const initialModules = [...initial].flatMap((file) => Object.keys(chunks.get(file).modules));
const targets = ["FactoryWorkspacePage.jsx", "InventoryControlPage.jsx", "AssetTrackingPage.jsx"];
for (const target of targets) {
  excludes(admin, [`/${target}`], "Admin initial");
  excludes(crew, [`/${target}`], "Crew initial");
  assert(!initialModules.some((id) => id.endsWith(`/${target}`)), `${target} must remain outside initial dependency closure`);
  assert([...chunks.values()].some((chunk) => !initial.has(chunk.fileName) && Object.keys(chunk.modules).some((id) => id.endsWith(`/${target}`))), `${target} must exist in async output`);
}
const chartFamily = /\/node_modules\/(?:recharts|d3-[^/]+|@reduxjs\/toolkit|react-redux|redux|redux-thunk|reselect|immer|decimal\.js-light)\//;
assert(!initialModules.some((id) => chartFamily.test(id)), "Chart family must remain outside initial dependency closure");
assert(!modules(admin).some((id) => chartFamily.test(id)), "Chart family must remain outside Admin initial");
assert(!modules(crew).some((id) => chartFamily.test(id)), "Chart family must remain outside Crew initial");
const sizes = (code) => ({ bytes: Buffer.byteLength(code), gzipBytes: gzipSync(code).length });
const cssAssets = new Map(outputs.filter((item) => item.type === "asset" && item.fileName.endsWith(".css")).map((item) => [item.fileName, item]));
const cssClosure = (files) => new Set([...files].flatMap((file) => [...(chunks.get(file).viteMetadata?.importedCss ?? [])]));
const initialCss = cssClosure(initial);
const cssFeatures = [
  ["CrewCashCheckoutMobile", ["CrewCashCheckoutMobile"]],
  ["CrewGrowthMobile", ["CrewGrowthMobile", "CrewPerformanceComponentModal"]],
  ["CrewRewardMobile", ["CrewRewardMobile"]],
  ["CrewLeaveMobile", ["CrewLeaveMobile"]],
];
const featureCss = cssFeatures.map(([feature, styles]) => {
  const owner = [...chunks.values()].find((chunk) => Object.keys(chunk.modules).some((id) => id.endsWith(`/${feature}.jsx`)));
  assert(owner, `${feature} must exist in output`);
  const ownedCss = [...(owner.viteMetadata?.importedCss ?? [])];
  assert.equal(ownedCss.length, 1, `${feature} must load one feature stylesheet (Growth includes Performance detail)`);
  for (const file of ownedCss) {
    assert(cssAssets.has(file), `${feature} stylesheet must be emitted`);
    for (const scope of [initial, admin, crew]) assert(!cssClosure(scope).has(file), `${feature} CSS must not load with either workspace initial closure`);
  }
  for (const style of styles) {
    for (const [scope, label] of [[initial, "Bootstrap"], [admin, "Admin initial"], [crew, "Crew initial"]]) excludes(scope, [`/${style}.css`], label);
    assert(Object.keys(owner.modules).some((id) => id.endsWith(`/${style}.css`)), `${style} CSS must belong to ${feature}, not a separate eager owner`);
  }
  return { feature, styles, files: ownedCss.map((file) => ({ file, ...sizes(cssAssets.get(file).source) })) };
});
for (const shared of ["CrewMobileSystem", "CrewMobileTypography", "CrewTaskBlockRenderer", "CrewSopDocument", "CrewLearningMobile"]) {
  assert(modules(initial).some((id) => id.endsWith(`/${shared}.css`)), `${shared} CSS must remain shared/eager`);
}
const describeClosure = (files) => ({
  ...[...files].reduce((sum, file) => {
    const size = sizes(chunks.get(file).code);
    return { bytes: sum.bytes + size.bytes, gzipBytes: sum.gzipBytes + size.gzipBytes };
  }, { bytes: 0, gzipBytes: 0 }),
  files: [...files],
  crewContributors: modules(files).filter((id) => id.includes("/src/features/crew/") && !id.endsWith(".css")).map((id) => id.slice(id.indexOf("/src/") + 1)),
  otherApplicationModules: modules(files).filter((id) => id.includes("/src/") && !id.includes("/src/features/crew/") && !id.includes("/node_modules/") && !id.endsWith(".css")).map((id) => id.slice(id.indexOf("/src/") + 1)),
});
console.log(JSON.stringify({
  closures: { bootstrap: describeClosure(initial), admin: describeClosure(admin), crew: describeClosure(crew) },
  initial: [...initial].map((file) => ({ file, ...sizes(chunks.get(file).code) })),
  async: [...chunks.values()].filter((chunk) => !initial.has(chunk.fileName)).map((chunk) => ({ file: chunk.fileName, ...sizes(chunk.code), imports: chunk.imports, chartModules: Object.keys(chunk.modules).filter((id) => chartFamily.test(id)).length })),
  css: outputs.filter((item) => item.type === "asset" && item.fileName.endsWith(".css")).map((item) => ({ file: item.fileName, ...sizes(item.source) })),
  initialCss: [...initialCss].map((file) => ({ file, ...sizes(cssAssets.get(file).source) })),
  featureCss,
  assertions: "PASS: workspace entries/auth/GSAP, Crew lazy JS/CSS ownership, shared CSS, Admin async features and chart family",
}, null, 2));
