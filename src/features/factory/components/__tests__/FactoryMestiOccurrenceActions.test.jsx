import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FactoryMestiOccurrenceActions from "../FactoryMestiOccurrenceActions.jsx";

afterEach(cleanup);
it("blocks all transitions while working, including secondary verification outcomes", () => {
  const change = vi.fn();
  render(<FactoryMestiOccurrenceActions status="completed" canVerify working onVerify={change} onMarkUnsatisfactory={change} />);
  expect(screen.getByRole("button", { name: "Verifying..." }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "More row actions" }));
  const rejected = screen.getByRole("button", { name: "Mark unsatisfactory" });
  expect(rejected.disabled).toBe(true);
  fireEvent.click(rejected);
  expect(change).not.toHaveBeenCalled();
});
