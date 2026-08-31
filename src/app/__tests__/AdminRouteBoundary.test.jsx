import { lazy, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminRouteBoundary from "../AdminRouteBoundary.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Admin route loading and recovery", () => {
  it("keeps the shell visible while a route loads, then renders existing props", async () => {
    let resolve;
    const Page = lazy(() => new Promise((done) => { resolve = done; }));
    render(<><nav>Admin navigation</nav><AdminRouteBoundary routeKey="inventory_master" label="Inventory"><Page initialTab="master" /></AdminRouteBoundary></>);
    expect(screen.getByText("Admin navigation")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loading Inventory…");
    await act(async () => resolve({ default: ({ initialTab }) => <h1>{initialTab}</h1> }));
    expect(screen.getByRole("heading").textContent).toBe("master");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("preserves the feature lifetime across same-owner subroutes", () => {
    function Page({ tab }) {
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount(count + 1)}>{tab}: {count}</button>;
    }
    const { rerender } = render(<AdminRouteBoundary routeKey="factory_dashboard"><Page tab="dashboard" /></AdminRouteBoundary>);
    fireEvent.click(screen.getByRole("button"));
    rerender(<AdminRouteBoundary routeKey="factory_finished_goods"><Page tab="finished-goods" /></AdminRouteBoundary>);
    expect(screen.getByRole("button").textContent).toBe("finished-goods: 1");
  });

  it("contains rejected chunks, offers explicit reload, and lets another route recover", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Page = lazy(() => Promise.reject(new Error("Failed to fetch dynamically imported module")));
    const { rerender } = render(<><nav>Admin navigation</nav><AdminRouteBoundary routeKey="asset_tracking"><Page /></AdminRouteBoundary></>);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeTruthy();
    expect(screen.getByText("Admin navigation")).toBeTruthy();
    rerender(<><nav>Admin navigation</nav><AdminRouteBoundary routeKey="dashboard"><h1>Dashboard</h1></AdminRouteBoundary></>);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("heading").textContent).toBe("Dashboard");
  });
});
