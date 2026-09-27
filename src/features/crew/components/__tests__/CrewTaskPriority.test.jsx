import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "../../../../i18n/index.js";
import CrewTaskPriority, { CrewTaskHeading, CrewTaskMetadata } from "../CrewTaskPriority.jsx";

afterEach(cleanup);
describe("Crew task priority", () => {
  it("keeps the full long title separate from priority metadata", () => {
    const title = "Cashier Float Verification with a long operational task title";
    const { container } = render(<CrewTaskHeading title={title} />);
    const heading = container.querySelector(".crew-task-heading");
    expect(heading.querySelector("strong").textContent).toBe(title);
    expect(heading.querySelector(".crew-task-priority")).toBeNull();
  });
  it("keeps Normal quiet", () => {
    const { container } = render(<CrewTaskPriority priority="normal" />);
    expect(container.textContent).toBe("");
  });
  it.each(["important", "critical"])("presents %s without status badge treatment", (priority) => {
    render(<CrewTaskPriority priority={priority} />);
    expect(screen.getByText(priority === "important" ? "Important" : "Critical")).toBeTruthy();
    expect(screen.getByText(priority === "important" ? "Important" : "Critical").classList.contains("crew-ui-status")).toBe(false);
  });
  it.each([
    ["critical", "Not Started"], ["critical", "Overdue"],
    ["important", "Not Started"], ["important", "Overdue"], ["normal", "Not Started"],
  ])("stacks %s above unchanged %s status", (priority, status) => {
    const { container } = render(<CrewTaskMetadata priority={priority} tone={status === "Overdue" ? "danger" : "warning"}>{status}</CrewTaskMetadata>);
    const metadata = container.querySelector(".crew-task-metadata");
    expect(metadata.lastElementChild.classList.contains("crew-ui-status")).toBe(true);
    expect(metadata.lastElementChild.textContent).toBe(status);
    expect(metadata.children.length).toBe(priority === "normal" ? 1 : 2);
    if (priority !== "normal") expect(metadata.firstElementChild.querySelector('i[aria-hidden="true"]')).toBeTruthy();
  });
});
