import { lazy } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WorkspaceBoundary from "../WorkspaceBoundary.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(["crew", "admin"])("shows a neutral, accessible %s bootstrap until entry resolves", async (workspace) => {
  let resolve;
  const Entry = lazy(() => new Promise((done) => { resolve = done; }));
  render(<WorkspaceBoundary workspace={workspace}><Entry /></WorkspaceBoundary>);
  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.queryByText(/Smart Operations/)).toBeNull();
  await act(async () => resolve({ default: () => <h1>Ready</h1> }));
  expect(screen.getByRole("heading").textContent).toBe("Ready");
  expect(screen.queryByRole("status")).toBeNull();
});

it("contains failed entry chunks with explicit reload and permits workspace switching", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const Entry = lazy(() => Promise.reject(new Error("chunk unavailable")));
  const view = render(<WorkspaceBoundary key="crew" workspace="crew"><Entry /></WorkspaceBoundary>);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reload page" })).toBeTruthy();
  view.rerender(<WorkspaceBoundary key="admin" workspace="admin"><h1>Admin</h1></WorkspaceBoundary>);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("heading").textContent).toBe("Admin");
});
