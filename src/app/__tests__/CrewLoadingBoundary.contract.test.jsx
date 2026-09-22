import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const app = readFileSync(resolve(process.cwd(), "src/app/App.jsx"), "utf8");

describe("Crew bootstrap loading boundary", () => {
  it("keeps Admin authentication and route registration behind workspace selection", () => {
    const main = readFileSync(resolve(process.cwd(), "src/main.jsx"), "utf8");
    expect(main).not.toContain("AuthProvider");
    expect(app).not.toContain("useAuth");
    expect(app).not.toContain("salesPurchaseRoutes");
    expect(app).not.toContain("Loading Smart Operations Workspace");
    expect(app).toContain('lazy(() => import("./AdminApp.jsx"))');
    expect(app).toContain('lazy(() => import("./CrewEntry.jsx"))');
  });
});
