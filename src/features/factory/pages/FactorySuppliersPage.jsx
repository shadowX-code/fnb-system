import { useMemo, useState } from "react";
import { CheckCircle2, Clock3, Tag, Truck } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import FactoryPagination, { useFactoryClientPagination } from "../components/FactoryPagination.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryMasterTableToolbar from "../components/FactoryMasterTableToolbar.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import { FactoryCellEntity, FactoryCellMuted } from "../components/FactoryTableCell.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryNavigation from "../hooks/useFactoryNavigation.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";

export default function FactorySuppliersPage() {
  const { suppliers = [] } = useFactoryMasterData();
  const { can } = useFactoryPermissions();
  const nav = useFactoryNavigation();
  const [search, setSearch] = useState("");
  const rows = useMemo(() => suppliers.filter((supplier) => `${supplier.supplier_name || ""} ${supplier.supplier_code || ""} ${supplier.contact_person || ""} ${supplier.phone || ""}`.toLowerCase().includes(search.toLowerCase())), [suppliers, search]);
  const pager = useFactoryClientPagination("suppliers", rows.length, 20, search);
  const active = suppliers.filter((supplier) => supplier.status === "active").length;
  const canManage = can("factory_suppliers.manage");

  return <div className="space-y-5">
    <PageHeader section="System" title="Suppliers" description="Manage Factory supplier master data used by raw material receiving documents." actions={can("factory_suppliers.create") || canManage ? <button className="btn-primary" type="button" onClick={nav.openCreateSupplier}><Truck size={15} /> Create Supplier</button> : null} />
    <div className="grid gap-3 md:grid-cols-4"><MetricCard icon={Truck} label="Total Suppliers" value={suppliers.length} helper="Active and archived" /><MetricCard icon={CheckCircle2} label="Active" value={active} helper="Available for receiving" tone="success" /><MetricCard icon={Clock3} label="Archived" value={suppliers.length - active} helper="Historical suppliers" /><MetricCard icon={Tag} label="With Contact" value={suppliers.filter((supplier) => supplier.contact_person || supplier.phone || supplier.email).length} helper="Phone, email or contact person" /></div>
    <FactoryMasterTableToolbar value={search} onChange={setSearch} placeholder="Search supplier, code or contact" />
    <FactoryDataSurface>
      <FactoryTable rowHover="mint" rows={rows.slice(pager.from, pager.to)} columns={[
        { key: "supplier", label: "Supplier", className: "w-[30%]", render: (row) => <FactoryCellEntity name={row.supplier_name || "—"} code={row.supplier_code} /> },
        { key: "contact", label: "Contact Person", className: "w-[23%]", render: (row) => row.contact_person || <FactoryCellMuted /> },
        { key: "phone", label: "Phone", className: "w-[19%]", render: (row) => row.phone || <FactoryCellMuted /> },
        { key: "status", label: "Status", className: "w-[13%]", render: (row) => <FactoryStatusBadge status={row.status === "active" ? "Active" : "Archived"} /> },
        { key: "actions", label: "Actions", className: "w-[15%]", align: "right", render: (row) => <FactoryRowActions directActions={can("factory_suppliers.edit") ? [{ label: "Edit Supplier", onClick: () => nav.openEditSupplier(row) }] : []} secondaryActions={[(can("factory_suppliers.delete") || canManage) && row.status !== "archived" ? { label: "Archive", destructive: true, onClick: () => nav.archiveSupplier(row) } : null]} /> },
      ]} emptyTitle="No Factory suppliers" />
      <FactoryPagination page={pager.page} pageSize={pager.pageSize} total={rows.length} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
    </FactoryDataSurface>
  </div>;
}
