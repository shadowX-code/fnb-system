import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Copy,
  FileText,
  GraduationCap,
  Layers3,
  Plus,
  Search,
  Users,
} from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { crewService } from "../../../services/crewService.js";
import { outletService } from "../../../services/outletService.js";
import {
  JourneyBuilder,
  SopDetail,
  Tabs,
} from "./CrewLearningAdminPage.jsx";

const sortOrder = (items = []) =>
  [...items].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
const lessonCount = (journey) =>
  (journey?.modules || []).reduce(
    (total, module) => total + (module.lessons?.length || 0),
    0,
  );
const statusTone = (status) =>
  status === "published" || status === "completed"
    ? "success"
    : status === "in_progress"
      ? "info"
      : status === "draft"
        ? "warning"
        : "neutral";

export default function CrewLearningAdminResetPage({
  auth,
  ui,
  store,
  initialTab = "onboarding",
}) {
  const [surface, setSurface] = useState(
    initialTab === "sops" ? "sops" : "onboarding",
  );
  const [onboardingTab, setOnboardingTab] = useState("overview");
  const [outlets, setOutlets] = useState([]);
  const [outletId, setOutletId] = useState("");
  const [onboardingVersions, setOnboardingVersions] = useState([]);
  const [progress, setProgress] = useState([]);
  const [sops, setSops] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedJourneyId, setSelectedJourneyId] = useState(null);
  const [selectedSopId, setSelectedSopId] = useState(null);
  const [builderSelection, setBuilderSelection] = useState(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [sopDraftOpen, setSopDraftOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canLearning = auth.hasPermission("crew_learning.manage");
  const canSop = auth.hasPermission("crew_sop.manage");
  const accessibleOutlets = useMemo(
    () => outlets.filter((outlet) => outlet.is_active !== false),
    [outlets],
  );
  const outlet = accessibleOutlets.find((item) => item.id === outletId);
  const published = onboardingVersions.find((item) => item.status === "published");
  const draft = onboardingVersions.find((item) => item.status === "draft");
  const selectedJourney = onboardingVersions.find(
    (item) => item.id === selectedJourneyId,
  );
  const selectedSop = sops.find((item) => item.id === selectedSopId);

  useEffect(() => {
    let active = true;
    async function loadOutlets() {
      try {
        const rows = store?.outlets?.length
          ? store.outlets
          : await outletService.listActiveOutlets();
        if (!active) return;
        setOutlets(rows || []);
      } catch (error) {
        ui.notify({
          title: "Unable to load Learning outlets",
          message: error.message,
          tone: "error",
        });
        setLoading(false);
      }
    }
    loadOutlets();
    return () => {
      active = false;
    };
  }, [store?.outlets, ui]);

  useEffect(() => {
    if (!outletId && accessibleOutlets.length) {
      setOutletId(accessibleOutlets[0].id);
    }
  }, [accessibleOutlets, outletId]);

  useEffect(() => {
    setSurface(initialTab === "sops" ? "sops" : "onboarding");
  }, [initialTab]);

  async function refresh(selectedOutletId = outletId) {
    if (!selectedOutletId) return;
    setLoading(true);
    try {
      const [versions, nextSops, nextProgress] = await Promise.all([
        canLearning
          ? crewService.listOnboardingAdmin(selectedOutletId)
          : Promise.resolve([]),
        canSop
          ? crewService.listOutletSopsAdmin(selectedOutletId)
          : Promise.resolve({ sops: [], categories: [] }),
        canLearning
          ? crewService.onboardingProgress(selectedOutletId)
          : Promise.resolve([]),
      ]);
      setOnboardingVersions(versions);
      setSops(nextSops.sops);
      setCategories(nextSops.categories);
      setProgress(nextProgress);
      setSelectedJourneyId((current) =>
        versions.some((item) => item.id === current) ? current : null,
      );
      setSelectedSopId((current) =>
        nextSops.sops.some((item) => item.id === current) ? current : null,
      );
    } catch (error) {
      ui.notify({
        title: "Unable to load Crew Learning",
        message: error.message,
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh(outletId);
  }, [outletId]);

  async function openEditor() {
    if (!canLearning) return;
    setSaving(true);
    try {
      let journeyId = draft?.id;
      if (!journeyId && published) {
        journeyId = await crewService.newJourneyVersion(published.id);
      } else if (!journeyId) {
        journeyId = await crewService.createDefaultOnboarding(outletId);
      }
      await refresh();
      setSelectedJourneyId(journeyId);
      setBuilderSelection({ type: "journey", id: journeyId });
      setSurface("editor");
    } catch (error) {
      ui.notify({
        title: "Unable to open Onboarding editor",
        message: error.message,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function publishOnboarding(journey) {
    const confirmed = await ui.confirm({
      title: `Publish onboarding v${journey.version}?`,
      message:
        "This version becomes immutable. Existing Crew assignments keep their frozen version; newly eligible Crew use this published setup.",
      confirmLabel: `Publish v${journey.version}`,
      tone: "success",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await crewService.publishJourney(journey.id);
      await refresh();
      setSurface("onboarding");
      setOnboardingTab("modules");
      ui.notify({
        title: "Onboarding published",
        message: "Eligible Crew are enrolled automatically for this outlet.",
      });
    } catch (error) {
      ui.notify({
        title: "Unable to publish Onboarding",
        message: error.message,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function createSop(values) {
    setSaving(true);
    try {
      let category = categories.find((item) => item.id === values.categoryId);
      if (!category && values.newCategory?.trim()) {
        category = await crewService.saveSopCategory({
          outlet_id: outletId,
          name: values.newCategory.trim(),
          sort_order: categories.length * 10 + 10,
        });
      }
      if (!category) throw new Error("Choose or create an SOP category.");
      const sop = await crewService.saveSop({
        title: values.title.trim(),
        summary: values.summary.trim() || null,
        category: category.name,
        category_id: category.id,
        outlet_id: outletId,
        status: "draft",
      });
      await crewService.newSopVersion(sop.id);
      await refresh();
      setSelectedSopId(sop.id);
      setSopDraftOpen(false);
      setSurface("sop-detail");
    } catch (error) {
      ui.notify({
        title: "Unable to create SOP",
        message: error.message,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function publishSop(version) {
    const confirmed = await ui.confirm({
      title: `Publish SOP v${version.version}?`,
      message:
        "Published SOP content becomes read-only. Existing onboarding assignments remain pinned to their original SOP version.",
      confirmLabel: `Publish v${version.version}`,
      tone: "success",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await crewService.publishSopVersion(version.id);
      await refresh();
      ui.notify({ title: "SOP published" });
    } catch (error) {
      ui.notify({ title: "Unable to publish SOP", message: error.message, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function versionSop(sop) {
    setSaving(true);
    try {
      await crewService.newSopVersion(sop.id);
      await refresh();
      ui.notify({ title: "Editable SOP version created" });
    } catch (error) {
      ui.notify({ title: "Unable to create SOP version", message: error.message, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function cloneSetup(values) {
    setSaving(true);
    try {
      await crewService.cloneLearningSetup({
        sourceOutletId: values.sourceOutletId,
        targetOutletId: outletId,
        copyOnboarding: values.copyOnboarding,
        copyCategories: values.copyCategories,
        copySops: values.copySops,
      });
      setCloneOpen(false);
      await refresh();
      ui.notify({
        title: "Learning setup cloned",
        message: `Independent drafts are ready for ${outlet?.name || "this outlet"}.`,
      });
    } catch (error) {
      ui.notify({ title: "Unable to clone setup", message: error.message, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  if (!accessibleOutlets.length && !loading) {
    return (
      <div className="crew-learning-admin-shell">
        <PageHeader
          section="Crew · Learning"
          title="Learning"
          description="No accessible outlets are assigned to this role."
        />
        <EmptyState
          icon={CircleAlert}
          title="No accessible outlet"
          description="Ask an administrator to grant the required outlet visibility."
        />
      </div>
    );
  }

  const pageTitle =
    surface === "sops" || surface === "sop-detail"
      ? "SOP Library"
      : surface === "editor"
        ? "Edit New Crew Onboarding"
        : "New Crew Onboarding";

  return (
    <div className="crew-learning-admin-shell">
      <PageHeader
        section="Crew · Learning"
        title={pageTitle}
        description={
          surface === "sops" || surface === "sop-detail"
            ? "A consistent, searchable knowledge base for this outlet."
            : "Mandatory learning for every eligible Crew member in this outlet."
        }
        actions={
          <OutletContext
            outlets={accessibleOutlets}
            value={outletId}
            onChange={setOutletId}
          />
        }
      />

      {loading ? (
        <LearningSkeleton />
      ) : surface === "editor" && selectedJourney ? (
        <JourneyBuilder
          journey={selectedJourney}
          sops={sops}
          selection={builderSelection}
          setSelection={setBuilderSelection}
          saving={saving}
          onBack={() => setSurface("onboarding")}
          onRefresh={refresh}
          onPublish={() => publishOnboarding(selectedJourney)}
        />
      ) : surface === "sop-detail" && selectedSop ? (
        <SopDetail
          sop={selectedSop}
          journeys={onboardingVersions}
          canManage={canSop}
          saving={saving}
          onBack={() => setSurface("sops")}
          onNewVersion={() => versionSop(selectedSop)}
          onPublish={publishSop}
          onRefresh={refresh}
        />
      ) : surface === "sops" ? (
        <OutletSopLibrary
          outlet={outlet}
          sops={sops}
          categories={categories}
          canManage={canSop}
          onClone={() => setCloneOpen(true)}
          onCreate={() => setSopDraftOpen(true)}
          onOpen={(id) => {
            setSelectedSopId(id);
            setSurface("sop-detail");
          }}
        />
      ) : (
        <OnboardingWorkspace
          outlet={outlet}
          journey={published || draft}
          draft={draft}
          progress={progress}
          tab={onboardingTab}
          setTab={setOnboardingTab}
          canManage={canLearning}
          saving={saving}
          onEdit={openEditor}
          onClone={() => setCloneOpen(true)}
        />
      )}

      {cloneOpen && (
        <CloneSetupModal
          targetOutlet={outlet}
          outlets={accessibleOutlets.filter((item) => item.id !== outletId)}
          saving={saving}
          onClose={() => setCloneOpen(false)}
          onClone={cloneSetup}
        />
      )}
      {sopDraftOpen && (
        <SopDraftModal
          categories={categories}
          saving={saving}
          onClose={() => setSopDraftOpen(false)}
          onSave={createSop}
        />
      )}
    </div>
  );
}

function OutletContext({ outlets, value, onChange }) {
  return <SelectField className="crew-learning-outlet-context" label="Outlet" ariaLabel="Outlet" value={value} onChange={onChange} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} />;
}

function OnboardingWorkspace({
  outlet,
  journey,
  draft,
  progress,
  tab,
  setTab,
  canManage,
  saving,
  onEdit,
  onClone,
}) {
  if (!journey) {
    return (
      <EmptyState
        icon={GraduationCap}
        title={`No onboarding setup for ${outlet?.name || "this outlet"}`}
        description="Start with the standard eight-module shell or clone an independent setup from another accessible outlet."
        actions={
          canManage && (
            <>
              <button className="btn-primary" disabled={saving} onClick={onEdit}>
                Create from default
              </button>
              <button className="btn-secondary" onClick={onClone}>
                Clone from another outlet
              </button>
            </>
          )
        }
      />
    );
  }

  const completed = progress.filter((item) => item.status === "completed").length;
  const inProgress = progress.filter((item) => item.status === "in_progress").length;
  const notStarted = progress.length - completed - inProgress;
  const average = progress.length
    ? Math.round(
        progress.reduce(
          (total, item) => total + Number(item.progress_percentage || 0),
          0,
        ) / progress.length,
      )
    : 0;

  return (
    <div className="crew-onboarding-workspace">
      <section className="crew-onboarding-heading">
        <div>
          <div className="crew-onboarding-state">
            <Badge tone={statusTone(journey.status)}>{journey.status}</Badge>
            {draft && journey.status !== "draft" && (
              <Badge tone="warning">Draft changes</Badge>
            )}
            <span>v{journey.version}</span>
          </div>
          <h2>New Crew Onboarding</h2>
          <p>{outlet?.name} · Mandatory for all eligible Crew</p>
        </div>
        {canManage && (
          <div className="crew-onboarding-actions">
            <button className="btn-primary" disabled={saving} onClick={onEdit}>
              Edit Onboarding
            </button>
            <button className="btn-secondary" onClick={onClone}>
              <Copy size={15} /> Clone from…
            </button>
          </div>
        )}
      </section>

      <Tabs
        active={tab}
        setActive={setTab}
        tabs={["overview", "modules", "crew progress"]}
      />

      {tab === "overview" ? (
        <div className="crew-onboarding-overview">
          <section className="crew-learning-metrics" aria-label="Onboarding metrics">
            <Metric label="Modules" value={journey.modules?.length || 0} />
            <Metric label="Lessons" value={lessonCount(journey)} />
            <Metric label="Completion rate" value={`${average}%`} />
            <Metric label="Crew completed" value={completed} />
            <Metric label="In progress" value={inProgress} />
            <Metric label="Not started" value={notStarted} />
          </section>
          <section className="crew-onboarding-version-summary">
            <div>
              <span>Current version</span>
              <strong>v{journey.version}</strong>
            </div>
            <div>
              <span>Last updated</span>
              <strong>
                {journey.updated_at
                  ? new Date(journey.updated_at).toLocaleDateString("en-MY")
                  : "—"}
              </strong>
            </div>
            <div>
              <span>Applicable outlet</span>
              <strong>{outlet?.name}</strong>
            </div>
          </section>
        </div>
      ) : tab === "modules" ? (
        <ModuleList journey={journey} progress={progress} />
      ) : (
        <OnboardingProgress rows={progress} />
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ModuleList({ journey, progress }) {
  return (
    <div className="crew-onboarding-modules">
      {sortOrder(journey.modules).map((module, index) => {
        const completed = progress.filter(
          (row) => Number(row.completed_modules || 0) >= index + 1,
        ).length;
        return (
          <article key={module.id} className="crew-onboarding-module-row">
            <span className="crew-onboarding-module-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <h3>{module.title}</h3>
              <p>{module.description || "Module learning content"}</p>
            </div>
            <dl>
              <div>
                <dt>Lessons</dt>
                <dd>{module.lessons?.length || 0}</dd>
              </div>
              <div>
                <dt>Crew completed</dt>
                <dd>
                  {completed} / {progress.length}
                </dd>
              </div>
            </dl>
            <ChevronRight size={18} aria-hidden="true" />
          </article>
        );
      })}
    </div>
  );
}

function OnboardingProgress({ rows }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const visible = rows.filter((row) => {
    const matchesQuery = `${row.employee?.full_name || ""} ${row.employee?.employee_code || ""}`
      .toLowerCase()
      .includes(query.toLowerCase());
    return matchesQuery && (status === "all" || row.status === status);
  });
  return (
    <section className="crew-progress-panel">
      <div className="crew-progress-filters">
        <label>
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Crew"
          />
        </label>
        <SelectField ariaLabel="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All" }, { value: "not_started", label: "Not started" }, { value: "in_progress", label: "In progress" }, { value: "completed", label: "Completed" }]} />
      </div>
      <div className="crew-progress-table-wrap">
        <table className="crew-progress-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Progress</th>
              <th>Current module</th>
              <th>Modules</th>
              <th>Knowledge checks</th>
              <th>Started</th>
              <th>Completed</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.employee?.id}>
                <td>
                  <strong>{row.employee?.full_name}</strong>
                  <small>{row.employee?.position || row.employee?.employee_code}</small>
                </td>
                <td>
                  <div className="crew-progress-value">
                    <span>{row.progress_percentage || 0}%</span>
                    <i><b style={{ width: `${row.progress_percentage || 0}%` }} /></i>
                  </div>
                </td>
                <td>{row.current_module || (row.status === "completed" ? "Completed" : "Not started")}</td>
                <td>{row.completed_modules || 0} / {row.total_modules || 0}</td>
                <td>{row.knowledge_checks_passed || 0} / {row.knowledge_checks_total || 0}</td>
                <td>{row.started_at ? new Date(row.started_at).toLocaleDateString("en-MY") : "—"}</td>
                <td>{row.completed_at ? new Date(row.completed_at).toLocaleDateString("en-MY") : "—"}</td>
                <td><Badge tone={statusTone(row.status)}>{row.status.replace("_", " ")}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visible.length && (
        <EmptyState
          icon={Users}
          title="No Crew match these filters"
          description="Eligible active Crew appear automatically; no manual assignment is required."
        />
      )}
    </section>
  );
}

function OutletSopLibrary({
  outlet,
  sops,
  categories,
  canManage,
  onClone,
  onCreate,
  onOpen,
}) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const visible = sops.filter((sop) => {
    const matchesCategory = categoryId === "all" || sop.category_id === categoryId;
    const matchesQuery = `${sop.title} ${sop.summary || ""}`
      .toLowerCase()
      .includes(query.toLowerCase());
    return matchesCategory && matchesQuery;
  });
  const grouped = categories
    .map((category) => ({
      ...category,
      sops: visible.filter((sop) => sop.category_id === category.id),
    }))
    .filter((category) => category.sops.length);
  const uncategorized = visible.filter(
    (sop) => !categories.some((category) => category.id === sop.category_id),
  );

  return (
    <div className="crew-sop-library-workspace">
      <section className="crew-sop-library-toolbar">
        <label className="crew-sop-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search SOP"
          />
        </label>
        {canManage && (
          <div>
            <button className="btn-secondary" onClick={onClone}>
              <Copy size={15} /> Clone from…
            </button>
            <button className="btn-primary" onClick={onCreate}>
              <Plus size={15} /> New SOP
            </button>
          </div>
        )}
      </section>
      <div className="crew-sop-category-filter" role="tablist" aria-label="SOP categories">
        <button className={categoryId === "all" ? "active" : ""} onClick={() => setCategoryId("all")}>All</button>
        {categories.map((category) => (
          <button key={category.id} className={categoryId === category.id ? "active" : ""} onClick={() => setCategoryId(category.id)}>
            {category.name}
          </button>
        ))}
      </div>
      <p className="crew-sop-outlet-label">Published and draft knowledge for {outlet?.name}</p>
      {[...grouped, ...(uncategorized.length ? [{ id: "other", name: "Other", sops: uncategorized }] : [])].map((group) => (
        <section className="crew-sop-category-group" key={group.id}>
          <header><h2>{group.name}</h2><span>{group.sops.length} SOP{group.sops.length === 1 ? "" : "s"}</span></header>
          <div>
            {group.sops.map((sop) => {
              const current = sop.versions?.find((version) => version.version === sop.current_version);
              const draft = sop.versions?.find((version) => version.status === "draft");
              return (
                <button key={sop.id} className="crew-sop-compact-row" onClick={() => onOpen(sop.id)}>
                  <FileText size={18} />
                  <span><strong>{sop.title}</strong><small>{sop.summary || "Operational standard"}</small></span>
                  <span className="crew-sop-row-meta">
                    <Badge tone={statusTone(draft ? "draft" : sop.status)}>{draft ? `Draft v${draft.version}` : `Published v${current?.version || sop.current_version || "—"}`}</Badge>
                    {current?.require_acknowledgement && <small>Acknowledgement required</small>}
                  </span>
                  <ChevronRight size={17} />
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {!visible.length && (
        <EmptyState
          icon={BookOpenCheck}
          title="No SOPs found"
          description="Create the first SOP for this outlet or adjust the search and category filters."
        />
      )}
    </div>
  );
}

function CloneSetupModal({ targetOutlet, outlets, saving, onClose, onClone }) {
  const [values, setValues] = useState({
    sourceOutletId: outlets[0]?.id || "",
    copyOnboarding: true,
    copyCategories: true,
    copySops: true,
  });
  const changeOnboarding = (checked) =>
    setValues((current) => ({
      ...current,
      copyOnboarding: checked,
      copyCategories: checked ? true : current.copyCategories,
      copySops: checked ? true : current.copySops,
    }));
  return (
    <div className="modal-backdrop">
      <section className="modal-content crew-clone-modal">
        <header>
          <div><h2>Clone Learning Setup</h2><p>Create independent drafts for {targetOutlet?.name}.</p></div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">×</button>
        </header>
        <SelectField label="Source outlet" ariaLabel="Source outlet" value={values.sourceOutletId} onChange={(sourceOutletId) => setValues({ ...values, sourceOutletId })} options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} />
        <fieldset>
          <legend>Copy</legend>
          <label><input type="checkbox" checked={values.copyOnboarding} onChange={(event) => changeOnboarding(event.target.checked)} /> New Crew Onboarding</label>
          <label><input type="checkbox" checked={values.copyCategories} disabled={values.copyOnboarding} onChange={(event) => setValues({ ...values, copyCategories: event.target.checked })} /> SOP Categories</label>
          <label><input type="checkbox" checked={values.copySops} disabled={values.copyOnboarding} onChange={(event) => setValues({ ...values, copySops: event.target.checked })} /> SOP Library</label>
        </fieldset>
        <p className="crew-clone-note">Cloned content is independent. Future edits never change the source outlet.</p>
        <footer>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving || !values.sourceOutletId || (!values.copyOnboarding && !values.copyCategories && !values.copySops)} onClick={() => onClone(values)}>
            {saving ? "Cloning…" : `Clone to ${targetOutlet?.name || "outlet"}`}
          </button>
        </footer>
      </section>
    </div>
  );
}

function SopDraftModal({ categories, saving, onClose, onSave }) {
  const [values, setValues] = useState({
    title: "",
    summary: "",
    categoryId: categories[0]?.id || "__new__",
    newCategory: categories.length ? "" : "Other",
  });
  return (
    <div className="modal-backdrop">
      <section className="modal-content crew-sop-draft-modal">
        <header><div><h2>New SOP</h2><p>Start one editable outlet draft.</p></div><button className="btn-icon" onClick={onClose} aria-label="Close">×</button></header>
        <label>Title<input className="input" value={values.title} onChange={(event) => setValues({ ...values, title: event.target.value })} /></label>
        <SelectField label="Category" ariaLabel="Category" value={values.categoryId} onChange={(categoryId) => setValues({ ...values, categoryId })} options={[...categories.map((category) => ({ value: category.id, label: category.name })), { value: "__new__", label: "Create new category" }]} />
        {values.categoryId === "__new__" && <label>New category<input className="input" value={values.newCategory} onChange={(event) => setValues({ ...values, newCategory: event.target.value })} /></label>}
        <label>Summary<textarea className="input min-h-24" value={values.summary} onChange={(event) => setValues({ ...values, summary: event.target.value })} /></label>
        <footer><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving || !values.title.trim() || (values.categoryId === "__new__" && !values.newCategory.trim())} onClick={() => onSave(values)}>{saving ? "Creating…" : "Create draft"}</button></footer>
      </section>
    </div>
  );
}

function EmptyState({ icon: Icon, title, description, actions }) {
  return (
    <section className="crew-learning-empty-state">
      <Icon size={24} />
      <h2>{title}</h2>
      <p>{description}</p>
      {actions && <div>{actions}</div>}
    </section>
  );
}

function LearningSkeleton() {
  return (
    <div className="crew-learning-skeleton" aria-live="polite">
      <span /><span /><span />
      <p>Loading outlet learning setup…</p>
    </div>
  );
}
