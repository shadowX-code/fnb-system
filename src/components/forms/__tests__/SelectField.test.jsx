import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SelectField from "../SelectField.jsx";
import Modal from "../../feedback/Modal.jsx";

afterEach(cleanup);

describe("shared Admin Select", () => {
  it("keeps modal options accessible and preserves selection semantics", () => {
    const change = vi.fn();
    render(<Modal title="Shared selection" onClose={vi.fn()}>
      <SelectField label="Pay Basis" value="monthly" onChange={change}
        options={[{ value: "monthly", label: "Monthly" }, { value: "hourly", label: "Hourly" }]} />
    </Modal>);
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    const option = screen.getByRole("button", { name: "Hourly" });
    expect(screen.getByRole("dialog").contains(option)).toBe(true);
    fireEvent.click(option);
    expect(change).toHaveBeenCalledWith("hourly");
    expect(screen.queryByRole("button", { name: "Hourly" })).toBeNull();
    expect(document.querySelector("select")).toBeNull();
  });
});
