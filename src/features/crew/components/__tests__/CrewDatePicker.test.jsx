import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CrewDatePicker from "../CrewDatePicker.jsx";

afterEach(cleanup);

describe("CrewDatePicker", () => {
  it("uses the shared Crew sheet and refuses dates before the supplied minimum", () => {
    const onChange = vi.fn();
    render(<CrewDatePicker label="Start Date" value="2026-08-14" min="2026-08-10" onChange={onChange} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start Date" }));

    expect(screen.getByRole("dialog", { name: "Start Date" })).not.toBeNull();
    expect(document.querySelector(".crew-date-picker-sheet.crew-ui-bottom-sheet")).not.toBeNull();
    const disabledPastDay = screen.getByRole("button", { name: "Saturday, 1 August 2026" });
    expect(disabledPastDay.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Friday, 14 August 2026" }));
    expect(onChange).toHaveBeenCalledWith("2026-08-14");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a disabled end-date field out of the picker flow", () => {
    render(<CrewDatePicker label="End Date" value="2026-08-14" min="2026-08-14" disabled onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "End Date" }).disabled).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
