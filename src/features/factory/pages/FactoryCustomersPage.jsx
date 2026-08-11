import { useMemo, useState } from "react";
import { CheckCircle2, Clock3, Tag, Truck } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import FactoryPagination, { useFactoryClientPagination } from "../components/FactoryPagination.jsx";
import { FactoryTable } from "../components/FactoryDataDisplay.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryNavigation from "../hooks/useFactoryNavigation.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";

const titleCase = (value) => value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "—";

export default function FactoryCustomersPage() {
  const { customers } = useFactoryMasterData();
  const { can } = useFactoryPermissions();
  const nav = useFactoryNavigation();
  const [search, setSearch] = useState("");
  const rows = useMemo(() => customers.filter((customer) => `${customer.customer_name || ""} ${customer.customer_code || ""}`.toLowerCase().includes(search.toLowerCase())), [customers, search]);
  const pager = useFactoryClientPagination("customers", rows.length, 20, search);
  const active = customers.filter((customer) => customer.status === "active").length;

  return <div className="space-y-5">
    <PageHeader section="System" title="Customers" description="Manage Factory customers and destinations used by finished goods dispatch documents." actions={can("factory_customers.create") ? <button className="btn-primary" type="button" onClick={nav.openCreateCustomer}><Truck size={15} /> Create Customer</button> : null} />
    <div className="grid gap-3 md:grid-cols-4"><MetricCard icon={Truck} label="Total Customers" value={customers.length} helper="Active and archived" /><MetricCard icon={CheckCircle2} label="Active" value={active} helper="Available for dispatch" tone="success" /><MetricCard icon={Clock3} label="Archived" value={customers.length - active} helper="Historical customers" /><MetricCard icon={Tag} label="Customer Types" value={new Set(customers.map((customer) => customer.customer_type).filter(Boolean)).size} helper={`${customers.filter((customer) => customer.contact_person || customer.phone || customer.email).length} with contact details`} /></div>
    <Card title="Factory Customer Master">
      <input className="field-input mb-4 w-full md:max-w-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers" />
      <FactoryTable rows={rows.slice(pager.from, pager.to)} columns={[
        { key: "customer", label: "Customer", className: "w-[29%]", render: (row) => <div><div className="font-bold">{row.customer_name || "—"}</div>{row.customer_code ? <div className="text-xs text-text-secondary">{row.customer_code}</div> : null}</div> },
        { key: "type", label: "Type", className: "w-[15%]", render: (row) => titleCase(row.customer_type) },
        { key: "contact", label: "Contact Person", className: "w-[21%]", render: (row) => row.contact_person || "—" },
        { key: "phone", label: "Phone", className: "w-[18%]", render: (row) => row.phone || "—" },
        { key: "status", label: "Status", className: "w-[11%]", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status === "active" ? "Active" : "Archived"}</Badge> },
        { key: "actions", label: "Actions", align: "right", render: (row) => <div className="flex justify-end gap-2 whitespace-nowrap">{can("factory_customers.edit") ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => nav.openEditCustomer(row)}>Edit</button> : null}{can("factory_customers.delete") && row.status !== "archived" ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => nav.archiveCustomer(row)}>Archive</button> : null}</div> },
      ]} emptyTitle="No Factory customers" />
      <FactoryPagination page={pager.page} pageSize={pager.pageSize} total={rows.length} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
    </Card>
  </div>;
}
