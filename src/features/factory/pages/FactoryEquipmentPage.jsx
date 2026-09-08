import { useMemo, useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import FactoryMasterTableToolbar from "../components/FactoryMasterTableToolbar.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryPagination, { useFactoryClientPagination } from "../components/FactoryPagination.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import { FactoryCellEntity, FactoryCellMuted } from "../components/FactoryTableCell.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";

export default function FactoryEquipmentPage({ onCreate, onEdit, onManageCategories }) {
  const { equipment = [] } = useFactoryMasterData(); const { can } = useFactoryPermissions(); const [search, setSearch] = useState("");
  const rows = useMemo(() => equipment.filter((row) => `${row.name} ${row.equipment_code} ${row.category?.name || ""} ${row.location?.location_name || ""}`.toLowerCase().includes(search.toLowerCase())), [equipment, search]);
  const pager = useFactoryClientPagination("equipment", rows.length, 20, search); const canManage = can("factory_equipment.manage");
  return <div className="space-y-5"><PageHeader section="Master Data" title="Equipment" description="Manage canonical Factory equipment and its current Location." actions={<div className="flex gap-2">{canManage ? <button className="btn-secondary" type="button" onClick={onManageCategories}><Settings2 size={15} /> Categories</button> : null}{(can("factory_equipment.create") || canManage) ? <button className="btn-primary" type="button" onClick={onCreate}><Plus size={15} /> Equipment</button> : null}</div>} /><FactoryMasterTableToolbar value={search} onChange={setSearch} placeholder="Search equipment, code, category or location" /><FactoryDataSurface><FactoryTable rows={rows.slice(pager.from, pager.to)} rowHover="mint" columns={[{ key: "equipment", label: "Equipment", render: (row) => <FactoryCellEntity name={row.name} code={row.equipment_code} /> }, { key: "category", label: "Category", render: (row) => row.category?.name || <FactoryCellMuted /> }, { key: "location", label: "Location", render: (row) => row.location?.location_name || <FactoryCellMuted /> }, { key: "status", label: "Status", render: (row) => <FactoryStatusBadge status={row.status === "active" ? "Active" : row.status?.replaceAll("_", " ")} /> }, { key: "actions", label: "Actions", align: "right", render: (row) => <FactoryRowActions directSingleSecondary secondaryActions={[(can("factory_equipment.edit") || canManage) ? { label: "Edit", onClick: () => onEdit(row) } : null]} /> }]} emptyTitle="No Equipment" /><FactoryPagination page={pager.page} pageSize={pager.pageSize} total={rows.length} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} /></FactoryDataSurface></div>;
}
