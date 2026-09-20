import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const component = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewDisciplinaryMobile.jsx"), "utf8");
const route = readFileSync(resolve(process.cwd(), "src/features/crew/crewRoute.js"), "utf8");
const me = readFileSync(resolve(process.cwd(), "src/features/crew/components/CrewMeMobile.jsx"), "utf8");

describe("Crew Warnings & Notices V1", () => {
  it("is routed under Me and keeps the global Me navigation state", () => {
    expect(route).toContain('"me/warnings": { screen: "disciplinary" }');
    expect(me).toContain('navigate("disciplinary")');
  });

  it("uses receipt acknowledgement language without admission wording", () => {
    const english = readFileSync(resolve(process.cwd(), "src/locales/en/crew.js"), "utf8");
    expect(english).toContain("Acknowledging confirms that you received and viewed this warning");
    expect(english).toContain("does not necessarily mean that you agree");
    expect(component).not.toContain("Accept Warning");
    expect(component).not.toContain("Admit");
  });

  it("supports response, acknowledgement and private evidence reads", () => {
    expect(component).toContain("crewRespond");
    expect(component).toContain("crewAcknowledge");
    expect(component).toContain("crewEvidence");
    expect(component).toContain("CrewImageViewer");
  });

  it("keeps legacy wording while supporting the future Written Warning classification and sequence", () => {
    const english = readFileSync(resolve(process.cwd(), "src/locales/en/crew.js"), "utf8");
    expect(english).toContain('first: "First Written Warning"');
    expect(english).toContain('written: "Written Warning"');
    expect(component).toContain("display_sequence");
    expect(component).toContain("related_warning");
  });
});
