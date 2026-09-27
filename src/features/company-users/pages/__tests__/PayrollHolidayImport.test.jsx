import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
const service = vi.hoisted(() => ({ readHolidayUpdateCheck: vi.fn(), checkOfficialHolidayUpdates: vi.fn(), readHolidayCandidates: vi.fn(), captureHolidaySource: vi.fn(), parseHolidayCandidate: vi.fn(), reviewHolidayCandidate: vi.fn(), publishHolidayCandidate: vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: service }));
import PayrollHolidayImport, { holidayDiffSummary } from "../PayrollHolidayImport.jsx";
const row = { key: "1", state: "new", row: { date: "2027-01-10", name: "QA ONLY holiday", scope: "state", state_code: "MY-08" } };
const candidate = { id: "candidate", status: "needs_review", revision: 2, source_reference: "Verified source", rows: [row], history: [] };
beforeEach(() => { vi.clearAllMocks(); service.readHolidayUpdateCheck.mockResolvedValue(null); service.readHolidayCandidates.mockResolvedValue([candidate]); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("does not show an unavailable-source action after the calendar is published", async () => {
  service.readHolidayCandidates.mockResolvedValue([]);
  render(<PayrollHolidayImport year="2027" calendarPublished />);
  await screen.findByText("Holiday calendar published. Continue with paid holiday selection.");
  expect(screen.queryByRole("button", { name: "Get Official Calendar" })).toBeNull();
});
it("captures an uploaded source artifact with retry identity but never publishes from capture", async () => {
  vi.stubGlobal("FileReader", class { readAsDataURL() { this.result = "data:application/pdf;base64,JVBERi0="; this.onload(); } });
  render(<PayrollHolidayImport year="2027" />);
  fireEvent.click(screen.getByRole("button", { name: "Add Official Source Manually" }));
  fireEvent.change(screen.getByLabelText(/Official source URL/), { target: { value: "https://www.kabinet.gov.my/verified-source.pdf" } });
  fireEvent.change(screen.getByLabelText(/Source reference/), { target: { value: "Verified document reference" } });
  fireEvent.change(screen.getByLabelText(/Official PDF/), { target: { files: [new File(["%PDF-"], "source.pdf", { type: "application/pdf" })] } });
  fireEvent.click(screen.getByRole("button", { name: "Capture Source" }));
  await waitFor(() => expect(service.captureHolidaySource).toHaveBeenCalledWith(expect.objectContaining({ year: "2027", filename: "source.pdf", base64: "JVBERi0=", requestId: expect.any(String) })));
  expect(service.parseHolidayCandidate).not.toHaveBeenCalled();
  expect(service.publishHolidayCandidate).not.toHaveBeenCalled();
});
it("stops counting accepted exceptions as needing review after approval", () => {
  expect(holidayDiffSummary([row], { 1: { action: "accept" } }).review).toBe(0);
  expect(holidayDiffSummary([{ ...row, state: "changed" }], { 1: { action: "accept" } }).review).toBe(1);
});
it("requires exception review and complete-source confirmation before approval, then separate publication", async () => {
  const published = vi.fn(); render(<PayrollHolidayImport year="2027" onPublished={published} />);
  fireEvent.click(await screen.findByRole("button", { name: "Review", exact: true }));
  expect(screen.getByText(/Perak · New/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Confirm Calendar Review" }).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Verified against source"));
  fireEvent.click(screen.getByLabelText(/I have reviewed the complete annual source/));
  service.readHolidayCandidates.mockResolvedValue([{ ...candidate, status: "approved", revision: 3, decisions: { 1: { action: "accept" } } }]);
  fireEvent.click(screen.getByRole("button", { name: "Confirm Calendar Review" }));
  await waitFor(() => expect(service.reviewHolidayCandidate).toHaveBeenCalledWith("candidate", 2, { 1: { action: "accept" } }, true));
  expect(service.publishHolidayCandidate).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Publish Holiday Calendar" }));
  await waitFor(() => expect(service.publishHolidayCandidate).toHaveBeenCalledWith("candidate", 3));
  expect(published).toHaveBeenCalledOnce();
});
it("does not require matched row review; missing remains explicit and blocked cannot be approved", async () => {
  service.readHolidayCandidates.mockResolvedValue([{ ...candidate, rows: [{ ...row, state: "matched" }, { ...row, key: "2", state: "blocked", issue: "Uncertain source" }] }]);
  render(<PayrollHolidayImport year="2027" />); fireEvent.click(await screen.findByRole("button", { name: "Review", exact: true }));
  expect(screen.queryByLabelText("Verified against source")).toBeNull();
  expect(screen.getByText("Matched holidays (1)")).toBeTruthy();
  fireEvent.click(screen.getByLabelText(/I have reviewed/));
  expect(screen.getByRole("button", { name: "Confirm Calendar Review" }).disabled).toBe(true);
  expect(holidayDiffSummary([{ state: "missing" }, { state: "new" }, { state: "matched" }, { state: "blocked" }])).toEqual({ imported: 3, matched: 1, review: 2, blocked: 1 });
});
it("explicitly retains missing evidence and requires a correction remark", async () => {
  service.readHolidayCandidates.mockResolvedValue([{ ...candidate, rows: [{ ...row, state: "missing", row: null, previous: { holiday: { ...row.row, holiday_date: row.row.date } } }, { ...row, key: "2", state: "changed", previous: { holiday: { name: "Previous", holiday_date: "2027-01-09", scope: "national" } } }] }]);
  render(<PayrollHolidayImport year="2027" />); fireEvent.click(await screen.findByRole("button", { name: "Review", exact: true }));
  fireEvent.click(screen.getByLabelText("Retain previous holiday")); fireEvent.click(screen.getByLabelText("Verified against source")); fireEvent.click(screen.getByLabelText(/I have reviewed/));
  expect(screen.getByRole("button", { name: "Confirm Calendar Review" }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Correction remark/), { target: { value: "Official correction" } });
  expect(screen.getByRole("button", { name: "Confirm Calendar Review" }).disabled).toBe(false);
});
it("parsing is separate from approval/publication and invalid transcription reports a real error", async () => {
  service.readHolidayCandidates.mockResolvedValue([{ ...candidate, status: "fetched", rows: [] }]);
  render(<PayrollHolidayImport year="2027" />); fireEvent.click(await screen.findByRole("button", { name: "Review", exact: true }));
  fireEvent.change(screen.getByLabelText(/Verified holiday transcription/), { target: { value: "invalid JSON" } });
  fireEvent.click(screen.getByRole("button", { name: "Review Holiday Changes" }));
  await screen.findByRole("alert");
  expect(service.parseHolidayCandidate).not.toHaveBeenCalled();
  expect(service.publishHolidayCandidate).not.toHaveBeenCalled();
});
it("checks official sources on explicit intent only, reuses review and does not publish", async () => {
  service.readHolidayCandidates.mockResolvedValue([]);
  const view = render(<PayrollHolidayImport year="2027" geography="MY-08" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Check Official Updates" }).disabled).toBe(false));
  expect(service.checkOfficialHolidayUpdates).not.toHaveBeenCalled();
  service.readHolidayUpdateCheck.mockResolvedValue({ completed_at: "2026-09-27T01:00:00Z", result: { status: "updates_found", sources: [] } });
  service.readHolidayCandidates.mockResolvedValue([{ ...candidate, status: "fetched", rows: [] }]);
  fireEvent.click(screen.getByRole("button", { name: "Check Official Updates" }));
  await screen.findByText(/Official Update Found/);
  expect(service.checkOfficialHolidayUpdates).toHaveBeenCalledWith("2027", "MY-08", expect.any(String));
  fireEvent.click(screen.getByRole("button", { name: "Review Update" }));
  expect(screen.getByRole("button", { name: "View Official Document" })).toBeTruthy();
  expect(service.publishHolidayCandidate).not.toHaveBeenCalled();
  view.rerender(<PayrollHolidayImport year="2028" geography="MY-10" />);
  await waitFor(() => expect(service.readHolidayUpdateCheck).toHaveBeenCalledWith("2028", "MY-10"));
});
it("shows a persisted no-update result without offering publication or manual source entry", async () => {
  service.readHolidayCandidates.mockResolvedValue([]);
  service.readHolidayUpdateCheck.mockResolvedValue({ completed_at: "2026-09-27T01:00:00Z", result: { status: "no_updates", sources: [] } });
  render(<PayrollHolidayImport year="2027" />);
  await screen.findByText("No updates found");
  expect(screen.queryByRole("button", { name: "Publish Calendar" })).toBeNull();
  expect(service.checkOfficialHolidayUpdates).not.toHaveBeenCalled();
});
it("defaults QA off and clears stale year/outlet-independent candidate state", async () => {
  const view = render(<PayrollHolidayImport year="2027" />); await screen.findByRole("button", { name: "Review", exact: true });
  expect(service.readHolidayCandidates).toHaveBeenCalledWith("2027", false);
  view.rerender(<PayrollHolidayImport year="2026" />);
  await waitFor(() => expect(service.readHolidayCandidates).toHaveBeenCalledWith("2026", false));
});
