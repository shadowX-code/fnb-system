import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import { defaultPermissions } from "../data/rbacDefaults.js";

export default function PermissionsPage() {
  const columns = [
    { key: "code", header: "Permission Code", sticky: true, render: (row) => <span className="font-semibold text-text-primary">{row.code}</span> },
    { key: "module", header: "Module", render: (row) => <Badge tone="neutral">{row.module}</Badge> },
    { key: "description", header: "Description" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        section="System"
        title="Permissions"
        description="Atomic permission codes used by sidebar visibility, buttons, and protected actions."
      />
      <Card title="Permission Catalog" description="Use hasPermission(code) in UI and service actions. Avoid role-name checks.">
        <DataTable columns={columns} rows={defaultPermissions} getRowKey={(row) => row.code} />
      </Card>
    </div>
  );
}
