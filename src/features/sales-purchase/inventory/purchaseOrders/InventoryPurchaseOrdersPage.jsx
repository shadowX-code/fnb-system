import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import DashboardSection from "../../../../components/layout/DashboardSection.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import DatePickerField from "../../../../components/forms/DatePickerField.jsx";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import { poProgress, poSourceLabel, poStatusLabel } from "./inventoryPurchaseOrderHelpers.js";
import InventoryPurchaseOrderDetail from "./InventoryPurchaseOrderDetail.jsx";
import FactoryPagination, { useFactoryClientPagination } from "../../../factory/components/FactoryPagination.jsx";

const statuses = ["draft", "submitted", "supplier_confirmed", "partial_received", "fully_received", "completed", "cancelled"];
const sources = ["stock_check", "manual"];

export default function InventoryPurchaseOrdersPage({
  orders,
  items,
  suppliers,
  outletOptions,
  outletById,
  getBusinessPoNo,
  formatDate,
  todayInput,
  statusTone,
  onRequestEdit,
  onSubmit,
  onConfirm,
  onRequestReceive,
  onComplete,
  onCancel,
  onView,
  onCopyPurchaseOrder,
  onFiltersChange,
}) {
  const [filters, setFilters] = useState({ outletId: "all", supplierId: "all", status: "all", source: "all", search: "", from: "", to: "" });
  useEffect(() => { onFiltersChange?.(filters); }, [filters, onFiltersChange]);
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const filtered = orders.filter((order) => {
    const outletId = order.outletId || order.outletIds?.[0] || "";
    const supplier = suppliers.find((entry) => entry.id === order.supplierId);
    const created = (order.createdAt || order.submittedAt || "").slice(0, 10);
    const search = [getBusinessPoNo(order), order.poNo, supplier?.name, ...(order.lines || []).map((line) => items.find((item) => item.id === line.itemId)?.name)].join(" ").toLowerCase();
    return (filters.outletId === "all" || outletId === filters.outletId)
      && (filters.supplierId === "all" || order.supplierId === filters.supplierId)
      && (filters.status === "all" || order.status === filters.status)
      && (filters.source === "all" || (order.sourceType || "manual") === filters.source)
      && (!filters.search.trim() || search.includes(filters.search.trim().toLowerCase()))
      && (!filters.from || !created || created >= filters.from)
      && (!filters.to || !created || created <= filters.to);
  });
  const pagination = useFactoryClientPagination("restaurant.purchase-orders", filtered.length, 20, Object.values(filters).join("|"));
  const paginatedOrders = filtered.slice(pagination.from, pagination.to);
  const desktopPrimary = (order) => order.status === "draft" ? ["Submit Order", "primary", onSubmit]
    : ["submitted", "supplier_confirmed"].includes(order.status) ? ["Receive", "primary", onRequestReceive]
      : order.status === "partial_received" ? ["Receive More", "primary", onRequestReceive]
        : order.status === "fully_received" ? ["Complete PO", "primary", onComplete]
          : ["View", "secondary", onView];
  const desktopActions = (order) => {
    const [label, tone, callback] = desktopPrimary(order);
    const progress = poProgress(order);
    const canCancel = ["draft", "submitted", "supplier_confirmed"].includes(order.status) && progress.received <= 0;
    return <>
      <button className={tone === "primary" ? "btn-primary h-8 px-2.5 text-xs" : "btn-secondary h-8 px-2.5 text-xs"} type="button" onClick={() => callback(order)}>{label}</button>
      {label !== "View" ? <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => onView(order)}>View</button> : null}
      <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => onCopyPurchaseOrder(order)}><Copy size={13} /> Copy Text</button>
      {order.status === "draft" ? <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => onRequestEdit(order)}>Edit</button> : null}
      {order.status === "submitted" ? <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => onConfirm(order)}>Mark Confirmed</button> : null}
      {order.status === "partial_received" ? <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => onComplete(order)}>Complete PO</button> : null}
      {canCancel ? <button className="btn-secondary h-8 px-2.5 text-xs text-rose-700" type="button" onClick={() => onCancel(order)}>Cancel</button> : null}
    </>;
  };
  const mobilePrimaryAction = (order) => order.status === "draft" ? { label: "Submit Order", tone: "primary", action: () => onSubmit(order) }
    : order.status === "submitted" ? { label: "Mark Confirmed", tone: "primary", action: () => onConfirm(order) }
      : order.status === "supplier_confirmed" ? { label: "Receive", tone: "primary", action: () => onRequestReceive(order) }
        : order.status === "partial_received" ? { label: "Receive More", tone: "primary", action: () => onRequestReceive(order) }
          : order.status === "fully_received" ? { label: "Complete PO", tone: "primary", action: () => onComplete(order) }
            : { label: "View", tone: "secondary", action: () => onView(order) };

  return <DashboardSection title="Purchase Orders" subtitle="Draft POs are created from reviewed stock check suggestions or manual purchase planning.">
    <div className="mb-4 grid gap-3 lg:grid-cols-6">
      <SelectField label="Outlet" value={filters.outletId} options={outletOptions} onChange={(value) => update("outletId", value)} searchable />
      <SelectField label="Supplier" value={filters.supplierId} options={[{ value: "all", label: "All Suppliers" }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))]} onChange={(value) => update("supplierId", value)} searchable />
      <SelectField label="Status" value={filters.status} options={[{ value: "all", label: "All Status" }, ...statuses.map((status) => ({ value: status, label: poStatusLabel(status) }))]} onChange={(value) => update("status", value)} />
      <SelectField label="Source" value={filters.source} options={[{ value: "all", label: "All Sources" }, ...sources.map((source) => ({ value: source, label: poSourceLabel(source) }))]} onChange={(value) => update("source", value)} />
      <DatePickerField label="From" value={filters.from} onChange={(value) => update("from", value)} />
      <DatePickerField label="To" value={filters.to} onChange={(value) => update("to", value)} />
      <label className="lg:col-span-6"><div className="mb-1 type-caption font-semibold text-text-secondary">Search Business PO / Supplier / Item</div><input className="control h-9 w-full text-[13px]" value={filters.search} onChange={(event) => update("search", event.target.value)} placeholder="Search business PO no, internal ID, supplier or item" /></label>
    </div>
    {filtered.length ? <>
      <div className="space-y-3 md:hidden">
        {paginatedOrders.map((order) => {
          const supplier = suppliers.find((entry) => entry.id === order.supplierId);
          const outlet = outletById.get(order.outletId || order.outletIds?.[0]);
          const progress = poProgress(order);
          const action = mobilePrimaryAction(order);
          const canCancel = ["draft", "submitted", "supplier_confirmed"].includes(order.status) && progress.received <= 0;
          return <div key={order.id} className="rounded-2xl border border-border bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="truncate font-mono text-sm font-black text-text-primary" title={`Internal system ID: ${order.poNo}`}>{getBusinessPoNo(order)}</div><div className="mt-1 type-caption text-text-secondary">Internal ID: {order.poNo}</div></div>
              <Badge tone={statusTone(order.status)}>{poStatusLabel(order.status)}</Badge>
            </div>
            <div className="mt-4 grid gap-3 text-sm">
              <div><div className="type-caption font-semibold text-text-muted">Supplier</div><div className="mt-0.5 font-bold text-text-primary">{supplier?.name ?? "Unassigned Supplier"}</div></div>
              <div className="grid grid-cols-2 gap-3"><div><div className="type-caption font-semibold text-text-muted">Outlet</div><div className="mt-0.5 font-semibold text-text-primary">{outlet?.name ?? "Outlet"}</div></div><div><div className="type-caption font-semibold text-text-muted">Source</div><div className="mt-0.5 font-semibold text-text-primary">{poSourceLabel(order.sourceType)}</div></div></div>
              <div><div className="type-caption font-semibold text-text-muted">Created Date</div><div className="mt-0.5 font-semibold text-text-primary">{formatDate(order.createdAt || order.submittedAt || todayInput())}</div></div>
            </div>
            <div className="mt-4 rounded-xl border border-border bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3"><div><div className="type-caption font-semibold text-text-muted">Items received</div><div className="mt-1 text-lg font-black text-text-primary">{progress.received} / {progress.ordered}</div></div><div className="text-right type-caption font-bold text-text-secondary">{Math.min(progress.percent, 100).toFixed(0)}%</div></div>
              <div className="mt-2 h-2 rounded-full bg-white"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(progress.percent, 100)}%` }} /></div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <button className={action.tone === "primary" ? "btn-primary w-full justify-center" : "btn-secondary w-full justify-center"} type="button" onClick={action.action}>{action.label}</button>
              <div className="grid grid-cols-2 gap-2">
                {action.label !== "View" ? <button className="btn-secondary min-w-0 justify-center px-2 text-xs" type="button" onClick={() => onView(order)}>View</button> : null}
                <button className="btn-secondary min-w-0 justify-center px-2 text-xs" type="button" onClick={() => onCopyPurchaseOrder(order)}><Copy size={13} /> Copy Text</button>
                {order.status === "draft" ? <button className="btn-secondary min-w-0 justify-center px-2 text-xs" type="button" onClick={() => onRequestEdit(order)}>Edit</button> : null}
                {canCancel ? <button className="btn-secondary min-w-0 justify-center px-2 text-xs text-rose-700" type="button" onClick={() => onCancel(order)}>Cancel</button> : null}
              </div>
            </div>
          </div>;
        })}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1040px] text-left">
          <thead className="text-[11px] uppercase tracking-wide text-text-muted">
            <tr className="border-b border-border">
              <th className="py-2">Business PO No.</th><th>Supplier</th><th>Outlet</th><th>Items</th><th>Received Progress</th><th>Status</th><th>Source</th><th>Created Date</th><th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-[13px]">
            {paginatedOrders.map((order) => {
              const supplier = suppliers.find((entry) => entry.id === order.supplierId);
              const outlet = outletById.get(order.outletId || order.outletIds?.[0]);
              const progress = poProgress(order);
              return <tr key={order.id} className="transition hover:bg-primary/5">
                <td className="py-3 font-mono text-xs font-bold text-text-primary" title={`Internal system ID: ${order.poNo}`}>{getBusinessPoNo(order)}</td>
                <td className="font-semibold text-text-primary">{supplier?.name ?? "Unassigned Supplier"}</td>
                <td>{outlet?.name ?? "Outlet"}</td>
                <td>{order.lines.length}</td>
                <td><div className="font-semibold text-text-primary">{progress.received} / {progress.ordered}</div><div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(progress.percent, 100)}%` }} /></div></td>
                <td><Badge tone={statusTone(order.status)}>{poStatusLabel(order.status)}</Badge></td>
                <td>{poSourceLabel(order.sourceType)}</td>
                <td>{formatDate(order.createdAt || order.submittedAt || todayInput())}</td>
                <td><div className="flex justify-end gap-2">{desktopActions(order)}</div></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <FactoryPagination page={pagination.page} pageSize={pagination.pageSize} total={filtered.length} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} />
    </> : <EmptyState title="No purchase orders found." description="Adjust filters or create Draft POs from scheduled stock check suggestions or manual purchase planning." />}
  </DashboardSection>;
}

export { InventoryPurchaseOrderDetail };
