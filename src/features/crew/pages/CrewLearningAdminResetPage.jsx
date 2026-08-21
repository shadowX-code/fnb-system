import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, CircleAlert, Copy, GraduationCap, Search, Users } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import { crewService } from "../../../services/crewService.js";
import CrewOnboardingEditor from "../components/CrewOnboardingEditor.jsx";
import CrewAdminToolbar, { CrewAdminOutletField } from "../components/CrewAdminToolbar.jsx";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";
import { localizationLanguageSummary } from "../utils/localizedContent.js";

const byOrder = (rows = []) => [...rows].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
const lessonCount = (journey) => (journey?.modules || []).reduce((total, module) => total + (module.lessons?.length || 0), 0);
const quizCount = (journey) => (journey?.modules || []).reduce((total, module) => total + (module.lessons || []).filter((lesson) => lesson.quizzes?.length).length, 0);
const statusTone = (status) => status === "published" || status === "completed" ? "success" : status === "in_progress" ? "info" : status === "draft" ? "warning" : "neutral";
const formatDate = (value) => value ? new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function CrewLearningAdminResetPage({ auth, ui, store }) {
  const { outlets, outletId, setOutletId } = useCrewAdminOutlet(store?.outlets || []);
  const [versions, setVersions] = useState([]);
  const [progress, setProgress] = useState([]);
  const [sops, setSops] = useState([]);
  const [section, setSection] = useState("modules");
  const [viewModuleId, setViewModuleId] = useState("");
  const [viewEmployeeId, setViewEmployeeId] = useState("");
  const [editorJourney, setEditorJourney] = useState(null);
  const [cloneOpen, setCloneOpen] = useState(false);
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
    setVersions([]);
    setProgress([]);
    setSops([]);
    setEditorJourney(null);
    setLoadError("");
    refresh(outletId);
  }, [outletId]);

  async function openEditor() {
    if (!canManage) return;
    setSaving(true);
    try {
      let journeyId = draft?.id;
      if (!journeyId && published) journeyId = await crewService.newJourneyVersion(published.id);
      if (!journeyId) journeyId = await crewService.createDefaultOnboarding(outletId);
      const result = await refresh();
      if (!result.versions.some((item) => item.id === journeyId)) throw new Error("The onboarding draft could not be loaded.");
      const detail = await crewService.getOnboardingAdmin(journeyId);
      if (!detail) throw new Error("The onboarding draft detail could not be loaded.");
      setEditorJourney(detail);
    } catch (cause) {
      ui.notify({ title: "Unable to open Onboarding editor", message: cause.message, tone: "error" });
    } finally { setSaving(false); }
  }

  async function saveDraft(nextDraft) {
    const original = editorJourney;
    setSaving(true);
    try {
      const saved = await crewService.saveOnboardingDraft(original, nextDraft);
      const result = await refresh();
      if (!result.versions.some((item) => item.id === saved.id)) throw new Error("The saved Onboarding version is unavailable.");
      const current = await crewService.getOnboardingAdmin(saved.id);
      setEditorJourney(current || saved);
      ui.notify({ title: "Onboarding draft saved", message: "All module, lesson and content changes were saved together." });
      return current;
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
      await crewService.publishJourney(nextDraft.id);
      setEditorJourney(null);
      await refresh();
      ui.notify({ title: "Onboarding published", message: "Eligible Crew are enrolled automatically for this outlet." });
    } catch (cause) {
      ui.notify({ title: "Unable to publish Onboarding", message: cause.message, tone: "error" });
    } finally { setSaving(false); }
  }

  async function cloneOnboarding(sourceOutletId) {
    setSaving(true);
    try {
      await crewService.cloneLearningSetup({ sourceOutletId, targetOutletId: outletId, copyOnboarding: true, copyCategories: false, copySops: false });
      setCloneOpen(false);
      await refresh();
      ui.notify({ title: "Onboarding cloned", message: `An independent draft is ready for ${outlet?.name}.` });
    } catch (cause) {
      ui.notify({ title: "Unable to clone Onboarding", message: cause.message, tone: "error" });
    } finally { setSaving(false); }
  }

  if (!accessibleOutlets.length && !loading) return <div className="crew-onboarding-admin-page"><PageHeader section="Crew · Learning" title="New Crew Onboarding" description="Mandatory for all eligible Crew" /><EmptyState icon={CircleAlert} title="No accessible outlet" description="Ask an administrator to grant the required outlet visibility." /></div>;

  return <div className="crew-onboarding-admin-page">
    <PageHeader section="Crew · Learning" title="New Crew Onboarding" description="Mandatory for all eligible Crew" />
    <CrewAdminToolbar outlet={<CrewAdminOutletField />} secondary={canManage ? <button className="btn-secondary" onClick={() => setCloneOpen(true)}><Copy size={15} /> Clone From Outlet</button> : null} primary={canManage ? <button className="btn-primary" disabled={saving} onClick={openEditor}>{draft ? "Continue Editing Draft" : "Edit Onboarding"}</button> : null} />
    {loading ? <LearningSkeleton /> : loadError ? <LearningLoadError message={loadError} onRetry={() => refresh(outletId)} /> : journey ? <OnboardingWorkspace outlet={outlet} journey={journey} draft={draft} progress={progress} section={section} setSection={setSection} onViewModule={setViewModuleId} onViewEmployee={setViewEmployeeId} /> : <EmptyState icon={GraduationCap} title={`No onboarding setup for ${outlet?.name || "this outlet"}`} description="Create the standard eight-module onboarding or clone an independent setup from another outlet." actions={canManage ? <><button className="btn-primary" onClick={openEditor}>Create Onboarding</button><button className="btn-secondary" onClick={() => setCloneOpen(true)}>Clone From Outlet</button></> : null} />}
    {viewModuleId && journey ? <ModuleViewModal module={journey.modules.find((item) => item.id === viewModuleId)} progress={progress} onClose={() => setViewModuleId("")} /> : null}
    {viewEmployeeId ? <ProgressDetailModal row={progress.find((item) => item.employee?.id === viewEmployeeId)} journey={journey} onClose={() => setViewEmployeeId("")} /> : null}
    {editorJourney ? <CrewOnboardingEditor journey={editorJourney} outlet={outlet} sops={sops} saving={saving} confirm={ui.confirm} onClose={() => setEditorJourney(null)} onSave={saveDraft} onPublish={publishOnboarding} /> : null}
    {cloneOpen ? <CloneOnboardingModal outlet={outlet} outlets={accessibleOutlets.filter((item) => item.id !== outletId)} saving={saving} onClose={() => setCloneOpen(false)} onClone={cloneOnboarding} /> : null}
  </div>;
}

function OnboardingWorkspace({ outlet, journey, draft, progress, section, setSection, onViewModule, onViewEmployee }) {
  const completed = progress.filter((item) => item.status === "completed").length;
  const inProgress = progress.filter((item) => item.status === "in_progress").length;
  const average = progress.length ? Math.round(progress.reduce((total, item) => total + Number(item.progress_percentage || 0), 0) / progress.length) : 0;
  return <div className="crew-onboarding-workspace is-unified"><section className="crew-onboarding-status-line"><div><Badge tone={statusTone(journey.status)}>{journey.status === "published" ? `Published v${journey.version}` : `Draft v${journey.version}`}</Badge>{draft && journey.status === "published" ? <Badge tone="warning">Draft Changes</Badge> : null}<span>{outlet?.name}</span></div><span>Automatic enrollment · Sequential learning</span></section><section className="crew-onboarding-summary" aria-label="Onboarding summary"><Summary label="Modules" value={journey.modules?.length || 0} /><Summary label="Lessons" value={lessonCount(journey)} /><Summary label="Completion" value={`${average}%`} /><Summary label="Completed" value={completed} /><Summary label="In Progress" value={inProgress} /><Summary label="Not Started" value={Math.max(0, progress.length - completed - inProgress)} /></section><div className="crew-onboarding-section-switch" role="tablist" aria-label="Onboarding sections"><button role="tab" aria-selected={section === "modules"} className={section === "modules" ? "is-active" : ""} onClick={() => setSection("modules")}>Modules</button><button role="tab" aria-selected={section === "progress"} className={section === "progress" ? "is-active" : ""} onClick={() => setSection("progress")}>Crew Progress</button></div>{section === "modules" ? <ModuleList journey={journey} progress={progress} onView={onViewModule} /> : <OnboardingProgress rows={progress} onView={onViewEmployee} />}</div>;
}
function Summary({ label, value }) { return <div><strong>{value}</strong><span>{label}</span></div>; }

function ModuleList({ journey, progress, onView }) {
  return <section className="crew-onboarding-modules" aria-label="Onboarding modules">{byOrder(journey.modules).map((module, index) => { const completed = progress.filter((row) => Number(row.completed_modules || 0) >= index + 1).length; const quizzes = (module.lessons || []).filter((lesson) => lesson.quizzes?.length).length; return <button key={module.id} className="crew-onboarding-module-row" onClick={() => onView(module.id)}><span className="crew-onboarding-module-number">{String(index + 1).padStart(2, "0")}</span><span className="crew-onboarding-module-copy"><strong>{module.title}</strong><small>{module.lessons?.length || 0} Lessons{quizzes ? ` · ${quizzes === 1 ? "Knowledge Check" : `${quizzes} Knowledge Checks`}` : ""}</small></span><span className="crew-onboarding-module-completion"><small>Crew completed</small><strong>{completed} / {progress.length}</strong></span><ChevronRight size={18} /></button>; })}</section>;
}

function OnboardingProgress({ rows, onView }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const visible = rows.filter((row) => `${row.employee?.full_name || ""} ${row.employee?.employee_code || ""}`.toLowerCase().includes(query.toLowerCase()) && (status === "all" || row.status === status));
  return <section className="crew-progress-panel"><div className="crew-progress-filters"><label><span>Search Crew</span><span><Search size={16} /><input aria-label="Search Crew" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Crew" /></span></label><SelectField label="Status" ariaLabel="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All" }, { value: "not_started", label: "Not Started" }, { value: "in_progress", label: "In Progress" }, { value: "completed", label: "Completed" }]} /></div>{visible.length ? <DataTable rows={visible} getRowKey={(row) => row.employee?.id} onRowClick={(row) => onView(row.employee?.id)} columns={[{ key: "employee", header: "Employee", render: (row) => <span className="crew-progress-employee"><strong>{row.employee?.full_name}</strong><small>{row.employee?.position || row.employee?.employee_code}</small></span> }, { key: "progress", header: "Progress", render: (row) => `${row.progress_percentage || 0}%` }, { key: "module", header: "Current Module", render: (row) => row.current_module || (row.status === "completed" ? "Completed" : "Not Started") }, { key: "completed", header: "Completed Modules", render: (row) => `${row.completed_modules || 0} / ${row.total_modules || 0}` }, { key: "started", header: "Started", render: (row) => formatDate(row.started_at) }, { key: "finished", header: "Completed", render: (row) => formatDate(row.completed_at) }, { key: "status", header: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{String(row.status).replace("_", " ")}</Badge> }]} /> : <EmptyState icon={Users} title="No Crew match these filters" description="Eligible active Crew appear automatically; no manual assignment is required." />}</section>;
}

function ModuleViewModal({ module, progress, onClose }) {
  if (!module) return null;
  const moduleIndex = Number(module.sort_order || 1);
  const completed = progress.filter((row) => Number(row.completed_modules || 0) >= moduleIndex).length;
  return <Modal title={module.title} description={`Module ${String(moduleIndex).padStart(2, "0")} · ${module.required ? "Required" : "Optional"}`} size="lg" onClose={onClose} footer={<button className="btn-secondary" onClick={onClose}>Close</button>}><div className="crew-onboarding-module-view"><p>{module.description || "Onboarding module content"}</p><dl><div><dt>Lessons</dt><dd>{module.lessons?.length || 0}</dd></div><div><dt>Crew Completed</dt><dd>{completed} / {progress.length}</dd></div></dl><section><h3>Lessons</h3>{byOrder(module.lessons).map((lesson, index) => <article key={lesson.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{lesson.title}</strong><small>{lesson.required ? "Required" : "Optional"} · {lesson.estimated_minutes || 0} min · {lesson.quizzes?.length ? "Knowledge Check" : "Lesson"}</small></div></article>)}</section></div></Modal>;
}

function ProgressDetailModal({ row, journey, onClose }) {
  if (!row) return null;
  return <Modal title={row.employee?.full_name || "Crew Progress"} description={`${row.progress_percentage || 0}% complete · ${String(row.status).replace("_", " ")}`} size="lg" onClose={onClose} footer={<button className="btn-secondary" onClick={onClose}>Close</button>}><div className="crew-onboarding-progress-detail">{byOrder(journey?.modules).map((module, index) => { const done = Number(row.completed_modules || 0) >= index + 1; const current = row.current_module === module.title; return <article key={module.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{module.title}</strong><small>{done ? "Completed" : current ? "In Progress" : "Not Started"}</small></div><Badge tone={done ? "success" : current ? "info" : "neutral"}>{done ? "Done" : current ? "Current" : "Pending"}</Badge></article>; })}</div></Modal>;
}

function CloneOnboardingModal({ outlet, outlets, saving, onClose, onClone }) {
  const [sourceOutletId, setSourceOutletId] = useState(outlets[0]?.id || "");
  return <Modal title="Clone Onboarding" description="Create an independent draft for the target outlet." size="md" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving || !sourceOutletId} onClick={() => onClone(sourceOutletId)}>{saving ? "Cloning…" : "Clone Onboarding"}</button></>}><div className="crew-onboarding-clone"><SelectField label="Source Outlet" ariaLabel="Source Outlet" value={sourceOutletId} onChange={setSourceOutletId} options={outlets.map((item) => ({ value: item.id, label: item.name }))} /><div><span>Target Outlet</span><strong>{outlet?.name || "—"}</strong></div><fieldset><legend>Copy</legend>{["Onboarding Structure", "Lessons", "Knowledge Checks", "SOP References"].map((label) => <label key={label}><input type="checkbox" checked readOnly /> {label}</label>)}</fieldset><p>SOP references are mapped to matching published SOPs in the target outlet. Source content remains unchanged.</p></div></Modal>;
}

function EmptyState({ icon: Icon, title, description, actions }) { return <section className="crew-learning-empty-state"><Icon size={24} /><h2>{title}</h2><p>{description}</p>{actions ? <div>{actions}</div> : null}</section>; }
function LearningLoadError({ message, onRetry }) { return <section className="crew-learning-empty-state" role="alert"><CircleAlert size={24} /><h2>Unable to load onboarding</h2><p>{message}</p><div><button className="btn-primary" type="button" onClick={onRetry}>Retry</button></div></section>; }
function LearningSkeleton() { return <div className="crew-learning-skeleton" aria-live="polite"><span /><span /><span /><p>Loading Onboarding…</p></div>; }
