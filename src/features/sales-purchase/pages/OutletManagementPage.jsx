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
    { name: "outlet_logo", label: "Outlet Logo", render: ({ values, setValues }) => {
      const current = values.logo_path ? outletService.logoPublicUrl(values.logo_path, values.logo_version) : "";
      const preview = values.logoFile ? URL.createObjectURL(values.logoFile) : current;
      return <div className="grid gap-2"><div className="flex min-h-16 items-center gap-3 rounded border border-border bg-surface px-3 py-2">{preview ? <img className="h-12 w-20 object-contain" src={preview} alt="Outlet logo preview" /> : <span className="grid h-12 w-12 place-items-center rounded bg-mint-100 text-xs font-bold text-primary">{(values.name || "Outlet").slice(0, 2).toUpperCase()}</span>}<span className="text-xs text-text-secondary">PNG, JPG, or WebP. Up to 2 MB. Original proportions are preserved.</span></div><input aria-label="Outlet Logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setValues((currentValues) => ({ ...currentValues, logoFile: event.target.files?.[0] || null, removeLogo: false }))} />{current && !values.logoFile ? <button className="btn-ghost w-fit text-rose-700" type="button" onClick={() => setValues((currentValues) => ({ ...currentValues, removeLogo: true, logo_path: "", logo_version: "" }))}>Remove logo</button> : null}</div>;
    } },
    { name: "brand_accent_color", label: "Brand Accent Color", render: ({ values, setValues }) => <div className="flex items-center gap-3"><input aria-label="Brand Accent Color picker" type="color" value={/^#[0-9a-fA-F]{6}$/.test(values.brand_accent_color || "") ? values.brand_accent_color : "#236647"} onChange={(event) => setValues((current) => ({ ...current, brand_accent_color: event.target.value.toUpperCase() }))} /><input aria-label="Brand Accent Color" className="control w-28" value={values.brand_accent_color || ""} placeholder="#236647" onChange={(event) => setValues((current) => ({ ...current, brand_accent_color: event.target.value }))} /><span className="h-8 w-8 rounded border border-border" style={{ background: /^#[0-9a-fA-F]{6}$/.test(values.brand_accent_color || "") ? values.brand_accent_color : "#236647" }} />{values.brand_accent_color ? <button type="button" className="btn-ghost" onClick={() => setValues((current) => ({ ...current, brand_accent_color: "" }))}>Reset</button> : null}</div> },
    {
      name: "attendance_location_enabled",
      label: "Attendance Location Verification",
      type: "select",
      options: [{ value: "false", label: "Disabled until configured" }, { value: "true", label: "Enabled" }],
    },
    { name: "attendance_latitude", label: "Attendance Latitude", placeholder: "e.g. 3.139000" },
    { name: "attendance_longitude", label: "Attendance Longitude", placeholder: "e.g. 101.686900" },
    { name: "attendance_radius_meters", label: "Allowed Radius (meters)", placeholder: "100" },
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
          description="Outlet code and location are used in reports and imports. Attendance GPS verification remains disabled until coordinates are configured."
          fields={fields}
          initialValues={{ name: "", code: "", location: "", status: "active", attendance_latitude: "", attendance_longitude: "", attendance_radius_meters: "100", ...(modal.row ?? {}), attendance_location_enabled: String(modal.row?.attendance_location_enabled ?? false) }}
          onClose={() => setModal(null)}
          onSubmit={async (values) => {
            if (!values.name?.trim()) return ui.notify({ title: "Outlet name required", tone: "error" });
            const locationEnabled = values.attendance_location_enabled === true || values.attendance_location_enabled === "true";
            const latitude = Number(values.attendance_latitude);
            const longitude = Number(values.attendance_longitude);
            const radius = Number(values.attendance_radius_meters || 100);
            if (locationEnabled && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) return ui.notify({ title: "Valid outlet coordinates required", message: "Enter latitude and longitude before enabling attendance location verification.", tone: "error" });
            if (!Number.isFinite(radius) || radius < 25 || radius > 2000) return ui.notify({ title: "Invalid attendance radius", message: "Use a radius between 25 and 2,000 meters.", tone: "error" });
            try {
              const saved = await outletService.saveOutlet({ ...(modal.row ?? {}), ...values, attendance_location_enabled: locationEnabled, attendance_radius_meters: radius });
              if (values.removeLogo) await outletService.removeLogo(saved.id);
              if (values.logoFile) await outletService.uploadLogo(saved.id, values.logoFile);
              const refreshed = values.removeLogo || values.logoFile ? (await outletService.listOutlets()).find((outlet) => outlet.id === saved.id) || saved : saved;
              setOutlets((current) => {
                const exists = current.some((outlet) => outlet.id === refreshed.id);
                return exists ? current.map((outlet) => (outlet.id === refreshed.id ? refreshed : outlet)) : [refreshed, ...current];
              });
              setStore((current) => ({
                ...current,
                outlets: refreshed.is_active
                  ? current.outlets.some((outlet) => outlet.id === refreshed.id)
                    ? current.outlets.map((outlet) => (outlet.id === refreshed.id ? refreshed : outlet))
                    : [...current.outlets, refreshed]
                  : current.outlets.filter((outlet) => outlet.id !== refreshed.id),
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
