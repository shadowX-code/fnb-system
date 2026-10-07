import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
const service = vi.hoisted(() => ({ readHolidayUpdateCheck: vi.fn(), checkOfficialHolidayUpdates: vi.fn(), readHolidayCandidates: vi.fn(), captureHolidaySource: vi.fn(), parseHolidayCandidate: vi.fn(), reviewHolidayCandidate: vi.fn(), publishHolidayCandidate: vi.fn(), confirmHolidayDate: vi.fn() }));
vi.mock("../../../../services/payrollService.js", () => ({ payrollService: service }));
import PayrollHolidayImport, { holidayDiffSummary, unresolvedHolidayRows } from "../PayrollHolidayImport.jsx";
const row = { key: "1", state: "new", row: { date: "2027-01-10", name: "QA ONLY holiday", scope: "state", state_code: "MY-08", kind: "gazetted" } };
const candidate = { id: "candidate", status: "needs_review", revision: 2, source_reference: "Verified source", rows: [row], history: [] };
beforeEach(() => { vi.clearAllMocks(); service.readHolidayUpdateCheck.mockResolvedValue(null); service.readHolidayCandidates.mockResolvedValue([candidate]); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("keeps operational updates outside the single grouped secondary entry", async () => {
  render(<PayrollHolidayImport canPublish year="2027" advancedContent={<section>Calendar Maintenance and History</section>} />);
  await screen.findByRole("button", { name: "Review Update" });
  const advanced = screen.getByText("Advanced & History").closest("details");
  expect(advanced.contains(screen.getByRole("button", { name: "Add Official Source Manually" }))).toBe(true);
  expect(advanced.contains(screen.getByRole("button", { name: "Review Update" }))).toBe(false);
  expect(screen.getAllByRole("button", { name: "Add Official Source Manually" })).toHaveLength(1);
  expect(screen.queryByText("Advanced", { exact: true })).toBeNull();
  expect(screen.queryByRole("button", { name: "Review", exact: true })).toBeNull();
  expect(screen.getByRole("region", { name: "Official Sources" })).toBeTruthy();
});
it("does not show an unavailable-source action after the calendar is published", async () => {
  service.readHolidayCandidates.mockResolvedValue([]);
  render(<PayrollHolidayImport canPublish year="2027" calendarPublished />);
  await screen.findByText("Holiday calendar published. Continue with paid holiday selection.");
  expect(screen.queryByRole("button", { name: "Get Official Calendar" })).toBeNull();
});
it("captures an uploaded source artifact with retry identity but never publishes from capture", async () => {
  vi.stubGlobal("FileReader", class { readAsDataURL() { this.result = "data:application/pdf;base64,JVBERi0="; this.onload(); } });
  render(<PayrollHolidayImport canPublish year="2027" />);
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
  const published = vi.fn(); render(<PayrollHolidayImport canPublish year="2027" onPublished={published} />);
  fireEvent.click(await screen.findByRole("button", { name: "Review Update", exact: true }));
  expect(screen.getByText(/Perak · New/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Confirm Calendar Review" }).disabled).toBe(true);
  service.readHolidayCandidates.mockResolvedValue([{ ...candidate, revision: 3, decisions: { 1: { action: "accept" } } }]);
  fireEvent.click(screen.getByRole("button", { name: "Confirm Classification" }));
  await waitFor(() => expect(service.reviewHolidayCandidate).toHaveBeenCalledWith("candidate", 2, { 1: { action: "accept" } }, false));
  await screen.findByText("Calendar verified · No unresolved classifications.");
  fireEvent.click(screen.getByLabelText(/I have reviewed the complete annual source/));
  service.readHolidayCandidates.mockResolvedValue([{ ...candidate, status: "approved", revision: 4, decisions: { 1: { action: "accept" } } }]);
  fireEvent.click(screen.getAllByRole("button", { name: "Confirm Calendar Review" }).at(-1));
  await waitFor(() => expect(service.reviewHolidayCandidate).toHaveBeenCalledWith("candidate", 3, { 1: { action: "accept" } }, true));
  expect(service.publishHolidayCandidate).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Publish Holiday Calendar" }));
  await waitFor(() => expect(service.publishHolidayCandidate).toHaveBeenCalledWith("candidate", 4));
  expect(published).toHaveBeenCalledOnce();
});
it("does not require matched row review; missing remains explicit and blocked cannot be approved", async () => {
  service.readHolidayCandidates.mockResolvedValue([{ ...candidate, rows: [{ ...row, state: "matched" }, { ...row, key: "2", state: "blocked", issue: "Uncertain source" }] }]);
  render(<PayrollHolidayImport canPublish year="2027" />); fireEvent.click(await screen.findByRole("button", { name: "Review Update", exact: true }));
  expect(screen.queryByLabelText("Verified against source")).toBeNull();
  expect(screen.queryByText("Matched holidays (1)")).toBeNull();
  expect(screen.getByRole("button", { name: "Confirm Classification" }).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/I have reviewed/));
  expect(screen.getByRole("button", { name: "Confirm Calendar Review" }).disabled).toBe(true);
  expect(holidayDiffSummary([{ state: "missing" }, { state: "new" }, { state: "matched" }, { state: "blocked" }])).toEqual({ imported: 3, matched: 1, review: 2, blocked: 1 });
});
it("explicitly retains missing evidence and requires a correction remark", async () => {
  service.readHolidayCandidates.mockResolvedValue([{ ...candidate, rows: [{ ...row, state: "missing", row: null, previous: { holiday: { ...row.row, holiday_date: row.row.date } } }, { ...row, key: "2", state: "changed", previous: { holiday: { name: "Previous", holiday_date: "2027-01-09", scope: "national" } } }] }]);
  render(<PayrollHolidayImport canPublish year="2027" />); fireEvent.click(await screen.findByRole("button", { name: "Review Update", exact: true }));
  fireEvent.click(screen.getByLabelText(/I have reviewed/));
  expect(screen.getByRole("button", { name: "Confirm Calendar Review" }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Correction remark/), { target: { value: "Official correction" } });
  expect(screen.getByRole("button", { name: "Confirm Classification" }).disabled).toBe(false);
  expect(screen.getByRole("button", { name: "Confirm Calendar Review" }).disabled).toBe(true);
});
it("only exposes unresolved exceptions, retaining blocked and incomplete correction evidence", () => {
  expect(unresolvedHolidayRows({ rows: [{ ...row, state: "matched" }, row, { ...row, key: "2", state: "blocked" }, { ...row, key: "3", state: "changed" }], decisions: { 1: { action: "accept" }, 3: { action: "accept" } } }).map(r => r.key)).toEqual(["2", "3"]);
  expect(unresolvedHolidayRows({ rows: [row], additional_confirmations: { 1: {} } })).toEqual([]);
});
it("does not guess a classification when authoritative evidence supplies none", async () => {
  service.readHolidayCandidates.mockResolvedValue([{ ...candidate, rows: [{ ...row, row: { ...row.row, kind: null } }] }]);
  render(<PayrollHolidayImport canPublish year="2027" />);
  fireEvent.click(await screen.findByRole("button", { name: "Review Calendar Exceptions" }));
  expect(screen.getByRole("button", { name: "Confirm Classification" }).disabled).toBe(true);
  expect(screen.getByText("Source classification: Review Required")).toBeTruthy();
  expect(service.reviewHolidayCandidate).not.toHaveBeenCalled();
});
it("keeps a failed confirmation visible and never publishes as a fallback", async () => {
  service.reviewHolidayCandidate.mockRejectedValueOnce(new Error("Calendar changed. Refresh review."));
  render(<PayrollHolidayImport canPublish year="2027" />);
  fireEvent.click(await screen.findByRole("button", { name: "Review Calendar Exceptions" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm Classification" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Confirm Classification" }).disabled).toBe(false);
  expect(screen.getByText("Source classification: Available for company paid selection")).toBeTruthy();
  expect(service.publishHolidayCandidate).not.toHaveBeenCalled();
});
it("parsing is separate from approval/publication and invalid transcription reports a real error", async () => {
  service.readHolidayCandidates.mockResolvedValue([{ ...candidate, status: "fetched", rows: [] }]);
  render(<PayrollHolidayImport canPublish year="2027" />); fireEvent.click(await screen.findByRole("button", { name: "Review Update", exact: true }));
  fireEvent.change(screen.getByLabelText(/Verified holiday transcription/), { target: { value: "invalid JSON" } });
  fireEvent.click(screen.getByRole("button", { name: "Review Holiday Changes" }));
  await screen.findByRole("alert");
  expect(service.parseHolidayCandidate).not.toHaveBeenCalled();
  expect(service.publishHolidayCandidate).not.toHaveBeenCalled();
});
it("checks official sources on explicit intent only, reuses review and does not publish", async () => {
  service.readHolidayCandidates.mockResolvedValue([]);
  const view = render(<PayrollHolidayImport canPublish year="2027" geography="MY-08" />);
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
  view.rerender(<PayrollHolidayImport canPublish year="2028" geography="MY-10" />);
  await waitFor(() => expect(service.readHolidayUpdateCheck).toHaveBeenCalledWith("2028", "MY-10"));
});
it("shows a persisted no-update result without offering publication or manual source entry", async () => {
  service.readHolidayCandidates.mockResolvedValue([]);
  service.readHolidayUpdateCheck.mockResolvedValue({ completed_at: "2026-09-27T01:00:00Z", result: { status: "no_updates", sources: [] } });
  render(<PayrollHolidayImport canPublish year="2027" />);
  await screen.findByText("No updates found");
  expect(screen.queryByRole("button", { name: "Publish Calendar" })).toBeNull();
  expect(service.checkOfficialHolidayUpdates).not.toHaveBeenCalled();
});
it("defaults QA off and clears stale year/outlet-independent candidate state", async () => {
  const view = render(<PayrollHolidayImport canPublish year="2027" />); await screen.findByRole("button", { name: "Review Update", exact: true });
  expect(service.readHolidayCandidates).toHaveBeenCalledWith("2027", false);
  view.rerender(<PayrollHolidayImport canPublish year="2026" canPublish />);
  await waitFor(() => expect(service.readHolidayCandidates).toHaveBeenCalledWith("2026", false));
});
it("keeps pre-reviewed source dates visible and requests only exceptional classification", async () => {
 const required={...row,key:'2',classification_review:true,row:{...row.row,name:'Mandatory candidate',suggested_kind:'required'}};
 service.readHolidayCandidates.mockResolvedValue([{...candidate,proposal_metadata:{parser:'bkpp_proposal_v1',document_role:'annual'},rows:[row,required],decisions:{1:{action:'accept'}}}]);
 render(<PayrollHolidayImport canPublish year="2027" />);
 fireEvent.click(await screen.findByRole('button',{name:'Review Calendar Exceptions'}));
 expect(screen.getByRole('region',{name:'Proposed Holiday Calendar'})).toBeTruthy();
 expect(screen.getAllByText('QA ONLY holiday')).toHaveLength(1);
 expect(screen.getAllByRole('button',{name:'Confirm Classification'})).toHaveLength(1);
 expect(holidayDiffSummary([required],{2:{action:'accept'}}).review).toBe(1);
 expect(service.publishHolidayCandidate).not.toHaveBeenCalled();
});
it("never offers annual publication for a supplementary gazette", async () => {
 service.readHolidayCandidates.mockResolvedValue([{...candidate,status:'approved',proposal_metadata:{document_role:'supplement'},decisions:{1:{action:'accept'}}}]);
 render(<PayrollHolidayImport canPublish year="2027" />);
 fireEvent.click(await screen.findByRole('button',{name:'Review Update',exact:true}));
 expect(screen.queryByRole('button',{name:'Publish Holiday Calendar'})).toBeNull();
});

it("explicitly confirms applicable dates without exposing internal uncertainty or reparsing source", async () => {
  const uncertain = { ...row, state: "blocked", issue: "Official source marks this date subject to change.", source_issue: "Official source marks this date subject to change.", date_confirmable: true, source_row_identity: "stable-source-row", source_row_fingerprint: "row-evidence" };
  const source = { ...candidate, source_sha256: "source-hash", rows: [uncertain] };
  service.readHolidayCandidates.mockResolvedValue([source]);
  service.confirmHolidayDate.mockImplementation(async () => {
    service.readHolidayCandidates.mockResolvedValue([{ ...source, revision: 3, decisions: { 1: { action: "accept" } }, rows: [{ ...uncertain, state: "new", issue: null, date_resolution: { official_reference: "Official confirmation page 2" } }] }]);
  });
  render(<PayrollHolidayImport canPublish year="2027" operational geography="MY-08" outletId="workplace" />);
  fireEvent.click(await screen.findByRole("button", { name: "Review Applicable Exceptions" }));
  fireEvent.click(screen.getByRole("button", { name: "Review uncertain dates" }));
  expect(screen.queryByLabelText("Unresolved condition / correction evidence")).toBeNull();
  expect(screen.getByText(/Original source warning:/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Confirm Date" }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Official confirmation reference/), { target: { value: "Official confirmation page 2" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm Date" }));
  await screen.findByText("Confirmed", { exact: true });
  expect(service.confirmHolidayDate).toHaveBeenCalledWith(expect.objectContaining({ candidate_id: "candidate", candidate_revision: 2, source_sha256: "source-hash", row_identity: "stable-source-row", row_fingerprint: "row-evidence", confirmed_date: "2027-01-10", official_reference: "Official confirmation page 2", outlet_id: "workplace", request_id: expect.any(String) }));
  expect(service.parseHolidayCandidate).not.toHaveBeenCalled();
  expect(service.publishHolidayCandidate).not.toHaveBeenCalled();
});
