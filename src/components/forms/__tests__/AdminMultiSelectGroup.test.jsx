import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import AdminMultiSelectGroup from "../AdminMultiSelectGroup.jsx";
import { FactoryMestiLocationSelection, FactoryMestiScheduleFields } from "../../../features/factory/components/FactoryMestiRequirementFields.jsx";

afterEach(cleanup);
const locations = [{ id: "cooking", location_name: "Cooking Room" }, { id: "prep", location_name: "Preparation Room" }];

it("selects entire tiles without changing ID types or hidden linked values", () => {
  const change = vi.fn();
  function Harness() {
    const [value, setValue] = useState(["retained-inactive"]);
    return <FactoryMestiLocationSelection locations={locations} value={value} onChange={next => { setValue(next); change(next); }} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByText("Cooking Room"));
  expect(change).toHaveBeenLastCalledWith(["retained-inactive", "cooking"]);
  expect(screen.getByRole("checkbox", { name: "Cooking Room" }).checked).toBe(true);
  expect(screen.getByText("2 selected")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Select All" }));
  expect(change).toHaveBeenLastCalledWith(["retained-inactive", "cooking", "prep"]);
  expect(screen.getByRole("button", { name: "Select All" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(change).toHaveBeenLastCalledWith([]);
  expect(screen.getByRole("button", { name: "Clear" }).disabled).toBe(true);
});

it("keeps seven native keyboard-accessible weekday chips and numeric values across frequency changes", () => {
  function Harness() {
    const [frequency, setFrequency] = useState("weekly");
    const [weekdays, setWeekdays] = useState([1]);
    return <FactoryMestiScheduleFields frequency={frequency} weekdays={weekdays} status="active" onFrequencyChange={setFrequency} onWeekdaysChange={setWeekdays} onStatusChange={() => {}} />;
  }
  render(<Harness />);
  expect(screen.getAllByRole("checkbox")).toHaveLength(7);
  const wed = screen.getByRole("checkbox", { name: "Wed" });
  wed.focus();
  expect(document.activeElement).toBe(wed);
  fireEvent.keyDown(wed, { key: "Enter" });
  expect(wed.checked).toBe(true);
  expect(screen.getByText("2 selected")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Daily" }));
  expect(screen.queryByRole("group", { name: "Weekdays" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Weekly" }));
  expect(screen.getByRole("checkbox", { name: "Mon" }).checked).toBe(true);
  expect(screen.getByRole("checkbox", { name: "Wed" }).checked).toBe(true);
});

it("Enter toggles once without submitting, and disabled groups cannot change", () => {
  const change = vi.fn();
  const submit = vi.fn(event => event.preventDefault());
  const options = [{ value: 3, label: "Wed" }];
  const { rerender } = render(<form onSubmit={submit}><AdminMultiSelectGroup label="Weekdays" options={options} value={[]} onChange={change} variant="chips" /></form>);
  fireEvent.keyDown(screen.getByRole("checkbox"), { key: "Enter" });
  expect(change).toHaveBeenCalledExactlyOnceWith([3]);
  expect(submit).not.toHaveBeenCalled();
  rerender(<AdminMultiSelectGroup label="Weekdays" options={options} value={[3]} onChange={change} disabled variant="chips" />);
  fireEvent.keyDown(screen.getByRole("checkbox"), { key: "Enter" });
  expect(change).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("group").disabled).toBe(true);
});

it("uses outlined and ghost commands and canonical empty-state semantics", () => {
  render(<FactoryMestiLocationSelection locations={[]} value={[]} onChange={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Select All" }).className).toContain("btn-secondary");
  expect(screen.getByRole("button", { name: "Clear" }).className).toContain("btn-ghost");
  expect(screen.getByText("No active Locations.")).toBeTruthy();
  expect(screen.getByText("0 selected")).toBeTruthy();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("owns theme-aware chip/tile/focus styling in the reusable selector, not MeSTI pages", () => {
  const css = readFileSync("src/components/forms/AdminMultiSelectGroup.css", "utf8");
  expect(css).toContain("grid-template-columns:repeat(7,minmax(0,1fr))");
  expect(css).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
  expect(css).toContain("@container");
  expect(css).toContain("white-space:nowrap");
  expect(css).toContain("grid-template-columns:repeat(4,minmax(0,1fr))");
  expect(css).toContain("input:checked + .admin-multi-select-surface");
  expect(css).toContain("var(--theme-primary-soft)");
  expect(css).toContain("var(--factory-success-border)");
  expect(css).toContain("input:focus-visible + .admin-multi-select-surface");
  expect(css).not.toMatch(/#[a-f0-9]{3,8}\b/i);
});
