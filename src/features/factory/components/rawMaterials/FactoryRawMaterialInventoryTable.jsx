import { ArrowDown, ArrowUp, ArrowUpDown, Package } from "lucide-react";
import Badge from "../../../../components/ui/Badge.jsx";
import { FactoryTable } from "../FactoryDataDisplay.jsx";

function rawMaterialStatusTone(stockStatus) {
  if (stockStatus === "Out of Stock") return "danger";
  if (stockStatus === "Low Stock") return "warning";
  return "success";
}

export default function FactoryRawMaterialInventoryTable({ rows, canEdit, categorySort = "", onCategorySort, materialLabel, formatQuantity, formatDate, formatCost, normalizedCostUnit, onPreviewImage, onOpenCost, onOpenDetail, onEdit }) {
  const columns = [
    { key: "name", label: "Raw Material", render: (row) => {
      const secondaryNames = [row.name_cn, row.name_bm].filter(Boolean).join(" · ");
      return (
        <div className="flex items-center gap-3">
          {row.image_url ? (
            <button className="shrink-0" type="button" onClick={() => onPreviewImage(row)}>
              <img className="h-10 w-10 rounded-lg object-cover ring-1 ring-border transition hover:ring-primary" src={row.image_url} alt={materialLabel(row)} />
            </button>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-text-secondary"><Package size={18} /></div>
          )}
          <div className="min-w-0">
            <div className="font-bold text-text-primary">{materialLabel(row)}</div>
            {secondaryNames ? <div className="text-xs text-text-secondary">{secondaryNames}</div> : null}
          </div>
        </div>
      );
    } },
    { key: "material_code", label: "Code", render: (row) => row.material_code || "—" },
    { key: "category", label: <button className="inline-flex items-center gap-1.5 transition hover:text-text-primary focus:outline-none focus:text-text-primary" type="button" onClick={onCategorySort} aria-label={`Sort Category ${categorySort === "asc" ? "descending" : categorySort === "desc" ? "default" : "ascending"}`}><span>Category</span>{categorySort === "asc" ? <ArrowUp size={13} /> : categorySort === "desc" ? <ArrowDown size={13} /> : <ArrowUpDown className="text-text-secondary" size={13} />}</button>, render: (row) => row.category || "No category" },
    { key: "uom", label: "UOM", render: (row) => row.uom || "—" },
    { key: "current_balance", label: "Current Balance", render: (row) => formatQuantity(row.current_balance, row.uom) },
    { key: "latest_cost", label: "Latest Cost", render: (row) => (
      <button className="font-semibold text-primary underline-offset-2 hover:underline" type="button" onClick={() => onOpenCost(row)}>
        {row.latest_cost_missing ? "Missing Cost" : row.latest_cost_uom ? `${formatCost(row.latest_cost)}/${normalizedCostUnit(row.latest_cost_uom)?.display || row.latest_cost_uom}` : "Unsupported UOM"}
      </button>
    ) },
    { key: "last_receiving_date", label: "Last Receiving", render: (row) => formatDate(row.last_receiving_date) },
    { key: "last_consumption_date", label: "Last Consumption", render: (row) => formatDate(row.last_consumption_date) },
    { key: "status", label: "Status", render: (row) => <Badge tone={rawMaterialStatusTone(row.stock_status)}>{row.stock_status}</Badge> },
    { key: "actions", label: "Actions", align: "right", render: (row) => (
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => onOpenDetail(row)}>Detail</button>
        {canEdit ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => onEdit(row)}>Edit</button> : null}
      </div>
    ) },
  ];

  return <FactoryTable columns={columns} rows={rows} emptyTitle="No raw materials" emptyDescription="Create a raw material before receiving stock or building Product Recipes." />;
}
