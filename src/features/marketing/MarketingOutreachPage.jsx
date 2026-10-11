import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext.jsx";
import WorkspacePage from "../../components/layout/WorkspacePage.jsx";
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
export default function MarketingOutreachPage() {
  const auth = useAuth(),
    can = (p) => auth.hasPermission(p),
    [context, setContext] = useState({ organizations: [], brands: [] }),
    [org, setOrg] = useState(""),
    [brand, setBrand] = useState(""),
    [tab, setTab] = useState("campaigns"),
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
          setOrg(c.organizations[0]?.id || "");
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
      if (g === generation.current) setError(e.message);
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
  async function save() {
    if (modal === "customer") {
      normalizeMalaysianPhone(form.phone);
      await perform(
        () =>
          outreachService.customer(crypto.randomUUID(), org, brand, {
            ...form,
            tags: (form.tags || "")
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          }),
        "Customer relationship saved; consent is still required.",
      );
      return;
    }
    const action = modal === "campaign" ? "save" : modal;
    let payload = form;
    if (action === "audience")
      payload = {
        name: form.name,
        criteria: {
          language: form.language || "",
          tag: form.tag || "",
          outlet_id: form.outlet_id || "",
        },
      };
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
  const controls = (
    <AdminFilterToolbar
      ariaLabel="Marketing scope"
      filters={
        <>
          <SelectField
            label="Organization"
            value={org}
            onChange={(v) => {
              if (!busy) {
                setOrg(v);
                setBrand("");
              }
            }}
            options={context.organizations.map((o) => ({
              value: o.id,
              label: o.name,
            }))}
          />
          <SelectField
            label="Brand"
            value={brand}
            onChange={(v) => {
              if (!busy) setBrand(v);
            }}
            options={[
              { value: "", label: "Select a brand" },
              ...brands.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
        </>
      }
    />
  );
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
      title="Audience & WhatsApp Campaigns"
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
            Select a brand to manage its audiences, consent and campaigns.
          </section>
        ) : (
          <>
            <div
              role="tablist"
              aria-label="Outreach views"
              className="outreach-actions"
            >
              {["campaigns", "audience", "senders"].map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  className={tab === t ? "btn-primary" : "btn-secondary"}
                  onClick={() => {
                    setTab(t);
                    setPage(1);
                    setSearch("");
                  }}
                >
                  {t === "audience"
                    ? "Audience & Consent"
                    : t === "senders"
                      ? "Sender identities"
                      : "Campaigns"}
                </button>
              ))}
            </div>
            <AsyncDataSurface loading={loading} error={null} hasData={!!data}>
              {data && tab === "audience" ? (
                <section className="card p-4 space-y-3">
                  <div className="outreach-actions">
                    <input
                      aria-label="Search customers"
                      className="control"
                      placeholder="Search name or phone"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                      }}
                    />
                    {can("platform_customers.manage") ? (
                      <button
                        className="btn-primary"
                        disabled={busy}
                        onClick={() => show("customer", { language: "EN" })}
                      >
                        Add customer
                      </button>
                    ) : null}
                    {can("marketing_audience.manage") ? (
                      <button
                        className="btn-secondary"
                        onClick={() => show("audience", {})}
                      >
                        New segment
                      </button>
                    ) : null}
                  </div>
                  <div className="outreach-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Customer</th>
                          <th>Segment details</th>
                          <th>WhatsApp consent</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.customers.map((c) => (
                          <tr key={c.id}>
                            <td>
                              {c.display_name}
                              <small>{c.phone_e164}</small>
                            </td>
                            <td>
                              {c.language}
                              <small>{c.tags.join(", ") || "No tags"}</small>
                            </td>
                            <td>
                              <Badge tone={c.eligible ? "success" : "warning"}>
                                {c.suppressed
                                  ? "Suppressed"
                                  : c.eligible
                                    ? "Eligible"
                                    : "Consent required"}
                              </Badge>
                              {c.consent ? (
                                <small>
                                  {c.consent.source} · {c.consent.decision}
                                </small>
                              ) : null}
                            </td>
                            <td>
                              {can("marketing_audience.manage") ? (
                                <div className="outreach-actions">
                                  <button
                                    className="btn-secondary"
                                    onClick={() =>
                                      show("consent", {
                                        id: c.id,
                                        decision: "granted",
                                        occurred_at: new Date(
                                          Date.now() -
                                            new Date().getTimezoneOffset() *
                                              60000,
                                        )
                                          .toISOString()
                                          .slice(0, 16),
                                      })
                                    }
                                  >
                                    Record consent
                                  </button>
                                  <button
                                    className="btn-secondary"
                                    onClick={() =>
                                      show(
                                        c.suppressed
                                          ? "unsuppress"
                                          : "suppress",
                                        {
                                          id: c.id,
                                          reason: "Customer opt-out",
                                        },
                                      )
                                    }
                                  >
                                    {c.suppressed
                                      ? "Review suppression"
                                      : "Suppress"}
                                  </button>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!data.customers.length ? (
                    <p>No customers in this brand.</p>
                  ) : null}
                  <div className="outreach-actions">
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
                      disabled={page * 50 >= data.customer_total}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                  <h3>Segments</h3>
                  {data.audiences.map((a) => (
                    <p key={a.id}>
                      {a.name} · {a.eligible_count} eligible ·{" "}
                      {Object.entries(a.criteria)
                        .filter(([, v]) => v)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(", ") || "All eligible brand customers"}
                    </p>
                  ))}
                </section>
              ) : null}
              {data && tab === "senders" ? (
                <section className="card p-4 space-y-3">
                  <p>
                    Registered identities are staff declarations. FeedX cannot
                    select or verify the logged-in WhatsApp sender.
                  </p>
                  {can("marketing_settings.configure") ? (
                    <button
                      className="btn-primary"
                      onClick={() => show("sender", {})}
                    >
                      Register sender
                    </button>
                  ) : null}
                  {data.senders.map((s) => (
                    <div key={s.id} className="outreach-row">
                      <strong>{s.label}</strong>
                      <span>{s.phone_e164}</span>
                      <Badge>{s.active ? "Registered" : "Inactive"}</Badge>
                    </div>
                  ))}
                </section>
              ) : null}
              {data && tab === "campaigns" ? (
                <>
                  <section className="card p-4 space-y-3">
                    <div className="outreach-actions">
                      <SelectField
                        label="Campaign"
                        value={campaign}
                        onChange={(v) => {
                          setCampaign(v);
                          setPage(1);
                          setSelectedRecipient("");
                        }}
                        options={[
                          { value: "", label: "Select a campaign" },
                          ...data.campaigns.map((c) => ({
                            value: c.id,
                            label: `${c.title} · ${names[c.status]}`,
                          })),
                        ]}
                      />
                      {can("marketing_campaigns.manage") ? (
                        <button
                          className="btn-primary"
                          onClick={() =>
                            show("campaign", {
                              caption: "Hi {name}, ",
                              audience_id: data.audiences[0]?.id || "",
                            })
                          }
                        >
                          New campaign
                        </button>
                      ) : null}
                    </div>
                    {!data.campaigns.length ? (
                      <p>
                        No campaigns yet. Add consented customers and a segment
                        to start.
                      </p>
                    ) : null}
                    {active ? (
                      <>
                        <div className="outreach-actions">
                          <h2>{active.title}</h2>
                          <Badge>{names[active.status]}</Badge>
                          <span>Revision {active.revision}</span>
                        </div>
                        <p className="outreach-caption">{active.caption}</p><CampaignImage asset={data.assets.find(a=>a.id===active.asset_id)}/>
                        <div className="outreach-actions">
                          {can("marketing_campaigns.manage") &&
                          ["draft", "review", "approved", "ready"].includes(
                            active.status,
                          ) ? (
                            <button
                              className="btn-secondary"
                              disabled={busy}
                              onClick={() => show("campaign", { ...active })}
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
                        <p className="text-sm">
                          Verified delivery: unavailable · Verified redemptions:
                          unavailable
                        </p>
                      </>
                    ) : null}
                  </section>
                  {active?.status === "ready" ? (
                    <section className="card p-4 space-y-3">
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
                      <div className="outreach-actions">
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
                    </section>
                  ) : null}
                </>
              ) : null}
            </AsyncDataSurface>
          </>
        )}
        {modal ? (
          <Modal
            open
            title={
              modal === "campaign"
                ? "Campaign draft"
                : modal === "customer"
                  ? "Add shared customer"
                  : modal === "confirm"
                    ? "Confirm manual send"
                    : modal === "approve"
                      ? "Approve exact campaign revision"
                      : modal === "unsuppress"
                        ? "Remove suppression"
                        : modal === "consent"
                          ? "Record WhatsApp consent"
                          : modal === "sender"
                            ? "Register brand sender"
                            : modal === "audience"
                              ? "Create segment"
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
                  Confirm
                </button>
              </>
            }
          >
            <div className="space-y-3">
              {modal === "customer" ? (
                <>
                  <SelectField label="Customer identity" value={form.customer_id||''} onChange={v=>{const c=data.shared_customers?.find(c=>c.id===v);setForm(f=>({...f,customer_id:v,name:c?.name||'',phone:c?.phone||''}));}} options={[{value:'',label:'Create new customer'},...(data.shared_customers||[]).map(c=>({value:c.id,label:`${c.name} · ${c.phone}`}))]}/>
                  {input("Customer name", "name")}
                  {input("Malaysian phone", "phone")}
                  {input("Tags (comma separated)", "tags")}
                  <SelectField label="Brand outlet" value={form.outlet_id||''} onChange={v=>field('outlet_id',v)} options={[{value:'',label:'No specific outlet'},...data.outlets.map(o=>({value:o.id,label:o.name}))]}/>
                  <SelectField
                    label="Language"
                    value={form.language}
                    onChange={(v) => field("language", v)}
                    options={["EN", "ZH", "BM"].map((v) => ({
                      value: v,
                      label: v,
                    }))}
                  />
                </>
              ) : null}
              {modal === "audience" ? (
                <>
                  {input("Segment name", "name")}
                  {input("Tag filter (optional)", "tag")}
                  <SelectField
                    label="Language filter"
                    value={form.language || ""}
                    onChange={(v) => field("language", v)}
                    options={[
                      { value: "", label: "Any language" },
                      ...["EN", "ZH", "BM"].map((v) => ({
                        value: v,
                        label: v,
                      })),
                    ]}
                  />
                  <SelectField
                    label="Outlet"
                    value={form.outlet_id || ""}
                    onChange={(v) => field("outlet_id", v)}
                    options={[
                      { value: "", label: "All brand outlets" },
                      ...data.outlets.map((o) => ({
                        value: o.id,
                        label: o.name,
                      })),
                    ]}
                  />
                </>
              ) : null}
              {modal === "consent" ? (
                <>
                  <SelectField
                    label="Consent decision"
                    value={form.decision}
                    onChange={(v) => field("decision", v)}
                    options={[
                      { value: "granted", label: "Granted" },
                      { value: "withdrawn", label: "Withdrawn" },
                    ]}
                  />
                  {input("Source", "source")}
                  {input("Evidence reference / customer statement", "evidence")}
                  {input(
                    "Consent occurred at",
                    "occurred_at",
                    "datetime-local",
                  )}
                  <p className="text-sm">
                    Record actual WhatsApp marketing consent. A phone number or
                    past purchase is not consent.
                  </p>
                </>
              ) : null}
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
                  <SelectField
                    label="Audience"
                    value={form.audience_id || ""}
                    onChange={(v) => field("audience_id", v)}
                    options={[
                      { value: "", label: "Select audience" },
                      ...data.audiences.map((a) => ({
                        value: a.id,
                        label: `${a.name} · ${a.eligible_count} eligible`,
                      })),
                    ]}
                  />
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
