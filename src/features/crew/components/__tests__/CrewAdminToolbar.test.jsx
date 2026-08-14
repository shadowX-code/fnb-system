import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import CrewAdminToolbar, { CrewAdminOutletField } from "../CrewAdminToolbar.jsx";
import { CREW_ADMIN_OUTLET_STORAGE_KEY, CrewAdminOutletProvider, useCrewAdminOutlet } from "../../context/CrewAdminOutletContext.jsx";

const outlets = [{ id: "outlet-1", name: "Friends Corner", is_active: true }, { id: "outlet-2", name: "Hola Hola", is_active: true }];

function Harness() {
  const { outletId } = useCrewAdminOutlet();
  return <><CrewAdminToolbar outlet={<CrewAdminOutletField />} time={<label>Period<input aria-label="Period" /></label>} search={<label>Search<input aria-label="Search Crew" /></label>} filters={<label>Status<input aria-label="Status" /></label>} secondary={<button>Clone</button>} primary={<button>Create</button>} /><output>{outletId}</output></>;
}

describe("CrewAdminToolbar", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("keeps Outlet first and the primary action at the end", () => {
    render(<CrewAdminOutletProvider outlets={outlets}><Harness /></CrewAdminOutletProvider>);
    const toolbar = screen.getByLabelText("Page controls");
    expect(toolbar.querySelector("[data-toolbar-slot='outlet']")).toBe(toolbar.querySelector(".crew-admin-toolbar-controls")?.firstElementChild);
    expect(toolbar.querySelector("[data-toolbar-slot='actions']")?.lastElementChild?.textContent).toBe("Create");
    expect(screen.getAllByRole("button", { name: "Outlet" })).toHaveLength(1);
  });

  it("persists an allowed Outlet and falls back when it becomes invalid", () => {
    const view = render(<CrewAdminOutletProvider outlets={outlets}><Harness /></CrewAdminOutletProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Outlet" }));
    fireEvent.click(screen.getByRole("button", { name: "Hola Hola" }));
    expect(localStorage.getItem(CREW_ADMIN_OUTLET_STORAGE_KEY)).toBe("outlet-2");
    view.rerender(<CrewAdminOutletProvider outlets={[outlets[0]]}><Harness /></CrewAdminOutletProvider>);
    expect(screen.getByText("outlet-1")).not.toBeNull();
  });
});
