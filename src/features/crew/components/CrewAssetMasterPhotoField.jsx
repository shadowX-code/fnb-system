import { useEffect, useState } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { crewService } from "../../../services/crewService.js";
import AssetPhotoCropper from "../../../components/media/AssetPhotoCropper.jsx";
import "../../../components/media/AssetPhotoCropper.css";
import "./CrewAssetMasterPhotoField.css";

const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp,image/heic,image/heif";

export function CrewAssetMasterImage({ asset, alt = "", className = "" }) {
  const sources = [...new Set([asset.thumbnail_url, asset.image_url, asset.original_image_url].filter(Boolean))];
  const [sourceIndex, setSourceIndex] = useState(0);
  useEffect(() => setSourceIndex(0), [asset.id, sources.join("|")]);
  const source = sources[sourceIndex];
  return source ? <img className={className} src={source} alt={alt} onError={() => setSourceIndex((current) => current + 1)} /> : null;
}

export default function CrewAssetMasterPhotoField({ asset = null, photo, onPhotoChange, removeExisting = false, onRemoveExistingChange, onPreparingChange, onError }) {
  const { t } = useTranslation();
  const hasExistingPhoto = Boolean(asset?.image_url || asset?.original_image_url);

  useEffect(() => () => {
    if (photo?.sourceUrl) URL.revokeObjectURL?.(photo.sourceUrl);
  }, [photo?.sourceUrl]);

  async function choosePhoto(file) {
    if (!file) return;
    onPreparingChange?.(true);
    onError?.("");
    try {
      const prepared = await crewService.prepareAssetMasterPhoto(file);
      onPhotoChange({ ...prepared, crop: { zoom: 1, x: 0, y: 0 }, sourceUrl: URL.createObjectURL(file) });
      onRemoveExistingChange?.(false);
    } catch {
      onError?.(t("assets.photoPrepareError"));
    } finally {
      onPreparingChange?.(false);
    }
  }

  function removePhoto() {
    onPhotoChange(null);
    onRemoveExistingChange?.(true);
  }

  const chooseControls = <div className="crew-asset-master-photo-actions">
    <label><Camera size={18} />{t("picker.takePhoto")}<input type="file" accept={ACCEPTED_IMAGE_TYPES} capture="environment" onChange={(event) => void choosePhoto(event.target.files?.[0])} /></label>
    <label><ImagePlus size={18} />{t("picker.chooseFromLibrary")}<input type="file" accept={ACCEPTED_IMAGE_TYPES} onChange={(event) => void choosePhoto(event.target.files?.[0])} /></label>
  </div>;

  return <fieldset className="crew-asset-master-photo-field">
    <legend>{t("picker.photo")} <small>{t("common.optional")}</small></legend>
    {photo ? <div className="crew-asset-master-photo-preview">
      <AssetPhotoCropper src={photo.sourceUrl} crop={photo.crop} onChange={(crop) => onPhotoChange((current) => ({ ...current, crop }))} />
      <div><label><Camera size={17} />{t("picker.replace")}<input type="file" accept={ACCEPTED_IMAGE_TYPES} capture="environment" onChange={(event) => void choosePhoto(event.target.files?.[0])} /></label><button type="button" onClick={removePhoto}><Trash2 size={17} />{t("picker.remove")}</button></div>
    </div> : removeExisting || !hasExistingPhoto ? chooseControls : <div className="crew-asset-master-photo-preview">
      <CrewAssetMasterImage asset={{ ...asset, thumbnail_url: "" }} />
      <div><label><Camera size={17} />{t("picker.replace")}<input type="file" accept={ACCEPTED_IMAGE_TYPES} capture="environment" onChange={(event) => void choosePhoto(event.target.files?.[0])} /></label><button type="button" onClick={removePhoto}><Trash2 size={17} />{t("picker.remove")}</button></div>
    </div>}
  </fieldset>;
}
