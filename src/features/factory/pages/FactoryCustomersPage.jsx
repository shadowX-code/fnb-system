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

const titleCase = (value) => value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "—";

export default function FactoryCustomersPage() {
  const { customers = [] } = useFactoryMasterData();
  const { can } = useFactoryPermissions();
  const nav = useFactoryNavigation();
  const [search, setSearch] = useState("");
  const rows = useMemo(() => customers.filter((customer) => `${customer.customer_name || ""} ${customer.customer_code || ""}`.toLowerCase().includes(search.toLowerCase())), [customers, search]);
  const pager = useFactoryClientPagination("customers", rows.length, 20, search);
  const active = customers.filter((customer) => customer.status === "active").length;

  return <div className="space-y-5">
    <PageHeader section="System" title="Customers" description="Manage Factory customers and destinations used by finished goods dispatch documents." actions={can("factory_customers.create") ? <button className="btn-primary" type="button" onClick={nav.openCreateCustomer}><Truck size={15} /> Create Customer</button> : null} />
    <div className="grid gap-3 md:grid-cols-4"><MetricCard icon={Truck} label="Total Customers" value={customers.length} helper="Active and archived" /><MetricCard icon={CheckCircle2} label="Active" value={active} helper="Available for dispatch" tone="success" /><MetricCard icon={Clock3} label="Archived" value={customers.length - active} helper="Historical customers" /><MetricCard icon={Tag} label="Customer Types" value={new Set(customers.map((customer) => customer.customer_type).filter(Boolean)).size} helper={`${customers.filter((customer) => customer.contact_person || customer.phone || customer.email).length} with contact details`} /></div>
    <FactoryMasterTableToolbar value={search} onChange={setSearch} placeholder="Search customer or code" />
    <FactoryDataSurface>
      <FactoryTable rowHover="mint" rows={rows.slice(pager.from, pager.to)} columns={[
        { key: "customer", label: "Customer", className: "w-[29%]", render: (row) => <FactoryCellEntity name={row.customer_name || "—"} code={row.customer_code} /> },
        { key: "type", label: "Type", className: "w-[15%]", render: (row) => titleCase(row.customer_type) },
        { key: "contact", label: "Contact Person", className: "w-[21%]", render: (row) => row.contact_person || <FactoryCellMuted /> },
        { key: "phone", label: "Phone", className: "w-[18%]", render: (row) => row.phone || <FactoryCellMuted /> },
        { key: "status", label: "Status", className: "w-[11%]", render: (row) => <FactoryStatusBadge status={row.status === "active" ? "Active" : "Archived"} /> },
        { key: "actions", label: "Actions", align: "right", render: (row) => <FactoryRowActions directActions={can("factory_customers.edit") ? [{ label: "Edit Customer", onClick: () => nav.openEditCustomer(row) }] : []} secondaryActions={[can("factory_customers.delete") && row.status !== "archived" ? { label: "Archive", destructive: true, onClick: () => nav.archiveCustomer(row) } : null]} /> },
      ]} emptyTitle="No Factory customers" />
      <FactoryPagination page={pager.page} pageSize={pager.pageSize} total={rows.length} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
    </FactoryDataSurface>
  </div>;
}
