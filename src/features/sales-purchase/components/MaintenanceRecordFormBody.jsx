import { UploadCloud } from "lucide-react";
import SelectField from "../../../components/forms/SelectField.jsx";
import DatePickerField from "../../../components/forms/DatePickerField.jsx";
import { FieldLabel } from "../../../components/forms/Selectors.jsx";
import { IMAGE_UPLOAD_ACCEPT } from "../../../utils/imageUpload.js";
import { maintenanceStatuses } from "../utils/assetReadModel.js";

const priorities = ["low", "medium", "high", "critical"];
const types = ["preventive", "repair", "inspection", "cleaning", "calibration", "replacement", "emergency"];

function titleCase(value) { return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()); }
function maintenanceTypeLabel(type) {
  return ({ preventive: "Preventive Maintenance", repair: "Repair", inspection: "Inspection", cleaning: "Cleaning", calibration: "Calibration", replacement: "Replacement", emergency: "Emergency" })[type] || titleCase(type || "repair");
}

export function maintenanceCtaLabel(status) {
  return status === "completed" ? "Complete Maintenance" : status === "in_progress" ? "Update Progress" : "Save Scheduled Record";
}

export default function MaintenanceRecordFormBody({ values, update, handlePhoto, photoError, record, onPreview }) {
  const showPriority = values.status !== "completed";
  const showScheduledDate = values.status !== "completed";
  const showCompletedDate = values.status === "completed";
  const showNextServiceDate = values.status === "completed";
  const showActionTaken = values.status !== "scheduled";
  const costLabel = values.status === "completed" ? "Final Cost" : values.status === "in_progress" ? "Current Cost" : "Estimated Cost";
  return <div className="space-y-4">
    <div className="rounded-2xl border border-border bg-slate-50 p-3">
      <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-text-muted">Maintenance Status</div>
      <div className="grid gap-2 sm:grid-cols-3">{maintenanceStatuses.map((status) => <button key={status} type="button" className={`rounded-2xl border px-3 py-2 text-left transition ${values.status === status ? "border-primary bg-primary/10 text-primary shadow-sm" : "border-border bg-white text-text-secondary hover:border-primary/20"}`} onClick={() => update("status", status)}><div className="text-sm font-black">{titleCase(status)}</div><div className="mt-0.5 text-[11px] font-semibold opacity-75">{status === "scheduled" ? "Plan service work" : status === "in_progress" ? "Track active repair" : "Record completed work"}</div></button>)}</div>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <FieldLabel label="Maintenance Type"><SelectField value={values.maintenance_type} options={types.map((type) => ({ value: type, label: maintenanceTypeLabel(type) }))} onChange={(value) => update("maintenance_type", value)} /></FieldLabel>
      {showPriority ? <FieldLabel label="Priority"><SelectField value={values.priority} options={priorities.map((priority) => ({ value: priority, label: titleCase(priority) }))} onChange={(value) => update("priority", value)} /></FieldLabel> : null}
      <FieldLabel label="Issue / Problem"><input className="control" value={values.issue} onChange={(event) => update("issue", event.target.value)} placeholder="Compressor noise, leaking pipe..." /></FieldLabel>
      <FieldLabel label="Vendor / Technician"><input className="control" value={values.vendor} onChange={(event) => update("vendor", event.target.value)} placeholder="Optional" /></FieldLabel>
      {showActionTaken ? <FieldLabel label="Action Taken"><textarea className="control min-h-24 md:col-span-2" value={values.action_taken} onChange={(event) => update("action_taken", event.target.value)} placeholder={values.status === "completed" ? "Repair or service work performed" : "Current progress or temporary fix"} /></FieldLabel> : null}
      <FieldLabel label={costLabel}><input className="control" type="number" min="0" step="0.01" value={values.cost} onChange={(event) => update("cost", event.target.value)} placeholder="0.00" /></FieldLabel>
      {showScheduledDate ? <DatePickerField label="Scheduled Date" value={values.scheduled_date} onChange={(value) => update("scheduled_date", value)} /> : null}
      {showCompletedDate ? <DatePickerField label="Completed Date" value={values.completed_date} onChange={(value) => update("completed_date", value)} /> : null}
      {showNextServiceDate ? <DatePickerField label="Next Service Date" value={values.next_service_date} onChange={(value) => update("next_service_date", value)} /> : null}
      <FieldLabel label="Photo Evidence"><div className="flex items-center gap-3"><label className="btn-secondary h-10 cursor-pointer px-3 text-xs"><UploadCloud size={14} /> Upload Photo<input className="sr-only" type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={(event) => handlePhoto(event.target.files?.[0])} /></label>{values.photo_url ? <button className="relative h-12 w-12 overflow-hidden rounded-xl border border-border" type="button" onClick={onPreview}><img className="h-full w-full object-cover" src={values.photo_url} alt="Maintenance evidence preview" /></button> : null}</div>{values.photo_url ? <button className="mt-2 text-xs font-bold text-text-muted hover:text-rose-600" type="button" onClick={() => { update("previous_photo_url", record?.photo_url || ""); update("photo_url", ""); }}>Remove photo</button> : null}{photoError ? <div className="mt-1 text-xs font-semibold text-rose-600">{photoError}</div> : null}</FieldLabel>
      {values.status === "in_progress" ? <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 md:col-span-2">Saving as In Progress will set this asset condition to Under Maintenance.</div> : null}
      {values.status === "completed" ? <label className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 md:col-span-2"><input type="checkbox" checked={values.set_condition_good} onChange={(event) => update("set_condition_good", event.target.checked)} />Set asset condition back to Good after completion</label> : null}
      <FieldLabel label="Remark"><textarea className="control min-h-20 md:col-span-2" value={values.remark} onChange={(event) => update("remark", event.target.value)} placeholder="Optional follow-up notes" /></FieldLabel>
    </div>
  </div>;
}
