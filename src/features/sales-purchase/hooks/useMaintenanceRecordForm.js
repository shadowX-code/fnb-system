import { useState } from "react";
import { optimizeImageFileForPreview } from "../../../utils/imageUpload.js";
import { maintenanceStatuses } from "../utils/assetReadModel.js";

export function createMaintenanceRecordDraft(record = {}, today = new Date().toISOString().slice(0, 10)) {
  const status = maintenanceStatuses.includes(record.status) ? record.status : "scheduled";
  return {
    id: record.id || "", date: record.date || today,
    scheduled_date: record.scheduled_date || (status === "completed" ? "" : today),
    completed_date: record.completed_date || (status === "completed" ? today : ""),
    next_service_date: record.next_service_date || "", maintenance_type: record.maintenance_type || "repair",
    priority: record.priority || "medium", issue: record.issue || "", action_taken: record.action_taken || "",
    vendor: record.vendor || "", cost: record.cost ? String(record.cost) : "", status,
    remark: record.remark || "", photo_url: record.photo_url || "", set_condition_good: false,
  };
}

export function updateMaintenanceRecordDraft(current, key, value, today = new Date().toISOString().slice(0, 10)) {
  const next = { ...current, [key]: value };
  if (key === "status") {
    if (value === "completed") {
      next.scheduled_date = "";
      next.priority = current.priority || "medium";
      next.completed_date = current.completed_date || today;
    } else {
      next.completed_date = "";
      next.next_service_date = "";
      next.scheduled_date = current.scheduled_date || today;
    }
  }
  return next;
}

export function isMaintenanceRecordDraftInvalid(values = {}) {
  return !String(values.issue || "").trim() || !values.maintenance_type ||
    (values.status !== "scheduled" && !String(values.action_taken || "").trim()) ||
    (values.status !== "completed" && !values.scheduled_date) ||
    (values.status === "completed" && !values.completed_date);
}

export function useMaintenanceRecordForm(record) {
  const [values, setValues] = useState(() => createMaintenanceRecordDraft(record));
  const [photoError, setPhotoError] = useState("");
  const update = (key, value) => setValues((current) => updateMaintenanceRecordDraft(current, key, value));
  const handlePhoto = async (file) => {
    setPhotoError("");
    if (!file) return;
    try {
      const optimized = await optimizeImageFileForPreview(file);
      update("photo_url", optimized.dataUrl);
      update("previous_photo_url", record?.photo_url || "");
    } catch (error) {
      setPhotoError(error.message || "Unable to read this image.");
    }
  };
  return { values, update, handlePhoto, photoError, invalid: isMaintenanceRecordDraftInvalid(values) };
}
