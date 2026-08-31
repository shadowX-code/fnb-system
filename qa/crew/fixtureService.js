// Synthetic UI inputs only. Vite's separate loopback test config replaces the
// service import; no production entry imports this module and no real RPC runs.
const copy = {
  en: "QA — Customer welcoming, food safety and end-of-shift responsibilities across the restaurant",
  "zh-CN": "QA — 餐厅顾客接待、食品安全检查与交接班的详细操作要求和员工学习进度说明",
  ms: "QA — Tanggungjawab menyambut pelanggan, keselamatan makanan dan penyerahan tugas pada akhir syif restoran",
};
export const longCopy = () => copy[new URLSearchParams(location.search).get("language")] || copy.en;
export const session = { token: "qa-renderer-only-not-a-session", expires_at: "2099-01-01", employee: { id: "qa-employee", full_name: "QA Demo Crew Employee With A Long Display Name", nickname: "QA Demo", position: "Restaurant Service Crew" } };
const date = "2026-08-31";
const outlet = () => ({ id: "qa-outlet", name: longCopy() });
const tasks = () => Array.from({ length: 4 }, (_, i) => ({ id: `qa-task-${i}`, source: "instance", template_id: "qa-template", name: longCopy(), status: ["not_started", "in_progress", "overdue", "completed"][i], task_type: "checklist", business_date: date, schedule_type: "recurring", schedule_config: { frequency: "every_day" }, block_count: 3, completed_count: i, available_from: `${date}T02:00:00Z`, due_at: `${date}T04:00:00Z` }));
const attendance = () => Array.from({ length: 5 }, (_, i) => ({ id: `qa-attendance-${i}`, status: "closed", clock_in_at: `2026-08-${25-i}T02:00:00Z`, clock_out_at: `2026-08-${25-i}T12:00:00Z`, exception_flag: i === 0, exception_reason: i === 0 ? longCopy() : null, outlet_name: longCopy() }));
const performance = () => ({ period_start: "2026-08-01", status: "finalized", score: 87, breakdown: { attendance: { score: 28, explanation: longCopy() }, service: { score: 26, explanation: longCopy() }, customer: { score: 13, confidence: "established", explanation: longCopy() }, knowledge: { score: 14, explanation: longCopy() }, conduct: { score: 6, explanation: longCopy() } }, trend: [{ period_start: "2026-08-01", score: 87, status: "finalized" }] });
const data = {
  myAttendance: attendance, myAttendanceMonth: attendance,
  attendanceContext: () => ({ outlet_name: longCopy(), location_enabled: true, latitude: 4.6, longitude: 101.1, radius_meters: 100 }),
  myProfile: () => ({ ...session.employee, employment_type: "full_time" }),
  operationsToday: () => ({ outlet: outlet(), attendance_context: { on_shift: true }, tasks: tasks() }),
  operationsAllTasks: () => ({ outlet: outlet(), attendance_context: { on_shift: true }, tasks: tasks() }),
  operationDetail: () => ({ id: "qa-task-0", name: longCopy(), status: "not_started", task_type: "checklist", can_act: true, allow_exception: true, blocks: [{ id: "qa-block", title: longCopy(), block_type: "yes_no", required: true, status: "pending", config: { no_requires_issue: true } }] }),
  myRoster: () => ({ today: { id: "qa-roster", date, outlet_id: "qa-outlet", outlet_name: longCopy(), entry_type: "working", start_time: "10:00", end_time: "22:00", position: longCopy() }, entries: Array.from({ length: 4 }, (_, i) => ({ id: `qa-roster-${i}`, date: i ? `2026-09-0${i}` : date, outlet: outlet(), entry_type: i === 2 ? "leave" : "working", leave_type: "annual", start_time: "10:00", end_time: "22:00", position: longCopy() })) }),
  myLeave: () => ({ balances: [{ entitlement_id: "qa-entitlement", leave_type: "annual", available: 14, pending: 1, used: 2, balance_enforced: true }], requests: [{ id: "qa-leave", leave_type: "annual", status: "approved", start_date: "2026-09-03", end_date: "2026-09-04", requested_days: 2, submitted_at: "2026-08-20T10:00:00Z", reason: longCopy() }], upcoming: [] }),
  growthMobile: () => ({ summary: { certified: 1, in_progress: 1, ready_for_review: 1, not_started: 0, total: 3 }, skills: ["certified", "in_progress", "ready_for_review"].map((status, i) => ({ id: `qa-skill-${i}`, name: longCopy(), category: longCopy(), status, requirements_completed: 1, requirements_total: 3, requirements: [] })), timeline: [] }),
  performanceMobile: performance,
  rewardMobile: () => ({ period_start: "2026-08-01", status: "qualified", cycle_status: "review", reward_amount: 120.72, estimated_reward: 120.72, performance_score: 87, earn_rate: .8, eligible_hours: 200, total_eligible_hours: 500, contribution_share: .4, maximum_share: 150.90, reward_pool: 377.25, calculation_version: "reward-tier-v2", projection_applicable: true, history: [{ period_start: "2026-07-01", amount: 112.4, status: "paid", paid_at: "2026-08-05T00:00:00Z" }] }),
  learningHome: () => ({ assignment: { id: "qa-assignment", progress_percentage: 50, lessons_completed: 2, lessons_total: 4 }, required_sops: [] }),
  sopLibrary: () => ({ categories: [{ id: "qa-category", name: longCopy() }], sops: [{ id: "qa-sop", version_id: "qa-version", title: longCopy(), category: longCopy(), category_id: "qa-category", version: 1, acknowledgement_required: true, updated_at: "2026-08-20T10:00:00Z" }] }),
  learningAssignment: () => ({ id: "qa-assignment", journey: { id: "qa-journey", name: longCopy(), description: longCopy() }, modules: Array.from({ length: 3 }, (_, i) => ({ module: { id: `qa-module-${i}`, title: longCopy() }, progress_percentage: 50, status: "in_progress", lessons: [{ lesson: { id: `qa-lesson-${i}`, title: longCopy(), lesson_type: "reading" }, completed: false, locked: false }] })) }),
  localizedContentForCrew: () => ({}),
  cashCheckoutMobile: () => ({ outlet: outlet(), business_date: date, can_perform: true, can_initiate_handover: true, settings: { floating_cash: 300, variance_tolerance: 5 }, cash_context: { floating_cash: 300, previous_carry_forward: 50, expected_opening_cash: 350 }, checkout: null, deposit: { current_balance: 500, available_balance: 500, recent: [], ledger: [] }, receivers: [{ id: "qa-receiver", name: longCopy() }], pending_receipts: [] }),
  cashCheckoutHistory: () => [],
};
let pending = 0;
export const crewService = new Proxy({}, { get: (_, method) => async () => {
  if (!data[method]) {
    document.documentElement.dataset.fixtureRefused = String(method);
    throw new Error(`QA fixture refuses unimplemented read or mutation: ${String(method)}`);
  }
  document.documentElement.dataset.fixturePending = String(++pending);
  try { await new Promise(resolve => setTimeout(resolve, 40)); return structuredClone(data[method]()); }
  finally { document.documentElement.dataset.fixturePending = String(--pending); }
} });
