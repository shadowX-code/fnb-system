import { useState } from "react";
import { Plus, Settings } from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import EntityModal from "../components/EntityModal.jsx";
import { operationsService } from "../services/operationsService.js";

export default function SettingsPage({ store, setStore, ui }) {
  const [tab, setTab] = useState("channels");
  const [modal, setModal] = useState(null);
  const isChannels = tab === "channels";
  const rows = isChannels ? store.salesChannels : store.purchaseCategories;
  const columns = [
    { key: "name", header: isChannels ? "Sales Channel" : "Purchase Category", sticky: true, render: (row) => <span className="font-semibold">{row.name}</span> },
    ...(isChannels ? [{ key: "type", header: "Type" }] : []),
    { key: "sort_order", header: "Sort Order", align: "right" },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
    { key: "action", header: "Action", align: "right", render: (row) => <button className="icon-btn" onClick={() => setModal({ mode: "edit", row })}><Settings size={15} /></button> },
  ];
  const fields = [
    { name: "name", label: "Name", placeholder: "Name" },
    ...(isChannels ? [{ name: "type", label: "Type", type: "select", options: [{ value: "channel", label: "Channel" }, { value: "total", label: "Total" }, { value: "adjustment", label: "Adjustment" }] }] : []),
    { name: "sort_order", label: "Sort Order", placeholder: "1" },
    { name: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
  ];
  return (
    <div className="space-y-5">
      <div className="card flex items-center justify-between p-2">
        <div className="flex gap-2">
          <button className={`h-10 rounded-xl px-4 text-sm font-semibold ${isChannels ? "bg-primary text-white" : "text-text-secondary hover:bg-slate-50"}`} onClick={() => setTab("channels")}>Sales Channels</button>
          <button className={`h-10 rounded-xl px-4 text-sm font-semibold ${!isChannels ? "bg-primary text-white" : "text-text-secondary hover:bg-slate-50"}`} onClick={() => setTab("categories")}>Purchase Categories</button>
        </div>
        <button className="btn-primary" onClick={() => setModal({ mode: "add" })}><Plus size={16} /> Add</button>
      </div>
      <Card title={isChannels ? "Sales Channels" : "Purchase Categories"} description="Structured master data powers future dashboards and imports.">
        <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} />
      </Card>
      {modal ? (
        <EntityModal
          title={`${modal.mode === "add" ? "Add" : "Edit"} ${isChannels ? "Sales Channel" : "Purchase Category"}`}
          fields={fields}
          initialValues={modal.row ?? { name: "", type: "channel", sort_order: rows.length + 1, status: "active" }}
          onClose={() => setModal(null)}
          onSubmit={(values) => {
            if (!values.name?.trim()) return ui.notify({ title: "Name required", tone: "error" });
            if (isChannels) {
              if (modal.mode === "add") setStore((current) => operationsService.addSalesChannel(current, values.name, values.type).state);
              else setStore((current) => operationsService.updateSalesChannel(current, modal.row.id, values));
            } else if (modal.mode === "add") setStore((current) => operationsService.addPurchaseCategory(current, values.name).state);
            else setStore((current) => operationsService.updatePurchaseCategory(current, modal.row.id, values));
            setModal(null);
            ui.notify({ title: "Settings saved", message: values.name });
          }}
        />
      ) : null}
    </div>
  );
}
