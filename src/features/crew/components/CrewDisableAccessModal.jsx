import { useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import { crewService } from "../../../services/crewService.js";

export default function CrewDisableAccessModal({ employee, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function disableAccess() {
    setSaving(true);
    setError("");
    try {
      onSaved?.(await crewService.manageAccess(employee.id, "disable"));
      onClose();
    } catch (cause) {
      setError(cause.message || "Unable to disable Crew Access.");
    } finally {
      setSaving(false);
    }
  }

  return <Modal title="Disable Crew Access" description={`${employee.full_name} will be signed out from Crew mobile on every device.`} size="sm" onClose={saving ? undefined : onClose} footer={<><button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-danger" type="button" disabled={saving} onClick={disableAccess}>{saving ? "Disabling..." : "Disable Access"}</button></>}>
    <div className="space-y-3 text-sm text-text-secondary"><p>They will no longer be able to use Crew mobile until an administrator activates access again.</p>{error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 font-semibold text-rose-700">{error}</p> : null}</div>
  </Modal>;
}
