import { useMemo, useState } from "react";
import Modal from "../../../../components/feedback/Modal.jsx";
import AdminFilterToolbar, { ALL_FILTER_OPTION } from "../../../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../../../components/forms/AdminSearchField.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import { AdminEvidenceDisclosure } from "../../../../components/layout/AdminAnalyticalSurface.jsx";
import AdminSummaryGrid from "../../../../components/ui/AdminSummaryGrid.jsx";
import { FactoryDataSurface, FactoryTable } from "../../../factory/components/FactoryDataDisplay.jsx";
import FactoryStatusBadge from "../../../factory/components/FactoryStatusBadge.jsx";
import ClosingStockApproval from "./ClosingStockApproval.jsx";
import AuditCountTimestamps from "./AuditCountTimestamps.jsx";
import { auditItemChanged, formatQuantity, sourceCountLabel, stockCheckCountState } from "./inventoryStockCheckReadModel.js";
import { auditStockCheckValuation, hasUsableAuditCount } from "./auditStockCheckValuation.js";
import { isValidClosingQuantity, MONTH_END_CLOSING } from "./monthEndClosing.js";

function auditQuantityVariance(row) {
  if (!hasUsableAuditCount(row) || !isValidClosingQuantity(row.expectedQty)) return null;
  return Number(row.actualCount) - Number(row.expectedQty);
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
  closing, canApproveClosing, onStartClosing, correctionHistory, correctionSource,
}) {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [valuationFilter, setValuationFilter] = useState("all");
  const [sort, setSort] = useState("saved");
  const [search, setSearch] = useState("");
  const isClosing = isAuditResult && stockCheck.auditType === MONTH_END_CLOSING;
  function showUnvaluedItems() {
    setCategoryFilter("all");
    setStatusFilter("all");
    setSearch("");
    setValuationFilter("unvalued");
  }
  const rows = stockCheck.rows || [];
  const valuation = useMemo(() => auditStockCheckValuation(rows), [rows]);
  const detailedRows = valuation.items.map((row) => {
    const item = itemById.get(row.itemId);
    const storedState = stockCheckCountState(row);
    const countState = isAuditResult && storedState === "counted" && !hasUsableAuditCount(row) ? "pending" : storedState;
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
  const matchingRows = isAuditResult ? detailedRows.filter((row) => {
    const category = categoryById.get(row.categoryId)?.name || "Uncategorized";
    const text = `${row.item?.name || ""} ${row.item?.sku || ""} ${category}`.toLowerCase();
    return (categoryFilter === "all" || row.categoryId === categoryFilter)
      && (statusFilter === "all" || row.result.label === statusFilter)
      && (valuationFilter === "all" || row.stockValue === null)
      && (!search.trim() || text.includes(search.trim().toLowerCase()));
  }) : detailedRows;
  const visibleRows = sort === "stockValue"
    ? [...matchingRows].sort((left, right) => (right.stockValue ?? -1) - (left.stockValue ?? -1))
    : matchingRows;
  const countItems = [
    { key: "total", label: "Total Items", value: rows.length },
    { key: "normal", label: "Normal", value: counts.Normal },
    { key: "shortage", label: "Shortage", value: counts.Shortage },
    { key: "excess", label: "Excess", value: counts.Excess },
    { key: "skipped", label: "Skipped", value: counts.Skipped },
    counts.Pending > 0 && { key: "pending", label: "Pending", value: counts.Pending },
  ];
  const amount = (value, signed = false) => value === null ? "—" : `${value < 0 ? "-" : signed && value > 0 ? "+" : ""}${formatCurrency(Math.abs(value))}`;
  const varianceLabel = valuation.varianceIncomplete ? " (Partial)" : "";
  const valueItems = [
    { key: "stock", label: valuation.stockIncomplete ? "Known Stock Value (Partial)" : "Total Stock Value",
      value: amount(valuation.knownStockValue) },
    { key: "shortage", label: `Shortage Value${varianceLabel}`, value: amount(valuation.shortageValue) },
    { key: "excess", label: `Excess Value${varianceLabel}`, value: amount(valuation.excessValue) },
    { key: "net", label: `Net Variance${varianceLabel}`, value: amount(valuation.netVariance, true) },
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
    description={`${outletName} · ${isAuditResult ? "Audit date " : ""}${formatDate(stockCheck.date)} · ${isAuditResult ? stockCheck.auditType || "Audit" : stockCheck.shift || "Stock Check"}`}
    size={isAuditResult ? "3xl" : "xl"}
    onClose={onClose}
    footer={<><button className="btn-secondary" type="button" onClick={onClose}>Close</button>{onRestock ? <button className="btn-primary" type="button" onClick={onRestock}>Review Purchase Suggestions</button> : null}</>}
  >
    <div className="space-y-4">
      {isAuditResult ? <p className="type-body-sm text-text-secondary">Submitted by <strong className="text-text-primary">{submittedByName}</strong></p>
        : <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div><span className="text-text-secondary">Checked by</span><div className="font-semibold text-text-primary">{submittedByName}</div></div>
          <div><span className="text-text-secondary">Submitted at</span><div className="font-semibold text-text-primary">{formatDateTimeCompact(stockCheck.submittedAt)}</div></div>
        </div>}
      {isClosing && <ClosingStockApproval check={stockCheck} context={closing}
        canApprove={canApproveClosing} formatCurrency={formatCurrency} onShowUnvalued={showUnvaluedItems} onStartClosing={onStartClosing} />}
      <AdminSummaryGrid variant="compact" ariaLabel="Audit item counts" items={countItems} />
      {isAuditResult ? <>
        <AdminSummaryGrid variant="compact" ariaLabel={valuation.stockIncomplete || valuation.varianceIncomplete ? "Partial audit valuation" : "Full Audit valuation"} items={valueItems} />
        <p className="text-xs text-text-secondary" role="note">
          {valuation.valuedItemCount} of {rows.length} items valued · {valuation.missingCostCount} missing valid pinned {valuation.missingCostCount === 1 ? "cost" : "costs"}
          {valuation.stockIncomplete > 0 && " · Physical count reference"}
          {valuation.varianceIncomplete > 0 && ` · Variance coverage ${valuation.varianceItemCount} of ${rows.length} items with usable Actual, Par, UOM and pinned cost`}
        </p>
        {correctionHistory}
        {correctionSource && <p className="type-body-sm text-text-secondary">{affectedCount} of {rows.length} items changed from the source audit.</p>}
        <AdminEvidenceDisclosure label="Audit details">
          {stockCheck.auditName && <p>{stockCheck.auditName}</p>}
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div><span>Created by</span><div className="font-semibold text-text-primary">{createdByName}</div></div>
            <AuditCountTimestamps startedAt={stockCheck.createdAt} submittedAt={stockCheck.submittedAt} />
          </div>
        </AdminEvidenceDisclosure>
        <div className="sr-only" aria-live="polite">{visibleRows.length} items shown</div>
        <AdminFilterToolbar ariaLabel="Audit result filters" denseFields searchAfterFilters
          filters={<><SelectField label="Category" value={categoryFilter} options={[ALL_FILTER_OPTION, ...categories]} onChange={setCategoryFilter} searchable /><SelectField label="Status" value={statusFilter} options={[ALL_FILTER_OPTION, ...statuses]} onChange={setStatusFilter} /><SelectField label="Valuation" value={valuationFilter}
            options={[ALL_FILTER_OPTION, { value: "unvalued", label: "Unvalued" }]} onChange={setValuationFilter} />
            <SelectField label="Sort" value={sort}
              options={[{ value: "saved", label: "Saved order" }, { value: "stockValue", label: "Highest stock value" }]} onChange={setSort} /></>}
          search={<AdminSearchField label="Search Item" value={search} onChange={setSearch} placeholder="Search item or category" />}
        />
      </> : null}
      <FactoryDataSurface><FactoryTable columns={columns} rows={visibleRows} emptyTitle={rows.length ? "No items match these filters" : "No checked items were saved"} emptyDescription={rows.length ? "Try another category, status, valuation filter, or item search." : "This stock check has no saved item evidence."} /></FactoryDataSurface>
    </div>
  </Modal>;
}
