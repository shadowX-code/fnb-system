import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FactoryRowActions from "../FactoryRowActions.jsx";

afterEach(cleanup);

describe("FactoryRowActions", () => {
  it("keeps the lifecycle action visible and moves secondary actions into an overflow", () => {
    const submit = vi.fn();
    const view = vi.fn();
    const edit = vi.fn();
    const remove = vi.fn();
    render(<FactoryRowActions onView={view} primaryAction={{ label: "Submit", onClick: submit }} secondaryActions={[{ label: "Edit", onClick: edit }, { label: "Delete", destructive: true, onClick: remove }]} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label") || button.textContent)).toEqual(["Submit", "View details", "More row actions"]);
    fireEvent.click(screen.getByRole("button", { name: "More row actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "More row actions" })).not.toBeNull();
  });

  it("does not render an empty overflow menu", () => {
    render(<FactoryRowActions onView={vi.fn()} />);
    expect(screen.getByRole("button", { name: "View details" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "More row actions" })).toBeNull();
  });
});
