import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FactoryComplianceMatrix from "../FactoryComplianceMatrix.jsx";
import { cleaningMonthlyHierarchy } from "../../utils/cleaningMonthlyHierarchy.js";
import { FactoryMestiLocationSelection } from "../FactoryMestiRequirementFields.jsx";

afterEach(cleanup);
const occurrence = { id: "occ-1", due_date: "2026-09-07", status: "completed", location_id: "loc-1", location_name: "Kitchen" };
const task = { requirement_id: "v1", logical_requirement_id: "task", task_name: "Floor", days: [{ due_date: "2026-09-07", status: "completed", occurrences: [occurrence] }] };

it("preserves exact version/occurrence objects, status and absence on unscheduled days", () => {
  const input = [task, { ...task, requirement_id: "v2", days: [] }];
  const before = JSON.stringify(input);
  const rows = cleaningMonthlyHierarchy(input);
  expect(rows[0].children[0].calendarCells.get("2026-09-07")).toBe(occurrence);
  expect(rows[0].children[0].calendarCells.has("2026-09-08")).toBe(false);
  expect(rows[1].matrix_key).not.toBe(rows[0].matrix_key);
  expect(rows[1].children).toEqual([]);
  expect(JSON.stringify(input)).toBe(before);
});

it("defaults small task lists open, collapses large lists and preserves sticky calendar identity", () => {
  const props = { days: ["2026-09-07"], rowKey: row => row.matrix_key, getChildren: row => row.children, getCell: (row, day) => row.calendarCells.get(day), renderEntity: row => row.location_name || row.task_name, cellLabel: cell => cell.status, cellTitle: (cell, row) => `${row.location_name || row.task_name}: ${cell.status}`, onCellClick: vi.fn(), isCellInteractive: row => Boolean(row.location_name) };
  const { unmount } = render(<FactoryComplianceMatrix {...props} rows={cleaningMonthlyHierarchy([task])} />);
  expect(screen.getByText("Kitchen")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Kitchen: completed" })).toBeTruthy();
  expect(screen.getByText("Kitchen").closest("td").className).toContain("sticky left-0");
  unmount();
  render(<FactoryComplianceMatrix {...props} rows={cleaningMonthlyHierarchy(Array.from({ length: 6 }, (_, i) => ({ ...task, requirement_id: `v${i}` })))} />);
  expect(screen.queryByText("Kitchen")).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: "Expand Floor locations" })[0]);
  expect(screen.getByText("Kitchen")).toBeTruthy();
});

it("Select All retains linked inactive IDs while explicit Clear removes selections", () => {
  const change = vi.fn();
  render(<FactoryMestiLocationSelection locations={[{ id: "active", location_name: "Kitchen" }]} value={["inactive"]} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Select All" }));
  expect(change).toHaveBeenCalledWith(["inactive", "active"]);
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(change).toHaveBeenCalledWith([]);
});
