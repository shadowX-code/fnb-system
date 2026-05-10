import { useMemo, useState } from "react";
import { Lock, LockOpen, ShieldCheck } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import PeriodFilterBar from "../components/PeriodFilterBar.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { operationsService } from "../services/operationsService.js";
import { buildAlerts, getNetSales, getOutletTaxConfig, monthLabel, sumAmount, toCurrency, toPercent } from "../utils/analytics.js";

const currentUser = { name: "Marcus Lee", role: "Owner" };
const canManageLocks = ["Owner", "Admin"].includes(currentUser.role);
const requiredSalesChannels = ["Dine In", "Takeaway", "GrabFood", "FoodPanda", "ShopeeFood"];

function getLock(store, outletId, month, year) {
  return store.monthlyLocks.find((lock) => lock.outlet_id === outletId && lock.month === month && lock.year === year);
}

function formatTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getSalesRecordRows(store, outletId, month, year) {
  return store.salesRecords.filter((record) => record.outlet_id === outletId && record.month === month && record.year === year);
}

function getPurchaseRecordRows(store, outletId, month, year) {
  return store.purchaseRecords.filter((record) => record.outlet_id === outletId && record.month === month && record.year === year);
}

function buildAuditTrail({ lock, salesRows, purchaseRows, isLocked }) {
  const items = [];
  if (isLocked) {
    items.push({ action: "Month locked", user: lock?.locked_by || "Marcus Lee", timestamp: lock?.locked_at || new Date().toISOString() });
  } else if (lock?.unlocked_at) {
    items.push({ action: "Unlock action performed", user: lock.unlocked_by || "Owner", timestamp: lock.unlocked_at });
  }
  if (purchaseRows.length) items.push({ action: "Purchase updated", user: "Jason", timestamp: purchaseRows.at(-1)?.updated_at });
  if (salesRows.length) items.push({ action: "Sales saved", user: "Amanda", timestamp: salesRows.at(-1)?.updated_at });
  items.push({ action: "Data health checked", user: "Marcus Lee", timestamp: new Date().toISOString() });
  return items.filter((item) => item.timestamp).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function getStatus({ isLocked, salesScore, purchaseScore, warnings, hasAnyData }) {
  if (isLocked) return { label: "Locked", tone: "warning" };
  if (!hasAnyData) return { label: "Draft", tone: "neutral" };
  if (warnings.length) return { label: "Incomplete", tone: "danger" };
  if (salesScore === 100 && purchaseScore === 100) return { label: "Ready to Lock", tone: "success" };
  return { label: "Draft", tone: "warning" };
}

export default function DataHealthPage({ store, setStore, ui }) {
  const filters = usePeriodFilters(store);
  const [lockModal, setLockModal] = useState(false);
  const [unlockModal, setUnlockModal] = useState(false);
  const [lockConfirmed, setLockConfirmed] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");
  const salesRows = getSalesRecordRows(store, filters.outletId, filters.month, filters.year);
  const purchaseRows = getPurchaseRecordRows(store, filters.outletId, filters.month, filters.year);
  const netSales = getNetSales(store.salesRecords, filters.outletId, filters.month, filters.year, store.salesChannels);
  const totalPurchase = sumAmount(purchaseRows);
  const lock = getLock(store, filters.outletId, filters.month, filters.year);
  const isLocked = Boolean(lock?.is_locked);
  const hasAnyData = salesRows.length > 0 || purchaseRows.length > 0;
  const sstConfig = getOutletTaxConfig(store.outletTaxConfigs, filters.outletId, filters.month, filters.year, "SST");
  const sstEnabled = Boolean(sstConfig.enabled);

  const alerts = useMemo(() => buildAlerts({
    outletId: filters.outletId,
    month: filters.month,
    year: filters.year,
    salesRecords: store.salesRecords,
    salesChannels: store.salesChannels,
    purchaseRecords: store.purchaseRecords,
    suppliers: store.suppliers,
    outletTaxConfigs: store.outletTaxConfigs,
    specialMonths: store.specialMonths,
  }), [filters.month, filters.outletId, filters.year, store]);

  const unresolvedHighAlerts = alerts.filter((alert) => ["critical", "high"].includes(alert.priority));
  const salesChannelNames = salesRows.map((record) => store.salesChannels.find((channel) => channel.id === record.channel_id)?.name).filter(Boolean);
  const missingRequiredChannels = requiredSalesChannels.filter((name) => !salesChannelNames.includes(name));
  const sstRecord = salesRows.find((record) => {
    const name = store.salesChannels.find((channel) => channel.id === record.channel_id)?.name;
    return ["SST Deduction", "SST", "SST (-)"].includes(name);
  });
  const hasSst = Boolean(sstRecord && Number(sstRecord.amount || 0) > 0);
  const salesEmptyCriticalRows = salesRows.filter((record) => {
    const name = store.salesChannels.find((channel) => channel.id === record.channel_id)?.name;
    return requiredSalesChannels.includes(name) && Number(record.amount || 0) <= 0;
  });
  const purchaseEmptyRows = purchaseRows.filter((record) => !record.supplier_id || !record.category_id || record.amount === "" || record.amount === null || record.amount === undefined);

  const warnings = [
    !hasAnyData ? "No records entered for this month." : null,
    missingRequiredChannels.length ? `${missingRequiredChannels.length} required sales channels missing.` : null,
    sstEnabled && !hasSst && salesRows.length ? "SST deduction missing." : null,
    salesEmptyCriticalRows.length ? `${salesEmptyCriticalRows.length} critical sales rows are empty.` : null,
    purchaseRows.length && !salesRows.length ? "Purchase exists but sales data is missing." : null,
    purchaseEmptyRows.length ? `${purchaseEmptyRows.length} supplier rows incomplete.` : null,
    unresolvedHighAlerts.length ? `${unresolvedHighAlerts.length} unresolved high or critical alerts.` : null,
  ].filter(Boolean);

  const salesScore = !salesRows.length
    ? 0
    : Math.max(0, Math.round(100 - missingRequiredChannels.length * 12 - salesEmptyCriticalRows.length * 10 - (sstEnabled && !hasSst ? 10 : 0)));
  const purchaseScore = !purchaseRows.length
    ? 0
    : Math.max(0, Math.round(100 - purchaseEmptyRows.length * 15 - unresolvedHighAlerts.length * 12));
  const overallScore = Math.round(salesScore * 0.45 + purchaseScore * 0.45 + (warnings.length ? 0 : 10));
  const monthStatus = getStatus({ isLocked, salesScore, purchaseScore, warnings, hasAnyData });
  const readyToLock = canManageLocks && !isLocked && hasAnyData && salesScore === 100 && purchaseScore === 100 && !unresolvedHighAlerts.length && !warnings.length;
  const auditTrail = buildAuditTrail({ lock, salesRows, purchaseRows, isLocked });

  function lockMonth() {
    if (!lockConfirmed) return;
    setStore((current) => operationsService.setMonthLock(current, { outletId: filters.outletId, month: filters.month, year: filters.year, isLocked: true, user: currentUser.name }));
    setLockModal(false);
    setLockConfirmed(false);
    ui.notify({ title: "Month locked", message: `${monthLabel(filters.month)} ${filters.year} is now frozen.` });
  }

  function unlockMonth() {
    if (!unlockReason.trim()) return;
    setStore((current) => operationsService.setMonthLock(current, { outletId: filters.outletId, month: filters.month, year: filters.year, isLocked: false, user: currentUser.name }));
    setUnlockModal(false);
    ui.notify({ title: "Month unlocked", message: unlockReason.trim() });
    setUnlockReason("");
  }

  return (
    <div className="space-y-4">
      <PageHeader
        section="Controls"
        title="Month Closing Control Center"
        description="Check completeness, review exceptions, lock accounting month data, and preserve audit trail."
        actions={
          isLocked ? (
            <button className="btn-secondary" type="button" disabled={!canManageLocks} onClick={() => setUnlockModal(true)}>
              <LockOpen size={15} /> Unlock Month
            </button>
          ) : (
            <button
              className="btn-primary"
              type="button"
              disabled={!readyToLock}
              title={!readyToLock ? "Resolve all critical issues before locking." : undefined}
              onClick={() => setLockModal(true)}
            >
              <Lock size={15} /> Lock Month
            </button>
          )
        }
      />

      <PeriodFilterBar store={store} filters={filters} compact />

      {!hasAnyData ? (
        <div className="rounded-2xl border border-dashed border-border bg-slate-50 p-6 text-sm text-text-secondary">
          <div className="font-bold text-text-primary">No records entered for this month.</div>
          <p className="mt-1">Enter Sales and Supplier Purchase records before month closing checks can be completed.</p>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card title="Month Lock" description="Lock freezes Sales and Purchase input. Dashboard, comparison, alerts, export and print remain available.">
          <div className="p-4">
            <div className={`rounded-2xl border p-4 ${isLocked ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                    {isLocked ? <Lock size={16} className="text-rose-600" /> : <LockOpen size={16} className="text-emerald-600" />}
                    {monthLabel(filters.month)} {filters.year}
                  </div>
                  <p className="mt-1 text-sm text-text-secondary">
                    {isLocked ? "Editing disabled for this month." : "Sales and Purchase inputs remain editable."}
                  </p>
                </div>
                <Badge tone={isLocked ? "danger" : "success"}>{isLocked ? "Locked" : "Editable"}</Badge>
              </div>
              <div className="mt-4 grid gap-2 text-xs text-text-secondary sm:grid-cols-2">
                <div>Role: <strong className="text-text-primary">{currentUser.role}</strong></div>
                <div>Permission: <strong className="text-text-primary">{canManageLocks ? "Owner/Admin" : "View only"}</strong></div>
                <div>Locked by: <strong className="text-text-primary">{lock?.locked_by || "-"}</strong></div>
                <div>Locked at: <strong className="text-text-primary">{formatTime(lock?.locked_at)}</strong></div>
              </div>
              {!readyToLock && !isLocked ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                  Resolve all critical issues before locking.
                </div>
              ) : null}
            </div>
          </div>
        </Card>

        <Card title="Completeness Score">
          <div className="space-y-4 p-4">
            {[
              ["Sales", salesScore],
              ["Purchase", purchaseScore],
              ["Overall", overallScore],
            ].map(([label, score]) => (
              <div key={label}>
                <div className="mb-1 flex justify-between text-sm font-semibold"><span>{label}</span><span>{score}%</span></div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div className={`h-2 rounded-full ${score >= 100 ? "bg-emerald-500" : score >= 80 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${score}%` }} />
                </div>
              </div>
            ))}
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-text-secondary">Month Status</span>
                <Badge tone={monthStatus.tone}>{monthStatus.label}</Badge>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Sales Records" value={`${salesRows.length} channels`} helper={salesRows.length ? `Last updated ${formatTime(salesRows.at(-1)?.updated_at)}` : "Missing"} tone={salesScore === 100 ? "success" : "warning"} />
        <MetricCard label="Purchase Records" value={`${purchaseRows.length} suppliers`} helper={`${unresolvedHighAlerts.length} abnormal rows`} tone={purchaseScore === 100 ? "success" : unresolvedHighAlerts.length ? "danger" : "warning"} />
        <MetricCard label="Month Status" value={monthStatus.label} helper={`${toCurrency(netSales)} sales · ${toCurrency(totalPurchase)} purchase`} tone={monthStatus.tone === "danger" ? "danger" : monthStatus.tone === "success" ? "success" : "warning"} />
      </div>

      {warnings.length ? (
        <Card title="Warnings Detected" description="Resolve these before locking the month.">
          <div className="grid gap-2 p-4 md:grid-cols-2">
            {warnings.map((warning) => (
              <div key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">{warning}</div>
            ))}
          </div>
        </Card>
      ) : (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <div className="flex items-center gap-2 font-bold"><ShieldCheck size={16} /> Ready for closing review.</div>
          <p className="mt-1">Sales, purchase and alert checks are complete for this month.</p>
        </div>
      )}

      <Card title="Recent Activity" description="Audit trail for closing and data updates.">
        <div className="divide-y divide-border">
          {auditTrail.map((item, index) => (
            <div key={`${item.action}-${index}`} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1fr_160px_180px] md:items-center">
              <div className="font-semibold text-text-primary">{item.action}</div>
              <div className="text-text-secondary">{item.user}</div>
              <div className="text-xs font-semibold text-text-muted">{formatTime(item.timestamp)}</div>
            </div>
          ))}
        </div>
      </Card>

      {lockModal ? (
        <Modal
          title={`Lock ${monthLabel(filters.month)} ${filters.year}?`}
          description="This action freezes accounting month data."
          onClose={() => setLockModal(false)}
          footer={
            <>
              <button className="btn-secondary" type="button" onClick={() => setLockModal(false)}>Cancel</button>
              <button className="btn-primary" type="button" disabled={!lockConfirmed} onClick={lockMonth}>Lock Month</button>
            </>
          }
        >
          <div className="space-y-4 text-sm">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="font-bold text-text-primary">After locking:</div>
              <ul className="mt-2 space-y-1 text-text-secondary">
                <li>- Sales Input becomes read-only</li>
                <li>- Purchase Input becomes read-only</li>
                <li>- Dashboard remains accessible</li>
                <li>- Comparison reports remain available</li>
                <li>- Export and print remain available</li>
              </ul>
            </div>
            <p className="font-semibold text-amber-700">This action can only be reversed by authorized users.</p>
            <label className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
              <input className="h-4 w-4 accent-primary" type="checkbox" checked={lockConfirmed} onChange={(event) => setLockConfirmed(event.target.checked)} />
              <span className="font-semibold text-text-primary">I confirm this month is finalized.</span>
            </label>
          </div>
        </Modal>
      ) : null}

      {unlockModal ? (
        <Modal
          title={`Unlock ${monthLabel(filters.month)} ${filters.year}?`}
          description="Unlock requires Owner/Admin permission and an audit reason."
          onClose={() => setUnlockModal(false)}
          footer={
            <>
              <button className="btn-secondary" type="button" onClick={() => setUnlockModal(false)}>Cancel</button>
              <button className="btn-primary" type="button" disabled={!unlockReason.trim()} onClick={unlockMonth}>Unlock Month</button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="text-xs font-semibold text-text-secondary">Reason for unlock</span>
              <textarea
                className="control mt-1 min-h-28 w-full py-3"
                value={unlockReason}
                placeholder="invoice correction, late supplier submission, SST adjustment..."
                onChange={(event) => setUnlockReason(event.target.value)}
              />
            </label>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
