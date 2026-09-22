import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Camera, Check, ChevronRight, ClipboardCheck, History, ImagePlus, MapPin, PackagePlus, PackageSearch, Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { crewService } from "../../../services/crewService.js";
import { ASSET_CREATE_UNIT_OPTIONS, assetCreateErrorMessage, buildCrewAssetCreatePayload, validateAssetCreateValues } from "../../sales-purchase/utils/assetCreationContract.js";

function localizeAssetCreateError(stage, cause, t) {
  const message = assetCreateErrorMessage(stage, cause);
  if (message.startsWith("That asset code")) return t("assets.assetCodeInUse");
  if (message.startsWith("This category")) return t("assets.categoryUnavailable");
  if (message.startsWith("Your access")) return t("assets.accessChanged");
  return t(stage === "update" ? "assets.unableUpdate" : "assets.unableCreate");
}
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewMobileModal from "./CrewMobileModal.jsx";
import CrewChoicePicker from "./CrewChoicePicker.jsx";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { CrewEmptyState, CrewSearchBar, CrewStatusBadge } from "./CrewMobileUI.jsx";
import AssetPhotoCropper from "../../../components/media/AssetPhotoCropper.jsx";
import CrewQuantityStepper from "./CrewQuantityStepper.jsx";
import CrewEvidencePhotoPicker from "./CrewEvidencePhotoPicker.jsx";
import CrewImageViewer from "./CrewImageViewer.jsx";
import { formatCrewOperationalDateTime } from "../utils/crewI18n.js";
import "./CrewAssetsMobile.css";
import "../../../components/media/AssetPhotoCropper.css";

const conditions = ["healthy", "needs_attention", "low_quantity", "damaged", "missing"];
const conditionKeys = { healthy: "healthy", needs_attention: "needsAttention", low_quantity: "lowQuantity", damaged: "damaged", missing: "missing" };
const conditionTemplateNames = { healthy: "Healthy", needs_attention: "Needs attention", low_quantity: "Low quantity", damaged: "Damaged", missing: "Missing" };
const tone = (value) => value === "healthy" ? "success" : value === "low_quantity" || value === "needs_attention" ? "warning" : "danger";
const requestId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const pluralize = (quantity, unit, t) => t("assets.units", { count: Number(quantity), unit });
const formatDate = (value, t, options = { day: "numeric", month: "short", year: "numeric" }) => value ? new Intl.DateTimeFormat(undefined, options).format(new Date(value)) : t("assets.notRecorded");
const formatDateTime = formatCrewOperationalDateTime;
const signedQuantity = (value) => `${Number(value) > 0 ? "+" : ""}${value}`;

function State({ loading, error, retry, children }) {
  const { t } = useTranslation();
  if (loading) return <section className="crew-v2-state" role="status"><span className="crew-v2-spinner" /><strong>{t("assets.loading")}</strong></section>;
  if (error) return <section className="crew-v2-state"><strong>{t("assets.unavailable")}</strong><p>{error}</p><button className="crew-mobile-primary" onClick={retry}>{t("common.retry")}</button></section>;
  return children;
}

function activityProjection(data, assetId) {
  // Inspection corrections are represented by the richer inspection evidence below.
  const movements = (data?.movement_history || []).filter((item) => item.reason !== "inspection" && (!assetId || item.asset_id === assetId)).map((item) => ({ ...item, kind: "adjustment", at: item.created_at || item.movement_date }));
  const inspections = (data?.inspection_history || []).filter((item) => !assetId || item.asset_ids?.includes(assetId)).map((item) => ({ ...item, kind: "inspection", at: item.created_at || item.inspection_date }));
  return [...movements, ...inspections].sort((a, b) => new Date(b.at) - new Date(a.at));
}

function AssetMasterImage({ asset, alt = "", className = "" }) {
  const sources = [...new Set([asset.thumbnail_url, asset.image_url, asset.original_image_url].filter(Boolean))];
  const [sourceIndex, setSourceIndex] = useState(0);
  useEffect(() => setSourceIndex(0), [asset.id, sources.join("|")]);
  const source = sources[sourceIndex];
  return source ? <img className={className} src={source} alt={alt} onError={() => setSourceIndex((current) => current + 1)} /> : null;
}

export default function CrewAssetsMobile({ token, onBack, onFlowChange }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [query, setQuery] = useState(""); const [category, setCategory] = useState("all"); const [asset, setAsset] = useState(null);
  const [adjusting, setAdjusting] = useState(false); const [adding, setAdding] = useState(false); const [inspection, setInspection] = useState(null); const [activity, setActivity] = useState(false); const [notice, setNotice] = useState("");
  const categoryChipRefs = useRef(new Map());
  async function load(assetId) { setLoading(true); setError(""); try { const next = await crewService.assetsMobile(token, assetId); setData(next); return next; } catch (cause) { setError(cause.message || t("assets.loadError")); return null; } finally { setLoading(false); } }
  useEffect(() => { void load(); }, [token]);
  useEffect(() => {
    onFlowChange?.(Boolean(inspection));
    return () => onFlowChange?.(false);
  }, [inspection, onFlowChange]);
  const visible = useMemo(() => (data?.assets || []).filter((item) => (category === "all" || item.category_id === category) && `${item.name} ${item.asset_code || ""} ${item.location || ""}`.toLowerCase().includes(query.toLowerCase())), [data, query, category]);
  const assetCategoryIds = useMemo(() => new Set((data?.assets || []).map((item) => item.category_id).filter(Boolean)), [data]);
  const categories = useMemo(() => [{ value: "all", label: t("assets.all") }, ...(data?.categories || []).filter((item) => item.is_active !== false && assetCategoryIds.has(item.id)).map((item) => ({ value: item.id, label: item.name }))], [data, assetCategoryIds, t]);
  useEffect(() => { if (!categories.some((item) => item.value === category)) setCategory("all"); }, [categories, category]);
  useEffect(() => { categoryChipRefs.current.get(category)?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" }); }, [category]);
  if (inspection) return <InspectionFlow token={token} data={data} initial={inspection} onBack={() => setInspection(null)} onDraftSaved={() => load()} onCancelled={async () => { await load(); setNotice(t("assets.inspectionDraftCancelled")); setInspection(null); }} onSaved={async (result) => { const refreshed = await load(); const updates = new Map((result?.asset_updates || []).map((item) => [item.id, item])); if (updates.size) setData((previous) => previous ? { ...previous, assets: previous.assets.map((item) => ({ ...item, ...(updates.get(item.id) || {}) })) } : previous); if (asset) { const latest = refreshed?.assets?.find((item) => item.id === asset.id) || asset; setAsset({ ...latest, ...(updates.get(asset.id) || {}) }); } setNotice(t("assets.inspectionComplete")); setInspection(null); }} />;
  if (asset) return <><AssetDetail asset={asset} data={data} onBack={() => setAsset(null)} onAdjust={() => setAdjusting(true)} onInspect={() => setInspection({ scope: "specific", assets: [asset] })} onActivity={() => setActivity({ assetId: asset.id, title: asset.name })} onEdit={() => setAdding("edit")} />
    {adjusting ? <AdjustSheet token={token} asset={asset} onClose={() => setAdjusting(false)} onSaved={async () => { const refreshed = await load(); setAsset(refreshed?.assets?.find((item) => item.id === asset.id) || null); setAdjusting(false); }} /> : null}
    {adding === "edit" ? <EditAssetDetailsSheet token={token} asset={asset} onClose={() => setAdding(false)} onSaved={async () => { const refreshed = await load(asset.id); setAsset(refreshed?.assets?.find((item) => item.id === asset.id) || asset); setAdding(false); }} /> : null}
    {activity ? <ActivitySheet data={data} assetId={activity.assetId} title={activity.title} onClose={() => setActivity(false)} /> : null}
  </>;
  return <section className="crew-assets-page"><CrewMobileDetailHeader title={t("assets.title")} onBack={onBack} /><State loading={loading} error={error} retry={load}><>
    <header className="crew-assets-intro"><div><strong>{data?.outlet?.name}</strong><span>{t("assets.activeCount", { count: data?.assets?.length || 0 })}</span></div><span className="crew-assets-header-actions"><button type="button" onClick={() => setActivity({ title: t("assets.assetActivity") })}><History size={19} /><span>{t("assets.activity")}</span></button></span></header>
    <CrewSearchBar value={query} onChange={setQuery} placeholder={t("assets.search")} />
    {notice ? <p className="crew-assets-notice" role="status">{notice}</p> : null}
    {data?.inspection_drafts?.map((draft) => <button className="crew-assets-resume" type="button" key={draft.id} onClick={() => setInspection({ draft })}><span><strong>{t("assets.resumeInspection")}</strong><small>{draft.completion_percentage || 0}% · {t("assets.savedAt", { date: formatDateTime(draft.updated_at) })}</small></span><ChevronRight size={18} /></button>)}
    {(data?.can_add_assets || data?.can_perform_asset_inspections) ? <div className={`crew-assets-operational-actions${data?.can_add_assets && data?.can_perform_asset_inspections ? "" : " is-single"}`}>{data?.can_add_assets ? <button className="crew-mobile-secondary" type="button" onClick={() => setAdding(true)}><PackagePlus size={18} />{t("assets.addAsset")}</button> : null}{data?.can_perform_asset_inspections ? <button className="crew-mobile-primary" type="button" onClick={() => setInspection({ scope: "all", assets: data.assets })}><ClipboardCheck size={18} />{t("assets.inspection")}</button> : null}</div> : null}
    <div className="crew-assets-filters crew-v2-chips" role="group" aria-label={t("assets.categories")}>{categories.map((item) => <button type="button" key={item.value} ref={(node) => { if (node) categoryChipRefs.current.set(item.value, node); else categoryChipRefs.current.delete(item.value); }} className={category === item.value ? "active" : ""} aria-pressed={category === item.value} onClick={() => setCategory(item.value)}>{item.label}</button>)}</div>
    <div className="crew-assets-list">{visible.map((item) => <button type="button" key={item.id} onClick={() => setAsset(item)}><span className="crew-assets-thumb">{item.thumbnail_url || item.image_url || item.original_image_url ? <AssetMasterImage asset={item} /> : <PackageSearch size={22} />}</span><span><strong>{item.name}</strong><small>{item.category_name}{item.location ? ` · ${item.location}` : ""}</small><em>{pluralize(item.current_quantity, item.unit, t)}</em></span><CrewStatusBadge tone={tone(item.condition)}>{t(`assets.${conditionKeys[item.condition]}`)}</CrewStatusBadge><ChevronRight size={18} /></button>)}{!visible.length ? <CrewEmptyState title={t("assets.noAssets")} body={t("assets.noAssetsBody")} /> : null}</div>
    {adding ? <AddAssetSheet token={token} categories={data?.categories || []} onClose={() => setAdding(false)} onSaved={async (assetId) => { const refreshed = await load(assetId); setAdding(false); setAsset(refreshed?.assets?.find((item) => item.id === assetId) || null); }} /> : null}{activity ? <ActivitySheet data={data} title={activity.title} onClose={() => setActivity(false)} /> : null}
  </></State></section>;
}

function AssetDetail({ asset, data, onBack, onAdjust, onInspect, onActivity, onEdit }) {
  const { t } = useTranslation();
  const activity = activityProjection(data, asset.id).slice(0, 4); const movement = activity.find((item) => item.kind === "adjustment"); const inspection = activity.find((item) => item.kind === "inspection");
  const [viewer, setViewer] = useState(false); const display = asset.image_url || asset.original_image_url || "";
  return <section className="crew-assets-page"><CrewMobileDetailHeader title={t("assets.assetDetail")} onBack={onBack} action={data?.can_manage_asset_details ? <button className="crew-mobile-header-text-action crew-assets-edit-action" type="button" onClick={onEdit}><Pencil size={17} />{t("assets.edit")}</button> : null} /><article className="crew-asset-detail">
    <div className="crew-asset-detail-lead"><button className="crew-asset-detail-image" type="button" disabled={!display} onClick={() => setViewer(true)} aria-label={display ? t("assets.viewPhoto") : undefined}>{display ? <AssetMasterImage asset={{ ...asset, thumbnail_url: "" }} /> : <PackageSearch size={30} />}</button><header><span><small>{asset.asset_code || asset.category_name}</small><h1>{asset.name}</h1>{asset.location ? <em><MapPin size={14} />{asset.location}</em> : null}</span><CrewStatusBadge tone={tone(asset.condition)}>{t(`assets.${conditionKeys[asset.condition]}`)}</CrewStatusBadge></header></div>
    {asset.description ? <p>{asset.description}</p> : data?.can_manage_asset_details ? <button className="crew-asset-detail-add-description" type="button" onClick={onEdit}>{t("assets.addDescription")}</button> : null}<dl><div><dt>{t("assets.quantity")}</dt><dd>{pluralize(asset.current_quantity, asset.unit, t)}</dd></div>{asset.location ? <div><dt>{t("assets.location")}</dt><dd>{asset.location}</dd></div> : null}<div><dt>{t("assets.lastMovement")}</dt><dd>{movement ? formatDateTime(movement.at) : t("assets.noMovements")}</dd></div><div><dt>{t("assets.lastInspection")}</dt><dd>{inspection ? formatDateTime(inspection.at) : formatDateTime(asset.last_inspection_at)}</dd></div></dl>
    {asset.maintenance?.length ? <section className="crew-asset-maintenance"><strong>{t("assets.maintenance")}</strong>{asset.maintenance.map((item, index) => <p key={index}>{item.status === "in_progress" ? t("status.in_progress") : t("schedule.upcomingStatus")}{item.issue ? ` · ${item.issue}` : ""}{item.scheduled_date ? ` · ${formatDate(item.scheduled_date, t)}` : ""}</p>)}</section> : null}
    <section className="crew-asset-activity"><header><strong>{t("assets.recentActivity")}</strong>{activity.length ? <button type="button" onClick={onActivity}>{t("assets.viewAllActivity")}</button> : null}</header>{activity.length ? activity.map((item) => <ActivityRow key={`${item.kind}-${item.id}`} item={item} concise />) : <p>{t("assets.noActivity")}</p>}</section>
    <footer>{data?.can_adjust_assets ? <button className="crew-mobile-secondary" onClick={onAdjust}><SlidersHorizontal size={18} />{t("assets.adjustQuantity")}</button> : null}{data?.can_perform_asset_inspections ? <button className="crew-mobile-primary" onClick={onInspect}><ClipboardCheck size={18} />{t("assets.inspectAsset")}</button> : null}</footer>
  </article>{viewer ? <CrewImageViewer src={display} alt={asset.name} onClose={() => setViewer(false)} /> : null}</section>;
}

function AdjustSheet({ token, asset, onClose, onSaved }) {
  const { t } = useTranslation();
  const [type, setType] = useState("correction"); const [quantity, setQuantity] = useState(String(asset.current_quantity)); const [reason, setReason] = useState("stock_count"); const [note, setNote] = useState("");
  const adjustmentOptions = [{ value: "correction", label: t("assets.setExactQuantity") }, { value: "add", label: t("assets.addQuantity") }, { value: "reduce", label: t("assets.reduceQuantity") }];
  const reasonOptions = [{ value: "stock_count", label: t("assets.stockCount") }, { value: "received", label: t("assets.received") }, { value: "used", label: t("assets.used") }, { value: "damaged", label: t("assets.damaged") }, { value: "missing", label: t("assets.missing") }, { value: "other", label: t("common.other") }];
  const [confirming, setConfirming] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const entered = Number(quantity); const current = Number(asset.current_quantity); const next = Number.isFinite(entered) ? type === "add" ? current + entered : type === "reduce" ? current - entered : entered : current; const difference = next - current; const requiresConfirmation = Math.abs(difference) >= Math.max(10, current * 0.25);
  async function save() { setSaving(true); setError(""); try { await crewService.adjustAsset(token, { requestId: requestId(), assetId: asset.id, adjustmentType: type, quantity, reason, note }); await onSaved(); } catch (cause) { setError(cause.message || t("assets.unableAdjust")); } finally { setSaving(false); } }
  const footer = <><button className="crew-mobile-ghost" onClick={confirming ? () => setConfirming(false) : onClose} disabled={saving}>{confirming ? t("common.back") : t("common.cancel")}</button><button className="crew-mobile-primary" disabled={saving || !quantity || !reason || next < 0} onClick={() => confirming ? void save() : requiresConfirmation ? setConfirming(true) : void save()}>{saving ? t("common.saving") : confirming ? t("assets.confirmAdjustment") : t("assets.saveAdjustment")}</button></>;
  return <CrewBottomSheet title={confirming ? t("assets.confirmLargeAdjustment") : t("assets.adjustQuantity")} description={asset.name} onClose={onClose} closeDisabled={saving} footer={footer}>{confirming ? <div className="crew-assets-confirm"><p>{t("assets.adjustmentChanges", { difference: signedQuantity(difference), unit: asset.unit })}</p><div className="crew-assets-impact"><span><small>{t("assets.currentQuantity")}</small><strong>{pluralize(current, asset.unit, t)}</strong></span><ChevronRight size={18} /><span><small>{t("assets.newQuantity")}</small><strong>{pluralize(next, asset.unit, t)}</strong></span></div><p>{t("assets.adjustmentConfirmHelp")}</p></div> : <div className="crew-assets-form">
    <CrewChoicePicker label={t("assets.adjustmentType")} value={type} options={adjustmentOptions} onChange={setType} /><label>{t("assets.quantity")}<input inputMode="decimal" enterKeyHint="next" type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><div className="crew-assets-impact"><span><small>{t("assets.currentQuantity")}</small><strong>{pluralize(current, asset.unit, t)}</strong></span><ChevronRight size={18} /><span><small>{t("assets.newQuantity")}</small><strong>{pluralize(next, asset.unit, t)}</strong></span><em>{signedQuantity(difference)} {asset.unit}</em></div><CrewChoicePicker label={t("assets.reason")} value={reason} options={reasonOptions} onChange={setReason} /><label>{t("assets.note")} {reason !== "other" ? <small>{t("common.optional")}</small> : null}<textarea enterKeyHint="done" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("assets.notePlaceholder")} /></label>{error ? <p className="crew-v2-error" role="alert">{error}</p> : null}
  </div>}</CrewBottomSheet>;
}

function AddAssetSheet({ token, categories, onClose, onSaved }) {
  const { t } = useTranslation();
  const [name, setName] = useState(""); const [category, setCategory] = useState(""); const [quantity, setQuantity] = useState(""); const [unit, setUnit] = useState("unit"); const [code, setCode] = useState(""); const [location, setLocation] = useState(""); const [description, setDescription] = useState(""); const [photo, setPhoto] = useState(null); const [preparingPhoto, setPreparingPhoto] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const createRequestId = useRef(requestId());
  const categoryOptions = [{ value: "", label: t("assets.chooseCategory") }, ...categories.map((item) => ({ value: item.id, label: item.name }))];
  const unitOptions = ASSET_CREATE_UNIT_OPTIONS.map((item) => ({ ...item, label: t(`assets.unitOptions.${item.value}`) }));
  const draft = { name, category_id: category, initial_quantity: quantity, unit, asset_code: code, location, description };
  const validationError = validateAssetCreateValues(draft, categories.map((item) => item.id));
  useEffect(() => () => { if (photo?.previewUrl) URL.revokeObjectURL?.(photo.previewUrl); if (photo?.sourceUrl) URL.revokeObjectURL?.(photo.sourceUrl); }, [photo?.previewUrl, photo?.sourceUrl]);
  async function choosePhoto(file) {
    if (!file) return;
    setPreparingPhoto(true); setError("");
    try { const prepared = await crewService.prepareAssetMasterPhoto(file); setPhoto({ ...prepared, crop: { zoom: 1, x: 0, y: 0 }, sourceUrl: URL.createObjectURL(file) }); } catch { setError(t("assets.photoPrepareError")); } finally { setPreparingPhoto(false); }
  }
  function removePhoto() { setPhoto(null); createRequestId.current = requestId(); }
  async function save() {
    setSaving(true); setError("");
    try {
      const assetPayload = buildCrewAssetCreatePayload(draft);
      const result = photo
        ? await crewService.createAssetWithPhoto(token, { requestId: createRequestId.current, asset: assetPayload, preparedPhoto: await crewService.prepareAssetMasterPhoto(photo.file, photo.crop) })
        : await crewService.createAsset(token, { requestId: createRequestId.current, asset: assetPayload });
      const assetId = result?.asset?.id || "";
      if (!assetId) throw new Error("asset-create-missing-id");
      await onSaved(assetId);
    } catch (cause) { setError(localizeAssetCreateError("create", cause, t)); } finally { setSaving(false); }
  }
  return <CrewBottomSheet title={t("assets.addAsset")} description={t("assets.addAssetHelp")} onClose={onClose} closeDisabled={saving} footer={<><button className="crew-mobile-ghost" type="button" onClick={onClose} disabled={saving}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" disabled={Boolean(validationError) || saving || preparingPhoto} onClick={() => void save()}>{saving ? t("assets.creating") : t("assets.create")}</button></>}><div className="crew-assets-form"><label>{t("assets.assetName")}<input enterKeyHint="next" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" /></label><CrewChoicePicker label={t("assets.category")} value={category} options={categoryOptions} onChange={setCategory} /><div className="crew-assets-inline-fields"><label>{t("assets.initialQuantity")}<input type="number" inputMode="decimal" enterKeyHint="next" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><CrewChoicePicker label={t("assets.unit")} value={unit} options={unitOptions} onChange={setUnit} /></div><label>{t("assets.assetCode")} <small>{t("common.optional")}</small><input enterKeyHint="next" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" /></label><label>{t("assets.location")} <small>{t("common.optional")}</small><input enterKeyHint="next" value={location} onChange={(event) => setLocation(event.target.value)} /></label><fieldset className="crew-assets-photo-field"><legend>{t("picker.photo")} <small>{t("common.optional")}</small></legend>{photo ? <div className="crew-assets-photo-preview"><AssetPhotoCropper src={photo.sourceUrl} crop={photo.crop} onChange={(crop) => setPhoto((current) => ({ ...current, crop }))} /><div><label><Camera size={17} />{t("picker.replace")}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={(event) => void choosePhoto(event.target.files?.[0])} /></label><button type="button" onClick={removePhoto}><Trash2 size={17} />{t("picker.remove")}</button></div></div> : <div className="crew-assets-photo-actions"><label><Camera size={18} />{t("picker.takePhoto")}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={(event) => void choosePhoto(event.target.files?.[0])} /></label><label><ImagePlus size={18} />{t("picker.chooseFromLibrary")}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => void choosePhoto(event.target.files?.[0])} /></label></div>}{preparingPhoto ? <small role="status">{t("assets.preparingPreview")}</small> : null}</fieldset><label>{t("assets.description")} <small>{t("common.optional")}</small><textarea enterKeyHint="done" value={description} onChange={(event) => setDescription(event.target.value)} /></label>{error ? <p className="crew-v2-error" role="alert">{error}</p> : null}</div></CrewBottomSheet>;
}

function EditAssetDetailsSheet({ token, asset, onClose, onSaved }) {
  const { t } = useTranslation();
  const [name, setName] = useState(asset.name || ""); const [description, setDescription] = useState(asset.description || ""); const [location, setLocation] = useState(asset.location || "");
  const [photo, setPhoto] = useState(null); const [removePhoto, setRemovePhoto] = useState(false); const [preparingPhoto, setPreparingPhoto] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  useEffect(() => () => { if (photo?.sourceUrl) URL.revokeObjectURL?.(photo.sourceUrl); }, [photo?.sourceUrl]);
  async function choosePhoto(file) { if (!file) return; setPreparingPhoto(true); setError(""); try { const prepared = await crewService.prepareAssetMasterPhoto(file); setPhoto({ ...prepared, crop: { zoom: 1, x: 0, y: 0 }, sourceUrl: URL.createObjectURL(file) }); setRemovePhoto(false); } catch { setError(t("assets.photoPrepareError")); } finally { setPreparingPhoto(false); } }
  async function save() { setSaving(true); setError(""); try { await crewService.updateAssetDetails(token, { requestId: requestId(), assetId: asset.id, details: { name, description, location, remove_photo: removePhoto }, preparedPhoto: photo ? await crewService.prepareAssetMasterPhoto(photo.file, photo.crop) : null }); await onSaved(); } catch (cause) { setError(localizeAssetCreateError("update", cause, t)); } finally { setSaving(false); } }
  const hasExistingPhoto = Boolean(asset.image_url || asset.original_image_url);
  return <CrewBottomSheet title={t("assets.editDetails")} description={t("assets.editDetailsHelp")} onClose={onClose} closeDisabled={saving} footer={<><button className="crew-mobile-ghost" type="button" disabled={saving} onClick={onClose}>{t("common.cancel")}</button><button className="crew-mobile-primary" type="button" disabled={saving || preparingPhoto || !name.trim()} onClick={() => void save()}>{saving ? t("common.saving") : t("assets.saveChanges")}</button></>}><div className="crew-assets-form"><label>{t("assets.assetName")}<input value={name} autoComplete="off" enterKeyHint="next" onChange={(event) => setName(event.target.value)} /></label><label>{t("assets.location")} <small>{t("common.optional")}</small><input value={location} enterKeyHint="next" onChange={(event) => setLocation(event.target.value)} /></label><fieldset className="crew-assets-photo-field"><legend>{t("picker.photo")} <small>{t("common.optional")}</small></legend>{photo ? <div className="crew-assets-photo-preview"><AssetPhotoCropper src={photo.sourceUrl} crop={photo.crop} onChange={(crop) => setPhoto((current) => ({ ...current, crop }))} /><div><label><Camera size={17} />{t("picker.replace")}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={(event) => void choosePhoto(event.target.files?.[0])} /></label><button type="button" onClick={() => { setPhoto(null); setRemovePhoto(true); }}><Trash2 size={17} />{t("picker.remove")}</button></div></div> : removePhoto || !hasExistingPhoto ? <div className="crew-assets-photo-actions"><label><Camera size={18} />{t("picker.takePhoto")}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={(event) => void choosePhoto(event.target.files?.[0])} /></label><label><ImagePlus size={18} />{t("picker.chooseFromLibrary")}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => void choosePhoto(event.target.files?.[0])} /></label></div> : <div className="crew-assets-photo-preview"><AssetMasterImage asset={{ ...asset, thumbnail_url: "" }} /><div><label><Camera size={17} />{t("picker.replace")}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={(event) => void choosePhoto(event.target.files?.[0])} /></label><button type="button" onClick={() => setRemovePhoto(true)}><Trash2 size={17} />{t("picker.remove")}</button></div></div>}{preparingPhoto ? <small role="status">{t("assets.preparingPreview")}</small> : null}</fieldset><label>{t("assets.description")} <small>{t("common.optional")}</small><textarea value={description} enterKeyHint="done" onChange={(event) => setDescription(event.target.value)} /></label>{error ? <p className="crew-v2-error" role="alert">{error}</p> : null}</div></CrewBottomSheet>;
}

function ActivitySheet({ data, assetId, title, onClose }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("all"); const events = activityProjection(data, assetId).filter((item) => filter === "all" || item.kind === filter);
  return <CrewBottomSheet title={title || t("assets.assetActivity")} description={assetId ? t("assets.activityForAsset") : t("assets.noActivityBody")} onClose={onClose}><div className="crew-assets-activity-filter" role="group" aria-label={t("assets.activity")} >{[{ value: "all", label: t("assets.all") }, { value: "adjustment", label: t("assets.adjustments") }, { value: "inspection", label: t("assets.inspections") }].map((item) => <button type="button" key={item.value} className={filter === item.value ? "active" : ""} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div><div className="crew-assets-history">{events.map((item) => <ActivityRow key={`${item.kind}-${item.id}`} item={item} />)}{!events.length ? <CrewEmptyState title={t("assets.noActivity")} body={t("assets.noActivityBody")} /> : null}</div></CrewBottomSheet>;
}

function ActivityRow({ item, concise = false }) {
  const { t } = useTranslation();
  if (item.kind === "adjustment") return <article className="crew-assets-activity-row"><span><strong>{t("assets.quantityAdjusted")}{concise ? "" : ` · ${item.asset_name}`}</strong><small>{t("assets.currentQuantity")}: {item.quantity_before} → {item.quantity_after} · {signedQuantity(item.quantity_change)}</small><em>{item.reason?.replaceAll("_", " ")} · {formatDateTime(item.at)} · {t("assets.by", { name: item.actor_name || "Admin" })}</em></span><CrewStatusBadge tone="neutral">{t("assets.adjustment")}</CrewStatusBadge></article>;
  const count = item.summary?.checked_assets || item.asset_ids?.length || 0; const inspected = item.items?.[0];
  return <article className="crew-assets-activity-row"><span><strong>{t("assets.inspectionCompleted")}{!concise && inspected?.asset_name ? ` · ${inspected.asset_name}` : ""}</strong><small>{inspected ? `${t("assets.expected")} ${inspected.expected_quantity} · ${t("assets.counted")} ${inspected.counted_quantity} · ${signedQuantity(inspected.difference)}` : t("assets.inspectedAssets", { count })}{inspected?.condition ? ` · ${t(`assets.${conditionKeys[inspected.condition]}`, { defaultValue: inspected.condition })}` : ""}</small><em>{formatDateTime(item.at)} · {t("assets.by", { name: item.checked_by || t("picker.crew") })}</em></span><CrewStatusBadge tone="success">{t("assets.inspection")}</CrewStatusBadge></article>;
}

function InspectionFlow({ token, data, initial, onBack, onDraftSaved, onSaved, onCancelled }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial.draft || null); const [scope, setScope] = useState(initial.draft?.category_scope?.type || initial.scope || "all"); const [category, setCategory] = useState(initial.draft?.category_scope?.category_ids?.[0] || "");
  const initialAssets = draft ? (draft.draft_data?.rows || []).map((row) => ({ ...data.assets.find((asset) => asset.id === row.asset_id), saved: row })) : initial.assets; const scoped = useMemo(() => (initialAssets || data.assets || []).filter((item) => scope !== "category" || item.category_id === category), [initialAssets, data.assets, scope, category]);
  const [started, setStarted] = useState(Boolean(draft || initial.scope === "specific")); const [index, setIndex] = useState(draft?.current_step ? Math.max(0, draft.current_step - 1) : 0); const [rows, setRows] = useState(() => Object.fromEntries((initialAssets || []).map((item) => [item.id, item.saved || { asset_id: item.id, counted_quantity: item.current_quantity, condition_status: item.condition || "healthy", remark: "", evidence: [] }]))); const initialRows = useRef(JSON.stringify(Object.fromEntries((initialAssets || []).map((item) => [item.id, item.saved || { asset_id: item.id, counted_quantity: item.current_quantity, condition_status: item.condition || "healthy", remark: "", evidence: [] }])))); const touchStart = useRef(null); const [pendingPhotos, setPendingPhotos] = useState({}); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [draftSaved, setDraftSaved] = useState(false); const [cancelOpen, setCancelOpen] = useState(false); const [cancelling, setCancelling] = useState(false);
  const current = scoped[index]; const row = current && rows[current.id]; const categoryOptions = [{ value: "", label: t("assets.chooseCategory") }, ...(data.categories || []).map((item) => ({ value: item.id, label: item.name }))];
  function patch(values) { setRows((previous) => ({ ...previous, [current.id]: { ...previous[current.id], ...values } })); }
  function choosePhoto(file) { if (!file || !current) return; setError(""); const previewUrl = URL.createObjectURL(file); setPendingPhotos((previous) => { if (previous[current.id]?.previewUrl) URL.revokeObjectURL?.(previous[current.id].previewUrl); return { ...previous, [current.id]: { file, previewUrl } }; }); }
  function removePhoto() { if (!current) return; setPendingPhotos((previous) => { if (previous[current.id]?.previewUrl) URL.revokeObjectURL?.(previous[current.id].previewUrl); const next = { ...previous }; delete next[current.id]; return next; }); }
  const payload = (status, evidenceByAsset = {}) => ({ draft_id: draft?.id || null, status, category_scope: { type: scope, category_ids: category ? [category] : [] }, current_step: index + 1, completion_percentage: scoped.length ? Math.round((index / scoped.length) * 100) : 0, draft_data: { rows: scoped.map((item) => rows[item.id]) }, rows: scoped.map((item) => { const value = rows[item.id]; const template = data.condition_templates?.find((candidate) => candidate.category_id === item.category_id && candidate.name.toLowerCase() === (conditionTemplateNames[value.condition_status] || value.condition_status).toLowerCase()); return { ...value, evidence: [...(value.evidence || []), ...(evidenceByAsset[item.id] ? [evidenceByAsset[item.id]] : [])], condition_template_id: template?.id || null, evidence_required: Boolean(template?.requires_photo) }; }) });
  const hasChanges = JSON.stringify(rows) !== initialRows.current || Object.keys(pendingPhotos).length > 0;
  useEffect(() => {
    if (!draftSaved) return undefined;
    const timeout = window.setTimeout(() => setDraftSaved(false), 2400);
    return () => window.clearTimeout(timeout);
  }, [draftSaved]);
  function releasePendingPhotos() { Object.values(pendingPhotos).forEach((photo) => URL.revokeObjectURL?.(photo.previewUrl)); setPendingPhotos({}); }
  async function save(status) { setSaving(true); setError(""); try {
    const evidenceByAsset = {};
    // Drafts retain operational fields only. Evidence is uploaded at completion, so cancelling
    // a draft never leaves a draft-only Storage object behind.
    if (status === "completed") for (const [assetId, pending] of Object.entries(pendingPhotos)) { const evidence = await crewService.uploadAssetInspectionEvidence(token, assetId, pending.file); evidenceByAsset[assetId] = { image_url: evidence.image_url }; }
    const result = await crewService.submitAssetInspection(token, { requestId: requestId(), ...payload(status, evidenceByAsset) });
    releasePendingPhotos();
    if (status === "in_progress") {
      initialRows.current = JSON.stringify(rows);
      setDraft({
        id: result.inspection_id,
        status: "in_progress",
        category_scope: { type: scope, category_ids: category ? [category] : [] },
        draft_data: { rows: Object.values(rows) },
        current_step: index + 1,
      });
      await onDraftSaved?.();
      setDraftSaved(true);
      return;
    }
    await onSaved(result);
  } catch { setError(t("assets.unableSaveInspection")); } finally { setSaving(false); } }
  async function cancelDraft() { if (!draft?.id) return; setCancelling(true); setError(""); try { await crewService.archiveAssetInspectionDraft(token, draft.id); releasePendingPhotos(); setCancelOpen(false); await onCancelled(); } catch { setError(t("assets.unableCancelInspection")); setCancelOpen(false); } finally { setCancelling(false); } }
  function isSwipeExcluded(target) { return target instanceof Element && Boolean(target.closest("button, input, textarea, label, [role='slider'], .crew-ui-quantity-stepper, .crew-ui-evidence-photo-picker")); }
  function handleTouchStart(event) { if (event.touches.length !== 1 || isSwipeExcluded(event.target)) { touchStart.current = null; return; } const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }
  function handleTouchEnd(event) { const start = touchStart.current; touchStart.current = null; if (!start || saving || isSwipeExcluded(event.target) || event.changedTouches.length !== 1) return; const touch = event.changedTouches[0]; const horizontal = touch.clientX - start.x; const vertical = touch.clientY - start.y; if (Math.abs(horizontal) < 56 || Math.abs(horizontal) < Math.abs(vertical) * 1.4) return; if (horizontal < 0 && index < scoped.length - 1) setIndex((currentIndex) => currentIndex + 1); if (horizontal > 0 && index > 0) setIndex((currentIndex) => currentIndex - 1); }
  if (!started) return <section className="crew-assets-page"><CrewMobileDetailHeader title={t("assets.startInspection")} onBack={onBack} /><div className="crew-inspection-setup"><ClipboardCheck size={30} /><h1>{t("assets.chooseInspectionScope")}</h1><button type="button" className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}><strong>{t("assets.fullOutlet")}</strong><small>{t("assets.fullOutletHelp")}</small></button><button type="button" className={scope === "category" ? "active" : ""} onClick={() => setScope("category")}><strong>{t("assets.categoryScope")}</strong><small>{t("assets.categoryScopeHelp")}</small></button>{scope === "category" ? <CrewChoicePicker label={t("assets.category")} value={category} options={categoryOptions} onChange={setCategory} /> : null}<button className="crew-mobile-primary" disabled={scope === "category" && !category} onClick={() => setStarted(true)}>{t("assets.startInspection")}</button></div></section>;
  const expected = Number(current?.current_quantity ?? 0); const counted = Number(row?.counted_quantity ?? expected); const difference = Number.isFinite(counted) ? counted - expected : 0;
  const differenceCopy = difference === 0 ? t("assets.noDifference") : `${signedQuantity(difference)} ${current.unit}`;
  const progress = scoped.length ? Math.round(((index + 1) / scoped.length) * 100) : 0;
  const canCancelDraft = Boolean(draft?.id && ["draft", "in_progress"].includes(draft.status));
  return <section className="crew-assets-page crew-assets-page--inspection"><CrewMobileDetailHeader title={t("assets.inspectionTitle")} onBack={onBack} />{current ? <><article className="crew-inspection-step" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}><header><div className="crew-inspection-progress-heading"><strong>{t("assets.inspectionStep", { current: index + 1, total: scoped.length })}</strong><span>{progress}%</span></div><div className="crew-inspection-draft-status">{hasChanges ? <button className="crew-mobile-ghost" disabled={saving} onClick={() => void save("in_progress")}>{saving ? t("common.saving") : t("assets.saveDraft")}</button> : null}{draftSaved ? <small role="status"><Check size={14} />{t("assets.draftSaved")}</small> : null}{canCancelDraft ? <button className="crew-mobile-ghost crew-inspection-cancel" disabled={saving || cancelling} onClick={() => setCancelOpen(true)}>{t("assets.cancelInspection")}</button> : null}</div><strong className="crew-inspection-asset-name">{current.name}</strong><small>{current.location || current.category_name}</small></header><div className="crew-inspection-progress" aria-label={t("learn.percentComplete", { count: progress })}><span style={{ width: `${progress}%` }} /></div><div className="crew-inspection-count-context"><span><small>{t("assets.expected")}</small><strong>{pluralize(expected, current.unit, t)}</strong></span><span><small>{t("assets.difference")}</small><strong className={difference ? `is-difference ${difference > 0 ? "is-positive" : "is-negative"}` : ""}>{differenceCopy}</strong></span></div><CrewQuantityStepper label={t("assets.counted")} unit={current.unit} value={row.counted_quantity} onChange={(value) => patch({ counted_quantity: value })} /><fieldset className="crew-inspection-condition"><legend>{t("assets.condition")}</legend>{conditions.map((item) => <button type="button" key={item} aria-pressed={row.condition_status === item} className={`${row.condition_status === item ? "active " : ""}is-${item.replaceAll("_", "-")}`} onClick={() => patch({ condition_status: item })}>{t(`assets.${conditionKeys[item]}`)}</button>)}</fieldset><label>{t("assets.note")}<textarea enterKeyHint="done" value={row.remark} onChange={(event) => patch({ remark: event.target.value })} placeholder={t("assets.inspectionNotePlaceholder")} /></label><CrewEvidencePhotoPicker previewUrl={pendingPhotos[current.id]?.previewUrl} onChoose={choosePhoto} onRemove={removePhoto} />{row.evidence?.length ? <small>{t("assets.savedPhotos", { count: row.evidence.length })}</small> : null}{error ? <p className="crew-v2-error" role="alert">{error}</p> : null}</article><footer className={`crew-ui-sticky-actions crew-ui-sticky-actions--fixed crew-inspection-workflow-dock${index === 0 ? " is-single-action" : ""}`}>{index > 0 ? <button className="crew-mobile-secondary" disabled={saving} onClick={() => setIndex((currentIndex) => currentIndex - 1)}><ArrowLeft size={17} />{t("assets.previous")}</button> : null}{index < scoped.length - 1 ? <button className="crew-mobile-primary" disabled={saving} onClick={() => setIndex((currentIndex) => currentIndex + 1)}>{t("assets.next")}<ArrowRight size={17} /></button> : <button className="crew-mobile-primary" disabled={saving} onClick={() => void save("completed")}>{saving ? t("common.saving") : t("assets.completeInspection")}</button>}</footer></> : <CrewEmptyState title={t("assets.noAssetsScope")} body={t("assets.noAssetsScopeBody")} />}{cancelOpen ? <CrewMobileModal title={t("assets.cancelInspectionTitle")} description={t("assets.cancelInspectionBody")} onClose={() => setCancelOpen(false)} closeDisabled={cancelling} footer={<><button className="crew-mobile-secondary" type="button" disabled={cancelling} onClick={() => setCancelOpen(false)}>{t("assets.keepInspection")}</button><button className="crew-mobile-destructive" type="button" disabled={cancelling} onClick={() => void cancelDraft()}>{cancelling ? t("assets.cancelling") : t("assets.cancelInspection")}</button></>} /> : null}</section>;
}
