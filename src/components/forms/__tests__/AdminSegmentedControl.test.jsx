import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminSegmentedControl from "../AdminSegmentedControl.jsx";

describe("AdminSegmentedControl", () => {
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
