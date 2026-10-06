import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(
      container.querySelector("[data-page-header-secondary-actions]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-page-header-primary-actions]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-page-header-actions]").className,
    ).toContain("w-full");
    expect(
      container.querySelector("[data-page-header-actions]").className,
    ).toContain("md:w-auto");
  });

  it("retains the legacy actions slot for existing consumers", () => {
    render(
      <PageHeader
        title="Factory"
        actions={<button type="button">Legacy action</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Legacy action" })).toBeTruthy();
  });
});

it("owns breadcrumb navigation and colocated metadata without changing legacy headers", () => {
  const back = vi.fn();
  const { container } = render(
    <PageHeader
      title="Service Crew"
      breadcrumbs={[
        { label: "Recruitment", onClick: back },
        { label: "Service Crew" },
      ]}
      metadata={<span>Full Time + Part Time</span>}
    />,
  );
  const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
  expect(nav.querySelector('[aria-current="page"]').textContent).toBe(
    "Service Crew",
  );
  fireEvent.click(screen.getByRole("button", { name: "Recruitment" }));
  expect(back).toHaveBeenCalledOnce();
  expect(
    container.querySelector("[data-page-header-metadata]").textContent,
  ).toBe("Full Time + Part Time");
});
