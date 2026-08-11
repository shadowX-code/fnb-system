import { Activity, Factory, PackageCheck, Truck } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import { money } from "../utils/factoryFormatters.js";

export default function FactoryFinishedGoodDetailModal({ product, productions, movements, productionCosts, onClose, formatBalance, formatDate, formatQuantity, productionBatchReference, productionJobOrderReference }) {
  const productKey = String(product.product_name || "").toLowerCase();
  const productProductions = productions.filter((row) => String(row.product_name || "").toLowerCase() === productKey);
  const productMovements = movements.filter((row) => row.finished_good_id === product.id || String(row.product_name || "").toLowerCase() === productKey);
  const costRows = productionCosts.filter((row) => String(row.product_name || "").toLowerCase() === productKey);
  const totalActualCost = costRows.reduce((sum, row) => sum + Number(row.actual_cost || 0), 0);
  const totalGoodOutput = productProductions.reduce((sum, row) => sum + Number(row.good_output_qty || row.produced_quantity || 0), 0);
  const averageCost = totalGoodOutput ? totalActualCost / totalGoodOutput : 0;
  const hasCostData = costRows.some((row) => (row.material_usage || []).length);
  const hasMissingCost = !hasCostData || costRows.some((row) => row.missing_cost_rows);
  const batchRows = productProductions.filter((row) => row.batch_no);

  return (
    <Modal title={product.product_name} description="Finished goods stock, production and movement detail" onClose={onClose} size="2xl">
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard icon={PackageCheck} label="Current Balance" value={formatBalance(product)} helper={product.product_code || "Packaging SKU"} />
          <MetricCard icon={Factory} label="Production Runs" value={productProductions.length} helper="Completed history" />
          <MetricCard icon={Activity} label="Movements" value={productMovements.length} helper="Stock movement rows" />
          <MetricCard icon={Truck} label="Avg Actual Cost" value={hasMissingCost ? "Missing Cost" : money(averageCost)} helper="From actual usage" />
        </div>
        <Card title="Production History" description="Completed production records for this finished good.">
          <FactoryTable columns={[
            { key: "production", label: "Production", render: (row) => <div><div className="font-bold text-text-primary">{productionBatchReference(row)}</div><div className="text-xs text-text-secondary">{productionJobOrderReference(row)}</div></div> },
            { key: "production_date", label: "Date", render: (row) => formatDate(row.production_date) },
            { key: "output", label: "Good Output", render: (row) => formatQuantity(row.good_output_qty || row.produced_quantity, row.uom) },
            { key: "qc_status", label: "QC", render: (row) => <Badge tone={row.qc_status === "Pass" ? "success" : row.qc_status === "Failed" ? "danger" : row.qc_status === "Hold" ? "warning" : "neutral"}>{row.qc_status}</Badge> },
          ]} rows={productProductions} emptyTitle="No production history" emptyDescription="Complete production first to create finished goods production history." />
        </Card>
        <Card title="Movement History" description="Finished goods stock movements linked to this SKU.">
          <FactoryTable columns={[
            { key: "reference_no", label: "Reference", render: (row) => <div><div className="font-bold text-text-primary">{row.reference_no || "—"}</div><div className="text-xs text-text-secondary">{row.reference_type || "No source"}</div></div> },
            { key: "movement_type", label: "Movement", render: (row) => <Badge tone={row.quantity >= 0 ? "success" : "warning"}>{row.movement_type}</Badge> },
            { key: "quantity", label: "Qty", render: (row) => formatQuantity(row.quantity, row.uom) },
            { key: "movement_date", label: "Date", render: (row) => formatDate(row.movement_date) },
          ]} rows={productMovements} emptyTitle="No movement history" emptyDescription="Production stock-in and stock check adjustments will appear here." />
        </Card>
        <Card title="Batch History" description="Batch numbers from completed production runs.">
          <FactoryTable columns={[
            { key: "batch_no", label: "Batch", render: (row) => row.batch_no || "—" },
            { key: "job_order", label: "Job Order", render: (row) => productionJobOrderReference(row) },
            { key: "production_date", label: "Date", render: (row) => formatDate(row.production_date) },
            { key: "operator_name", label: "Operator", render: (row) => row.operator_name || "—" },
          ]} rows={batchRows} emptyTitle="No batch history" emptyDescription="Complete production with a batch number to populate batch history." />
        </Card>
      </div>
    </Modal>
  );
}
