import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SelectField from "../SelectField.jsx";
import Modal from "../../feedback/Modal.jsx";

afterEach(cleanup);

describe("shared Admin Select", () => {
  it("keeps modal options accessible and preserves selection semantics", () => {
    const change = vi.fn();
    render(
      <Modal title="Shared selection" onClose={vi.fn()}>
        <SelectField
          label="Pay Basis"
          value="monthly"
          onChange={change}
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "hourly", label: "Hourly" },
          ]}
        />
      </Modal>,
    );
    expect(
      screen
        .getByText("Pay Basis")
        .classList.contains("admin-form-field-label"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Pay Basis" }));
    const option = screen.getByRole("option", { name: "Hourly" });
    expect(screen.getByRole("dialog").contains(option)).toBe(true);
    fireEvent.click(option);
    expect(change).toHaveBeenCalledWith("hourly");
    expect(screen.queryByRole("option", { name: "Hourly" })).toBeNull();
    expect(document.querySelector("select")).toBeNull();
  });
});

it("supports arrow navigation, disabled options and focus return", () => {
  const change = vi.fn();
  render(
    <SelectField
      ariaLabel="Position"
      value="a"
      options={[
        { value: "a", label: "Crew" },
        { value: "b", label: "Disabled", disabled: true },
        { value: "c", label: "Supervisor" },
      ]}
      onChange={change}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Position" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const crew = screen.getByRole("option", { name: "Crew" });
  crew.focus();
  fireEvent.keyDown(crew, { key: "ArrowDown" });
  expect(document.activeElement).toBe(
    screen.getByRole("option", { name: "Supervisor" }),
  );
  fireEvent.click(document.activeElement);
  expect(change).toHaveBeenCalledWith("c");
  expect(document.activeElement).toBe(trigger);
});
it("keeps required selection invalid until populated and searches rich options", () => {
  const { container } = render(
    <SelectField
      ariaLabel="Profile"
      required
      searchable
      value=""
      options={[
        {
          value: "crew",
          label: "Service Crew",
          description: "10–15 min · 5 evidence areas",
        },
      ]}
      onChange={vi.fn()}
    />,
  );
  expect(container.querySelector("input[required]").checkValidity()).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Profile" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search Profile" }), {
    target: { value: "15 min" },
  });
  expect(screen.getByRole("option").textContent).toContain("Service Crew");
});

it("uses the shared auto-search threshold without searching trivial lists", () => {
  const options = Array.from({ length: 8 }, (_, value) => ({ value, label: `Option ${value}` }));
  const { rerender } = render(<SelectField label="Category" searchable="auto" value={0} options={options.slice(0, 3)} onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Category" }));
  expect(screen.queryByRole("textbox", { name: "Search Category" })).toBeNull();
  rerender(<SelectField label="Category" searchable="auto" value={0} options={options} onChange={vi.fn()} />);
  expect(screen.getByRole("textbox", { name: "Search Category" })).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Search Category" }), { target: { value: "Option 7" } });
  expect(screen.getAllByRole("option")).toHaveLength(1);
});
