import { useEffect, useMemo, useState } from "react";
import { Camera, ChevronRight, ClipboardCheck, History, MapPin, PackageSearch, SlidersHorizontal } from "lucide-react";
import { crewService } from "../../../services/crewService.js";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import { CrewEmptyState, CrewMobilePageHeader, CrewSearchBar, CrewStatusBadge } from "./CrewMobileUI.jsx";
import "./CrewAssetsMobile.css";

const conditions = ["healthy", "needs_attention", "low_quantity", "damaged", "missing"];
const labels = { healthy: "Healthy", needs_attention: "Needs attention", low_quantity: "Low quantity", damaged: "Damaged", missing: "Missing" };
const tone = (value) => value === "healthy" ? "success" : value === "low_quantity" || value === "needs_attention" ? "warning" : "danger";
const requestId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

function State({ loading, error, retry, children }) {
  if (loading) return <section className="crew-v2-state" role="status"><span className="crew-v2-spinner" /><strong>Loading Assets…</strong></section>;
  if (error) return <section className="crew-v2-state"><strong>Assets unavailable</strong><p>{error}</p><button className="crew-mobile-primary" onClick={retry}>Try again</button></section>;
  return children;
}

export default function CrewAssetsMobile({ token, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [asset, setAsset] = useState(null);
  const [adjusting, setAdjusting] = useState(false);
  const [inspection, setInspection] = useState(null);
  const [history, setHistory] = useState(false);
  async function load() {
    setLoading(true); setError("");
    try { setData(await crewService.assetsMobile(token)); }
    catch (cause) { setError(cause.message || "Unable to load Assets."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [token]);
  const visible = useMemo(() => (data?.assets || []).filter((item) => (category === "all" || item.category_id === category) && `${item.name} ${item.asset_code || ""} ${item.location || ""}`.toLowerCase().includes(query.toLowerCase())), [data, query, category]);
  if (inspection) return <InspectionFlow token={token} data={data} initial={inspection} onBack={() => setInspection(null)} onSaved={async () => { await load(); setInspection(null); }} />;
  if (asset) return <AssetDetail asset={asset} data={data} onBack={() => setAsset(null)} onAdjust={() => setAdjusting(true)} onInspect={() => setInspection({ scope: "specific", assets: [asset] })} />;
  return <section className="crew-assets-page"><CrewMobileDetailHeader title="Assets" onBack={onBack} /><State loading={loading} error={error} retry={load}><>
    <header className="crew-assets-intro"><div><strong>{data?.outlet?.name}</strong><span>{data?.assets?.length || 0} active assets</span></div><button type="button" onClick={() => setHistory(true)}><History size={19} /><span>History</span></button></header>
    <CrewSearchBar value={query} onChange={setQuery} placeholder="Search assets" />
    {data?.inspection_drafts?.map((draft) => <button className="crew-assets-resume" type="button" key={draft.id} onClick={() => setInspection({ draft })}><span><strong>Resume inspection</strong><small>{draft.completion_percentage || 0}% complete · saved {new Date(draft.updated_at).toLocaleDateString()}</small></span><ChevronRight size={18} /></button>)}
    <div className="crew-assets-filters"><select aria-label="Asset category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{data?.categories?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{data?.can_perform_asset_inspections && <button className="crew-assets-inspect" type="button" onClick={() => setInspection({ scope: "all", assets: data.assets })}><ClipboardCheck size={18} />Start inspection</button>}</div>
    <div className="crew-assets-list">{visible.map((item) => <button type="button" key={item.id} onClick={() => setAsset(item)}><span className="crew-assets-thumb">{item.thumbnail_url || item.image_url ? <img src={item.thumbnail_url || item.image_url} alt="" /> : <PackageSearch size={22} />}</span><span><strong>{item.name}</strong><small>{item.category_name}{item.location ? ` · ${item.location}` : ""}</small><em>{item.current_quantity} {item.unit}</em></span><CrewStatusBadge tone={tone(item.condition)}>{labels[item.condition] || item.condition}</CrewStatusBadge><ChevronRight size={18} /></button>)}{!visible.length && <CrewEmptyState title="No assets found" body="Try another search or category." />}</div>
    {adjusting && asset && <AdjustSheet token={token} asset={asset} onClose={() => setAdjusting(false)} onSaved={async () => { setAdjusting(false); setAsset(null); await load(); }} />}
    {history && <CrewBottomSheet title="Inspection History" onClose={() => setHistory(false)}><div className="crew-assets-history">{(data?.inspection_history || []).map((item) => <article key={item.id}><span><strong>{item.inspection_date}</strong><small>{item.checked_by}</small></span><CrewStatusBadge tone="success">{item.status}</CrewStatusBadge></article>)}{!data?.inspection_history?.length && <CrewEmptyState title="No completed inspections" body="Completed outlet inspections will appear here." />}</div></CrewBottomSheet>}
  </></State></section>;
}

function AssetDetail({ asset, data, onBack, onAdjust, onInspect }) {
  return <section className="crew-assets-page"><CrewMobileDetailHeader title="Asset Detail" onBack={onBack} /><article className="crew-asset-detail">
    <div className="crew-asset-detail-image">{asset.image_url ? <img src={asset.image_url} alt="" /> : <PackageSearch size={36} />}</div>
    <header><span><small>{asset.asset_code || asset.category_name}</small><h1>{asset.name}</h1></span><CrewStatusBadge tone={tone(asset.condition)}>{labels[asset.condition] || asset.condition}</CrewStatusBadge></header>
    {asset.description && <p>{asset.description}</p>}<dl><div><dt>Quantity</dt><dd>{asset.current_quantity} {asset.unit}</dd></div><div><dt>Category</dt><dd>{asset.category_name}</dd></div><div><dt>Location</dt><dd><MapPin size={15} />{asset.location || "Not set"}</dd></div><div><dt>Last inspection</dt><dd>{asset.last_inspection_at || "Not inspected"}</dd></div></dl>
    {asset.maintenance?.length > 0 && <section className="crew-asset-maintenance"><strong>Maintenance</strong>{asset.maintenance.map((item, index) => <p key={index}>{item.status.replaceAll("_", " ")} · {item.issue || item.scheduled_date || "Scheduled"}</p>)}</section>}
    <footer>{data?.can_adjust_assets && <button className="crew-mobile-ghost" onClick={onAdjust}><SlidersHorizontal size={18} />Adjust Asset</button>}{data?.can_perform_asset_inspections && <button className="crew-mobile-primary" onClick={onInspect}><ClipboardCheck size={18} />Inspect Asset</button>}</footer>
  </article></section>;
}

function AdjustSheet({ token, asset, onClose, onSaved }) {
  const [type, setType] = useState("correction");
  const [quantity, setQuantity] = useState(String(asset.current_quantity));
  const [condition, setCondition] = useState(asset.condition || "healthy");
  const [reason, setReason] = useState("stock_count");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() { setSaving(true); setError(""); try { await crewService.adjustAsset(token, { requestId: requestId(), assetId: asset.id, adjustmentType: type, quantity, condition, reason, note }); await onSaved(); } catch (cause) { setError(cause.message || "Unable to adjust asset."); } finally { setSaving(false); } }
  return <CrewBottomSheet title="Adjust Asset" description={asset.name} onClose={onClose} closeDisabled={saving} footer={<><button className="crew-mobile-ghost" onClick={onClose}>Cancel</button><button className="crew-mobile-primary" disabled={saving || !quantity || !reason} onClick={save}>{saving ? "Saving…" : "Save adjustment"}</button></>}><div className="crew-assets-form">
    <label>Adjustment<select value={type} onChange={(e) => setType(e.target.value)}><option value="correction">Set exact quantity</option><option value="add">Add quantity</option><option value="reduce">Reduce quantity</option></select></label>
    <label>Quantity<input inputMode="decimal" type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
    <label>Condition<select value={condition} onChange={(e) => setCondition(e.target.value)}>{conditions.map((item) => <option key={item} value={item}>{labels[item]}</option>)}</select></label>
    <label>Reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="stock_count">Stock count</option><option value="received">Received</option><option value="used">Used / consumed</option><option value="damaged">Damaged</option><option value="missing">Missing</option><option value="other">Other</option></select></label>
    <label>Note {reason !== "other" && <small>Optional</small>}<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add operational context" /></label>{error && <p className="crew-v2-error" role="alert">{error}</p>}
  </div></CrewBottomSheet>;
}

function InspectionFlow({ token, data, initial, onBack, onSaved }) {
  const draft = initial.draft;
  const [scope, setScope] = useState(draft?.category_scope?.type || initial.scope || "all");
  const [category, setCategory] = useState(draft?.category_scope?.category_ids?.[0] || "");
  const initialAssets = draft ? (draft.draft_data?.rows || []).map((row) => ({ ...data.assets.find((asset) => asset.id === row.asset_id), saved: row })) : initial.assets;
  const scoped = useMemo(() => (initialAssets || data.assets || []).filter((asset) => scope !== "category" || asset.category_id === category), [initialAssets, data.assets, scope, category]);
  const [started, setStarted] = useState(Boolean(draft || initial.scope === "specific"));
  const [index, setIndex] = useState(draft?.current_step ? Math.max(0, draft.current_step - 1) : 0);
  const [rows, setRows] = useState(() => Object.fromEntries((initialAssets || []).map((asset) => [asset.id, asset.saved || { asset_id: asset.id, counted_quantity: asset.current_quantity, condition_status: asset.condition || "healthy", remark: "", evidence: [] }])));
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const current = scoped[index]; const row = current && rows[current.id];
  function patch(values) { setRows((previous) => ({ ...previous, [current.id]: { ...previous[current.id], ...values } })); }
  async function upload(file) { if (!file) return; setSaving(true); setError(""); try { const evidence = await crewService.uploadAssetInspectionEvidence(token, current.id, file); patch({ evidence: [...(row.evidence || []), { image_url: evidence.image_url }] }); } catch (cause) { setError(cause.message || "Unable to upload photo."); } finally { setSaving(false); } }
  const payload = (status) => ({ draft_id: draft?.id || null, status, category_scope: { type: scope, category_ids: category ? [category] : [] }, current_step: index + 1, completion_percentage: scoped.length ? Math.round((index / scoped.length) * 100) : 0, draft_data: { rows: scoped.map((asset) => rows[asset.id]) }, rows: scoped.map((asset) => { const item = rows[asset.id]; const template = data.condition_templates?.find((value) => value.category_id === asset.category_id && value.name.toLowerCase() === (labels[item.condition_status] || item.condition_status).toLowerCase()); return { ...item, condition_template_id: template?.id || null, evidence_required: Boolean(template?.requires_photo) }; }) });
  async function save(status) { setSaving(true); setError(""); try { await crewService.submitAssetInspection(token, { requestId: requestId(), ...payload(status) }); if (status === "completed") await onSaved(); else onBack(); } catch (cause) { setError(cause.message || "Unable to save inspection."); } finally { setSaving(false); } }
  if (!started) return <section className="crew-assets-page"><CrewMobileDetailHeader title="Start Inspection" onBack={onBack} /><div className="crew-inspection-setup"><ClipboardCheck size={30} /><h1>Choose inspection scope</h1><label><input type="radio" checked={scope === "all"} onChange={() => setScope("all")} />Full outlet <small>Inspect every active outlet asset</small></label><label><input type="radio" checked={scope === "category"} onChange={() => setScope("category")} />Category <small>Inspect one asset category</small></label>{scope === "category" && <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Choose category</option>{data.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}<button className="crew-mobile-primary" disabled={scope === "category" && !category} onClick={() => setStarted(true)}>Begin inspection</button></div></section>;
  return <section className="crew-assets-page"><CrewMobileDetailHeader title="Asset Inspection" onBack={onBack} />{current ? <article className="crew-inspection-step"><header><span>Asset {index + 1} of {scoped.length}</span><strong>{current.name}</strong><small>{current.location || current.category_name}</small></header><div className="crew-inspection-progress"><span style={{ width: `${((index + 1) / scoped.length) * 100}%` }} /></div><label>Counted quantity<input type="number" min="0" step="any" inputMode="decimal" value={row.counted_quantity} onChange={(e) => patch({ counted_quantity: e.target.value })} /></label><fieldset><legend>Condition</legend>{conditions.map((item) => <button type="button" key={item} className={row.condition_status === item ? "active" : ""} onClick={() => patch({ condition_status: item })}>{labels[item]}</button>)}</fieldset><label>Note<textarea value={row.remark} onChange={(e) => patch({ remark: e.target.value })} placeholder="Add details when attention is needed" /></label><label className="crew-assets-photo"><Camera size={18} />Add photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => void upload(e.target.files?.[0])} /></label>{row.evidence?.length > 0 && <small>{row.evidence.length} photo attached</small>}{error && <p className="crew-v2-error" role="alert">{error}</p>}<footer><button className="crew-mobile-ghost" disabled={saving} onClick={() => void save("in_progress")}>Save draft</button>{index > 0 && <button className="crew-mobile-ghost" onClick={() => setIndex(index - 1)}>Previous</button>}{index < scoped.length - 1 ? <button className="crew-mobile-primary" onClick={() => setIndex(index + 1)}>Next</button> : <button className="crew-mobile-primary" disabled={saving} onClick={() => void save("completed")}>Complete inspection</button>}</footer></article> : <CrewEmptyState title="No assets in this scope" body="Choose another inspection scope." />}</section>;
}
