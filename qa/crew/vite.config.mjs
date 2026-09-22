import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export default defineConfig(({ command }) => {
  if (command !== "serve") throw new Error("Crew renderer fixtures are local tests only, never a deployment build.");
  return {
    root, plugins: [react()], envDir: false,
    optimizeDeps: { entries: ["qa/crew/index.html"] },
    resolve: { alias: [{ find: /^.*\/services\/crewService\.js$/, replacement: fileURLToPath(new URL("./fixtureService.js", import.meta.url)) }] },
    server: { host: "127.0.0.1", port: 4177, strictPort: true },
  };
});
