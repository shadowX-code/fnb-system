import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpenCheck,
  Check,
  ChevronRight,
  Copy,
  FileText,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import { crewService } from "../../../services/crewService.js";
import { outletService } from "../../../services/outletService.js";

const byOrder = (rows = []) => [...rows].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
const byVersion = (rows = []) => [...rows].sort((a, b) => Number(b.version) - Number(a.version));
const formatDate = (value) => value ? new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—";
const currentVersion = (sop) => (sop?.versions || []).find((version) => version.status === "published" && Number(version.version) === Number(sop.current_version)) || byVersion(sop?.versions).find((version) => version.status === "published");
const draftVersion = (sop) => byVersion(sop?.versions).find((version) => version.status === "draft");

export default function CrewSopLibraryPage({ auth, ui, store }) {
  const canManage = auth.hasPermission("crew_sop.manage");
  const [outlets, setOutlets] = useState([]);
  const [outletId, setOutletId] = useState("");
  const [sops, setSops] = useState([]);
  const [categories, setCategories] = useState([]);
  const [view, setView] = useState("library");
  const [selectedId, setSelectedId] = useState("");
  const [activeVersionId, setActiveVersionId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const selectedSop = sops.find((sop) => sop.id === selectedId);
  const outlet = outlets.find((item) => item.id === outletId);

  useEffect(() => {
    let active = true;
    async function loadOutlets() {
      try {
        const rows = store?.outlets?.length ? store.outlets : await outletService.listActiveOutlets();
        if (!active) return;
        const available = (rows || []).filter((item) => item.is_active !== false);
        setOutlets(available);
        setOutletId((current) => current || available[0]?.id || "");
      } catch (cause) {
        ui.notify({ title: "Unable to load SOP outlets", message: cause.message, tone: "error" });
        setLoading(false);
      }
    }
    loadOutlets();
    return () => { active = false; };
  }, [store?.outlets, ui]);

  async function refresh(targetOutletId = outletId) {
    if (!targetOutletId) return;
    setLoading(true);
    try {
      const result = await crewService.listOutletSopsAdmin(targetOutletId);
      setSops(result.sops || []);
      setCategories(result.categories || []);
      setSelectedId((current) => result.sops?.some((sop) => sop.id === current) ? current : "");
    } catch (cause) {
      ui.notify({ title: "Unable to load SOP Library", message: cause.message, tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(outletId); }, [outletId]);

  function openDetail(sopId, tabVersionId = "") {
    setSelectedId(sopId);
    setActiveVersionId(tabVersionId);
    setView("detail");
  }

  function openEditor(sopId, versionId) {
    setSelectedId(sopId);
    setActiveVersionId(versionId);
    setView("editor");
  }

  async function createSop(values) {
    setSaving(true);
    try {
      let category = categories.find((item) => item.id === values.categoryId);
      if (!category && values.newCategory.trim()) {
        category = await crewService.saveSopCategory({ outlet_id: outletId, name: values.newCategory.trim(), sort_order: categories.length * 10 + 10 });
      }
      if (!category) throw new Error("Choose an SOP category.");
      const sop = await crewService.saveSop({
        title: values.title.trim(),
        summary: values.summary.trim() || null,
        category: category.name,
        category_id: category.id,
        outlet_id: outletId,
        status: "draft",
      });
      const versionId = await crewService.newSopVersion(sop.id);
      await crewService.saveDraftRecord("crew_sop_versions", { id: versionId, require_acknowledgement: values.requireAcknowledgement });
      await refresh();
      setCreateOpen(false);
      openEditor(sop.id, versionId);
      ui.notify({ title: "SOP draft created", message: "Draft v1 is ready for sections." });
    } catch (cause) {
      ui.notify({ title: "Unable to create SOP", message: cause.message, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function createVersion(sop) {
    setSaving(true);
    try {
      const versionId = await crewService.newSopVersion(sop.id);
      await refresh();
      openEditor(sop.id, versionId);
      ui.notify({ title: "New SOP version created", message: "The published version remains unchanged." });
    } catch (cause) {
      ui.notify({ title: "Unable to create version", message: cause.message, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteDraft(sop) {
    const draft = draftVersion(sop);
    if (!draft) return;
    const hasPublished = Boolean(currentVersion(sop));
    const confirmed = await ui.confirm({
      title: hasPublished ? `Delete draft v${draft.version}?` : `Delete ${sop.title}?`,
      message: hasPublished ? "Only the editable draft is removed. The published SOP remains live and unchanged." : "This removes the unpublished SOP draft and its sections.",
      confirmLabel: "Delete Draft",
      tone: "danger",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await crewService.deleteDraftRecord(hasPublished ? "crew_sop_versions" : "crew_sops", hasPublished ? draft.id : sop.id);
      await refresh();
      ui.notify({ title: "SOP draft deleted" });
    } catch (cause) {
      ui.notify({ title: "Unable to delete draft", message: cause.message, tone: "error" });
    } finally { setSaving(false); }
  }

  async function publishVersion(sop, version) {
    const confirmed = await ui.confirm({
      title: `Publish SOP v${version.version}?`,
      message: `${version.sections?.length || 0} sections · ${version.require_acknowledgement ? "Acknowledgement required" : "No acknowledgement required"} · ${outlet?.name}. After publishing, v${version.version} becomes read only and existing pinned onboarding snapshots remain unchanged.`,
      confirmLabel: `Publish v${version.version}`,
      tone: "success",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await crewService.publishSopVersion(version.id);
      await refresh();
      setView("detail");
      setActiveVersionId(version.id);
      ui.notify({ title: `SOP v${version.version} published`, message: "Future changes now require a new version." });
    } catch (cause) {
      ui.notify({ title: "Unable to publish SOP", message: cause.message, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="crew-sop-admin-shell">
      {view === "library" ? (
        <>
          <PageHeader
            section="Crew · Knowledge"
            title="SOP Library"
            description="Manage outlet procedures and employee knowledge."
            actions={<>
              <label className="crew-sop-outlet-select"><span>Outlet</span><select aria-label="Outlet" value={outletId} onChange={(event) => setOutletId(event.target.value)}>{outlets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              {canManage ? <button className="btn-secondary" type="button" onClick={() => setCloneOpen(true)}><Copy size={15} /> Clone From Outlet</button> : null}
              {canManage ? <button className="btn-primary" type="button" onClick={() => setCreateOpen(true)}><Plus size={15} /> New SOP</button> : null}
            </>}
          />
          <SopLibrary
            outlet={outlet}
            sops={sops}
            categories={categories}
            loading={loading}
            canManage={canManage}
            onOpen={openDetail}
            onCreate={() => setCreateOpen(true)}
            onClone={() => setCloneOpen(true)}
            onNewVersion={createVersion}
            onDeleteDraft={deleteDraft}
          />
        </>
      ) : view === "editor" && selectedSop ? (
        <SopEditor
          sop={selectedSop}
          outlet={outlet}
          version={(selectedSop.versions || []).find((version) => version.id === activeVersionId) || draftVersion(selectedSop)}
          saving={saving}
          onBack={() => setView("detail")}
          onRefresh={refresh}
          onPublish={(version) => publishVersion(selectedSop, version)}
        />
      ) : selectedSop ? (
        <SopDetail
          sop={selectedSop}
          outlet={outlet}
          canManage={canManage}
          saving={saving}
          preferredVersionId={activeVersionId}
          onBack={() => setView("library")}
          onEdit={(versionId) => openEditor(selectedSop.id, versionId)}
          onNewVersion={() => createVersion(selectedSop)}
        />
      ) : null}
      {createOpen ? <CreateSopModal categories={categories} saving={saving} onClose={() => setCreateOpen(false)} onCreate={createSop} /> : null}
      {cloneOpen ? <CloneSopsModal targetOutlet={outlet} outlets={outlets.filter((item) => item.id !== outletId)} saving={saving} onClose={() => setCloneOpen(false)} onCloned={async (result) => { setCloneOpen(false); await refresh(); ui.notify({ title: "SOPs cloned", message: `${result.sops_cloned} SOPs cloned · ${result.categories_created} categories created.` }); }} /> : null}
    </div>
  );
}

function SopLibrary({ outlet, sops, categories, loading, canManage, onOpen, onCreate, onClone, onNewVersion, onDeleteDraft }) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [acknowledgement, setAcknowledgement] = useState("");
  const rows = useMemo(() => sops.filter((sop) => {
    const published = currentVersion(sop);
    const draft = draftVersion(sop);
    const lifecycle = draft ? "draft" : published ? "published" : sop.status;
    const ack = draft?.require_acknowledgement ?? published?.require_acknowledgement ?? false;
    return (!query || `${sop.title} ${sop.summary || ""}`.toLowerCase().includes(query.toLowerCase()))
      && (!categoryId || sop.category_id === categoryId)
      && (!status || lifecycle === status)
      && (!acknowledgement || (acknowledgement === "required") === Boolean(ack));
  }), [sops, query, categoryId, status, acknowledgement]);

  if (loading) return <LibrarySkeleton />;
  return <section className="crew-sop-library-panel">
    <div className="crew-sop-filterbar">
      <label className="crew-sop-search-field"><Search size={16} /><input aria-label="Search SOP" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SOP..." /></label>
      <label><span>Category</span><select aria-label="Category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">All Categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label><span>Status</span><select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All Status</option><option value="published">Published</option><option value="draft">Draft</option></select></label>
      <label><span>Acknowledgement</span><select aria-label="Acknowledgement" value={acknowledgement} onChange={(event) => setAcknowledgement(event.target.value)}><option value="">All</option><option value="required">Required</option><option value="not_required">Not required</option></select></label>
    </div>
    {rows.length ? <DataTable
      density="normal"
      tableClassName="min-w-[920px] table-fixed"
      rows={rows}
      getRowKey={(row) => row.id}
      onRowClick={(row) => onOpen(row.id)}
      columns={[
        { key: "sop", header: "SOP", width: "26%", render: (row) => <div className="crew-sop-title-cell"><FileText size={17} /><span><strong>{row.title}</strong><small>{row.summary || "Operational procedure"}</small></span></div> },
        { key: "category", header: "Category", width: "10%", render: (row) => row.category || "Other" },
        { key: "version", header: "Current Version", width: "9%", render: (row) => currentVersion(row) ? `v${currentVersion(row).version}` : "—" },
        { key: "status", header: "Status", width: "9%", render: (row) => currentVersion(row) ? <Badge tone="success">Published</Badge> : <Badge tone="warning">Draft</Badge> },
        { key: "draft", header: "Draft", width: "9%", render: (row) => draftVersion(row) ? <Badge tone="warning">Draft v{draftVersion(row).version}</Badge> : "—" },
        { key: "ack", header: "Acknowledgement", width: "15%", render: (row) => (draftVersion(row)?.require_acknowledgement ?? currentVersion(row)?.require_acknowledgement) ? "Required" : "Not required" },
        { key: "updated", header: "Last Updated", width: "10%", render: (row) => formatDate(row.updated_at) },
        { key: "actions", header: "Actions", width: "12%", align: "right", render: (row) => <SopRowActions row={row} canManage={canManage} onOpen={onOpen} onNewVersion={onNewVersion} onDeleteDraft={onDeleteDraft} /> },
      ]}
    /> : <div className="crew-sop-compact-empty"><EmptyState title={sops.length ? "No SOPs match these filters" : "No SOPs yet"} description={sops.length ? "Adjust the search or filter selection." : `Create SOPs for ${outlet?.name || "this outlet"} or clone an existing setup.`} />{!sops.length && canManage ? <div><button className="btn-primary" onClick={onCreate}>Create SOP</button><button className="btn-secondary" onClick={onClone}>Clone From Outlet</button></div> : null}</div>}
  </section>;
}

function SopRowActions({ row, canManage, onOpen, onNewVersion, onDeleteDraft }) {
  const [menu, setMenu] = useState(null);
  const buttonRef = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && (buttonRef.current?.contains(event.target) || event.target.closest?.(".crew-sop-more-menu"))) return;
      setMenu(null);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); window.removeEventListener("keydown", close); window.removeEventListener("pointerdown", close); };
  }, [menu]);
  function toggleMenu() {
    if (menu) return setMenu(null);
    const rect = buttonRef.current?.getBoundingClientRect();
    setMenu(rect ? { top: rect.bottom + 5, left: Math.max(8, rect.right - 180) } : null);
  }
  return <div className="crew-sop-row-actions"><button className="btn-secondary" type="button" onClick={() => onOpen(row.id)}>Open</button>{canManage ? <><button ref={buttonRef} className="icon-btn" aria-label={`More actions for ${row.title}`} aria-expanded={Boolean(menu)} type="button" onClick={toggleMenu}><MoreHorizontal size={16} /></button>{menu ? createPortal(<div className="crew-sop-more-menu" role="menu" style={menu}>{currentVersion(row) && !draftVersion(row) ? <button role="menuitem" type="button" onClick={() => { setMenu(null); onNewVersion(row); }}>Create New Version</button> : null}{draftVersion(row) ? <button role="menuitem" className="is-danger" type="button" onClick={() => { setMenu(null); onDeleteDraft(row); }}>Delete Draft</button> : null}</div>, document.body) : null}</> : null}</div>;
}

function SopDetail({ sop, outlet, canManage, saving, preferredVersionId, onBack, onEdit, onNewVersion }) {
  const versions = byVersion(sop.versions);
  const published = currentVersion(sop);
  const draft = draftVersion(sop);
  const [tab, setTab] = useState("overview");
  const [viewVersionId, setViewVersionId] = useState(preferredVersionId || published?.id || draft?.id || "");
  const active = versions.find((version) => version.id === viewVersionId) || published || draft;
  useEffect(() => { setViewVersionId(preferredVersionId || published?.id || draft?.id || ""); }, [sop.id, preferredVersionId, published?.id, draft?.id]);
  return <div className="crew-sop-detail-page">
    <button className="btn-ghost crew-sop-back" onClick={onBack}><ArrowLeft size={16} /> SOP Library</button>
    <header className="crew-sop-detail-header">
      <div><div className="crew-sop-detail-status"><span>{sop.category || "Other"}</span>{published ? <Badge tone="success">Published v{published.version}</Badge> : <Badge tone="warning">Draft</Badge>}{draft ? <Badge tone="warning">Draft v{draft.version}</Badge> : null}</div><h1>{sop.title}</h1><p>{sop.summary || "No summary provided."}</p><small>Outlet: {outlet?.name || "—"}</small></div>
      {canManage ? <div className="crew-sop-detail-actions">{draft ? <button className="btn-primary" disabled={saving} onClick={() => onEdit(draft.id)}>Continue Editing Draft v{draft.version}</button> : published ? <button className="btn-primary" disabled={saving} onClick={onNewVersion}>Create New Version</button> : null}{draft && published ? <button className="btn-secondary" onClick={() => { setViewVersionId(published.id); setTab("content"); }}>View Published v{published.version}</button> : null}</div> : null}
    </header>
    <SopTabs active={tab} onChange={setTab} />
    {tab === "overview" ? <SopOverview sop={sop} outlet={outlet} published={published} draft={draft} /> : null}
    {tab === "content" ? <PublishedDocument version={active} onSelectVersion={setViewVersionId} versions={versions} /> : null}
    {tab === "versions" ? <VersionList versions={versions} currentVersionNumber={sop.current_version} canManage={canManage} onEdit={onEdit} onView={(id) => { setViewVersionId(id); setTab("content"); }} /> : null}
    {tab === "usage" ? <UsageView sopId={sop.id} /> : null}
  </div>;
}

function SopOverview({ sop, outlet, published, draft }) {
  const details = [
    ["Category", sop.category || "Other"],
    ["Current Version", published ? `v${published.version} Published` : "Not published"],
    ["Draft", draft ? `v${draft.version}` : "None"],
    ["Acknowledgement", (draft?.require_acknowledgement ?? published?.require_acknowledgement) ? "Required" : "Not required"],
    ["Outlet", outlet?.name || "—"],
    ["Last Updated", formatDate(sop.updated_at)],
  ];
  return <section className="crew-sop-overview"><h2>Lifecycle overview</h2><dl>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p>Published versions are immutable. Existing Crew assignments remain pinned to the exact SOP version captured in their onboarding snapshot.</p></section>;
}

function PublishedDocument({ version, versions, onSelectVersion }) {
  const sections = byOrder(version?.sections);
  const refs = useRef({});
  if (!version) return <div className="crew-sop-compact-empty"><EmptyState title="No SOP version" description="Create a draft version to start writing this SOP." /></div>;
  return <div className="crew-sop-document-shell">
    <aside><div><strong>Section navigation</strong><span>{sections.length}</span></div>{sections.map((section, index) => <button key={section.id} onClick={() => refs.current[section.id]?.scrollIntoView({ behavior: "smooth", block: "start" })}><span>{String(index + 1).padStart(2, "0")}</span>{section.title}</button>)}</aside>
    <main><div className="crew-sop-document-meta"><div><Badge tone={version.status === "published" ? "success" : "warning"}>{version.status === "published" ? "Published" : "Draft preview"}</Badge><span>v{version.version}</span></div>{versions.length > 1 ? <select aria-label="Document version" value={version.id} onChange={(event) => onSelectVersion(event.target.value)}>{versions.map((item) => <option key={item.id} value={item.id}>v{item.version} · {item.status}</option>)}</select> : null}</div>{sections.length ? <article className="crew-sop-document">{sections.map((section, index) => <section key={section.id} ref={(node) => { refs.current[section.id] = node; }} tabIndex="-1"><div className="crew-sop-section-number">{String(index + 1).padStart(2, "0")}</div><h2>{section.title}</h2>{section.key_point ? <div className="crew-sop-key-point"><strong>Key Point</strong><p>{section.body}</p></div> : <p>{section.body}</p>}</section>)}</article> : <EmptyState title="No sections yet" description="This draft has no document content." />}</main>
  </div>;
}

function SopEditor({ sop, outlet, version, saving, onBack, onRefresh, onPublish }) {
  const sections = byOrder(version?.sections);
  const [selectedId, setSelectedId] = useState(sections[0]?.id || "new");
  const selected = sections.find((section) => section.id === selectedId);
  const [form, setForm] = useState({ title: "", body: "", key_point: false });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  useEffect(() => { setSelectedId((current) => sections.some((item) => item.id === current) ? current : sections[0]?.id || "new"); }, [version?.id, version?.sections]);
  useEffect(() => { setForm(selected ? { title: selected.title || "", body: selected.body || "", key_point: Boolean(selected.key_point) } : { title: "", body: "", key_point: false }); setDirty(false); }, [selected?.id]);
  function update(next) { setForm((current) => ({ ...current, ...next })); setDirty(true); }
  async function save() {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      const row = await crewService.saveDraftRecord("crew_sop_sections", { ...(selected ? { id: selected.id } : { sop_version_id: version.id, sort_order: sections.length + 1 }), title: form.title.trim(), body: form.body.trim(), key_point: form.key_point });
      await onRefresh();
      setSelectedId(row.id);
      setDirty(false);
    } finally { setBusy(false); }
  }
  async function move(direction) {
    const index = sections.findIndex((item) => item.id === selectedId);
    const other = sections[index + direction];
    if (!selected || !other) return;
    setBusy(true); try { await crewService.swapDraftOrder("crew_sop_sections", selected, other); await onRefresh(); } finally { setBusy(false); }
  }
  async function remove() {
    if (!selected || !window.confirm(`Delete “${selected.title}” from this draft?`)) return;
    setBusy(true); try { await crewService.deleteDraftRecord("crew_sop_sections", selected.id); await onRefresh(); } finally { setBusy(false); }
  }
  if (!version) return null;
  return <div className="crew-sop-editor-page">
    <button className="btn-ghost crew-sop-back" onClick={() => { if (!dirty || window.confirm("Leave without saving this section?")) onBack(); }}><ArrowLeft size={16} /> SOP Detail</button>
    <header className="crew-sop-editor-header"><div><div><Badge tone="warning">Draft v{version.version}</Badge><span className={dirty ? "is-dirty" : "is-saved"}>{dirty ? "Unsaved changes" : <><Check size={13} /> Saved</>}</span></div><h1>{sop.title}</h1><p>{outlet?.name}</p></div><div><button className="btn-secondary" onClick={() => setPreview(true)}>Preview</button><button className="btn-secondary" disabled={busy || !dirty || !form.title.trim()} onClick={save}>{busy ? "Saving…" : "Save Draft"}</button><button className="btn-primary" disabled={saving || dirty || !sections.length} onClick={() => onPublish(version)}>Publish v{version.version}</button></div></header>
    <div className="crew-sop-draft-workspace">
      <aside><div><strong>Section Outline</strong><span>{sections.length}</span></div>{sections.map((section, index) => <button key={section.id} className={selectedId === section.id ? "is-active" : ""} onClick={() => { if (!dirty || window.confirm("Discard unsaved section changes?")) setSelectedId(section.id); }}><span>{String(index + 1).padStart(2, "0")}</span><strong>{section.title}</strong><ChevronRight size={15} /></button>)}<button className="crew-sop-add-section" onClick={() => { if (!dirty || window.confirm("Discard unsaved section changes?")) setSelectedId("new"); }}><Plus size={15} /> Add Section</button></aside>
      <main><div className="crew-sop-editor-form-head"><div><span>{selected ? `Section ${sections.findIndex((item) => item.id === selected.id) + 1}` : "New section"}</span><h2>{selected ? selected.title : "Add a section"}</h2></div>{selected ? <div><button className="icon-btn" disabled={busy || sections[0]?.id === selected.id} onClick={() => move(-1)} aria-label="Move section up"><ArrowUp size={16} /></button><button className="icon-btn" disabled={busy || sections.at(-1)?.id === selected.id} onClick={() => move(1)} aria-label="Move section down"><ArrowDown size={16} /></button></div> : null}</div><label>Section Title *<input className="input" value={form.title} onChange={(event) => update({ title: event.target.value })} /></label><label>{form.key_point ? "Key Point Content" : "Content"}<textarea className="input min-h-56" value={form.body} onChange={(event) => update({ body: event.target.value })} /></label><label className="crew-sop-key-toggle"><input aria-label="Key Point" type="checkbox" checked={form.key_point} onChange={(event) => update({ key_point: event.target.checked })} /><span><strong>Key Point</strong><small>Present this section as a subtle operational callout.</small></span></label>{selected ? <div className="crew-sop-editor-footer"><button className="btn-ghost is-danger" disabled={busy} onClick={remove}><Trash2 size={15} /> Delete Section</button><span /></div> : null}</main>
    </div>
    {preview ? <Modal title={`${sop.title} · Preview`} description={`Draft v${version.version} · ${outlet?.name}`} size="xl" onClose={() => setPreview(false)} footer={<button className="btn-secondary" onClick={() => setPreview(false)}>Close Preview</button>}><PublishedDocument version={{ ...version, sections: sections.map((section) => section.id === selected?.id && dirty ? { ...section, ...form } : section) }} versions={[version]} onSelectVersion={() => {}} /></Modal> : null}
  </div>;
}

function SopTabs({ active, onChange }) { return <nav className="crew-sop-tabs" aria-label="SOP detail tabs">{["overview", "content", "versions", "usage"].map((tab) => <button key={tab} className={active === tab ? "is-active" : ""} onClick={() => onChange(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}</nav>; }

function VersionList({ versions, currentVersionNumber, canManage, onEdit, onView }) { return <section className="crew-sop-version-list"><header><h2>Versions</h2><p>Draft work and immutable published history.</p></header>{versions.map((version) => <article key={version.id}><div className="crew-sop-version-marker"><FileText size={16} /></div><div><div><strong>v{version.version}</strong><Badge tone={version.status === "published" ? "success" : version.status === "draft" ? "warning" : "neutral"}>{version.status}</Badge>{Number(currentVersionNumber) === Number(version.version) && version.status === "published" ? <span>Current Live</span> : null}</div><p>{version.status === "published" ? `Published ${formatDate(version.published_at)}` : `Updated ${formatDate(version.updated_at)}`}</p></div>{version.status === "draft" && canManage ? <button className="btn-secondary" onClick={() => onEdit(version.id)}>Continue Editing</button> : <button className="btn-secondary" onClick={() => onView(version.id)}>View</button>}</article>)}</section>; }

function UsageView({ sopId }) {
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; crewService.sopUsageAdmin(sopId).then((data) => active && setUsage(data)).catch((cause) => active && setError(cause.message)); return () => { active = false; }; }, [sopId]);
  if (error) return <div className="crew-sop-usage-message">Unable to load usage: {error}</div>;
  if (!usage) return <LibrarySkeleton />;
  return <section className="crew-sop-usage"><header><h2>Used In</h2><p>Current authoring references and frozen assignment history.</p></header><div><h3>Current Usage</h3>{usage.current?.length ? usage.current.map((item, index) => <article key={`${item.journey_id}-${item.lesson_title}-${index}`}><BookOpenCheck size={17} /><div><strong>{item.journey_name}</strong><p>{item.module_title} · {item.lesson_title}</p><small>Current onboarding v{item.journey_version}</small></div></article>) : <p className="crew-sop-usage-message">This SOP is not referenced by a current journey.</p>}</div><div><h3>Historical / Pinned Usage</h3>{usage.historical?.length ? usage.historical.map((item, index) => <article key={`${item.journey_name}-${item.journey_version}-${index}`}><FileText size={17} /><div><strong>{item.journey_name} v{item.journey_version}</strong><p>{item.assignment_count} assignment{Number(item.assignment_count) === 1 ? "" : "s"}</p><small>Pinned snapshot · unchanged by future SOP versions</small></div></article>) : <p className="crew-sop-usage-message">No historical assignment snapshots reference this SOP.</p>}</div></section>;
}

function CreateSopModal({ categories, saving, onClose, onCreate }) {
  const [values, setValues] = useState({ title: "", categoryId: categories[0]?.id || "__new__", newCategory: categories.length ? "" : "Other", summary: "", requireAcknowledgement: false });
  const valid = values.title.trim() && (values.categoryId !== "__new__" || values.newCategory.trim());
  return <Modal title="Create SOP" description="Create an editable draft for this outlet." size="md" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving || !valid} onClick={() => onCreate(values)}>{saving ? "Creating…" : "Create Draft"}</button></>}><div className="crew-sop-create-form"><label>Title *<input className="input" autoFocus value={values.title} onChange={(event) => setValues({ ...values, title: event.target.value })} /></label><label>Category *<select className="input" value={values.categoryId} onChange={(event) => setValues({ ...values, categoryId: event.target.value })}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}<option value="__new__">Create new category</option></select></label>{values.categoryId === "__new__" ? <label>New Category *<input className="input" value={values.newCategory} onChange={(event) => setValues({ ...values, newCategory: event.target.value })} /></label> : null}<label>Summary<textarea className="input min-h-24" value={values.summary} onChange={(event) => setValues({ ...values, summary: event.target.value })} /></label><label className="crew-sop-key-toggle"><input aria-label="Acknowledgement Required" type="checkbox" checked={values.requireAcknowledgement} onChange={(event) => setValues({ ...values, requireAcknowledgement: event.target.checked })} /><span><strong>Acknowledgement Required</strong><small>Crew must acknowledge the published version where required.</small></span></label></div></Modal>;
}

function CloneSopsModal({ targetOutlet, outlets, saving, onClose, onCloned }) {
  const [sourceOutletId, setSourceOutletId] = useState(outlets[0]?.id || "");
  const [sourceSops, setSourceSops] = useState([]);
  const [selected, setSelected] = useState([]);
  const [copyCategories, setCopyCategories] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!sourceOutletId) return; setLoading(true); setError(""); crewService.listOutletSopsAdmin(sourceOutletId).then((result) => { const published = (result.sops || []).filter((sop) => currentVersion(sop)); setSourceSops(published); setSelected(published.map((sop) => sop.id)); }).catch((cause) => setError(cause.message)).finally(() => setLoading(false)); }, [sourceOutletId]);
  async function clone() { setError(""); try { const result = await crewService.cloneSelectedSops({ sourceOutletId, targetOutletId: targetOutlet.id, sopIds: selected, copyCategories }); await onCloned(result); } catch (cause) { setError(cause.message); } }
  return <Modal title="Clone SOP Library" description="Choose published SOPs to copy as independent drafts." size="lg" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving || loading || !selected.length} onClick={clone}>{saving ? "Cloning…" : "Clone SOPs"}</button></>}><div className="crew-sop-clone-form"><label>Source Outlet<select className="input" value={sourceOutletId} onChange={(event) => setSourceOutletId(event.target.value)}>{outlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select></label><div className="crew-sop-clone-target"><span>Target</span><strong>{targetOutlet?.name || "—"}</strong></div><div className="crew-sop-clone-select"><header><div><strong>Select SOPs</strong><span>{selected.length} of {sourceSops.length} selected</span></div><button className="btn-ghost" onClick={() => setSelected(selected.length === sourceSops.length ? [] : sourceSops.map((sop) => sop.id))}>{selected.length === sourceSops.length ? "Clear all" : "Select all"}</button></header>{loading ? <p>Loading source SOPs…</p> : sourceSops.map((sop) => <label key={sop.id}><input aria-label={sop.title} type="checkbox" checked={selected.includes(sop.id)} onChange={() => setSelected((current) => current.includes(sop.id) ? current.filter((id) => id !== sop.id) : [...current, sop.id])} /><span><strong>{sop.title}</strong><small>{sop.category} · Published v{currentVersion(sop)?.version}</small></span></label>)}{!loading && !sourceSops.length ? <p>No published SOPs are available in this outlet.</p> : null}</div><label className="crew-sop-key-toggle"><input aria-label="Copy Categories" type="checkbox" checked={copyCategories} onChange={(event) => setCopyCategories(event.target.checked)} /><span><strong>Copy Categories</strong><small>Creates missing target categories for selected SOPs.</small></span></label><p className="crew-sop-clone-note">Creates independent copies. Future edits will not sync between outlets.</p>{error ? <p role="alert" className="text-sm font-semibold text-red-600">{error}</p> : null}</div></Modal>;
}

function LibrarySkeleton() { return <div className="crew-sop-library-skeleton" aria-live="polite"><span /><span /><span /><p>Loading SOP Library…</p></div>; }
