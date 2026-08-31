import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const app = readFileSync(resolve(process.cwd(), "src/app/App.jsx"), "utf8");

describe("Crew bootstrap loading boundary", () => {
  it("mounts Crew before the Admin auth loading presentation", () => {
    const crewBranch = app.indexOf("if (crewRouteRequested)");
    const adminLoading = app.indexOf("if (auth.loading || auth.contextLoading)");

    expect(crewBranch).toBeGreaterThan(-1);
    expect(adminLoading).toBeGreaterThan(-1);
    expect(crewBranch).toBeLessThan(adminLoading);
    expect(app.slice(crewBranch, adminLoading)).not.toContain("Loading Smart Operations Workspace");
  });
});
