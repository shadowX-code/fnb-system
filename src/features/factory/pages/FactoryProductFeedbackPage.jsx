import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Copy, Ellipsis, Eye, GripVertical, Link2, Pencil, Plus, QrCode, Trash2 } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import FactoryFilterBar from "../components/FactoryFilterBar.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import { FactoryEvidenceGrid, FactoryEvidenceHeader, FactoryEvidenceSection } from "../components/FactoryEvidencePresentation.jsx";
import FactoryPagination, { useFactoryClientPagination } from "../components/FactoryPagination.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import FactorySummaryCard from "../components/FactorySummaryCard.jsx";
import { CompactSelect, Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "../components/FeedXDatePicker.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { FactoryCellEntity, FactoryCellMuted } from "../components/FactoryTableCell.jsx";
import { formatFactoryDateTime } from "../utils/factoryDates.js";
import { factoryService } from "../../../services/factoryService.js";
import { sambalFeedbackTemplate } from "../productFeedbackTemplate.js";
import "../FactoryProductFeedbackPage.css";
import { buildProductFeedbackInsights } from "../utils/productFeedbackInsights.js";
import { toDataURL } from "qrcode";
import { productFeedbackPublicUrl } from "../productFeedbackPublicUrl.js";

function publicUrl(token) { return productFeedbackPublicUrl(token); }
function displayAnswer(value) { return Array.isArray(value) ? value.join(", ") : value || "—"; }
const campaignContentDefaults = (campaign = {}) => ({ title: { en: campaign.name || "", zh: "", ms: "" }, description: { en: "", zh: "", ms: "" }, intro_title: { en: "", zh: "", ms: "" }, intro_body: { en: "", zh: "", ms: "" }, thank_you_title: { en: "Thank you", zh: "谢谢您的反馈", ms: "Terima kasih" }, thank_you_body: { en: campaign.thank_you_en || "", zh: campaign.thank_you_zh || "", ms: "" } });
const contactCollectionDefaults = { enabled: false, prompt: { en: "Interested in this product? Leave your details and we'll keep you updated.", zh: "对这款产品感兴趣？留下您的资料，我们会为您提供最新消息。", ms: "Berminat dengan produk ini? Tinggalkan butiran anda dan kami akan maklumkan perkembangan terkini." } };
export function productFeedbackCampaignEditorState(campaign = {}) {
  const defaults = campaignContentDefaults(campaign); const content = campaign.content || {};
  const contactCollection = campaign.contact_collection || {};
  return { ...campaign, questions: campaign.questions?.length ? campaign.questions : sambalFeedbackTemplate, content: { ...defaults, ...content, ...Object.fromEntries(Object.keys(defaults).map((key) => [key, { ...defaults[key], ...(content[key] || {}) }])) }, branding: campaign.branding && typeof campaign.branding === "object" && !Array.isArray(campaign.branding) ? { ...campaign.branding } : {}, contact_collection: { ...contactCollectionDefaults, ...contactCollection, prompt: { ...contactCollectionDefaults.prompt, ...(contactCollection.prompt || {}) } } };
}

const campaignBrandingAssetFields = new Set(["logo_url", "hero_url", "thank_you_image_url"]);

function campaignBrandingAssetUrl(field, publicUrl) {
  if (!campaignBrandingAssetFields.has(field)) throw new Error("Unsupported campaign branding asset.");
  const value = String(publicUrl || "").trim();
  if (!value) throw new Error("Image upload did not return a usable asset.");
  return value;
}

export function applyCampaignBrandingAsset(form, field, publicUrl) {
  const value = campaignBrandingAssetUrl(field, publicUrl);
  const branding = form?.branding && typeof form.branding === "object" && !Array.isArray(form.branding) ? form.branding : {};
  return { ...form, branding: { ...branding, [field]: value } };
}

export default function FactoryProductFeedbackPage({ auth, onNotify }) {
  const [list, setList] = useState({ campaigns: [], finished_goods: [] }); const [detail, setDetail] = useState(null); const [selected, setSelected] = useState(null); const [tab, setTab] = useState("overview"); const [editor, setEditor] = useState(null); const [response, setResponse] = useState(null); const [variantName, setVariantName] = useState(""); const [search, setSearch] = useState(""); const [variant, setVariant] = useState("");
  const can = (permission) => Boolean(auth?.hasPermission?.(permission)); const canEdit = can("factory_product_feedback.edit") || can("factory_product_feedback.manage") || can("factory_product_feedback.create");
  const loadList = async () => { const data = await factoryService.listProductFeedbackAdmin(); setList(data); return data; };
  const openCampaign = async (campaign) => { const data = await factoryService.getProductFeedbackCampaign(campaign.id); setSelected(campaign.id); setDetail(data); setTab("overview"); return data; };
  const editCampaign = async (campaign) => { try { const data = await factoryService.getProductFeedbackCampaign(campaign.id); setEditor(data.campaign); } catch (error) { onNotify?.({ title: "Unable to open campaign", message: error.message, tone: "error" }); } };
  useEffect(() => { loadList().catch((error) => onNotify?.({ title: "Unable to load Product Feedback", message: error.message, tone: "error" })); }, []);
  const campaigns = useMemo(() => (list.campaigns || []).filter((campaign) => `${campaign.name} ${campaign.event_label || ""}`.toLowerCase().includes(search.toLowerCase())), [list, search]);
  const responses = useMemo(() => (detail?.responses || []).filter((row) => (!variant || row.variant_id === variant) && JSON.stringify(row.answers).toLowerCase().includes(search.toLowerCase())), [detail, variant, search]);
  const pager = useFactoryClientPagination("product-feedback-responses", responses.length, 20, `${selected || ""}:${search}:${variant}`);
  async function saveCampaign(value) { const saved = await factoryService.saveProductFeedbackCampaign(value); setEditor(null); await loadList(); const data = await openCampaign(saved); onNotify?.({ title: "Campaign saved", tone: "success" }); return data?.campaign || saved; }
  async function addVariant() { if (!variantName.trim()) return; await factoryService.saveProductFeedbackVariant({ campaign_id: selected, name: variantName.trim(), is_active: true }); setVariantName(""); await openCampaign({ id: selected }); }
  function copyLink(token) { navigator.clipboard?.writeText(publicUrl(token)); onNotify?.({ title: "Public link copied", tone: "success" }); }
  async function downloadQr(token, name = "product-feedback") { const href = await toDataURL(publicUrl(token), { width: 640, margin: 1 }); const link = document.createElement("a"); link.href = href; link.download = `${name}.png`; link.click(); }
  const CampaignModal = CampaignEditorModal;
  if (!selected) return <div className="space-y-5"><PageHeader section="Factory" title="Product Feedback" description="Create tasting campaigns and review anonymous product feedback." actions={canEdit ? <button className="btn-primary" type="button" onClick={() => setEditor({ name: "", status: "draft", default_language: "en", questions: sambalFeedbackTemplate })}><Plus size={15} /> Create Campaign</button> : null} /><FactoryFilterBar activeFilters={search ? [{ key: "search", label: "Search", value: search, onRemove: () => setSearch("") }] : []} onClear={() => setSearch("")}><Field label="Search"><input className={inputClass()} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search campaigns or events" /></Field></FactoryFilterBar><FactoryDataSurface><FactoryTable rows={campaigns} rowHover="mint" onRowClick={openCampaign} emptyTitle="No Product Feedback campaigns" emptyDescription="Create a campaign to collect tasting feedback." columns={[{ key: "name", label: "Campaign", render: (row) => <FactoryCellEntity name={row.name} code={row.event_label} /> }, { key: "period", label: "Period", render: (row) => [row.starts_on, row.ends_on].filter(Boolean).join(" – ") || <FactoryCellMuted>Open</FactoryCellMuted> }, { key: "responses", label: "Responses", align: "right", render: (row) => row.response_count || 0 }, { key: "status", label: "Status", render: (row) => <FactoryStatusBadge status={row.status === "live" ? "Active" : row.status === "closed" ? "Closed" : "Draft"} /> }, { key: "actions", label: "Actions", align: "right", render: (row) => <FactoryRowActions onView={() => openCampaign(row)} directActions={canEdit ? [{ label: "Edit campaign", onClick: () => editCampaign(row) }] : []} /> }]} /></FactoryDataSurface>{editor ? <CampaignModal campaign={editor} finishedGoods={list.finished_goods} onClose={() => setEditor(null)} onSave={saveCampaign} onNotify={onNotify} /> : null}</div>;
  const campaign = detail?.campaign || {}; const summary = detail?.summary || {};
  if (tab === "overview") return <><CampaignOverview campaign={campaign} summary={summary} responses={detail?.responses || []} variants={detail?.variants || []} canEdit={canEdit} variantName={variantName} onVariantName={setVariantName} onAddVariant={addVariant} onCampaigns={() => { setSelected(null); setDetail(null); setSearch(""); }} onEdit={() => setEditor(campaign)} onTabChange={setTab} onCopy={copyLink} onDownload={downloadQr} />{editor ? <CampaignEditorModal campaign={editor} finishedGoods={list.finished_goods} onClose={() => setEditor(null)} onSave={saveCampaign} onNotify={onNotify} /> : null}</>;
  return <div className="space-y-5"><PageHeader section="Factory" title={campaign.name || "Product Feedback"} description={campaign.event_label || "Tasting campaign"} actions={<div className="flex gap-2"><button className="btn-secondary" type="button" onClick={() => { setSelected(null); setDetail(null); setSearch(""); }}>Campaigns</button>{canEdit ? <button className="btn-primary" type="button" onClick={() => setEditor(campaign)}>Edit Campaign</button> : null}</div>} /><div className="flex border-b border-border"><Tabs value={tab} onChange={setTab} /></div>{tab === "overview" ? <><div className="grid gap-3 md:grid-cols-4"><FactorySummaryCard icon={ClipboardList} label="Responses" value={summary.responses || 0} /><FactorySummaryCard icon={Star} tone="success" label="Overall Rating" value={summary.overall_rating || "—"} /><FactorySummaryCard icon={ThumbsUp} tone="success" label="Would Buy" value={`${summary.would_buy_percent || 0}%`} /><FactorySummaryCard icon={QrCode} tone="info" label="Just right spiciness" value={`${summary.just_right_spiciness_percent || 0}%`} /></div><FactoryDataSurface><div className="space-y-4 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-text-primary">Public feedback link</h2><p className="mt-1 text-sm text-text-secondary">Live campaigns can be shared by campaign or sample variant.</p></div><div className="flex gap-2"><button className="btn-secondary" type="button" onClick={() => copyLink(campaign.public_id)}><Copy size={15} /> Copy link</button><button className="btn-secondary" type="button" onClick={() => downloadQr(campaign.public_id, campaign.name)}><QrCode size={15} /> QR PNG</button><a className="btn-secondary" href={publicUrl(campaign.public_id)} target="_blank" rel="noreferrer"><Eye size={15} /> Preview</a></div></div><div className="rounded-lg border border-border bg-[var(--theme-subtle)] p-3 text-sm font-medium text-text-secondary break-all">{publicUrl(campaign.public_id)}</div><div className="border-t border-border pt-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-text-primary">Variants / samples</h2>{canEdit ? <div className="flex gap-2"><input className={`${inputClass()} h-9`} value={variantName} placeholder="Sambal A" onChange={(event) => setVariantName(event.target.value)} /><button type="button" className="btn-secondary h-9" onClick={addVariant}>Add variant</button></div> : null}</div>{detail?.variants?.length ? <div className="grid gap-2 md:grid-cols-2">{detail.variants.map((item) => <div className="flex items-center justify-between rounded-lg border border-border p-3" key={item.id}><span className="font-semibold text-text-primary">{item.name}</span><div className="flex gap-2"><button className="icon-btn" title="Copy variant link" type="button" onClick={() => copyLink(item.public_token)}><Link2 size={15} /></button><button className="icon-btn" title="Download variant QR" type="button" onClick={() => downloadQr(item.public_token, item.name)}><QrCode size={15} /></button><a className="icon-btn" title="Preview variant" href={publicUrl(item.public_token)} target="_blank" rel="noreferrer"><Eye size={15} /></a></div></div>)}</div> : <p className="text-sm text-text-secondary">No variants. This campaign uses one shared public link.</p>}</div></div></FactoryDataSurface></> : null}{tab === "form" ? <FormBuilder campaign={campaign} editable={canEdit} onSave={async (questions) => saveCampaign({ ...campaign, questions })} onNotify={onNotify} /> : null}{tab === "responses" ? <><FactoryFilterBar activeFilters={[search && { key: "search", label: "Search", value: search, onRemove: () => setSearch("") }, variant && { key: "variant", label: "Variant", value: detail.variants?.find((item) => item.id === variant)?.name || variant, onRemove: () => setVariant("") }].filter(Boolean)} onClear={() => { setSearch(""); setVariant(""); }}><Field label="Search"><input className={inputClass()} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search answers" /></Field><Field label="Variant"><SearchableSelect value={variant} placeholder="All" options={[{ value: "", label: "All" }, ...(detail.variants || []).map((item) => ({ value: item.id, label: item.name }))]} onChange={setVariant} /></Field></FactoryFilterBar><FactoryDataSurface><FactoryTable rows={responses.slice(pager.from, pager.to)} emptyTitle="No feedback responses" columns={[{ key: "submitted", label: "Submitted", render: (row) => formatFactoryDateTime(row.submitted_at) }, { key: "variant", label: "Variant", render: (row) => row.variant_name || <FactoryCellMuted>Campaign</FactoryCellMuted> }, { key: "rating", label: "Rating", render: (row) => row.answers?.overall_rating || "—" }, { key: "intent", label: "Purchase Intent", render: (row) => row.answers?.purchase_intent || "—" }, { key: "repeat", label: "Repeat", render: (row) => row.repeat_index > 1 ? `Possible repeat #${row.repeat_index}` : "—" }, { key: "actions", label: "Actions", align: "right", render: (row) => <FactoryRowActions onView={() => setResponse(row)} /> }]} /><FactoryPagination page={pager.page} pageSize={pager.pageSize} total={responses.length} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} /></FactoryDataSurface></> : null}{editor ? <CampaignModal campaign={editor} finishedGoods={list.finished_goods} onClose={() => setEditor(null)} onSave={saveCampaign} onNotify={onNotify} /> : null}{response ? <ResponseModal response={response} onClose={() => setResponse(null)} /> : null}</div>;
  return <div className="space-y-5"><PageHeader section="Factory" title={campaign.name || "Product Feedback"} description={campaign.event_label || "Tasting campaign"} actions={<div className="flex gap-2"><button className="btn-secondary" type="button" onClick={() => { setSelected(null); setDetail(null); setSearch(""); }}>Campaigns</button>{canEdit ? <button className="btn-primary" type="button" onClick={() => setEditor(campaign)}>Edit Campaign</button> : null}</div>} /><div className="flex border-b border-border"><Tabs value={tab} onChange={setTab} /></div>{tab === "overview" ? <><div className="grid gap-3 md:grid-cols-4">{campaignSummaryCards(summary).filter((item) => item.key === "responses" || (item.value !== null && item.value !== undefined && item.value !== "—")).map((item) => <FactorySummaryCard key={item.key} icon={item.icon} tone={item.tone} label={item.label} value={item.value} />)}</div><FactoryDataSurface><div className="space-y-4 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-text-primary">Public feedback link</h2><p className="mt-1 text-sm text-text-secondary">Live campaigns can be shared by campaign or sample variant.</p></div><div className="flex gap-2"><button className="btn-secondary" type="button" onClick={() => copyLink(campaign.public_id)}><Copy size={15} /> Copy link</button><button className="btn-secondary" type="button" onClick={() => downloadQr(campaign.public_id, campaign.name)}><QrCode size={15} /> QR PNG</button><a className="btn-secondary" href={publicUrl(campaign.public_id)} target="_blank" rel="noreferrer"><Eye size={15} /> Preview</a></div></div><div className="rounded-lg border border-border bg-[var(--theme-subtle)] p-3 text-sm font-medium text-text-secondary break-all">{publicUrl(campaign.public_id)}</div><div className="border-t border-border pt-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-text-primary">Variants / samples</h2>{canEdit ? <div className="flex gap-2"><input className={`${inputClass()} h-9`} value={variantName} placeholder="Sambal A" onChange={(event) => setVariantName(event.target.value)} /><button type="button" className="btn-secondary h-9" onClick={addVariant}>Add variant</button></div> : null}</div>{detail?.variants?.length ? <div className="grid gap-2 md:grid-cols-2">{detail.variants.map((item) => <div className="flex items-center justify-between rounded-lg border border-border p-3" key={item.id}><span className="font-semibold text-text-primary">{item.name}</span><div className="flex gap-2"><button className="icon-btn" title="Copy variant link" type="button" onClick={() => copyLink(item.public_token)}><Link2 size={15} /></button><button className="icon-btn" title="Download variant QR" type="button" onClick={() => downloadQr(item.public_token, item.name)}><QrCode size={15} /></button><a className="icon-btn" title="Preview variant" href={publicUrl(item.public_token)} target="_blank" rel="noreferrer"><Eye size={15} /></a></div></div>)}</div> : <p className="text-sm text-text-secondary">No variants. This campaign uses one shared public link.</p>}</div></div></FactoryDataSurface></> : null}{tab === "form" ? <FormBuilder campaign={campaign} editable={canEdit} onSave={async (questions) => saveCampaign({ ...campaign, questions })} onNotify={onNotify} /> : null}{tab === "responses" ? <><FactoryFilterBar activeFilters={[search && { key: "search", label: "Search", value: search, onRemove: () => setSearch("") }, variant && { key: "variant", label: "Variant", value: detail.variants?.find((item) => item.id === variant)?.name || variant, onRemove: () => setVariant("") }].filter(Boolean)} onClear={() => { setSearch(""); setVariant(""); }}><Field label="Search"><input className={inputClass()} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search answers" /></Field><Field label="Variant"><SearchableSelect value={variant} placeholder="All" options={[{ value: "", label: "All" }, ...(detail.variants || []).map((item) => ({ value: item.id, label: item.name }))]} onChange={setVariant} /></Field></FactoryFilterBar><FactoryDataSurface><FactoryTable rows={responses.slice(pager.from, pager.to)} emptyTitle="No feedback responses" columns={[{ key: "submitted", label: "Submitted", render: (row) => formatFactoryDateTime(row.submitted_at) }, { key: "variant", label: "Variant", render: (row) => row.variant_name || <FactoryCellMuted>Campaign</FactoryCellMuted> }, { key: "rating", label: "Rating", render: (row) => row.answers?.overall_rating || "—" }, { key: "intent", label: "Purchase Intent", render: (row) => row.answers?.purchase_intent || "—" }, { key: "repeat", label: "Repeat", render: (row) => row.repeat_index > 1 ? `Possible repeat #${row.repeat_index}` : "—" }, { key: "actions", label: "Actions", align: "right", render: (row) => <FactoryRowActions onView={() => setResponse(row)} /> }]} /><FactoryPagination page={pager.page} pageSize={pager.pageSize} total={responses.length} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} /></FactoryDataSurface></> : null}{editor ? <CampaignModal campaign={editor} finishedGoods={list.finished_goods} onClose={() => setEditor(null)} onSave={saveCampaign} onNotify={onNotify} /> : null}{response ? <ResponseModal response={response} onClose={() => setResponse(null)} /> : null}</div>;
}

function Tabs({ value, onChange }) { return <>{["overview", "form", "responses"].map((item) => <button key={item} type="button" className={`px-4 py-3 text-sm font-semibold capitalize ${value === item ? "border-b-2 border-primary text-primary" : "text-text-secondary"}`} onClick={() => onChange(item)}>{item}</button>)}</>; }
const languages = [{ key: "en", label: "EN" }, { key: "zh", label: "中文" }, { key: "ms", label: "BM" }];
const types = [
  { value: "single_choice", label: "Single Choice" },
  { value: "multi_choice", label: "Multiple Choice" },
  { value: "rating", label: "Rating" },
  { value: "price_choice", label: "Price" },
  { value: "short_text", label: "Short Answer" },
  { value: "image_choice", label: "Image Choice" },
];
const questionTypes = new Set(types.map((item) => item.value));
const emptyQuestion = (order) => ({ key: `question_${Date.now()}`, label_en: "New question", label_zh: "", label_ms: "", helper_en: "", helper_zh: "", helper_ms: "", type: "short_text", required: false, options: [], order });
export function productFeedbackQuestionDraft(question, order = 1) {
  const fallback = emptyQuestion(order);
  const next = question && typeof question === "object" ? { ...fallback, ...question } : fallback;
  return {
    ...next,
    type: questionTypes.has(next.type) ? next.type : fallback.type,
    options: Array.isArray(next.options) ? next.options : [],
    rating_scale: next.type === "rating" ? 5 : next.rating_scale,
    order: Number.isFinite(next.order) ? next.order : order,
  };
}
const normalizedTranslationText = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
export function productFeedbackTranslationMissing(source, target, language) {
  const sourceText = normalizedTranslationText(source);
  const targetText = normalizedTranslationText(target);
  if (!targetText) return true;
  // Legacy Chinese option fields were populated with their English fallback.
  // Treat only that invalid copy as missing; real localized values remain untouched.
  return language === "zh" && sourceText === targetText && /[a-z]/i.test(sourceText) && !/^[a-z]{1,4}\d[\w.-]*$/i.test(sourceText);
}
export function productFeedbackLanguageCompleteness(question, language) {
  const required = [[question?.label_en, question?.[`label_${language}`]]];
  if (String(question?.helper_en || "").trim()) required.push([question.helper_en, question?.[`helper_${language}`]]);
  if (question?.type === "rating") {
    if (String(question?.rating_low_label_en || "").trim()) required.push([question.rating_low_label_en, question?.[`rating_low_label_${language}`]]);
    if (String(question?.rating_high_label_en || "").trim()) required.push([question.rating_high_label_en, question?.[`rating_high_label_${language}`]]);
  }
  (question?.options || []).forEach((option) => { if (String(option.label_en || "").trim()) required.push([option.label_en, option[`label_${language}`]]); });
  const missing = required.filter(([source, target]) => productFeedbackTranslationMissing(source, target, language)).length;
  return missing === 0 ? "Complete" : missing === required.length ? "Missing" : "Partial";
}
export function productFeedbackFormCompleteness(questions = []) {
  return Object.fromEntries(languages.map(({ key }) => [key, questions.filter((question) => productFeedbackLanguageCompleteness(question, key) === "Complete").length]));
}
export function campaignSummaryCards(summary) {
  return [{ key: "responses", icon: ClipboardList, label: "Responses", value: summary.responses || 0, tone: "neutral" }];
}

function CampaignOverview({ campaign, summary, responses, variants, canEdit, variantName, onVariantName, onAddVariant, onCampaigns, onEdit, onTabChange, onCopy, onDownload }) {
  const insights = useMemo(() => buildProductFeedbackInsights({
    questions: campaign.questions || [],
    // Contact data is intentionally excluded from deterministic and AI insight inputs.
    responses: responses.map(({ answers, questions_snapshot }) => ({ answers, questions_snapshot })),
  }), [campaign.questions, responses]);
  const [aiInsights, setAiInsights] = useState([]);
  useEffect(() => {
    let current = true;
    setAiInsights([]);
    if (!campaign.id || !insights.responseCount || !insights.findings.length) return undefined;
    factoryService.interpretProductFeedbackInsights(insights)
      .then((items) => { if (current) setAiInsights(items); })
      .catch(() => { if (current) setAiInsights([]); });
    return () => { current = false; };
  }, [campaign.id, insights]);
  return <div className="space-y-5"><PageHeader section="Factory" title={campaign.name || "Product Feedback"} description={campaign.event_label || "Tasting campaign"} actions={<div className="flex gap-2"><button className="btn-secondary" type="button" onClick={onCampaigns}>Campaigns</button>{canEdit ? <button className="btn-primary" type="button" onClick={onEdit}>Edit Campaign</button> : null}</div>} /><div className="flex border-b border-border"><Tabs value="overview" onChange={onTabChange} /></div><div className={`grid gap-3 ${campaign.contact_collection?.enabled ? "md:grid-cols-2" : "max-w-xs"}`}><FactorySummaryCard icon={ClipboardList} label="Responses" value={summary.responses || 0} />{campaign.contact_collection?.enabled ? <FactorySummaryCard icon={ClipboardList} tone="info" label="Contacts" value={summary.contacts || 0} /> : null}</div><FeedbackInsights insights={insights} aiInsights={aiInsights} /><FactoryDataSurface><div className="space-y-4 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-text-primary">Public feedback link</h2><p className="mt-1 text-sm text-text-secondary">Live campaigns can be shared by campaign or sample variant.</p></div><div className="flex gap-2"><button className="btn-secondary" type="button" onClick={() => onCopy(campaign.public_id)}><Copy size={15} /> Copy link</button><button className="btn-secondary" type="button" onClick={() => onDownload(campaign.public_id, campaign.name)}><QrCode size={15} /> QR PNG</button><a className="btn-secondary" href={publicUrl(campaign.public_id)} target="_blank" rel="noreferrer"><Eye size={15} /> Preview</a></div></div><div className="rounded-lg border border-border bg-[var(--theme-subtle)] p-3 text-sm font-medium text-text-secondary break-all">{publicUrl(campaign.public_id)}</div><div className="border-t border-border pt-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-text-primary">Variants / samples</h2>{canEdit ? <div className="flex gap-2"><input className={`${inputClass()} h-9`} value={variantName} placeholder="Sambal A" onChange={(event) => onVariantName(event.target.value)} /><button type="button" className="btn-secondary h-9" onClick={onAddVariant}>Add variant</button></div> : null}</div>{variants.length ? <div className="grid gap-2 md:grid-cols-2">{variants.map((item) => <div className="flex items-center justify-between rounded-lg border border-border p-3" key={item.id}><span className="font-semibold text-text-primary">{item.name}</span><div className="flex gap-2"><button className="icon-btn" title="Copy variant link" type="button" onClick={() => onCopy(item.public_token)}><Link2 size={15} /></button><button className="icon-btn" title="Download variant QR" type="button" onClick={() => onDownload(item.public_token)}><QrCode size={15} /></button><a className="icon-btn" title="Preview variant" href={publicUrl(item.public_token)} target="_blank" rel="noreferrer"><Eye size={15} /></a></div></div>)}</div> : <p className="text-sm text-text-secondary">No variants. This campaign uses one shared public link.</p>}</div></div></FactoryDataSurface></div>;
}

function FeedbackInsights({ insights, aiInsights = [] }) {
  if (!insights.responseCount) return <FactoryDataSurface><section className="p-5"><h2 className="text-sm font-bold text-text-primary">Feedback Insights</h2><p className="mt-1 text-sm text-text-secondary">Insights appear after the first response is submitted.</p></section></FactoryDataSurface>;
  return <FactoryDataSurface>
    <section className="space-y-4 p-5">
      <header>
        <h2 className="text-base font-bold text-text-primary">Feedback Insights</h2>
        <p className="mt-1 text-sm text-text-secondary">{insights.sampleNote} Interpretation uses only calculated aggregates.</p>
      </header>
      {aiInsights.length ? <section className="rounded-lg border border-border bg-[var(--theme-subtle)] p-4">
        <h3 className="text-sm font-bold text-text-primary">Interpretation</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">{aiInsights.map((item) => <article key={`${item.section}:${item.text}`}><p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{item.section}</p><p className="mt-1 text-sm leading-6 text-text-secondary">{item.text}</p></article>)}</div>
      </section> : null}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <section className="rounded-lg border border-border bg-[var(--theme-subtle)] p-4"><h3 className="text-sm font-bold text-text-primary">Key findings</h3><ul className="mt-3 space-y-2 text-sm leading-6 text-text-secondary">{insights.findings.map((finding) => <li key={finding}>{finding}</li>)}</ul></section>
        <section className="grid gap-3 sm:grid-cols-2">{insights.questionInsights.slice(0, 4).map((item) => <article className="rounded-lg border border-border p-4" key={item.key}><h3 className="text-sm font-bold text-text-primary">{item.label}</h3>{item.type === "rating" ? <p className="mt-3 text-2xl font-bold text-text-primary">{item.average.toFixed(2)}<span className="ml-1 text-sm font-medium text-text-secondary">/ 5</span></p> : item.type === "price" && item.average !== null ? <p className="mt-3 text-2xl font-bold text-text-primary">{item.currency} {item.average.toFixed(2)}</p> : <div className="mt-3 space-y-2">{item.distribution.slice(0, 3).map((option) => <div key={option.value}><div className="flex justify-between gap-3 text-xs"><span className="truncate text-text-secondary">{option.label}</span><span className="font-semibold text-text-primary">{option.percent}%</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--theme-subtle)]"><div className="h-full rounded-full bg-primary" style={{ width: `${option.percent}%` }} /></div></div>)}</div>}</article>)}</section>
      </div>
      {insights.segments.length ? <section className="border-t border-border pt-4"><h3 className="text-sm font-bold text-text-primary">Segment differences</h3><div className="mt-3 grid gap-3 md:grid-cols-2">{insights.segments.map((segment) => <article className="rounded-lg border border-border p-4" key={segment.segmentLabel}><p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{segment.segmentLabel} · {segment.outcomeLabel}</p><div className="mt-2 space-y-1 text-sm text-text-secondary">{segment.values.map((item) => <p key={item.segment}><span className="font-semibold text-text-primary">{item.segment}</span> · {item.kind === "average" ? `${item.value.toFixed(2)} / 5` : item.value} <span className="text-text-muted">(n={item.count})</span></p>)}</div></article>)}</div></section> : null}
    </section>
  </FactoryDataSurface>;
}


export function CampaignEditorModal({ campaign, finishedGoods, onClose, onSave, onNotify }) {
  const [form, setForm] = useState(() => productFeedbackCampaignEditorState(campaign));
  const [language, setLanguage] = useState("en");
  const [uploading, setUploading] = useState("");
  const [uploadError, setUploadError] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const uploadRequest = useRef(0);
  const translationRequest = useRef(false);
  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);
  const updateContent = (field, value) => setForm((current) => ({ ...current, content: { ...current.content, [field]: { ...(current.content?.[field] || {}), [language]: value } } }));
  const updateBranding = (field, value) => setForm((current) => ({ ...current, branding: { ...(current.branding && typeof current.branding === "object" ? current.branding : {}), [field]: value } }));
  const upload = async (event, field) => {
    const input = event.currentTarget;
    const file = input?.files?.[0];
    if (input) input.value = "";
    if (!file) return;
    const requestId = ++uploadRequest.current;
    setUploading(field); setUploadError(null);
    try {
      const image = await factoryService.uploadProductFeedbackImage(file, form, field);
      // Validate before entering React's state queue. A rejected result must remain in this
      // handler so it cannot turn into a render-phase failure inside the modal subtree.
      const assetUrl = campaignBrandingAssetUrl(field, image?.publicUrl);
      if (requestId !== uploadRequest.current || !isMounted.current) return;
      setForm((current) => {
        const branding = current.branding && typeof current.branding === "object" && !Array.isArray(current.branding) ? current.branding : {};
        return { ...current, branding: { ...branding, [field]: assetUrl } };
      });
    } catch (error) {
      if (requestId !== uploadRequest.current || !isMounted.current) return;
      const message = error.message || "Unable to upload this image.";
      setUploadError({ field, message });
      onNotify?.({ title: "Image upload failed", message, tone: "error" });
    } finally {
      if (requestId === uploadRequest.current && isMounted.current) setUploading("");
    }
  };
  const translateContent = async () => {
    if (translationRequest.current) return;
    translationRequest.current = true;
    const fields = ["title", "description", "thank_you_title", "thank_you_body"];
    const targets = languages.filter((item) => item.key !== language).map((item) => item.key);
    const units = fields.flatMap((field) => {
      const source = form.content?.[field]?.[language] || (field === "title" && language === "en" ? form.name : "");
      const missing = targets.filter((target) => !form.content?.[field]?.[target]);
      return String(source || "").trim() && missing.length ? [{ id: `content:${field}`, source, targets: missing }] : [];
    });
    if (!units.length) { translationRequest.current = false; return; }
    setTranslating(true);
    try {
      const results = await factoryService.translateProductFeedbackContent({ sourceLanguage: language, units });
      setForm((current) => {
        const next = structuredClone(current);
        results.forEach((result) => {
          const field = String(result.id).split(":")[1];
          next.content[field] = { ...(next.content[field] || {}), [result.language]: result.text };
        });
        return next;
      });
    } catch (error) {
      onNotify?.({ title: "AI translation unavailable", message: error.message, tone: "error" });
    } finally { translationRequest.current = false; setTranslating(false); }
  };
  const save = async (event) => {
    event.preventDefault();
    if (form.starts_on && form.ends_on && form.ends_on < form.starts_on) {
      const message = "End date must be on or after start date.";
      setSaveError(message);
      onNotify?.({ title: "Campaign schedule needs attention", message, tone: "error" });
      return;
    }
    setSaving(true); setSaveError("");
    try {
      // Question changes remain owned by Form Builder. Branding/settings saves must not
      // trip immutable response-snapshot protection on a live campaign.
      const { questions, ...campaignSettings } = form;
      await onSave(form.id ? campaignSettings : form);
    }
    catch (error) {
      const message = error.message || "Unable to save campaign branding.";
      setSaveError(message);
      onNotify?.({ title: "Campaign save failed", message, tone: "error" });
    } finally { setSaving(false); }
  };
  const scheduleError = form.starts_on && form.ends_on && form.ends_on < form.starts_on ? "End date must be on or after start date." : "";
  return <CampaignEditorSections form={form} setForm={setForm} finishedGoods={finishedGoods} language={language} onLanguage={setLanguage} translating={translating} onTranslate={translateContent} uploading={uploading} uploadError={uploadError} onUpload={upload} onRemove={updateBranding} scheduleError={scheduleError} saveError={saveError} onClose={onClose} saving={saving} onSave={save} />;
}

function CampaignEditorSections({ form, setForm, finishedGoods, language, onLanguage, translating, onTranslate, uploading, uploadError, onUpload, onRemove, scheduleError, saveError, onClose, saving, onSave }) {
  const updateContent = (field, value) => setForm((current) => ({ ...current, content: { ...current.content, [field]: { ...(current.content?.[field] || {}), [language]: value } } }));
  const updateBranding = (field, value) => setForm((current) => ({ ...current, branding: { ...current.branding, [field]: value } }));
  return <Modal title={form.id ? "Edit Campaign" : "Create Campaign"} onClose={onClose} size="lg" panelClassName="factory-product-feedback-campaign-modal" bodyClassName="factory-product-feedback-campaign-modal-body" footer={<><button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" form="product-feedback-campaign-form" disabled={saving || Boolean(uploading)} type="submit">{saving ? "Saving…" : "Save Campaign"}</button></>}><form id="product-feedback-campaign-form" className="space-y-5" onSubmit={onSave}>
    <CampaignEditorSection title="Campaign Details">
      <div className="grid gap-3 md:grid-cols-2"><Field label="Campaign Name" helper="Internal name for Admin management."><input aria-label="Campaign name" required className={inputClass()} value={form.name || ""} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value, content: { ...current.content, title: { ...(current.content?.title || {}), en: event.target.value } } }))} /></Field><Field label="Finished Good"><SearchableSelect value={form.finished_good_id || ""} placeholder="Optional" options={[{ value: "", label: "None" }, ...(finishedGoods || []).map((item) => ({ value: item.id, label: `${item.code || ""} ${item.name}` }))]} onChange={(finished_good_id) => setForm((current) => ({ ...current, finished_good_id }))} /></Field><Field label="Event / Location (Optional)"><input className={inputClass()} value={form.event_label || ""} onChange={(event) => setForm((current) => ({ ...current, event_label: event.target.value }))} /></Field><Field label="Status"><SearchableSelect value={form.status || "draft"} options={[{ value: "draft", label: "Draft" }, { value: "live", label: "Live" }, { value: "closed", label: "Closed" }]} onChange={(status) => setForm((current) => ({ ...current, status }))} /></Field></div>
    </CampaignEditorSection>
    <CampaignEditorSection title="Schedule">
      <div className="grid gap-3 md:grid-cols-2"><Field label="Start Date"><FeedXDatePicker value={form.starts_on || ""} placeholder="Select date" onChange={(starts_on) => setForm((current) => ({ ...current, starts_on }))} /></Field><Field label="End Date" error={scheduleError}><FeedXDatePicker value={form.ends_on || ""} placeholder="Select date" error={scheduleError} onChange={(ends_on) => setForm((current) => ({ ...current, ends_on }))} /></Field></div>
    </CampaignEditorSection>
    <CampaignEditorSection title="Public Content" actions={<div className="flex items-center gap-2"><button type="button" className="btn-secondary h-8" disabled={translating} onClick={onTranslate}>{translating ? "Translating…" : "Translate Missing"}</button><LanguageTabs value={language} onChange={onLanguage} /></div>}>
      <div className="grid gap-3"><Field label="Campaign Title" helper="Shown to customers on the feedback form."><input className={inputClass()} value={form.content?.title?.[language] || ""} onChange={(event) => updateContent("title", event.target.value)} /></Field><Field label="Description"><textarea className={`${inputClass()} min-h-20`} value={form.content?.description?.[language] || ""} onChange={(event) => updateContent("description", event.target.value)} /></Field><div className="grid gap-3 md:grid-cols-2"><Field label="Thank-you Title"><input className={inputClass()} value={form.content?.thank_you_title?.[language] || ""} onChange={(event) => updateContent("thank_you_title", event.target.value)} /></Field><Field label="Thank-you Message"><textarea className={`${inputClass()} min-h-20`} value={form.content?.thank_you_body?.[language] || ""} onChange={(event) => updateContent("thank_you_body", event.target.value)} /></Field></div></div>
    </CampaignEditorSection>
    <CampaignEditorSection title="Campaign Branding">
      <div className="grid gap-3 md:grid-cols-2"><Field label="Primary Color"><input type="color" className="h-10 w-full rounded-lg border border-border bg-surface p-1" value={form.branding?.primary_color || "#168546"} onChange={(event) => updateBranding("primary_color", event.target.value)} /></Field><Field label="Accent Color"><input type="color" className="h-10 w-full rounded-lg border border-border bg-surface p-1" value={form.branding?.accent_color || "#0f6e3b"} onChange={(event) => updateBranding("accent_color", event.target.value)} /></Field><CampaignBrandingImageField label="Logo" field="logo_url" variant="logo" value={form.branding?.logo_url} uploading={uploading === "logo_url"} error={uploadError?.field === "logo_url" ? uploadError.message : ""} onUpload={onUpload} onRemove={onRemove} /><CampaignBrandingImageField label="Hero / poster" field="hero_url" variant="hero" value={form.branding?.hero_url} uploading={uploading === "hero_url"} error={uploadError?.field === "hero_url" ? uploadError.message : ""} onUpload={onUpload} onRemove={onRemove} /><CampaignBrandingImageField label="Thank-you artwork" field="thank_you_image_url" variant="thank-you" value={form.branding?.thank_you_image_url} uploading={uploading === "thank_you_image_url"} error={uploadError?.field === "thank_you_image_url" ? uploadError.message : ""} onUpload={onUpload} onRemove={onRemove} /></div>
    </CampaignEditorSection>
    <CampaignEditorSection title="Contact Collection">
      <label className="flex items-center gap-3 text-sm font-semibold text-text-primary"><input type="checkbox" checked={Boolean(form.contact_collection?.enabled)} onChange={(event) => setForm((current) => ({ ...current, contact_collection: { ...current.contact_collection, enabled: event.target.checked } }))} /> Allow respondents to leave contact details</label>
      {form.contact_collection?.enabled ? <div className="mt-3"><Field label="Prompt"><textarea className={`${inputClass()} min-h-20`} value={form.contact_collection?.prompt?.[language] || ""} onChange={(event) => setForm((current) => ({ ...current, contact_collection: { ...current.contact_collection, prompt: { ...current.contact_collection.prompt, [language]: event.target.value } } }))} /></Field><p className="mt-2 text-xs text-text-secondary">Name and mobile number are optional. Contact details are stored separately from feedback answers.</p></div> : null}
    </CampaignEditorSection>
    {saveError ? <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{saveError}</p> : null}
  </form></Modal>;
}

function CampaignEditorSection({ title, actions, children }) {
  return <section className="border-t border-border pt-4 first:border-t-0 first:pt-0"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold text-text-primary">{title}</h3>{actions}</div>{children}</section>;
}

function CampaignBrandingImageField({ label, field, variant, value, uploading, error, onUpload, onRemove }) {
  return <div className={`factory-campaign-branding-field factory-campaign-branding-field--${variant}`}><Field label={label}><div className="factory-campaign-branding-control"><div className="factory-campaign-branding-preview" data-preview-kind={variant}>{value ? <img className="factory-campaign-branding-preview-image" src={value} alt={`${label} preview`} /> : <span className="factory-campaign-branding-preview-empty">No image uploaded</span>}</div><div className="factory-campaign-branding-actions"><label className="btn-secondary cursor-pointer">{uploading ? "Uploading…" : value ? "Replace" : "Upload"}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => onUpload(event, field)} /></label>{value ? <button type="button" className="btn-secondary" disabled={uploading} onClick={() => onRemove(field, null)}>Remove</button> : null}</div>{error ? <p className="text-xs font-medium text-danger" role="alert">{error}</p> : null}</div></Field></div>;
}

function presentationQuestion(question = {}) {
  const next = structuredClone(question);
  delete next.order;
  next.required = Boolean(next.required);
  delete next.helper_en; delete next.helper_zh; delete next.helper_ms; delete next.label_zh; delete next.label_ms;
  delete next.rating_low_label_en; delete next.rating_low_label_zh; delete next.rating_low_label_ms;
  delete next.rating_high_label_en; delete next.rating_high_label_zh; delete next.rating_high_label_ms;
  next.options = (next.options || []).map((option) => { const value = { ...option }; delete value.label_zh; delete value.label_ms; return value; });
  return next;
}
export function productFeedbackPresentationOnlyQuestionChange(previous, next) { return JSON.stringify(presentationQuestion(previous)) === JSON.stringify(presentationQuestion(next)); }
function questionTranslationUnits(question, index) {
  const targets = ["zh", "ms"];
  const units = [["label", question.label_en], ["helper", question.helper_en], ["rating_low_label", question.rating_low_label_en], ["rating_high_label", question.rating_high_label_en]].flatMap(([field, source]) => {
    const missing = targets.filter((language) => String(source || "").trim() && productFeedbackTranslationMissing(source, question[`${field}_${language}`], language));
    return missing.length ? [{ id: `question:${index}:${field}`, source, targets: missing }] : [];
  });
  (question.options || []).forEach((option, optionIndex) => {
    const missing = targets.filter((language) => String(option.label_en || "").trim() && productFeedbackTranslationMissing(option.label_en, option[`label_${language}`], language));
    if (missing.length) units.push({ id: `option:${index}:${optionIndex}`, source: option.label_en, targets: missing });
  });
  return units;
}
function applyQuestionTranslations(questions, results) {
  const next = structuredClone(questions);
  results.forEach((result) => {
    const [scope, questionIndex, field] = String(result.id || "").split(":");
    if (scope === "question" && next[Number(questionIndex)]) next[Number(questionIndex)][`${field}_${result.language}`] = result.text;
    if (scope === "option" && next[Number(questionIndex)]?.options?.[Number(field)]) next[Number(questionIndex)].options[Number(field)][`label_${result.language}`] = result.text;
  });
  return next;
}

function questionMetadata(question) {
  const type = types.find((item) => item.value === question.type)?.label || "Question";
  const details = [type, question.required ? "Required" : "Optional"];
  const optionCount = question.options?.length || 0;
  if (!['rating', 'short_text'].includes(question.type) && optionCount) details.push(`${optionCount} options`);
  return details.join(" · ");
}

function LanguageIndicators({ question }) {
  return <div className="factory-feedback-language-indicators" aria-label="Translation status">{languages.map(({ key, label }) => {
    const state = productFeedbackLanguageCompleteness(question, key);
    const symbol = state === "Complete" ? "✓" : state === "Partial" ? "•" : "—";
    return <span className={`is-${state.toLowerCase()}`} key={key} title={`${label}: ${state}`} aria-label={`${label}: ${state}`}>{label} <b aria-hidden="true">{symbol}</b></span>;
  })}</div>;
}

export function FormBuilder({ campaign, editable, onSave, onNotify }) {
  const [questions, setQuestions] = useState(campaign.questions || []);
  const questionsRef = useRef(questions); const [editing, setEditing] = useState(null); const [newQuestionKey, setNewQuestionKey] = useState(null); const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState(""); const [saveNotice, setSaveNotice] = useState(""); const [dragged, setDragged] = useState(null); const [dragOver, setDragOver] = useState(null); const [confirmVersion, setConfirmVersion] = useState(null); const translatingRef = useRef(false); const [translating, setTranslating] = useState(false); const [structuralDirty, setStructuralDirty] = useState(false);
  const replaceQuestions = (next) => { questionsRef.current = next; setQuestions(next); setEditing((current) => current !== null && current >= next.length ? null : current); };
  const changeQuestions = (updater, structural = true) => { replaceQuestions(updater(questionsRef.current)); if (structural) setStructuralDirty(true); };
  useEffect(() => { if (!saving) { replaceQuestions(campaign.questions || []); setStructuralDirty(false); setSaveNotice(""); } }, [campaign.id]);
  const reorder = (from, to) => { if (from === to || to < 0 || to >= questionsRef.current.length) return; changeQuestions((current) => { const next = [...current]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next.map((question, order) => ({ ...question, order: order + 1 })); }); };
  const hasResponses = Number(campaign.response_count || campaign.responses_count || 0) > 0 || Boolean(campaign.has_responses);
  const persist = async (nextQuestions, message, formChange = "", clearsStructuralDirty = false) => { if (saving) return false; setSaving(true); setSaveError(""); setSaveNotice(""); try { const saved = await onSave(formChange ? { items: nextQuestions, form_change: formChange } : nextQuestions); replaceQuestions(saved?.questions || nextQuestions); if (clearsStructuralDirty) setStructuralDirty(false); setSaveNotice(message); return true; } catch (error) { const messageText = error?.message || "Unable to save form changes."; if (error?.message?.includes("FORM_VERSION_REQUIRED")) { setConfirmVersion({ questions: nextQuestions, message }); return false; } setSaveError(messageText); onNotify?.({ title: "Form save failed", message: messageText, tone: "error" }); return false; } finally { setSaving(false); } };
  const saveStructural = (nextQuestions = questionsRef.current, message = "Form saved.") => { if (hasResponses) return setConfirmVersion({ questions: nextQuestions, message }); return persist(nextQuestions, message, "", true); };
  const saveQuestion = async (question) => { const next = questionsRef.current.map((item, index) => index === editing ? question : item); const structural = hasResponses && !productFeedbackPresentationOnlyQuestionChange(questionsRef.current[editing], question); if (structural) return setConfirmVersion({ questions: next, message: "New form version saved." }); if (await persist(next, "Question saved.", "", question.key === newQuestionKey)) { setNewQuestionKey(null); setEditing(null); } };
  const saveNewVersion = async () => { const request = confirmVersion; setConfirmVersion(null); if (request && await persist(request.questions, request.message, "new_version", true)) { setNewQuestionKey(null); setEditing(null); } };
  const addQuestion = () => { const index = questionsRef.current.length; const question = emptyQuestion(index + 1); replaceQuestions([...questionsRef.current, question]); setNewQuestionKey(question.key); setEditing(index); };
  const closeQuestionEditor = () => { const question = editing === null ? null : questionsRef.current[editing]; if (!saving && question?.key === newQuestionKey) replaceQuestions(questionsRef.current.filter((item) => item.key !== newQuestionKey)); setNewQuestionKey(null); setEditing(null); };
  const translationUnits = questionsRef.current.flatMap((question, index) => questionTranslationUnits(question, index));
  const translateMissing = async () => { if (translatingRef.current || !translationUnits.length) return; translatingRef.current = true; setTranslating(true); try { const results = await factoryService.translateProductFeedbackContent({ sourceLanguage: "en", units: translationUnits }); const next = applyQuestionTranslations(questionsRef.current, results); await persist(next, "Missing translations saved."); } catch (error) { onNotify?.({ title: "AI translation unavailable", message: error.message, tone: "error" }); } finally { translatingRef.current = false; setTranslating(false); } };
  const completeness = productFeedbackFormCompleteness(questions); const editingQuestion = editing === null ? null : questions[editing];
  return <FactoryDataSurface><div className="factory-feedback-form-builder"><div className="factory-feedback-form-toolbar"><span className="factory-feedback-form-summary">{questions.length} Questions · EN {completeness.en}/{questions.length} · 中文 {completeness.zh}/{questions.length} · BM {completeness.ms}/{questions.length}</span>{editable ? <div className="flex flex-wrap items-center gap-2"><button className="btn-secondary" type="button" disabled={saving || translating || !translationUnits.length} onClick={translateMissing}>{translating ? "Translating…" : translationUnits.length ? "Translate Missing" : "Translations complete"}</button><button className="btn-secondary" type="button" disabled={saving} onClick={addQuestion}><Plus size={15} /> Add question</button></div> : null}</div><div className="factory-feedback-question-list">{questions.map((question, index) => <div className={`factory-feedback-question-row ${dragged === index ? "is-dragging" : ""} ${dragOver === index && dragged !== index ? "is-drop-target" : ""}`} key={question.key} onDragOver={(event) => { event.preventDefault(); setDragOver(index); }} onDragLeave={() => setDragOver((current) => current === index ? null : current)} onDrop={() => { reorder(dragged, index); setDragged(null); setDragOver(null); }}><button className="factory-feedback-drag-grip" type="button" title="Drag to reorder. Use Arrow keys as a keyboard fallback." aria-label={`Reorder question ${index + 1}`} draggable={!saving} disabled={saving} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDragged(index); }} onDragEnd={() => { setDragged(null); setDragOver(null); }} onKeyDown={(event) => { if (event.key === "ArrowUp") { event.preventDefault(); reorder(index, index - 1); } if (event.key === "ArrowDown") { event.preventDefault(); reorder(index, index + 1); } }}><GripVertical size={17} /></button><span className="factory-feedback-question-number">{String(index + 1).padStart(2, "0")}</span><button type="button" className="factory-feedback-question-content" onClick={() => editable && !saving && setEditing(index)}><span>{question.label_en}</span><small>{questionMetadata(question)}</small></button><LanguageIndicators question={question} />{editable ? <div className="factory-feedback-question-actions"><button className="factory-feedback-row-action" type="button" aria-label="Edit question" title="Edit question" disabled={saving} onClick={() => setEditing(index)}><Pencil size={15} /><span>Edit</span></button><button className="factory-feedback-row-action" type="button" aria-label="Duplicate question" title="Duplicate" disabled={saving} onClick={() => changeQuestions((current) => [...current, { ...question, key: `${question.key}_copy_${Date.now()}`, order: current.length + 1 }])}>Duplicate</button><details className="factory-feedback-question-menu"><summary aria-label="More question actions" title="More question actions"><Ellipsis size={17} /></summary><div><button type="button" disabled={saving} onClick={() => changeQuestions((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /> Delete</button></div></details></div> : null}</div>)}</div>{saveError && editing === null ? <p className="text-sm font-medium text-danger" role="alert">{saveError}</p> : null}{saveNotice ? <p className="factory-feedback-save-notice" role="status">{saveNotice}</p> : null}{editable ? <div className="factory-feedback-form-save"><span>{structuralDirty ? "Structural changes not saved" : "Saved"}</span><button className={structuralDirty ? "btn-primary" : "btn-secondary"} disabled={saving || !structuralDirty} type="button" onClick={() => saveStructural()}>{saving ? "Saving…" : structuralDirty ? "Save form" : "Saved"}</button></div> : null}</div>{editingQuestion ? <QuestionEditor key={editingQuestion.key} question={editingQuestion} saving={saving} error={saveError} onClose={closeQuestionEditor} onSave={saveQuestion} onNotify={onNotify} /> : null}{confirmVersion ? <Modal title="Create a new form version?" onClose={() => setConfirmVersion(null)} footer={<><button className="btn-secondary" type="button" onClick={() => setConfirmVersion(null)}>Cancel</button><button className="btn-primary" type="button" onClick={saveNewVersion}>Save as New Version</button></>}><p className="text-sm text-text-secondary">Existing responses remain linked to the previous version. New responses will use the updated form.</p></Modal> : null}</FactoryDataSurface>;
}

function QuestionEditor({ question, onClose, onSave, onNotify, saving = false, error = "" }) {
  const [draft, setDraft] = useState(() => productFeedbackQuestionDraft(question, question.order)); const [language, setLanguage] = useState("en"); const [translating, setTranslating] = useState(false); const [draggedOption, setDraggedOption] = useState(null); const translationRequest = useRef(false); const supportsOptions = !["short_text", "rating"].includes(draft.type);
  const translationComplete = languages.map(({ key, label }) => ({ key, label, complete: productFeedbackLanguageCompleteness(draft, key) === "Complete" }));
  const setField = (field, value) => setDraft((current) => ({ ...current, [field]: value })); const setOption = (index, field, value) => setDraft((current) => ({ ...current, options: current.options.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }));
  const changeType = (type) => { if (type === draft.type) return; if (draft.options.length && !window.confirm("Changing question type may discard incompatible option settings. Continue?")) return; setDraft((current) => ({ ...current, type, ...(type === "rating" ? { rating_scale: 5 } : {}) })); };
  const moveOption = (from, to) => { if (from === to || to < 0 || to >= draft.options.length) return; setDraft((current) => { const options = [...current.options]; const [item] = options.splice(from, 1); options.splice(to, 0, item); return { ...current, options }; }); };
  const translate = async () => { if (translationRequest.current) return; translationRequest.current = true; const units = []; const targets = languages.filter((item) => item.key !== language).map((item) => item.key); [["label", draft[`label_${language}`]], ["helper", draft[`helper_${language}`]], ["rating_low_label", draft[`rating_low_label_${language}`]], ["rating_high_label", draft[`rating_high_label_${language}`]]].forEach(([kind, source]) => { const missing = targets.filter((target) => productFeedbackTranslationMissing(source, draft[`${kind}_${target}`], target)); if (String(source || "").trim() && missing.length) units.push({ id: `question:${kind}`, source, targets: missing }); }); draft.options.forEach((option, index) => { const source = option[`label_${language}`]; const missing = targets.filter((target) => productFeedbackTranslationMissing(source, option[`label_${target}`], target)); if (String(source || "").trim() && missing.length) units.push({ id: `option:${index}`, source, targets: missing }); }); if (!units.length) { translationRequest.current = false; return; } setTranslating(true); try { const results = await factoryService.translateProductFeedbackContent({ sourceLanguage: language, units }); setDraft((current) => { const next = structuredClone(current); results.forEach((result) => { const [scope, index] = String(result.id).split(":"); if (scope === "question") next[`${index}_${result.language}`] = result.text; if (scope === "option" && next.options[Number(index)]) next.options[Number(index)][`label_${result.language}`] = result.text; }); return next; }); } catch (error) { onNotify?.({ title: "AI translation unavailable", message: error.message || "AI translation is temporarily unavailable. Please retry.", tone: "error" }); } finally { translationRequest.current = false; setTranslating(false); } };
  return <Modal title="Edit question" onClose={onClose} size="lg"><div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><LanguageTabs value={language} onChange={setLanguage} /><div className="flex items-center gap-2"><span className="text-xs font-semibold text-text-secondary">{translationComplete.map((item) => `${item.label} ${item.complete ? "✓" : "○"}`).join(" · ")}</span><button type="button" className="btn-secondary" disabled={translating || saving} onClick={translate}>{translating ? "Translating…" : "AI Translate missing"}</button></div></div><div className="grid gap-3 md:grid-cols-2"><Field label="Question"><input required disabled={saving} className={inputClass()} value={draft[`label_${language}`] || ""} onChange={(event) => setField(`label_${language}`, event.target.value)} /></Field><Field label="Question type"><CompactSelect value={draft.type} options={types} ariaLabel="Question type" onChange={changeType} /></Field></div><Field label="Helper text"><textarea disabled={saving} className={inputClass()} value={draft[`helper_${language}`] || ""} onChange={(event) => setField(`helper_${language}`, event.target.value)} /></Field>{error ? <p className="text-sm font-medium text-danger" role="alert">{error}</p> : null}<label className="flex items-center gap-2 text-sm font-semibold text-text-primary"><input type="checkbox" disabled={saving} checked={Boolean(draft.required)} onChange={(event) => setField("required", event.target.checked)} /> Required</label>{draft.type === "rating" ? <section className="grid gap-3 border-t border-border pt-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"><Field label="Rating scale"><div className={`${inputClass()} flex items-center`}>1–5 stars</div></Field><Field label="Low label (optional)"><input disabled={saving} className={inputClass()} value={draft[`rating_low_label_${language}`] || ""} placeholder="Poor" onChange={(event) => setField(`rating_low_label_${language}`, event.target.value)} /></Field><Field label="High label (optional)"><input disabled={saving} className={inputClass()} value={draft[`rating_high_label_${language}`] || ""} placeholder="Excellent" onChange={(event) => setField(`rating_high_label_${language}`, event.target.value)} /></Field></section> : null}{draft.type === "multi_choice" ? <Field label="Minimum selections"><input className={inputClass()} disabled={saving} type="number" min="1" value={draft.min_selections || 1} onChange={(event) => setField("min_selections", Math.max(Number(event.target.value || 1), 1))} /></Field> : null}{supportsOptions ? <section className="space-y-2 border-t border-border pt-4"><div className="flex items-center justify-between"><h3 className="text-sm font-bold text-text-primary">Options</h3><button className="btn-secondary" disabled={saving} type="button" onClick={() => setField("options", [...draft.options, { value: `option_${draft.options.length + 1}`, label_en: "New option", label_zh: "", label_ms: "", image_url: "", allow_additional_text: false, ...(draft.type === "price_choice" ? { amount: null, currency: "MYR", display_label: "New option" } : {}) }])}>Add option</button></div>{draft.options.map((option, index) => <div draggable={!saving} onDragStart={() => setDraggedOption(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { moveOption(draggedOption, index); setDraggedOption(null); }} className="grid cursor-grab gap-2 rounded-lg border border-border p-2 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto]" key={`${option.value}-${index}`}><span className="self-center text-xs font-bold text-text-muted" title="Drag to reorder">⋮⋮</span><div className="space-y-2"><input disabled={saving} className={inputClass()} value={option[`label_${language}`] || ""} placeholder={`Label (${language.toUpperCase()})`} onChange={(event) => setOption(index, `label_${language}`, event.target.value)} />{["single_choice", "multi_choice"].includes(draft.type) ? <button className={`factory-feedback-option-text-toggle ${option.allow_additional_text ? "is-enabled" : ""}`} aria-pressed={Boolean(option.allow_additional_text)} disabled={saving} type="button" onClick={() => setOption(index, "allow_additional_text", !option.allow_additional_text)}>{option.allow_additional_text ? "Text response enabled" : "+ Text response"}</button> : null}</div>{draft.type === "image_choice" ? <input disabled={saving} className={inputClass()} value={option.image_url || ""} placeholder="Image URL" onChange={(event) => setOption(index, "image_url", event.target.value)} /> : draft.type === "price_choice" ? <div className="grid grid-cols-2 gap-2"><input disabled={saving} className={inputClass()} type="number" min="0" step="0.01" value={option.amount ?? ""} placeholder="Amount" onChange={(event) => setOption(index, "amount", event.target.value === "" ? null : Number(event.target.value))} /><input disabled={saving} className={inputClass()} value={option.currency || "MYR"} placeholder="Currency" onChange={(event) => setOption(index, "currency", event.target.value.toUpperCase())} /></div> : null}<div className="flex gap-1"><button className="icon-btn" disabled={saving} title="Move option up" type="button" onClick={() => moveOption(index, index - 1)}>↑</button><button className="icon-btn" disabled={saving} title="Move option down" type="button" onClick={() => moveOption(index, index + 1)}>↓</button><button className="icon-btn text-danger" disabled={saving} title="Delete option" type="button" onClick={() => setField("options", draft.options.filter((_, optionIndex) => optionIndex !== index))}><Trash2 size={15} /></button></div></div>)}</section> : null}<div className="flex justify-end gap-2"><button className="btn-secondary" disabled={saving} type="button" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving} type="button" onClick={() => onSave(draft)}>{saving ? "Saving…" : "Save question"}</button></div></div></Modal>;
}

function LanguageTabs({ value, onChange }) { return <div className="inline-flex rounded-lg border border-border p-1">{languages.map((item) => <button key={item.key} className={`rounded-md px-2.5 py-1 text-xs font-bold ${value === item.key ? "bg-[var(--theme-subtle)] text-primary" : "text-text-secondary"}`} type="button" onClick={() => onChange(item.key)}>{item.label}</button>)}</div>; }
function ResponseModal({ response, onClose }) { const questions = response.questions_snapshot || []; const contact = response.contact; return <Modal title="Feedback response" onClose={onClose}><div className="space-y-4"><FactoryEvidenceHeader title={response.variant_name || "Campaign response"} subtitle={formatFactoryDateTime(response.submitted_at)} status={response.repeat_index > 1 ? { label: `Possible repeat #${response.repeat_index}`, tone: "warning" } : null} /><FactoryEvidenceSection title="Answers"><FactoryEvidenceGrid items={questions.map((question) => { const value = response.answers?.[question.key]; const details = Object.entries(response.answer_details?.[question.key] || {}).filter(([, text]) => String(text || "").trim()).map(([option, text]) => `${option}: ${text}`); return { label: question.label_en, value: details.length ? `${displayAnswer(value)} — ${details.join("; ")}` : displayAnswer(value), fullWidth: question.type === "short_text" }; })} /></FactoryEvidenceSection>{contact ? <FactoryEvidenceSection title="Contact details"><FactoryEvidenceGrid items={[{ label: "Name", value: contact.name || "—" }, { label: "Mobile number", value: contact.normalized_mobile || "—" }, { label: "Consent", value: contact.consented_at ? formatFactoryDateTime(contact.consented_at) : "—" }]} /></FactoryEvidenceSection> : null}</div></Modal>; }
