import { Activity, AlertTriangle, PackageCheck, Warehouse } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import FactoryPagination, { FactoryTableLoadState } from "../components/FactoryPagination.jsx";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryFilterBar from "../components/FactoryFilterBar.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import useProductMovementsQuery from "../hooks/useProductMovementsQuery.js";
import { formatFactoryDate, formatFactoryReadableDate } from "../utils/factoryDates.js";
import { quantity } from "../utils/factoryFormatters.js";
import { productionBatchReference } from "../utils/factoryReferences.js";

function movementTypeLabel(movement) {
  if (movement?.reference_type === "production" && Number(movement?.quantity || 0) > 0) return "Production In";
  if (movement?.reference_type === "finished_goods_dispatch") return "Dispatch Out";
  if (movement?.reference_type === "stock_check" || movement?.reference_type === "product_stock_check") return "Stock Check";
  return movement?.movement_type || "Movement";
}

function movementSourceLabel(movement) {
  if (movement?.reference_type === "production") return "Production";
  if (movement?.reference_type === "finished_goods_dispatch") return "Dispatch";
  if (movement?.reference_type === "stock_check" || movement?.reference_type === "product_stock_check") return "Stock Check";
  return movement?.reference_type || "—";
}

function movementSourceReference(movement) {
  return movement?.source_reference || movement?.reference_no || (movement?.reference_type === "production" ? productionBatchReference(movement) : movement?.batch_no || "—");
}

function packSizeText(sku) {
  const quantityValue = Number(sku?.pack_size_qty || sku?.base_qty || 0);
  return quantityValue ? `${quantityValue} ${sku?.pack_size_uom || sku?.base_uom || ""}`.trim() : "";
}

function packagingTypeLabel(sku) {
  return sku?.packaging_type || sku?.package_type || "Pack";
}

function pluralizePackagingType(type, value) {
  return Number(value) === 1 ? type : `${type}s`;
}

function movementPackagingQtyLabel(row) { return quantity(Math.abs(Number(row?.quantity || 0)), pluralizePackagingType(packagingTypeLabel(row), Math.abs(Number(row?.quantity || 0)))); }
function movementBalanceLabel(row) { return row?.balance_after == null ? "—" : quantity(row.balance_after, pluralizePackagingType(packagingTypeLabel(row), Number(row.balance_after || 0))); }

export default function FactoryProductMovementsPage({ onNotify }) {
  const { filters, listing, updateFilters, resetFilters, requestPage, requestPageSize, retry } = useProductMovementsQuery({ onNotify });
  const rows = listing.rows.map((movement) => ({ ...movement, source_label: movementSourceLabel(movement), movement_type_label: movementTypeLabel(movement) }));
  const currentSkuBalanceByType = (listing.summary.filteredSkus || []).reduce((groups, sku) => { const type = pluralizePackagingType(packagingTypeLabel(sku), Number(sku.current_balance || 0)); groups[type] = (groups[type] || 0) + Number(sku.current_balance || 0); return groups; }, {});
  const currentSkuBalanceTypes = Object.keys(currentSkuBalanceByType);
  const currentSkuBalanceValue = currentSkuBalanceTypes.length === 1 ? quantity(currentSkuBalanceByType[currentSkuBalanceTypes[0]], currentSkuBalanceTypes[0]) : currentSkuBalanceTypes.length > 1 ? "Mixed" : "—";
  const storageSummary = (row) => Number(row.missing_storage_location_count || 0) > 0 ? "—" : Number(row.storage_location_count || 0) > 1 ? `${Number(row.storage_location_count)} Locations` : row.storage_location_name || "—";
  const batchSummary = (row) => Number(row.batch_count || 0) > 1 ? `${Number(row.batch_count)} Batches` : row.batch_summary || row.batch_no || "—";
  const expirySummary = (row) => Number(row.batch_count || 0) > 1 ? row.earliest_expiry_date ? `Earliest: ${formatFactoryReadableDate(row.earliest_expiry_date)}` : "—" : formatFactoryReadableDate(row.expiry_date || row.earliest_expiry_date);
  const movementColumns = [
    { key: "movement_date", label: "Date", render: (row) => <span className="whitespace-nowrap font-semibold text-text-primary">{formatFactoryDate(row.movement_date)}</span> },
    { key: "movement_type", label: "Type", render: (row) => <Badge tone={row.quantity >= 0 ? "success" : "warning"}>{row.movement_type_label}</Badge> },
    { key: "product_name", label: "Finished Good", render: (row) => <div className="min-w-[190px]"><div className="font-semibold text-text-primary">{row.product_name || "Finished Good"}</div>{row.product_name_cn ? <div className="mt-0.5 text-xs font-medium text-text-secondary">{row.product_name_cn}</div> : null}</div> },
    { key: "packaging_sku", label: "Packaging SKU", render: (row) => <div><div className="font-semibold text-text-primary">{row.product_code || "No SKU"}</div><div className="text-xs font-medium text-text-secondary">{row.variant_name || packSizeText(row) || "Packaging SKU"}</div></div> },
    { key: "quantity", label: "Qty", render: (row) => <div className={`font-bold ${Number(row.quantity || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{movementPackagingQtyLabel(row)}</div> },
    { key: "balance", label: "Balance", render: (row) => <div className="font-bold text-text-primary">{movementBalanceLabel(row)}</div> },
    { key: "storage", label: "Storage", render: (row) => <div className="min-w-[135px] max-w-[190px]"><div className="font-semibold leading-5 text-text-primary">{storageSummary(row)}</div>{Number(row.storage_location_count || 0) === 1 && row.storage_location_type ? <div className="text-xs font-medium text-text-secondary">{row.storage_location_type}</div> : null}</div> },
    { key: "batch_no", label: "Batch", render: (row) => <div className="max-w-[150px] font-semibold text-text-primary">{batchSummary(row)}</div> },
    { key: "expiry", label: "Expiry", render: (row) => <div className="whitespace-nowrap font-medium text-text-primary">{expirySummary(row)}</div> },
    { key: "source", label: "Source", render: (row) => <div className="min-w-[125px] max-w-[190px]"><div className="font-semibold leading-5 text-text-primary">{row.source_label}</div><div className="break-words text-xs font-medium text-text-secondary">{movementSourceReference(row)}</div></div> },
  ];
  const unavailableTitle = listing.error ? "Product Movements unavailable" : "Loading Product Movements";
  const unavailableDescription = listing.error ? "Retry to load the movement ledger." : "Loading the movement ledger.";
  const activeFilters = [filters.product && { key: "product", label: "Search", value: filters.product, onRemove: () => updateFilters({ product: "" }) }, filters.batch && { key: "batch", label: "Batch / Source", value: filters.batch, onRemove: () => updateFilters({ batch: "" }) }, filters.dateFrom && { key: "from", label: "Date", value: filters.dateFrom, onRemove: () => updateFilters({ dateFrom: "" }) }, filters.dateTo && { key: "to", label: "To", value: filters.dateTo, onRemove: () => updateFilters({ dateTo: "" }) }, filters.movementType && { key: "movement", label: "Movement type", value: filters.movementType, onRemove: () => updateFilters({ movementType: "" }) }, filters.category && { key: "category", label: "Category", value: (listing.summary.categories || []).find((category) => category.id === filters.category)?.name || filters.category, onRemove: () => updateFilters({ category: "" }) }].filter(Boolean);
  return <div className="space-y-5"><PageHeader section="Warehouse" title="Product Movements" /><div className="grid gap-3 md:grid-cols-4"><MetricCard icon={Activity} label="Movements" value={listing.loadedTotal} helper="Filtered ledger entries" /><MetricCard icon={PackageCheck} label="Stock In" value={listing.summary.stockInCount || 0} helper="Filtered inbound entries" tone="success" /><MetricCard icon={AlertTriangle} label="Stock Out" value={listing.summary.stockOutCount || 0} helper="Filtered outbound entries" tone="warning" /><MetricCard icon={Warehouse} label="Current SKU Balance" value={currentSkuBalanceValue} helper="Across moved Packaging SKUs" /></div><FactoryFilterBar activeFilters={activeFilters} onClear={resetFilters} moreFilters={<><Field label="Category"><SearchableSelect value={filters.category} options={[{ value: "", label: "All" }, ...(listing.summary.categories || []).map((category) => ({ value: category.id, label: category.name }))]} placeholder="All" searchPlaceholder="Search categories" onChange={(category) => updateFilters({ category })} /></Field><Field label="Batch / Source"><input className={inputClass()} value={filters.batch} onChange={(event) => updateFilters({ batch: event.target.value })} placeholder="Search batch or source" /></Field></>}><Field label="Search"><input className={inputClass()} value={filters.product} onChange={(event) => updateFilters({ product: event.target.value })} placeholder="Product or SKU" /></Field><Field label="Date"><FeedXDatePicker value={filters.dateFrom} placeholder="From" onChange={(dateFrom) => updateFilters({ dateFrom })} /></Field><Field label="To"><FeedXDatePicker value={filters.dateTo} placeholder="To" onChange={(dateTo) => updateFilters({ dateTo })} /></Field><Field label="Movement Type"><SearchableSelect value={filters.movementType} options={[{ value: "", label: "All" }, ...(listing.summary.movementTypes || []).map((type) => ({ value: type, label: type }))]} placeholder="All" searchPlaceholder="Search movements" onChange={(movementType) => updateFilters({ movementType })} /></Field></FactoryFilterBar><Card className="relative">{listing.loading ? <div className="absolute inset-x-0 top-0 z-10 h-1 overflow-hidden rounded-t-xl bg-primary/15"><div className="h-full w-1/3 animate-pulse rounded-full bg-primary" /></div> : null}<FactoryTableLoadState state={listing} label="Product Movements" onRetry={retry} permissionMessage="Some Product Movement data is hidden by your current role." /><div className={listing.loading && listing.hasLoaded ? "opacity-60 transition-opacity" : "transition-opacity"}><div className="md:hidden">{!listing.hasLoaded ? <div className="p-4"><EmptyState title={unavailableTitle} description={unavailableDescription} /></div> : !rows.length ? <div className="p-4"><EmptyState title="No Product Movements Found" description="No ledger entries match the selected filters." /></div> : <div className="divide-y divide-border">{rows.map((row) => <div key={row.id} className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-semibold text-text-muted">{formatFactoryDate(row.movement_date)}</div><div className="mt-1 font-bold text-text-primary">{row.product_name || "Finished Good"}</div>{row.product_name_cn ? <div className="text-sm font-medium text-text-secondary">{row.product_name_cn}</div> : null}<div className="text-sm font-semibold text-text-secondary">{row.product_code || "No SKU"} · {row.variant_name || packSizeText(row) || "Packaging SKU"}</div></div><Badge tone={row.quantity >= 0 ? "success" : "warning"}>{row.movement_type_label}</Badge></div><div className="grid grid-cols-2 gap-3 text-sm"><div><div className="text-[10.5px] font-semibold text-text-muted">Qty</div><div className={`font-bold ${Number(row.quantity || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{movementPackagingQtyLabel(row)}</div></div><div><div className="text-[10.5px] font-semibold text-text-muted">Balance</div><div className="font-bold text-text-primary">{movementBalanceLabel(row)}</div></div><div><div className="text-[10.5px] font-semibold text-text-muted">Storage</div><div className="font-semibold text-text-primary">{storageSummary(row)}</div>{Number(row.storage_location_count || 0) === 1 && row.storage_location_type ? <div className="text-xs text-text-secondary">{row.storage_location_type}</div> : null}</div><div><div className="text-[10.5px] font-semibold text-text-muted">Batch</div><div className="font-semibold text-text-primary">{batchSummary(row)}</div></div><div><div className="text-[10.5px] font-semibold text-text-muted">Expiry</div><div className="font-semibold text-text-primary">{expirySummary(row)}</div></div><div><div className="text-[10.5px] font-semibold text-text-muted">Source</div><div className="font-semibold text-text-primary">{row.source_label}</div><div className="text-xs font-medium text-text-secondary">{movementSourceReference(row)}</div></div></div></div>)}</div>}</div><div className="hidden md:block"><FactoryTable columns={movementColumns} rows={listing.hasLoaded ? rows : []} emptyTitle={!listing.hasLoaded ? unavailableTitle : "No Product Movements Found"} emptyDescription={!listing.hasLoaded ? unavailableDescription : "No ledger entries match the selected filters."} /></div></div>{listing.hasLoaded ? <FactoryPagination page={listing.loadedPage} pageSize={listing.loadedPageSize} total={listing.loadedTotal} loading={listing.loading} onPageChange={requestPage} onPageSizeChange={requestPageSize} /> : null}</Card></div>;
}
