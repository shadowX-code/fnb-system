import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext.jsx";
import WorkspacePage from "../../components/layout/WorkspacePage.jsx";
import AdminSearchField from "../../components/forms/AdminSearchField.jsx";
import AdminFilterToolbar from "../../components/layout/AdminFilterToolbar.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import ActionMenu from "../../components/ui/ActionMenu.jsx";
import CampaignAudienceBreakdown from "./CampaignAudienceBreakdown.jsx";
import Modal from "../../components/feedback/Modal.jsx";
import AsyncDataSurface from "../../components/feedback/AsyncDataSurface.jsx";
import Badge from "../../components/ui/Badge.jsx";
import { marketingService } from "./marketingService.js";
import { outreachService } from "./outreachService.js";
import {
  normalizeMalaysianPhone,
  whatsappDeliveryAdapters,
} from "./whatsappDelivery.js";
import "./outreach.css";
import { Plus, ArrowLeft, Settings, MoreHorizontal } from "lucide-react";
import AdminFormField from "../../components/forms/AdminFormField.jsx";
import TextareaField from "../../components/forms/TextareaField.jsx";
import AdminPagination, {useAdminClientPagination} from "../../components/tables/AdminPagination.jsx";
import AdminSummaryGrid from "../../components/ui/AdminSummaryGrid.jsx";
import CampaignMediaField from "./CampaignMediaField.jsx";
import MarketingMediaPreview from "./MarketingMediaPreview.jsx";
import TagPicker from "../../components/forms/TagPicker.jsx";
import DataTable from "../../components/tables/DataTable.jsx";
import EmptyState from "../../components/feedback/EmptyState.jsx";
import MarketingCustomersView from "./MarketingCustomersView.jsx";
import WhatsAppSenderDialog from "./WhatsAppSenderDialog.jsx";
import CustomerImportDialog from "./CustomerImportDialog.jsx";
const names = {
  pending: "Pending",
  opened: "Opened",
  staff_confirmed: "Staff Confirmed",
  skipped: "Skipped",
  draft: "Draft",
  review: "Pending Approval",
  approved: "Approved",
  ready: "Ready",
  cancelled: "Cancelled",
};
export default function MarketingOutreachPage({ section: requestedSection = "customers" }) {
  const auth = useAuth(),
    can = (p) => auth.hasPermission(p),
    section = requestedSection === "legacy" ? (can("marketing_audience.view") ? "customers" : "whatsapp") : requestedSection,
    [context, setContext] = useState({ organizations: [], brands: [] }),
    [org, setOrg] = useState(""),
    [brand, setBrand] = useState(""),
    [tab, setTab] = useState(section === "whatsapp" ? "campaigns" : "customers"),
    [campaignSearch,setCampaignSearch]=useState(""),
    [campaignStatus,setCampaignStatus]=useState(""),
    [data, setData] = useState(null),
    [campaign, setCampaign] = useState(""),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [modal, setModal] = useState(null),
    [importOpen,setImportOpen]=useState(false),
    [form, setForm] = useState({}),
    [sender, setSender] = useState(""),
    [senderSession, setSenderSession] = useState(null),
    [senderSettings,setSenderSettings]=useState(false),
    [selectedRecipient, setSelectedRecipient] = useState("");
  const generation = useRef(0),
    intent = useRef(null),
    media = useRef(new Map());
  const brands = context.brands.filter((b) => b.organization_id === org),
    active = data?.campaigns.find((c) => c.id === campaign),
    recipient = data?.recipients.find((r) => r.id === selectedRecipient),
    scope = JSON.stringify([org, brand, campaign, page, search, auth.user?.id, auth.profile?.id]);
  useEffect(() => {
    let live = true;
    marketingService
      .context()
      .then((c) => {
        if (live) {
          setContext(c);
          const query = new URLSearchParams(window.location.search);
          const selectedOrg=c.organizations.find(o=>o.id===query.get("marketing_org"))?.id || c.organizations[0]?.id || "";
          setOrg(selectedOrg);
          const available=c.brands.filter(b=>b.organization_id===selectedOrg);
          setBrand(available.find(b=>b.id===query.get("marketing_brand"))?.id || (available.length===1?available[0].id:""));
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [auth.user?.id]);
  useEffect(() => {
    generation.current++;
    setModal(null);
    setImportOpen(false);
    setSenderSettings(false);
    setBusy(false);
    setData(null);
    setSender("");
    setSenderSession(null);
    setSelectedRecipient("");
    setError("");
    media.current.clear();
  }, [org, brand, auth.user?.id, auth.profile?.id]);
  useEffect(() => {
    let live = true;
    setLoading(!!brand);
    setError("");
    if (!brand) {
      setData(null);
      return;
    }
    outreachService
      .read(org, brand, campaign || null, page, search)
      .then((d) => {
        if (live) {
          setData(d);
          setSelectedRecipient((current) =>
            d.recipients.some((r) => r.id === current)
              ? current
              : d.recipients.find(
                  (r) => r.eligible && ["pending", "opened"].includes(r.state),
                )?.id || "",
          );
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [scope, refresh]);
  useEffect(() => {
    setCampaign("");
    setPage(1);
    setSearch("");
  }, [brand]);
  useEffect(()=>{generation.current++;setBusy(false);setSender("");setSenderSession(null);setSelectedRecipient("");setTab(section === "whatsapp" ? "campaigns" : "customers");setCampaign("");setPage(1);setSearch("");setModal(null);setImportOpen(false);setNotice("");},[section]);
  const filteredCampaigns=(data?.campaigns||[]).filter(c=>(!campaignStatus||c.status===campaignStatus)&&(!campaignSearch||c.title.toLowerCase().includes(campaignSearch.toLowerCase())));
  const campaignPagination=useAdminClientPagination('marketing.whatsapp.campaigns',filteredCampaigns.length,20,JSON.stringify([org,brand,campaignSearch,campaignStatus]));
  const campaignRows=filteredCampaigns.slice(campaignPagination.from,campaignPagination.to);
  const openCampaign=c=>{setSenderSession(null);setSender("");setCampaign(c.id);setPage(1);setSelectedRecipient('');setData(d=>({...d,recipients:[],progress:{}}));};
  const editCampaign=c=>show('campaign',{...c,...(can('marketing_audience.manage')?{audience_criteria:c.audience_criteria||data.audiences.find(a=>a.id===c.audience_id)?.criteria||{}}:{})});
  const campaignAction=(action,c)=>{
    if(action==='view'||(action==='start'&&c.status==='ready')){openCampaign(c);return;}
    if(action==='edit'){editCampaign(c);return;}
    if(action==='cancel'){show('cancel',{...c});return;}
    if(action==='review'){perform(()=>command('review',c.id,{revision:c.revision}),'Submitted for approval.');return;}
    if(action==='start')perform(()=>command('queue',c.id,{revision:c.revision}),'Eligible recipients queued. No messages were sent.').then(result=>{if(result)openCampaign(c)});
  };
  const currentAudience=data?.audiences.find(a=>a.id===active?.audience_id);
  const audienceCriteria=active?.audience_criteria||currentAudience?.criteria;
  const approvalCurrent=active?.approval_current ?? (active?.approved_revision===active?.revision&&(active?.status==='ready'||currentAudience?.revision===active?.audience_revision));
  const queueTotal=active?.recipient_count??Object.values(data?.progress||{}).reduce((sum,n)=>sum+n,0);
  const handlingComplete=active?.status==='ready'&&queueTotal>0&&(active.handled_count??((data?.progress.staff_confirmed||0)+(data?.progress.skipped||0)))===queueTotal;
  const canRevise=active?.can_revise ?? (active&&['draft','review','approved','ready'].includes(active.status)&&!(active.handled_count>0)&&(active.status!=='ready'||(!loading&&!error))&&!(data?.progress.opened||data?.progress.staff_confirmed||data?.progress.skipped)&&!data?.recipients.some(r=>r.state!=='pending'));
  const previewRecipient=recipient||(data?.recipients.length===1?data.recipients[0]:null);
  const pageSenderIds=[...new Set((data?.recipients||[]).map(r=>r.sender_id).filter(Boolean))];
  const displaySender=previewRecipient?.sender_snapshot||data?.senders.find(s=>s.id===(recipient?.sender_id||sender||(pageSenderIds.length===1?pageSenderIds[0]:null)));
  const brandInactive=brands.find(b=>b.id===brand)?.is_active===false;
  const brandName=brands.find(b=>b.id===brand)?.name||'';
  const chosenSender=data?.senders.find(s=>s.id===sender);
  const senderConfirmed=!!senderSession&&senderSession.campaign_id===campaign&&senderSession.campaign_revision===active?.revision&&senderSession.sender_id===sender&&senderSession.sender_revision===chosenSender?.revision&&chosenSender?.active&&new Date(senderSession.expires_at)>new Date();
  useEffect(()=>{setSenderSession(null);},[campaign,active?.revision,auth.profile?.id]);
  useEffect(()=>{if(!sender&&data?.senders.some(s=>s.active&&s.is_default))setSender(data.senders.find(s=>s.active&&s.is_default).id);},[data?.senders,sender]);
  const formatDate=value=>value?new Date(value).toLocaleDateString('en-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',year:'numeric'}):'—';
  const field = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  function show(type, initial = {}) {
    intent.current = null;
    setForm(initial);
    setModal(type);
    setError("");
  }
  async function perform(fn, message, close = true) {
    const g = generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      if (g !== generation.current) return;
      setNotice(message);
      if (close) setModal(null);
      setRefresh((v) => v + 1);
      return result;
    } catch (e) {
      if (g === generation.current) setError(e.message === "Shared phone changes require a separate verified identity workflow." ? "Changing this phone number requires identity verification. Keep the existing number or contact an administrator." : e.message);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  function command(action, id, payload = {}) {
    const fp = JSON.stringify([org, brand, action, id, payload]);
    if (intent.current?.fp !== fp)
      intent.current = { fp, id: crypto.randomUUID() };
    return outreachService.command(
      intent.current.id,
      org,
      brand,
      action,
      id,
      payload,
    );
  }
  function customerRequest() {
    const fp=JSON.stringify([org,brand,form]);if(intent.current?.fp!==fp)intent.current={fp,id:crypto.randomUUID()};return intent.current.id;
  }
  async function save() {
    if (modal === "customer") {
      normalizeMalaysianPhone(form.phone);
      await perform(
        () =>
          outreachService.customer(customerRequest(), org, brand, {
            ...form,
            tags: form.tags || [],
            confirm_name: !!form.edit,
          }),
        "Customer saved. WhatsApp contact preference is unchanged.",
      );
      return;
    }
    const action = modal === "campaign" ? "save" : modal === "consent" ? "contact_preference" : modal;
    let payload = form;
    if (action === "consent")
      payload = {
        ...form,
        occurred_at: new Date(form.occurred_at).toISOString(),
      };
    await perform(() => command(action, form.id, payload), "Saved.");
  }
  async function assetBlob(asset) {
    if (media.current.has(asset.id)) return media.current.get(asset.id);
    const url = await marketingService.assetUrl(asset);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Image unavailable.");
    const blob = await response.blob();
    media.current.set(asset.id, blob);
    return blob;
  }
  async function verifyRecipient() {
    const g = generation.current;
    const current = await command("inspect", recipient.id);
    if (g !== generation.current) throw new Error("Brand changed.");
    return current;
  }
  async function copyCaption() {
    try {
      const current = await verifyRecipient();
      await navigator.clipboard.writeText(current.caption);
      setNotice("Caption copied.");
    } catch (e) {
      setError(e.message || "Select the caption text instead.");
    }
  }
  async function copyImage() {
    const g = generation.current;
    try {
      await verifyRecipient();
      const asset = data.assets.find((a) => a.id === active.asset_id),
        blob = await assetBlob(asset);
      let png = blob;
      if (blob.type !== "image/png") {
        const image = await createImageBitmap(blob),
          canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext("2d").drawImage(image, 0, 0);
        png = await new Promise((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        image.close();
      }
      if (g !== generation.current) throw new Error("Brand changed.");
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": png }),
      ]);
      setNotice(
        "Image copied. Paste it into WhatsApp; confirm the caption separately.",
      );
    } catch {
      setError(
        "Image copying is unavailable in this browser. Download the image instead.",
      );
    }
  }
  async function downloadImage() {
    const g = generation.current;
    try {
      await verifyRecipient();
      const asset = data.assets.find((a) => a.id === active.asset_id),
        blob = await assetBlob(asset),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      if (g !== generation.current) {
        URL.revokeObjectURL(url);
        return;
      }
      a.href = url;
      a.download = asset.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Image could not be downloaded. Refresh and try again.");
    }
  }
  async function recipientAction(action) {
    if (!recipient) return;
    const g = generation.current;
    const result = await perform(
      () =>
        command(action, recipient.id, {
          senderId: sender,
          senderSessionId:senderConfirmed?senderSession.id:null,
          reason: "Skipped by staff",
        }),
      action === "confirm"
        ? "Staff confirmation recorded. WhatsApp delivery is not verified."
        : action === "skip"
          ? "Recipient skipped."
          : "WhatsApp link prepared. Sending remains manual.",
      false,
    );
    if (result && g === generation.current && action === "open") {
      const url = whatsappDeliveryAdapters.whatsapp_manual.openLink(result);
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
    }
    if (result && action !== "open") setSelectedRecipient("");
  }
  const controls = <div className="admin-scope-controls" aria-label="Marketing scope">
    {context.organizations.length>1?<SelectField searchable="auto" label="Organization" value={org} onChange={v=>{if(!busy){setOrg(v);setBrand('')}}} options={context.organizations.map(o=>({value:o.id,label:o.name}))}/>:null}
    <SelectField searchable="auto" label="Brand" value={brand} onChange={v=>{if(!busy)setBrand(v)}} options={[{value:'',label:'Select a brand'},...brands.map(b=>({value:b.id,label:b.name}))]}/>
  </div>;
  const input = (label, key, type = "text") => (
    <AdminFormField label={label}>
      <input
        className="control"
        type={type}
        maxLength={key==='title'?160:undefined}
        value={form[key] || ""}
        onChange={(e) => field(key, e.target.value)}
        required
      />
    </AdminFormField>
  );
  return (
    <WorkspacePage
      section="Marketing"
      title={section === "whatsapp" ? "WhatsApp Message" : "Customers"}
      description={section === "whatsapp" ? "Approved campaigns, handled personally by your team." : "Customer profiles, brand relationships and contact preferences."}
      controls={controls}
    >
      <div className="outreach">
        {brandInactive?<p className="text-sm text-text-secondary">Inactive Brand · existing customer records and campaign history remain available. Reactivate it to start new work.</p>:null}
        {notice ? <p role="status">{notice}</p> : null}
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
        {!brand ? (
          <section className="card p-5">
            Select a brand to manage its customers and WhatsApp campaigns.
          </section>
        ) : (
          <>
            <AsyncDataSurface loading={loading} error={null} hasData={!!data}>
              {data&&tab==='customers'?<MarketingCustomersView key={brand} org={org} brand={brand} inactive={brandInactive} data={data} can={can} refresh={refresh} show={show} onImport={()=>setImportOpen(true)} onChanged={()=>setRefresh(v=>v+1)}/>:null}
              {data && tab === "campaigns" ? (
                <>
                  <section className="space-y-3">
                    {!active?<>
                      <div className="outreach-actions">
                        {can('marketing_campaigns.manage')?<button className="btn-primary" disabled={brandInactive} onClick={()=>show('campaign',{caption:'Hi {name}, ',...(can('marketing_audience.manage')?{audience_criteria:{tags:[],outlet_id:''}}:{audience_id:''})})}><Plus size={15}/> New campaign</button>:null}
                        <button className="btn-secondary" onClick={()=>setSenderSettings(true)}><Settings size={15}/> Sender settings</button>
                      </div>
                      <AdminFilterToolbar compact denseFields ariaLabel="Campaign filters" search={<AdminSearchField ariaLabel="Search campaigns" placeholder="Campaign title" value={campaignSearch} onChange={setCampaignSearch}/>} filters={<SelectField label="Campaign status" value={campaignStatus} onChange={setCampaignStatus} options={[{value:'',label:'All'},...['draft','review','approved','ready','cancelled'].map(value=>({value,label:names[value]}))]}/>}/>
                      {filteredCampaigns.length?<>
                       <OutreachCollection rows={campaignRows} getRowKey={c=>c.id} onRowClick={openCampaign} columns={[
                        {key:'title',header:'Campaign',render:c=><button className="outreach-name-button" onClick={()=>openCampaign(c)}>{c.title}</button>},
                        {key:'audience',header:'Audience',render:c=><CampaignAudienceTags criteria={c.audience_criteria||data.audiences.find(a=>a.id===c.audience_id)?.criteria}/>},
                        {key:'recipients',header:'Recipients',render:c=>c.eligible_recipients??c.audience_size??'Unavailable'},
                        {key:'status',header:'Status',render:c=><Badge tone={c.status==='approved'?'success':c.status==='review'?'warning':'default'}>{names[c.status]}</Badge>},
                        {key:'progress',header:'Progress',render:c=>(c.queued??(c.status==='ready'||c.recipient_count>0))?`${c.handled_count??'—'} / ${c.recipient_count??'—'} handled`:'Not queued'},
                        {key:'actions',header:'Actions',render:c=><CampaignRowActions campaign={c} can={can} busy={busy} onAction={campaignAction}/>}

                       ]}/>
                       <AdminPagination noun="campaigns" total={filteredCampaigns.length} page={campaignPagination.page} pageSize={campaignPagination.pageSize} onPageChange={campaignPagination.setPage} onPageSizeChange={campaignPagination.setPageSize}/>
                      </>:<EmptyState title={data.campaigns.length?"No matching campaigns":"No campaigns yet"} description={data.campaigns.length?"Adjust your search or status filter.":"Choose an audience and prepare a message for approval."}/>}
                    </>:null}
                    {active ? (
                      <>
                        <button className="btn-secondary self-start" onClick={()=>{setCampaign('');setPage(1)}}><ArrowLeft size={15}/> All campaigns</button>
                        <header className="outreach-section-heading mb-0"><div><h2 className="text-lg font-semibold text-text-primary">{active.title}</h2><div className="outreach-actions mt-2"><Badge tone={active.status==='approved'?'success':active.status==='review'?'warning':'default'}>{names[active.status]}</Badge>{handlingComplete?<Badge tone="success">Handling complete</Badge>:null}</div></div></header>
                        <div className="outreach-actions">
                          {can("marketing_campaigns.manage") &&
                          canRevise ? (
                            <button
                              className="btn-secondary"
                              disabled={busy}
                              onClick={() => editCampaign(active)}
                            >
                              Revise draft
                            </button>
                          ) : null}
                          {active.status === "draft" &&
                          can("marketing_campaigns.manage") ? (
                            <button
                              className="btn-primary"
                              disabled={busy}
                              onClick={() =>
                                perform(
                                  () =>
                                    command("review", active.id, {
                                      revision: active.revision,
                                    }),
                                  "Submitted for approval.",
                                )
                              }
                            >
                              Request approval
                            </button>
                          ) : null}
                          {active.status === "review" &&
                          can("marketing_campaigns.approve") ? (
                            <button
                              className="btn-primary"
                              onClick={() => show("approve", { ...active })}
                            >
                              Review & approve
                            </button>
                          ) : null}
                          {active.status === "approved" && approvalCurrent &&
                          can("marketing_campaigns.execute") ? (
                            <button
                              className="btn-primary"
                              disabled={busy}
                              onClick={() =>
                                perform(
                                  () =>
                                    command("queue", active.id, {
                                      revision: active.revision,
                                    }),
                                  "Eligible recipients queued. No messages were sent.",
                                )
                              }
                            >
                              Prepare recipient queue
                            </button>
                          ) : null}
                          {active.status !== "cancelled" &&
                          can("marketing_campaigns.manage") ? (
                            <button
                              className="btn-secondary"
                              onClick={() => show("cancel", { ...active })}
                            >
                              Cancel campaign
                            </button>
                          ) : null}
                        </div>
                        {active.status==='approved'&&!approvalCurrent?<p className="text-sm text-text-secondary">Audience changed. Revise and review this campaign before preparing recipients.</p>:null}
                        <div className="outreach-campaign-layout">
                          <section className="card p-4 space-y-4 min-w-0" aria-label="Campaign message preview">
                            <div className="outreach-section-heading mb-0"><h3 className="text-sm font-semibold">Message preview</h3><Badge>{active.status==='cancelled'?'Cancelled':approvalCurrent?'Approved':'Awaiting approval'}</Badge></div>
                            <MarketingMediaPreview key={active.asset_id||'none'} asset={data.assets.find(a=>a.id===active.asset_id)}/>
                            {previewRecipient?<small>Preview for {previewRecipient.display_name}</small>:null}
                            <p className="outreach-caption">{previewRecipient?.caption||(active.caption||'').replaceAll('{brand}',brandName)}</p>
                          </section>
                          <section className="card p-4 space-y-4 min-w-0" aria-label="Campaign information">
                            <h3 className="text-sm font-semibold">Campaign information</h3>
                            <CampaignAudienceBreakdown breakdown={active.audience_breakdown} basis={active.audience_basis} />
                            <dl className="outreach-profile-grid">
                              <div><dt>Audience</dt><dd><CampaignAudienceTags criteria={audienceCriteria}/></dd></div>
                              <div><dt>Outlet</dt><dd>{!audienceCriteria?'Unavailable':audienceCriteria.outlet_id?data.outlets.find(o=>o.id===audienceCriteria.outlet_id)?.name||'Unavailable':'All outlets'}</dd></div>
                              {audienceCriteria?.language?<div><dt>Language</dt><dd>{{EN:'English',ZH:'Chinese',BM:'Bahasa Melayu'}[audienceCriteria.language]||audienceCriteria.language}</dd></div>:null}
                              <div><dt>WhatsApp consent</dt><dd>Subscribed only</dd></div><div><dt>Recipients</dt><dd>{active.eligible_recipients??active.audience_size??'Unavailable'}<small>Currently eligible · {queueTotal} queued</small></dd></div>
                              <div><dt>Sender</dt><dd>{displaySender?`${displaySender.label} · ${displaySender.phone_e164}`:pageSenderIds.length>1?'Multiple senders on this page':'Selected by staff for the sending session'}</dd></div>
                              <div><dt>Approval</dt><dd>{active.status==='cancelled'?'Cancelled':approvalCurrent?'Approved':active.status==='review'?'Pending approval':'Review required'}</dd></div>
                              <div><dt>Created</dt><dd>{formatDate(active.created_at)}</dd></div><div><dt>Approved</dt><dd>{formatDate(active.approved_at)}</dd></div>
                            </dl>
                            <p className="text-xs text-text-secondary">Sending is manual. Staff Confirmed records staff handling, not WhatsApp delivery or read status.</p>
                          </section>
                        </div>
                        <AdminSummaryGrid variant="compact" ariaLabel="Recipient handling progress" items={['pending','opened','staff_confirmed','skipped'].map(key=>({key,label:names[key],value:data.progress[key]||0,state:loading?'loading':error?'unavailable':'ready'}))}/>
                        <details className="outreach-evidence"><summary>Technical details & evidence</summary><p>Campaign revision: {active.revision} · Approved revision: {active.approved_revision??'None'} · Audience revision: {active.audience_revision??'Not reviewed'}</p><p>Verified delivery: unavailable · Verified redemptions: unavailable</p><p>Queued campaigns do not send automatically. Cloud API delivery is unavailable.</p></details>
                      </>
                    ) : null}
                  </section>
                  {active?.status === "ready" && data.recipients.some(r=>["pending","opened"].includes(r.state)) ? (
                    <section className="outreach-queue space-y-3">
                      <h3>Recipient queue</h3>
                      <div className="rounded-xl border border-border p-3 space-y-3">
                        {senderConfirmed?<><p className="text-sm font-semibold">Sender confirmed for this session</p><p className="text-sm">{senderSession.sender_snapshot.label} · {senderSession.sender_snapshot.phone_e164}</p><button className="btn-secondary" disabled={busy} onClick={()=>setSenderSession(null)}>Change sender</button></>:<>
                          <SelectField label="WhatsApp Sender" value={sender} onChange={value=>{setSender(value);setSenderSession(null)}} options={[{value:'',label:'Select sender'},...data.senders.filter(s=>s.active).map(s=>({value:s.id,label:`${s.label} · ${s.phone_e164}${s.is_default?' · Default':''}`}))]}/>
                          <p className="text-sm text-text-secondary">Check that WhatsApp is signed in as this sender. FeedX cannot verify the WhatsApp login.</p>
                          <button className="btn-primary" disabled={busy||!chosenSender?.active||!can('marketing_campaigns.execute')} onClick={()=>show('sender_session',{})}>Confirm Sender & Start Session</button>
                        </>}
                      </div>
                      <SelectField
                        label="Recipient"
                        value={selectedRecipient}
                        onChange={setSelectedRecipient}
                        options={[
                          { value: "", label: "Select recipient" },
                          ...data.recipients
                            .filter((r) =>
                              ["pending", "opened"].includes(r.state),
                            )
                            .map((r) => ({
                              value: r.id,
                              label: `${r.display_name} · ${names[r.state]}${r.eligible ? "" : " · Not eligible"}`,
                            })),
                        ]}
                      />
                      {recipient ? (
                        <>
                          <strong>
                            {recipient.display_name} · {recipient.phone_e164}
                          </strong>
                          <p className="outreach-caption">
                            {recipient.caption}
                          </p>
                          {!recipient.eligible ? (
                            <p role="alert">
                              Consent or suppression changed. This recipient
                              cannot be contacted.
                            </p>
                          ) : null}
                          <div className="outreach-actions">
                            <button
                              className="btn-secondary"
                              disabled={!recipient.eligible}
                              onClick={copyCaption}
                            >
                              Copy Caption
                            </button>
                            {active.asset_id ? (
                              <>
                                <button
                                  className="btn-secondary"
                                  disabled={!recipient.eligible}
                                  onClick={copyImage}
                                >
                                  Copy Image
                                </button>
                                <button
                                  className="btn-secondary"
                                  disabled={!recipient.eligible}
                                  onClick={downloadImage}
                                >
                                  Download Image
                                </button>
                              </>
                            ) : null}
                          </div>
                          <div className="outreach-actions">
                            {can("marketing_campaigns.execute") ? (
                              <>
                                <button
                                  className="btn-primary"
                                  disabled={
                                    busy ||
                                    !recipient.eligible ||
                                    !sender ||
                                    !senderConfirmed
                                  }
                                  onClick={() => recipientAction("open")}
                                >
                                  Open WhatsApp
                                </button>
                                <button
                                  className="btn-secondary"
                                  disabled={
                                    busy ||
                                    !recipient.eligible ||
                                    recipient.state !== "opened" ||
                                    !senderConfirmed ||
                                    !sender
                                  }
                                  onClick={() =>
                                    show("confirm", { id: recipient.id })
                                  }
                                >
                                  Confirm Sent
                                </button>
                                <button
                                  className="btn-secondary"
                                  disabled={busy}
                                  onClick={() => recipientAction("skip")}
                                >
                                  Skip → Next
                                </button>
                              </>
                            ) : null}
                          </div>
                          <p className="text-sm">
                            Attach the image manually. Opened and Staff
                            Confirmed are staff workflow records, not WhatsApp
                            delivery receipts.
                          </p>
                        </>
                      ) : (
                        <p>No eligible pending recipients on this page.</p>
                      )}
                    </section>
                  ) : null}
                  {active&&data.recipients.length?<section aria-label="Campaign recipient results" className="space-y-3"><h3 className="text-sm font-semibold">Recipient Queue / Results</h3><OutreachCollection rows={data.recipients} getRowKey={r=>r.id} columns={[
                    {key:'display_name',header:'Customer'},
                    {key:'state',header:'Handling',render:r=><Badge tone={r.state==='staff_confirmed'?'success':r.state==='skipped'?'warning':'default'}>{names[r.state]}</Badge>},
                    {key:'eligible',header:'Current consent',render:r=>r.eligible?'Eligible':'Contact blocked'},
                    {key:'sender',header:'Sender',render:r=>r.sender_snapshot?.label||data.senders.find(s=>s.id===r.sender_id)?.label||'Not selected'},
                    {key:'result',header:'Result',render:r=>r.state==='staff_confirmed'?'Staff confirmation only':r.state==='skipped'?r.skip_reason||'Skipped':'Not confirmed'},
                    {key:'action',header:'Action',render:r=>['pending','opened'].includes(r.state)&&can('marketing_campaigns.execute')?<button className="btn-secondary" onClick={()=>setSelectedRecipient(r.id)}>{r.id===selectedRecipient?'Selected':'Select'}</button>:null}
                  ]}/></section>:null}
                  {active?.status==='ready'&&!loading&&!data.recipients.some(r=>['pending','opened'].includes(r.state))?<p className="text-sm text-text-secondary">{(data.progress.pending||0)+(data.progress.opened||0)>0?'No pending recipients on this page.':'All recipients have been handled. Staff confirmations are shown in results.'}</p>:null}
                  {active&&queueTotal>0?<AdminPagination noun="recipients" total={queueTotal} page={page} pageSize={50} loading={loading} onPageChange={setPage}/>:null}
                </>
              ) : null}
            </AsyncDataSurface>
          </>
        )}
        {importOpen&&brand?<CustomerImportDialog key={brand} org={org} brand={brand} brandName={brands.find(b=>b.id===brand)?.name||'Selected brand'} outlets={data?.outlets||[]} onClose={()=>setImportOpen(false)} onImported={()=>setRefresh(v=>v+1)}/>:null}
        {senderSettings&&data?<WhatsAppSenderDialog brandName={brandName} senders={data.senders} canManage={can('marketing_settings.configure')} busy={busy} error={error} onClose={()=>{if(!busy)setSenderSettings(false)}} onCommand={(action,id,payload)=>perform(()=>command(action,id,payload),'Sender updated.',false)}/>:null}
        {modal ? (
          <Modal
            open
            size={modal==='campaign'?'lg':'sm'}
            title={
              modal === "campaign"
                ? "Campaign draft"
                : modal === "customer"
                  ? form.edit ? "Edit customer" : "Add customer"
                  : modal === "confirm"
                    ? "Confirm manual send"
                    : modal === "approve"
                      ? "Approve exact campaign revision"
                      : modal === "unsuppress"
                        ? "Remove suppression"
                        : modal === "consent"
                          ? "WhatsApp consent"
                          : modal === "sender_session"
                            ? "Confirm WhatsApp Sender"
                            : modal === "audience"
                              ? form.id ? "Edit segment" : "Create segment"
                              : "Confirm action"
            }
            onClose={() => {
              if (!busy) setModal(null);
            }}
            footer={
              <>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  disabled={
                    busy ||
                    (modal==='campaign'&&(!form.title?.trim()||!form.caption?.trim())) ||
                    (["approve", "confirm", "unsuppress"].includes(
                      modal,
                    ) &&
                      !form.confirmed)
                  }
                  onClick={() => {
                    if(modal==='sender_session'){
                      const g=generation.current;
                      perform(()=>command('sender_session',campaign,{revision:active.revision,senderId:sender,senderRevision:chosenSender.revision}),"Sender confirmed for this sending session.").then(result=>{if(result&&g===generation.current)setSenderSession(result)});
                    } else if (modal === "confirm")
                      perform(
                        () =>
                          command("confirm", recipient.id, {
                            senderId: sender,
                            senderSessionId:senderConfirmed?senderSession.id:null,
                          }),
                        "Staff confirmation recorded. Delivery is not verified.",
                      ).then((r) => {
                        if (r) setSelectedRecipient("");
                      });
                    else if (
                      ["approve", "cancel", "unsuppress"].includes(modal)
                    )
                      perform(
                        () =>
                          command(modal, form.id, { revision: form.revision }),
                        "Updated.",
                      );
                    else save().catch((e) => setError(e.message));
                  }}
                >
                  {modal === "sender_session" ? "Confirm Sender & Start Session" : modal === "customer" ? "Save customer" : modal === "campaign" ? "Save draft" : "Confirm"}
                </button>
              </>
            }
          >
            <div className="space-y-3">
              {error?<p role="alert" className="text-danger">{error}</p>:null}
              {modal==='customer'?<>
                <div className="outreach-form-grid">
                  <label className="admin-form-field"><span className="admin-form-field-label">Customer Name</span><input className="control" value={form.name||''} maxLength={160} onChange={e=>field('name',e.target.value)}/></label>
                  <label className="admin-form-field"><span className="admin-form-field-label">Phone Number</span><input className="control" type="tel" value={form.phone||''} onChange={e=>field('phone',e.target.value)} placeholder="+60 12 345 6789"/></label>
                  {(data.outlets.length>0||form.outlet_id)?<SelectField label="Brand Outlet" disabled={!data.outlets.length} placeholder="Existing outlet assignment" value={form.outlet_id||''} onChange={v=>field('outlet_id',v)} options={[{value:'',label:'No specific outlet'},...data.outlets.map(o=>({value:o.id,label:o.name}))]}/>:null}
                  <TagPicker value={form.tags||[]} options={data.tags||[]} allowCreate placeholder="Select or add tags" onChange={v=>field('tags',v)}/>
                </div>
              </>:null}
              {modal === "consent" ? <>
                <SelectField label="WhatsApp consent" value={form.state||'not_subscribed'} onChange={v=>field('state',v)} options={[{value:'subscribed',label:'Subscribed'},{value:'not_subscribed',label:'Not Subscribed'},{value:'do_not_contact',label:'Do Not Contact'}]}/>
                <SelectField label="Consent source" value={form.source||'Customer request'} onChange={v=>field('source',v)} options={['Customer request','In-person consent','WhatsApp conversation','Online opt-in','POS confirmed opt-in','Staff correction'].map(value=>({value,label:value}))}/>
                <p className="text-sm text-text-secondary">Choose Subscribed only when this customer has agreed to WhatsApp marketing from this brand.</p>
              </> : null}
              {modal === "suppress" ? input("Reason", "reason") : null}
              {modal==='sender_session'?<><p className="font-semibold">{chosenSender?.label}</p><p>{chosenSender?.phone_e164}</p><p className="text-sm text-text-secondary">Confirm you will use this WhatsApp sender for this campaign. Switching recipients keeps this confirmation. Refreshing or starting a new session requires confirmation again.</p><p className="text-sm text-text-secondary">FeedX cannot verify which account is signed in to WhatsApp.</p></>:null}
              {modal === "campaign" ? <div className="space-y-5">
                {input("Campaign title", "title")}
                <div className="outreach-campaign-layout">
                  <div className="space-y-4 min-w-0"><TextareaField label="Caption" rows={5} maxLength={4000} value={form.caption||''} onChange={caption=>field('caption',caption)} helper="Personalize with {name} and {brand}." disabled={busy}/>

                  <section className="space-y-4 min-w-0" aria-label="Campaign audience"><h3 className="text-sm font-semibold">Audience</h3>
                    {form.audience_criteria?<><TagPicker value={form.audience_criteria.tags||(form.audience_criteria.tag?[form.audience_criteria.tag]:[])} options={data.tags||[]} onChange={tags=>field('audience_criteria',{...form.audience_criteria,tag:'',tags})}/>{(data.outlets.length>0||form.audience_criteria.outlet_id)?<SelectField label="Outlet" disabled={!data.outlets.length} placeholder="Saved outlet filter" value={form.audience_criteria.outlet_id||''} onChange={outlet_id=>field('audience_criteria',{...form.audience_criteria,outlet_id})} options={[{value:'',label:'All'},...data.outlets.map(o=>({value:o.id,label:o.name}))]}/>:null}<SelectField label="WhatsApp Consent" value="eligible" disabled options={[{value:'eligible',label:'Subscribed only'}]}/></>:<SelectField label="Audience" value={form.audience_id||''} onChange={v=>field('audience_id',v)} options={[{value:'',label:'Select audience'},...data.audiences.map(a=>({value:a.id,label:`${a.name} · ${a.eligible_count} eligible`}))]}/>}
                    <DraftAudiencePreview org={org} brand={brand} criteria={form.audience_criteria||data.audiences.find(a=>a.id===form.audience_id)?.criteria}/>
                  </section></div>
                  <CampaignMediaField key={`${org}:${brand}`} org={org} brand={brand} assets={data.assets} assetId={form.asset_id} onChange={asset_id=>field('asset_id',asset_id)} onUploaded={asset=>setData(d=>({...d,assets:[asset,...d.assets]}))} canUpload={can('marketing_content.upload')} busy={busy} onBusy={setBusy}/>
                </div>
              </div>:null}
              {modal === "approve" ? (
                <>
                  <p>
                    Approve revision {form.revision} for{" "}
                    {
                      data.audiences.find((a) => a.id === form.audience_id)
                        ?.name
                    }
                    .
                  </p>
                  <p className="outreach-caption">{form.caption}</p>
                  <MarketingMediaPreview key={form.asset_id||'none'} asset={data.assets.find(a=>a.id===form.asset_id)}/>
                  <p>
                    Image:{" "}
                    {data.assets.find((a) => a.id === form.asset_id)
                      ?.filename || "None"}
                    . Sending is manual and consent is checked per recipient.
                  </p>
                </>
              ) : null}
              {modal === "confirm" ? (
                <>
                  <p>
                    Confirm you personally sent this exact approved caption from
                    the selected sender.
                  </p>
                  <p className="outreach-caption">{recipient?.caption}</p>
                </>
              ) : null}
              {modal === "cancel" ? (
                <p>
                  This stops further recipient actions. Existing staff
                  confirmations are retained.
                </p>
              ) : null}
              {modal === "unsuppress" ? (
                <p>
                  Removing suppression does not grant consent. Confirm the
                  customer’s withdrawal request has been appropriately reviewed.
                </p>
              ) : null}
              {["approve", "confirm", "unsuppress"].includes(
                modal,
              ) ? (
                <label>
                  <input
                    type="checkbox"
                    checked={!!form.confirmed}
                    onChange={(e) => field("confirmed", e.target.checked)}
                  />{" "}
                  I confirm this action.
                </label>
              ) : null}
            </div>
          </Modal>
        ) : null}
      </div>
    </WorkspacePage>
  );
}

function OutreachCollection({rows,columns,getRowKey,onRowClick}) {
 const keyboard=(event,row)=>{if(event.target===event.currentTarget&&['Enter',' '].includes(event.key)){event.preventDefault();onRowClick?.(row);}};
 return <><div className="outreach-desktop-table"><DataTable density="compact" minWidth={0} rows={rows} columns={columns} getRowKey={getRowKey} onRowClick={onRowClick} getRowProps={onRowClick?row=>({tabIndex:0,'aria-label':`Open campaign ${row.title}`,onKeyDown:event=>keyboard(event,row)}):undefined}/></div><div className="outreach-mobile-list">{rows.map(r=><article key={getRowKey(r)} {...(onRowClick?{tabIndex:0,'aria-label':`Open campaign ${r.title}`,onClick:event=>{if(!event.target.closest('button,a,input'))onRowClick(r)},onKeyDown:event=>keyboard(event,r)}:{})}>{columns.map((c,i)=><div key={c.key} className={i?'outreach-mobile-fact':''}>{i?<small>{c.header}</small>:null}{c.render?c.render(r):r[c.key]}</div>)}</article>)}</div></>;
}

function CampaignAudienceTags({criteria}) {
 const tags=criteria?.tags?.length?criteria.tags:criteria?.tag?[criteria.tag]:[];
 return criteria ? <span className="outreach-tag-chips">{tags.length?tags.map(tag=><Badge key={tag}>{tag}</Badge>):'All Customers'}</span> : 'Unavailable';
}
function CampaignRowActions({campaign:c,can,busy,onAction}) {
 const [open,setOpen]=useState(false);
 const actions=[['view','View']];
 if(can('marketing_campaigns.manage')&&(c.can_revise??(['draft','review','approved'].includes(c.status)&&!c.handled_count)))actions.push(['edit',c.status==='draft'?'Edit':'Revise']);
 if(can('marketing_campaigns.manage')&&c.status==='draft')actions.push(['review','Request Approval']);
 if(can('marketing_campaigns.execute')&&((c.status==='approved'&&c.approval_current)||c.status==='ready'&&(c.handled_count??0)<(c.recipient_count??0)))actions.push(['start',c.status==='ready'?'Continue Sending':'Start Sending']);
 if(can('marketing_campaigns.manage')&&c.status!=='cancelled')actions.push(['cancel','Cancel']);
 return <ActionMenu open={open} onOpenChange={setOpen} ariaLabel={`Actions for ${c.title}`} trigger={({toggle,ariaLabel})=><button className="btn-secondary outreach-icon-button" aria-label={ariaLabel} onClick={toggle}><MoreHorizontal size={17}/></button>}><div role="menu">{actions.map(([action,label])=><button key={action} role="menuitem" disabled={busy} onClick={()=>{setOpen(false);onAction(action,c)}}>{label}</button>)}</div></ActionMenu>;
}
function DraftAudiencePreview({org,brand,criteria}) {
 const [preview,setPreview]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const key=JSON.stringify([org,brand,criteria]);
 useEffect(()=>{
  let live=true;setPreview(null);setError('');setLoading(!!criteria);
  const timer=criteria?setTimeout(()=>outreachService.audiencePreview(org,brand,criteria).then(result=>{if(live)setPreview(result)}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)}),180):null;
  return ()=>{live=false;clearTimeout(timer)};
 },[key]);
 return <CampaignAudienceBreakdown breakdown={preview} loading={loading} error={error}/>;
}
