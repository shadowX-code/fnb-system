import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FactoryEvidenceGrid, FactoryEvidencePreview, FactoryOperationalSummary } from "../FactoryEvidencePresentation.jsx";
import FactorySummaryCard from "../FactorySummaryCard.jsx";

describe("Factory evidence presentation", () => {
  it("renders compact operational metrics separately from session state", () => {
    render(<FactoryOperationalSummary items={[{ label: "Due", value: 2 }, { label: "Pending", value: 1, tone: "warning" }]} status={<span>Draft</span>} />);
    expect(screen.getByLabelText("Operational summary").textContent).toContain("Due");
    expect(screen.getByLabelText("Operational summary").textContent).toContain("Draft");
    expect(screen.getByText("Due").closest("div.card").className).toContain("min-h-[70px]");
  });

  it("keeps the standard Factory summary card sizing for overview surfaces", () => {
    render(<FactorySummaryCard label="Total" value={4} />);
    expect(screen.getByText("Total").closest("div.card").className).toContain("min-h-[82px]");
  });

  it("reveals a compact QC preview on focus and opens rich evidence on click", () => {
    const onOpen = vi.fn();
    render(<FactoryEvidencePreview label="Passed · 2/2" items={[{ id: "qc-1", qc_name: "Temperature", result: "pass" }]} onOpen={onOpen} />);
    const trigger = screen.getByRole("button", { name: /View QC evidence/i });
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip").textContent).toContain("Temperature");
    fireEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("uses a responsive semantic key-value grid", () => {
    render(<FactoryEvidenceGrid items={[{ label: "Batch", value: "PB-1" }, { label: "Remarks", value: "No remarks", fullWidth: true }]} />);
    expect(screen.getByText("Batch")).toBeTruthy();
    expect(screen.getByText("No remarks")).toBeTruthy();
  });
});
