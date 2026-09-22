import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CrewRecoverySurface from "../CrewRecoverySurface.jsx";

afterEach(cleanup);

describe("Crew recovery surface", () => {
  it("explains offline recovery without exposing a technical error", () => {
    render(<CrewRecoverySurface mode="offline" onRetry={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("You're offline");
    expect(screen.getByText("Waiting for connection…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" }).disabled).toBe(true);
  });

  it("offers retry first and reload only after repeated connection failures", () => {
    const retry = vi.fn();
    const reload = vi.fn();
    const { rerender } = render(<CrewRecoverySurface mode="connection" attempts={1} onRetry={retry} onReload={reload} />);
    expect(screen.getByRole("button", { name: "Try again" }).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Reload FeedX" })).toBeNull();
    rerender(<CrewRecoverySurface mode="connection" attempts={2} onRetry={retry} onReload={reload} />);
    expect(screen.getByRole("button", { name: "Reload FeedX" })).toBeTruthy();
  });
});
