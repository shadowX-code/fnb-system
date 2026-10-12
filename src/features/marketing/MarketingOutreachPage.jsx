import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext.jsx";
import WorkspacePage from "../../components/layout/WorkspacePage.jsx";
import AdminSearchField from "../../components/forms/AdminSearchField.jsx";
import AdminFilterToolbar from "../../components/layout/AdminFilterToolbar.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
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
import { Plus, ArrowLeft, Settings, Users } from "lucide-react";
import TagPicker from "../../components/forms/TagPicker.jsx";
import DataTable from "../../components/tables/DataTable.jsx";
import EmptyState from "../../components/feedback/EmptyState.jsx";
import MarketingCustomersView from "./MarketingCustomersView.jsx";
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
function CampaignImage({ asset }) {
 const [url,setUrl]=useState('');
 useEffect(()=>{let live=true;setUrl('');if(asset)marketingService.assetUrl(asset).then(value=>{if(live)setUrl(value);}).catch(()=>{});return()=>{live=false;};},[asset?.id]);
 return asset ? url ? <img src={url} alt={asset.filename} className="outreach-image"/> : <p>Image preview unavailable.</p> : null;
}
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
    [senderConfirmed, setSenderConfirmed] = useState(false),
    [selectedRecipient, setSelectedRecipient] = useState("");
  const generation = useRef(0),
    intent = useRef(null),
    media = useRef(new Map());
  const brands = context.brands.filter((b) => b.organization_id === org),
    active = data?.campaigns.find((c) => c.id === campaign),
    recipient = data?.recipients.find((r) => r.id === selectedRecipient),
    scope = JSON.stringify([org, brand, campaign, page, search, auth.user?.id]);
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
    setBusy(false);
    setData(null);
    setSender("");
    setSenderConfirmed(false);
    setSelectedRecipient("");
    setError("");
    media.current.clear();
  }, [org, brand, auth.user?.id]);
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
  useEffect(()=>{generation.current++;setBusy(false);setSender("");setSenderConfirmed(false);setSelectedRecipient("");setTab(section === "whatsapp" ? "campaigns" : "customers");setCampaign("");setPage(1);setSearch("");setModal(null);setImportOpen(false);setNotice("");},[section]);
  const filteredCampaigns=(data?.campaigns||[]).filter(c=>(!campaignStatus||c.status===campaignStatus)&&(!campaignSearch||c.title.toLowerCase().includes(campaignSearch.toLowerCase())));
  const crmLink=(path)=>`${path}?${new URLSearchParams({marketing_org:org,marketing_brand:brand})}`;
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
          senderConfirmed,
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
    <label className="outreach-field">
      {label}
      <input
        className="control"
        type={type}
        value={form[key] || ""}
        onChange={(e) => field(key, e.target.value)}
        required
      />
    </label>
  );
  return (
    <WorkspacePage
      section="Marketing"
      title={section === "whatsapp" ? "WhatsApp Message" : "Customers"}
      description={section === "whatsapp" ? "Approved campaigns, handled personally by your team." : "Customer profiles, brand relationships and contact preferences."}
      controls={controls}
    >
      <div className="outreach">
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
            {section==='whatsapp'?<div className="outreach-view-heading"><strong>{tab==='senders'?'WhatsApp settings':'Campaigns'}</strong><div className="outreach-actions"><button className="btn-secondary" onClick={()=>{setTab(tab==='senders'?'campaigns':'senders');setCampaign('');setPage(1)}}>{tab==='senders'?<ArrowLeft size={15}/>:<Settings size={15}/>} {tab==='senders'?'Campaigns':'Sender settings'}</button>{can('marketing_audience.view')?<a className="btn-secondary" href={crmLink('/marketing/customers')}><Users size={15}/>Customers</a>:null}</div></div>:null}
            <AsyncDataSurface loading={loading} error={null} hasData={!!data}>
              {data&&tab==='customers'?<MarketingCustomersView key={brand} org={org} brand={brand} data={data} can={can} refresh={refresh} show={show} onImport={()=>setImportOpen(true)} onChanged={()=>setRefresh(v=>v+1)}/>:null}
              {data&&tab==='senders'?<section>
                <div className="outreach-section-heading"><p>Registered WhatsApp senders<small>Staff confirm the sender they use in WhatsApp.</small></p>{can('marketing_settings.configure')?<button className="btn-primary" onClick={()=>show('sender',{})}><Plus size={15}/> Register sender</button>:null}</div>
                {data.senders.length?<OutreachCollection rows={data.senders} getRowKey={s=>s.id} columns={[{key:'label',header:'Sender',render:s=><strong>{s.label}</strong>},{key:'phone_e164',header:'Phone'},{key:'active',header:'Status',render:s=><Badge tone={s.active?'success':'default'}>{s.active?'Registered':'Inactive'}</Badge>}]}/>:<EmptyState title="Register a brand sender" description="Add the WhatsApp numbers staff are authorized to use. This does not connect WhatsApp or enable automatic sending."/>}
              </section>:null}
              {data && tab === "campaigns" ? (
                <>
                  <section className="space-y-3">
                    <div className="outreach-section-heading">
                      {active?<button className="btn-secondary" onClick={()=>{setCampaign('');setPage(1)}}><ArrowLeft size={15}/> All campaigns</button>:<p>{filteredCampaigns.length} {filteredCampaigns.length===1?'campaign':'campaigns'}<small>Manual WhatsApp delivery</small></p>}
                      {can('marketing_campaigns.manage')?<button className="btn-primary" onClick={()=>show('campaign',{caption:'Hi {name}, ',...(can('marketing_audience.manage')?{audience_criteria:{tags:[],outlet_id:''}}:{audience_id:''})})}><Plus size={15}/> New campaign</button>:null}
                    </div>
                    {!active?<AdminFilterToolbar compact denseFields ariaLabel="Campaign filters" search={<AdminSearchField ariaLabel="Search campaigns" placeholder="Search campaigns" value={campaignSearch} onChange={setCampaignSearch}/>} filters={<SelectField label="Campaign status" value={campaignStatus} onChange={setCampaignStatus} options={[{value:'',label:'All'},...['draft','review','approved','ready','cancelled'].map(value=>({value,label:names[value]}))]}/>}/>:null}
                    {!active&&filteredCampaigns.length?<OutreachCollection rows={filteredCampaigns} getRowKey={c=>c.id} columns={[
                      {key:'title',header:'Campaign',render:c=><button className="outreach-name-button" onClick={()=>{setCampaign(c.id);setPage(1);setSelectedRecipient('')}}>{c.title}</button>},
                      {key:'status',header:'Status',render:c=><Badge tone={c.status==='approved'?'success':c.status==='review'?'warning':'default'}>{names[c.status]}</Badge>},
                      {key:'audience',header:'Audience size',render:c=>c.status==='ready'?c.recipient_count:c.audience_size??'Unavailable'},
                      {key:'progress',header:'Progress',render:c=>c.recipient_count?`${c.handled_count} / ${c.recipient_count} handled`:'Not queued'}
                    ]}/>:null}
                    {!active&&!filteredCampaigns.length?<EmptyState title={data.campaigns.length?"No matching campaigns":"No campaigns yet"} description={data.campaigns.length?"Adjust your search or status filter.":"Choose customer tags and an outlet, then prepare a message for approval. Sending is always manual."}/>:null}
                    {active ? (
                      <>
                        <div className="outreach-actions">
                          <h2>{active.title}</h2>
                          <Badge>{names[active.status]}</Badge>
                          <span>Revision {active.revision}</span>
                        </div>
                        <div className="outreach-campaign-overview"><CampaignImage asset={data.assets.find(a=>a.id===active.asset_id)}/><div><h3>Message{active.approved_revision===active.revision?" · Approved":" · Draft"}</h3><p className="outreach-caption">{active.caption}</p><dl className="outreach-profile-grid"><div><dt>Audience</dt><dd>{data.audiences.find(a=>a.id===active.audience_id)?.name||"Unavailable"}</dd></div><div><dt>Recipients</dt><dd>{active.recipient_count||"Not queued"}</dd></div><div><dt>Delivery</dt><dd>Manual Click-to-Chat</dd></div></dl></div></div>
                        <div className="outreach-actions">
                          {can("marketing_campaigns.manage") &&
                          ["draft", "review", "approved", "ready"].includes(
                            active.status,
                          ) ? (
                            <button
                              className="btn-secondary"
                              disabled={busy}
                              onClick={() => show("campaign", { ...active, ...(can("marketing_audience.manage")?{audience_criteria:data.audiences.find(a=>a.id===active.audience_id)?.criteria||{}}:{}) })}
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
                          {active.status === "approved" &&
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
                        <div className="outreach-actions">
                          {[
                            "pending",
                            "opened",
                            "staff_confirmed",
                            "skipped",
                          ].map((s) => (
                            <span key={s}>
                              {names[s]}: {data.progress[s] || 0}
                            </span>
                          ))}
                        </div>
                        <details className="outreach-evidence"><summary>Results & delivery limits</summary><p>Verified delivery: unavailable · Verified redemptions: unavailable</p><p>Staff confirmations record manual handling, not WhatsApp delivery. Queued campaigns do not send automatically. Cloud API delivery is unavailable.</p></details>
                      </>
                    ) : null}
                  </section>
                  {active?.status === "ready" && data.recipients.some(r=>["pending","opened"].includes(r.state)) ? (
                    <section className="outreach-queue space-y-3">
                      <h3>Manual WhatsApp queue</h3>
                      <SelectField
                        label="Registered sender"
                        value={sender}
                        onChange={(v) => {
                          setSender(v);
                          setSenderConfirmed(false);
                        }}
                        options={[
                          { value: "", label: "Select sender" },
                          ...data.senders
                            .filter((s) => s.active)
                            .map((s) => ({
                              value: s.id,
                              label: `${s.label} · ${s.phone_e164}`,
                            })),
                        ]}
                      />
                      <label>
                        <input
                          type="checkbox"
                          checked={senderConfirmed}
                          onChange={(e) => setSenderConfirmed(e.target.checked)}
                        />{" "}
                        I confirm WhatsApp is logged in as this registered
                        sender.
                      </label>
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
                  {active&&data.recipients.length?<section aria-label="Campaign recipient results" className="space-y-3"><h3 className="text-sm font-semibold">Recipient results · current queue page</h3><OutreachCollection rows={data.recipients} getRowKey={r=>r.id} columns={[
                    {key:'display_name',header:'Customer'},
                    {key:'state',header:'Handling',render:r=><Badge tone={r.state==='staff_confirmed'?'success':r.state==='skipped'?'warning':'default'}>{names[r.state]}</Badge>},
                    {key:'eligible',header:'Current consent',render:r=>r.eligible?'Eligible':'Contact blocked'},
                    {key:'sender',header:'Sender',render:r=>data.senders.find(s=>s.id===r.sender_id)?.label||'Not selected'},
                    {key:'result',header:'Result',render:r=>r.state==='staff_confirmed'?'Staff confirmation only':r.state==='skipped'?r.skip_reason||'Skipped':'Not confirmed'}
                  ]}/></section>:null}
                  {active?.status==='ready'&&!loading&&!data.recipients.some(r=>['pending','opened'].includes(r.state))?<p className="text-sm text-text-secondary">{(data.progress.pending||0)+(data.progress.opened||0)>0?'No pending recipients on this page.':'All recipients have been handled. Staff confirmations are shown in results.'}</p>:null}
                  {active?.status==='ready'&&(data.recipients.length>0||page>1)?<>                      <div className="outreach-actions">
                        <button
                          className="btn-secondary"
                          disabled={page === 1}
                          onClick={() => setPage((p) => p - 1)}
                        >
                          Previous
                        </button>
                        <span>Page {page}</span>
                        <button
                          className="btn-secondary"
                          disabled={data.recipients.length < 50}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          Next
                        </button>
                      </div>
</>:null}
                </>
              ) : null}
            </AsyncDataSurface>
          </>
        )}
        {importOpen&&brand?<CustomerImportDialog key={brand} org={org} brand={brand} brandName={brands.find(b=>b.id===brand)?.name||'Selected brand'} outlets={data?.outlets||[]} onClose={()=>setImportOpen(false)} onImported={()=>setRefresh(v=>v+1)}/>:null}
        {modal ? (
          <Modal
            open
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
                          : modal === "sender"
                            ? "Register brand sender"
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
                    (["approve", "confirm", "unsuppress", "sender"].includes(
                      modal,
                    ) &&
                      !form.confirmed)
                  }
                  onClick={() => {
                    if (modal === "confirm")
                      perform(
                        () =>
                          command("confirm", recipient.id, {
                            senderId: sender,
                            senderConfirmed,
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
                  {modal === "customer" ? "Save customer" : modal === "campaign" ? "Save draft" : "Confirm"}
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
                  <SelectField label="Brand Outlet" value={form.outlet_id||''} onChange={v=>field('outlet_id',v)} options={[{value:'',label:'No specific outlet'},...data.outlets.map(o=>({value:o.id,label:o.name}))]}/>
                  <TagPicker value={form.tags||[]} options={data.tags||[]} allowCreate placeholder="Select or add tags" onChange={v=>field('tags',v)}/>
                </div>
              </>:null}
              {modal === "consent" ? <>
                <SelectField label="WhatsApp consent" value={form.state||'not_subscribed'} onChange={v=>field('state',v)} options={[{value:'subscribed',label:'Subscribed'},{value:'not_subscribed',label:'Not Subscribed'},{value:'do_not_contact',label:'Do Not Contact'}]}/>
                <SelectField label="Consent source" value={form.source||'Customer request'} onChange={v=>field('source',v)} options={['Customer request','In-person consent','WhatsApp conversation','Online opt-in','POS confirmed opt-in','Staff correction'].map(value=>({value,label:value}))}/>
                <p className="text-sm text-text-secondary">Choose Subscribed only when this customer has agreed to WhatsApp marketing from this brand.</p>
              </> : null}
              {modal === "suppress" ? input("Reason", "reason") : null}
              {modal === "sender" ? (
                <>
                  {input("Sender label", "label")}
                  {input("Sender phone", "phone")}
                </>
              ) : null}
              {modal === "campaign" ? (
                <>
                  {input("Campaign title", "title")}
                  {form.audience_criteria ? <div className="space-y-3"><TagPicker value={form.audience_criteria.tags|| (form.audience_criteria.tag?[form.audience_criteria.tag]:[])} options={data.tags||[]} onChange={tags=>field('audience_criteria',{...form.audience_criteria,tag:'',tags})}/><SelectField label="Outlet" value={form.audience_criteria.outlet_id||''} onChange={outlet_id=>field('audience_criteria',{...form.audience_criteria,outlet_id})} options={[{value:'',label:'All'},...data.outlets.map(o=>({value:o.id,label:o.name}))]}/><SelectField label="WhatsApp Consent" value="eligible" disabled options={[{value:'eligible',label:'Subscribed only'}]}/><small>Any selected tag, combined with the outlet. Only customers with valid brand consent can be queued.</small></div> : <SelectField label="Audience" value={form.audience_id||''} onChange={v=>field('audience_id',v)} options={[{value:'',label:'Select audience'},...data.audiences.map(a=>({value:a.id,label:`${a.name} · ${a.eligible_count} eligible`}))]}/>}
                  <label className="outreach-field">
                    Caption
                    <textarea
                      className="control"
                      rows={5}
                      value={form.caption || ""}
                      onChange={(e) => field("caption", e.target.value)}
                    />
                  </label>
                  <small>
                    Personalize with {"{name}"} and {"{brand}"}.
                  </small>
                  <SelectField
                    label="Campaign image"
                    value={form.asset_id || ""}
                    onChange={(v) => field("asset_id", v)}
                    options={[
                      { value: "", label: "No image" },
                      ...data.assets.map((a) => ({
                        value: a.id,
                        label: a.filename,
                      })),
                    ]}
                  />
                  {can("marketing_content.upload") ? (
                    <label className="btn-secondary">
                      Upload image once
                      <input
                        type="file"
                        aria-label="Upload campaign image"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) return;
                          const g = generation.current;
                          setBusy(true);
                          try {
                            const a = await marketingService.upload(
                              org,
                              brand,
                              file,
                            );
                            if (g === generation.current) {
                              field("asset_id", a.id);
                              setData((d) => ({
                                ...d,
                                assets: [a, ...d.assets],
                              }));
                            }
                          } catch (e) {
                            setError(e.message);
                          } finally {
                            if (g === generation.current) setBusy(false);
                          }
                        }}
                      />
                    </label>
                  ) : null}
                </>
              ) : null}
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
              {["approve", "confirm", "unsuppress", "sender"].includes(
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
              {error ? <p role="alert">{error}</p> : null}
            </div>
          </Modal>
        ) : null}
      </div>
    </WorkspacePage>
  );
}

function OutreachCollection({rows,columns,getRowKey}) {
 return <><div className="outreach-desktop-table"><DataTable density="compact" minWidth={0} rows={rows} columns={columns} getRowKey={getRowKey}/></div><div className="outreach-mobile-list">{rows.map(r=><article key={getRowKey(r)}>{columns.map((c,i)=><div key={c.key} className={i?'outreach-mobile-fact':''}>{i?<small>{c.header}</small>:null}{c.render?c.render(r):r[c.key]}</div>)}</article>)}</div></>;
}
