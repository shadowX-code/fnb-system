import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import OpeningOfferings from "./OpeningOfferings.jsx";

afterEach(cleanup);

function Harness({ initial = [] }) {
  const [offers, setOffers] = useState(initial);
  return <><OpeningOfferings value={offers} onChange={setOffers} /><output>{JSON.stringify(offers)}</output></>;
}
const saved = () => JSON.parse(screen.getByRole("status").textContent);
const click = (name) => fireEvent.click(screen.getByRole("button", { name }));
const choose = (label, option) => {
  click(label);
  fireEvent.click(screen.getByRole("option", { name: option, exact: true }));
};

it("edits one offering at a time and saves each offering's terms independently", () => {
  const { container } = render(<Harness />);
  click("Add offering");
  const fullTime = container.querySelector(".recruitment-offering");
  expect(fullTime.open).toBe(true);
  choose("Pay type", "Monthly");
  choose("Currency", "MYR");
  fireEvent.change(within(fullTime).getByLabelText("Amount from"), { target: { value: "2400" } });

  click("Add offering");
  const [, partTime] = container.querySelectorAll(".recruitment-offering");
  expect(fullTime.open).toBe(false);
  expect(partTime.open).toBe(true);
  choose("Pay type", "Hourly");
  choose("Currency", "MYR");
  fireEvent.change(within(partTime).getByLabelText("Amount from"), { target: { value: "12" } });
  choose("Add optional terms", "Minimum commitment");
  const commitment = within(partTime).getByLabelText("Minimum commitment (months)");
  expect(commitment.closest("details").open).toBe(true);
  fireEvent.change(commitment, { target: { value: "1" } });

  expect(saved()).toEqual([
    expect.objectContaining({ employment_type: "full_time", amount_min: 2400, compensation_type: "monthly" }),
    expect.objectContaining({ employment_type: "part_time", amount_min: 12, compensation_type: "hourly", minimum_commitment_months: 1 }),
  ]);
  fireEvent.click(fullTime.querySelector("summary"));
  expect(fullTime.open).toBe(true);
  expect(partTime.open).toBe(false);
  expect(within(fullTime).getByLabelText("Amount from").value).toBe("2400");
});

it("keeps legacy optional values visible in summaries and distinguishes zero, false and blank", () => {
  const initial = {
    id: "existing", employment_type: "part_time", working_end: "22:00", break_paid: false,
    break_minutes: 0, uniform_provided: false, minimum_hours_per_shift: 0, staff_meals_per_workday: 0,
    public_holiday_rule: "double_pay", public_holiday_details: "Saved legacy details",
  };
  const { container } = render(<Harness initial={[initial]} />);
  const card = container.querySelector(".recruitment-offering");
  fireEvent.click(card.querySelector("summary"));
  expect(within(card).getByRole("button", { name: "Ends at" })).toBeTruthy();
  expect(within(card).getByText("0 min · Unpaid")).toBeTruthy();
  expect(within(card).getByText("0 per day")).toBeTruthy();
  expect(within(card).getByText("No uniform · Double pay")).toBeTruthy();
  expect(card.querySelector(".recruitment-offering-option[open]")).toBeNull();
  expect(within(card).getByLabelText("Confirmed public holiday details").value).toBe("Saved legacy details");
  expect(within(card).queryByLabelText("Payment method")).toBeNull();

  fireEvent.change(within(card).getByLabelText("Schedule"), { target: { value: "Flexible" } });
  expect(saved()).toEqual([{ ...initial, schedule: "Flexible" }]);
  const minimum = within(card).getByLabelText("Minimum hours / shift");
  expect(minimum.value).toBe("0");
  fireEvent.change(minimum, { target: { value: "" } });
  expect(saved()[0]).not.toHaveProperty("minimum_hours_per_shift");
  expect(saved()[0]).toMatchObject({ break_minutes: 0, break_paid: false, uniform_provided: false });
});
