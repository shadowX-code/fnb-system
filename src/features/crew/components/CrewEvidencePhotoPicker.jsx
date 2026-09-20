import { Camera, ImagePlus, Trash2 } from "lucide-react";

export default function CrewEvidencePhotoPicker({ previewUrl, onChoose, onRemove, busy = false, label = "Photo", optional = true, previewAlt = "Selected evidence", busyLabel = "Preparing photo…" }) {
  const input = (camera) => <input type="file" accept="image/jpeg,image/png,image/webp" capture={camera ? "environment" : undefined} onChange={(event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onChoose(file);
  }} />;

  return <fieldset className="crew-ui-evidence-photo-picker">
    <legend>{label} {optional ? <small>Optional</small> : null}</legend>
    {previewUrl ? <div className="crew-ui-evidence-photo-preview"><img src={previewUrl} alt={previewAlt} /><div><label><Camera size={17} />Replace{input(true)}</label><button type="button" onClick={onRemove} disabled={busy}><Trash2 size={17} />Remove</button></div></div> : <div className="crew-ui-evidence-photo-actions"><label><Camera size={18} />Take Photo{input(true)}</label><label><ImagePlus size={18} />Choose from Library{input(false)}</label></div>}
    {busy ? <small role="status">{busyLabel}</small> : null}
  </fieldset>;
}
