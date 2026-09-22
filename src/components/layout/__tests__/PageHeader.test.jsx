import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PageHeader from "../PageHeader.jsx";

afterEach(cleanup);

describe("PageHeader", () => {
  it("groups secondary and primary page commands in a responsive action area", () => {
    const { container } = render(
      <PageHeader
        section="Crew"
        title="Tasks"
        secondaryActions={<button type="button">Export</button>}
        primaryActions={<button type="button">Create Task</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Task" })).toBeTruthy();
    expect(container.querySelector("[data-page-header-secondary-actions]")).not.toBeNull();
    expect(container.querySelector("[data-page-header-primary-actions]")).not.toBeNull();
    expect(container.querySelector("[data-page-header-actions]").className).toContain("w-full");
    expect(container.querySelector("[data-page-header-actions]").className).toContain("md:w-auto");
  });

  it("retains the legacy actions slot for existing consumers", () => {
    render(<PageHeader title="Factory" actions={<button type="button">Legacy action</button>} />);
    expect(screen.getByRole("button", { name: "Legacy action" })).toBeTruthy();
  });
});
