import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
const service = vi.hoisted(() => ({ readHolidayCandidates: vi.fn(), captureHolidaySource: vi.fn(), parseHolidayCandidate: vi.fn(), reviewHolidayCandidate: vi.fn(), publishHolidayCandidate: vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: service }));
import PayrollHolidayImport, { holidayDiffSummary } from "../PayrollHolidayImport.jsx";
const row = { key: "1", state: "new", row: { date: "2027-01-10", name: "QA ONLY holiday", scope: "state", state_code: "MY-08" } };
const candidate = { id: "candidate", status: "needs_review", revision: 2, source_reference: "Verified source", rows: [row], history: [] };
beforeEach(() => { vi.clearAllMocks(); service.readHolidayCandidates.mockResolvedValue([candidate]); });
afterEach(cleanup);
it("requires exception review and complete-source confirmation before approval, then separate publication", async () => {
  const published = vi.fn(); render(<PayrollHolidayImport year="2027" onPublished={published} />);
  fireEvent.click(await screen.findByRole("button", { name: "Review", exact: true }));
  expect(screen.getByText(/Perak · New/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Approve Import" }).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Verified against source"));
  fireEvent.click(screen.getByLabelText(/I have reviewed the complete annual source/));
  service.readHolidayCandidates.mockResolvedValue([{ ...candidate, status: "approved", revision: 3, decisions: { 1: { action: "accept" } } }]);
  fireEvent.click(screen.getByRole("button", { name: "Approve Import" }));
  await waitFor(() => expect(service.reviewHolidayCandidate).toHaveBeenCalledWith("candidate", 2, { 1: { action: "accept" } }, true));
  expect(service.publishHolidayCandidate).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Publish Annual Calendar" }));
  await waitFor(() => expect(service.publishHolidayCandidate).toHaveBeenCalledWith("candidate", 3));
  expect(published).toHaveBeenCalledOnce();
});
it("does not require matched row review; missing remains explicit and blocked cannot be approved", async () => {
  service.readHolidayCandidates.mockResolvedValue([{ ...candidate, rows: [{ ...row, state: "matched" }, { ...row, key: "2", state: "blocked", issue: "Uncertain source" }] }]);
  render(<PayrollHolidayImport year="2027" />); fireEvent.click(await screen.findByRole("button", { name: "Review", exact: true }));
  expect(screen.queryByLabelText("Verified against source")).toBeNull();
  expect(screen.getByText("Matched holidays (1)")).toBeTruthy();
  fireEvent.click(screen.getByLabelText(/I have reviewed/));
  expect(screen.getByRole("button", { name: "Approve Import" }).disabled).toBe(true);
  expect(holidayDiffSummary([{ state: "missing" }, { state: "new" }, { state: "matched" }, { state: "blocked" }])).toEqual({ imported: 3, matched: 1, review: 2, blocked: 1 });
});
it("explicitly retains missing evidence and requires a correction remark", async () => {
  service.readHolidayCandidates.mockResolvedValue([{ ...candidate, rows: [{ ...row, state: "missing", row: null, previous: { holiday: { ...row.row, holiday_date: row.row.date } } }, { ...row, key: "2", state: "changed", previous: { holiday: { name: "Previous", holiday_date: "2027-01-09", scope: "national" } } }] }]);
  render(<PayrollHolidayImport year="2027" />); fireEvent.click(await screen.findByRole("button", { name: "Review", exact: true }));
  fireEvent.click(screen.getByLabelText("Retain previous holiday")); fireEvent.click(screen.getByLabelText("Verified against source")); fireEvent.click(screen.getByLabelText(/I have reviewed/));
  expect(screen.getByRole("button", { name: "Approve Import" }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Correction remark/), { target: { value: "Official correction" } });
  expect(screen.getByRole("button", { name: "Approve Import" }).disabled).toBe(false);
});
it("parsing is separate from approval/publication and invalid transcription reports a real error", async () => {
  service.readHolidayCandidates.mockResolvedValue([{ ...candidate, status: "fetched", rows: [] }]);
  render(<PayrollHolidayImport year="2027" />); fireEvent.click(await screen.findByRole("button", { name: "Review", exact: true }));
  fireEvent.change(screen.getByLabelText(/Verified holiday transcription/), { target: { value: "invalid JSON" } });
  fireEvent.click(screen.getByRole("button", { name: "Review Transcription" }));
  await screen.findByRole("alert");
  expect(service.parseHolidayCandidate).not.toHaveBeenCalled();
  expect(service.publishHolidayCandidate).not.toHaveBeenCalled();
});
it("defaults QA off and clears stale year/outlet-independent candidate state", async () => {
  const view = render(<PayrollHolidayImport year="2027" />); await screen.findByRole("button", { name: "Review", exact: true });
  expect(service.readHolidayCandidates).toHaveBeenCalledWith("2027", false);
  view.rerender(<PayrollHolidayImport year="2026" />);
  await waitFor(() => expect(service.readHolidayCandidates).toHaveBeenCalledWith("2026", false));
});
