import { DollarSign, Package, PackageCheck, Truck, Warehouse } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";

function rawMaterialStatusTone(status) {
  if (status === "Out of Stock") return "danger";
  if (status === "Low Stock") return "warning";
  return "success";
}

export default function FactoryRawMaterialDetailModal({ material, receivings, movements, stockChecks, costSummary, onClose, materialLabel, formatDate, formatQuantity, formatSignedQuantity, formatUnitCost, stockVarianceTone, statusTone }) {
  const materialReceivings = receivings.filter((row) => row.raw_material_id === material.id);
  const materialMovements = movements.filter((row) => row.raw_material_id === material.id);
  const materialChecks = stockChecks.flatMap((check) => (check.items || [])
    .filter((item) => item.raw_material_id === material.id)
    .map((item) => ({ ...item, check_no: check.check_no, check_date: check.check_date, status: check.status })));
  const latestReceiving = materialReceivings[0];
  const movementReference = (movement) => {
    const referenceType = String(movement.reference_type || "").toLowerCase();
    if (referenceType === "production") return movement.production_batch_no || movement.production_job_order_no || "—";
    if (referenceType === "raw_material_receiving") return materialReceivings.find((row) => row.id === movement.reference_id)?.receiving_no || "—";
    if (referenceType === "raw_material_stock_check") {
      const stockCheck = stockChecks.find((row) => row.id === movement.reference_id);
      const storedReference = String(movement.reference_no || "").trim();
      return stockCheck?.check_no || (/^RMSC-?\d{6}-\d+$/i.test(storedReference) ? storedReference : "—");
    }
    const fallback = String(movement.reference_no || "").trim();
    return !fallback || /^PRD(?:-|\d)/i.test(fallback) || /^RMR-/i.test(fallback) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fallback) ? "—" : fallback;
  };
  const materialInfo = [
    ["Category", material.category || "No category"],
    ["Code", material.material_code || "—"],
    ["UOM", material.uom || "—"],
    ["Storage Location", material.storage_location || "—"],
    ["Status", <Badge key="status" tone={rawMaterialStatusTone(material.stock_status)}>{material.stock_status || material.status || "Active"}</Badge>],
  ];

  return (
    <Modal title="Material Record" description={materialLabel(material)} onClose={onClose} size="2xl">
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-white p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-black text-text-primary">{materialLabel(material)}</div>
              <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {materialInfo.map(([label, value]) => <div key={label}><div className="text-xs font-semibold text-text-muted">{label}</div><div className="mt-0.5 text-sm font-bold text-text-primary">{value}</div></div>)}
              </div>
            </div>
            {material.image_url ? <img className="h-[120px] w-[120px] shrink-0 rounded-2xl border border-border bg-slate-50 object-cover" src={material.image_url} alt={materialLabel(material)} /> : <div className="flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded-2xl border border-border bg-slate-50 text-text-secondary"><Package size={34} /></div>}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={Warehouse} label="Current Balance" value={formatQuantity(material.current_balance, material.uom)} helper={material.material_code || "Raw material"} />
          <MetricCard icon={PackageCheck} label="Latest Unit Cost" value={costSummary.latestCost.missingCost ? "Missing Cost" : formatUnitCost(costSummary.latestCost)} helper={costSummary.latestCost.receivedDate || costSummary.latestCost.costSource || "No receiving cost"} />
          <MetricCard icon={DollarSign} label="Current Value" value={costSummary.currentValueLabel} helper={costSummary.currentValueHelper} tone={costSummary.isWarning ? "warning" : "success"} />
          <MetricCard icon={Truck} label="Last Receiving" value={latestReceiving ? formatDate(latestReceiving.received_date) : "—"} helper={latestReceiving?.supplier_name || "No receiving yet"} />
        </div>
        <Card title="Receiving History" description="Supplier receiving rows linked to this raw material.">
          <FactoryTable columns={[
            { key: "received_date", label: "Date", render: (row) => formatDate(row.received_date) },
            { key: "receipt", label: "Receiving", render: (row) => <span className="font-bold text-text-primary">{row.receiving_no || "—"}</span> },
            { key: "supplier_name", label: "Supplier", render: (row) => row.supplier_name || "—" },
            { key: "batch_no", label: "Lot", render: (row) => row.batch_no ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-text-secondary">Lot {row.batch_no}</span> : "—" },
            { key: "qty", label: "Qty", render: (row) => formatQuantity(row.received_qty, row.uom) },
            { key: "unit_cost", label: "Unit Cost", align: "right", render: (row) => Number(row.unit_cost || 0) > 0 ? `${costSummary.formatMoney(row.unit_cost)}/${row.uom || material.uom || ""}` : "—" },
          ]} rows={materialReceivings} emptyTitle="No receiving history" emptyDescription="Record receiving for this raw material to populate receiving history." />
        </Card>
        <Card title="Stock Movement History" description="Receiving, production usage and approved stock check movements.">
          <FactoryTable columns={[
            { key: "movement_date", label: "Date", render: (row) => formatDate(row.movement_date) },
            { key: "movement_type", label: "Type", render: (row) => <Badge tone={row.quantity >= 0 ? "success" : "warning"}>{row.movement_type}</Badge> },
            { key: "reference", label: "Reference", render: (row) => <span className="font-bold text-text-primary">{movementReference(row)}</span> },
            { key: "quantity", label: "Qty", render: (row) => formatSignedQuantity(row.quantity, row.uom) },
            { key: "notes", label: "Notes", render: (row) => row.notes || "—" },
          ]} rows={materialMovements} emptyTitle="No movement history" emptyDescription="Receiving, production usage and approved stock checks will create movement history." />
        </Card>
        {materialChecks.length ? <Card title="Stock Check History" description="Physical count rows for this raw material."><FactoryTable columns={[
          { key: "check_date", label: "Date", render: (row) => formatDate(row.check_date) },
          { key: "check_no", label: "Check No.", render: (row) => <span className="font-bold text-text-primary">{row.check_no || "—"}</span> },
          { key: "variance_qty", label: "Variance Qty", render: (row) => formatQuantity(row.variance_qty, row.uom) },
          { key: "variance_status", label: "Variance", render: (row) => <Badge tone={stockVarianceTone(row.variance_status)}>{row.variance_status}</Badge> },
          { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
        ]} rows={materialChecks} emptyTitle="No stock check history" emptyDescription="Approved and submitted raw stock checks for this material will appear here." /></Card> : null}
      </div>
    </Modal>
  );
}
