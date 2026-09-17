import { useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import { FactoryCellEntity, FactoryCellMuted, FactoryCellSemanticText } from "../components/FactoryTableCell.jsx";
import { quantity } from "../utils/factoryFormatters.js";

function BatchRows({ batches = [] }) {
  const toneFor = (status) => {
    if (status === "Archived") return "gray";
    if (status === "Reconciliation required") return "amber";
    return "green";
  };

  return <div className="border-t border-border bg-surface-muted px-3 py-2">
    <div className="overflow-x-auto">
      <table className="w-full min-w-[440px] text-left text-xs">
        <thead className="text-[10.5px] font-semibold uppercase text-text-muted">
          <tr><th className="px-2 py-1.5">Batch No.</th><th className="px-2 py-1.5 text-right">Qty</th><th className="px-2 py-1.5">UOM</th><th className="px-2 py-1.5">Status</th></tr>
        </thead>
        <tbody>{batches.map((batch) => <tr key={batch.id} className="border-t border-border/70 text-text-secondary">
          <td className="px-2 py-2 font-medium text-text-primary">{batch.batch_no}</td>
          <td className="px-2 py-2 text-right font-medium text-text-primary">{quantity(batch.quantity)}</td>
          <td className="px-2 py-2">{batch.uom || "—"}</td>
          <td className="px-2 py-2"><FactoryCellSemanticText tone={toneFor(batch.status)}>{batch.status}</FactoryCellSemanticText></td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

function InventorySection({ title, rows, emptyTitle, expanded, onToggle }) {
  const columns = [
    { key: "identity", label: title === "Raw Materials" ? "Raw Material" : "Finished Good", render: (row) => <FactoryCellEntity name={row.name} code={row.code} /> },
    { key: "quantity", label: "Current Qty", align: "right", render: (row) => <span className="font-medium text-text-primary">{quantity(row.quantity, row.uom)}</span> },
    { key: "batches", label: "Batches", align: "right", render: (row) => row.batches.length ? <button className="text-xs font-medium text-primary hover:text-primary-700" type="button" aria-expanded={expanded.has(row.id)} onClick={() => onToggle(row.id)}>{row.batches.length} {row.batches.length === 1 ? "batch" : "batches"}</button> : <FactoryCellMuted /> },
  ];
  return <section className="space-y-2">
    <div className="text-sm font-semibold text-text-primary">{title}</div>
    <FactoryDataSurface>
      <FactoryTable columns={columns} rows={rows} emptyTitle={emptyTitle} renderAfterRow={(row) => expanded.has(row.id) ? <BatchRows batches={row.batches} /> : null} />
    </FactoryDataSurface>
  </section>;
}

export default function FactoryLocationInventoryModal({ location, inventory, canViewRawMaterials, canViewFinishedGoods, onClose }) {
  const [expanded, setExpanded] = useState(new Set());
  const toggle = (id) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const rawMaterials = inventory?.rawMaterials || [];
  const finishedGoods = inventory?.finishedGoods || [];
  return <Modal
    title="Location Inventory"
    description={[location.location_name, location.location_type].filter(Boolean).join(" · ")}
    size="xl"
    onClose={onClose}
    footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
  >
    <div className="space-y-5">
      {canViewRawMaterials ? <InventorySection title="Raw Materials" rows={rawMaterials} emptyTitle="No raw materials on hand" expanded={expanded} onToggle={toggle} /> : null}
      {canViewFinishedGoods ? <InventorySection title="Finished Goods" rows={finishedGoods} emptyTitle="No finished goods on hand" expanded={expanded} onToggle={toggle} /> : null}
      {!canViewRawMaterials && !canViewFinishedGoods ? <EmptyState title="Inventory unavailable" description="Your current role does not include Factory inventory access." /> : null}
    </div>
  </Modal>;
}
