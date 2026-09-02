import { useMemo, useState } from "react";
import { CheckCircle2, Clock3, Tag, Warehouse } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import FactoryPagination, { useFactoryClientPagination } from "../components/FactoryPagination.jsx";
import FactoryMasterTableToolbar from "../components/FactoryMasterTableToolbar.jsx";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryNavigation from "../hooks/useFactoryNavigation.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";

const titleCase = (value) => value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "—";

export default function FactoryStorageLocationsPage() {
  const { storageLocations } = useFactoryMasterData();
  const { can } = useFactoryPermissions();
  const nav = useFactoryNavigation();
  const [search, setSearch] = useState("");
  const rows = useMemo(() => storageLocations.filter((location) => `${location.location_name || ""} ${location.location_code || ""} ${location.location_type || ""}`.toLowerCase().includes(search.toLowerCase())), [storageLocations, search]);
  const pager = useFactoryClientPagination("storage-locations", rows.length, 20, search);
  const active = storageLocations.filter((location) => location.status === "active");

  return <div className="space-y-5">
    <PageHeader section="System" title="Locations" description="Manage Factory physical locations. Storage-enabled locations remain available to inventory and stock workflows." actions={can("factory_storage_locations.create") || can("factory_storage_locations.manage") ? <button className="btn-primary" type="button" onClick={nav.openCreateStorageLocation}><Warehouse size={15} /> Location</button> : null} />
    <div className="grid gap-3 md:grid-cols-4"><MetricCard icon={Warehouse} label="Total Locations" value={storageLocations.length} helper="Active and archived" /><MetricCard icon={CheckCircle2} label="Active" value={active.length} helper="Available to modules" tone="success" /><MetricCard icon={Clock3} label="Archived" value={storageLocations.length - active.length} helper="Historical locations" /><MetricCard icon={Tag} label="Storage Enabled" value={active.filter((location) => location.is_storage_location !== false).length} helper="Available to stock workflows" /></div>
    <Card title="Location Master">
      <FactoryMasterTableToolbar value={search} onChange={setSearch} placeholder="Search locations" />
      <FactoryTable rows={rows.slice(pager.from, pager.to)} columns={[
        { key: "location", label: "Location", className: "w-[40%]", render: (row) => <div><div className="font-bold">{row.location_name || "—"}</div>{row.location_code ? <div className="text-xs text-text-secondary">{row.location_code}</div> : null}</div> },
        { key: "type", label: "Type", className: "w-[24%]", render: (row) => titleCase(row.location_type) },
        { key: "storage", label: "Storage", className: "w-[16%]", render: (row) => <Badge tone={row.is_storage_location !== false ? "info" : "neutral"}>{row.is_storage_location !== false ? "Enabled" : "Disabled"}</Badge> },
        { key: "status", label: "Status", className: "w-[15%]", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status === "active" ? "Active" : "Archived"}</Badge> },
        { key: "actions", label: "Actions", className: "w-[15%]", align: "right", render: (row) => <div className="flex justify-end gap-2 whitespace-nowrap">{can("factory_storage_locations.edit") || can("factory_storage_locations.manage") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => nav.openEditStorageLocation(row)}>Edit</button> : null}{(can("factory_storage_locations.delete") || can("factory_storage_locations.manage")) && row.status !== "archived" ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => nav.archiveStorageLocation(row)}>Archive</button> : null}</div> },
      ]} emptyTitle="No locations" />
      <FactoryPagination page={pager.page} pageSize={pager.pageSize} total={rows.length} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
    </Card>
  </div>;
}
