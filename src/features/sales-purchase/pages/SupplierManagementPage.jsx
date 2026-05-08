import { useMemo, useState } from "react";
import { Plus, Settings, Trash2 } from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import { FieldLabel, MonthSelector, OutletSelector, YearSelector } from "../../../components/forms/Selectors.jsx";
import EntityModal from "../components/EntityModal.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { operationsService } from "../services/operationsService.js";
import { getCategoryName, sumAmount, toCurrency } from "../utils/analytics.js";

export default function SupplierManagementPage({ store, setStore, ui }) {
  const filters = usePeriodFilters(store);
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
              setStore((current) => operationsService.deactivateSupplier(current, row.id));
              ui.notify({ title: "Supplier deactivated", message: row.name });
            }
          }}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <FilterBar compact actions={<button className="btn-primary" onClick={() => setModal({ mode: "add" })}><Plus size={16} /> Add Supplier</button>}>
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
          <select className="control" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All Categories</option>
            {store.purchaseCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </FieldLabel>
        <FieldLabel label="Status">
          <select className="control" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </FieldLabel>
      </FilterBar>
      <Card title="Suppliers" description="Supplier master data is independent from purchase records.">
        <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} />
      </Card>
      {modal ? (
        <EntityModal
          title={modal.mode === "add" ? "Add Supplier" : "Edit Supplier"}
          description="Assign a default category for faster purchase entry."
          fields={fields}
          initialValues={modal.row ?? { name: "", default_category_id: "cat-others", status: "active" }}
          onClose={() => setModal(null)}
          onSubmit={(values) => {
            if (!values.name?.trim()) return ui.notify({ title: "Supplier name required", tone: "error" });
            if (modal.mode === "add") {
              const result = operationsService.addSupplier(store, values.name, values.default_category_id);
              setStore(result.state);
            } else {
              setStore((current) => operationsService.updateSupplier(current, modal.row.id, values));
            }
            setModal(null);
            ui.notify({ title: "Supplier saved", message: values.name });
          }}
        />
      ) : null}
    </div>
  );
}
