// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const config=JSON.parse(readFileSync(new URL("../../../vercel.json",import.meta.url),"utf8"));
const cacheRule=config.routes.find(route=>route.headers?.["Cache-Control"]?.includes("immutable"));
const matches=path=>new RegExp(`^${cacheRule.src}`).test(path);
it.each(["/assets/FactoryProductionSopPage-s883h9Oi.js","/assets/index-Ca5e_9-x.css"])("caches only content-addressed build assets: %s",path=>{
 expect(matches(path)).toBe(true);
 expect(cacheRule.headers["Cache-Control"]).toBe("public, max-age=31536000, immutable");
 expect(cacheRule.continue).toBe(true);
});
it.each(["/index.html","/factory/production/overview","/api/example","/assets/index.js","/assets/index-12345678.js.map","/assets/index-12345678.html","/assets/nested/index-12345678.js"])("does not alter freshness for %s",path=>expect(matches(path)).toBe(false));
it("serves real assets first and prevents missing chunks falling through to cached SPA HTML",()=>{
 const cacheIndex=config.routes.indexOf(cacheRule);
 const filesystem=config.routes.findIndex(route=>route.handle==="filesystem");
 const missing=config.routes.findIndex(route=>route.src==="/assets/.*"&&route.status===404);
 const fallback=config.routes.findIndex(route=>route.src==="/(.*)"&&route.dest==="/index.html");
 expect(cacheIndex).toBeLessThan(filesystem);
 expect(filesystem).toBeLessThan(missing);
 expect(missing).toBeLessThan(fallback);
 expect(config.routes[missing].headers["Cache-Control"]).toBe("no-store");
});
