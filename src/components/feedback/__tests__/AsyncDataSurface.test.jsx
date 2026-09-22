import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AsyncDataSurface from "../AsyncDataSurface.jsx";

describe("AsyncDataSurface", () => {
  it("distinguishes loading, empty, error and loaded states", () => {
    const { rerender, container } = render(<AsyncDataSurface loading><div>Rows</div></AsyncDataSurface>);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("Rows")).toBeNull();
    rerender(<AsyncDataSurface isEmpty emptyTitle="No Crew">Rows</AsyncDataSurface>);
    expect(screen.getByText("No Crew")).toBeTruthy();
    rerender(<AsyncDataSurface hasData><div>Rows</div></AsyncDataSurface>);
    expect(container.textContent).toContain("Rows");
  });

  it("shows retry for a failed initial read and preserves loaded data on a refresh failure", () => {
    const retry = vi.fn(); const { rerender, container } = render(<AsyncDataSurface error="Unable to load Crew" onRetry={retry}><div>Rows</div></AsyncDataSurface>);
    expect(screen.getByRole("alert").textContent).toContain("Unable to load Crew");
    expect(container.textContent).not.toContain("Rows");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
    rerender(<AsyncDataSurface error="Unavailable" hasData onRetry={retry}><div>Rows</div></AsyncDataSurface>);
    expect(container.textContent).toContain("Rows");
    expect(screen.getByRole("alert").textContent).toContain("last successfully loaded data");
  });

  it("supports a human-readable error title and empty-state actions", () => {
    const create = vi.fn();
    const { rerender, container } = render(<AsyncDataSurface error="statement timeout" errorTitle="Unable to load SOP Library" />);
    expect(within(container).getByRole("alert").textContent).toContain("Unable to load SOP Library");
    expect(within(container).getByRole("alert").textContent).toContain("statement timeout");
    rerender(<AsyncDataSurface isEmpty emptyTitle="No SOPs yet" emptyActions={<button type="button" onClick={create}>Create SOP</button>} />);
    fireEvent.click(within(container).getByRole("button", { name: "Create SOP" }));
    expect(create).toHaveBeenCalledTimes(1);
  });
});
