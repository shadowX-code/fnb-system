import { useMemo, useState } from "react";
import Modal from "../../../../components/feedback/Modal.jsx";
import AdminFilterToolbar, { ALL_FILTER_OPTION } from "../../../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../../../components/forms/AdminSearchField.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import AdminSummaryGrid from "../../../../components/ui/AdminSummaryGrid.jsx";
import { FactoryDataSurface, FactoryTable } from "../../../factory/components/FactoryDataDisplay.jsx";
import FactoryStatusBadge from "../../../factory/components/FactoryStatusBadge.jsx";
import ClosingStockApproval from "./ClosingStockApproval.jsx";
import AuditCountTimestamps from "./AuditCountTimestamps.jsx";
import { auditItemChanged, formatQuantity, sourceCountLabel, stockCheckCountState } from "./inventoryStockCheckReadModel.js";
import { auditStockCheckValuation } from "./auditStockCheckValuation.js";

function auditQuantityVariance(row) {
  if (row.actualCount === "" || row.actualCount === null || row.actualCount === undefined
    || row.expectedQty === "" || row.expectedQty === null || row.expectedQty === undefined) return null;
  const actual = Number(row.actualCount);
  const par = Number(row.expectedQty);
  return Number.isFinite(actual) && Number.isFinite(par) ? actual - par : null;
}

function resultStatus(row, isAuditResult, countState) {
  if (countState === "skipped") return { label: "Skipped", tone: "neutral" };
  if (countState === "na") return { label: "Not Available", tone: "neutral" };
  if (countState === "pending") return { label: "Pending", tone: "neutral" };
  if (isAuditResult) {
    const variance = auditQuantityVariance(row);
    if (variance === null) return { label: "Not Available", tone: "neutral" };
    if (variance < 0) return { label: "Shortage", tone: "warning" };
    if (variance > 0) return { label: "Excess", tone: "info" };
    return { label: "Normal", tone: "success" };
  }
  const variance = Number(row.variance || 0);
  if (variance > 0) return { label: "Shortage", tone: "warning" };
  if (variance < 0) return { label: "Excess", tone: "info" };
  return { label: "Normal", tone: "success" };
}


export default function InventoryStockCheckResultModal({
  stockCheck, isAuditResult, outletName, createdByName, submittedByName, itemById, categoryById,
  formatDate, formatDateTimeCompact, formatCurrency, ItemThumbnail, onPhotoPreview, onClose, onRestock,
  closing, canApproveClosing, correctionHistory, correctionSource,
}) {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [valuationFilter, setValuationFilter] = useState("all");
  const [search, setSearch] = useState("");
  const rows = stockCheck.rows || [];
  const valuation = useMemo(() => auditStockCheckValuation(rows), [rows]);
  const detailedRows = valuation.items.map((row) => {
    const item = itemById.get(row.itemId);
    const countState = stockCheckCountState(row);
    const displayVariance = countState !== "counted" ? null : isAuditResult ? auditQuantityVariance(row) : row.variance;
    return { ...row, item, categoryId: row.categoryId || item?.categoryId, result: resultStatus(row, isAuditResult, countState), displayVariance };
  });
  const sourceByItem = new Map(correctionSource?.rows.map(row => [row.itemId, row]));
  const affectedCount = detailedRows.filter(row => auditItemChanged(row, sourceByItem.get(row.itemId))).length;
  const counts = detailedRows.reduce((acc, row) => {
    acc[row.result.label] += 1;
    return acc;
  }, { Normal: 0, Shortage: 0, Excess: 0, Skipped: 0, Pending: 0, "Not Available": 0 });
  const categories = [...new Set(detailedRows.map((row) => row.categoryId).filter(Boolean))]
    .map((id) => ({ value: id, label: categoryById.get(id)?.name || "Uncategorized" }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const statuses = ["Normal", "Shortage", "Excess", "Skipped", "Pending", "Not Available"]
    .filter((label) => detailedRows.some((row) => row.result.label === label))
    .map((label) => ({ value: label, label }));
  const visibleRows = isAuditResult ? detailedRows.filter((row) => {
    const category = categoryById.get(row.categoryId)?.name || "Uncategorized";
    const text = `${row.item?.name || ""} ${row.item?.sku || ""} ${category}`.toLowerCase();
    return (categoryFilter === "all" || row.categoryId === categoryFilter)
      && (statusFilter === "all" || row.result.label === statusFilter)
      && (valuationFilter === "all" || row.stockValue === null)
      && (!search.trim() || text.includes(search.trim().toLowerCase()));
  }) : detailedRows;
  const countItems = [
    { key: "total", label: "Total Items", value: rows.length },
    { key: "normal", label: "Normal", value: counts.Normal },
    { key: "shortage", label: "Shortage", value: counts.Shortage },
    { key: "excess", label: "Excess", value: counts.Excess },
    { key: "skipped", label: "Skipped", value: counts.Skipped },
    counts.Pending > 0 && { key: "pending", label: "Pending", value: counts.Pending },
  ];
  const amount = (value, signed = false) => value === null ? "—" : `${value < 0 ? "-" : signed && value > 0 ? "+" : ""}${formatCurrency(Math.abs(value))}`;
  const valueItems = [
    { key: "stock", label: valuation.stockIncomplete ? "Known Stock Value (Partial)" : "Total Stock Value",
      value: amount(valuation.knownStockValue) },
    { key: "shortage", label: "Shortage Value", value: amount(valuation.shortageValue) },
    { key: "excess", label: "Excess Value", value: amount(valuation.excessValue) },
    { key: "net", label: "Net Variance", value: amount(valuation.netVariance, true) },
  ];
  const columns = [
    { key: "item", label: "Item", className: "min-w-[210px]", render: (row) => <div className="flex items-center gap-2"><ItemThumbnail item={row.item} category={categoryById.get(row.categoryId)} onPreview={onPhotoPreview} size="sm" /><div className="min-w-0"><div className="break-words font-semibold text-text-primary">{row.item?.name || "Inventory item"}</div><div className="text-xs text-text-secondary">{categoryById.get(row.categoryId)?.name || "Uncategorized"}{row.item?.sku ? ` · ${row.item.sku}` : ""}</div></div></div> },
    { key: "par", label: "Par", align: "right", className: "min-w-[70px] tabular-nums", render: (row) => formatQuantity(row.expectedQty) },
    ...(correctionSource ? [{ key: "source", label: "Source Count", align: "right", className: "min-w-[100px]",
      render: row => sourceCountLabel(sourceByItem.get(row.itemId)) }] : []),
    { key: "actual", label: correctionSource ? "Corrected Count" : "Actual", align: "right", className: "min-w-[70px] tabular-nums", render: (row) => <>
      {row.skipped ? "—" : formatQuantity(row.actualCount)}
      {correctionSource && auditItemChanged(row, sourceByItem.get(row.itemId)) && <div className="type-caption text-text-secondary">Changed</div>}
    </> },
    { key: "variance", label: "Variance", align: "right", className: "min-w-[85px] tabular-nums", render: row => formatQuantity(row.displayVariance) },
    { key: "uom", label: "UOM", className: "min-w-[65px]", render: (row) => row.unit || "—" },
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
    footer={<><button className="btn-secondary" type="button" onClick={onClose}>Close</button>{onRestock ? <button className="btn-primary" type="button" onClick={onRestock}>Review Purchase Suggestions</button> : null}</>}
  >
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {isAuditResult && <div><span className="text-text-secondary">Created by</span><div className="font-semibold text-text-primary">{createdByName}</div></div>}
        <div><span className="text-text-secondary">{isAuditResult ? "Submitted by" : "Checked by"}</span>
          <div className="font-semibold text-text-primary">{submittedByName}</div></div>{isAuditResult
        ? <AuditCountTimestamps startedAt={stockCheck.createdAt} submittedAt={stockCheck.submittedAt} />
        : <div><span className="text-text-secondary">Submitted at</span><div className="font-semibold text-text-primary">{formatDateTimeCompact(stockCheck.submittedAt)}</div></div>}</div>
      {correctionHistory}
      {correctionSource && <p className="type-body-sm text-text-secondary">{affectedCount} of {rows.length} items changed from the source audit.</p>}
      {closing && <ClosingStockApproval check={stockCheck} context={closing} itemById={itemById}
        canApprove={canApproveClosing} formatCurrency={formatCurrency} />}
      <AdminSummaryGrid variant="compact" ariaLabel="Audit item counts" items={countItems} />
      {isAuditResult ? <>
        <AdminSummaryGrid variant="compact" ariaLabel={valuation.stockIncomplete ? "Partial audit valuation" : "Full Audit valuation"} items={valueItems} />
        <p className="text-xs text-text-secondary" role="note">
          {valuation.valuedItemCount} of {rows.length} items valued · {valuation.missingCostCount} missing valid pinned {valuation.missingCostCount === 1 ? "cost" : "costs"}
          {valuation.stockIncomplete > 0 && " · Physical count reference"}
          {valuation.varianceIncomplete > 0 && " · Variance totals require complete cost and Par evidence"}
        </p>
        <AdminFilterToolbar ariaLabel="Audit result filters" denseFields searchAfterFilters
          filters={<><SelectField label="Category" value={categoryFilter} options={[ALL_FILTER_OPTION, ...categories]} onChange={setCategoryFilter} searchable /><SelectField label="Status" value={statusFilter} options={[ALL_FILTER_OPTION, ...statuses]} onChange={setStatusFilter} /><SelectField label="Valuation" value={valuationFilter}
            options={[ALL_FILTER_OPTION, { value: "unvalued", label: "Unvalued" }]} onChange={setValuationFilter} /></>}
          search={<AdminSearchField label="Search Item" value={search} onChange={setSearch} placeholder="Search item or category" />}
        />
      </> : null}
      <FactoryDataSurface><FactoryTable columns={columns} rows={visibleRows} emptyTitle={rows.length ? "No items match these filters" : "No checked items were saved"} emptyDescription={rows.length ? "Try another category, status, valuation filter, or item search." : "This stock check has no saved item evidence."} /></FactoryDataSurface>
    </div>
  </Modal>;
}
