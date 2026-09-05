import { Factory, PackageCheck, RefreshCw, Warehouse, X } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import FactoryPagination, { FactoryTableLoadState } from "../components/FactoryPagination.jsx";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryFilterBar from "../components/FactoryFilterBar.jsx";
import FactoryRowAction from "../components/FactoryRowAction.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import useFactoryNavigation from "../hooks/useFactoryNavigation.js";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useRawMaterialMovementsQuery from "../hooks/useRawMaterialMovementsQuery.js";
import { formatFactoryDate } from "../utils/factoryDates.js";
import { ledgerQuantity, ledgerQuantityList } from "../utils/factoryFormatters.js";
import { rawMovementTypeMeta } from "../utils/factoryStatus.js";

export default function FactoryRawMaterialMovementsPage({ onNotify, onOpenDetail, onCloseDetail }) {
  const { rawMovementReferenceLoading, openRawMaterialMovementReference } = useFactoryNavigation();
  const { rawMaterials: materials } = useFactoryMasterData();
  const { filters, listing, updateFilters, clearBatch, selectBatch, requestPage, requestPageSize, retry } = useRawMaterialMovementsQuery({ onNotify, onPermissionDenied: onCloseDetail });
  const rows = listing.hasLoaded ? listing.rows : [];
  const summary = listing.summary || {};
  const hasLoaded = listing.hasLoaded;
  const movementTypes = Array.isArray(summary.movement_types) ? summary.movement_types : [];
  const storageLocations = Array.isArray(summary.location_values) ? summary.location_values : [];
  const materialOptions = materials.map((material) => ({ value: material.id, label: material.name_en || material.name || "" }));
  const movementColumns = [
    { key: "movement_date", label: "Date", render: (row) => <span className="whitespace-nowrap font-semibold text-text-primary">{formatFactoryDate(row.movement_date)}</span> },
    { key: "movement_type", label: "Movement Type", render: (row) => { const meta = rawMovementTypeMeta(row.movement_type); return <Badge tone={meta.tone}>{meta.label}</Badge>; } },
    { key: "raw_material", label: "Raw Material", render: (row) => <div><div className="font-bold text-text-primary">{row.raw_material_name || "Raw Material"}</div><div className="text-xs text-text-secondary">{row.raw_material_code || "No SKU"}</div></div> },
    { key: "quantity", label: "Qty", render: (row) => <span className={`whitespace-nowrap font-bold ${Number(row.quantity || 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{ledgerQuantity(row.quantity, row.uom, { signed: true })}</span> },
    { key: "balance", label: "Balance", render: (row) => <span className="whitespace-nowrap font-bold text-text-primary">{row.balance_after == null ? "—" : ledgerQuantity(row.balance_after, row.uom)}</span> },
    { key: "storage_location", label: "Storage Location", render: (row) => row.storage_location || "—" },
    { key: "batch_no", label: "Internal Batch", render: (row) => row.internal_batch_no && row.batch_id ? <button className="font-bold text-text-primary underline decoration-dotted underline-offset-4 hover:text-primary" type="button" title="Filter by this exact Internal Batch" onClick={() => { onCloseDetail?.(); selectBatch(row); }}>{row.internal_batch_no}</button> : row.internal_batch_no || "—" },
    { key: "reference", label: "Reference", render: (row) => row.reference_no && row.document_id ? <button className="font-bold text-primary underline decoration-dotted underline-offset-4 hover:text-emerald-800 disabled:cursor-wait disabled:opacity-60" type="button" disabled={rawMovementReferenceLoading === row.id} onClick={() => openRawMaterialMovementReference(row)}>{rawMovementReferenceLoading === row.id ? "Opening..." : row.reference_no}</button> : "—" },
    { key: "created_by", label: "Operator", render: (row) => row.created_by_name || "—" },
    { key: "actions", label: "Actions", align: "right", render: (row) => <FactoryRowAction onClick={() => onOpenDetail(row)} /> },
  ];

  return <div className="space-y-5">
    <PageHeader section="Raw Material" title="Raw Material Movements" description="View raw material stock-in, stock-out and approved adjustment movement logs." />
    <div className="grid gap-3 md:grid-cols-4">
      <MetricCard icon={RefreshCw} label="Movements" value={hasLoaded ? Number(summary.movements || 0) : "—"} helper="Filtered movement rows" />
      <MetricCard icon={PackageCheck} label="Stock In" value={hasLoaded ? ledgerQuantityList(summary.stock_in_by_uom) : "—"} helper="Positive movement quantity by UOM" tone="success" />
      <MetricCard icon={Factory} label="Stock Out" value={hasLoaded ? ledgerQuantityList(summary.stock_out_by_uom) : "—"} helper="Negative movement quantity by UOM" tone={(summary.stock_out_by_uom || []).length ? "warning" : "success"} />
      <MetricCard icon={Warehouse} label="Locations" value={hasLoaded ? Number(summary.locations || 0) : "—"} helper="Locations in filtered rows" />
    </div>
    <FactoryFilterBar moreFilters={<><Field label="Movement Type"><SearchableSelect value={filters.movementType} options={[{ value: "", label: "All" }, ...movementTypes.map((type) => ({ value: type, label: type }))]} placeholder="All" searchPlaceholder="Search movements" emptyText="No matching movements" onChange={(movementType) => updateFilters({ movementType })} /></Field><Field label="Storage Location"><SearchableSelect value={filters.storageLocation} options={[{ value: "", label: "All" }, ...storageLocations.map((location) => ({ value: location, label: location }))]} placeholder="All" searchPlaceholder="Search locations" emptyText="No matching locations" onChange={(storageLocation) => updateFilters({ storageLocation })} /></Field></>} activeFilters={[filters.dateFrom && { key: "from", label: "From", value: filters.dateFrom, onRemove: () => updateFilters({ dateFrom: "" }) }, filters.dateTo && { key: "to", label: "To", value: filters.dateTo, onRemove: () => updateFilters({ dateTo: "" }) }, filters.material && { key: "material", label: "Raw Material", value: materialOptions.find((option) => option.value === filters.material)?.label || filters.material, onRemove: () => updateFilters({ material: "" }) }, filters.movementType && { key: "movement", label: "Movement Type", value: filters.movementType, onRemove: () => updateFilters({ movementType: "" }) }, filters.storageLocation && { key: "storage", label: "Storage", value: filters.storageLocation, onRemove: () => updateFilters({ storageLocation: "" }) }, filters.search && { key: "search", label: "Search", value: filters.search, onRemove: () => updateFilters({ search: "" }) }].filter(Boolean)} onClear={() => updateFilters({ dateFrom: "", dateTo: "", material: "", movementType: "", storageLocation: "", search: "" })}>
      <Field label="Date"><FeedXDatePicker value={filters.dateFrom} placeholder="From" onChange={(dateFrom) => updateFilters({ dateFrom })} /></Field>
      <Field label="To"><FeedXDatePicker value={filters.dateTo} placeholder="To" onChange={(dateTo) => updateFilters({ dateTo })} /></Field>
      <Field label="Raw Material"><SearchableSelect value={filters.material} options={[{ value: "", label: "All" }, ...materialOptions]} placeholder="All" searchPlaceholder="Search material" emptyText="No matching materials" onChange={(material) => updateFilters({ material })} /></Field>
      <Field label="Search"><input className={inputClass()} value={filters.search} onChange={(event) => updateFilters({ search: event.target.value })} placeholder="Reference, batch, lot, material, remarks" />{filters.batchId ? <button className="mt-2 inline-flex items-center gap-2 text-xs font-bold text-primary hover:text-emerald-800" type="button" onClick={clearBatch}>Exact batch: {filters.batchLabel || "Selected batch"} <X size={13} /></button> : null}</Field>
    </FactoryFilterBar>
    <Card>
      <FactoryTableLoadState state={listing} label="Raw Material Movements" onRetry={retry} permissionMessage="Raw Material Movement data is hidden by your current role." />
      <FactoryTable columns={movementColumns} rows={rows} emptyTitle="No raw material movements" emptyDescription="Receiving, production actual usage and approved stock checks will create raw material movement rows." />
      {hasLoaded ? <FactoryPagination page={listing.loadedPage} pageSize={listing.loadedPageSize} total={listing.loadedTotal} loading={listing.loading} onPageChange={requestPage} onPageSizeChange={requestPageSize} /> : null}
    </Card>
  </div>;
}
