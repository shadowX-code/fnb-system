import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ data: vi.fn(), page: vi.fn(), feedbackPage: vi.fn(), review: vi.fn(), recalculate: vi.fn(), moderate: vi.fn(), correct: vi.fn() }));
vi.mock("../../../../services/crewService.js", () => ({ crewService: { googleReviewsAdminContext: vi.fn().mockResolvedValue({ positive_target: null, target_locked: false }), performanceAdminData: mocks.data, performanceAdminPage: mocks.page, feedbackAdminPage: mocks.feedbackPage, submitPerformanceReview: mocks.review, recalculatePerformanceEmployment: mocks.recalculate, moderateFeedback: mocks.moderate, correctFeedbackAttribution: mocks.correct } }));
vi.mock("../../../../services/outletService.js", () => ({ outletService: { listActiveOutlets: vi.fn().mockResolvedValue([]) } }));
import { crewService } from "../../../../services/crewService.js";
import { googleBusinessService } from "../../services/googleBusinessService.js";
import CrewPerformanceAdminPage, { customerPreviewForResult } from "../CrewPerformanceAdminPage.jsx";

const outlet = { id: "outlet-1", name: "Friends Corner", is_active: true };
const row = { employee: { id: "employee-1", full_name: "Alex Tan", employee_code: "QA-01", position: "Service Crew" }, result: { id: "result-1", period_start: "2026-08-01", status: "review_required", current_score: 66, total_score: null, attendance_score: 28, service_score: 25, customer_score: null, knowledge_score: 13, peer_score: null, calculation_version: "performance-v2", components: { attendance: { score: 28, max_score: 30 }, service: { status: "reviewed", score: 25, max_score: 30 }, customer: { score: null, max_score: 20, status: "pending" }, knowledge: { score: 13, max_score: 15 }, peer: { score: null, max_score: 5, status: "pending" } } } };
const attentionRow = { employee: { id: "employee-2", full_name: "Mina Lee", employee_code: "QA-02", position: "Service Crew" }, result: { id: "result-2", period_start: "2026-08-01", status: "review_required", current_score: 31, total_score: null, attendance_score: 26, service_score: null, customer_score: null, knowledge_score: 0, peer_score: 5, calculation_version: "performance-v2", components: { attendance: { score: 26, max_score: 30 }, service: { status: "review_required", score: null, max_score: 30 }, customer: { score: null, max_score: 20, status: "pending" }, knowledge: { score: 0, max_score: 15 }, peer: { score: 5, max_score: 5 } } } };
const feedback = [{ id: "feedback-1", scope: "crew", submitted_at: "2026-08-12", employee_id: "employee-1", employee_name: "Alex Tan", experience: "great", positive_tags: ["Friendly"], improvement_tags: [], comment: "Great service", scoring_status: "included", moderation_history: [], attribution_history: [] }, { id: "feedback-2", scope: "crew", submitted_at: "2026-08-13", employee_id: "employee-2", employee_name: "Mina Lee", experience: "needs_improvement", positive_tags: [], improvement_tags: ["Response Time"], comment: "Too slow", scoring_status: "excluded", exclusion_reason: "Duplicate guest submission", excluded_by_name: "Admin", excluded_at: "2026-08-13T10:30:00Z", moderation_history: [{ id: "moderation-1", previous_status: "included", next_status: "excluded", reason: "Duplicate guest submission", changed_by: "Admin", changed_at: "2026-08-13T10:30:00Z" }], attribution_history: [] }, { id: "feedback-3", scope: "crew", submitted_at: "2026-08-14", visit_at: "2026-08-14T11:30:00Z", employee_id: "employee-1", employee_name: "Alex Tan", experience: "needs_improvement", positive_tags: [], improvement_tags: ["Response Time"], comment: "QA review required feedback", trust_state: "review_required", trust_reason_codes: ["same_device_crew_business_day"], scoring_status: "included", trust_history: [{ id: "trust-1", next_trust_state: "review_required", reason_codes: ["same_device_crew_business_day"], decision_source: "system", changed_at: "2026-08-14T12:00:00Z" }], moderation_history: [], attribution_history: [], follow_up_requested: true, follow_up: { preferred_name: "QA Guest", contact_method: "phone", contact_value: "+60123456789", status: "requested", history: [] } }];
const fixture = { summary: { average_score: null, reviewed: 0, awaiting_review: 2 }, scoring_framework: [{ key: "attendance", label: "Attendance", max_score: 30 }, { key: "service", label: "Service", max_score: 30 }, { key: "customer", label: "Customer", max_score: 20 }, { key: "knowledge", label: "Knowledge", max_score: 15 }, { key: "peer", label: "Peer Review", max_score: 5 }], crew: [row, attentionRow], reviews: [], feedback, feedback_summary: { total_feedback: 2, included_feedback: 1, positive_feedback: 1, needs_improvement_feedback: 0, excluded_feedback: 1 }, feedback_crew: [{ id: "employee-1", name: "Alex Tan", position: "Service Crew", availability: "active" }, { id: "employee-2", name: "Mina Lee", position: "Service Crew", availability: "active" }] };
const auth = { hasPermission: () => true }; const ui = { notify: vi.fn() };
beforeEach(() => { mocks.data.mockReset().mockResolvedValue(fixture); mocks.page.mockReset().mockImplementation(({ filters = {} }) => { const rows = fixture.crew.filter((item) => !filters.query || `${item.employee.full_name} ${item.employee.employee_code}`.toLowerCase().includes(filters.query.toLowerCase())); return Promise.resolve({ rows, total_count: rows.length, page: 1, page_size: 20 }); }); mocks.feedbackPage.mockReset().mockImplementation(({ filters = {} }) => { const rows = feedback.filter((item) => (!filters.query || `${item.employee_name} ${item.comment} ${(item.positive_tags || []).join(" ")} ${(item.improvement_tags || []).join(" ")}`.toLowerCase().includes(filters.query.toLowerCase())) && (filters.scope === "all" || item.scope === filters.scope) && (filters.experience === "all" || item.experience === filters.experience) && (filters.status === "all" || item.scoring_status === filters.status) && (filters.trust === "all" || item.trust_state === filters.trust)); return Promise.resolve({ rows, total_count: rows.length, page: 1, page_size: 20, summary: { ...fixture.feedback_summary, feedback_crew: fixture.feedback_crew } }); }); mocks.review.mockReset().mockResolvedValue({}); mocks.recalculate.mockReset().mockResolvedValue({}); mocks.moderate.mockReset().mockResolvedValue({}); mocks.correct.mockReset().mockResolvedValue({}); });
afterEach(cleanup);

describe("Crew Performance Admin", () => {
  it("keeps a changed open employment month in review until explicit recalculation", async () => {
    const pending = { ...row, result: { ...row.result, current_score: null,
      employment_review_required: true, employment_can_recalculate: true,
      employment_reason: "Employment history changed. Review and recalculate this open Performance period.",
      components: { ...row.result.components, service: { score: null, max_score: 30, status: "review_required" } } } };
    mocks.data.mockResolvedValue({ ...fixture, crew: [pending], summary: { reviewed: 0, awaiting_review: 1 } });
    mocks.page.mockResolvedValue({ rows: [pending], total_count: 1, page: 1, page_size: 20 });
    render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect((await screen.findAllByText("Employment review")).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Review" })[0].disabled).toBe(true);
    fireEvent.click(screen.getAllByText("Alex Tan").at(-1));
    expect(screen.getByText("Employment history changed. Review and recalculate this open Performance period.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review & Recalculate" }));
    fireEvent.change(screen.getByPlaceholderText("Explain the employment-history correction"), { target: { value: "Verified the dated outlet transfer" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Recalculate" }));
    await waitFor(() => expect(mocks.recalculate).toHaveBeenCalledWith({ employeeId: "employee-1", period: expect.any(String), reason: "Verified the dated outlet transfer" }));
  });

  it("keeps a failed Performance read distinct from an empty period and retries through the shared data surface", async () => {
    mocks.data.mockRejectedValueOnce(new Error("Performance read timed out"));
    render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Unable to load Performance Overview");
    expect(screen.getByText("Performance read timed out")).not.toBeNull();
    mocks.data.mockResolvedValueOnce(fixture);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Team Performance" })).not.toBeNull();
  });

  it("renders the server-derived overview and detail evidence", async () => {
    render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByRole("heading", { name: "Performance Overview" })).not.toBeNull();
    fireEvent.click(screen.getAllByText("Alex Tan").at(-1));
    expect(screen.getByRole("dialog", { name: /Alex Tan · Performance/ })).not.toBeNull();
    expect(screen.getAllByText("66").length).toBeGreaterThan(0);
    expect(screen.getByText("Customer: Pending")).not.toBeNull();
  });

  it("shows V2 assessed points and pending Customer without a finalize action", async () => {
    const v2 = { ...row, result: { ...row.result, calculation_version: "performance-v2", current_score: 45,
      total_score: null, customer_score: null, conduct_score: null, peer_score: null,
      components: { attendance: { score: 25, max_score: 30 }, service: { score: 12, max_score: 30, status: "reviewed" },
        customer: { score: null, max_score: 20, status: "pending" }, knowledge: { score: 8, max_score: 15 },
        peer: { score: null, max_score: 5, status: "pending", completed: 1, required: 3 } } } };
    mocks.data.mockResolvedValueOnce({ ...fixture, crew: [v2] });
    mocks.page.mockResolvedValue({ rows: [v2], total_count: 1, page: 1, page_size: 20 });
    render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click((await screen.findAllByText("Alex Tan")).at(-1));
    expect(within(screen.getByRole("dialog", { name: /Alex Tan · Performance/ })).getByText("Assessed points")).not.toBeNull();
    expect(screen.getByText("3 of 5 components assessed")).not.toBeNull();
    expect(screen.getByText("Customer: Pending")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Finalize Performance" })).toBeNull();
  });

  it("keeps Team Review read-only within Performance and submits only Service through the manager authority", async () => {
    render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect((await screen.findAllByText("Alex Tan")).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("row").filter((entry) => entry.textContent.includes("Alex Tan") && entry.textContent.includes("Service Standards") === false).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pending").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "View review" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Meets Standard" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Submit Review" }));
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "employee-2", component: "service" })));
  });

  it("uses the five current Service Standards criteria and never submits Initiative", async () => {
    render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    await screen.findAllByText("Alex Tan");
    fireEvent.click(screen.getAllByRole("button", { name: "View review" })[0]);
    expect(screen.getByRole("dialog", { name: "Service Standards Review" })).not.toBeNull();
    expect(screen.queryByText("Initiative")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Meets Standard" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Submit Review" }));
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({ component: "service", criteria: expect.arrayContaining([expect.objectContaining({ key: "guest_interaction" })]) })));
    expect(mocks.review.mock.calls.at(-1)[0].criteria).toHaveLength(5);
    expect(mocks.review.mock.calls.at(-1)[0].criteria.some((criterion) => criterion.key === "initiative")).toBe(false);
  });

  it("filters real Crew rows and shows a compact server-backed scoring reference", async () => {
    render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect((await screen.findAllByText("—")).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-admin-summary-grid="compact"]')).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Review Queue" })).toBeNull();
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Needs Attention" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "How scoring works" }));
    expect(screen.getByRole("dialog", { name: "How scoring works" })).not.toBeNull();
    expect(screen.getAllByText("30 pts")).toHaveLength(2);
    fireEvent.change(screen.getByPlaceholderText("Name or employee code"), { target: { value: "Mina" } });
    await waitFor(() => expect(screen.queryAllByText("Alex Tan").length).toBe(0));
    expect(screen.getAllByText("Mina Lee").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));
    await waitFor(() => expect(screen.getAllByText("Alex Tan").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByPlaceholderText("Name or employee code"), { target: { value: "Nobody matches" } });
    expect(await screen.findByText("No Crew match these filters")).not.toBeNull();
  });

  it("keeps unfavorable feedback and records an audited exclusion", async () => {
    render(<CrewPerformanceAdminPage initialTab="feedback" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Exclude" }))[0]);
    fireEvent.change(screen.getByPlaceholderText(/Explain why/), { target: { value: "Duplicate guest submission" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Exclude" }).at(-1));
    await waitFor(() => expect(mocks.moderate).toHaveBeenCalledWith("feedback-1", true, "Duplicate guest submission"));
  });

  it("keeps period KPIs independent from table filters and makes excluded evidence recoverable", async () => {
    render(<CrewPerformanceAdminPage initialTab="feedback" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect(await screen.findByText("All guest submissions this period")).not.toBeNull();
    expect(screen.getByText("Total Feedback").closest("[data-admin-summary-card]").textContent).toContain("2");
    fireEvent.change(screen.getByPlaceholderText("Search Crew, comment or tag"), { target: { value: "Alex" } });
    expect(await screen.findByText("Great service")).not.toBeNull();
    await waitFor(() => expect(screen.queryByText("Too slow")).toBeNull());
    expect(screen.getByText("Total Feedback").closest("[data-admin-summary-card]").textContent).toContain("2");
    fireEvent.change(screen.getByPlaceholderText("Search Crew, comment or tag"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Feedback scoring" }));
    fireEvent.click(screen.getByRole("option", { name: "Excluded" }));
    expect(await screen.findByText("Too slow")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.change(screen.getByPlaceholderText("Explain why this feedback should be restored"), { target: { value: "Duplicate was rechecked" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Restore Feedback" })).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(mocks.moderate).toHaveBeenCalledWith("feedback-2", false, "Duplicate was rechecked"));
  });

  it("keeps Customer Feedback filters in the page-level toolbar and clears them together", async () => {
    render(<CrewPerformanceAdminPage initialTab="feedback" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    const search = await screen.findByPlaceholderText("Search Crew, comment or tag");
    fireEvent.change(search, { target: { value: "No matching feedback" } });
    await waitFor(() => expect(screen.getByText("No Customer Feedback")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(await screen.findByText("Great service")).not.toBeNull();
  });

  it("opens retained evidence history and corrects attribution through the controlled service", async () => {
    render(<CrewPerformanceAdminPage initialTab="feedback" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    await screen.findByText("Great service");
    fireEvent.click(screen.getByRole("button", { name: "View feedback details for Mina Lee" }));
    expect(screen.getByRole("dialog", { name: "Feedback Detail" })).not.toBeNull();
    expect(screen.getByText("Trust / Scoring Decision")).not.toBeNull();
    expect(screen.getByText("Activity")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Correct Crew attribution for Alex Tan" })[0]);
    fireEvent.change(screen.getByPlaceholderText("Explain why this feedback belongs to a different Crew member"), { target: { value: "Guest selected the wrong Crew member" } });
    fireEvent.click(screen.getByRole("radio", { name: /Mina Lee/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save Correction" }));
    await waitFor(() => expect(mocks.correct).toHaveBeenCalledWith("feedback-1", "employee-2", "Guest selected the wrong Crew member"));
  });

  it("presents review-required evidence with readable trust copy, protected follow-up context, and one activity timeline", async () => {
    render(<CrewPerformanceAdminPage initialTab="feedback" auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    await screen.findByText("QA review required feedback");
    fireEvent.click(screen.getAllByRole("button", { name: "View feedback details for Alex Tan" }).at(-1));
    expect(screen.getByText("Feedback Evidence")).not.toBeNull();
    expect(screen.getByText("Review required")).not.toBeNull();
    expect(screen.getAllByText("The same device submitted feedback for this Crew member on the same business day.")).toHaveLength(2);
    expect(screen.getAllByText(/Pending trust review/)).toHaveLength(2);
    expect(screen.getByText("Mobile number")).not.toBeNull();
    expect(screen.getByText("+60123456789")).not.toBeNull();
    expect(screen.queryByText("same_device_crew_business_day")).toBeNull();
    expect(screen.getByRole("button", { name: "Confirm As Valid" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Exclude From Scoring" })).not.toBeNull();
  });

  it("shows a server-projected current score for incomplete Performance without renormalizing pending components", async () => {
    mocks.data.mockResolvedValue({ ...fixture, crew: [attentionRow], summary: { average_score: null, reviewed: 0, awaiting_review: 1 } }); mocks.page.mockResolvedValue({ rows: [attentionRow], total_count: 1, page: 1, page_size: 20 });
    render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{ outlets: [outlet] }} />);
    expect((await screen.findAllByText("Mina Lee")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("31").length).toBeGreaterThan(0);
    expect(screen.getAllByText("— / 30").length).toBeGreaterThan(0);
  });
});


describe("Customer preview canonical employment scope", () => {
  const now = Date.parse("2026-11-02T11:00:00Z");
  const preview = { status: "preview_only", score: 9.5, outletId: "outlet-1", period: "2026-10-01", expiresAt: "2026-11-02T11:05:00Z" };
  const result = { status: "review_required", period_start: "2026-10-01", components: { employment: { state: "eligible", outlet_id: "outlet-1" } } };
  it("shares one preview between eligible employees using the actual result projection", () => {
    expect(customerPreviewForResult({ ...result, id: "employee-result-1" }, preview, now)).toBe(preview);
    expect(customerPreviewForResult({ ...result, id: "employee-result-2" }, preview, now)).toBe(preview);
  });
  it.each([
    { ...result, status: "finalized" },
    { ...result, customer_score:9.5,components:{...result.components,customer:{status:'settled',score:9.5}} },
    { ...result, customer_score:0,components:{...result.components,customer:{status:'settled',score:0}} },
    { ...result, employment_review_required: true },
    { ...result, period_start: "2026-09-01" },
    { ...result, components: { employment: { state: "ineligible", outlet_id: "outlet-1" } } },
    { ...result, components: { employment: { state: "eligible", outlet_id: "outlet-2" } } },
  ])("does not substitute an outlet preview into finalized, unresolved or unrelated evidence", value => {
    expect(customerPreviewForResult(value, preview, now)).toBeNull();
  });
  it("clears at the exact five-minute expiry", () => {
    expect(customerPreviewForResult(result, preview, now + 300000)).toBeNull();
  });
});


it('requests only the canonical Team listing and navigates reviews with the selected period', async () => {
 render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{outlets:[outlet]}} />);
 await screen.findByRole('heading',{name:'Team Performance'});
 expect(mocks.page.mock.calls.every(([query]) => query.listing === 'team')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Open Performance for Alex Tan'}));
 expect(screen.getByRole('dialog',{name:/Alex Tan · Performance/})).not.toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'View Service Review'}));
 expect(screen.getByRole('dialog',{name:'Service Standards Review'})).not.toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Cancel',exact:true}));
 fireEvent.click(screen.getByRole('button',{name:'Open Team Review for Alex Tan'}));
 expect(window.location.pathname).toBe('/crew/performance/team-review');
 expect(new URLSearchParams(window.location.search).get('period')).toMatch(/^\d{4}-\d{2}-01$/);
 window.history.replaceState(null,'','/');
});


it('keeps one canonical pagination control and period KPIs independent of the displayed page', async () => {
 const crew = Array.from({length:21}, (_,i) => ({...row, employee:{...row.employee,id:`crew-${i}`,full_name:`Crew ${i+1}`}}));
 mocks.data.mockResolvedValue({...fixture, crew, summary:{crew_total:21,reviewed:0,awaiting_review:21,average_score:null}});
 mocks.page.mockImplementation(({page=1,pageSize=20}) => Promise.resolve({rows:crew.slice((page-1)*pageSize,page*pageSize),total_count:21,page,page_size:pageSize}));
 render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{outlets:[outlet]}} />);
 await screen.findByRole('button',{name:'Open Performance for Crew 1'});
 expect(document.querySelectorAll('[data-pagination-density]')).toHaveLength(1);
 fireEvent.click(screen.getAllByRole('button',{name:'Next',exact:true})[0]);
 expect(await screen.findByRole('button',{name:'Open Performance for Crew 21'})).not.toBeNull();
 expect(screen.queryByRole('button',{name:'Open Performance for Crew 1',exact:true})).toBeNull();
 expect(screen.getByText('Reviews Complete').closest('[data-admin-summary-card]').textContent).toContain('0 / 21');
 expect(document.querySelectorAll('[data-admin-summary-card]')).toHaveLength(3);
 expect(mocks.page).toHaveBeenCalledWith(expect.objectContaining({listing:'team',page:2,pageSize:20}));
});

it('distinguishes finalized averages from completed reviews and blocks editing finalized evidence', async () => {
 const finalized = {...row,result:{...row.result,status:'finalized',total_score:88}};
 mocks.data.mockResolvedValue({...fixture,crew:[finalized],summary:{crew_total:1,reviewed:1,awaiting_review:0,average_score:88}});
 mocks.page.mockResolvedValue({rows:[finalized],total_count:1,page:1,page_size:20});
 render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{outlets:[outlet]}} />);
 await screen.findByText('88 / 100');
 fireEvent.click(screen.getByRole('button',{name:'Open Performance for Alex Tan'}));
 expect(screen.queryByRole('button',{name:'View Service Review'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Service Review',exact:true})).toBeNull();
 expect(screen.getByText('Final Score /100')).not.toBeNull();
});


it('masks the previous outlet KPIs and rows if a new outlet read fails', async () => {
 const finalized = {...row,result:{...row.result,status:'finalized',total_score:88}};
 mocks.data.mockImplementation(outletId => outletId === 'outlet-1' ? Promise.resolve({...fixture,crew:[finalized],summary:{average_score:88,reviewed:1,awaiting_review:0}}) : Promise.reject(new Error('Second outlet unavailable')));
 render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{outlets:[outlet,{id:'outlet-2',name:'Other Outlet',is_active:true}]}} />);
 await screen.findByText('88 / 100');
 fireEvent.click(screen.getByRole('button',{name:'Outlet',exact:true}));
 fireEvent.click(screen.getByRole('option',{name:'Other Outlet',exact:true}));
 await screen.findByText('Second outlet unavailable');
 expect(screen.queryByText('88 / 100')).toBeNull();
 expect(screen.queryByRole('button',{name:'Open Performance for Alex Tan'})).toBeNull();
 expect(screen.getByText('Evidence unavailable')).not.toBeNull();
});


it.each([0,6.5])('shows shared provisional %s in eligible rows/details without changing assessed totals or finalized scores', async (customerScore) => {
 const period = new Date().toISOString().slice(0,7)+'-01';
 const eligible = {...row,result:{...row.result,period_start:period,total_score:null,current_score:66,components:{...row.result.components,employment:{state:'eligible',outlet_id:'outlet-1'}}}};
 const frozen = {...eligible,employee:{...eligible.employee,id:'frozen',full_name:'Frozen Crew'},result:{...eligible.result,status:'finalized',total_score:85,customer_score:20,components:{...eligible.result.components,customer:{score:20,max_score:20,status:'finalized'}}}};
 mocks.data.mockResolvedValue({...fixture,crew:[eligible,frozen]});
 mocks.page.mockResolvedValue({rows:[eligible,frozen],total_count:2,page:1,page_size:20});
 vi.mocked(crewService.googleReviewsAdminContext).mockResolvedValueOnce({positive_target:10,target_locked:false});
 const remote = vi.spyOn(googleBusinessService,'customerPreview').mockResolvedValue({status:'preview_only',periodState:'provisional',score:customerScore,positiveTarget:customerScore ? 1.5 : 0,quality:customerScore ? 5 : 0,positive:customerScore ? 1 : 0,total:customerScore ? 1 : 0,negative:0,negativeRate:customerScore ? 0 : null,target:10,fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()});
 try {
  render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{outlets:[outlet]}} />);
  await screen.findByRole('button',{name:'Open Performance for Alex Tan'});
  await waitFor(() => expect(screen.getByRole('button',{name:'Refresh Preview'}).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Refresh Preview'}));
  const activeRow = screen.getByRole('button',{name:'Open Performance for Alex Tan'}).closest('tr');
  await within(activeRow).findByText(`${customerScore} / 20`);
  expect(within(activeRow).getByText('Preview')).not.toBeNull();
  expect(within(activeRow).getByText('66')).not.toBeNull();
  const frozenRow = screen.getByRole('button',{name:'Open Performance for Frozen Crew'}).closest('tr');
  expect(within(frozenRow).getByText('20 / 20')).not.toBeNull();
  expect(within(frozenRow).getByText('85')).not.toBeNull();
  expect(within(frozenRow).queryByText('Preview')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Open Performance for Alex Tan'}));
  expect(await screen.findByText(`Outlet Customer preview: ${customerScore} / 20 · Not included in saved Performance.`)).not.toBeNull();
 } finally {remote.mockRestore();}
});

it('refreshes settled Customer rows and detail while Service and Team Review remain Pending',async()=>{
 const period=new Date().toISOString().slice(0,7)+'-01';let saved=false;
 const summary={status:'settled',score:9.5,max_score:20,settled_at:new Date().toISOString()};
 const eligible={...row,result:{...row.result,period_start:period,status:'review_required',total_score:null,current_score:68,
  customer_score:null,components:{...row.result.components,employment:{state:'eligible',outlet_id:'outlet-1'},customer:{score:null,max_score:20,status:'pending'}}}};
 const stored={...eligible,result:{...eligible.result,customer_score:9.5,components:{...eligible.result.components,customer:summary}}};
 mocks.data.mockImplementation(async()=>({...fixture,crew:[saved?stored:eligible]}));
 mocks.page.mockImplementation(async()=>({rows:[saved?stored:eligible],total_count:1,page:1,page_size:20}));
 vi.mocked(crewService.googleReviewsAdminContext).mockResolvedValue({positive_target:10,target_locked:false});
 const remote=vi.spyOn(googleBusinessService,'customerPreview').mockImplementation(async()=>{saved=true;return {status:'settled',persisted:true,score:9.5,summary};});
 try{
  render(<CrewPerformanceAdminPage auth={auth} ui={ui} store={{outlets:[outlet]}} />);
  const button=await screen.findByRole('button',{name:'Open Performance for Alex Tan'});
  const activeRow=button.closest('tr');
  await within(activeRow).findByText('Settled');
  expect(within(activeRow).getByText('9.5 / 20')).not.toBeNull();
  expect(within(activeRow).queryByText('Preview')).toBeNull();
  fireEvent.click(button);
  expect(await screen.findByText('Customer: Settled')).not.toBeNull();
  expect(screen.queryByText(/Saved Customer score is Pending/)).toBeNull();
 }finally{remote.mockRestore();}
});
