import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "../../../../i18n/index.js";
import CrewTaskPriority, { CrewTaskHeading } from "../CrewTaskPriority.jsx";

afterEach(cleanup);
describe("Crew task priority", () => {
  it.each(["normal", "important", "critical"])("groups a long title and %s priority in one heading", (priority) => {
    const title = "Cashier Float Verification with a long operational task title";
    const { container } = render(<CrewTaskHeading title={title} priority={priority} />);
    const heading = container.querySelector(".crew-task-heading");
    expect(heading.querySelector("strong").textContent).toBe(title);
    expect(heading.querySelectorAll(".crew-ui-status").length).toBe(priority === "normal" ? 0 : 1);
  });
  it("keeps Normal quiet", () => {
    const { container } = render(<CrewTaskPriority priority="normal" />);
    expect(container.textContent).toBe("");
  });
  it.each(["important", "critical"])("presents %s using shared status treatment", (priority) => {
    render(<CrewTaskPriority priority={priority} />);
    expect(screen.getByText(priority === "important" ? "Important" : "Critical")).toBeTruthy();
  });
});
