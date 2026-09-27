import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import DatePickerField from "../DatePickerField.jsx";
import Modal from "../../feedback/Modal.jsx";

afterEach(cleanup);

describe("shared Date Picker in Admin dialogs", () => {
  it("disables earlier days only when a minimum is provided", () => {
    const change=vi.fn();
    render(<DatePickerField label="Date" value="2026-08-02" minDate="2026-08-02" onChange={change} />);
    fireEvent.click(screen.getByRole("button", {name:"Open calendar"}));
    expect(screen.getByRole("button", {name:"1 Aug 2026"}).disabled).toBe(true);
    expect(screen.getByRole("button", {name:"2 Aug 2026"}).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", {name:"2 Aug 2026"}));
    expect(change).toHaveBeenCalledWith("2026-08-02");
  });
  it("keeps its branded calendar within the active modal accessibility tree", () => {
    render(<Modal title="Shared form" onClose={vi.fn()}>
      <DatePickerField label="Effective From" value="2026-09-26" onChange={vi.fn()} />
    </Modal>);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const day = screen.getByRole("button", { name: "26 Sept 2026" });
    expect(screen.getByRole("dialog").contains(day)).toBe(true);
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it("moves keyboard focus between portaled calendar days", async () => {
    render(<DatePickerField label="Date" value="2026-09-26" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    const day = screen.getByRole("button", { name: "26 Sept 2026" });
    day.focus();
    fireEvent.keyDown(day, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "27 Sept 2026" })));
  });
});
