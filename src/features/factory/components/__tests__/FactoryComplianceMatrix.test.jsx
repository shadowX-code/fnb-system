import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FactoryComplianceMatrix from "../FactoryComplianceMatrix.jsx";

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
});
