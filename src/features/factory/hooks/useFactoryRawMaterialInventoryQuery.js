import { useMemo } from "react";
import useFactoryMasterData from "./useFactoryMasterData.js";
import useFactoryPermissions from "./useFactoryPermissions.js";

const includesText = (value, search) => !search || String(value || "").toLowerCase().includes(String(search).toLowerCase());
const costUnit = (uom) => ({ kg: ["weight", 1000], g: ["weight", 1], l: ["volume", 1000], litre: ["volume", 1000], ml: ["volume", 1] }[String(uom || "").toLowerCase()] || null);
const convert = (value, from, to) => { const left = costUnit(from); const right = costUnit(to); return !left || !right || left[0] !== right[0] ? null : Number(value || 0) * left[1] / right[1]; };
const latestCost = (receivings, material) => { const row = [...receivings].filter((item) => item.raw_material_id === material.id && Number(item.unit_cost || 0) > 0).sort((a, b) => new Date(b.received_date || b.created_at || 0) - new Date(a.received_date || a.created_at || 0))[0]; return row ? { unitCost: Number(row.unit_cost), uom: row.uom || "", missing: false, source: "Receiving Cost", receivedDate: row.received_date || "" } : Number(material.manual_unit_cost || 0) > 0 ? { unitCost: Number(material.manual_unit_cost), uom: material.manual_cost_uom || "", missing: false, source: "Manual Cost", receivedDate: "" } : { unitCost: 0, uom: "", missing: true, source: "Missing Cost", receivedDate: "" }; };

export default function useFactoryRawMaterialInventoryQuery({ filters }) {
  const { rawMaterials, rawMaterialCategories, receivings, rawMaterialMovements } = useFactoryMasterData();
  const { can } = useFactoryPermissions();
  const materials = Array.isArray(rawMaterials) ? rawMaterials : [];
  const categories = Array.isArray(rawMaterialCategories) ? rawMaterialCategories : [];
  const receivingRows = Array.isArray(receivings) ? receivings : [];
  const movementRows = Array.isArray(rawMaterialMovements) ? rawMaterialMovements : [];
  return useMemo(() => {
    if (!can("factory_raw_inventory.view")) return { rows: [], loading: false, error: "Some Raw Material Inventory data is hidden by your current role.", errorKind: "permission", retry: () => {} };
    const allRows = materials.map((material) => {
      const materialReceivings = receivingRows.filter((row) => row.raw_material_id === material.id);
      const movements = movementRows.filter((row) => row.raw_material_id === material.id);
      const consumption = movements.filter((row) => Number(row.quantity || 0) < 0 || String(row.movement_type || "").toLowerCase().includes("production"));
      const lastReceiving = [...materialReceivings].sort((a, b) => new Date(b.received_date || b.created_at || 0) - new Date(a.received_date || a.created_at || 0))[0];
      const lastConsumption = [...consumption].sort((a, b) => new Date(b.movement_date || b.created_at || 0) - new Date(a.movement_date || a.created_at || 0))[0];
      const latest = latestCost(receivingRows, material); const balance = Number(material.current_balance || 0); const converted = latest.missing ? null : convert(balance, material.uom, latest.uom);
      return { ...material, last_receiving_date: lastReceiving?.received_date || "", last_consumption_date: lastConsumption?.movement_date || "", latest_cost: latest.unitCost, latest_cost_uom: latest.uom, latest_cost_missing: latest.missing, latest_cost_source: latest.source, latest_cost_unsupported: !latest.missing && converted == null, inventory_value: converted == null ? null : converted * latest.unitCost, stock_status: balance <= 0 ? "Out of Stock" : Number(material.min_stock_level || 0) > 0 && balance <= Number(material.min_stock_level) ? "Low Stock" : "In Stock" };
    });
    const rows = allRows.filter((row) => includesText(`${row.name} ${row.name_en} ${row.name_cn} ${row.name_bm} ${row.material_code}`, filters.material) && (!filters.status || row.status === filters.status || row.stock_status === filters.status) && (!filters.category || row.category_id === filters.category || row.category === filters.category));
    return { rows, allRows, categories, loading: false, error: "", errorKind: "", retry: () => {} };
  }, [can, categories, filters, materials, movementRows, receivingRows]);
}
