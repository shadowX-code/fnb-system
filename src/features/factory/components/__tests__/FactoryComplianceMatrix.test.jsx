import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import FactoryComplianceMatrix from "../FactoryComplianceMatrix.jsx";

function ExpandableMatrix() {
  const days = Array.from({ length: 31 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`);
  const cells = Object.fromEntries(days.map((day) => [day, { status: "pending", day }]));
  const [expandedCellKey, setExpandedCellKey] = useState("");

  return <FactoryComplianceMatrix
    rows={[{ id: "task-1", task: "Daily cleaning", frequency: "Daily", cells }]}
    days={days}
    rowKey={(row) => row.id}
    renderEntity={(row) => row.task}
    getCell={(row, day) => row.cells[day]}
    cellLabel={(cell) => Number(cell.day.slice(-2))}
    cellTitle={(cell) => `Open ${cell.day}`}
    onCellClick={(cell, row) => setExpandedCellKey(`${row.id}:${cell.day}`)}
    expandedCellKey={expandedCellKey}
    renderExpanded={(cell) => <button type="button">Complete {cell.day}</button>}
    empty={<span>No evidence</span>}
  />;
}

describe("FactoryComplianceMatrix", () => {
  it("supports canonical entity, frequency, and row identity semantics outside Cleaning of Area", () => {
    const onCellClick = vi.fn();
    render(<FactoryComplianceMatrix
      rows={[{ id: "location-1", location: "Inside Factory", count: "Daily", cells: { "2026-09-01": { status: "verified", label: "2/2" } } }]}
      days={["2026-09-01"]}
      rowKey={(row) => row.id}
      entityLabel="Location"
      frequencyLabel="Required / Day"
      renderEntity={(row) => row.location}
      renderFrequency={(row) => row.count}
      getCell={(row, day) => row.cells[day]}
      cellLabel={(cell) => cell.label}
      cellTitle={(cell, row) => `${row.location}: ${cell.label}`}
      onCellClick={onCellClick}
      empty={<span>No evidence</span>}
    />);

    expect(screen.getByRole("columnheader", { name: "Location" })).not.toBeNull();
    expect(screen.getByText("Inside Factory")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inside Factory: 2/2" }));
    expect(onCellClick).toHaveBeenCalledWith(expect.objectContaining({ label: "2/2" }), expect.objectContaining({ id: "location-1" }));
  });

  it.each(["2026-09-01", "2026-09-16", "2026-09-30"])("anchors the %s expansion to the visible monthly viewport", (day) => {
    const { container } = render(<ExpandableMatrix />);
    const view = within(container);

    fireEvent.click(view.getByRole("button", { name: `Open ${day}` }));

    const scrollContainer = view.getByTestId("factory-compliance-matrix-scroll");
    const expansion = view.getByTestId("factory-compliance-matrix-expansion");
    expect(scrollContainer.className).toContain("[container-type:inline-size]");
    expect(expansion.className).toContain("sticky");
    expect(expansion.className).toContain("left-0");
    expect(expansion.className).toContain("w-[100cqw]");
    expect(view.getByRole("button", { name: `Complete ${day}` })).not.toBeNull();
  });
});
