import { useRef, useState } from "react";
import { Copy } from "lucide-react";
import Modal from "../../../../components/feedback/Modal.jsx";
import MetricCard from "../../../../components/ui/MetricCard.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import { selectInputText, parseNonNegativeNumber, TextArea, focusIndexedInput } from "../InventorySharedPresentation.jsx";
import { orderedQty, remainingQty, poStatusLabel } from "./inventoryPurchaseOrderHelpers.js";

export function ReceiveInventoryModal({ order, supplier, outlet, items, displayPoNo, onClose, onReceive }) {
  const [remark, setRemark] = useState("");
  const [rows, setRows] = useState((order.lines || []).map((line) => ({ ...line, receiveNowQty: "", receiveRemark: "" })));
  const [saving, setSaving] = useState(false);
  const receiveGridRef = useRef(null);
  const receivable = rows.filter((row) => remainingQty(row) > 0);
  const hasValidQty = rows.some((row) => Number(row.receiveNowQty || 0) > 0);
  const invalid = rows.some((row) => Number(row.receiveNowQty || 0) < 0 || Number(row.receiveNowQty || 0) > remainingQty(row));
  const totalOrdered = orderedQty({ lines: rows });
  const totalReceivingNow = rows.reduce((sum, row) => sum + Number(row.receiveNowQty || 0), 0);
  const totalRemainingBeforeReceive = rows.reduce((sum, row) => sum + remainingQty(row), 0);
  const receivingStatus = totalReceivingNow > 0 && totalReceivingNow >= totalRemainingBeforeReceive ? "Full Receive" : "Partial Receive";
  const updateRow = (id, patch) => setRows((current) => current.map((row) => (row.id || row.itemId) === id ? { ...row, ...patch } : row));
  const fillRemaining = () => setRows((current) => current.map((row) => ({ ...row, receiveNowQty: remainingQty(row) > 0 ? remainingQty(row) : "" })));
  const submitReceive = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onReceive(rows, remark);
    } catch {
      // Parent owns the error notification; keeping this modal open preserves retry.
    } finally {
      setSaving(false);
    }
  };

  function handleReceiveKeyDown(event, rowIndex) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    focusIndexedInput(receiveGridRef, rowIndex, event.shiftKey ? "previous" : "next");
  }

  return (
    <Modal
      title="Receive Inventory"
      description={`${displayPoNo || order.poNo} · ${supplier?.name || "Supplier"} · ${outlet?.name || "Outlet"} · ${poStatusLabel(order.status)}`}
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={saving || !hasValidQty || invalid || ["cancelled", "completed"].includes(order.status)} onClick={submitReceive}>{saving ? "Receiving…" : "Confirm Receive"}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-primary/15 bg-primary/5 p-3">
          <div>
            <div className="type-body-sm font-black text-text-primary">Receiving entry</div>
            <div className="type-caption text-text-secondary">Fill quantities from delivery order or invoice. Attachments can be added in a future receiving step.</div>
          </div>
          <button className="btn-secondary h-8 px-3 text-xs" type="button" disabled={!receivable.length} onClick={fillRemaining}>Fill Remaining</button>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-border" ref={receiveGridRef}>
          <table className="w-full min-w-[860px] text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th>Ordered</th>
                <th>Previously Received</th>
                <th>Remaining</th>
                <th>Receive Now</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Unit</th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-[13px]">
              {rows.map((row, rowIndex) => {
                const item = items.find((entry) => entry.id === row.itemId);
                const remaining = remainingQty(row);
                const receiveNow = Number(row.receiveNowQty || 0);
                const balance = Math.max(0, remaining - receiveNow);
                const rowStatus = receiveNow > 0 && balance === 0 ? "Full Receive" : receiveNow > 0 ? "Partial Receive" : "Pending";
                return (
                  <tr key={row.id || row.itemId}>
                    <td className="px-3 py-2 font-bold text-text-primary">{item?.name || "Inventory item"}</td>
                    <td>{row.requestedQty}</td>
                    <td>{row.receivedQty || 0}</td>
                    <td>{remaining}</td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <input
                          className="[appearance:textfield] control h-8 w-24 text-[13px] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max={remaining}
                          disabled={remaining <= 0}
                          value={row.receiveNowQty ?? ""}
                          placeholder="Qty"
                          data-entry-index={rowIndex}
                          onFocus={selectInputText}
                          onKeyDown={(event) => handleReceiveKeyDown(event, rowIndex)}
                          onChange={(event) => updateRow(row.id || row.itemId, { receiveNowQty: parseNonNegativeNumber(event.target.value) })}
                        />
                        <button className="btn-secondary h-8 px-2 text-xs" type="button" disabled={remaining <= 0} onClick={() => updateRow(row.id || row.itemId, { receiveNowQty: remaining })}>Fill</button>
                      </div>
                    </td>
                    <td className={balance > 0 && receiveNow > 0 ? "font-bold text-amber-700" : "font-semibold text-text-secondary"}>{balance}</td>
                    <td><Badge tone={rowStatus === "Full Receive" ? "success" : rowStatus === "Partial Receive" ? "warning" : "neutral"}>{rowStatus}</Badge></td>
                    <td>{row.unit || item?.unit || ""}</td>
                    <td><input className="control h-8 min-w-40 text-[13px]" value={row.receiveRemark} onChange={(event) => updateRow(row.id || row.itemId, { receiveRemark: event.target.value })} placeholder="Optional" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!receivable.length ? <EmptyState title="No remaining quantity to receive." description="This PO has already been fully received." /> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Total Ordered" value={totalOrdered} helper="Original PO quantity" size="compact" />
          <MetricCard label="Receiving Now" value={totalReceivingNow} helper="Quantity entered now" tone={totalReceivingNow ? "info" : "neutral"} size="compact" />
          <MetricCard label="Receiving Status" value={hasValidQty ? receivingStatus : "Not Started"} helper="Based on entered quantities" tone={receivingStatus === "Full Receive" && hasValidQty ? "success" : hasValidQty ? "warning" : "neutral"} size="compact" />
        </div>
        <TextArea label="Receipt Remark" value={remark} onChange={setRemark} />
      </div>
    </Modal>
  );
}

export function CopyPoTextModal({ text, onClose, onCopy }) {
  return (
    <Modal
      title="Copy PO Text"
      description="Clipboard access was blocked. Copy the supplier message manually."
      size="lg"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
          <button className="btn-primary" type="button" onClick={() => onCopy(text)}><Copy size={15} /> Copy</button>
        </>
      )}
    >
      <textarea
        className="control min-h-[360px] w-full whitespace-pre-wrap font-mono text-[12px]"
        readOnly
        value={text}
        onFocus={(event) => event.target.select()}
      />
    </Modal>
  );
}
