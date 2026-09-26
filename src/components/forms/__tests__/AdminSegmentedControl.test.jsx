import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminSegmentedControl from "../AdminSegmentedControl.jsx";

describe("AdminSegmentedControl", () => {
  it("keeps an unresolved value keyboard reachable without silently selecting", () => {
    const onChange = vi.fn();
    render(<AdminSegmentedControl label="Wage treatment" value="undetermined" onChange={onChange} options={[{ value: "included", label: "Included" }, { value: "excluded", label: "Excluded" }]} />);
    const included = screen.getByRole("tab", { name: "Included" });
    expect(included.tabIndex).toBe(0);
    expect(included.getAttribute("aria-selected")).toBe("false");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("uses tabs and moves selection with arrow keys", () => {
    const onChange = vi.fn();
    render(<AdminSegmentedControl label="Report view" value="table" onChange={onChange} options={[{ value: "table", label: "Table" }, { value: "grouped", label: "Grouped" }]} />);
    const table = screen.getByRole("tab", { name: "Table" });
    expect(table.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(table, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("grouped");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Grouped" }));
  });
});
