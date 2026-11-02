import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CircleAlert, Copy, GraduationCap, MoreHorizontal, Search, Users } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import AsyncDataSurface from "../../../components/feedback/AsyncDataSurface.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import AdminSummaryGrid from "../../../components/ui/AdminSummaryGrid.jsx";
import PublicationState from "../../../components/ui/PublicationState.jsx";
import { semanticStatusTone } from "../../../components/ui/semanticStatus.js";
import SelectField from "../../../components/forms/SelectField.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import AdminFilterToolbar, { AdminOutletField } from "../../../components/layout/AdminFilterToolbar.jsx";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";
import { crewService } from "../../../services/crewService.js";
import CrewOnboardingEditor from "../components/CrewOnboardingEditor.jsx";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";
import { localizationLanguageSummary } from "../utils/localizedContent.js";

const byOrder = (rows = []) => [...rows].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
const lessonCount = (journey) => (journey?.modules || []).reduce((total, module) => total + (module.lessons?.length || 0), 0);
const quizCount = (journey) => (journey?.modules || []).reduce((total, module) => total + (module.lessons || []).reduce((count, lesson) => count + (lesson.quizzes?.length || 0), 0), 0);
const formatDate = (value) => value ? new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function CrewLearningAdminResetPage({ auth, ui, store }) {
  const { outlets, outletId, setOutletId } = useCrewAdminOutlet(store?.outlets || []);
  const [versions, setVersions] = useState([]);
  const [progress, setProgress] = useState([]);
  const [sops, setSops] = useState([]);
  const [section, setSection] = useState("modules");
  const [viewEmployeeId, setViewEmployeeId] = useState("");
  const [editorJourney, setEditorJourney] = useState(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const refreshSequence = useRef(0);
  const canManage = auth.hasPermission("crew_learning.manage");
  const accessibleOutlets = useMemo(() => outlets.filter((outlet) => outlet.is_active !== false), [outlets]);
  const outlet = accessibleOutlets.find((item) => item.id === outletId);
  const published = versions.find((item) => item.status === "published");
  const draft = versions.find((item) => item.status === "draft");
  const journey = published || draft;

  async function refresh(targetOutletId = outletId) {
    if (!targetOutletId) return { versions: [], progress: [], sops: [] };
    const requestId = ++refreshSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const [versionResult, progressResult, sopResult] = await Promise.allSettled([
        crewService.listOnboardingAdmin(targetOutletId),
        crewService.onboardingProgress(targetOutletId),
        crewService.listOutletSopsAdmin(targetOutletId),
      ]);
      if (requestId !== refreshSequence.current) return { versions: [], progress: [], sops: [] };
      if (versionResult.status === "rejected") throw versionResult.reason;
      const nextVersions = versionResult.value || [];
      const nextProgress = progressResult.status === "fulfilled" ? progressResult.value || [] : [];
      const nextSops = sopResult.status === "fulfilled" ? sopResult.value?.sops || [] : [];
      setVersions(nextVersions);
      setProgress(nextProgress);
      setSops(nextSops);
      setEditorJourney((current) => current && nextVersions.some((item) => item.id === current.id) ? current : null);
      if (progressResult.status === "rejected") ui.notify({ title: "Crew Progress is temporarily unavailable", message: progressResult.reason?.message || "Please try again.", tone: "warning" });
      if (sopResult.status === "rejected") ui.notify({ title: "SOP references are temporarily unavailable", message: sopResult.reason?.message || "Please try again before editing content.", tone: "warning" });
      return { versions: nextVersions, progress: nextProgress, sops: nextSops };
    } catch (cause) {
      if (requestId !== refreshSequence.current) return { versions: [], progress: [], sops: [] };
      setVersions([]);
      setProgress([]);
      setSops([]);
      setEditorJourney(null);
      setLoadError(cause.message || "The Onboarding read could not be completed.");
      ui.notify({ title: "Unable to load Onboarding", message: cause.message, tone: "error" });
      return { versions: [], progress: [], sops: [] };
    } finally { if (requestId === refreshSequence.current) setLoading(false); }
  }
  useEffect(() => {
    setSection("modules");
    setViewEmployeeId("");
    setMoreOpen(false);
    setVersions([]);
    setProgress([]);
    setSops([]);
    setEditorJourney(null);
    setLoadError("");
    refresh(outletId);
  }, [outletId]);

  async function loadEditor(journeyId) {
    const [detail, localization] = await Promise.all([crewService.getOnboardingAdmin(journeyId), crewService.localizedContentAdmin("onboarding", journeyId)]);
    return detail ? { ...detail, _source_language: Object.values(localization?.units || {})[0]?.source_language } : null;
  }

  async function openEditor() {
    if (!canManage) return;
    setSaving(true);
    try {
      let journeyId = draft?.id;
      if (!journeyId && published) journeyId = await crewService.newJourneyVersion(published.id);
      if (!journeyId) journeyId = await crewService.createDefaultOnboarding(outletId);
      const result = await refresh();
      if (!result.versions.some((item) => item.id === journeyId)) throw new Error("The onboarding draft could not be loaded.");
      const detail = await loadEditor(journeyId);
      if (!detail) throw new Error("The onboarding draft detail could not be loaded.");
      setEditorJourney(detail);
    } catch (cause) {
      ui.notify({ title: "Unable to open Onboarding editor", message: cause.message, tone: "error" });
    } finally { setSaving(false); }
  }

  async function saveDraft(nextDraft, options) {
    const original = editorJourney;
    setSaving(true);
    try {
      const saved = await crewService.saveOnboardingDraft(original, nextDraft, options);
      setEditorJourney(saved);
      setVersions((current) => current.map((item) => item.id === saved.id ? saved : item));
      ui.notify({ title: "Onboarding draft saved", message: "Modules, lessons, content and language sources were saved together." });
      return saved;
    } catch (cause) {
      ui.notify({ title: "Unable to save Onboarding", message: cause.message, tone: "error" });
      throw cause;
    } finally { setSaving(false); }
  }

  async function publishOnboarding(nextDraft, stats) {
    let languageSummary = "Language status unavailable";
    try { languageSummary = localizationLanguageSummary(await crewService.localizedContentAdmin("onboarding", nextDraft.id)); } catch { /* Publishing remains server-authoritative; the RPC will surface any real failure. */ }
    const confirmed = await ui.confirm({
      title: `Publish Onboarding v${nextDraft.version}?`,
      message: `${stats.modules} Modules · ${stats.lessons} Lessons · ${stats.quizzes} Knowledge Checks. ${languageSummary}. This version becomes available to Crew. Published versions are immutable.`,
      confirmLabel: `Publish v${nextDraft.version}`,
      tone: "success",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await crewService.publishJourney(nextDraft.id, nextDraft.draft_revision);
      setEditorJourney(null);
      await refresh();
      ui.notify({ title: "Onboarding published", message: "Eligible Crew are enrolled automatically for this outlet." });
    } catch (cause) {
      throw cause;
    } finally { setSaving(false); }
  }

  async function cloneOnboarding(sourceOutletId) {
    setSaving(true);
    try {
      const cloned = await crewService.cloneOnboarding(sourceOutletId, outletId);
      setCloneOpen(false);
      const result = await refresh();
      const detail = await loadEditor(cloned.onboarding_id);
      if (!result.versions.some((item) => item.id === cloned.onboarding_id) || !detail) throw new Error("The cloned Onboarding draft could not be loaded.");
      setEditorJourney(detail);
      ui.notify({ title: "Onboarding cloned", message: `Draft v${cloned.target_version} is ready to edit. Crew progress and evidence were not copied.` });
    } catch (cause) {
      ui.notify({ title: "Unable to clone Onboarding", message: cause.message, tone: "error" });
    } finally { setSaving(false); }
  }

  if (editorJourney) return <CrewOnboardingEditor key={editorJourney.id} journey={editorJourney} outlet={outlet} sops={sops} saving={saving} confirm={ui.confirm} onClose={() => setEditorJourney(null)} onSave={saveDraft} onPublish={publishOnboarding} />;

  if (!accessibleOutlets.length && !loading) return <div className="crew-onboarding-admin-page"><PageHeader section="Crew · Learning" title="New Crew Onboarding" /><EmptyState icon={CircleAlert} title="No accessible outlet" description="Ask an administrator to grant the required outlet visibility." /></div>;

  return <div className="crew-onboarding-admin-page">
    <PageHeader section="Crew · Learning" title={section === "progress" ? "Crew Progress" : "New Crew Onboarding"} breadcrumbs={section === "progress" ? [{ label: "New Crew Onboarding", onClick: () => setSection("modules") }, { label: "Crew Progress" }] : undefined} metadata={published || draft ? <>{published && <PublicationState status="published" version={published.version} />}{draft && <PublicationState status="draft" version={draft.version} />}</> : null} secondaryActions={<>
      {section === "progress" ? <button type="button" className="btn-secondary" onClick={() => setSection("modules")}>Course Overview</button> : <button type="button" className="btn-secondary" disabled={loading || !journey} onClick={() => setSection("progress")}><Users size={15} /> Crew Progress</button>}
      {canManage && <ActionMenu open={moreOpen} onOpenChange={setMoreOpen} ariaLabel="Onboarding actions" trigger={({ toggle }) => <button type="button" className="btn-secondary" aria-label="More onboarding actions" aria-haspopup="menu" aria-expanded={moreOpen} onClick={toggle}><MoreHorizontal size={15} /> More <ChevronDown size={14} /></button>}><div role="menu" aria-label="Onboarding actions"><button type="button" role="menuitem" onClick={() => { setMoreOpen(false); setCloneOpen(true); }}><Copy size={15} /> Clone From Outlet</button></div></ActionMenu>}
    </>} primaryActions={canManage ? <button className="btn-primary" disabled={saving || loading} onClick={openEditor}>{draft ? "Edit Draft" : published ? "Create Draft" : "Create Onboarding"}</button> : null} />
    <AdminFilterToolbar compact denseFields ariaLabel="Onboarding controls" outlet={<AdminOutletField value={outletId} onChange={setOutletId} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} />} />
    <AsyncDataSurface loading={loading} error={loadError} errorTitle="Unable to load Onboarding" hasData={Boolean(journey)} isEmpty={!journey} emptyIcon={GraduationCap} emptyTitle={`No onboarding setup for ${outlet?.name || "this outlet"}`} emptyDescription="Create the standard eight-module onboarding or clone an independent setup from another outlet." onRetry={() => refresh(outletId)} className="crew-onboarding-data-surface">
      {journey ? <OnboardingWorkspace key={outletId} published={published} progress={progress} section={section} onViewEmployee={setViewEmployeeId} /> : null}
    </AsyncDataSurface>
    {viewEmployeeId ? <ProgressDetailModal row={progress.find((item) => item.employee?.id === viewEmployeeId)} journey={journey} onClose={() => setViewEmployeeId("")} /> : null}
    {cloneOpen ? <CloneOnboardingModal outlet={outlet} outlets={accessibleOutlets.filter((item) => item.id !== outletId)} saving={saving} onClose={() => setCloneOpen(false)} onClone={cloneOnboarding} /> : null}
  </div>;
}

function OnboardingWorkspace({ published, progress, section, onViewEmployee }) {
  const completed = progress.filter((item) => item.status === "completed").length;
  const started = progress.filter((item) => item.status !== "not_started").length;
  const average = progress.length ? Math.round(progress.reduce((total, item) => total + Number(item.progress_percentage || 0), 0) / progress.length) : 0;
  if (section === "progress") return <div className="crew-onboarding-workspace is-unified"><p className="text-sm text-text-secondary">Progress follows each Crew member’s assigned published version.</p><AdminSummaryGrid variant="compact" ariaLabel="Published learning progress" items={[{ label: "Completion", value: `${average}%` }, { label: "Crew started", value: started }, { label: "Crew completed", value: completed }]} /><OnboardingProgress rows={progress} onView={onViewEmployee} /></div>;
  if (!published) return <EmptyState icon={GraduationCap} title="Onboarding not published" description="Continue editing the Draft in Builder. The course overview will appear after publication." />;
  const publishedProgress = progress.filter((row) => row.journey_id === published.id || Number(row.journey_version) === Number(published.version));
  const publishedCompleted = publishedProgress.filter((row) => row.status === "completed").length;
  return <div className="crew-onboarding-workspace is-unified">
    <AdminSummaryGrid variant="compact" mobileColumns={2} ariaLabel={`Published v${published.version} summary`} items={[{ label: "Modules", value: published.modules?.length || 0 }, { label: "Lessons", value: lessonCount(published) }, { label: "Knowledge Checks", value: quizCount(published) }, { label: "Crew Completed", value: `${publishedCompleted} / ${publishedProgress.length}` }]} />
    <section aria-label="Course Modules"><h2 className="crew-onboarding-course-heading">Course Modules</h2><ModuleList key={published.id} journey={published} /></section>
  </div>;
}

function ModuleList({ journey }) {
  return <section className="crew-onboarding-modules" id="onboarding-modules" aria-label="Onboarding modules">{byOrder(journey.modules).map((module, moduleIndex) => <details key={module.id} className="crew-onboarding-overview-module"><summary className="crew-onboarding-overview-grid"><span className="crew-outline-number">{moduleIndex + 1}</span><strong>{module.title}</strong><small>{module.lessons?.length || 0} lessons · {module.required ? "Required" : "Optional"}</small><ChevronRight size={16} /></summary><div className="crew-onboarding-overview-body">{module.description && <p>{module.description}</p>}<div className="crew-onboarding-overview-lessons">{byOrder(module.lessons).map((lesson, lessonIndex) => <details key={lesson.id} className="crew-onboarding-overview-lesson"><summary className="crew-onboarding-overview-grid"><span className="crew-outline-number">{moduleIndex + 1}.{lessonIndex + 1}</span><strong>{lesson.title}</strong><small>{lesson.estimated_minutes || 0} min</small><ChevronRight size={14} /></summary><div className="crew-onboarding-overview-body"><span>{lesson.required ? "Required" : "Optional"}{lesson.blocks ? ` · ${lesson.blocks.length} content blocks` : ""}</span>{lesson.quizzes?.map((quiz) => <p key={quiz.id}><strong>{quiz.title || "Knowledge Check"}</strong>{quiz.questions ? ` · ${quiz.questions.length} questions` : ""} · Pass {quiz.passing_score}%</p>)}</div></details>)}</div></div></details>)}</section>;
}

function OnboardingProgress({ rows, onView }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const visible = rows.filter((row) => `${row.employee?.full_name || ""} ${row.employee?.employee_code || ""}`.toLowerCase().includes(query.toLowerCase()) && (status === "all" || row.status === status));
  const activeFilters = [query && { key: "query", label: "Search", value: query, onRemove: () => setQuery("") }, status !== "all" && { key: "status", label: "Status", value: status.replace("_", " "), onRemove: () => setStatus("all") }].filter(Boolean);
  return <section className="crew-progress-panel" id="onboarding-progress"><AdminFilterToolbar ariaLabel="Crew Progress filters" search={<label className="crew-progress-search-control"><span>Search Crew</span><span><Search size={16} /><input aria-label="Search Crew" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Crew" /></span></label>} filters={<SelectField label="Status" ariaLabel="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All" }, { value: "not_started", label: "Not Started" }, { value: "in_progress", label: "In Progress" }, { value: "completed", label: "Completed" }]} />} activeFilters={activeFilters} onClear={() => { setQuery(""); setStatus("all"); }} />{visible.length ? <DataTable rows={visible} getRowKey={(row) => row.employee?.id} onRowClick={(row) => onView(row.employee?.id)} columns={[{ key: "journey_version", header: "Published Version", render: (row) => row.journey_version ? `v${row.journey_version}` : "Not assigned" }, { key: "employee", header: "Employee", render: (row) => <span className="crew-progress-employee"><strong>{row.employee?.full_name}</strong><small>{row.employee?.position || row.employee?.employee_code}</small></span> }, { key: "progress", header: "Progress", render: (row) => `${row.progress_percentage || 0}%` }, { key: "module", header: "Current Module", render: (row) => row.current_module || (row.status === "completed" ? "Completed" : "Not Started") }, { key: "completed", header: "Completed Modules", render: (row) => `${row.completed_modules || 0} / ${row.total_modules || 0}` }, { key: "started", header: "Started", render: (row) => formatDate(row.started_at) }, { key: "finished", header: "Completed", render: (row) => formatDate(row.completed_at) }, { key: "status", header: "Status", render: (row) => <Badge tone={semanticStatusTone(row.status)}>{String(row.status).replace("_", " ")}</Badge> }]} /> : <EmptyState icon={Users} title="No Crew match these filters" description="Eligible active Crew appear automatically; no manual assignment is required." />}</section>;
}

function ProgressDetailModal({ row, journey, onClose }) {
  if (!row) return null;
  return <Modal title={row.employee?.full_name || "Crew Progress"} description={`Published v${row.journey_version || "—"} · ${row.progress_percentage || 0}% complete · ${String(row.status).replace("_", " ")}`} size="lg" onClose={onClose} footer={<button className="btn-secondary" onClick={onClose}>Close</button>}><div className="crew-onboarding-progress-detail">{byOrder(row.modules).map((module, index) => { const done = module.completed; const current = row.current_module === module.title; return <article key={module.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{module.title}</strong><small>{done ? "Completed" : current ? "In Progress" : "Not Started"}</small></div><Badge tone={done ? "success" : current ? "info" : "neutral"}>{done ? "Done" : current ? "Current" : "Pending"}</Badge></article>; })}</div></Modal>;
}

function CloneOnboardingModal({ outlet, outlets, saving, onClose, onClone }) {
  const [sourceOutletId, setSourceOutletId] = useState(outlets[0]?.id || "");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(Boolean(sourceOutletId));
  useEffect(() => {
    let active = true;
    if (!sourceOutletId || !outlet?.id) return undefined;
    setLoadingPreview(true);
    setError("");
    setPreview(null);
    crewService.onboardingClonePreview(sourceOutletId, outlet.id)
      .then((next) => { if (active) setPreview(next); })
      .catch((cause) => { if (active) setError(cause.message || "Unable to inspect this source outlet."); })
      .finally(() => { if (active) setLoadingPreview(false); });
    return () => { active = false; };
  }, [sourceOutletId, outlet?.id]);
  const languages = (preview?.languages || []).map((language) => language === "zh-CN" ? "中文" : language.toUpperCase());
  const blocked = Boolean(preview?.target_has_draft);
  return <Modal title="Clone Onboarding" description="Create an independent destination draft from the source Published version." size="md" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving || loadingPreview || !preview || blocked} onClick={() => onClone(sourceOutletId)}>{saving ? "Cloning…" : "Clone to Draft"}</button></>}><div className="crew-onboarding-clone"><SelectField label="Source Outlet" ariaLabel="Source Outlet" value={sourceOutletId} onChange={setSourceOutletId} options={outlets.map((item) => ({ value: item.id, label: item.name }))} /><div><span>Destination Outlet</span><strong>{outlet?.name || "—"}</strong></div>{loadingPreview ? <p>Loading source Published version…</p> : error ? <p role="alert">{error}</p> : preview ? <><section className="crew-onboarding-clone-summary"><strong>Published v{preview.source_version}</strong><span>{preview.modules} modules · {preview.lessons} lessons · {preview.knowledge_checks} knowledge checks</span><span>{languages.length ? `Languages: ${languages.join(" · ")}` : "Source-language content only"}</span></section>{blocked ? <p role="alert">This destination already has Draft v{preview.target_draft_version || "N"}. Finish or discard it before cloning; it will never be overwritten.</p> : <p>Crew progress, completion, evidence and source history are not copied. Destination Crew continue using their current Published onboarding until this draft is published.</p>}<p>Referenced SOPs are mapped only to matching Published SOPs owned by the destination outlet. Learning images are copied into destination-owned media.</p></> : null}</div></Modal>;
}
