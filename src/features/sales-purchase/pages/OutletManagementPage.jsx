import { useEffect, useState } from "react";
import { Plus, Settings, Trash2 } from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import EntityModal from "../components/EntityModal.jsx";
import { outletService } from "../../../services/outletService.js";
import { getOutletTaxConfig } from "../utils/analytics.js";

function latestPeriod(store) {
  const latest = [...store.salesRecords, ...store.purchaseRecords]
    .filter((record) => record.outlet_id)
    .sort((a, b) => (a.year - b.year) || (a.month - b.month))
    .at(-1);
  return { month: latest?.month ?? 1, year: latest?.year ?? new Date().getFullYear() };
}

export default function OutletManagementPage({ store, setStore, ui }) {
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [modal, setModal] = useState(null);
  const currentPeriod = latestPeriod(store);

  useEffect(() => {
    let ignore = false;
    async function loadOutlets() {
      setLoading(true);
      setLoadError("");
      try {
        const rows = await outletService.listOutlets();
        if (ignore) return;
        setOutlets(rows);
        setStore((current) => ({ ...current, outlets: rows.filter((outlet) => outlet.is_active) }));
      } catch (error) {
        console.error("Unable to load outlets", error);
        if (!ignore) setLoadError(error.message || "Unable to load outlets.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadOutlets();
    return () => {
      ignore = true;
    };
  }, [setStore]);

  const fields = [
    { name: "name", label: "Outlet Name", placeholder: "Outlet name" },
    { name: "code", label: "Outlet Code", placeholder: "HIPB" },
    { name: "location", label: "Location", placeholder: "City / area" },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Inactive" },
      ],
    },
  ];
  const columns = [
    { key: "name", header: "Outlet Name", sticky: true, render: (row) => <span className="font-semibold">{row.name}</span> },
    { key: "code", header: "Code" },
    { key: "location", header: "Location" },
    {
      key: "sst",
      header: "Current SST",
      render: (row) => {
        const config = getOutletTaxConfig(store.outletTaxConfigs, row.id, currentPeriod.month, currentPeriod.year, "SST");
        return (
          <div className="flex items-center gap-2">
            <Badge tone={config.enabled ? "success" : "neutral"}>{config.enabled ? "ON" : "OFF"}</Badge>
            <span className="text-xs font-semibold text-text-secondary">{config.enabled ? `${config.rate}%` : "No SST"}</span>
          </div>
        );
      },
    },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (row) => (
        <div className="flex justify-end gap-2">
          <button className="icon-btn" onClick={() => setModal({ mode: "edit", row })}><Settings size={15} /></button>
          <button className="icon-btn" onClick={async () => {
            if (await ui.confirm({ title: "Deactivate outlet?", message: `${row.name} will stay in historical records but be hidden from default active selectors.`, danger: true, confirmLabel: "Deactivate" })) {
              try {
                const saved = await outletService.deactivateOutlet(row);
                setOutlets((current) => current.map((outlet) => (outlet.id === saved.id ? saved : outlet)));
                setStore((current) => ({ ...current, outlets: current.outlets.filter((outlet) => outlet.id !== saved.id) }));
                ui.notify({ title: "Outlet updated", message: `${row.name} deactivated.` });
              } catch (error) {
                console.error("Unable to deactivate outlet", error);
                ui.notify({ title: "Unable to deactivate outlet", message: error.message || "Please try again.", tone: "error" });
              }
            }
          }}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-5">
      <PageHeader
        section="Operations"
        title="Outlets"
        description="Outlet master data used by sales and purchase records through outlet_id."
        actions={<button className="btn-primary" onClick={() => setModal({ mode: "add" })}><Plus size={16} /> Add Outlet</button>}
      />
      <Card title="Outlet Directory" description="All sales and purchase records bind to outlet_id.">
        {loading ? (
          <div className="p-8 text-center text-sm font-semibold text-text-secondary">Loading outlets...</div>
        ) : loadError ? (
          <div className="p-8 text-center text-sm font-semibold text-rose-700">{loadError}</div>
        ) : (
          <DataTable columns={columns} rows={outlets} getRowKey={(row) => row.id} />
        )}
      </Card>
      {modal ? (
        <EntityModal
          title={modal.mode === "add" ? "Add Outlet" : "Edit Outlet"}
          description="Outlet code and location are used in reports and imports."
          fields={fields}
          initialValues={modal.row ?? { name: "", code: "", location: "", status: "active" }}
          onClose={() => setModal(null)}
          onSubmit={async (values) => {
            if (!values.name?.trim()) return ui.notify({ title: "Outlet name required", tone: "error" });
            try {
              const saved = await outletService.saveOutlet({ ...(modal.row ?? {}), ...values });
              setOutlets((current) => {
                const exists = current.some((outlet) => outlet.id === saved.id);
                return exists ? current.map((outlet) => (outlet.id === saved.id ? saved : outlet)) : [saved, ...current];
              });
              setStore((current) => ({
                ...current,
                outlets: saved.is_active
                  ? current.outlets.some((outlet) => outlet.id === saved.id)
                    ? current.outlets.map((outlet) => (outlet.id === saved.id ? saved : outlet))
                    : [...current.outlets, saved]
                  : current.outlets.filter((outlet) => outlet.id !== saved.id),
              }));
              setModal(null);
              ui.notify({ title: "Outlet saved", message: saved.name });
            } catch (error) {
              console.error("Unable to save outlet", error);
              ui.notify({ title: "Unable to save outlet", message: error.message || "Please try again.", tone: "error" });
            }
          }}
        />
      ) : null}
    </div>
  );
}
