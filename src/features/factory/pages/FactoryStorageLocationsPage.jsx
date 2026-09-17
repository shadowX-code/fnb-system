import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Tag, Warehouse } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import FactoryPagination, { useFactoryClientPagination } from "../components/FactoryPagination.jsx";
import FactoryMasterTableToolbar from "../components/FactoryMasterTableToolbar.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import { FactoryCellEntity, FactoryCellLabel, FactoryCellMuted } from "../components/FactoryTableCell.jsx";
import FactoryLocationInventoryModal from "../modals/FactoryLocationInventoryModal.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryLatestRequest from "../hooks/useFactoryLatestRequest.js";
import useFactoryNavigation from "../hooks/useFactoryNavigation.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import { factoryService } from "../../../services/factoryService.js";
import { buildLocationInventoryIndex, locationInventoryCountLabel } from "../utils/locationInventory.js";

const titleCase = (value) => value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "—";

export default function FactoryStorageLocationsPage() {
  const { storageLocations } = useFactoryMasterData();
  const { can } = useFactoryPermissions();
  const nav = useFactoryNavigation();
  const [search, setSearch] = useState("");
  const [inventoryBatches, setInventoryBatches] = useState({ rawMaterialBatches: [], finishedGoodBatches: [] });
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState("");
  const [selectedInventoryLocation, setSelectedInventoryLocation] = useState(null);
  const runLatestRequest = useFactoryLatestRequest();
  const canViewRawMaterials = can("factory_raw_inventory.view");
  const canViewFinishedGoods = can("factory_finished_goods.view");
  const canViewInventory = canViewRawMaterials || canViewFinishedGoods;
  const rows = useMemo(() => storageLocations.filter((location) => `${location.location_name || ""} ${location.location_code || ""} ${location.location_type || ""}`.toLowerCase().includes(search.toLowerCase())), [storageLocations, search]);
  const pager = useFactoryClientPagination("storage-locations", rows.length, 20, search);
  const active = storageLocations.filter((location) => location.status === "active");
  const inventoryByLocation = useMemo(() => buildLocationInventoryIndex(inventoryBatches), [inventoryBatches]);
  const loadInventory = useCallback(() => {
    if (!canViewInventory) {
      setInventoryBatches({ rawMaterialBatches: [], finishedGoodBatches: [] });
      setInventoryError("");
      setInventoryLoading(false);
      return;
    }
    runLatestRequest(
      () => factoryService.getLocationInventory({ includeRawMaterials: canViewRawMaterials, includeFinishedGoods: canViewFinishedGoods }),
      { onStart: () => { setInventoryLoading(true); setInventoryError(""); }, onSuccess: setInventoryBatches, onError: (reason) => setInventoryError(reason.message || "Unable to load current Location inventory."), onFinally: () => setInventoryLoading(false) },
    );
  }, [canViewFinishedGoods, canViewInventory, canViewRawMaterials, runLatestRequest]);
  useEffect(() => { loadInventory(); }, [loadInventory]);

  function inventoryCell(row) {
    if (row.is_storage_location === false || !canViewInventory) return <FactoryCellMuted />;
    if (inventoryLoading) return <FactoryCellMuted>Loading…</FactoryCellMuted>;
    if (inventoryError) return <FactoryCellMuted>Unavailable</FactoryCellMuted>;
    const summary = inventoryByLocation.get(row.id);
    const label = locationInventoryCountLabel(summary, { includeRawMaterials: canViewRawMaterials, includeFinishedGoods: canViewFinishedGoods });
    return label === "Empty" ? <FactoryCellMuted>Empty</FactoryCellMuted> : <button className="font-medium text-primary hover:text-primary-700" type="button" onClick={() => setSelectedInventoryLocation(row)}>{label}</button>;
  }

  return <div className="space-y-5">
    <PageHeader section="System" title="Locations" description="Manage Factory physical locations. Storage-enabled locations remain available to inventory and stock workflows." actions={can("factory_storage_locations.create") || can("factory_storage_locations.manage") ? <button className="btn-primary" type="button" onClick={nav.openCreateStorageLocation}><Warehouse size={15} /> Location</button> : null} />
    <div className="grid gap-3 md:grid-cols-4"><MetricCard icon={Warehouse} label="Total Locations" value={storageLocations.length} helper="Active and archived" /><MetricCard icon={CheckCircle2} label="Active" value={active.length} helper="Available to modules" tone="success" /><MetricCard icon={Clock3} label="Archived" value={storageLocations.length - active.length} helper="Historical locations" /><MetricCard icon={Tag} label="Storage Enabled" value={active.filter((location) => location.is_storage_location !== false).length} helper="Available to stock workflows" /></div>
    {inventoryError ? <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">Current Location inventory could not be loaded. <button className="underline" type="button" onClick={loadInventory}>Retry</button></div> : null}
    <FactoryMasterTableToolbar value={search} onChange={setSearch} placeholder="Search location, code or type" />
    <FactoryDataSurface>
      <FactoryTable rows={rows.slice(pager.from, pager.to)} columns={[
        { key: "location", label: "Location", className: "w-[29%]", render: (row) => <FactoryCellEntity name={row.location_name || "—"} code={row.location_code} /> },
        { key: "type", label: "Type", className: "w-[18%]", render: (row) => titleCase(row.location_type) || <FactoryCellMuted /> },
        { key: "storage", label: "Storage", className: "w-[14%]", render: (row) => <FactoryCellLabel tone={row.is_storage_location !== false ? "blue" : "gray"}>{row.is_storage_location !== false ? "Storage enabled" : "Storage disabled"}</FactoryCellLabel> },
        { key: "inventory", label: "Inventory", className: "w-[14%]", render: inventoryCell },
        { key: "status", label: "Status", className: "w-[10%]", render: (row) => <FactoryStatusBadge status={row.status === "active" ? "Active" : "Archived"} /> },
        { key: "actions", label: "Actions", className: "w-[15%]", align: "right", render: (row) => <FactoryRowActions directActions={can("factory_storage_locations.edit") || can("factory_storage_locations.manage") ? [{ label: "Edit Location", onClick: () => nav.openEditStorageLocation(row) }] : []} secondaryActions={[(can("factory_storage_locations.delete") || can("factory_storage_locations.manage")) && row.status !== "archived" ? { label: "Archive", destructive: true, onClick: () => nav.archiveStorageLocation(row) } : null]} /> },
      ]} rowHover="mint" emptyTitle="No locations" />
      <FactoryPagination page={pager.page} pageSize={pager.pageSize} total={rows.length} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
    </FactoryDataSurface>
    {selectedInventoryLocation ? <FactoryLocationInventoryModal location={selectedInventoryLocation} inventory={inventoryByLocation.get(selectedInventoryLocation.id)} canViewRawMaterials={canViewRawMaterials} canViewFinishedGoods={canViewFinishedGoods} onClose={() => setSelectedInventoryLocation(null)} /> : null}
  </div>;
}
