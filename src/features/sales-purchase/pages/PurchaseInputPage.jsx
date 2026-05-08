import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import PeriodFilterBar from "../components/PeriodFilterBar.jsx";
import SummaryPanel from "../components/SummaryPanel.jsx";
import EntityModal from "../components/EntityModal.jsx";
import usePeriodFilters from "../hooks/usePeriodFilters.js";
import { operationsService } from "../services/operationsService.js";
import {
  getCategoryName,
  getNetSales,
  getPreviousPeriod,
  getSupplierName,
  percentageChange,
  sumAmount,
  toCurrency,
  toPercent,
} from "../utils/analytics.js";

function getLock(store, outletId, month, year) {
  return store.monthlyLocks.find((lock) => lock.outlet_id === outletId && lock.month === month && lock.year === year);
}

function buildPurchaseRows(store, outletId, month, year) {
  return store.purchaseRecords
    .filter((record) => record.outlet_id === outletId && record.month === month && record.year === year)
    .map((record) => ({ ...record }));
}

export default function PurchaseInputPage({ store, setStore, ui }) {
  const filters = usePeriodFilters(store);
  const [saveState, setSaveState] = useState("draft");
  const [rows, setRows] = useState(() => buildPurchaseRows(store, filters.outletId, filters.month, filters.year));
  const [supplierModal, setSupplierModal] = useState(false);
  const previous = getPreviousPeriod(filters.month, filters.year);
  const netSales = getNetSales(store.salesRecords, filters.outletId, filters.month, filters.year);
  const totalPurchase = sumAmount(rows);
  const cogsMargin = netSales ? (totalPurchase / netSales) * 100 : 0;
  const highest = [...rows].sort((a, b) => Number(b.amount) - Number(a.amount))[0];
  const isLocked = Boolean(getLock(store, filters.outletId, filters.month, filters.year)?.is_locked);

  useEffect(() => {
    setRows(buildPurchaseRows(store, filters.outletId, filters.month, filters.year));
  }, [filters.month, filters.outletId, filters.year]);

  function reloadRows(next = filters) {
    setRows(buildPurchaseRows(store, next.outletId, next.month, next.year));
    setSaveState("draft");
  }

  const columns = [
    {
      key: "supplier",
      header: "Supplier",
      sticky: true,
      render: (row, index) => (
        <select
          className="control min-w-56"
          disabled={isLocked}
          value={row.supplier_id}
          onChange={(event) => {
            const supplier = store.suppliers.find((item) => item.id === event.target.value);
            setRows((current) =>
              current.map((item, itemIndex) =>
                itemIndex === index
                  ? { ...item, supplier_id: event.target.value, category_id: supplier?.default_category_id ?? item.category_id }
                  : item,
              ),
            );
          }}
        >
          {store.suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (row, index) => (
        <select
          className="control min-w-40"
          disabled={isLocked}
          value={row.category_id}
          onChange={(event) =>
            setRows((current) =>
              current.map((item, itemIndex) =>
                itemIndex === index ? { ...item, category_id: event.target.value } : item,
              ),
            )
          }
        >
          {store.purchaseCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "remark",
      header: "Remark",
      render: (row, index) => (
        <input
          className="control w-full"
          disabled={isLocked}
          value={row.remark ?? ""}
          placeholder="Optional"
          onChange={(event) =>
            setRows((current) =>
              current.map((item, itemIndex) =>
                itemIndex === index ? { ...item, remark: event.target.value } : item,
              ),
            )
          }
        />
      ),
    },
    {
      key: "amount",
      header: "Amount",
      render: (row, index) => (
        <input
          className="control w-32"
          type="number"
          disabled={isLocked}
          value={row.amount}
          onChange={(event) =>
            setRows((current) =>
              current.map((item, itemIndex) =>
                itemIndex === index ? { ...item, amount: Number(event.target.value) } : item,
              ),
            )
          }
        />
      ),
    },
    {
      key: "vs",
      header: "vs Previous Period",
      align: "right",
      render: (row) => {
        const previousValue = sumAmount(
          store.purchaseRecords.filter(
            (record) =>
              record.outlet_id === filters.outletId &&
              record.month === previous.month &&
              record.year === previous.year &&
              record.supplier_id === row.supplier_id,
          ),
        );
        const change = percentageChange(Number(row.amount), previousValue);
        return <span className={change > 25 ? "font-semibold text-rose-600" : "font-semibold text-emerald-600"}>{toPercent(change)}</span>;
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const previousValue = sumAmount(store.purchaseRecords.filter((record) => record.outlet_id === filters.outletId && record.month === previous.month && record.year === previous.year && record.supplier_id === row.supplier_id));
        const change = percentageChange(Number(row.amount), previousValue);
        if (change > 30) return <Badge tone="warning">Warning</Badge>;
        return Number(row.amount) > 0 ? <Badge tone="success">Normal</Badge> : <Badge>Empty</Badge>;
      },
    },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (_, index) => (
        <button className="icon-btn" type="button" disabled={isLocked} onClick={async () => {
          if (await ui.confirm({ title: "Delete purchase row?", message: "This row will be removed from the current draft.", danger: true, confirmLabel: "Delete" })) {
            setRows((current) => current.filter((__, itemIndex) => itemIndex !== index));
          }
        }}>
          <Trash2 size={15} />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PeriodFilterBar
        store={store}
        filters={{
          ...filters,
          setOutletId: (value) => {
            filters.setOutletId(value);
            reloadRows({ ...filters, outletId: value });
          },
          setMonth: (value) => {
            filters.setMonth(value);
            reloadRows({ ...filters, month: value });
          },
          setYear: (value) => {
            filters.setYear(value);
            reloadRows({ ...filters, year: value });
          },
        }}
        actions={
          <>
            <button className="btn-secondary" type="button" disabled={isLocked} onClick={() => {
              setRows(buildPurchaseRows(store, filters.outletId, previous.month, previous.year).map((row) => ({ ...row, id: undefined, amount: "" })));
              ui.notify({ title: "Supplier list duplicated", message: "Amounts were cleared for the new month." });
            }}>Duplicate from Previous Month</button>
            <button
              className="btn-primary"
              type="button"
              disabled={isLocked}
              onClick={() => {
                setStore((current) =>
                  operationsService.upsertPurchaseData(current, {
                    outletId: filters.outletId,
                    month: filters.month,
                    year: filters.year,
                    purchaseRows: rows,
                  }),
                );
                setSaveState("saved");
                ui.notify({ title: "Purchase data saved", message: `${rows.length} supplier rows updated.` });
              }}
            >
              <Save size={16} /> Save Purchase Data
            </button>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card
          title="Supplier Purchase Input"
          description="Every row references supplier_id and category_id for clean future analytics."
          action={
            <button
              className="btn-secondary"
              type="button"
              disabled={isLocked}
              onClick={() => setRows((current) => [...current, { supplier_id: store.suppliers[0].id, category_id: "cat-others", remark: "", amount: 0 }])}
            >
              <Plus size={16} /> Add Supplier Row
            </button>
          }
        >
          <DataTable columns={columns} rows={rows} getRowKey={(row, index) => row.id ?? index} />
        </Card>

        <SummaryPanel
          title="Purchase Summary"
          items={[
            { label: "Total Purchase", value: toCurrency(totalPurchase) },
            { label: "Total Suppliers", value: rows.length },
            { label: "Highest Supplier", value: highest ? getSupplierName(store.suppliers, highest.supplier_id) : "-" },
            { label: "Highest Category", value: highest ? getCategoryName(store.purchaseCategories, highest.category_id) : "-" },
            { label: "COGS Margin", value: toPercent(cogsMargin), tone: cogsMargin > 40 ? "danger" : "neutral" },
            { label: "Profit Margin Est.", value: toPercent(100 - cogsMargin) },
            { label: "Save Status", value: saveState === "saved" ? "Saved" : "Draft" },
          ]}
        />
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={isLocked} onClick={() => setSupplierModal(true)}><Plus size={16} /> Add New Supplier</button>
      </div>
      {isLocked ? <div className="card border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">This month is locked. Purchase inputs are disabled until an admin unlocks it.</div> : null}
      {supplierModal ? (
        <EntityModal
          title="Add Supplier"
          description="New supplier becomes selectable immediately."
          fields={[
            { name: "name", label: "Supplier Name", placeholder: "Supplier name" },
            { name: "default_category_id", label: "Default Category", type: "select", options: store.purchaseCategories.map((category) => ({ value: category.id, label: category.name })) },
          ]}
          initialValues={{ name: "", default_category_id: "cat-others" }}
          onClose={() => setSupplierModal(false)}
          onSubmit={(values) => {
            if (!values.name?.trim()) return ui.notify({ title: "Supplier name required", tone: "error" });
            const result = operationsService.addSupplier(store, values.name, values.default_category_id);
            setStore(result.state);
            setRows((current) => [...current, { supplier_id: result.supplier.id, category_id: result.supplier.default_category_id, remark: "", amount: 0 }]);
            setSupplierModal(false);
            ui.notify({ title: "Supplier added", message: values.name });
          }}
        />
      ) : null}
    </div>
  );
}
