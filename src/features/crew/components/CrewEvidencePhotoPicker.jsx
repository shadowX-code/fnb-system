import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function CrewEvidencePhotoPicker({ previewUrl, onChoose, onRemove, busy = false, label, optional = true, previewAlt, busyLabel }) {
  const { t } = useTranslation();
  const resolvedLabel = label || t("picker.photo");
  const resolvedPreviewAlt = previewAlt || t("picker.selectedEvidence");
  const resolvedBusyLabel = busyLabel || t("picker.preparingPhoto");
  const input = (camera) => <input type="file" accept="image/jpeg,image/png,image/webp" capture={camera ? "environment" : undefined} onChange={(event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onChoose(file);
  }} />;

  return <fieldset className="crew-ui-evidence-photo-picker">
    <legend>{resolvedLabel} {optional ? <small>{t("common.optional")}</small> : null}</legend>
    {previewUrl ? <div className="crew-ui-evidence-photo-preview"><img src={previewUrl} alt={resolvedPreviewAlt} /><div><label><Camera size={17} />{t("picker.replace")}{input(true)}</label><button type="button" onClick={onRemove} disabled={busy}><Trash2 size={17} />{t("picker.remove")}</button></div></div> : <div className="crew-ui-evidence-photo-actions"><label><Camera size={18} />{t("picker.takePhoto")}{input(true)}</label><label><ImagePlus size={18} />{t("picker.chooseFromLibrary")}{input(false)}</label></div>}
    {busy ? <small role="status">{resolvedBusyLabel}</small> : null}
  </fieldset>;
}
