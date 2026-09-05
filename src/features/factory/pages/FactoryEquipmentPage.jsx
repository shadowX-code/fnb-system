import { useMemo, useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import FactoryMasterTableToolbar from "../components/FactoryMasterTableToolbar.jsx";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryPagination, { useFactoryClientPagination } from "../components/FactoryPagination.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";

export default function FactoryEquipmentPage({ onCreate, onEdit, onManageCategories }) {
  const { equipment = [] } = useFactoryMasterData(); const { can } = useFactoryPermissions(); const [search, setSearch] = useState("");
  const rows = useMemo(() => equipment.filter((row) => `${row.name} ${row.equipment_code} ${row.category?.name || ""} ${row.location?.location_name || ""}`.toLowerCase().includes(search.toLowerCase())), [equipment, search]);
  const pager = useFactoryClientPagination("equipment", rows.length, 20, search); const canManage = can("factory_equipment.manage");
  return <div className="space-y-5"><PageHeader section="Master Data" title="Equipment" description="Manage canonical Factory equipment and its current Location." actions={<div className="flex gap-2">{canManage ? <button className="btn-secondary" type="button" onClick={onManageCategories}><Settings2 size={15} /> Categories</button> : null}{(can("factory_equipment.create") || canManage) ? <button className="btn-primary" type="button" onClick={onCreate}><Plus size={15} /> Equipment</button> : null}</div>} /><Card title="Equipment Master"><FactoryMasterTableToolbar value={search} onChange={setSearch} placeholder="Search equipment, code, category or Location" /><FactoryTable rows={rows.slice(pager.from, pager.to)} columns={[{ key: "equipment", label: "Equipment", render: (row) => <div className="font-bold">{row.name}</div> }, { key: "code", label: "Code", render: (row) => row.equipment_code }, { key: "category", label: "Category", render: (row) => row.category?.name || "—" }, { key: "location", label: "Location", render: (row) => row.location?.location_name || "—" }, { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status.replaceAll("_", " ")}</Badge> }, { key: "actions", label: "Actions", align: "right", render: (row) => <FactoryRowActions secondaryActions={[(can("factory_equipment.edit") || canManage) ? { label: "Edit", onClick: () => onEdit(row) } : null]} /> }]} emptyTitle="No Equipment" /><FactoryPagination page={pager.page} pageSize={pager.pageSize} total={rows.length} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} /></Card></div>;
}
