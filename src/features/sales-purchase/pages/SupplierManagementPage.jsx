import { useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Power, Trash2 } from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { FieldLabel, MonthSelector, YearSelector } from "../../../components/forms/Selectors.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import EntityModal from "../components/EntityModal.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { getCategoryName, sumAmount, toCurrency } from "../utils/analytics.js";
import { formatSupplierName, supplierService } from "../../../services/supplierService.js";
import Modal from "../../../components/feedback/Modal.jsx";
import { canCreate, canDelete, canEdit, hasPermission, notifyPermissionDenied } from "../../../utils/accessControl.js";

function purchasePeriodLabel(period) {
  if (!period?.month || !period?.year) return "—";
  return new Date(Number(period.year), Number(period.month) - 1).toLocaleDateString("en-MY", {
    month: "short",
    year: "numeric",
  });
}

function periodDistance(fromPeriod, toPeriod) {
  if (!fromPeriod?.month || !fromPeriod?.year || !toPeriod?.month || !toPeriod?.year) return null;
  return (Number(toPeriod.year) - Number(fromPeriod.year)) * 12 + (Number(toPeriod.month) - Number(fromPeriod.month));
}

function truncateText(value, maxLength = 44) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export default function SupplierManagementPage({ store, setStore, ui, auth }) {
  const filters = usePeriodFilters(store);
  const fallbackCategoryId =
    store.purchaseCategories.find((categoryItem) => categoryItem.name?.toLowerCase() === "others")?.id ||
    store.purchaseCategories[0]?.id ||
    "";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [modal, setModal] = useState(null);
  const [detailSupplier, setDetailSupplier] = useState(null);
  const [usageSupplier, setUsageSupplier] = useState(null);
  const [outletFilter, setOutletFilter] = useState("all");
  const [usageMap, setUsageMap] = useState({});
  const [supplierLoadState, setSupplierLoadState] = useState(store.suppliers.length ? "ready" : "initializing");
  const [loadedOutletScope, setLoadedOutletScope] = useState("");
  const canCreateSupplier = canCreate(auth, "suppliers");
  const canEditSupplier = canEdit(auth, "suppliers");
  const canDeleteSupplier = canDelete(auth, "suppliers");
  const canDeactivateSupplier = hasPermission(auth, "suppliers.deactivate") || canEditSupplier;
  const activeOutlets = useMemo(() => store.outlets.filter((outlet) => outlet.status === "active"), [store.outlets]);
  const accessibleOutletIds = useMemo(() => new Set(activeOutlets.map((outlet) => outlet.id)), [activeOutlets]);
  const outletScopeKey = useMemo(() => activeOutlets.map((outlet) => outlet.id).sort().join("|"), [activeOutlets]);
  const assignedOutletCount = auth.profile?.role_outlet_ids?.length ?? 0;
  const outletAccessReady = auth.isProtectedRole || activeOutlets.length > 0 || assignedOutletCount === 0;
  const supplierPageReady = supplierLoadState === "ready";

  function getSupplierOutletIds(supplier) {
    return (supplier.outletIds ?? usageMap[supplier.id]?.outletIds ?? []).filter((outletId) => accessibleOutletIds.has(outletId));
  }

  const rows = useMemo(
    () =>
      store.suppliers.filter((supplier) => {
        const matchesQuery = supplier.name.toLowerCase().includes(query.toLowerCase());
        const matchesCategory = category === "all" || supplier.default_category_id === category;
        const matchesStatus = status === "all" || supplier.status === status;
        const outletIds = getSupplierOutletIds(supplier);
        const matchesOutlet = outletFilter === "all" ? outletIds.length > 0 : outletIds.includes(outletFilter);
        return matchesQuery && matchesCategory && matchesStatus && matchesOutlet;
      }),
    [accessibleOutletIds, category, outletFilter, query, status, store.suppliers, usageMap],
  );
  useEffect(() => {
    if (store.suppliers.length) setSupplierLoadState("ready");
  }, [store.suppliers.length]);

  useEffect(() => {
    if (!auth.session || auth.loading || auth.contextLoading || !outletAccessReady) return undefined;
    if (!outletScopeKey && assignedOutletCount > 0) return undefined;
    if (loadedOutletScope === outletScopeKey) {
      if (supplierLoadState !== "ready") setSupplierLoadState("ready");
      return undefined;
    }
    if (store.suppliers.length) {
      setLoadedOutletScope(outletScopeKey);
      setSupplierLoadState("ready");
      return undefined;
    }

    let cancelled = false;
    setSupplierLoadState("initializing");
    supplierService.listSuppliers()
      .then((suppliers) => {
        if (cancelled) return;
        setStore((current) => ({ ...current, suppliers }));
        setLoadedOutletScope(outletScopeKey);
        setSupplierLoadState("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Unable to load suppliers", error);
        setSupplierLoadState("ready");
        ui.notify({ title: "Unable to load suppliers", message: error.message, tone: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [
    assignedOutletCount,
    auth.contextLoading,
    auth.isProtectedRole,
    auth.loading,
    auth.session,
    loadedOutletScope,
    outletAccessReady,
    outletScopeKey,
    setStore,
    store.suppliers.length,
    supplierLoadState,
    ui,
  ]);

  useEffect(() => {
    if (!store.suppliers.length) return undefined;
    let cancelled = false;
    supplierService.getSupplierUsageMap(store.suppliers.map((supplier) => supplier.id))
      .then((nextUsageMap) => {
        if (!cancelled) setUsageMap(nextUsageMap);
      })
      .catch((error) => {
        console.error("Unable to load supplier usage", error);
      });
    return () => {
      cancelled = true;
    };
  }, [store.suppliers]);

  useEffect(() => {
    if (outletFilter !== "all" && !accessibleOutletIds.has(outletFilter)) {
      setOutletFilter("all");
    }
  }, [accessibleOutletIds, outletFilter]);

  function getSupplierUsage(supplier) {
    return usageMap[supplier.id] ?? {
      outletIds: supplier.outletIds ?? [],
      purchaseRecordCount: 0,
      latestPurchase: null,
    };
  }

  function formatOutletUsage(supplier) {
    const outletIds = getSupplierOutletIds(supplier);
    const count = outletIds.length;
    if (!count) return <span className="text-text-muted">0 outlets</span>;
    return (
      <button
        className="rounded-full px-2 py-1 text-xs font-bold text-primary transition hover:bg-primary-soft"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setUsageSupplier(supplier);
        }}
      >
        {count} {count === 1 ? "outlet" : "outlets"}
      </button>
    );
  }

  function getOutletNames(supplier) {
    return getSupplierOutletIds(supplier)
      .map((outletId) => store.outlets.find((outlet) => outlet.id === outletId)?.name)
      .filter(Boolean);
  }

  function getActivityStatus(supplier) {
    const latestPurchase = getSupplierUsage(supplier).latestPurchase;
    if (!latestPurchase) return { label: "No history", tone: "neutral", health: "Unused", healthTone: "neutral" };
    const distance = periodDistance(latestPurchase, { month: filters.month, year: filters.year });
    if (distance === null || distance <= 0) return { label: "Recent", tone: "success", health: "Stable", healthTone: "success" };
    if (distance <= 2) return { label: "Idle", tone: "warning", health: "Stable", healthTone: "success" };
    return { label: "Dormant", tone: "danger", health: "Dormant", healthTone: "danger" };
  }

  async function updateSupplierStatus(row, nextActive) {
    if (!canDeactivateSupplier) {
      notifyPermissionDenied(ui, "deactivate suppliers");
      return;
    }
    const confirmMessage = nextActive
      ? `${row.name} will become available for new purchase entries.`
      : `${row.name} will be hidden from new supplier/import selections but historical purchase records remain intact.`;
    if (!(await ui.confirm({ title: `${nextActive ? "Reactivate" : "Deactivate"} supplier?`, message: confirmMessage, danger: !nextActive, confirmLabel: nextActive ? "Reactivate" : "Deactivate" }))) return;
    try {
      const saved = await supplierService.setSupplierActive(row, nextActive);
      setStore((current) => ({
        ...current,
        suppliers: current.suppliers.map((supplier) => (supplier.id === saved.id ? saved : supplier)),
      }));
      ui.notify({ title: nextActive ? "Supplier reactivated" : "Supplier deactivated", message: "Saved successfully." });
    } catch (error) {
      console.error("Unable to update supplier status", error);
      ui.notify({ title: "Unable to update supplier", message: error.message, tone: "error" });
    }
  }

  async function deleteSupplier(row) {
    if (!canDeleteSupplier) {
      notifyPermissionDenied(ui, "delete suppliers");
      return;
    }
    if (!(await ui.confirm({ title: "Delete supplier?", message: `${row.name} will be permanently removed. This is only allowed when it has no purchase records.`, danger: true, confirmLabel: "Delete" }))) return;
    try {
      await supplierService.deleteSupplier(row);
      setStore((current) => ({
        ...current,
        suppliers: current.suppliers.filter((supplier) => supplier.id !== row.id),
      }));
      ui.notify({ title: "Supplier deleted", message: "Saved successfully." });
    } catch (error) {
      console.error("Unable to delete supplier", error);
      ui.notify({ title: "Unable to delete supplier", message: error.message, tone: "error" });
    }
  }

  function getSelectedMonthTotal(row) {
    return toCurrency(sumAmount(store.purchaseRecords.filter((record) => {
      const matchesSupplier = record.supplier_id === row.id;
      const matchesPeriod = record.month === filters.month && record.year === filters.year;
      const matchesOutlet = outletFilter === "all" ? true : record.outlet_id === outletFilter;
      return matchesSupplier && matchesPeriod && matchesOutlet;
    })));
  }

  const fields = [
    { name: "name", label: "Supplier Name", placeholder: "Supplier name", formatOnBlur: formatSupplierName },
    {
      name: "default_category_id",
      label: "Category",
      type: "select",
      options: store.purchaseCategories.map((item) => ({ value: item.id, label: item.name })),
    },
    {
      name: "outletIds",
      label: "Used By Outlets",
      type: "multiselect",
      options: activeOutlets.map((outlet) => ({ value: outlet.id, label: outlet.name })),
      helper: "Select every outlet that can use this supplier.",
    },
    { name: "phone", label: "Phone", placeholder: "Supplier phone" },
    { name: "remark", label: "Remark", placeholder: "Optional supplier note" },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
    },
  ];
  const columns = [
    { key: "name", header: "Supplier Name", sticky: true, render: (row) => <span className="font-semibold">{row.name}</span> },
    { key: "category", header: "Category", render: (row) => getCategoryName(store.purchaseCategories, row.default_category_id) },
    {
      key: "remark",
      header: "Remark",
      render: (row) => {
        const remark = String(row.remark ?? "").trim();
        if (!remark) return <span className="text-text-muted">—</span>;
        return <span className="block max-w-[220px] truncate text-sm text-text-secondary" title={remark}>{truncateText(remark)}</span>;
      },
    },
    {
      key: "outlet_usage",
      header: "Outlet Usage",
      render: (row) => <span className="text-sm font-medium text-text-secondary">{formatOutletUsage(row)}</span>,
    },
    {
      key: "last_purchase",
      header: "Last Purchase",
      render: (row) => {
        return <span className="text-sm font-semibold text-text-primary">{purchasePeriodLabel(getSupplierUsage(row).latestPurchase)}</span>;
      },
    },
    {
      key: "total",
      header: "Total Purchase This Month",
      align: "right",
      render: (row) => getSelectedMonthTotal(row),
    },
    {
      key: "health",
      header: "Supplier Health",
      render: (row) => {
        const activity = getActivityStatus(row);
        return <Badge tone={activity.healthTone}>{activity.health}</Badge>;
      },
    },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
    {
      key: "action",
      header: "Actions",
      align: "right",
      render: (row) => (
        <div className="flex flex-wrap justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
          {canEditSupplier ? <button className="rounded-full border border-border px-2.5 py-1 text-xs font-bold text-text-secondary transition hover:bg-slate-50" type="button" onClick={() => setModal({ mode: "edit", row })}>
            <Edit3 className="inline" size={12} /> Edit
          </button> : null}
          {canDeactivateSupplier ? <button className="rounded-full border border-amber-200 px-2.5 py-1 text-xs font-bold text-amber-700 transition hover:bg-amber-50" type="button" onClick={() => updateSupplierStatus(row, row.status !== "active")}>
            <Power className="inline" size={12} /> {row.status === "active" ? "Deactivate" : "Reactivate"}
          </button> : null}
          {canDeleteSupplier ? <button
            className="rounded-full border border-rose-200 px-2.5 py-1 text-xs font-bold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            disabled={getSupplierUsage(row).purchaseRecordCount > 0}
            title={getSupplierUsage(row).purchaseRecordCount > 0 ? "This supplier is already used in purchase records. Deactivate it instead." : "Delete supplier"}
            onClick={() => deleteSupplier(row)}
          >
            <Trash2 className="inline" size={12} /> Delete
          </button> : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        section="Purchases"
        title="Suppliers"
        description="Suppliers used across all outlets and purchase records."
        actions={canCreateSupplier ? <button className="btn-primary" onClick={() => setModal({ mode: "add" })}><Plus size={16} /> Add Supplier</button> : <Badge tone="neutral">Read-only access</Badge>}
      />
      {!canCreateSupplier && !canEditSupplier && !canDeleteSupplier ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Read-only access. You need supplier create, edit, or delete permission to change suppliers.
        </div>
      ) : null}
      <FilterBar compact>
        <SelectField
          label="Outlet"
          value={outletFilter}
          placeholder="All Outlets"
          className="min-w-56"
          searchable
          options={[
            { value: "all", label: "All Outlets" },
            ...activeOutlets.map((outlet) => ({ value: outlet.id, label: outlet.name })),
          ]}
          onChange={(nextValue) => setOutletFilter(nextValue || "all")}
        />
        <MonthSelector value={filters.month} onChange={filters.setMonth} />
        <YearSelector value={filters.year} onChange={filters.setYear} />
        <FieldLabel label="Search">
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-text-muted">⌕</span>
            <input className="control w-full pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search supplier..." />
          </div>
        </FieldLabel>
        <FieldLabel label="Category">
          <SelectField
            value={category === "all" ? "" : category}
            placeholder="All Categories"
            searchable
            options={store.purchaseCategories.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(nextValue) => setCategory(nextValue || "all")}
          />
        </FieldLabel>
        <FieldLabel label="Status">
          <SelectField
            value={status === "all" ? "" : status}
            placeholder="All Status"
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
            onChange={(nextValue) => setStatus(nextValue || "all")}
          />
        </FieldLabel>
      </FilterBar>
      <Card title="Supplier Directory" description="Suppliers used across all outlets and purchase records.">
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          onRowClick={(row) => setDetailSupplier(row)}
        />
        {!supplierPageReady ? (
          <div className="border-t border-border p-6 text-sm font-semibold text-text-secondary">Loading suppliers...</div>
        ) : !rows.length ? (
          <div className="border-t border-border p-6 text-sm text-text-secondary">
            <div className="font-bold text-text-primary">{outletFilter === "all" ? "No suppliers found." : "No suppliers found for this outlet."}</div>
            <p className="mt-1">{outletFilter === "all" ? "Adjust filters or add a supplier." : "Suppliers will appear here after purchase records are added."}</p>
          </div>
        ) : null}
      </Card>
      {modal ? (
        <EntityModal
          title={modal.mode === "add" ? "Add Supplier" : "Edit Supplier"}
          description="Maintain supplier details used by purchase entry, imports and reporting."
          fields={fields}
          initialValues={modal.row ?? { name: "", default_category_id: fallbackCategoryId, outletIds: [], phone: "", remark: "", status: "active" }}
          onClose={() => setModal(null)}
          onSubmit={async (values) => {
            const isNew = modal.mode === "add";
            if ((isNew && !canCreateSupplier) || (!isNew && !canEditSupplier)) {
              notifyPermissionDenied(ui, isNew ? "create suppliers" : "edit suppliers");
              return;
            }
            if (!values.name?.trim()) return ui.notify({ title: "Supplier name required", tone: "error" });
            if (!values.outletIds?.length) return ui.notify({ title: "Outlet access required", message: "Select at least one outlet for this supplier.", tone: "error" });
            try {
              const categoryName = store.purchaseCategories.find((categoryItem) => categoryItem.id === values.default_category_id)?.name ?? "";
              const saved = await supplierService.saveSupplier({ ...(modal.row ?? {}), ...values, name: formatSupplierName(values.name), category: categoryName });
              setStore((current) => ({
                ...current,
                suppliers: [
                  ...current.suppliers.filter((supplier) => supplier.id !== saved.id),
                  saved,
                ].sort((a, b) => a.name.localeCompare(b.name)),
              }));
              setModal(null);
              ui.notify({ title: "Supplier saved", message: "Saved successfully." });
            } catch (error) {
              console.error("Unable to save supplier", error);
              ui.notify({ title: "Unable to save supplier", message: error.message, tone: "error" });
            }
          }}
        />
      ) : null}
      {usageSupplier ? (
        <Modal
          title="Linked Outlets"
          description={usageSupplier.name}
          onClose={() => setUsageSupplier(null)}
          footer={<button className="btn-primary" type="button" onClick={() => setUsageSupplier(null)}>Done</button>}
        >
          <div className="space-y-2">
            {getOutletNames(usageSupplier).map((outletName) => (
              <div key={outletName} className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-sm font-semibold text-text-primary">{outletName}</div>
            ))}
          </div>
        </Modal>
      ) : null}
      {detailSupplier ? (
        <Modal
          title="Supplier Detail"
          description={detailSupplier.name}
          size="md"
          onClose={() => setDetailSupplier(null)}
          footer={
            <>
              <button className="btn-secondary" type="button" onClick={() => setDetailSupplier(null)}>Close</button>
              {canEditSupplier ? <button className="btn-primary" type="button" onClick={() => { setModal({ mode: "edit", row: detailSupplier }); setDetailSupplier(null); }}>
                <Edit3 size={15} /> Edit Supplier
              </button> : null}
            </>
          }
        >
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ["Supplier Name", detailSupplier.name],
              ["Category", getCategoryName(store.purchaseCategories, detailSupplier.default_category_id)],
              ["Phone", detailSupplier.phone || "—"],
              ["Last Purchase", purchasePeriodLabel(getSupplierUsage(detailSupplier).latestPurchase)],
              ["Total Purchase Selected Month", getSelectedMonthTotal(detailSupplier)],
              ["Status", <Badge key="status" tone={detailSupplier.status === "active" ? "success" : "neutral"}>{detailSupplier.status}</Badge>],
              ["Supplier Health", <Badge key="health" tone={getActivityStatus(detailSupplier).healthTone}>{getActivityStatus(detailSupplier).health}</Badge>],
              ["Outlet Usage", getOutletNames(detailSupplier).length ? getOutletNames(detailSupplier).join(", ") : "0 outlets"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-slate-50 px-3 py-2">
                <div className="text-xs font-bold uppercase text-text-muted">{label}</div>
                <div className="mt-1 text-sm font-semibold text-text-primary">{value}</div>
              </div>
            ))}
            <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 md:col-span-2">
              <div className="text-xs font-bold uppercase text-text-muted">Remark</div>
              <div className="mt-1 text-sm font-semibold text-text-primary">{detailSupplier.remark || "—"}</div>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
