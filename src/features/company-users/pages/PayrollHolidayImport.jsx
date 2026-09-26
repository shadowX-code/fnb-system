import { useEffect, useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import { payrollService } from "../../../services/payrollService.js";
import { malaysiaStateName } from "../../../constants/malaysiaStates.js";

export function holidayDiffSummary(rows = []) {
  return { imported: rows.filter(r => r.state !== "missing").length,
    matched: rows.filter(r => r.state === "matched").length,
    review: rows.filter(r => ["new", "changed", "missing"].includes(r.state)).length,
    blocked: rows.filter(r => r.state === "blocked").length };
}
const jurisdiction = r => r.scope === "national" ? "National" : malaysiaStateName(r.state_code);
const title = c => c.is_qa ? `QA ONLY · ${c.source_reference}` : c.source_reference;
const fileBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("Unable to read the source PDF."));
  reader.onload = () => resolve(String(reader.result).split(",")[1]);
  reader.readAsDataURL(file);
});

// This is source preparation/review only. Publication delegates to Annual Calendar.
export default function PayrollHolidayImport({ year, onPublished }) {
  const [candidates, setCandidates] = useState(null);
  const [includeQa, setIncludeQa] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState(null);
  const [capture, setCapture] = useState(false);
  const [source, setSource] = useState({ url: "", reference: "", file: null, requestId: crypto.randomUUID() });
  const [transcription, setTranscription] = useState("");
  const [decisions, setDecisions] = useState({});
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setCandidates(null); setSelected(null); setCapture(false); setError("");
    payrollService.readHolidayCandidates(year, includeQa).then(rows => { if (active) setCandidates(rows); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [year, includeQa]);
  useEffect(() => {
    if (!refresh) return;
    let active = true;
    payrollService.readHolidayCandidates(year, includeQa).then(rows => {
      if (!active) return;
      setCandidates(rows); setSelected(old => rows.find(c => c.id === old?.id) || null);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [refresh, year, includeQa]);
  const open = c => { setSelected(c); setDecisions(c.decisions || {}); setAttested(false); setTranscription(""); setError(""); };
  const perform = async action => {
    setBusy(true); setError("");
    try { await action(); setRefresh(n => n + 1); }
    catch (e) { setError(e.message || "Unable to update import. The published calendar has not changed."); }
    finally { setBusy(false); }
  };
  const captureSource = () => perform(async () => {
    if (!source.file || source.file.size > 5 * 1024 * 1024) throw new Error("Choose a PDF up to 5 MB.");
    await payrollService.captureHolidaySource({ ...source, year, filename: source.file.name, base64: await fileBase64(source.file) });
    setCapture(false);
  });
  const viewSource = () => perform(async () => {
    const pdf = await payrollService.readHolidaySource(selected.id);
    const bytes = Uint8Array.from(atob(pdf.base64.replace(/\s/g, "")), ch => ch.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const link = document.createElement("a"); link.href = url; link.download = pdf.filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  const changeDecision = (r, patch) => setDecisions(old => ({ ...old, [r.key]: { ...old[r.key], ...patch } }));
  const summary = holidayDiffSummary(selected?.rows);
  const exceptions = (selected?.rows || []).filter(r => r.state !== "matched");
  const allReviewed = !summary.blocked && exceptions.every(r => decisions[r.key]?.action === (r.state === "missing" ? "retain" : "accept") && (r.state !== "changed" || decisions[r.key]?.remark?.trim()));
  const reviewable = selected?.status === "needs_review";
  const close = () => { if (!busy) { setSelected(null); setCapture(false); setError(""); } };
  return <div className="mt-3 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-text-secondary">Official PDF → verified transcription → review → publication. Company selections stay pinned.</p>
      <button type="button" className="btn-secondary" onClick={() => { setSource({ url: "", reference: "", file: null, requestId: crypto.randomUUID() }); setCapture(true); setError(""); }}>Import Official Calendar</button>
    </div>
    {error && !selected && !capture && <p role="alert" className="text-sm text-rose-700">{error}<button type="button" className="ml-3 text-primary" onClick={() => setRefresh(n => n + 1)}>Refresh Imports</button></p>}
    {!candidates && !error && <p className="text-sm text-text-secondary">Loading imports…</p>}
    {!!candidates?.length && <DataTable density="compact" rows={candidates} getRowKey={c => c.id} columns={[
      { key: "source", header: "Import", render: c => <div><strong>{title(c)}</strong><p className="text-xs text-text-secondary">{c.created_at?.slice(0, 10)}</p></div> },
      { key: "status", header: "Status", render: c => <Badge tone={c.status === "published" ? "success" : "neutral"}>{c.status === "fetched" ? "Source captured" : c.status.replaceAll("_", " ")}</Badge> },
      { key: "diff", header: "Review", render: c => { const s = holidayDiffSummary(c.rows); return c.status === "fetched" ? "Transcription required" : `${s.matched} matched · ${s.review} need review · ${s.blocked} blocked`; } },
      { key: "action", header: "Action", render: c => <button type="button" className="text-primary" onClick={() => open(c)}>{c.status === "published" ? "View" : "Review"}</button> },
    ]} />}
    <details className="text-xs text-text-secondary"><summary className="cursor-pointer">Import history / QA visibility</summary><label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={includeQa} onChange={e => setIncludeQa(e.target.checked)} />Include clearly labelled QA imports (never official sources)</label></details>
    {capture && <Modal title="Import Official Calendar" size="lg" onClose={close} footer={<><button className="btn-secondary" disabled={busy} onClick={close}>Cancel</button><button className="btn-primary" disabled={busy || !source.file || !source.url.trim() || !source.reference.trim()} onClick={captureSource}>{busy ? "Capturing…" : "Capture Source"}</button></>}>
      <div className="space-y-4"><p className="text-sm text-text-secondary">Upload the JPM/BKPP annual calendar, or an official gazette/circular correction. Use the actual published government URL. FeedX retains the exact PDF; it does not guess dates or automatically extract or publish them.</p>
        <AdminFormField label="Official source URL" required><input className="control" type="url" value={source.url} onChange={e => setSource(s => ({ ...s, url: e.target.value, requestId: crypto.randomUUID() }))} /></AdminFormField>
        <AdminFormField label="Source reference" required><input className="control" value={source.reference} onChange={e => setSource(s => ({ ...s, reference: e.target.value, requestId: crypto.randomUUID() }))} /></AdminFormField>
        <AdminFormField label="Official PDF (max 5 MB)" required><input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={e => setSource(s => ({ ...s, file: e.target.files[0], requestId: crypto.randomUUID() }))} /></AdminFormField>
        <p className="text-xs text-text-secondary">Confirm that the uploaded document matches the official reference before reviewing its transcription. Government URL validation is not automatic document certification.</p>
      </div>{error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
    </Modal>}
    {selected && <Modal title={`Review ${year} Official Calendar Import`} size="xl" onClose={close} footer={<><button className="btn-secondary" disabled={busy} onClick={close}>Close</button>
      {selected.status === "fetched" && <button className="btn-primary" disabled={busy || !transcription.trim()} onClick={() => perform(async () => { await payrollService.parseHolidayCandidate(selected.id, JSON.parse(transcription)); })}>Review Transcription</button>}
      {reviewable && <><button className="btn-secondary" disabled={busy} onClick={() => perform(() => payrollService.reviewHolidayCandidate(selected.id, selected.revision, decisions, false))}>Save Review</button><button className="btn-primary" disabled={busy || !allReviewed || !attested} onClick={() => perform(() => payrollService.reviewHolidayCandidate(selected.id, selected.revision, decisions, true))}>Approve Import</button></>}
      {selected.status === "approved" && <button className="btn-primary" disabled={busy} onClick={() => perform(async () => { await payrollService.publishHolidayCandidate(selected.id, selected.revision); onPublished?.(); })}>Publish Annual Calendar</button>}
    </>}>
      <p className="mb-3 font-semibold">{title(selected)}</p>
      {selected.is_qa && <p role="status" className="mb-3 text-sm text-amber-800">Synthetic Staging QA evidence. Not an official Malaysian calendar.</p>}
      {selected.status === "fetched" ? <div className="space-y-3"><p className="text-sm text-text-secondary">Provide a verified structured transcription of this PDF. Check every date and jurisdiction against the document. Uncertain rows remain blocked; there is no unattended PDF parser.</p>
        <AdminFormField label="Verified holiday transcription" required><textarea className="control min-h-40 font-mono text-sm" value={transcription} onChange={e => setTranscription(e.target.value)} /></AdminFormField>
        <AdminFormField label="Or load verified transcription file"><input type="file" accept="application/json,.json" disabled={busy} onChange={e => perform(async () => { const file = e.target.files[0]; if (!file || file.size > 1024 * 1024) throw new Error("Choose a JSON file up to 1 MB."); setTranscription(await file.text()); })} /></AdminFormField>
        <details className="text-sm"><summary className="cursor-pointer">Transcription format</summary><p className="my-2">JSON array: date, name, scope (national/state), state_code (MY-08 Perak / MY-10 Selangor, etc.), source_locator (page/row). Optional kind: gazetted/special/substitute; previous_holiday_id for corrections; substitutes_holiday_id for an authoritative substitution. Mark uncertainty explicitly. Required paid status is never inferred.</p></details>
      </div> : <>
        <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[["Imported", summary.imported], ["Matched", summary.matched], ["Needs Review", summary.review], ["Blocked", summary.blocked]].map(([label, value]) => <div key={label}><dt className="text-text-secondary">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl>
        {summary.blocked > 0 && <p role="alert" className="mb-3 text-sm text-rose-700">Resolve uncertainty against the source, then capture a new corrected import. The current published calendar is unchanged.</p>}
        <div className="divide-y divide-border">{exceptions.map(r => { const h = r.row || r.previous?.holiday || {}; return <div key={r.key} className="space-y-2 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><strong>{h.name}</strong><p className="text-sm text-text-secondary">{h.date || h.holiday_date} · {jurisdiction(h)} · {r.state === "new" ? "New" : r.state === "changed" ? "Changed" : r.state === "missing" ? "Missing from source" : "Blocked"}</p>
          {r.state === "changed" && <p className="text-xs text-text-secondary">Previously: {r.previous.holiday.name} · {r.previous.holiday.holiday_date} · {jurisdiction(r.previous.holiday)}</p>}{r.issue && <p className="text-sm text-text-secondary">{r.issue}</p>}</div>
          {r.state !== "blocked" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!reviewable || busy} checked={!!decisions[r.key]?.action} onChange={e => changeDecision(r, { action: e.target.checked ? r.state === "missing" ? "retain" : "accept" : null })} />{r.state === "missing" ? "Retain previous holiday" : "Verified against source"}</label>}</div>
          {r.state === "changed" && <AdminFormField label={`Correction remark — ${h.name}`} required><input className="control" disabled={!reviewable || busy} value={decisions[r.key]?.remark || ""} onChange={e => changeDecision(r, { remark: e.target.value })} /></AdminFormField>}
        </div>; })}</div>
        {!exceptions.length && <p className="text-sm text-text-secondary">All records match. No repetitive row review is required.</p>}
        {summary.matched > 0 && <details className="my-3 text-sm"><summary className="cursor-pointer">Matched holidays ({summary.matched})</summary>{selected.rows.filter(r => r.state === "matched").map(r => <p key={r.key} className="py-1">{r.row.date} · {r.row.name} · {jurisdiction(r.row)}</p>)}</details>}
        {reviewable && <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-primary" checked={attested} onChange={e => setAttested(e.target.checked)} />I have reviewed the complete annual source and applicable corrections. Missing previous holidays are retained; company paid-holiday selections are separate.</label>}
        {selected.status === "approved" && <p className="mt-3 text-sm text-text-secondary">Approved for annual publication. Publishing creates a new calendar version, not a new company selection.</p>}
        {selected.status === "published" && <p role="status" className="mt-3 text-sm text-text-secondary">Annual calendar published. Existing Company Paid Holiday policies remain pinned until separately reviewed and published.</p>}
      </>}
      <details className="mt-4 border-t border-border pt-3 text-sm"><summary className="cursor-pointer text-primary">View Source / History</summary>
        <p className="my-2 break-all">{selected.source_url || "QA source"}</p><button className="btn-secondary" disabled={busy} onClick={viewSource}>Download Source PDF</button>
        <p className="my-2 break-all text-xs text-text-secondary">SHA-256: {selected.source_sha256} · {selected.parser_version || "Awaiting verified transcription"}</p>
        {(selected.history || []).map(e => <p key={e.id} className="py-1 text-xs text-text-secondary">{e.occurred_at} · {e.event_type.replaceAll("_", " ")}</p>)}
      </details>
      {error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}<button className="ml-3 text-primary" disabled={busy} onClick={() => setRefresh(n => n + 1)}>Refresh Review</button></p>}
    </Modal>}
  </div>;
}
