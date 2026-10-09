import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import FactoryDailyProductionModal from "../FactoryDailyProductionModal.jsx";

afterEach(cleanup);
it("retains backdated End presentation, real zero packs, and missing duration without inventing values", () => {
  render(<FactoryDailyProductionModal onClose={vi.fn()} day={{ day: "2026-09-01", state: "recorded", output_kg: 10, completed_runs: 1, productivity: null, invalid_duration_runs: 1, records: [{ production_id: "p1", finished_good_name: "Sauce", output_kg: 10, actual_pack_qty: 0, jo_hours: null, start_at: null, end_at: "2026-08-31T16:30:00Z" }] }} />);
  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("01 Sept 2026");
  expect(dialog.textContent).toContain("01 Sept 2026, 00:30");
  expect(dialog.textContent).toContain("0 packs");
  expect(dialog.textContent).toContain("no valid duration");
  expect(dialog.textContent).not.toContain("0 JO-hours");
});
