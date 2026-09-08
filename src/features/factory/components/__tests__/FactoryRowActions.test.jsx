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

  it("keeps a destructive-only secondary action protected in the overflow", () => {
    const remove = vi.fn();
    render(<FactoryRowActions directSingleSecondary secondaryActions={[{ label: "Delete", destructive: true, onClick: remove }]} />);

    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More row actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).toHaveBeenCalledOnce();
  });

  it("supports visible common actions while keeping a destructive action protected", () => {
    const edit = vi.fn();
    const archive = vi.fn();
    render(<FactoryRowActions directActions={[{ label: "Edit Packaging SKU", onClick: edit }]} secondaryActions={[{ label: "Archive", destructive: true, onClick: archive }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Packaging SKU" }));
    expect(edit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "More row actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(archive).toHaveBeenCalledOnce();
  });
});
