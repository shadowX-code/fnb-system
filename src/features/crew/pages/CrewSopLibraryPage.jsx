import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  Bold,
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  MoreHorizontal,
  Plus,
  Redo2,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { crewService } from "../../../services/crewService.js";
import { outletService } from "../../../services/outletService.js";
import { IMAGE_UPLOAD_ACCEPT, validateImageFile } from "../../../utils/imageUpload.js";
import { parseSopBody, sanitizeSopHtml, serializeSopBody } from "../utils/sopDocumentContent.js";

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
    if (!draft) return false;
    const hasPublished = Boolean(currentVersion(sop));
    const confirmed = await ui.confirm({
      title: hasPublished ? `Delete draft v${draft.version}?` : `Delete ${sop.title}?`,
      message: hasPublished ? "Only the editable draft is removed. The published SOP remains live and unchanged." : "This removes the unpublished SOP draft and its sections.",
      confirmLabel: "Delete Draft",
      tone: "danger",
    });
    if (!confirmed) return false;
    setSaving(true);
    try {
      await crewService.deleteDraftRecord(hasPublished ? "crew_sop_versions" : "crew_sops", hasPublished ? draft.id : sop.id);
      await refresh();
      ui.notify({ title: "SOP draft deleted" });
      return true;
    } catch (cause) {
      ui.notify({ title: "Unable to delete draft", message: cause.message, tone: "error" });
      return false;
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
    <div className="crew-sop-admin-shell crew-admin-page">
      <PageHeader
        section="Crew · Knowledge"
        title="SOP Library"
        description="Manage outlet procedures and employee knowledge."
        actions={<>
          <SelectField className="crew-sop-outlet-select" label="Outlet" ariaLabel="Outlet" value={outletId} onChange={setOutletId} options={outlets.map((item) => ({ value: item.id, label: item.name }))} />
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
        onEdit={(sop) => openEditor(sop.id, draftVersion(sop)?.id)}
        onCreate={() => setCreateOpen(true)}
        onClone={() => setCloneOpen(true)}
        onNewVersion={createVersion}
        onDeleteDraft={deleteDraft}
      />
      {view === "editor" && selectedSop ? (
        <SopEditor
          sop={selectedSop}
          outlet={outlet}
          version={(selectedSop.versions || []).find((version) => version.id === activeVersionId) || draftVersion(selectedSop)}
          saving={saving}
          onBack={() => setView("library")}
          onRefresh={refresh}
          onConfirm={ui.confirm}
          onPublish={(version) => publishVersion(selectedSop, version)}
          onDeleteDraft={async () => {
            const deleted = await deleteDraft(selectedSop);
            if (deleted) setView("library");
          }}
        />
      ) : view === "detail" && selectedSop ? (
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

function SopLibrary({ outlet, sops, categories, loading, canManage, onOpen, onEdit, onCreate, onClone, onNewVersion, onDeleteDraft }) {
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
  return <div className="crew-sop-library-sections">
    <section className="crew-sop-filter-card" aria-label="SOP filters"><div className="crew-sop-filterbar">
      <label className="crew-sop-search-control"><span>Search SOP</span><span className="crew-sop-search-field"><Search size={16} /><input aria-label="Search SOP" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SOP..." /></span></label>
      <SelectField label="Category" ariaLabel="Category" value={categoryId} onChange={setCategoryId} options={[{ value: "", label: "All" }, ...categories.map((category) => ({ value: category.id, label: category.name }))]} />
      <SelectField label="Status" ariaLabel="Status" value={status} onChange={setStatus} options={[{ value: "", label: "All" }, { value: "published", label: "Published" }, { value: "draft", label: "Draft" }]} />
      <SelectField label="Acknowledgement" ariaLabel="Acknowledgement" value={acknowledgement} onChange={setAcknowledgement} options={[{ value: "", label: "All" }, { value: "required", label: "Required" }, { value: "not_required", label: "Not required" }]} />
    </div></section>
    <section className="crew-sop-table-card" aria-label="SOP list">
    {rows.length ? <DataTable
      density="normal"
      tableClassName="min-w-[980px] table-fixed"
      rows={rows}
      getRowKey={(row) => row.id}
      onRowClick={(row) => onOpen(row.id)}
      columns={[
        { key: "sop", header: "SOP", width: "22%", render: (row) => <div className="crew-sop-title-cell"><FileText size={17} /><span><strong>{row.title}</strong><small>{row.summary || "Operational procedure"}</small></span></div> },
        { key: "category", header: "Category", width: "9%", render: (row) => row.category || "Other" },
        { key: "version", header: "Current Version", width: "9%", render: (row) => currentVersion(row) ? `v${currentVersion(row).version}` : "—" },
        { key: "status", header: "Status", width: "9%", render: (row) => currentVersion(row) ? <Badge tone="success">Published</Badge> : <Badge tone="warning">Draft</Badge> },
        { key: "draft", header: "Draft", width: "8%", render: (row) => draftVersion(row) ? <Badge tone="warning">Draft v{draftVersion(row).version}</Badge> : "—" },
        { key: "ack", header: "Acknowledgement", width: "13%", render: (row) => (draftVersion(row)?.require_acknowledgement ?? currentVersion(row)?.require_acknowledgement) ? "Required" : "Not required" },
        { key: "updated", header: "Last Updated", width: "10%", render: (row) => formatDate(row.updated_at) },
        { key: "actions", header: "Actions", width: "200px", align: "right", render: (row) => <SopRowActions row={row} canManage={canManage} onOpen={onOpen} onEdit={onEdit} onNewVersion={onNewVersion} onDeleteDraft={onDeleteDraft} /> },
      ]}
    /> : <div className="crew-sop-compact-empty"><EmptyState title={sops.length ? "No SOPs match these filters" : "No SOPs yet"} description={sops.length ? "Adjust the search or filter selection." : `Create SOPs for ${outlet?.name || "this outlet"} or clone an existing setup.`} />{!sops.length && canManage ? <div><button className="btn-primary" onClick={onCreate}>Create SOP</button><button className="btn-secondary" onClick={onClone}>Clone From Outlet</button></div> : null}</div>}
    </section>
  </div>;
}

function SopRowActions({ row, canManage, onOpen, onEdit, onNewVersion, onDeleteDraft }) {
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
  const published = currentVersion(row);
  const draft = draftVersion(row);
  return <div className="crew-sop-row-actions">
    <button className="btn-secondary crew-sop-compact-action" type="button" onClick={() => onOpen(row.id)}>View</button>
    {canManage && draft && !published ? <><button className="btn-secondary crew-sop-compact-action" type="button" onClick={() => onEdit(row)}>Edit</button><button className="btn-secondary crew-sop-compact-action is-danger" type="button" onClick={() => onDeleteDraft(row)}>Delete</button></> : null}
    {canManage && published && !draft ? <button className="btn-secondary crew-sop-compact-action" type="button" onClick={() => onNewVersion(row)}>New Version</button> : null}
    {canManage && published && draft ? <><button className="btn-secondary crew-sop-compact-action" type="button" onClick={() => onEdit(row)}>Edit Draft</button><button ref={buttonRef} className="icon-btn crew-sop-compact-more" aria-label={`More actions for ${row.title}`} aria-expanded={Boolean(menu)} type="button" onClick={toggleMenu}><MoreHorizontal size={16} /></button>{menu ? createPortal(<div className="crew-sop-more-menu" role="menu" style={menu}><button role="menuitem" className="is-danger" type="button" onClick={() => { setMenu(null); onDeleteDraft(row); }}>Delete Draft</button></div>, document.body) : null}</> : null}
  </div>;
}

function SopDetail({ sop, outlet, canManage, saving, preferredVersionId, onBack, onEdit, onNewVersion }) {
  const versions = byVersion(sop.versions);
  const published = currentVersion(sop);
  const draft = draftVersion(sop);
  const [viewVersionId, setViewVersionId] = useState(preferredVersionId || published?.id || draft?.id || "");
  const [pane, setPane] = useState("document");
  const active = versions.find((version) => version.id === viewVersionId) || published || draft;
  useEffect(() => { setViewVersionId(preferredVersionId || published?.id || draft?.id || ""); }, [sop.id, preferredVersionId, published?.id, draft?.id]);
  const lifecycleAction = canManage ? draft ? <button className="btn-primary" disabled={saving} onClick={() => onEdit(draft.id)}>Continue Editing Draft</button> : published ? <button className="btn-primary" disabled={saving} onClick={onNewVersion}>Create New Version</button> : null : null;
  const footer = <div className="crew-sop-modal-footer">
    <div>{pane === "document" ? <button className="btn-ghost" type="button" onClick={() => setPane("usage")}>View Usage</button> : <button className="btn-ghost" type="button" onClick={() => setPane("document")}>← Back to SOP</button>}</div>
    <div>{pane === "document" ? lifecycleAction : null}<button className="btn-secondary" type="button" onClick={onBack}>Close</button></div>
  </div>;
  return <Modal title={sop.title} description={`${sop.category || "Other"} · ${outlet?.name || "Outlet"}`} size="2xl" panelClassName="crew-sop-view-popout" bodyClassName="crew-sop-popout-body" onClose={onBack} footer={footer} footerClassName="block">
    {pane === "document" ? <><SopDocumentFacts sop={sop} outlet={outlet} version={active} versionControl={<VersionPicker versions={versions} activeId={active?.id} currentVersionNumber={sop.current_version} fallbackUpdatedAt={sop.updated_at} canManage={canManage} onEdit={onEdit} onSelect={setViewVersionId} />} /><PublishedDocument version={active} showOutline={false} /></> : null}
    {pane === "usage" ? <SecondaryView title="SOP Usage" description="Automatically derived from current onboarding references and pinned assignment snapshots." onBack={() => setPane("document")}><UsageView sopId={sop.id} /></SecondaryView> : null}
  </Modal>;
}

function SecondaryView({ title, description, onBack, backLabel = "Back to SOP", children }) {
  return <section className="crew-sop-secondary-view"><header><h2>{title}</h2><p>{description}</p></header>{children}</section>;
}

function SopDocumentFacts({ sop, outlet, version, versionControl }) {
  const details = [
    ["Category", sop.category || "Other"],
    ["Acknowledgement", version?.require_acknowledgement ? "Required" : "Not required"],
    ["Last Updated", formatDate(version?.published_at || version?.updated_at || sop.updated_at)],
    ["Outlet", outlet?.name || "—"],
  ];
  return <dl className="crew-sop-document-facts"><div className="crew-sop-version-fact"><dt>Version</dt><dd>{versionControl || (version ? `v${version.version}` : "—")}</dd></div>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function VersionPicker({ versions, activeId, currentVersionNumber, fallbackUpdatedAt, canManage, onEdit, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = versions.find((version) => version.id === activeId) || versions[0];
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (ref.current?.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", close); };
  }, [open]);
  if (!active) return "—";
  return <div className="crew-sop-version-picker" ref={ref}>
    <button type="button" aria-label="SOP version" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Badge tone={active.status === "published" ? "success" : "warning"}>{active.status === "published" ? "Published" : "Draft"} v{active.version}</Badge><ChevronDown size={14} /></button>
    {open ? <div className="crew-sop-version-popover" role="menu" aria-label="Version History"><header><strong>Version History</strong><button className="icon-btn" type="button" aria-label="Close version history" onClick={() => setOpen(false)}><X size={14} /></button></header>{versions.map((version) => <article key={version.id} className={version.id === active.id ? "is-active" : ""}><div><strong>v{version.version} · {version.status === "published" ? "Published" : "Draft"}</strong><span>{version.status === "draft" ? "Updated just now" : Number(currentVersionNumber) === Number(version.version) ? `Current Live · ${formatDate(version.published_at)}` : formatDate(version.published_at || fallbackUpdatedAt)}</span></div>{version.status === "draft" && canManage ? <button className="btn-secondary crew-sop-compact-action" onClick={() => { setOpen(false); onEdit(version.id); }}>Continue Editing</button> : <button className="btn-secondary crew-sop-compact-action" onClick={() => { onSelect(version.id); setOpen(false); }}>View</button>}</article>)}</div> : null}
  </div>;
}

function PublishedDocument({ version, showOutline = true }) {
  const sections = byOrder(version?.sections);
  const refs = useRef({});
  if (!version) return <div className="crew-sop-compact-empty"><EmptyState title="No SOP version" description="Create a draft version to start writing this SOP." /></div>;
  return <div className={`crew-sop-document-shell ${showOutline ? "" : "is-reader"}`}>
    {showOutline ? <aside><div><strong>Section navigation</strong><span>{sections.length}</span></div>{sections.map((section, index) => <button key={section.id} onClick={() => refs.current[section.id]?.scrollIntoView({ behavior: "smooth", block: "start" })}><span>{String(index + 1).padStart(2, "0")}</span>{section.title}</button>)}</aside> : null}
    <main><div className="crew-sop-document-meta"><div><Badge tone={version.status === "published" ? "success" : "warning"}>{version.status === "published" ? "Published" : "Draft preview"}</Badge><span>v{version.version}</span></div></div>{sections.length ? <article className="crew-sop-document">{sections.map((section, index) => { const content = parseSopBody(section.body, section.key_point); return <section key={section.id} ref={(node) => { refs.current[section.id] = node; }} tabIndex="-1"><div className="crew-sop-section-number">{String(index + 1).padStart(2, "0")}</div><h2>{section.title}</h2>{content.html ? <div className="crew-sop-rich-content" dangerouslySetInnerHTML={{ __html: content.html }} /> : null}{section.media_url ? <figure><img src={section.media_url} alt="" /></figure> : null}{content.keyPointContent ? <div className="crew-sop-key-point"><strong>Key Point</strong><p>{content.keyPointContent}</p></div> : null}</section>; })}</article> : <EmptyState title="No sections yet" description="This draft has no document content." />}</main>
  </div>;
}

const temporarySectionId = () => `temp:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
const hydrateSection = (section) => {
  const content = parseSopBody(section.body, section.key_point);
  return { ...section, editorHtml: content.html, keyPointContent: content.keyPointContent, pendingImage: null };
};

function SopEditor({ sop, outlet, version, saving, onBack, onRefresh, onConfirm, onPublish, onDeleteDraft }) {
  const initialSections = useMemo(() => byOrder(version?.sections).map(hydrateSection), [version?.id]);
  const originalIds = useRef(initialSections.map((section) => section.id));
  const [sections, setSections] = useState(initialSections);
  const [selectedId, setSelectedId] = useState(initialSections[0]?.id || "");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pane, setPane] = useState("edit");
  const [imageError, setImageError] = useState("");
  const selected = sections.find((section) => section.id === selectedId) || sections[0];
  const hasPendingImage = sections.some((section) => section.pendingImage);
  const valid = sections.length > 0 && sections.every((section) => section.title?.trim());
  useEffect(() => () => sections.forEach((section) => section.pendingImage?.url && URL.revokeObjectURL?.(section.pendingImage.url)), []);
  if (!version) return null;

  function updateSelected(next) {
    if (!selected) return;
    setSections((current) => current.map((section) => section.id === selected.id ? { ...section, ...next } : section));
    setDirty(true);
  }
  function addSection() {
    const id = temporarySectionId();
    setSections((current) => [...current, { id, title: "Untitled Section", editorHtml: "", keyPointContent: "", key_point: false, media_url: null, pendingImage: null }]);
    setSelectedId(id);
    setDirty(true);
  }
  function move(direction) {
    const index = sections.findIndex((section) => section.id === selected?.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    setSections(next);
    setDirty(true);
  }
  function remove() {
    if (!selected) return;
    const index = sections.findIndex((section) => section.id === selected.id);
    const next = sections.filter((section) => section.id !== selected.id);
    selected.pendingImage?.url && URL.revokeObjectURL?.(selected.pendingImage.url);
    setSections(next);
    setSelectedId(next[Math.min(index, next.length - 1)]?.id || "");
    setDirty(true);
  }
  function chooseImage(file) {
    try {
      validateImageFile(file);
      setImageError("");
      const url = URL.createObjectURL?.(file) || "";
      selected?.pendingImage?.url && URL.revokeObjectURL?.(selected.pendingImage.url);
      updateSelected({ pendingImage: { file, url, caption: "" } });
    } catch (cause) {
      setImageError(cause.message);
    }
  }
  async function save() {
    if (!valid || hasPendingImage) return false;
    setBusy(true);
    try {
      const payload = sections.map((section) => ({
        ...section,
        body: serializeSopBody(section.editorHtml, section.keyPointContent),
        key_point: Boolean(section.keyPointContent?.trim()),
      }));
      const saved = await crewService.saveSopDraftSections(version.id, payload, originalIds.current);
      const hydrated = byOrder(saved).map(hydrateSection);
      const selectedIndex = Math.max(0, sections.findIndex((section) => section.id === selectedId));
      originalIds.current = hydrated.map((section) => section.id);
      setSections(hydrated);
      setSelectedId(hydrated[selectedIndex]?.id || hydrated[0]?.id || "");
      setDirty(false);
      await onRefresh();
      return true;
    } finally { setBusy(false); }
  }
  async function requestClose() {
    if (!dirty) return onBack();
    const discard = await onConfirm({ title: "You have unsaved changes.", message: "Discard this draft session or continue editing?", confirmLabel: "Discard", cancelLabel: "Continue Editing", tone: "danger" });
    if (discard) onBack();
  }
  async function publish() {
    if (dirty && !(await save())) return;
    await onPublish({ ...version, sections: sections.map((section, index) => ({ ...section, sort_order: index + 1 })) });
  }
  const previewSections = sections.map((section, index) => ({ ...section, body: serializeSopBody(section.editorHtml, section.keyPointContent), key_point: Boolean(section.keyPointContent?.trim()), sort_order: index + 1 }));
  const footer = <div className="crew-sop-modal-footer">
    <div>{pane === "edit" ? <button className="btn-secondary" type="button" onClick={() => setPane("preview")}>Preview</button> : <button className="btn-ghost" type="button" onClick={() => setPane("edit")}>← Back to Editor</button>}</div>
    <div><button className="btn-secondary is-danger" disabled={busy || saving} onClick={onDeleteDraft}><Trash2 size={15} /> Delete Draft</button><button className="btn-primary" disabled={busy || !dirty || !valid || hasPendingImage} onClick={save}>{busy ? "Saving…" : "Save Draft"}</button><button className="btn-secondary" disabled={busy || saving || !valid || hasPendingImage} onClick={publish}>Publish</button></div>
  </div>;
  return <Modal title={sop.title} description={`Draft v${version.version} · ${outlet?.name}`} size="2xl" panelClassName="crew-sop-editor-popout" bodyClassName="crew-sop-editor-popout-body" onClose={requestClose} headerActions={<span className={`crew-sop-save-state ${dirty ? "is-dirty" : "is-saved"}`}>{dirty ? "Unsaved changes" : <><Check size={13} /> Saved</>}</span>} footer={footer} footerClassName="block">
    {pane === "edit" ? <div className="crew-sop-draft-workspace">
      <aside><div><strong>Section Outline</strong><span>{sections.length}</span></div>{sections.map((section, index) => <button key={section.id} className={selected?.id === section.id ? "is-active" : ""} onClick={() => setSelectedId(section.id)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{section.title || "Untitled Section"}</strong><ChevronRight size={15} /></button>)}<button className="crew-sop-add-section" onClick={addSection}><Plus size={15} /> Add Section</button></aside>
      <main>{selected ? <><div className="crew-sop-editor-form-head"><div><span>Section {sections.findIndex((item) => item.id === selected.id) + 1}</span><h2>{selected.title || "Untitled Section"}</h2></div><div><button className="icon-btn" disabled={sections[0]?.id === selected.id} onClick={() => move(-1)} aria-label="Move section up"><ArrowUp size={16} /></button><button className="icon-btn" disabled={sections.at(-1)?.id === selected.id} onClick={() => move(1)} aria-label="Move section down"><ArrowDown size={16} /></button><button className="icon-btn is-danger" disabled={sections.length === 1} onClick={remove} aria-label="Delete section"><Trash2 size={16} /></button></div></div><label>Section Title *<input className="control w-full" value={selected.title || ""} onChange={(event) => updateSelected({ title: event.target.value })} /></label><div className="crew-sop-editor-field"><span>Content</span><RichTextEditor value={selected.editorHtml} onChange={(editorHtml) => updateSelected({ editorHtml })} onImage={chooseImage} />{imageError ? <small role="alert" className="crew-sop-editor-error">{imageError}</small> : null}</div>{selected.pendingImage ? <div className="crew-sop-image-placeholder"><div>{selected.pendingImage.url ? <img src={selected.pendingImage.url} alt="Preview" /> : <ImagePlus size={28} />}</div><label>Image caption<input className="control w-full" value={selected.pendingImage.caption} onChange={(event) => updateSelected({ pendingImage: { ...selected.pendingImage, caption: event.target.value } })} /></label><button className="btn-secondary is-danger" type="button" onClick={() => { URL.revokeObjectURL?.(selected.pendingImage.url); updateSelected({ pendingImage: null }); }}>Remove Image</button><p>SOP media storage is not configured. This preview cannot be saved and no base64 data will be written.</p></div> : null}<label className="crew-sop-key-toggle"><input aria-label="Key Point" type="checkbox" checked={Boolean(selected.keyPointContent)} onChange={(event) => updateSelected({ keyPointContent: event.target.checked ? selected.keyPointContent || "Add the key point…" : "" })} /><span><strong>Key Point</strong><small>Add an optional callout below the normal section content.</small></span></label>{selected.keyPointContent ? <label>Key Point Content<textarea className="control min-h-24 w-full py-3" value={selected.keyPointContent} onChange={(event) => updateSelected({ keyPointContent: event.target.value })} /></label> : null}</> : <EmptyState title="Add the first section" description="Create a section to start this SOP draft." />}</main>
    </div> : <SecondaryView title={`Preview · v${version.version}`} description="Review every unsaved section before publishing." backLabel="Back to Editor" onBack={() => setPane("edit")}><PublishedDocument version={{ ...version, sections: previewSections }} showOutline={false} /></SecondaryView>}
  </Modal>;
}

function RichTextEditor({ value, onChange, onImage }) {
  const editorRef = useRef(null);
  const imageRef = useRef(null);
  const rangeRef = useRef(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  useEffect(() => { if (editorRef.current && editorRef.current.innerHTML !== value) editorRef.current.innerHTML = value || ""; }, [value]);
  function emit() { onChange(sanitizeSopHtml(editorRef.current?.innerHTML || "")); }
  function rememberSelection() {
    const selection = window.getSelection?.();
    if (selection?.rangeCount && editorRef.current?.contains(selection.anchorNode)) rangeRef.current = selection.getRangeAt(0).cloneRange();
  }
  function command(name, argument = null) {
    editorRef.current?.focus();
    if (rangeRef.current) {
      const selection = window.getSelection?.();
      selection?.removeAllRanges();
      selection?.addRange(rangeRef.current);
    }
    document.execCommand?.(name, false, argument);
    emit();
  }
  function addLink() {
    if (linkValue.trim()) command("createLink", linkValue.trim());
    setLinkOpen(false);
    setLinkValue("");
  }
  const tools = [
    ["Bold", Bold, () => command("bold")], ["Italic", Italic, () => command("italic")], ["Highlight", Highlighter, () => command("hiliteColor", "#fff1a8")],
    ["Bullet List", List, () => command("insertUnorderedList")], ["Numbered List", ListOrdered, () => command("insertOrderedList")], ["Link", Link2, () => { rememberSelection(); setLinkOpen((open) => !open); }],
    ["Image", ImagePlus, () => imageRef.current?.click()], ["Undo", Undo2, () => command("undo")], ["Redo", Redo2, () => command("redo")],
  ];
  return <div className="crew-sop-rich-editor"><div className="crew-sop-rich-toolbar" role="toolbar" aria-label="Content formatting">{tools.map(([label, Icon, action]) => <button key={label} type="button" aria-label={label} title={label} onMouseDown={(event) => event.preventDefault()} onClick={action}><Icon size={15} /></button>)}<input ref={imageRef} className="sr-only" type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) onImage(file); event.target.value = ""; }} /></div>{linkOpen ? <div className="crew-sop-link-editor"><input className="control" aria-label="Link URL" placeholder="https://example.com" value={linkValue} onChange={(event) => setLinkValue(event.target.value)} /><button className="btn-secondary crew-sop-compact-action" type="button" onClick={addLink}>Apply Link</button><button className="btn-ghost" type="button" onClick={() => setLinkOpen(false)}>Cancel</button></div> : null}<div ref={editorRef} className="crew-sop-rich-surface" contentEditable role="textbox" aria-label="Content" aria-multiline="true" data-placeholder="Write the section content…" onInput={emit} onBlur={emit} onMouseUp={rememberSelection} onKeyUp={rememberSelection} suppressContentEditableWarning /></div>;
}

function UsageView({ sopId }) {
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; crewService.sopUsageAdmin(sopId).then((data) => active && setUsage(data)).catch((cause) => active && setError(cause.message)); return () => { active = false; }; }, [sopId]);
  if (error) return <div className="crew-sop-usage-message">Unable to load usage: {error}</div>;
  if (!usage) return <LibrarySkeleton />;
  return <section className="crew-sop-usage"><div><h3>Used in Onboarding</h3>{usage.current?.length ? usage.current.map((item, index) => <article key={`${item.journey_id}-${item.lesson_title}-${index}`}><BookOpenCheck size={17} /><div><strong>{item.lesson_title}</strong><p>{item.journey_name} · {item.module_title}</p><small>Current onboarding v{item.journey_version}</small></div></article>) : <p className="crew-sop-usage-message">This SOP is not used in current onboarding content.</p>}</div><div><h3>Historical reference</h3>{usage.historical?.length ? usage.historical.map((item, index) => <article key={`${item.journey_name}-${item.journey_version}-${index}`}><FileText size={17} /><div><strong>{item.journey_name} v{item.journey_version}</strong><p>{item.assignment_count} pinned assignment{Number(item.assignment_count) === 1 ? "" : "s"}</p><small>Historical snapshot · unchanged by future SOP versions</small></div></article>) : <p className="crew-sop-usage-message">No historical onboarding snapshot references this SOP.</p>}</div></section>;
}

function CreateSopModal({ categories, saving, onClose, onCreate }) {
  const [values, setValues] = useState({ title: "", categoryId: categories[0]?.id || "__new__", newCategory: categories.length ? "" : "Other", summary: "", requireAcknowledgement: false });
  const valid = values.title.trim() && (values.categoryId !== "__new__" || values.newCategory.trim());
  return <Modal title="Create SOP" description="Create an editable draft for this outlet." size="md" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving || !valid} onClick={() => onCreate(values)}>{saving ? "Creating…" : "Create Draft"}</button></>}><div className="crew-sop-create-form"><label>Title *<input className="control w-full" autoFocus value={values.title} onChange={(event) => setValues({ ...values, title: event.target.value })} /></label><SelectField label="Category" ariaLabel="Category" required value={values.categoryId} onChange={(categoryId) => setValues({ ...values, categoryId })} options={[...categories.map((category) => ({ value: category.id, label: category.name })), { value: "__new__", label: "Create new category" }]} />{values.categoryId === "__new__" ? <label>New Category *<input className="control w-full" value={values.newCategory} onChange={(event) => setValues({ ...values, newCategory: event.target.value })} /></label> : null}<label>Summary<textarea className="control min-h-24 w-full py-3" value={values.summary} onChange={(event) => setValues({ ...values, summary: event.target.value })} /></label><label className="crew-sop-key-toggle"><input aria-label="Acknowledgement Required" type="checkbox" checked={values.requireAcknowledgement} onChange={(event) => setValues({ ...values, requireAcknowledgement: event.target.checked })} /><span><strong>Acknowledgement Required</strong><small>Crew must acknowledge the published version where required.</small></span></label></div></Modal>;
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
  return <Modal title="Clone SOP Library" description="Choose published SOPs to copy as independent drafts." size="lg" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving || loading || !selected.length} onClick={clone}>{saving ? "Cloning…" : "Clone SOPs"}</button></>}><div className="crew-sop-clone-form"><SelectField label="Source Outlet" ariaLabel="Source Outlet" value={sourceOutletId} onChange={setSourceOutletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} /><div className="crew-sop-clone-target"><span>Target</span><strong>{targetOutlet?.name || "—"}</strong></div><div className="crew-sop-clone-select"><header><div><strong>Select SOPs</strong><span>{selected.length} of {sourceSops.length} selected</span></div><button className="btn-ghost" onClick={() => setSelected(selected.length === sourceSops.length ? [] : sourceSops.map((sop) => sop.id))}>{selected.length === sourceSops.length ? "Clear all" : "Select all"}</button></header>{loading ? <p>Loading source SOPs…</p> : sourceSops.map((sop) => <label key={sop.id}><input aria-label={sop.title} type="checkbox" checked={selected.includes(sop.id)} onChange={() => setSelected((current) => current.includes(sop.id) ? current.filter((id) => id !== sop.id) : [...current, sop.id])} /><span><strong>{sop.title}</strong><small>{sop.category} · Published v{currentVersion(sop)?.version}</small></span></label>)}{!loading && !sourceSops.length ? <p>No published SOPs are available in this outlet.</p> : null}</div><label className="crew-sop-key-toggle"><input aria-label="Copy Categories" type="checkbox" checked={copyCategories} onChange={(event) => setCopyCategories(event.target.checked)} /><span><strong>Copy Categories</strong><small>Creates missing target categories for selected SOPs.</small></span></label><p className="crew-sop-clone-note">Creates independent copies. Future edits will not sync between outlets.</p>{error ? <p role="alert" className="text-sm font-semibold text-red-600">{error}</p> : null}</div></Modal>;
}

function LibrarySkeleton() { return <div className="crew-sop-library-skeleton" aria-live="polite"><span /><span /><span /><p>Loading SOP Library…</p></div>; }
