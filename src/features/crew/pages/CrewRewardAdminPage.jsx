import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Calculator, ChevronRight, Gift, Search, UsersRound } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import AsyncDataSurface from "../../../components/feedback/AsyncDataSurface.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import AdminSummaryGrid from "../../../components/ui/AdminSummaryGrid.jsx";
import { semanticStatusTone } from "../../../components/ui/semanticStatus.js";
import MonthPickerField from "../../../components/forms/MonthPickerField.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import AdminDataSection from "../../../components/tables/AdminDataSection.jsx";
import AdminPagination, { useAdminPagedQuery } from "../../../components/tables/AdminPagination.jsx";
import { crewService } from "../../../services/crewService.js";
import AdminFilterToolbar from "../../../components/layout/AdminFilterToolbar.jsx";
import { CrewAdminOutletField } from "../components/CrewAdminToolbar.jsx";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";

const currentPeriod = () => `${new Date().toISOString().slice(0, 7)}-01`;
const money = (value) => `RM ${Number(value || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;
const month = (value) => new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("en-MY", { month: "long", year: "numeric" });
const cycleStatus = (value) => ({ draft: "Upcoming", review: "Ready for Review", finalized: "Finalized", paid: "Paid" }[value] || value);
const entryStatus = (value) => ({ awaiting_performance: "Awaiting Performance", not_eligible: "Not Eligible", qualified: "Qualified", finalized: "Finalized", paid: "Paid" }[value] || value);
const emptyData = { cycles: [], cycle: null, entries: [], adjustments: [], participants: [], eligible_crew: [] };

export default function CrewRewardAdminPage({ auth, ui, store }) {
  const { outlets, outletId, setOutletId } = useCrewAdminOutlet(store?.outlets || []);
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [employeeOpen, setEmployeeOpen] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const requestRef = useRef(0);
  const canManage = auth.hasPermission("crew_reward.manage");
  const canFinalize = auth.hasPermission("crew_reward.finalize");
  const canPaid = auth.hasPermission("crew_reward.mark_paid");
  const entriesSignature = useMemo(() => JSON.stringify({ outletId, period, cycleId: data.cycle?.id || null, listing: "entries" }), [outletId, period, data.cycle?.id]);
  const campaignsSignature = useMemo(() => JSON.stringify({ outletId, period, listing: "campaigns" }), [outletId, period]);
  const [entriesListing, entriesActions] = useAdminPagedQuery({ storageKey: "crew-reward-entries", enabled: Boolean(outletId && data.cycle?.id), querySignature: entriesSignature, loadPage: ({ page, pageSize }) => crewService.rewardAdminPage({ outletId, period, cycleId: data.cycle?.id, listing: "entries", page, pageSize }) });
  const [campaignsListing, campaignsActions] = useAdminPagedQuery({ storageKey: "crew-reward-campaigns", enabled: Boolean(outletId), querySignature: campaignsSignature, loadPage: ({ page, pageSize }) => crewService.rewardAdminPage({ outletId, period, listing: "campaigns", page, pageSize }) });

  async function refresh(cycleId = null, nextPeriod = period) {
    if (!outletId) return;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const result = await crewService.rewardAdminData(outletId, nextPeriod, cycleId);
      if (requestId === requestRef.current) setData({ ...emptyData, ...result });
    } catch (cause) {
      if (requestId === requestRef.current) setError(cause.message || "Reward Campaigns could not be loaded.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [outletId, period]);

  async function createCampaign(values) {
    const id = await crewService.createRewardCampaign({ outletId, ...values });
    setCreateOpen(false);
    setPeriod(values.period);
    await refresh(id, values.period);
    setCampaignOpen(true);
    ui.notify({ title: "Reward Campaign created", message: "Participating Crew were frozen for this Campaign." });
  }
  async function calculate() { await crewService.calculateRewardCycle(data.cycle.id); await refresh(data.cycle.id); ui.notify({ title: "Reward calculated", message: "The server created the review breakdown from finalized evidence." }); }
  async function finalize() {
    try {
      await crewService.finalizeRewardCycle(data.cycle.id);
      await refresh(data.cycle.id);
      ui.notify({ title: "Reward finalized", message: "The monthly payout snapshot is now immutable." });
    } catch (cause) {
      await refresh(data.cycle.id);
      ui.notify({ title: "Reward Campaign is not ready to finalize", message: data.cycle?.finalization_readiness?.message || "Complete the remaining Reward inputs before finalizing.", tone: "error" });
    }
  }
  async function markPaid() { await crewService.markRewardCyclePaid(data.cycle.id); await refresh(data.cycle.id); ui.notify({ title: "Reward marked paid", message: "Crew can now see the paid status in Reward History." }); }
  async function adjust(values) { await crewService.adjustRewardEntry(values.entryId, values.amount, values.reason); setAdjusting(null); await refresh(data.cycle.id); ui.notify({ title: "Adjustment saved", message: "Calculated, adjusted and final amounts remain auditable." }); }
  async function openCycle(row) { setPeriod(row.period_start); const next = await crewService.rewardAdminData(outletId, row.period_start, row.id); setData({ ...emptyData, ...next }); setCampaignOpen(true); }

  const outlet = outlets.find((row) => row.id === outletId);
  return <div className="space-y-5">
    <PageHeader section="Crew · Reward" title="Reward Overview" description="Plan monthly Reward Campaigns, monitor projected payouts and finalize transparent Crew rewards." primaryActions={canManage ? <button className="btn-primary" type="button" onClick={() => setCreateOpen(true)}>+ Create Reward</button> : null} />
    <AdminFilterToolbar ariaLabel="Reward filters" outlet={<CrewAdminOutletField />} period={<MonthPickerField label="Period" value={period.slice(0, 7)} onChange={(value) => setPeriod(`${value}-01`)} />} />

    <AsyncDataSurface loading={loading} error={error} errorTitle="Unable to load Rewards" hasData={Boolean(data.cycle || data.cycles.length)} onRetry={() => refresh()}><RewardOverview data={data} entries={entriesListing.rows} entriesLoaded={entriesListing.hasLoaded} entriesPagination={<AdminPagination {...entriesListing} onPageChange={entriesActions.requestPage} onPageSizeChange={entriesActions.requestPageSize} noun="Crew rewards" />} campaigns={campaignsListing.rows} campaignsLoaded={campaignsListing.hasLoaded} campaignsPagination={<AdminPagination {...campaignsListing} onPageChange={campaignsActions.requestPage} onPageSizeChange={campaignsActions.requestPageSize} noun="Reward campaigns" />} canManage={canManage} onOpenCampaign={() => setCampaignOpen(true)} onOpenEmployee={setEmployeeOpen} onOpenCycle={openCycle} /></AsyncDataSurface>

    {campaignOpen && data.cycle ? <CampaignDetail data={data} canManage={canManage} canFinalize={canFinalize} canPaid={canPaid} onClose={() => setCampaignOpen(false)} onCalculate={calculate} onFinalize={finalize} onPaid={markPaid} onOpenEmployee={setEmployeeOpen} /> : null}
    {employeeOpen ? <EmployeeRewardDetail entry={employeeOpen} cycle={data.cycle} canAdjust={canManage && data.cycle?.status === "review"} onClose={() => setEmployeeOpen(null)} onAdjust={() => { setEmployeeOpen(null); setAdjusting(employeeOpen); }} /> : null}
    {createOpen ? <CreateCampaign outlet={outlet} defaultPeriod={period} crew={data.eligible_crew} existing={data.cycles} onClose={() => setCreateOpen(false)} onSubmit={createCampaign} /> : null}
    {adjusting ? <Adjustment entry={adjusting} onClose={() => setAdjusting(null)} onSubmit={adjust} /> : null}
  </div>;
}

function RewardOverview({ data, entries, entriesLoaded, entriesPagination, campaigns, campaignsLoaded, campaignsPagination, canManage, onOpenCampaign, onOpenEmployee, onOpenCycle }) {
  const cycle = data.cycle;
  const visibleEntries = entriesLoaded ? entries : data.entries;
  const visibleCampaigns = campaignsLoaded ? campaigns : data.cycles;
  return <div className="min-w-0 space-y-5">
    {cycle ? <CurrentCampaign data={{ ...data, summaryEntries: data.entries, entries: visibleEntries }} pagination={entriesPagination} onOpenCampaign={onOpenCampaign} onOpenEmployee={onOpenEmployee} /> : <EmptyState icon={Gift} title="No Reward Campaign for this month" description={canManage ? "Create a Campaign to set the pool and freeze participating Crew." : "No Campaign has been configured for the selected period."} />}
    <CampaignHistory rows={visibleCampaigns} pagination={campaignsPagination} currentCycleId={cycle?.id} onOpen={onOpenCycle} />
  </div>;
}

function CurrentCampaign({ data, pagination, onOpenCampaign, onOpenEmployee }) {
  const c = data.cycle;
  const summaryEntries = data.summaryEntries || data.entries;
  const participating = Number(c.participant_count || data.participants.length || summaryEntries.length);
  const qualified = summaryEntries.filter((row) => ["qualified", "finalized", "paid"].includes(row.status)).length;
  const awaiting = summaryEntries.filter((row) => row.status === "awaiting_performance");
  const payout = Number(c.actual_payout ?? c.estimated_payout ?? 0);
  const configured = Number(c.configured_pool || 0);
  const unused = Math.max(0, Number(c.unused_amount ?? configured - payout));
  const utilization = configured > 0 ? payout / configured : 0;

  return <>
    <section className="space-y-3" aria-labelledby="current-reward-campaign">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs font-semibold text-text-secondary">Current Campaign</span>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 id="current-reward-campaign" className="text-xl font-bold text-text-primary">{month(c.period_start)}</h2>
            <Badge tone={semanticStatusTone(c.status)}>{cycleStatus(c.status)}</Badge>
          </div>
        </div>
        <button className="btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap" type="button" onClick={onOpenCampaign}>Review Campaign <ChevronRight size={15} /></button>
      </header>
      <AdminSummaryGrid variant="standard" ariaLabel="Current Reward Campaign summary" items={[
        { label: "Configured Pool", value: money(configured), helper: "Campaign budget" },
        { label: c.status === "finalized" || c.status === "paid" ? "Final Payout" : "Projected Payout", value: money(payout), helper: awaiting.length ? "Awaiting Performance" : "Current campaign result", tone: awaiting.length ? "warning" : "neutral" },
        { label: "Qualified Crew", value: `${qualified} / ${participating}`, helper: awaiting.length ? `${awaiting.length} pending` : `${qualified} qualified`, tone: awaiting.length ? "warning" : "success" },
        { label: "Pool Utilization", value: percent(utilization), helper: `Unused balance ${money(unused)}` },
      ]} />
      <CampaignStatusStrip cycle={c} awaiting={awaiting.length} />
    </section>
    <AdminDataSection title="Crew Rewards" description="Canonical server results from finalized Performance and eligible attendance."><RewardTable rows={data.entries} cycle={c} onOpen={onOpenEmployee} />{pagination}</AdminDataSection>
  </>;
}

function CampaignStatusStrip({ cycle, awaiting }) {
  if (awaiting) return <aside className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900" role="alert"><AlertTriangle className="mt-0.5 shrink-0" size={16} /><div className="grid gap-0.5"><strong className="text-sm">{awaiting} Crew awaiting finalized Performance</strong><span className="text-xs text-amber-800">Reward calculation will update automatically when their Performance is finalized.</span></div></aside>;
  if (cycle.status === "review") return <aside className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900" role="status"><strong className="block text-sm">Reward calculation is ready for review</strong><span className="mt-0.5 block text-xs text-emerald-800">Review the canonical Crew breakdown before finalizing this Campaign.</span></aside>;
  return null;
}

function RewardTable({ rows, cycle, onOpen }) {
  if (!rows.length) return <EmptyState title="No Crew rewards yet" description="Calculate this Draft Campaign to create its frozen Reward breakdown." />;
  return <DataTable density="compact" rows={rows} getRowKey={(row) => row.id} onRowClick={onOpen} tableClassName="min-w-[940px]" columns={[
    { key: "employee", header: "Employee", render: (row) => <span className="crew-growth-name"><span className="crew-growth-avatar">{row.employee_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span><span><strong>{row.employee_name}</strong><small>{row.position || "Crew"}</small></span></span> },
    { key: "hours", header: "Eligible Hours", align: "right", render: (row) => <span className="tabular-nums text-text-secondary">{Number(row.eligible_hours).toFixed(1)}h</span> },
    { key: "performance", header: "Performance", align: "right", render: (row) => <span className="tabular-nums text-text-secondary">{row.performance_score == null ? "—" : Math.round(row.performance_score)}</span> },
    { key: "contribution", header: "Contribution", align: "right", render: (row) => <span className="tabular-nums text-text-secondary">{row.status === "awaiting_performance" ? "—" : percent(row.contribution_share)}</span> },
    { key: "factor", header: "Reward Factor", align: "right", render: (row) => <span className="tabular-nums text-text-secondary">{percent(row.performance_factor)}</span> },
    { key: "reward", header: cycle.status === "finalized" || cycle.status === "paid" ? "Final Reward" : "Projected Reward", align: "right", render: (row) => <strong className="whitespace-nowrap tabular-nums text-primary">{money(row.final_payout)}</strong> },
    { key: "status", header: "Status", render: (row) => <Badge tone={semanticStatusTone(row.status)}>{entryStatus(row.status)}</Badge> },
    { key: "open", header: "", align: "right", render: () => <ChevronRight className="text-text-muted" size={15} /> },
  ]} />;
}

function CampaignHistory({ rows, pagination, currentCycleId, onOpen }) {
  return <AdminDataSection title="Reward Campaigns" description="Current and immutable historical monthly Campaigns.">{rows.length ? <DataTable density="compact" rows={rows} getRowKey={(row) => row.id} onRowClick={onOpen} tableClassName="min-w-[850px]" columns={[
    { key: "period", header: "Period", render: (row) => <span className="flex items-center gap-2 whitespace-nowrap"><strong>{month(row.period_start)}</strong>{row.id === currentCycleId ? <Badge tone="info">Current</Badge> : null}</span> },
    { key: "pool", header: "Pool", align: "right", render: (row) => <span className="tabular-nums text-text-secondary">{money(row.configured_pool)}</span> },
    { key: "crew", header: "Crew", align: "right", render: (row) => <span className="whitespace-nowrap tabular-nums text-text-secondary">{Number(row.participant_count || 0)} Crew</span> },
    { key: "payout", header: "Payout", align: "right", render: (row) => <strong className="whitespace-nowrap tabular-nums text-primary">{money(row.actual_payout)}</strong> },
    { key: "utilization", header: "Utilization", align: "right", render: (row) => <span className="tabular-nums text-text-secondary">{percent(Number(row.configured_pool) > 0 ? Number(row.actual_payout || 0) / Number(row.configured_pool) : 0)}</span> },
    { key: "status", header: "Status", render: (row) => <Badge tone={semanticStatusTone(row.status)}>{cycleStatus(row.status)}</Badge> },
    { key: "open", header: "", align: "right", render: () => <ChevronRight className="text-text-muted" size={15} /> },
  ]} /> : <EmptyState title="No Reward Campaign history" description="Campaigns for this outlet will appear here after they are created." />}{pagination}</AdminDataSection>;
}

function CampaignDetail({ data, canManage, canFinalize, canPaid, onClose, onCalculate, onFinalize, onPaid, onOpenEmployee }) {
  const c = data.cycle;
  const qualified = data.entries.filter((row) => ["qualified", "finalized", "paid"].includes(row.status)).length;
  const readiness = c.finalization_readiness;
  const finalizationBlocked = c.status === "review" && readiness?.ready === false;
  return <Modal title={`${month(c.period_start)} Reward Campaign`} description={`${cycleStatus(c.status)} · ${c.calculation_version}`} size="xl" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Close</button>{c.status === "draft" && canManage ? <button className="btn-primary" onClick={onCalculate}>Calculate & Review</button> : null}{c.status === "review" && canFinalize ? <button className="btn-primary" disabled={finalizationBlocked} onClick={onFinalize}>Finalize Reward Campaign</button> : null}{c.status === "finalized" && canPaid ? <button className="btn-primary" onClick={onPaid}>Mark Paid</button> : null}</>}>
    <div className="crew-reward-detail"><section className="crew-reward-pool"><div><small>Configured Pool</small><strong>{money(c.configured_pool)}</strong></div><div><small>{c.status === "draft" ? "Participants" : "Calculated Payout"}</small><strong>{c.status === "draft" ? `${data.participants.length} Crew` : money(c.estimated_payout)}</strong></div><div><small>Final Payout</small><strong>{money(c.actual_payout)}</strong></div><div><small>Qualified</small><strong>{qualified} / {Number(c.participant_count || data.participants.length)}</strong></div></section>
    {finalizationBlocked ? <FinalizationReadiness readiness={readiness} entries={data.entries} onOpenEmployee={onOpenEmployee} /> : null}
    {c.status === "draft" ? <><section className="crew-reward-draft-note"><Calculator size={21} /><div><strong>Participant snapshot is ready</strong><p>The server will calculate only these frozen participants from finalized Performance and completed eligible hours.</p></div></section><ParticipantList rows={data.participants} /></> : <RewardTable rows={data.entries} cycle={c} onOpen={onOpenEmployee} />}
    {data.adjustments.length ? <section className="crew-reward-audit"><h3>Adjustment History</h3>{data.adjustments.map((row) => <div key={row.id}><span>{row.reason}</span><strong>{Number(row.adjustment_amount) > 0 ? "+" : ""}{money(row.adjustment_amount)}</strong></div>)}</section> : null}</div>
  </Modal>;
}

function FinalizationReadiness({ readiness, entries, onOpenEmployee }) {
  const unresolved = entries.filter((row) => ["awaiting_performance", "estimated"].includes(row.status));
  const count = Number(readiness?.blocker_count || unresolved.length || 0);
  return <section className="crew-reward-attention"><header><AlertTriangle size={18} /><div><h2>Finalization blocked</h2><p>{readiness?.message || `${count} Crew still have incomplete Reward inputs.`}</p></div></header>{unresolved.length ? unresolved.map((row) => <button type="button" key={row.id} onClick={() => onOpenEmployee(row)}><span><strong>{row.employee_name}</strong><small>{row.status === "awaiting_performance" ? "Performance result is incomplete." : "Reward calculation is incomplete."}</small></span><Badge tone="warning">{row.status === "awaiting_performance" ? "Needs Performance" : "Needs calculation"}</Badge><ChevronRight size={16} /></button>) : null}</section>;
}

function ParticipantList({ rows }) { return <section className="crew-reward-participants"><h3>Participating Crew</h3>{rows.map((row) => <div key={row.employee_id}><UsersRound size={15} /><span><strong>{row.employee_name}</strong><small>{row.position || "Crew"}</small></span></div>)}</section>; }

function EmployeeRewardDetail({ entry, cycle, canAdjust, onClose, onAdjust }) {
  const maximum = Number(entry.base_reward || entry.source_snapshot?.maximum_share || 0);
  return <Modal title={entry.employee_name} description={`${entry.position || "Crew"} · ${month(cycle.period_start)}`} onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Close</button>{canAdjust && entry.status === "qualified" ? <button className="btn-primary" onClick={onAdjust}>Adjust Reward</button> : null}</>}>
    <div className="crew-reward-employee-detail"><Badge tone={semanticStatusTone(entry.status)}>{entryStatus(entry.status)}</Badge><dl><div><dt>Performance</dt><dd>{entry.performance_score == null ? "—" : Math.round(entry.performance_score)}</dd></div><div><dt>Eligible Hours</dt><dd>{Number(entry.eligible_hours).toFixed(1)}h</dd></div><div><dt>Contribution</dt><dd>{percent(entry.contribution_share)}</dd></div><div><dt>Reward Factor</dt><dd>{percent(entry.performance_factor)}</dd></div></dl><section><small>Calculated Reward</small><strong>{money(entry.calculated_reward)}</strong>{Number(entry.adjustment_amount) ? <><span>Adjustment <b>{Number(entry.adjustment_amount) > 0 ? "+" : ""}{money(entry.adjustment_amount)}</b></span><span>Final <b>{money(entry.final_payout)}</b></span></> : null}</section><div className="crew-reward-formula-copy"><strong>How this reward is calculated</strong><p>{money(cycle.configured_pool)} pool × {percent(entry.contribution_share)} contribution = {money(maximum)} maximum share. The server then applies the {percent(entry.performance_factor)} Performance earn rate.</p></div>{entry.eligibility_reason ? <p className="crew-reward-reason">{entry.eligibility_reason}</p> : null}</div>
  </Modal>;
}

function CreateCampaign({ outlet, defaultPeriod, crew, existing, onClose, onSubmit }) {
  const [period, setPeriod] = useState(defaultPeriod);
  const [pool, setPool] = useState("500");
  const [mode, setMode] = useState("all");
  const [selected, setSelected] = useState(() => new Set());
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const duplicate = existing.some((row) => row.period_start?.slice(0, 7) === period.slice(0, 7));
  const visible = crew.filter((row) => `${row.name} ${row.position || ""}`.toLowerCase().includes(query.toLowerCase()));
  const count = mode === "all" ? crew.length : selected.size;
  function toggle(id) { setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  async function submit() { setSaving(true); try { await onSubmit({ period, configuredPool: Number(pool), employeeIds: mode === "all" ? null : [...selected] }); } finally { setSaving(false); } }
  return <Modal title="Create Reward" description={`${outlet?.name || "Outlet"} · Monthly Campaign`} size="lg" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving || Number(pool) <= 0 || count < 1 || duplicate} onClick={submit}>{saving ? "Creating…" : `Create Reward for ${count} Crew`}</button></>}>
    <div className="crew-reward-form"><MonthPickerField label="Reward Month *" value={period.slice(0, 7)} onChange={(value) => setPeriod(`${value}-01`)} />{duplicate ? <p className="crew-reward-validation"><AlertTriangle size={15} /> A Reward Campaign already exists for this outlet and month.</p> : null}<label>Reward Pool *<span className="crew-reward-money-input"><b>RM</b><input className="control" type="number" min="0.01" step="0.01" value={pool} onChange={(event) => setPool(event.target.value)} /></span></label><fieldset className="crew-reward-crew-picker"><legend>Participating Crew *</legend><label><input type="radio" checked={mode === "all"} onChange={() => setMode("all")} /> All eligible Crew <small>{crew.length} available</small></label><label><input type="radio" checked={mode === "selected"} onChange={() => setMode("selected")} /> Select Crew</label>{mode === "selected" ? <div><label className="crew-reward-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Crew…" /></label><div className="crew-reward-crew-list">{visible.map((row) => <label key={row.id}><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} /><span><strong>{row.name}</strong><small>{row.position || "Crew"}</small></span></label>)}</div></div> : null}<footer>Selected: <strong>{count} Crew</strong></footer></fieldset></div>
  </Modal>;
}

function Adjustment({ entry, onClose, onSubmit }) { const [amount, setAmount] = useState(""); const [reason, setReason] = useState(""); const final = Number(entry.calculated_reward || 0) + Number(amount || 0); return <Modal title="Adjust Reward" description={`${entry.employee_name} · Calculated ${money(entry.calculated_reward)}`} onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!Number(amount) || reason.trim().length < 5 || final < 0} onClick={() => onSubmit({ entryId: entry.id, amount: Number(amount), reason })}>Save Adjustment</button></>}><div className="crew-reward-form"><label>Adjustment amount<input className="control" type="number" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Example: 20 or -5" /></label><section className="crew-reward-adjust-preview"><span>Calculated <strong>{money(entry.calculated_reward)}</strong></span><span>Adjustment <strong>{Number(amount) > 0 ? "+" : ""}{money(amount)}</strong></span><span>Final <strong>{money(final)}</strong></span></section><label>Reason *<textarea className="control" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Required audit reason" /></label><p><AlertTriangle size={15} /> The calculated amount is retained. This adjustment creates an immutable audit record.</p></div></Modal>; }
