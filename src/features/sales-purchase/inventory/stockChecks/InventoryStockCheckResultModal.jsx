import { useMemo, useState } from "react";
import Modal from "../../../../components/feedback/Modal.jsx";
import AdminFilterToolbar, { ALL_FILTER_OPTION } from "../../../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../../../components/forms/AdminSearchField.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import AdminSummaryGrid from "../../../../components/ui/AdminSummaryGrid.jsx";
import { FactoryDataSurface, FactoryTable } from "../../../factory/components/FactoryDataDisplay.jsx";
import FactoryStatusBadge from "../../../factory/components/FactoryStatusBadge.jsx";
import { auditStockCheckValuation } from "./auditStockCheckValuation.js";

function resultStatus(row) {
  if (row.skipped) return { label: "Skipped", tone: "neutral" };
  if (row.na) return { label: "Not Available", tone: "neutral" };
  const variance = Number(row.variance || 0);
  if (variance > 0) return { label: "Shortage", tone: "warning" };
  if (variance < 0) return { label: "Excess", tone: "info" };
  return { label: "Normal", tone: "success" };
}

function formatQuantity(value) {
  return value === "" || value === null || value === undefined ? "—" : value;
}

export default function InventoryStockCheckResultModal({
  stockCheck, isAuditResult, outletName, submittedByName, itemById, categoryById,
  formatDate, formatDateTimeCompact, formatCurrency, ItemThumbnail, onPhotoPreview, onClose,
}) {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const rows = stockCheck.rows || [];
  const valuation = useMemo(() => auditStockCheckValuation(rows), [rows]);
  const detailedRows = valuation.items.map((row) => {
    const item = itemById.get(row.itemId);
    return { ...row, item, categoryId: row.categoryId || item?.categoryId, result: resultStatus(row) };
  });
  const counts = detailedRows.reduce((acc, row) => {
    acc[row.result.label] += 1;
    return acc;
  }, { Normal: 0, Shortage: 0, Excess: 0, Skipped: 0, "Not Available": 0 });
  const categories = [...new Set(detailedRows.map((row) => row.categoryId).filter(Boolean))]
    .map((id) => ({ value: id, label: categoryById.get(id)?.name || "Uncategorized" }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const statuses = ["Normal", "Shortage", "Excess", "Skipped", "Not Available"]
    .filter((label) => detailedRows.some((row) => row.result.label === label))
    .map((label) => ({ value: label, label }));
  const visibleRows = isAuditResult ? detailedRows.filter((row) => {
    const category = categoryById.get(row.categoryId)?.name || "Uncategorized";
    const text = `${row.item?.name || ""} ${row.item?.sku || ""} ${category}`.toLowerCase();
    return (categoryFilter === "all" || row.categoryId === categoryFilter)
      && (statusFilter === "all" || row.result.label === statusFilter)
      && (!search.trim() || text.includes(search.trim().toLowerCase()));
  }) : detailedRows;
  const countItems = [
    { key: "total", label: "Total Items", value: rows.length },
    { key: "normal", label: "Normal", value: counts.Normal },
    { key: "shortage", label: "Shortage", value: counts.Shortage },
    { key: "excess", label: "Excess", value: counts.Excess },
    { key: "skipped", label: "Skipped", value: counts.Skipped },
  ];
  const amount = (value, signed = false) => value === null ? "—" : `${value < 0 ? "-" : signed && value > 0 ? "+" : ""}${formatCurrency(Math.abs(value))}`;
  const valueItems = [
    { key: "stock", label: "Total Stock Value", value: amount(valuation.stockValue) },
    { key: "shortage", label: "Shortage Value", value: amount(valuation.shortageValue) },
    { key: "excess", label: "Excess Value", value: amount(valuation.excessValue) },
    { key: "net", label: "Net Variance", value: amount(valuation.netVariance, true) },
  ];
  const columns = [
    { key: "item", label: "Item", className: "min-w-[210px]", render: (row) => <div className="flex items-center gap-2"><ItemThumbnail item={row.item} category={categoryById.get(row.categoryId)} onPreview={onPhotoPreview} size="sm" /><div className="min-w-0"><div className="break-words font-semibold text-text-primary">{row.item?.name || "Inventory item"}</div><div className="text-xs text-text-secondary">{categoryById.get(row.categoryId)?.name || "Uncategorized"}{row.item?.sku ? ` · ${row.item.sku}` : ""}</div></div></div> },
    { key: "par", label: "Par", align: "right", className: "min-w-[70px] tabular-nums", render: (row) => formatQuantity(row.expectedQty) },
    { key: "actual", label: "Actual", align: "right", className: "min-w-[70px] tabular-nums", render: (row) => row.skipped ? "—" : formatQuantity(row.actualCount) },
    { key: "variance", label: "Variance", align: "right", className: "min-w-[85px] tabular-nums", render: (row) => row.skipped || row.na ? "—" : formatQuantity(row.variance) },
    { key: "uom", label: "UOM", className: "min-w-[65px]", render: (row) => row.unit || row.item?.unit || "—" },
    { key: "status", label: "Status", className: "min-w-[100px]", render: (row) => <FactoryStatusBadge status={row.result.label} tone={row.result.tone}>{row.result.label}</FactoryStatusBadge> },
    ...(isAuditResult ? [
      { key: "stockValue", label: "Stock Value", align: "right", className: "min-w-[115px] tabular-nums", render: (row) => amount(row.stockValue) },
      { key: "varianceValue", label: "Variance Value", align: "right", className: "min-w-[130px] tabular-nums", render: (row) => amount(row.varianceValue, true) },
    ] : []),
    { key: "notes", label: "Notes", className: "min-w-[120px] max-w-[190px] whitespace-pre-wrap break-words text-text-secondary", render: (row) => row.notes || "—" },
    { key: "skipReason", label: "Skip Reason", className: "min-w-[120px] max-w-[190px] whitespace-pre-wrap break-words text-text-secondary", render: (row) => row.skipReason || "—" },
  ];

  return <Modal
    title={isAuditResult ? "Audit Stock Check Result" : "Stock Check Result"}
    description={`${outletName} · ${formatDate(stockCheck.date)} · ${isAuditResult ? stockCheck.auditType || "Audit" : stockCheck.shift || "Stock Check"}`}
    size={isAuditResult ? "3xl" : "xl"}
    onClose={onClose}
    footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
  >
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm"><div><span className="text-text-secondary">Checked by</span><div className="font-semibold text-text-primary">{submittedByName}</div></div><div><span className="text-text-secondary">Submitted at</span><div className="font-semibold text-text-primary">{formatDateTimeCompact(stockCheck.submittedAt)}</div></div></div>
      <AdminSummaryGrid variant="compact" ariaLabel="Audit item counts" items={countItems} />
      {isAuditResult ? <>
        <AdminSummaryGrid variant="compact" ariaLabel="Full Audit valuation" items={valueItems} />
        {valuation.stockIncomplete || valuation.varianceIncomplete ? <p className="text-xs text-text-secondary" role="note">Valuation incomplete: {Math.max(valuation.stockIncomplete, valuation.varianceIncomplete)} of {rows.length} items lack a pinned configured cost or a usable count/Par quantity. Unavailable totals and row values are shown as —; no missing cost is treated as RM0.</p> : null}
        <AdminFilterToolbar ariaLabel="Audit result filters" denseFields searchAfterFilters
          filters={<><SelectField label="Category" value={categoryFilter} options={[ALL_FILTER_OPTION, ...categories]} onChange={setCategoryFilter} searchable /><SelectField label="Status" value={statusFilter} options={[ALL_FILTER_OPTION, ...statuses]} onChange={setStatusFilter} /></>}
          search={<AdminSearchField label="Search Item" value={search} onChange={setSearch} placeholder="Search item or category" />}
        />
      </> : null}
      <FactoryDataSurface><FactoryTable columns={columns} rows={visibleRows} emptyTitle={rows.length ? "No items match these filters" : "No checked items were saved"} emptyDescription={rows.length ? "Try another category, status, or item search." : "This stock check has no saved item evidence."} /></FactoryDataSurface>
    </div>
  </Modal>;
}
