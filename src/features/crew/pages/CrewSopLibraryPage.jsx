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
  FolderCog,
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
  Star,
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
import FloatingLayer from "../../../components/ui/FloatingLayer.jsx";
import CrewSopImage from "../components/CrewSopImage.jsx";
import CrewSopDocument from "../components/CrewSopDocument.jsx";
import { crewService } from "../../../services/crewService.js";
import { IMAGE_UPLOAD_ACCEPT, validateImageFile } from "../../../utils/imageUpload.js";
import { parseSopBody, sanitizeSopHtml, serializeSopBody } from "../utils/sopDocumentContent.js";
import CrewAdminToolbar, { CrewAdminOutletField } from "../components/CrewAdminToolbar.jsx";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";
import LocalizedContentEditor from "../components/LocalizedContentEditor.jsx";
import { detectContentLanguage, localizationLanguageSummary, sopLocalizationUnits } from "../utils/localizedContent.js";

const byOrder = (rows = []) => [...rows].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
const byVersion = (rows = []) => [...rows].sort((a, b) => Number(b.version) - Number(a.version));
const formatDate = (value) => value ? new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—";
const currentVersion = (sop) => (sop?.versions || []).find((version) => version.status === "published" && Number(version.version) === Number(sop.current_version)) || byVersion(sop?.versions).find((version) => version.status === "published");
const draftVersion = (sop) => byVersion(sop?.versions).find((version) => version.status === "draft");

export default function CrewSopLibraryPage({ auth, ui, store }) {
  const canManage = auth.hasPermission("crew_sop.manage");
  const { outlets, outletId, setOutletId } = useCrewAdminOutlet(store?.outlets || []);
  const [sops, setSops] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedSopDetail, setSelectedSopDetail] = useState(null);
  const [view, setView] = useState("library");
  const [selectedId, setSelectedId] = useState("");
  const [activeVersionId, setActiveVersionId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [usageSop, setUsageSop] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const refreshSequence = useRef(0);
  const detailSequence = useRef(0);
  const selectedSopSummary = sops.find((sop) => sop.id === selectedId);
  const selectedSop = selectedSopDetail?.id === selectedId ? selectedSopDetail : selectedSopSummary;
  const outlet = outlets.find((item) => item.id === outletId);

  async function refresh(targetOutletId = outletId) {
    if (!targetOutletId) return;
    const sequence = ++refreshSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const result = await crewService.listOutletSopsAdmin(targetOutletId);
      if (sequence !== refreshSequence.current) return;
      setSops(result.sops || []);
      setCategories(result.categories || []);
      setSelectedId((current) => result.sops?.some((sop) => sop.id === current) ? current : "");
      void crewService.resumeSopMediaCleanup(targetOutletId).catch((cleanupError) => {
        ui.notify({ title: "SOP image cleanup needs attention", message: cleanupError.message, tone: "warning" });
      });
      return result;
    } catch (cause) {
      if (sequence !== refreshSequence.current) return;
      setSops([]);
      setCategories([]);
      setLoadError(cause.message || "The SOP Library request failed.");
      ui.notify({ title: "Unable to load SOP Library", message: cause.message, tone: "error" });
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    setSelectedSopDetail(null);
    setSelectedId("");
    setView("library");
    setLoadError("");
    refresh(outletId);
  }, [outletId]);

  async function openSop(sopId, nextView, versionId = "") {
    const sequence = ++detailSequence.current;
    setSelectedId(sopId);
    setActiveVersionId(versionId);
    setDetailLoading(true);
    setView(nextView);
    try {
      const detail = await crewService.getSopAdmin(sopId);
      if (sequence !== detailSequence.current) return;
      setSelectedSopDetail(detail);
      if (!versionId && nextView === "editor") setActiveVersionId(draftVersion(detail)?.id || "");
    } catch (cause) {
      if (sequence !== detailSequence.current) return;
      setView("library");
      ui.notify({ title: "Unable to load SOP content", message: cause.message, tone: "error" });
    } finally {
      if (sequence === detailSequence.current) setDetailLoading(false);
    }
  }

  const openDetail = (sopId, versionId = "") => openSop(sopId, "detail", versionId);
  const openEditor = (sopId, versionId = "") => openSop(sopId, "editor", versionId);

  async function createSop(values, sections = [], publishAfterSave = false) {
    setSaving(true);
    try {
      const category = categories.find((item) => item.id === values.categoryId);
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
      const sectionPayload = [];
      for (const [index, section] of sections.entries()) {
        let media = null;
        if (section.pendingImage?.file) {
          const uploaded = await crewService.uploadSopMedia(section.pendingImage.file, versionId);
          media = { ...uploaded.media, caption: section.pendingImage.caption || null };
        }
        sectionPayload.push({
          ...section,
          id: section.id,
          sort_order: index + 1,
          body: serializeSopBody(section.editorHtml, section.keyPointContent),
          key_point: Boolean(section.keyPointContent?.trim()),
          media,
        });
      }
      const savedSections = sectionPayload.length ? await crewService.saveSopDraftSections(versionId, sectionPayload, [], []) : [];
      await crewService.saveLocalizedContentUnits("sop", versionId, sopLocalizationUnits(sop, { id: versionId }, savedSections, detectContentLanguage(values.title)));
      await refresh();
      setCreateOpen(false);
      if (publishAfterSave) {
        await publishVersion({ ...sop, versions: [{ id: versionId, version: 1, status: "draft", require_acknowledgement: values.requireAcknowledgement, sections: sectionPayload }] }, { id: versionId, version: 1, status: "draft", require_acknowledgement: values.requireAcknowledgement, sections: sectionPayload });
      } else {
        await openEditor(sop.id, versionId);
        ui.notify({ title: "SOP draft saved", message: "The complete draft is ready for review or publishing." });
      }
    } catch (cause) {
      ui.notify({ title: "Unable to create SOP", message: cause.message, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function createVersion(sop) {
    setSaving(true);
    try {
      const versionId = await crewService.newSopVersion(sop.id, currentVersion(sop)?.id || null);
      await refresh();
      await openEditor(sop.id, versionId);
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
    let languageSummary = "Language status unavailable";
    try { languageSummary = localizationLanguageSummary(await crewService.localizedContentAdmin("sop", version.id)); } catch { /* Publish authority remains the final validation boundary. */ }
    const confirmed = await ui.confirm({
      title: `Publish SOP v${version.version}?`,
      message: `${version.sections?.length || 0} sections · ${version.require_acknowledgement ? "Acknowledgement required" : "No acknowledgement required"} · ${outlet?.name}. ${languageSummary}. After publishing, v${version.version} becomes read only and existing pinned onboarding snapshots remain unchanged.`,
      confirmLabel: `Publish v${version.version}`,
      tone: "success",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await crewService.publishSopVersion(version.id);
      await refresh();
      await openDetail(sop.id, version.id);
      ui.notify({ title: `SOP v${version.version} published`, message: "Future changes now require a new version." });
    } catch (cause) {
      ui.notify({ title: "Unable to publish SOP", message: cause.message, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="crew-sop-admin-shell crew-admin-page">
      <PageHeader section="Crew · Knowledge" title="SOP Library" description="Manage outlet procedures and employee knowledge." />
      <SopLibrary
        outletControl={<CrewAdminOutletField value={outletId} onChange={setOutletId} options={outlets.map((item) => ({ value: item.id, label: item.name }))} />}
        outlet={outlet}
        sops={sops}
        categories={categories}
        loading={loading}
        error={loadError}
        onRetry={() => refresh(outletId)}
        canManage={canManage}
        onOpen={openDetail}
        onEdit={(sop) => openEditor(sop.id, draftVersion(sop)?.id)}
        onCreate={() => setCreateOpen(true)}
        onManageCategories={() => setCategoriesOpen(true)}
        onUsage={setUsageSop}
        onNewVersion={createVersion}
        onDeleteDraft={deleteDraft}
      />
      {detailLoading && selectedSopSummary ? <SopDetailLoading sop={selectedSopSummary} onClose={() => setView("library")} /> : null}
      {!detailLoading && view === "editor" && selectedSop ? (
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
      ) : !detailLoading && view === "detail" && selectedSop ? (
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
      {createOpen ? <CreateSopModal categories={categories} targetOutlet={outlet} sourceOutlets={outlets.filter((item) => item.id !== outletId)} saving={saving} onClose={() => setCreateOpen(false)} onCreate={createSop} onCloned={async (result) => { setCreateOpen(false); await refresh(); ui.notify({ title: "SOP cloned as an independent draft", message: `${result.sops_cloned} SOP cloned · published history remains separate.` }); }} /> : null}
      {categoriesOpen ? <CategoryManager outlet={outlet} categories={categories} saving={saving} onClose={() => setCategoriesOpen(false)} onChanged={() => refresh()} ui={ui} /> : null}
      {usageSop ? <SopUsageModal sop={usageSop} onClose={() => setUsageSop(null)} /> : null}
    </div>
  );
}

function SopLibrary({ outletControl, outlet, sops, categories, loading, error, onRetry, canManage, onOpen, onEdit, onCreate, onManageCategories, onUsage, onNewVersion, onDeleteDraft }) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [categorySort, setCategorySort] = useState("asc");
  const rows = useMemo(() => sops.filter((sop) => {
    const published = currentVersion(sop);
    const draft = draftVersion(sop);
    const lifecycle = draft ? "draft" : published ? "published" : sop.status;
    return (!query || `${sop.title} ${sop.summary || ""}`.toLowerCase().includes(query.toLowerCase()))
      && (!categoryId || sop.category_id === categoryId)
      && (!status || lifecycle === status);
  }).sort((left, right) => {
    const result = String(left.category || "").localeCompare(String(right.category || "")) || String(left.title).localeCompare(String(right.title));
    return categorySort === "asc" ? result : -result;
  }), [sops, query, categoryId, status, categorySort]);

  if (loading) return <LibrarySkeleton />;
  if (error) return <section className="crew-sop-table-card" role="alert"><div className="crew-sop-compact-empty"><EmptyState title="Unable to load SOP Library" description="The SOP list request failed. Retry to load the outlet library." /><button className="btn-primary" type="button" onClick={onRetry}>Retry</button></div></section>;
  return <div className="crew-sop-library-sections">
    <CrewAdminToolbar ariaLabel="SOP filters" outlet={outletControl} search={<label className="crew-sop-search-control"><span>Search SOP</span><span className="crew-sop-search-field"><Search size={16} /><input aria-label="Search SOP" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SOP..." /></span></label>} filters={<><SelectField label="Category" ariaLabel="Category" value={categoryId} onChange={setCategoryId} options={[{ value: "", label: "All" }, ...categories.map((category) => ({ value: category.id, label: category.name }))]} /><SelectField label="Status" ariaLabel="Status" value={status} onChange={setStatus} options={[{ value: "", label: "All" }, { value: "published", label: "Published" }, { value: "draft", label: "Draft" }]} /></>} secondary={canManage ? <button className="btn-secondary" type="button" onClick={onManageCategories}><FolderCog size={15} /> Manage Categories</button> : null} primary={canManage ? <button className="btn-primary" type="button" onClick={onCreate}><Plus size={15} /> Create SOP</button> : null} />
    <section className="crew-sop-table-card" aria-label="SOP list">
    {rows.length ? <DataTable
      density="normal"
      tableClassName="min-w-[1040px] table-fixed"
      rows={rows}
      getRowKey={(row) => row.id}
      onRowClick={(row) => onOpen(row.id)}
      columns={[
        { key: "sop", header: "SOP", width: "22%", render: (row) => <div className="crew-sop-title-cell"><FileText size={17} /><span><strong>{row.title}</strong><small>{row.summary || "Operational procedure"}</small></span></div> },
        { key: "category", header: <button className="crew-sop-sort" type="button" onClick={() => setCategorySort((value) => value === "asc" ? "desc" : "asc")}>Category {categorySort === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}</button>, width: "11%", render: (row) => row.category || "Other" },
        { key: "version", header: "Version", width: "8%", render: (row) => currentVersion(row) ? `v${currentVersion(row).version}` : draftVersion(row) ? `Draft v${draftVersion(row).version}` : "—" },
        { key: "ack", header: "Acknowledgement", width: "12%", render: (row) => (draftVersion(row)?.require_acknowledgement ?? currentVersion(row)?.require_acknowledgement) ? <Badge tone="warning">Required</Badge> : "Not required" },
        { key: "usage", header: "Usage", width: "14%", render: (row) => <button className="crew-sop-usage-link" type="button" onClick={() => onUsage(row)}>{Number(row.current_onboarding_count || 0)} Onboarding · {Number(row.pinned_assignment_count || 0)} Assigned</button> },
        { key: "updated", header: "Last Updated", width: "10%", render: (row) => formatDate(row.updated_at) },
        { key: "status", header: "Status", width: "12%", render: (row) => currentVersion(row) && draftVersion(row) ? <span className="crew-sop-status-stack"><Badge tone="success">Published</Badge><small>Draft changes</small></span> : currentVersion(row) ? <Badge tone="success">Published</Badge> : <Badge tone="warning">Draft</Badge> },
        { key: "actions", header: "", width: "190px", align: "right", render: (row) => <SopRowActions row={row} canManage={canManage} onOpen={onOpen} onEdit={onEdit} onNewVersion={onNewVersion} onDeleteDraft={onDeleteDraft} /> },
      ]}
    /> : <div className="crew-sop-compact-empty"><EmptyState title={sops.length ? "No SOPs match these filters" : "No SOPs yet"} description={sops.length ? "Adjust the search or filter selection." : `Create the first SOP for ${outlet?.name || "this outlet"}. You can start blank or clone an existing SOP.`} />{!sops.length && canManage ? <div><button className="btn-primary" onClick={onCreate}>Create SOP</button></div> : null}</div>}
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
  const active = versions.find((version) => version.id === viewVersionId) || published || draft;
  useEffect(() => { setViewVersionId(preferredVersionId || published?.id || draft?.id || ""); }, [sop.id, preferredVersionId, published?.id, draft?.id]);
  const lifecycleAction = canManage ? draft ? <button className="btn-primary" disabled={saving} onClick={() => onEdit(draft.id)}>Continue Editing Draft</button> : published ? <button className="btn-primary" disabled={saving} onClick={onNewVersion}>Create New Version</button> : null : null;
  const footer = <div className="crew-sop-modal-footer">
    <div />
    <div>{lifecycleAction}<button className="btn-secondary" type="button" onClick={onBack}>Close</button></div>
  </div>;
  return <Modal title={sop.title} description={`${sop.category || "Other"} · ${outlet?.name || "Outlet"}`} size="2xl" panelClassName="crew-sop-view-popout" bodyClassName="crew-sop-popout-body" onClose={onBack} footer={footer} footerClassName="block">
    <SopDocumentFacts sop={sop} outlet={outlet} version={active} versionControl={<VersionPicker versions={versions} activeId={active?.id} currentVersionNumber={sop.current_version} fallbackUpdatedAt={sop.updated_at} canManage={canManage} onEdit={onEdit} onSelect={setViewVersionId} />} /><PublishedDocument version={active} showOutline={false} />
  </Modal>;
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
  const anchorRef = useRef(null);
  const active = versions.find((version) => version.id === activeId) || versions[0];
  if (!active) return "—";
  return <div className="crew-sop-version-picker">
    <button ref={anchorRef} type="button" aria-label="SOP version" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Badge tone={active.status === "published" ? "success" : "warning"}>{active.status === "published" ? "Published" : "Draft"} v{active.version}</Badge><ChevronDown size={14} /></button>
    <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="start" width={390} minWidth={280} estimatedHeight={Math.min(330, 54 + versions.length * 58)} maxHeight={420} placement="auto" className="crew-sop-version-popover p-0" contentClassName="crew-sop-version-popover-content">
      <div role="menu" aria-label="Version History"><header><strong>Version History</strong><button className="icon-btn" type="button" aria-label="Close version history" onClick={() => setOpen(false)}><X size={14} /></button></header>{versions.map((version) => <article key={version.id} className={version.id === active.id ? "is-active" : ""}><div><strong>v{version.version} · {version.status === "published" ? "Published" : "Draft"}</strong><span>{version.status === "draft" ? "Updated just now" : Number(currentVersionNumber) === Number(version.version) ? `Current Live · ${formatDate(version.published_at)}` : formatDate(version.published_at || fallbackUpdatedAt)}</span></div>{version.status === "draft" && canManage ? <button className="btn-secondary crew-sop-compact-action" onClick={() => { setOpen(false); onEdit(version.id); }}>Continue Editing</button> : <button className="btn-secondary crew-sop-compact-action" onClick={() => { onSelect(version.id); setOpen(false); }}>View</button>}</article>)}</div>
    </FloatingLayer>
  </div>;
}

function PublishedDocument({ version, showOutline = true }) {
  const sections = byOrder(version?.sections);
  const refs = useRef({});
  if (!version) return <div className="crew-sop-compact-empty"><EmptyState title="No SOP version" description="Create a draft version to start writing this SOP." /></div>;
  return <div className={`crew-sop-document-shell ${showOutline ? "" : "is-reader"}`}>
    {showOutline ? <aside><div><strong>Section navigation</strong><span>{sections.length}</span></div>{sections.map((section, index) => <button key={section.id} onClick={() => refs.current[section.id]?.scrollIntoView({ behavior: "smooth", block: "start" })}><span>{String(index + 1).padStart(2, "0")}</span>{section.title}</button>)}</aside> : null}
    <main className={showOutline ? "" : "crew-sop-document-scroll"}><div className="crew-sop-document-meta"><div><Badge tone={version.status === "published" ? "success" : "warning"}>{version.status === "published" ? "Published" : "Draft preview"}</Badge><span>v{version.version}</span></div></div><CrewSopDocument sections={sections} admin sectionRefs={refs} /></main>
  </div>;
}

const temporarySectionId = () => `temp:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
const hydrateSection = (section) => {
  const content = parseSopBody(section.body, section.key_point);
  return { ...section, editorHtml: content.html, keyPointContent: content.keyPointContent, media: section.media || (section.media_id ? { id: section.media_id, caption: section.media_caption } : null), pendingImage: null };
};

function SopEditor({ sop, outlet, version, saving, onBack, onRefresh, onConfirm, onPublish, onDeleteDraft }) {
  const initialSections = useMemo(() => byOrder(version?.sections).map(hydrateSection), [version?.id]);
  const originalIds = useRef(initialSections.map((section) => section.id));
  const originalMediaIds = useRef(initialSections.map((section) => section.media?.id).filter(Boolean));
  const [sections, setSections] = useState(initialSections);
  const [selectedId, setSelectedId] = useState(initialSections[0]?.id || "");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pane, setPane] = useState("edit");
  const [imageError, setImageError] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState(() => detectContentLanguage(sop.title));
  const selected = sections.find((section) => section.id === selectedId) || sections[0];
  const hasPendingImage = sections.some((section) => section.pendingImage || section.uploadingImage);
  const valid = sections.length > 0 && sections.every((section) => section.title?.trim());
  useEffect(() => () => sections.forEach((section) => section.pendingImage?.url && URL.revokeObjectURL?.(section.pendingImage.url)), []);
  if (!version) return null;

  function updateSelected(next) {
    if (!selected) return;
    updateSection(selected.id, next);
  }
  function updateSection(sectionId, next) {
    setSections((current) => current.map((section) => section.id === sectionId ? { ...section, ...next } : section));
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
  async function remove() {
    if (!selected) return;
    const index = sections.findIndex((section) => section.id === selected.id);
    const next = sections.filter((section) => section.id !== selected.id);
    selected.pendingImage?.url && URL.revokeObjectURL?.(selected.pendingImage.url);
    if (selected.media?.id && !originalMediaIds.current.includes(selected.media.id)) {
      try { await crewService.deleteSopMedia(selected.media.id); } catch (cause) { setImageError(cause.message); }
    }
    setSections(next);
    setSelectedId(next[Math.min(index, next.length - 1)]?.id || "");
    setDirty(true);
  }
  async function chooseImage(file) {
    const sectionId = selected?.id;
    const caption = selected?.media?.caption || "";
    if (!sectionId) return;
    try {
      validateImageFile(file);
      setImageError("");
      const url = URL.createObjectURL?.(file) || "";
      selected?.pendingImage?.url && URL.revokeObjectURL?.(selected.pendingImage.url);
      updateSection(sectionId, { pendingImage: { file, url, caption }, uploadingImage: true });
      const uploaded = await crewService.uploadSopMedia(file, version.id);
      URL.revokeObjectURL?.(url);
      const previousMediaId = selected?.media?.id;
      updateSection(sectionId, { media: { ...uploaded.media, previewUrl: uploaded.previewUrl, caption }, pendingImage: null, uploadingImage: false });
      if (previousMediaId && !originalMediaIds.current.includes(previousMediaId)) await crewService.deleteSopMedia(previousMediaId);
    } catch (cause) {
      setImageError(cause.message);
      updateSection(sectionId, { pendingImage: null, uploadingImage: false });
    }
  }
  async function removeSelectedImage() {
    if (!selected?.media?.id) return;
    const mediaId = selected.media.id;
    updateSelected({ media: null, pendingImage: null });
    if (!originalMediaIds.current.includes(mediaId)) {
      try { await crewService.deleteSopMedia(mediaId); } catch (cause) { setImageError(cause.message); }
    }
  }
  async function save() {
    if (!valid || hasPendingImage) return false;
    setBusy(true);
    try {
      const payload = sections.map((section) => ({
        ...section,
        media: section.media?.id ? {
          id: section.media.id,
          mime_type: section.media.mime_type,
          width: section.media.width || null,
          height: section.media.height || null,
          caption: section.media.caption || null,
        } : null,
        body: serializeSopBody(section.editorHtml, section.keyPointContent),
        key_point: Boolean(section.keyPointContent?.trim()),
      }));
      const saved = await crewService.saveSopDraftSections(version.id, payload, originalIds.current, originalMediaIds.current);
      const hydrated = byOrder(saved).map(hydrateSection);
      await crewService.saveLocalizedContentUnits("sop", version.id, sopLocalizationUnits(sop, version, hydrated, sourceLanguage));
      const selectedIndex = Math.max(0, sections.findIndex((section) => section.id === selectedId));
      originalIds.current = hydrated.map((section) => section.id);
      originalMediaIds.current = hydrated.map((section) => section.media?.id).filter(Boolean);
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
    if (discard) {
      const originalMedia = new Set(originalMediaIds.current);
      for (const section of sections) {
        if (section.media?.id && !originalMedia.has(section.media.id)) {
          try { await crewService.deleteSopMedia(section.media.id); } catch { /* Server cleanup remains reference safe. */ }
        }
      }
      onBack();
    }
  }
  async function publish() {
    if (dirty && !(await save())) return;
    await onPublish({ ...version, sections: sections.map((section, index) => ({ ...section, sort_order: index + 1 })) });
  }
  const previewSections = sections.map((section, index) => ({ ...section, body: serializeSopBody(section.editorHtml, section.keyPointContent), key_point: Boolean(section.keyPointContent?.trim()), sort_order: index + 1 }));
  const localizationUnits = sopLocalizationUnits(sop, version, sections, sourceLanguage);
  const footer = <div className="crew-sop-modal-footer">
    <div className="flex gap-2">{pane !== "edit" ? <button className="btn-ghost" type="button" onClick={() => setPane("edit")}>← Back to Editor</button> : <button className="btn-secondary" type="button" onClick={() => setPane("preview")}>Preview</button>}<button className="btn-secondary" type="button" onClick={() => setPane("languages")}>Languages</button></div>
    <div><button className="btn-secondary is-danger" disabled={busy || saving} onClick={onDeleteDraft}><Trash2 size={15} /> Delete Draft</button><button className="btn-primary" disabled={busy || !dirty || !valid || hasPendingImage} onClick={save}>{busy ? "Saving…" : "Save Draft"}</button><button className="btn-secondary" disabled={busy || saving || !valid || hasPendingImage} onClick={publish}>Publish</button></div>
  </div>;
  return <Modal title={sop.title} description={`Draft v${version.version} · ${outlet?.name}`} size="2xl" panelClassName="crew-sop-editor-popout" bodyClassName={`crew-sop-editor-popout-body ${pane === "preview" ? "is-preview" : ""}`} onClose={requestClose} headerActions={<span className={`crew-sop-save-state ${dirty ? "is-dirty" : "is-saved"}`}>{dirty ? "Unsaved changes" : <><Check size={13} /> Saved</>}</span>} footer={footer} footerClassName="block">
    {pane === "edit" ? <div className="crew-sop-draft-workspace">
      <aside><div><strong>Section Outline</strong><span>{sections.length}</span></div>{sections.map((section, index) => <button key={section.id} className={selected?.id === section.id ? "is-active" : ""} onClick={() => setSelectedId(section.id)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{section.title || "Untitled Section"}</strong><ChevronRight size={15} /></button>)}<button className="crew-sop-add-section" onClick={addSection}><Plus size={15} /> Add Section</button></aside>
      <main>{selected ? <><div className="crew-sop-editor-form-head"><div><span>Section {sections.findIndex((item) => item.id === selected.id) + 1}</span><h2>{selected.title || "Untitled Section"}</h2></div><div><button className="icon-btn" disabled={sections[0]?.id === selected.id} onClick={() => move(-1)} aria-label="Move section up"><ArrowUp size={16} /></button><button className="icon-btn" disabled={sections.at(-1)?.id === selected.id} onClick={() => move(1)} aria-label="Move section down"><ArrowDown size={16} /></button><button className="icon-btn is-danger" disabled={sections.length === 1} onClick={remove} aria-label="Delete section"><Trash2 size={16} /></button></div></div><label>Section Title *<input className="control w-full" value={selected.title || ""} onChange={(event) => updateSelected({ title: event.target.value })} /></label><div className="crew-sop-editor-field"><span>Content</span><RichTextEditor value={selected.editorHtml} onChange={(editorHtml) => updateSelected({ editorHtml })} onImage={chooseImage} disabled={selected.uploadingImage} />{imageError ? <small role="alert" className="crew-sop-editor-error">{imageError}</small> : null}</div>{selected.pendingImage || selected.media ? <div className="crew-sop-image-placeholder"><div>{selected.pendingImage?.url ? <img src={selected.pendingImage.url} alt="Uploading preview" /> : <CrewSopImage media={selected.media} admin />}</div><label>Image caption<input className="control w-full" disabled={selected.uploadingImage} value={selected.pendingImage?.caption ?? selected.media?.caption ?? ""} onChange={(event) => selected.pendingImage ? updateSelected({ pendingImage: { ...selected.pendingImage, caption: event.target.value } }) : updateSelected({ media: { ...selected.media, caption: event.target.value } })} /></label><button className="btn-secondary is-danger" type="button" disabled={selected.uploadingImage} onClick={removeSelectedImage}>Remove Image</button>{selected.uploadingImage ? <p role="status">Uploading and securing image…</p> : <p>Stored privately for this Outlet, SOP, and version.</p>}</div> : null}<label className="crew-sop-key-toggle"><input aria-label="Key Point" type="checkbox" checked={Boolean(selected.keyPointContent)} onChange={(event) => updateSelected({ keyPointContent: event.target.checked ? selected.keyPointContent || "Add the key point…" : "" })} /><span><strong>Key Point</strong><small>Add an optional callout below the normal section content.</small></span></label>{selected.keyPointContent ? <label>Key Point Content<textarea className="control min-h-24 w-full py-3" value={selected.keyPointContent} onChange={(event) => updateSelected({ keyPointContent: event.target.value })} /></label> : null}</> : <EmptyState title="Add the first section" description="Create a section to start this SOP draft." />}</main>
    </div> : pane === "languages" ? <div className="p-5 md:p-6"><LocalizedContentEditor domain="sop" versionId={version.id} sourceLanguage={sourceLanguage} onSourceLanguageChange={(next) => { setSourceLanguage(next); setDirty(true); }} onHydrateSourceLanguage={setSourceLanguage} sourceUnits={localizationUnits} confirm={onConfirm} disabled={busy || saving} /></div> : <section className="crew-sop-preview-pane" aria-label={`Preview v${version.version}`}>
      <div className="crew-sop-preview-context"><Star size={16} aria-hidden="true" /><span>Crew view · Unsaved draft changes included</span></div>
      <div className="crew-sop-preview-scroll" data-testid="sop-preview-scroll"><CrewSopDocument sections={previewSections} admin className="is-admin-preview" /></div>
    </section>}
  </Modal>;
}

function RichTextEditor({ value, onChange, onImage, disabled = false }) {
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
    ["Image", ImagePlus, () => !disabled && imageRef.current?.click()], ["Undo", Undo2, () => command("undo")], ["Redo", Redo2, () => command("redo")],
  ];
  return <div className="crew-sop-rich-editor"><div className="crew-sop-rich-toolbar" role="toolbar" aria-label="Content formatting">{tools.map(([label, Icon, action]) => <button key={label} type="button" disabled={disabled} aria-label={label} title={label} onMouseDown={(event) => event.preventDefault()} onClick={action}><Icon size={15} /></button>)}<input ref={imageRef} className="sr-only" type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) onImage(file); event.target.value = ""; }} /></div>{linkOpen ? <div className="crew-sop-link-editor"><input className="control" aria-label="Link URL" placeholder="https://example.com" value={linkValue} onChange={(event) => setLinkValue(event.target.value)} /><button className="btn-secondary crew-sop-compact-action" type="button" onClick={addLink}>Apply Link</button><button className="btn-ghost" type="button" onClick={() => setLinkOpen(false)}>Cancel</button></div> : null}<div ref={editorRef} className="crew-sop-rich-surface" contentEditable={!disabled} role="textbox" aria-label="Content" aria-multiline="true" data-placeholder="Write the section content…" onInput={emit} onBlur={emit} onMouseUp={rememberSelection} onKeyUp={rememberSelection} suppressContentEditableWarning /></div>;
}

function UsageView({ sopId, onNavigate }) {
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { let active = true; crewService.sopUsageAdmin(sopId).then((data) => active && setUsage(data)).catch((cause) => active && setError(cause.message)); return () => { active = false; }; }, [sopId]);
  if (error) return <div className="crew-sop-usage-message">Unable to load usage: {error}</div>;
  if (!usage) return <LibrarySkeleton />;
  const assigned = (usage.historical || []).reduce((sum, item) => sum + Number(item.assignment_count || 0), 0);
  return <section className="crew-sop-usage"><div className="crew-sop-usage-summary"><span><strong>{usage.current?.length || 0}</strong><small>Active references</small></span><span><strong>{assigned}</strong><small>Pinned assignments</small></span></div><div><h3>Current Onboarding References</h3>{usage.current?.length ? usage.current.map((item, index) => <article key={`${item.journey_id}-${item.lesson_title}-${index}`}><BookOpenCheck size={17} /><div><strong>{item.lesson_title}</strong><p>{item.journey_name} · {item.module_title}</p><small>Current onboarding v{item.journey_version}</small></div><button className="btn-secondary crew-sop-compact-action" type="button" onClick={() => onNavigate?.(item)}>View</button></article>) : <p className="crew-sop-usage-message">Not currently used in onboarding.</p>}</div><div><h3>Historical References</h3>{usage.historical?.length ? usage.historical.map((item, index) => <article key={`${item.journey_name}-${item.journey_version}-${index}`}><FileText size={17} /><div><strong>{item.journey_name} v{item.journey_version}</strong><p>{item.assignment_count} pinned assignment{Number(item.assignment_count) === 1 ? "" : "s"}</p><small>Frozen snapshot · future SOP changes do not affect it</small></div><button className="btn-secondary crew-sop-compact-action" type="button" onClick={() => onNavigate?.(item)}>View</button></article>) : <p className="crew-sop-usage-message">No historical assignment snapshot references this SOP.</p>}</div></section>;
}

function SopUsageModal({ sop, onClose }) {
  const version = currentVersion(sop) || draftVersion(sop);
  return <Modal title="SOP Usage" description={`${sop.title} · ${version ? `v${version.version}` : "No version"}`} size="lg" panelClassName="crew-sop-usage-popout" onClose={onClose} footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}><UsageView sopId={sop.id} onNavigate={() => { onClose(); window.location.hash = "crew_learning"; }} /></Modal>;
}

function CreateSopModal({ categories, targetOutlet, sourceOutlets, saving, onClose, onCreate, onCloned }) {
  const [mode, setMode] = useState("blank");
  const [values, setValues] = useState({ title: "", categoryId: categories[0]?.id || "", summary: "", requireAcknowledgement: false });
  const [sections, setSections] = useState([{ id: temporarySectionId(), title: "Untitled Section", editorHtml: "", keyPointContent: "", pendingImage: null }]);
  const [selectedId, setSelectedId] = useState(sections[0].id);
  const [sourceOutletId, setSourceOutletId] = useState(sourceOutlets[0]?.id || "");
  const [sourceSops, setSourceSops] = useState([]);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceCategory, setSourceCategory] = useState("");
  const [sourceSopId, setSourceSopId] = useState("");
  const [loadingSource, setLoadingSource] = useState(false);
  const [error, setError] = useState("");
  const selected = sections.find((section) => section.id === selectedId) || sections[0];
  const valid = values.title.trim() && values.categoryId && sections.length && sections.every((section) => section.title.trim());
  useEffect(() => {
    if (mode !== "clone" || !sourceOutletId) return;
    let active = true;
    setLoadingSource(true);
    crewService.listOutletSopsAdmin(sourceOutletId).then((result) => {
      if (!active) return;
      setSourceSops((result.sops || []).filter((sop) => currentVersion(sop)));
      setSourceSopId("");
    }).catch((cause) => active && setError(cause.message)).finally(() => active && setLoadingSource(false));
    return () => { active = false; };
  }, [mode, sourceOutletId]);
  function updateSelected(next) { setSections((rows) => rows.map((row) => row.id === selected.id ? { ...row, ...next } : row)); }
  function addSection() { const id = temporarySectionId(); setSections((rows) => [...rows, { id, title: "Untitled Section", editorHtml: "", keyPointContent: "", pendingImage: null }]); setSelectedId(id); }
  function move(direction) { const index = sections.findIndex((row) => row.id === selected.id); const target = index + direction; if (target < 0 || target >= sections.length) return; const next = [...sections]; [next[index], next[target]] = [next[target], next[index]]; setSections(next); }
  function removeSection() { if (sections.length === 1) return; const index = sections.findIndex((row) => row.id === selected.id); const next = sections.filter((row) => row.id !== selected.id); selected.pendingImage?.url && URL.revokeObjectURL?.(selected.pendingImage.url); setSections(next); setSelectedId(next[Math.min(index, next.length - 1)].id); }
  function chooseImage(file) { try { validateImageFile(file); const url = URL.createObjectURL?.(file) || ""; selected.pendingImage?.url && URL.revokeObjectURL?.(selected.pendingImage.url); updateSelected({ pendingImage: { file, url, caption: "" } }); setError(""); } catch (cause) { setError(cause.message); } }
  async function clone() { setError(""); try { const result = await crewService.cloneSelectedSops({ sourceOutletId, targetOutletId: targetOutlet.id, sopIds: [sourceSopId], copyCategories: true }); await onCloned(result); } catch (cause) { setError(cause.message); } }
  const sourceCategories = [...new Set(sourceSops.map((sop) => sop.category).filter(Boolean))];
  const visibleSources = sourceSops.filter((sop) => (!sourceQuery || sop.title.toLowerCase().includes(sourceQuery.toLowerCase())) && (!sourceCategory || sop.category === sourceCategory));
  const footer = mode === "blank" ? <div className="crew-sop-modal-footer"><div><button className="btn-secondary" onClick={onClose}>Cancel</button></div><div><button className="btn-secondary" disabled={saving || !valid} onClick={() => onCreate(values, sections, false)}>Save Draft</button><button className="btn-primary" disabled={saving || !valid} onClick={() => onCreate(values, sections, true)}>Publish</button></div></div> : <div className="crew-sop-modal-footer"><div><button className="btn-secondary" onClick={onClose}>Cancel</button></div><div><button className="btn-primary" disabled={saving || loadingSource || !sourceSopId} onClick={clone}>{saving ? "Cloning…" : "Clone as Draft"}</button></div></div>;
  return <Modal title="Create SOP" description={`${targetOutlet?.name || "Outlet"} · Start blank or clone an existing published SOP`} size="2xl" panelClassName="crew-sop-create-popout" bodyClassName="crew-sop-create-popout-body" onClose={onClose} footer={footer} footerClassName="block"><div className="crew-sop-create-modes" role="tablist"><button className={mode === "blank" ? "is-active" : ""} role="tab" aria-selected={mode === "blank"} onClick={() => setMode("blank")}>Blank SOP</button><button className={mode === "clone" ? "is-active" : ""} role="tab" aria-selected={mode === "clone"} onClick={() => setMode("clone")}><Copy size={15} /> Clone existing SOP</button></div>{mode === "blank" ? <div className="crew-sop-create-workspace"><aside className="crew-sop-create-meta"><label>Title *<input className="control w-full" autoFocus value={values.title} onChange={(event) => setValues({ ...values, title: event.target.value })} /></label><SelectField label="Category" ariaLabel="Category" required value={values.categoryId} onChange={(categoryId) => setValues({ ...values, categoryId })} options={categories.map((category) => ({ value: category.id, label: category.name }))} /><label>Summary<textarea className="control min-h-20 w-full py-3" value={values.summary} onChange={(event) => setValues({ ...values, summary: event.target.value })} /></label><label className="crew-sop-key-toggle"><input aria-label="Acknowledgement Required" type="checkbox" checked={values.requireAcknowledgement} onChange={(event) => setValues({ ...values, requireAcknowledgement: event.target.checked })} /><span><strong>Acknowledgement Required</strong><small>Crew acknowledge the exact published version.</small></span></label><div className="crew-sop-create-outline"><header><strong>Sections</strong><span>{sections.length}</span></header>{sections.map((section, index) => <button className={section.id === selected.id ? "is-active" : ""} key={section.id} onClick={() => setSelectedId(section.id)}><span>{String(index + 1).padStart(2, "0")}</span>{section.title}</button>)}<button className="crew-sop-add-section" onClick={addSection}><Plus size={15} /> Add Section</button></div></aside><main className="crew-sop-create-section"><div className="crew-sop-editor-form-head"><div><span>Section {sections.findIndex((row) => row.id === selected.id) + 1}</span><h2>{selected.title}</h2></div><div><button className="icon-btn" disabled={sections[0].id === selected.id} onClick={() => move(-1)} aria-label="Move section up"><ArrowUp size={16} /></button><button className="icon-btn" disabled={sections.at(-1).id === selected.id} onClick={() => move(1)} aria-label="Move section down"><ArrowDown size={16} /></button><button className="icon-btn is-danger" disabled={sections.length === 1} onClick={removeSection} aria-label="Delete section"><Trash2 size={16} /></button></div></div><label>Section Title *<input className="control w-full" value={selected.title} onChange={(event) => updateSelected({ title: event.target.value })} /></label><div className="crew-sop-editor-field"><span>Content</span><RichTextEditor value={selected.editorHtml} onChange={(editorHtml) => updateSelected({ editorHtml })} onImage={chooseImage} /></div>{selected.pendingImage ? <div className="crew-sop-image-placeholder"><div><img src={selected.pendingImage.url} alt="SOP draft preview" /></div><label>Image caption<input className="control w-full" value={selected.pendingImage.caption} onChange={(event) => updateSelected({ pendingImage: { ...selected.pendingImage, caption: event.target.value } })} /></label><button className="btn-secondary is-danger" onClick={() => updateSelected({ pendingImage: null })}>Remove Image</button><p>Uploads securely when the complete draft is saved.</p></div> : null}<label className="crew-sop-key-toggle"><input aria-label="Key Point" type="checkbox" checked={Boolean(selected.keyPointContent)} onChange={(event) => updateSelected({ keyPointContent: event.target.checked ? "Add the key point…" : "" })} /><span><strong>Key Point</strong><small>Optional callout after the section content.</small></span></label>{selected.keyPointContent ? <label>Key Point Content<textarea className="control min-h-20 w-full py-3" value={selected.keyPointContent} onChange={(event) => updateSelected({ keyPointContent: event.target.value })} /></label> : null}{error ? <p role="alert" className="crew-sop-editor-error">{error}</p> : null}</main></div> : <div className="crew-sop-clone-form"><div className="crew-sop-clone-controls"><SelectField label="Source Outlet" ariaLabel="Source Outlet" value={sourceOutletId} onChange={setSourceOutletId} options={sourceOutlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} /><label className="crew-sop-search-control"><span>Search SOP</span><span className="crew-sop-search-field"><Search size={16} /><input aria-label="Search source SOP" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} /></span></label><SelectField label="Category" ariaLabel="Source Category" value={sourceCategory} onChange={setSourceCategory} options={[{ value: "", label: "All" }, ...sourceCategories.map((name) => ({ value: name, label: name }))]} /></div><div className="crew-sop-clone-target"><span>Creates an independent draft in</span><strong>{targetOutlet?.name || "—"}</strong></div><div className="crew-sop-source-list">{loadingSource ? <p>Loading published SOPs…</p> : visibleSources.map((sop) => <label key={sop.id} className={sourceSopId === sop.id ? "is-selected" : ""}><input type="radio" name="source-sop" aria-label={sop.title} checked={sourceSopId === sop.id} onChange={() => setSourceSopId(sop.id)} /><span><strong>{sop.title}</strong><small>{sop.category} · Published v{currentVersion(sop)?.version}</small></span></label>)}{!loadingSource && !visibleSources.length ? <p>No published SOPs match this selection.</p> : null}</div><p className="crew-sop-clone-note">Sections, safe media, and category are copied into a new outlet-scoped draft. Future edits never change the source SOP.</p>{error ? <p role="alert" className="crew-sop-editor-error">{error}</p> : null}</div>}</Modal>;
}

function CategoryManager({ outlet, categories, saving, onClose, onChanged, ui }) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(input) { setBusy(true); setError(""); try { await crewService.manageSopCategory({ outletId: outlet.id, ...input }); await onChanged(); return true; } catch (cause) { setError(cause.message); return false; } finally { setBusy(false); } }
  async function create() { if (await run({ action: "create", name, sortOrder: (categories.length + 1) * 10 })) setName(""); }
  async function rename(category) { if (await run({ action: "rename", categoryId: category.id, name: editingName })) setEditingId(""); }
  async function reorder(category, direction) { const index = categories.findIndex((row) => row.id === category.id); const other = categories[index + direction]; if (!other) return; await run({ action: "reorder", categoryId: category.id, sortOrder: other.sort_order }); await run({ action: "reorder", categoryId: other.id, sortOrder: category.sort_order }); }
  async function remove(category) { if (Number(category.sop_count || 0) > 0) { setError(`Category is used by ${category.sop_count} SOP${Number(category.sop_count) === 1 ? "" : "s"}. Reassign them before deleting it.`); return; } const confirmed = await ui.confirm({ title: `Delete ${category.name}?`, message: "Unused categories can be safely removed.", confirmLabel: "Delete Category", tone: "danger" }); if (confirmed) await run({ action: "delete", categoryId: category.id }); }
  return <Modal title="Manage Categories" description={`${outlet?.name || "Outlet"} · Categories keep the SOP Library consistent`} size="lg" panelClassName="crew-sop-category-popout" onClose={onClose} footer={<button className="btn-secondary" onClick={onClose}>Done</button>}><section className="crew-sop-category-create"><label>New Category<input className="control" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Food Safety" /></label><button className="btn-primary" disabled={busy || !name.trim()} onClick={create}><Plus size={15} /> Add Category</button></section><section className="crew-sop-category-list">{categories.map((category, index) => <article key={category.id}>{editingId === category.id ? <input aria-label={`Rename ${category.name}`} className="control" value={editingName} onChange={(event) => setEditingName(event.target.value)} /> : <div><strong>{category.name}</strong><small>{Number(category.sop_count || 0)} SOP{Number(category.sop_count) === 1 ? "" : "s"}</small></div>}<div>{editingId === category.id ? <><button className="btn-primary crew-sop-compact-action" disabled={busy || !editingName.trim()} onClick={() => rename(category)}>Save</button><button className="btn-ghost" onClick={() => setEditingId("")}>Cancel</button></> : <><button className="icon-btn" disabled={busy || index === 0} aria-label={`Move ${category.name} up`} onClick={() => reorder(category, -1)}><ArrowUp size={15} /></button><button className="icon-btn" disabled={busy || index === categories.length - 1} aria-label={`Move ${category.name} down`} onClick={() => reorder(category, 1)}><ArrowDown size={15} /></button><button className="btn-secondary crew-sop-compact-action" onClick={() => { setEditingId(category.id); setEditingName(category.name); }}>Rename</button><button className="icon-btn is-danger" aria-label={`Delete ${category.name}`} onClick={() => remove(category)}><Trash2 size={15} /></button></>}</div></article>)}</section>{error ? <p role="alert" className="crew-sop-editor-error">{error}</p> : null}{saving ? <span className="sr-only">Saving</span> : null}</Modal>;
}

function LibrarySkeleton() { return <div className="crew-sop-library-skeleton" aria-live="polite"><span /><span /><span /><p>Loading SOP Library…</p></div>; }

function SopDetailLoading({ sop, onClose }) {
  return <Modal title={sop.title} description="Loading SOP content…" size="2xl" onClose={onClose}><div className="crew-sop-library-skeleton" aria-live="polite"><span /><span /><span /><p>Loading the selected SOP version and sections…</p></div></Modal>;
}
