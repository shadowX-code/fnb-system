import { useEffect, useState } from "react";
import { ClipboardList, Play, RotateCcw } from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryPagination, { FactoryTableLoadState, useFactoryPagedQuery } from "../components/FactoryPagination.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { formatFactoryDate } from "../utils/factoryDates.js";
import { packSizeText, quantity } from "../utils/factoryFormatters.js";
import { jobStatusLabel, statusTone } from "../utils/factoryStatus.js";
import { isFactoryPermissionError } from "../utils/factoryPermissions.js";
import { factoryService } from "../../../services/factoryService.js";

export default function FactoryJobOrdersPage({
  data, auth, can, onCreate, onView, onEdit, onRelease, onDelete, onCancel, onStart,
  onViewProcess, onComplete, onViewResult,
  jobOrdersListingBridge, onPermissionDenied, onNotify, jobFinishedGoodName,
  productionQcTone, productionQcDisplayLabel,
}) {
  const [jobOrderFilters, setJobOrderFilters] = useState({ search: "", status: "", scheduledDateFrom: "", scheduledDateTo: "", manufacturingDateFrom: "", manufacturingDateTo: "", finishedGood: "" });
  const scheduledDateRangeError = jobOrderFilters.scheduledDateFrom && jobOrderFilters.scheduledDateTo && jobOrderFilters.scheduledDateFrom > jobOrderFilters.scheduledDateTo
    ? "From date cannot be later than To date."
    : "";
  const manufacturingDateRangeError = jobOrderFilters.manufacturingDateFrom && jobOrderFilters.manufacturingDateTo && jobOrderFilters.manufacturingDateFrom > jobOrderFilters.manufacturingDateTo
    ? "From date cannot be later than To date."
    : "";
  const jobOrderDateRangeInvalid = Boolean(scheduledDateRangeError || manufacturingDateRangeError);
  const permissionSignature = JSON.stringify([...(auth?.permissions || [])].sort());
  const querySignature = JSON.stringify({ listing: "job-orders", filters: jobOrderFilters, permissions: permissionSignature });
  const [factoryListingPage, factoryListingActions] = useFactoryPagedQuery({
    storageKey: "job-orders",
    enabled: !jobOrderDateRangeInvalid,
    querySignature,
    loadPage: ({ page, pageSize }) => factoryService.listFactoryListingPage({ listing: "job-orders", page, pageSize, filters: jobOrderFilters }),
    onError: (error) => {
      console.error("[Factory] Unable to load job-orders.", error);
      const permissionDenied = isFactoryPermissionError(error);
      onNotify?.({ title: permissionDenied ? "Factory data hidden" : "Failed to load Factory listing", message: permissionDenied ? "Some Factory data is hidden by your current role." : "Unable to load the latest Factory listing.", tone: "error" });
    },
    shouldClearOnError: isFactoryPermissionError,
    mapError: (error) => ({
      kind: isFactoryPermissionError(error) ? "permission" : "load",
      message: isFactoryPermissionError(error) ? "Some data is hidden by your current role." : "Unable to load the latest data.",
    }),
  });
  useEffect(() => {
    jobOrdersListingBridge?.bind(factoryListingActions);
    return () => jobOrdersListingBridge?.bind({ retry: null, updateLoadedSnapshot: null });
  }, [factoryListingActions, jobOrdersListingBridge]);
  useEffect(() => {
    if (factoryListingPage.errorKind === "permission") onPermissionDenied?.();
  }, [factoryListingPage.errorKind, onPermissionDenied]);
  const jobColumns = [
    { key: "planned_date", label: "Scheduled Date", render: (row) => formatFactoryDate(row.planned_date) },
    { key: "job_order_no", label: "JO No", render: (row) => <div className="font-bold text-text-primary">{row.job_order_no}</div> },
    { key: "finished_good", label: "Finished Good", render: (row) => <div><div className="font-semibold text-text-primary">{jobFinishedGoodName(row)}</div><div className="text-xs text-text-secondary">{row.product_name_cn || row.product_name_bm || "Finished Good"}</div></div> },
    { key: "product_code", label: "Packaging SKU", render: (row) => <div><div className="font-semibold text-text-primary">{row.variant_name || packSizeText(row) || "Packaging SKU"}</div><div className="text-xs text-text-secondary">{row.product_code || "No SKU"}</div></div> },
    { key: "target", label: "Target Production Qty", render: (row) => <div className="font-semibold text-text-primary">{quantity(row.target_production_qty ?? row.target_quantity, row.uom)}</div> },
    { key: "estimated_pack_qty", label: "Estimated Pack Qty", render: (row) => quantity(row.target_pack_qty, "packs") },
    { key: "manufacturing_date", label: "Manufacturing Date", render: (row) => row.status === "completed" && row.manufacturing_date ? formatFactoryDate(row.manufacturing_date) : "—" },
    { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{jobStatusLabel(row.status)}</Badge> },
    { key: "production_qc", label: "Production / QC", render: (row) => <Badge tone={productionQcTone(row.production_qc_status)}>{productionQcDisplayLabel(row.production_qc_status)}</Badge> },
    { key: "created_by", label: "Created By", render: (row) => row.created_by_name || row.created_by || "—" },
    { key: "actions", label: "Actions", align: "right", render: (row) => (
      <div className="flex flex-wrap justify-end gap-2">
        {["draft", "planned"].includes(row.status) && can("factory_job_orders.edit") ? (
          <button className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50" type="button" onClick={() => onRelease(row)}>Release</button>
        ) : null}
        {row.status === "released" && can("factory_production.complete") ? (
          <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => onStart(row)}><Play size={13} /> Start Production</button>
        ) : null}
        {["planned", "released"].includes(row.status) ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => onView(row)}>View</button> : null}
        {row.status === "planned" && can("factory_job_orders.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => onEdit(row)}>Edit</button> : null}
        {["planned", "released"].includes(row.status) && can("factory_job_orders.cancel") ? <button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" onClick={() => onCancel(row)}>Cancel</button> : null}
        {row.status === "in_progress" && (can("factory_production.view") || can("factory_production.complete")) ? (
          <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => onViewProcess(row, !can("factory_production.complete"))}>View Process</button>
        ) : null}
        {row.status === "in_progress" && can("factory_production.complete") ? (
          <button className="btn-primary px-3 py-1.5 text-xs" type="button" onClick={() => onComplete(row)}>Complete</button>
        ) : null}
        {row.status === "draft" && can("factory_job_orders.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => onEdit(row)}>Edit</button> : null}
        {row.status === "completed" ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => onViewResult(row)}>View</button> : null}
        {row.status === "cancelled" ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => onView(row)}>View</button> : null}
        {row.status === "draft" && can("factory_job_orders.delete") ? <button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" onClick={() => onDelete(row)}>Delete</button> : null}
      </div>
    ) },
  ];

  function renderJobOrders() {
    const rows = factoryListingPage.hasLoaded ? factoryListingPage.rows : [];
    const hasFilters = Object.values(jobOrderFilters).some(Boolean);
    const finishedGoodOptions = [
      ...data.productFamilies.map((product) => ({
        value: `family:${product.id}`,
        label: product.name_en || product.product_name || "Finished Good",
        helper: "Finished Good",
      })),
      ...data.finishedGoods.map((sku) => ({
      value: `sku:${sku.id}`,
      label: [sku.product_code, sku.variant_name || packSizeText(sku)].filter(Boolean).join(" · ") || jobFinishedGoodName(sku),
      helper: `${sku.product_family_name || sku.product_name || "Finished Good"} · Packaging SKU`,
      })),
    ];

    return (
      <div className="space-y-5">
        <PageHeader
          section="Factory"
          title="Job Order"
          description="Manage and review Factory production job orders."
          actions={can("factory_job_orders.create") ? <button className="btn-primary" type="button" onClick={onCreate}><ClipboardList size={15} /> Create Job Order</button> : null}
        />
        <div className="grid gap-3 border-y border-border bg-white px-4 py-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Search">
            <input
              className={inputClass()}
              type="search"
              value={jobOrderFilters.search}
              placeholder="JO no., product, SKU or batch"
              onChange={(event) => setJobOrderFilters((current) => ({ ...current, search: event.target.value }))}
            />
          </Field>
          <Field label="Status">
            <SearchableSelect
              value={jobOrderFilters.status}
              options={[
                { value: "", label: "All" },
                { value: "draft", label: "Draft" },
                { value: "planned", label: "Planned" },
                { value: "released", label: "Released" },
                { value: "in_progress", label: "In Progress" },
                { value: "completed", label: "Completed" },
                { value: "cancelled", label: "Cancelled" },
              ]}
              placeholder="All"
              searchPlaceholder="Search status"
              onChange={(value) => setJobOrderFilters((current) => ({ ...current, status: value }))}
            />
          </Field>
          <Field label="Finished Good / Packaging SKU">
            <SearchableSelect
              value={jobOrderFilters.finishedGood}
              options={finishedGoodOptions}
              placeholder="All"
              searchPlaceholder="Search Finished Good or SKU"
              onChange={(value) => setJobOrderFilters((current) => ({ ...current, finishedGood: value }))}
            />
          </Field>
          <div className="flex items-end">
            {hasFilters ? <button className="btn-secondary w-full justify-center" type="button" onClick={() => setJobOrderFilters({ search: "", status: "", scheduledDateFrom: "", scheduledDateTo: "", manufacturingDateFrom: "", manufacturingDateTo: "", finishedGood: "" })}><RotateCcw size={14} /> Reset Filters</button> : null}
          </div>
          <Field label="Scheduled From">
            <FeedXDatePicker value={jobOrderFilters.scheduledDateFrom} onChange={(value) => setJobOrderFilters((current) => ({ ...current, scheduledDateFrom: value }))} />
          </Field>
          <Field label="Scheduled To" error={scheduledDateRangeError}>
            <FeedXDatePicker value={jobOrderFilters.scheduledDateTo} error={scheduledDateRangeError} onChange={(value) => setJobOrderFilters((current) => ({ ...current, scheduledDateTo: value }))} />
          </Field>
          <Field label="Manufacturing From">
            <FeedXDatePicker value={jobOrderFilters.manufacturingDateFrom} onChange={(value) => setJobOrderFilters((current) => ({ ...current, manufacturingDateFrom: value }))} />
          </Field>
          <Field label="Manufacturing To" error={manufacturingDateRangeError}>
            <FeedXDatePicker value={jobOrderFilters.manufacturingDateTo} error={manufacturingDateRangeError} onChange={(value) => setJobOrderFilters((current) => ({ ...current, manufacturingDateTo: value }))} />
          </Field>
        </div>
        <Card title="Job Order Records" description={jobOrderDateRangeInvalid ? "Correct the invalid date range to update these records." : factoryListingPage.hasLoaded ? `${factoryListingPage.loadedTotal} job order record(s).` : "Historical and current Job Orders."}>
          {jobOrderDateRangeInvalid ? (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              Correct the date range to update results. Any visible rows are from the last successful query.
            </div>
          ) : <FactoryTableLoadState state={factoryListingPage} label="Job Orders" onRetry={factoryListingActions.retry} permissionMessage="Some Job Order data is hidden by your current role." />}
          <div className={factoryListingPage.loading && factoryListingPage.hasLoaded ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {jobOrderDateRangeInvalid && !rows.length ? null : <FactoryTable columns={jobColumns} rows={rows} emptyTitle="No Job Orders Found" emptyDescription={hasFilters ? "No Job Orders match the current filters." : "Create a Finished Good product first, then plan production demand with a Job Order."} />}
          </div>
          {!jobOrderDateRangeInvalid && factoryListingPage.hasLoaded ? <FactoryPagination page={factoryListingPage.loadedPage} pageSize={factoryListingPage.loadedPageSize} total={factoryListingPage.loadedTotal} loading={factoryListingPage.loading} onPageChange={factoryListingActions.requestPage} onPageSizeChange={factoryListingActions.requestPageSize} /> : null}
        </Card>
      </div>
    );
  }

  return renderJobOrders();
}
