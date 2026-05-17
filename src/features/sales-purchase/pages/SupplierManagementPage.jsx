import { useMemo, useState } from "react";
import { Plus, Settings, Trash2 } from "lucide-react";
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
  const fields = [
    { name: "name", label: "Supplier Name", placeholder: "Supplier name" },
    {
      name: "default_category_id",
      label: "Default Category",
      type: "select",
      options: store.purchaseCategories.map((item) => ({ value: item.id, label: item.name })),
    },
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
      key: "total",
      header: "Total Purchase This Month",
      align: "right",
      render: (row) => toCurrency(sumAmount(store.purchaseRecords.filter((record) => record.supplier_id === row.id && record.outlet_id === filters.outletId && record.month === filters.month && record.year === filters.year))),
    },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (row) => (
        <div className="flex justify-end gap-2">
          <button className="icon-btn" onClick={() => setModal({ mode: "edit", row })}><Settings size={15} /></button>
          <button className="icon-btn" onClick={async () => {
            if (await ui.confirm({ title: "Deactivate supplier?", message: `${row.name} will remain in history but cannot be selected by default.`, danger: true, confirmLabel: "Deactivate" })) {
              try {
                const saved = await supplierService.deactivateSupplier(row);
                setStore((current) => ({
                  ...current,
                  suppliers: current.suppliers.map((supplier) => (supplier.id === saved.id ? saved : supplier)),
                }));
                ui.notify({ title: "Supplier deactivated", message: "Saved to Supabase" });
              } catch (error) {
                console.error("Unable to deactivate supplier", error);
                ui.notify({ title: "Unable to deactivate supplier", message: error.message, tone: "error" });
              }
            }
          }}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        section="Purchases"
        title="Suppliers"
        description="Supplier master data used by purchase records through supplier_id."
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
      <Card title="Supplier Directory" description="Supplier master data is independent from purchase records.">
        <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} />
      </Card>
      {modal ? (
        <EntityModal
          title={modal.mode === "add" ? "Add Supplier" : "Edit Supplier"}
          description="Assign a default category for faster purchase entry."
          fields={fields}
          initialValues={modal.row ?? { name: "", default_category_id: fallbackCategoryId, status: "active" }}
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
