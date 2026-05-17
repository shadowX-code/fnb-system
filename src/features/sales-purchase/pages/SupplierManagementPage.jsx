import { useEffect, useMemo, useState } from "react";
import { BarChart3, Edit3, MoreHorizontal, Plus, Settings, Trash2 } from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { FieldLabel, MonthSelector, OutletSelector, YearSelector } from "../../../components/forms/Selectors.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import EntityModal from "../components/EntityModal.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { getCategoryName, sumAmount, toCurrency } from "../utils/analytics.js";
import { supplierService } from "../../../services/supplierService.js";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";

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

export default function SupplierManagementPage({ store, setStore, ui }) {
  const filters = usePeriodFilters(store);
  const fallbackCategoryId =
    store.purchaseCategories.find((categoryItem) => categoryItem.name?.toLowerCase() === "others")?.id ||
    store.purchaseCategories[0]?.id ||
    "";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [modal, setModal] = useState(null);
  const [usageMap, setUsageMap] = useState({});
  const [actionMenuSupplierId, setActionMenuSupplierId] = useState(null);
  const rows = useMemo(
    () =>
      store.suppliers.filter((supplier) => {
        const matchesQuery = supplier.name.toLowerCase().includes(query.toLowerCase());
        const matchesCategory = category === "all" || supplier.default_category_id === category;
        const matchesStatus = status === "all" || supplier.status === status;
        return matchesQuery && matchesCategory && matchesStatus;
      }),
    [category, query, status, store.suppliers],
  );
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

  function getSupplierUsage(supplier) {
    return usageMap[supplier.id] ?? {
      outletIds: [],
      purchaseRecordCount: 0,
      latestPurchase: null,
    };
  }

  function formatOutletUsage(supplier) {
    const outletIds = getSupplierUsage(supplier).outletIds;
    if (!outletIds.length) return <span className="text-text-muted">No purchase records yet</span>;
    const outletNames = outletIds
      .map((outletId) => store.outlets.find((outlet) => outlet.id === outletId)?.name)
      .filter(Boolean);
    if (!outletNames.length) return <span className="text-text-muted">No purchase records yet</span>;
    if (outletNames.length <= 2) return outletNames.join(", ");
    return <span className="cursor-help" title={outletNames.join(", ")}>{outletNames.length} outlets</span>;
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
      ui.notify({ title: nextActive ? "Supplier reactivated" : "Supplier deactivated", message: "Saved to Supabase" });
    } catch (error) {
      console.error("Unable to update supplier status", error);
      ui.notify({ title: "Unable to update supplier", message: error.message, tone: "error" });
    }
  }

  async function deleteSupplier(row) {
    if (!(await ui.confirm({ title: "Delete supplier?", message: `${row.name} will be permanently removed. This is only allowed when it has no purchase records.`, danger: true, confirmLabel: "Delete" }))) return;
    try {
      await supplierService.deleteSupplier(row);
      setStore((current) => ({
        ...current,
        suppliers: current.suppliers.filter((supplier) => supplier.id !== row.id),
      }));
      ui.notify({ title: "Supplier deleted", message: "Saved to Supabase" });
    } catch (error) {
      console.error("Unable to delete supplier", error);
      ui.notify({ title: "Unable to delete supplier", message: error.message, tone: "error" });
    }
  }

  const fields = [
    { name: "name", label: "Supplier Name", placeholder: "Supplier name" },
    {
      name: "default_category_id",
      label: "Category",
      type: "select",
      options: store.purchaseCategories.map((item) => ({ value: item.id, label: item.name })),
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
        const activity = getActivityStatus(row);
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-text-primary">{purchasePeriodLabel(getSupplierUsage(row).latestPurchase)}</span>
            <Badge tone={activity.tone}>{activity.label}</Badge>
          </div>
        );
      },
    },
    {
      key: "total",
      header: "Total Purchase This Month",
      align: "right",
      render: (row) => toCurrency(sumAmount(store.purchaseRecords.filter((record) => record.supplier_id === row.id && record.outlet_id === filters.outletId && record.month === filters.month && record.year === filters.year))),
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
        <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
          <ActionMenu
            open={actionMenuSupplierId === row.id}
            onOpenChange={(nextOpen) => setActionMenuSupplierId(nextOpen ? row.id : null)}
            width={236}
            ariaLabel="Supplier actions"
            trigger={({ toggle, ariaLabel }) => (
              <button className="icon-btn" type="button" aria-label={ariaLabel} onClick={toggle}>
                <MoreHorizontal size={15} />
              </button>
            )}
          >
            <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50" type="button" onClick={() => { setModal({ mode: "edit", row }); setActionMenuSupplierId(null); }}>
              <Edit3 size={14} /> Edit Supplier
            </button>
            <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50" type="button" onClick={() => { ui.navigate?.("purchase-comparison"); setActionMenuSupplierId(null); }}>
              <BarChart3 size={14} /> View Purchase History
            </button>
            <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold text-amber-700 hover:bg-amber-50" type="button" onClick={() => { updateSupplierStatus(row, row.status !== "active"); setActionMenuSupplierId(null); }}>
              <Settings size={14} /> {row.status === "active" ? "Deactivate" : "Reactivate"}
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              disabled={getSupplierUsage(row).purchaseRecordCount > 0}
              title={getSupplierUsage(row).purchaseRecordCount > 0 ? "This supplier is already used in purchase records. Deactivate it instead." : "Delete supplier"}
              onClick={() => {
                deleteSupplier(row);
                setActionMenuSupplierId(null);
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          </ActionMenu>
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
        actions={<button className="btn-primary" onClick={() => setModal({ mode: "add" })}><Plus size={16} /> Add Supplier</button>}
      />
      <FilterBar compact>
        <OutletSelector outlets={store.outlets.filter((outlet) => outlet.status === "active")} value={filters.outletId} onChange={filters.setOutletId} />
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
        <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} />
      </Card>
      {modal ? (
        <EntityModal
          title={modal.mode === "add" ? "Add Supplier" : "Edit Supplier"}
          description="Maintain supplier details used by purchase entry, imports and reporting."
          fields={fields}
          initialValues={modal.row ?? { name: "", default_category_id: fallbackCategoryId, phone: "", remark: "", status: "active" }}
          onClose={() => setModal(null)}
          onSubmit={async (values) => {
            if (!values.name?.trim()) return ui.notify({ title: "Supplier name required", tone: "error" });
            try {
              const categoryName = store.purchaseCategories.find((categoryItem) => categoryItem.id === values.default_category_id)?.name ?? "";
              const saved = await supplierService.saveSupplier({ ...(modal.row ?? {}), ...values, category: categoryName });
              setStore((current) => ({
                ...current,
                suppliers: [
                  ...current.suppliers.filter((supplier) => supplier.id !== saved.id),
                  saved,
                ].sort((a, b) => a.name.localeCompare(b.name)),
              }));
              setModal(null);
              ui.notify({ title: "Supplier saved", message: "Saved to Supabase" });
            } catch (error) {
              console.error("Unable to save supplier", error);
              ui.notify({ title: "Unable to save supplier", message: error.message, tone: "error" });
            }
          }}
        />
      ) : null}
    </div>
  );
}
