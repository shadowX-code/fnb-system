import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TimePickerField, { formatTimeValue } from "../TimePickerField.jsx";

describe("TimePickerField", () => {
  it("renders SQL times without a native time input", () => {
    const { container } = render(<TimePickerField label="Start time" value="13:05:00" onChange={() => {}} />);
    expect(screen.getByText("1:05 pm")).toBeTruthy();
    expect(container.querySelector('input[type="time"]')).toBeNull();
  });
  it("can set and clear an optional value", () => {
    const onChange = vi.fn();
    render(<TimePickerField label="Due time" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Due time" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledWith("09:00");
    fireEvent.click(screen.getByRole("button", { name: "Due time" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear", exact: true }));
    expect(onChange).toHaveBeenCalledWith("");
  });
  it("formats midnight and noon", () => {
    expect(formatTimeValue("00:00")).toBe("12:00 am");
    expect(formatTimeValue("12:00")).toBe("12:00 pm");
  });
});
