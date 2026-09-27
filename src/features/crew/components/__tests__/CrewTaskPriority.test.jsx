import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "../../../../i18n/index.js";
import CrewTaskPriority from "../CrewTaskPriority.jsx";

afterEach(cleanup);
describe("Crew task priority", () => {
  it("keeps Normal quiet", () => {
    const { container } = render(<CrewTaskPriority priority="normal" />);
    expect(container.textContent).toBe("");
  });
  it.each(["important", "critical"])("presents %s using shared status treatment", (priority) => {
    render(<CrewTaskPriority priority={priority} />);
    expect(screen.getByText(priority === "important" ? "Important" : "Critical")).toBeTruthy();
  });
});
