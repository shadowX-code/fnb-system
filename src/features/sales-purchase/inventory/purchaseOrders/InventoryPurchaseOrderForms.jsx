import { useState } from 'react';
import Modal from '../../../../components/feedback/Modal.jsx';
import MetricCard from '../../../../components/ui/MetricCard.jsx';
import Badge from '../../../../components/ui/Badge.jsx';
import EmptyState from '../../../../components/feedback/EmptyState.jsx';
import SelectField from '../../../../components/forms/SelectField.jsx';
import { Field, TextArea, selectInputText, parseNonNegativeNumber } from '../InventorySharedPresentation.jsx';
import { isActiveInventoryItem } from '../inventoryItemModel.js';
import { poProgress, poStatusLabel, poStatusTone as statusTone } from './inventoryPurchaseOrderHelpers.js';
const makeId = prefix => prefix + '_' + crypto.randomUUID();

export function PurchaseSuggestionsModal({ suggestions, suppliers, outlet, existingOrders = [], businessPoNo = (order) => order?.poNo || "PO", saving = false, onClose, onCreateDraftPo, onViewPurchaseOrder }) {
  const [rows, setRows] = useState(suggestions.map((row) => ({
    ...row,
    include: true,
    selectedSupplierId: row.supplierChoices[0]?.id || "",
    suggestedOrderQty: row.shortageQty,
    remark: "",
  })));
  const includedRows = rows.filter((row) => row.include && Number(row.suggestedOrderQty || 0) > 0);
  const validRows = includedRows.filter((row) => row.selectedSupplierId);
  const groupedRows = includedRows.reduce((groups, row) => {
    const key = row.selectedSupplierId || "unassigned";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
    return groups;
  }, new Map());
  const hasExistingOrders = existingOrders.length > 0;

  function updateRow(id, patch) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  return (
    <Modal
      title="Purchase Suggestions"
      description="Review shortage items before creating Draft POs. Stock checks suggest ordering; they do not auto-submit purchase orders."
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
          {hasExistingOrders ? (
            <button className="btn-primary" type="button" onClick={() => onViewPurchaseOrder(existingOrders[0])}>
              View Purchase Order
            </button>
          ) : suggestions.length ? (
            <button className="btn-primary" type="button" disabled={saving || !validRows.length || validRows.length !== includedRows.length} onClick={() => onCreateDraftPo(validRows)}>
              Create Draft PO
            </button>
          ) : null}
        </>
      )}
    >
      <div className="space-y-4">
        {hasExistingOrders ? (
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3">
            <div className="type-title font-bold text-text-primary">Draft PO already created</div>
            <div className="mt-1 type-body-sm text-text-secondary">This stock check already has linked purchase orders. Create Draft PO is disabled to prevent duplicates.</div>
            <div className="mt-3 space-y-2">
              {existingOrders.map((order) => {
                const supplier = suppliers.find((entry) => entry.id === order.supplierId);
                return (
                  <button
                    key={order.id}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-white px-3 py-2 text-left transition hover:border-primary/30 hover:bg-white"
                    type="button"
                    onClick={() => onViewPurchaseOrder(order)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate type-body-sm font-bold text-text-primary" title={`Internal system ID: ${order.poNo}`}>{businessPoNo(order)}</span>
                      <span className="block type-caption text-text-secondary">{supplier?.name || "Supplier"} · {order.lines?.length || 0} item{order.lines?.length === 1 ? "" : "s"}</span>
                    </span>
                    <Badge tone={statusTone(order.status)}>{poStatusLabel(order.status)}</Badge>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {!hasExistingOrders && !suggestions.length ? (
          <EmptyState title="No purchase suggestions found" description="This completed stock check has no shortage items that require Draft PO creation." />
        ) : null}
        {!hasExistingOrders && suggestions.length ? <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Shortage Items" value={suggestions.length} helper={outlet?.name || "Selected outlet"} tone="warning" />
          <MetricCard label="Supplier Groups" value={groupedRows.size} helper="Based on selected suppliers" tone="info" />
          <MetricCard label="Ready for Draft PO" value={validRows.length} helper="Included items with supplier" tone={validRows.length === includedRows.length ? "success" : "warning"} />
        </div> : null}
        {!hasExistingOrders ? [...groupedRows.entries()].map(([supplierId, groupRows]) => {
          const supplier = suppliers.find((entry) => entry.id === supplierId);
          return (
            <div key={supplierId} className="rounded-2xl border border-border bg-white p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="type-title font-bold text-text-primary">{supplier?.name || "Unassigned Supplier"}</div>
                  <div className="type-caption text-text-secondary">{outlet?.name || "Outlet"} · {groupRows.length} item{groupRows.length === 1 ? "" : "s"}</div>
                </div>
                <Badge tone={supplier ? "info" : "warning"}>{supplier ? "Suggested PO" : "Supplier required"}</Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left">
                  <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                    <tr className="border-b border-border">
                      <th className="py-2">Include</th>
                      <th>Item</th>
                      <th>Par</th>
                      <th>Actual</th>
                      <th>Shortage</th>
                      <th>Order Qty</th>
                      <th>Supplier</th>
                      <th>Remark</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-[13px]">
                    {groupRows.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2">
                          <input type="checkbox" checked={row.include} onChange={(event) => updateRow(row.id, { include: event.target.checked })} />
                        </td>
                        <td>
                          <div className="font-bold text-text-primary">{row.itemName}</div>
                          <div className="type-caption text-text-secondary">{row.categoryName} · {row.unit}</div>
                        </td>
                        <td>{row.parLevel}</td>
                        <td>{row.actualCount}</td>
                        <td className="font-bold text-amber-700">{row.shortageQty}</td>
                        <td>
                          <input className="control h-8 w-24 text-[13px]" type="number" min="0" value={row.suggestedOrderQty ?? ""} placeholder="Qty" onFocus={selectInputText} onChange={(event) => updateRow(row.id, { suggestedOrderQty: parseNonNegativeNumber(event.target.value) })} />
                        </td>
                        <td>
                          <SelectField
                            value={row.selectedSupplierId}
                            placeholder="Choose supplier"
                            options={[{ value: "", label: "Choose supplier" }, ...row.supplierChoices.map((supplier) => ({ value: supplier.id, label: supplier.name }))]}
                            onChange={(value) => updateRow(row.id, { selectedSupplierId: value })}
                            searchable
                          />
                        </td>
                        <td>
                          <input className="control h-8 min-w-44 text-[13px]" value={row.remark} onChange={(event) => updateRow(row.id, { remark: event.target.value })} placeholder="Optional" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }) : null}
        {!hasExistingOrders && includedRows.length !== validRows.length ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 type-body-sm font-semibold text-amber-800">
            Choose a supplier for unassigned items before creating Draft POs.
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export function PurchaseOrderEditModal({ order, suppliers, items, onClose, onSave }) {
  const [form, setForm] = useState({
    ...order,
    lines: (order.lines || []).map((line) => ({ ...line })),
  });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(form);
    } catch {
      // Parent owns the error notification; keeping this modal open preserves retry.
    } finally {
      setSaving(false);
    }
  };
  const updateLine = (index, patch) => setForm((current) => ({
    ...current,
    lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
  }));
  const availableItems = items.filter((item) => isActiveInventoryItem(item) && item.linkedOutletIds?.includes(form.outletId || form.outletIds?.[0]));

  return (
    <Modal
      title="Edit Draft PO"
      description="Draft purchase orders can be adjusted before submission."
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={saving || form.status !== "draft" || !form.lines.length} onClick={submit}>{saving ? "Saving…" : "Save Draft PO"}</button>
        </>
      )}
    >
      <div className="space-y-4">
        {form.status !== "draft" ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 type-body-sm font-semibold text-amber-800">
            This PO has already been submitted. Create an adjustment or cancel if needed.
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Supplier" value={form.supplierId} options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} onChange={(value) => setForm((current) => ({ ...current, supplierId: value }))} searchable disabled={form.status !== "draft"} />
        </div>
        <div className="space-y-2">
          {form.lines.map((line, index) => {
            const item = items.find((entry) => entry.id === line.itemId);
            return (
              <div key={line.id || `${line.itemId}-${index}`} className="grid gap-2 rounded-2xl border border-border p-3 md:grid-cols-[1.4fr_120px_1fr_auto] md:items-end">
                <SelectField label="Item" value={line.itemId} options={availableItems.map((entry) => ({ value: entry.id, label: entry.name }))} onChange={(value) => {
                  const nextItem = items.find((entry) => entry.id === value);
                  updateLine(index, { itemId: value, unit: nextItem?.unit || line.unit });
                }} searchable disabled={form.status !== "draft"} />
                <Field label="Order Qty" type="number" value={line.requestedQty} placeholder="Enter quantity" onChange={(value) => updateLine(index, { requestedQty: parseNonNegativeNumber(value) })} />
                <Field label="Remark" value={line.remark || ""} onChange={(value) => updateLine(index, { remark: value })} />
                <button className="btn-secondary h-9 px-2.5 text-xs" type="button" disabled={form.status !== "draft"} onClick={() => setForm((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }))}>Remove</button>
                <div className="type-caption text-text-secondary md:col-span-4">Unit: <span className="font-bold text-text-primary">{line.unit || item?.unit || "-"}</span></div>
              </div>
            );
          })}
        </div>
        <button className="btn-secondary" type="button" disabled={form.status !== "draft"} onClick={() => setForm((current) => ({ ...current, lines: [...current.lines, { id: makeId("po_item"), itemId: availableItems[0]?.id || "", requestedQty: 1, receivedQty: 0, unit: availableItems[0]?.unit || "", remark: "" }] }))}>Add Item</button>
      </div>
    </Modal>
  );
}


export function CancelPurchaseOrderModal({ order, displayPoNo, onClose, onCancel }) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      title="Cancel Purchase Order"
      description={`${displayPoNo || order.poNo} will be preserved for audit history.`}
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Keep PO</button>
          <button className="btn-danger" type="button" disabled={!reason.trim()} onClick={() => onCancel(reason)}>Cancel PO</button>
        </>
      )}
    >
      <TextArea label="Cancellation Reason" value={reason} onChange={setReason} required />
    </Modal>
  );
}

export function CompletePurchaseOrderModal({ order, onClose, onComplete }) {
  const [reason, setReason] = useState("");
  const progress = poProgress(order);
  const remaining = Math.max(0, progress.ordered - progress.received);
  const isPartial = remaining > 0;
  const reasonRequired = isPartial;

  return (
    <Modal
      title="Complete Purchase Order?"
      description={isPartial ? "This PO has not been fully received." : "All ordered quantities have been received."}
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={reasonRequired && !reason.trim()} onClick={() => onComplete(reason)}>
            Complete PO
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Ordered Qty" value={progress.ordered} helper="Original PO quantity" />
          <MetricCard label="Received Qty" value={progress.received} helper="Confirmed into inventory" tone={progress.received ? "success" : "neutral"} />
          <MetricCard label="Remaining Qty" value={remaining} helper={isPartial ? "Will be unfulfilled" : "None"} tone={isPartial ? "warning" : "success"} />
        </div>
        {isPartial ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 type-body-sm font-semibold text-amber-800">
            The remaining quantity will be marked as unfulfilled. This PO will be closed and no further receiving can be recorded.
          </div>
        ) : (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 type-body-sm font-semibold text-emerald-800">
            This PO will be closed as fully fulfilled.
          </div>
        )}
        <TextArea
          label={isPartial ? "Completion Reason" : "Completion Note"}
          value={reason}
          onChange={setReason}
          required={reasonRequired}
          placeholder={isPartial ? "Supplier cannot fulfill remaining quantity." : "Optional note"}
        />
      </div>
    </Modal>
  );
}
