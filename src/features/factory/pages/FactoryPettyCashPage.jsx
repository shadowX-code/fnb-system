import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, FileText, Landmark, Plus, RefreshCw, Settings2, Undo2 } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import { factoryService } from "../../../services/factoryService.js";
import FactoryFilterBar from "../components/FactoryFilterBar.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryMasterDataManagerModal from "../components/FactoryMasterDataManagerModal.jsx";
import FactoryPagination from "../components/FactoryPagination.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import FactorySummaryCard from "../components/FactorySummaryCard.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { FactoryCellDateTime, FactoryCellMuted, FactoryCellSemanticText, FactoryCellText } from "../components/FactoryTableCell.jsx";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import { formatDateDisplay, formatFactoryListTime, malaysiaBusinessDateInput } from "../utils/factoryDates.js";
import { money } from "../utils/factoryFormatters.js";

const emptyFilters = { dateFrom: "", dateTo: "", type: "", category: "", search: "" };
const typeOptions = [
  { value: "", label: "All" },
  { value: "cash_in", label: "Cash In" },
  { value: "expense", label: "Expense" },
  { value: "adjustment", label: "Adjustment" },
];
const typeLabels = { cash_in: "Cash In", expense: "Expense", adjustment: "Adjustment" };

function transactionDraft(value) {
  return {
    id: value?.id || "",
    reference_no: value?.reference_no || "",
    transaction_type: value?.transaction_type || "expense",
    adjustment_direction: value?.adjustment_direction || "increase",
    amount: value?.amount ?? "",
    category_id: value?.category_id || "",
    transaction_date: value?.transaction_date || malaysiaBusinessDateInput(),
    description: value?.description || "",
    party_name: value?.party_name || "",
    adjustment_reason: value?.adjustment_reason || "",
    notes: value?.notes || "",
    receipt_path: value?.receipt_path || "",
    receipt_filename: value?.receipt_filename || "",
    receipt_mime_type: value?.receipt_mime_type || "",
    receipt_size_bytes: value?.receipt_size_bytes || null,
  };
}

function typeTone(type) {
  if (type === "cash_in") return "green";
  if (type === "expense") return "red";
  return "amber";
}

export function PettyCashTransactionModal({ initialValue, categories, canAdjust, onClose, onSave }) {
  const [form, setForm] = useState(() => transactionDraft(initialValue));
  const [receiptFile, setReceiptFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const activeCategories = categories.filter((category) => category.status === "active" || category.id === form.category_id);
  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!form.description.trim()) return setError("Description is required.");
    if (!(Number(form.amount) > 0)) return setError("Amount must be greater than zero.");
    if (form.transaction_type === "expense" && !form.category_id) return setError("Category is required for an Expense.");
    if (form.transaction_type === "adjustment" && !form.adjustment_reason.trim()) return setError("Adjustment reason is required.");
    setSaving(true);
    try {
      let receipt = {};
      if (receiptFile) {
        setUploading(true);
        receipt = await factoryService.uploadPettyCashReceipt(receiptFile);
        setUploading(false);
      }
      await onSave({ ...form, ...receipt, amount: Number(form.amount) });
      onClose();
    } catch (cause) {
      setUploading(false);
      setError(cause.message || "Unable to save Petty Cash draft.");
    } finally {
      setSaving(false);
    }
  }
  return <Modal
    title={form.id ? `Edit ${form.reference_no}` : "New Petty Cash Transaction"}
    description="Drafts do not change the cash balance until posted."
    size="lg"
    onClose={saving ? undefined : onClose}
    footer={<><button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" form="petty-cash-transaction-form" type="submit" disabled={saving}>{uploading ? "Uploading receipt…" : saving ? "Saving…" : "Save Draft"}</button></>}
  >
    <form id="petty-cash-transaction-form" className="space-y-4" onSubmit={submit}>
      {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</div> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Type *"><SearchableSelect value={form.transaction_type} options={typeOptions.filter((option) => option.value && (option.value !== "adjustment" || canAdjust))} onChange={(transaction_type) => setForm((current) => ({ ...current, transaction_type, category_id: transaction_type === "expense" ? current.category_id : "", adjustment_reason: transaction_type === "adjustment" ? current.adjustment_reason : "" }))} /></Field>
        <Field label="Amount (RM) *"><input className={inputClass()} type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} /></Field>
        {form.transaction_type === "adjustment" ? <Field label="Adjustment Direction *"><SearchableSelect value={form.adjustment_direction} options={[{ value: "increase", label: "Increase cash" }, { value: "decrease", label: "Decrease cash" }]} onChange={(adjustment_direction) => setForm((current) => ({ ...current, adjustment_direction }))} /></Field> : null}
        {form.transaction_type === "expense" ? <Field label="Expense Category *"><SearchableSelect value={form.category_id} options={activeCategories.map((category) => ({ value: category.id, label: category.name }))} placeholder="Select category" onChange={(category_id) => setForm((current) => ({ ...current, category_id }))} /></Field> : null}
        <Field label="Transaction Date *"><FeedXDatePicker required value={form.transaction_date} onChange={(transaction_date) => setForm((current) => ({ ...current, transaction_date }))} /></Field>
        <Field label={form.transaction_type === "cash_in" ? "Received From" : "Paid To / Received From"}><input className={inputClass()} value={form.party_name} onChange={(event) => setForm((current) => ({ ...current, party_name: event.target.value }))} /></Field>
      </div>
      <Field label="Description *"><input className={inputClass()} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></Field>
      {form.transaction_type === "adjustment" ? <Field label="Adjustment Reason *"><textarea className={`${inputClass()} min-h-20`} value={form.adjustment_reason} onChange={(event) => setForm((current) => ({ ...current, adjustment_reason: event.target.value }))} /></Field> : null}
      <Field label="Receipt attachment" helper="Optional JPG, PNG, WebP or PDF up to 10MB.">
        <div className="flex min-h-10 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2">
          <FileText className="shrink-0 text-text-muted" size={16} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-secondary">{receiptFile?.name || form.receipt_filename || "No receipt attached"}</span>
          <label className="btn-secondary h-8 cursor-pointer px-3 text-xs">{receiptFile || form.receipt_path ? "Replace" : "Upload"}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={saving} onChange={(event) => setReceiptFile(event.target.files?.[0] || null)} /></label>
          {receiptFile || form.receipt_path ? <button className="text-xs font-semibold text-rose-600" type="button" onClick={() => { setReceiptFile(null); setForm((current) => ({ ...current, receipt_path: "", receipt_filename: "", receipt_mime_type: "", receipt_size_bytes: null })); }}>Remove</button> : null}
        </div>
      </Field>
      <Field label="Notes"><textarea className={`${inputClass()} min-h-20`} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></Field>
    </form>
  </Modal>;
}

export function PettyCashCategoryModal({ categories, onClose, onSave }) {
  const empty = { name: "", code: "", description: "", status: "active" };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault(); setError(""); setSaving(true);
    try { await onSave(form); setForm(empty); } catch (cause) { setError(cause.message || "Unable to save category."); } finally { setSaving(false); }
  }
  const columns = [
    { key: "name", label: "Category", render: (row) => <FactoryCellText primary={row.name} secondary={row.description || row.code} /> },
    { key: "status", label: "Status", render: (row) => <FactoryStatusBadge status={row.status === "active" ? "Active" : "Inactive"} /> },
    { key: "actions", label: "Actions", align: "right", render: (row) => <FactoryRowActions directSingleSecondary secondaryActions={[{ label: "Edit", onClick: () => setForm({ id: row.id, name: row.name, code: row.code, description: row.description || "", status: row.status }) }]} /> },
  ];
  return <FactoryMasterDataManagerModal title="Petty Cash Categories" description="Inactive categories remain visible on historical expenses." editorTitle={form.id ? "Edit category" : "Create category"} editorDescription="Categories classify Expense transactions only." columns={columns} rows={categories} emptyTitle="No categories" onClose={onClose} saving={saving} editor={<form className="space-y-3" onSubmit={submit}>{error ? <div role="alert" className="text-sm font-medium text-rose-600">{error}</div> : null}<div className="grid gap-3 md:grid-cols-[1fr_1fr_150px]"><Field label="Category *"><input className={inputClass()} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field><Field label="Description"><input className={inputClass()} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></Field><Field label="Status"><SearchableSelect value={form.status} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} onChange={(status) => setForm((current) => ({ ...current, status }))} /></Field></div><div className="flex gap-2"><button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : form.id ? "Save Changes" : "Create Category"}</button>{form.id ? <button className="btn-secondary" type="button" onClick={() => setForm(empty)}>Cancel</button> : null}</div></form>} />;
}

function PettyCashDetailModal({ transaction, canReverse, onReceipt, onReverse, onClose }) {
  return <Modal title={transaction.reference_no} description="Petty Cash transaction detail" size="md" onClose={onClose} footer={<><button className="btn-secondary" type="button" onClick={onClose}>Close</button>{canReverse && transaction.status === "posted" && !transaction.reversal_of_id && !transaction.reversed_by_id ? <button className="btn-secondary" type="button" onClick={() => onReverse(transaction)}><Undo2 size={15} /> Reverse</button> : null}</>}><dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-xs font-semibold text-text-muted">Type</dt><dd className="mt-1 font-semibold text-text-primary">{typeLabels[transaction.transaction_type]}</dd></div><div><dt className="text-xs font-semibold text-text-muted">Amount</dt><dd className="mt-1 font-semibold text-text-primary">{money(transaction.amount)}</dd></div><div><dt className="text-xs font-semibold text-text-muted">Date</dt><dd className="mt-1 text-text-primary">{formatDateDisplay(transaction.transaction_date)}</dd></div><div><dt className="text-xs font-semibold text-text-muted">Status</dt><dd className="mt-1"><FactoryStatusBadge status={transaction.reversed_by_id ? "Reversed" : transaction.status === "posted" ? "Posted" : "Draft"} /></dd></div><div className="sm:col-span-2"><dt className="text-xs font-semibold text-text-muted">Description</dt><dd className="mt-1 text-text-primary">{transaction.description}</dd></div>{transaction.adjustment_reason ? <div className="sm:col-span-2"><dt className="text-xs font-semibold text-text-muted">Reason</dt><dd className="mt-1 text-text-primary">{transaction.adjustment_reason}</dd></div> : null}<div><dt className="text-xs font-semibold text-text-muted">Category</dt><dd className="mt-1 text-text-primary">{transaction.category_name || "—"}</dd></div><div><dt className="text-xs font-semibold text-text-muted">Paid To / Received From</dt><dd className="mt-1 text-text-primary">{transaction.party_name || "—"}</dd></div><div><dt className="text-xs font-semibold text-text-muted">By</dt><dd className="mt-1 text-text-primary">{transaction.posted_by_name || transaction.created_by_name}</dd></div><div><dt className="text-xs font-semibold text-text-muted">Receipt</dt><dd className="mt-1">{transaction.receipt_path ? <button className="text-sm font-semibold text-primary hover:underline" type="button" onClick={() => onReceipt(transaction)}>Open receipt</button> : "Missing"}</dd></div>{transaction.reversal_of_reference || transaction.reversed_by_reference ? <div className="sm:col-span-2"><dt className="text-xs font-semibold text-text-muted">Correction link</dt><dd className="mt-1 text-text-primary">{transaction.reversal_of_reference ? `Reversal of ${transaction.reversal_of_reference}` : `Reversed by ${transaction.reversed_by_reference}`}</dd></div> : null}</dl></Modal>;
}

function ReverseModal({ transaction, onClose, onSave }) {
  const [reason, setReason] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit(event) { event.preventDefault(); if (!reason.trim()) return setError("Reversal reason is required."); setSaving(true); try { await onSave(transaction.id, reason); onClose(); } catch (cause) { setError(cause.message || "Unable to reverse transaction."); } finally { setSaving(false); } }
  return <Modal title={`Reverse ${transaction.reference_no}?`} description="A linked posted Adjustment will offset this transaction. The original remains unchanged." onClose={saving ? undefined : onClose} footer={<><button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" form="petty-cash-reverse-form" type="submit" disabled={saving}>{saving ? "Reversing…" : "Post Reversal"}</button></>}><form id="petty-cash-reverse-form" onSubmit={submit}><Field label="Reason *" error={error}><textarea autoFocus className={`${inputClass(Boolean(error))} min-h-24`} value={reason} onChange={(event) => setReason(event.target.value)} /></Field></form></Modal>;
}

export default function FactoryPettyCashPage({ onNotify, onConfirm }) {
  const { can } = useFactoryPermissions();
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState({ rows: [], categories: [], summary: {}, total_count: 0 });
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [modal, setModal] = useState(null); const requestRef = useRef(0);
  const signature = JSON.stringify(filters);
  const load = useCallback(async () => {
    const request = ++requestRef.current; setLoading(true); setError("");
    try { const result = await factoryService.getPettyCashData({ page, pageSize, filters }); if (request === requestRef.current) setData(result); }
    catch (cause) { if (request === requestRef.current) setError(cause.message || "Unable to load Petty Cash."); }
    finally { if (request === requestRef.current) setLoading(false); }
  }, [filters, page, pageSize]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [signature]);
  const notify = (title, message, tone = "success") => onNotify?.({ title, message, tone });
  async function saveDraft(form) { await factoryService.savePettyCashDraft(form); notify("Draft saved", "Inventory and cash balance remain unchanged until posting."); await load(); }
  async function post(row) { const confirmed = await (onConfirm?.({ title: `Post ${row.reference_no}?`, message: "Posting makes this transaction immutable and updates the derived cash balance.", confirmLabel: "Post Transaction", tone: "warning" }) ?? Promise.resolve(window.confirm(`Post ${row.reference_no}?`))); if (!confirmed) return; try { await factoryService.postPettyCashTransaction(row.id); notify("Transaction posted", `${row.reference_no} is now part of the cash ledger.`); await load(); } catch (cause) { notify("Unable to post", cause.message, "error"); } }
  async function remove(row) { const confirmed = await (onConfirm?.({ title: `Delete ${row.reference_no}?`, message: "This Draft will be permanently deleted.", confirmLabel: "Delete Draft", tone: "danger" }) ?? Promise.resolve(window.confirm(`Delete ${row.reference_no}?`))); if (!confirmed) return; try { await factoryService.deletePettyCashDraft(row.id); notify("Draft deleted", row.reference_no); await load(); } catch (cause) { notify("Unable to delete", cause.message, "error"); } }
  async function reverse(id, reason) { await factoryService.reversePettyCashTransaction(id, reason); notify("Reversal posted", "A linked Adjustment now offsets the original transaction."); await load(); }
  async function saveCategory(category) { await factoryService.savePettyCashCategory(category); await load(); }
  async function openReceipt(row) { try { const url = await factoryService.getPettyCashReceiptUrl(row.receipt_path); window.open(url, "_blank", "noopener,noreferrer"); } catch (cause) { notify("Receipt unavailable", cause.message, "error"); } }
  const activeFilters = useMemo(() => [filters.dateFrom || filters.dateTo ? { key: "date", label: "Date", value: `${filters.dateFrom ? formatDateDisplay(filters.dateFrom) : "Any"} – ${filters.dateTo ? formatDateDisplay(filters.dateTo) : "Any"}`, onRemove: () => setFilters((current) => ({ ...current, dateFrom: "", dateTo: "" })) } : null, filters.type ? { key: "type", label: "Type", value: typeLabels[filters.type], onRemove: () => setFilters((current) => ({ ...current, type: "" })) } : null, filters.category ? { key: "category", label: "Category", value: data.categories.find((item) => item.id === filters.category)?.name || "Selected", onRemove: () => setFilters((current) => ({ ...current, category: "" })) } : null, filters.search ? { key: "search", label: "Search", value: filters.search, onRemove: () => setFilters((current) => ({ ...current, search: "" })) } : null].filter(Boolean), [data.categories, filters]);
  const columns = [
    { key: "date", label: "Date", render: (row) => <FactoryCellDateTime date={formatDateDisplay(row.transaction_date)} time={row.status === "posted" ? formatFactoryListTime(row.posted_at) : "Draft"} /> },
    { key: "reference", label: "Reference", render: (row) => <FactoryCellText primary={row.reference_no} secondary={row.reversal_of_reference ? `Reversal of ${row.reversal_of_reference}` : row.reversed_by_reference ? `Reversed by ${row.reversed_by_reference}` : ""} /> },
    { key: "type", label: "Type", render: (row) => <FactoryCellSemanticText tone={typeTone(row.transaction_type)}>{typeLabels[row.transaction_type]}</FactoryCellSemanticText> },
    { key: "category", label: "Category", render: (row) => row.category_name || <FactoryCellMuted /> },
    { key: "description", label: "Description", render: (row) => <FactoryCellText primary={row.description} secondary={row.party_name} /> },
    { key: "cash_in", label: "Cash In", align: "right", render: (row) => Number(row.signed_amount ?? (row.transaction_type === "cash_in" || row.transaction_type === "adjustment" && row.adjustment_direction === "increase" ? row.amount : 0)) > 0 ? <span className="font-semibold text-emerald-700">{money(row.amount)}</span> : <FactoryCellMuted /> },
    { key: "cash_out", label: "Cash Out", align: "right", render: (row) => row.transaction_type === "expense" || row.transaction_type === "adjustment" && row.adjustment_direction === "decrease" ? <span className="font-semibold text-text-primary">{money(row.amount)}</span> : <FactoryCellMuted /> },
    { key: "balance", label: "Balance", align: "right", render: (row) => row.status === "posted" ? <span className="font-semibold text-text-primary">{money(row.balance_after)}</span> : <FactoryCellMuted>Pending</FactoryCellMuted> },
    { key: "by", label: "By", render: (row) => <FactoryCellText primary={row.posted_by_name || row.created_by_name} secondary={row.reversed_by_id ? "Reversed" : row.status === "posted" ? "Posted" : "Draft"} /> },
    { key: "receipt", label: "Receipt", render: (row) => row.receipt_path ? <button className="text-xs font-semibold text-primary hover:underline" onClick={() => openReceipt(row)}>Receipt</button> : <FactoryCellMuted>Missing</FactoryCellMuted> },
    { key: "actions", label: "Actions", align: "right", render: (row) => <FactoryRowActions onView={() => setModal({ type: "view", value: row })} primaryAction={row.status === "draft" && can("factory_petty_cash.post") ? { label: "Post", onClick: () => post(row) } : null} directActions={row.status === "draft" && can("factory_petty_cash.create") ? [{ label: "Edit", onClick: () => setModal({ type: "transaction", value: row }) }] : []} secondaryActions={[row.status === "draft" && can("factory_petty_cash.create") ? { label: "Delete Draft", destructive: true, onClick: () => remove(row) } : null, row.status === "posted" && !row.reversal_of_id && !row.reversed_by_id && can("factory_petty_cash.reverse") ? { label: "Reverse", destructive: true, onClick: () => setModal({ type: "reverse", value: row }) } : null]} /> },
  ];
  return <div className="space-y-5"><PageHeader section="Factory" title="Petty Cash" description="Physical cash ledger for Factory operational receipts and expenses." actions={<>{can("factory_petty_cash.manage") ? <button className="btn-secondary" onClick={() => setModal({ type: "categories" })}><Settings2 size={15} /> Categories</button> : null}{can("factory_petty_cash.create") ? <button className="btn-primary" onClick={() => setModal({ type: "transaction" })}><Plus size={15} /> New Transaction</button> : null}</>} /><div className="grid gap-3 md:grid-cols-4"><FactorySummaryCard icon={Landmark} label="Current Balance" value={money(data.summary?.current_balance)} helper="Posted ledger only" /><FactorySummaryCard icon={ArrowDownToLine} tone="success" label="Cash In — This Month" value={money(data.summary?.cash_in_month)} /><FactorySummaryCard icon={ArrowUpFromLine} tone="warning" label="Expenses — This Month" value={money(data.summary?.expenses_month)} /><FactorySummaryCard icon={FileText} label="Transactions — This Month" value={Number(data.summary?.transactions_month || 0)} /></div><FactoryFilterBar activeFilters={activeFilters} onClear={() => setFilters(emptyFilters)}><Field label="Search"><input className={inputClass()} value={filters.search} placeholder="Reference, description or party" onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></Field><Field label="Date"><FeedXDatePicker value={filters.dateFrom} onChange={(dateFrom) => setFilters((current) => ({ ...current, dateFrom }))} /></Field><Field label="To"><FeedXDatePicker value={filters.dateTo} onChange={(dateTo) => setFilters((current) => ({ ...current, dateTo }))} /></Field><Field label="Type"><SearchableSelect value={filters.type} options={typeOptions} onChange={(type) => setFilters((current) => ({ ...current, type }))} /></Field><Field label="Category"><SearchableSelect value={filters.category} options={[{ value: "", label: "All" }, ...data.categories.map((category) => ({ value: category.id, label: category.name }))]} onChange={(category) => setFilters((current) => ({ ...current, category }))} /></Field></FactoryFilterBar>{error ? <div role="alert" className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"><span>{error}</span><button className="btn-secondary" onClick={load}><RefreshCw size={14} /> Retry</button></div> : null}<FactoryDataSurface><FactoryTable columns={columns} rows={data.rows || []} loading={loading} emptyTitle="No Petty Cash transactions" emptyDescription="Create a Cash In, Expense or Adjustment draft to begin." /><FactoryPagination page={page} pageSize={pageSize} total={Number(data.total_count || 0)} loading={loading} noun="transactions" onPageChange={setPage} onPageSizeChange={(value) => { setPage(1); setPageSize(value); }} /></FactoryDataSurface>{modal?.type === "transaction" ? <PettyCashTransactionModal initialValue={modal.value} categories={data.categories || []} canAdjust={can("factory_petty_cash.adjust")} onClose={() => setModal(null)} onSave={saveDraft} /> : null}{modal?.type === "categories" ? <PettyCashCategoryModal categories={data.categories || []} onClose={() => setModal(null)} onSave={saveCategory} /> : null}{modal?.type === "view" ? <PettyCashDetailModal transaction={modal.value} canReverse={can("factory_petty_cash.reverse")} onReceipt={openReceipt} onReverse={(value) => setModal({ type: "reverse", value })} onClose={() => setModal(null)} /> : null}{modal?.type === "reverse" ? <ReverseModal transaction={modal.value} onClose={() => setModal(null)} onSave={reverse} /> : null}</div>;
}
