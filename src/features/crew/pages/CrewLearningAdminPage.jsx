import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardList,
  FilePlus2,
  FileText,
  GraduationCap,
  Layers3,
  ListChecks,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Card from "../../../components/ui/Card.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { crewService } from "../../../services/crewService.js";
import { employeeService } from "../../../services/employeeService.js";

const blankJourney = {
  name: "",
  description: "",
  journey_type: "onboarding",
  estimated_minutes: 30,
  sequential_modules: true,
  status: "draft",
};
const blankSop = {
  title: "",
  category: "Operations",
  summary: "",
  status: "draft",
};
const sortByOrder = (items = []) =>
  [...items].sort((a, b) => a.sort_order - b.sort_order);
const statusTone = (status) =>
  status === "published" || status === "completed"
    ? "success"
    : status === "archived"
      ? "neutral"
      : status === "in_progress"
        ? "info"
        : "warning";
const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-MY", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "No due date";

export default function CrewLearningAdminPage({
  auth,
  ui,
  initialTab = "overview",
}) {
  const initialView =
    initialTab === "sops"
      ? "sops"
      : initialTab === "progress"
        ? "progress"
        : initialTab === "journeys"
          ? "journeys"
          : "overview";
  const [view, setView] = useState(initialView);
  const [journeys, setJourneys] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [sops, setSops] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedJourneyId, setSelectedJourneyId] = useState(null);
  const [selectedSopId, setSelectedSopId] = useState(null);
  const [builderSelection, setBuilderSelection] = useState(null);
  const [rootDraft, setRootDraft] = useState(null);
  const [assignDraft, setAssignDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const canLearning = auth.hasPermission("crew_learning.manage");
  const canSop = auth.hasPermission("crew_sop.manage");
  const selectedJourney = journeys.find(
    (item) => item.id === selectedJourneyId,
  );
  const selectedSop = sops.find((item) => item.id === selectedSopId);
  async function refresh() {
    setLoading(true);
    try {
      const [learning, nextSops, nextEmployees] = await Promise.all([
        crewService.listLearningAdmin(),
        crewService.listSopsAdmin(),
        employeeService.listEmployees(),
      ]);
      setJourneys(learning.journeys);
      setAssignments(learning.assignments);
      setSops(nextSops);
      setEmployees(nextEmployees);
    } catch (cause) {
      ui.notify({
        title: "Unable to load Crew learning",
        message: cause.message,
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    setView(initialView);
  }, [initialView]);
  const go = (next) => {
    setView(next);
    setRootDraft(null);
  };
  async function createRoot(kind, values) {
    setSaving(true);
    try {
      const entity =
        kind === "journey"
          ? await crewService.saveJourney(values)
          : await crewService.saveSop(values);
      await refresh();
      setRootDraft(null);
      if (kind === "journey") {
        setSelectedJourneyId(entity.id);
        setBuilderSelection({ type: "journey", id: entity.id });
        go("builder");
      } else {
        const versionId = await crewService.newSopVersion(entity.id);
        await refresh();
        setSelectedSopId(entity.id);
        go("sop-detail");
        ui.notify({
          title: "SOP draft created",
          message: `Version draft ${versionId ? "is ready to edit" : "created"}.`,
        });
      }
    } catch (cause) {
      ui.notify({
        title: "Unable to save draft",
        message: cause.message,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  async function publishJourney(journey) {
    const confirmed = await ui.confirm({
      title: `Publish ${journey.name}?`,
      message: `${journey.modules?.length || 0} modules, ${(journey.modules || []).reduce((total, module) => total + (module.lessons?.length || 0), 0)} lessons and ${quizCount(journey)} quizzes will become immutable. Existing assignments stay pinned.`,
      confirmLabel: `Publish v${journey.version}`,
      tone: "success",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await crewService.publishJourney(journey.id);
      await refresh();
      ui.notify({
        title: "Journey published",
        message: `v${journey.version} is now read-only.`,
      });
      setSelectedJourneyId(journey.id);
      go("journey-detail");
    } catch (cause) {
      ui.notify({
        title: "Unable to publish journey",
        message: cause.message,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  async function versionJourney(journey) {
    setSaving(true);
    try {
      const id = await crewService.newJourneyVersion(journey.id);
      await refresh();
      setSelectedJourneyId(id);
      setBuilderSelection({ type: "journey", id });
      go("builder");
      ui.notify({
        title: "New draft version created",
        message: "The published version remains unchanged.",
      });
    } catch (cause) {
      ui.notify({
        title: "Unable to create version",
        message: cause.message,
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
        "This version becomes immutable. Crew assignments already pinned to older versions remain unchanged.",
      confirmLabel: `Publish v${version.version}`,
      tone: "success",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await crewService.publishSopVersion(version.id);
      await refresh();
      ui.notify({ title: "SOP version published" });
    } catch (cause) {
      ui.notify({
        title: "Unable to publish SOP",
        message: cause.message,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  async function versionSop(sop) {
    setSaving(true);
    try {
      await crewService.newSopVersion(sop.id);
      await refresh();
      setSelectedSopId(sop.id);
      go("sop-detail");
      ui.notify({ title: "New SOP draft created" });
    } catch (cause) {
      ui.notify({
        title: "Unable to create version",
        message: cause.message,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  async function assignCrew() {
    if (!assignDraft?.employeeIds?.length || !assignDraft?.journeyId) return;
    setSaving(true);
    try {
      await Promise.all(
        assignDraft.employeeIds.map((employeeId) =>
          crewService.assignJourney(
            employeeId,
            assignDraft.journeyId,
            assignDraft.dueAt,
          ),
        ),
      );
      const count = assignDraft.employeeIds.length;
      setAssignDraft(null);
      await refresh();
      ui.notify({
        title: "Crew assigned",
        message: `${count} ${count === 1 ? "employee" : "employees"} now have this journey.`,
      });
    } catch (cause) {
      ui.notify({
        title: "Unable to assign journey",
        message: cause.message,
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }
  const content = loading ? (
    <Loading />
  ) : view === "overview" ? (
    <LearningOverview
      assignments={assignments}
      journeys={journeys}
      onOpenProgress={() => go("progress")}
      onOpenJourney={(id) => {
        setSelectedJourneyId(id);
        go("journey-detail");
      }}
    />
  ) : view === "journeys" ? (
    <JourneyLibrary
      journeys={journeys}
      assignments={assignments}
      canManage={canLearning}
      saving={saving}
      onCreate={() => setRootDraft({ kind: "journey", values: blankJourney })}
      onOpen={(id) => {
        setSelectedJourneyId(id);
        go("journey-detail");
      }}
      onBuilder={(id) => {
        setSelectedJourneyId(id);
        setBuilderSelection({ type: "journey", id });
        go("builder");
      }}
      onAssign={(id) =>
        setAssignDraft({ journeyId: id, employeeIds: [], dueAt: "", step: 1 })
      }
    />
  ) : view === "journey-detail" && selectedJourney ? (
    <JourneyDetail
      journey={selectedJourney}
      assignments={assignments.filter(
        (item) => item.journey_id === selectedJourney.id,
      )}
      canManage={canLearning}
      saving={saving}
      onBack={() => go("journeys")}
      onAssign={() =>
        setAssignDraft({
          journeyId: selectedJourney.id,
          employeeIds: [],
          dueAt: "",
          step: 1,
        })
      }
      onVersion={() => versionJourney(selectedJourney)}
      onBuilder={() => {
        setBuilderSelection({ type: "journey", id: selectedJourney.id });
        go("builder");
      }}
    />
  ) : view === "builder" && selectedJourney ? (
    <JourneyBuilder
      journey={selectedJourney}
      sops={sops}
      selection={builderSelection}
      setSelection={setBuilderSelection}
      saving={saving}
      onBack={() => go("journey-detail")}
      onRefresh={refresh}
      onPublish={() => publishJourney(selectedJourney)}
    />
  ) : view === "progress" ? (
    <CrewProgress
      assignments={assignments}
      onOpenJourney={(id) => {
        setSelectedJourneyId(id);
        go("journey-detail");
      }}
    />
  ) : view === "sops" ? (
    <SopLibrary
      sops={sops}
      canManage={canSop}
      saving={saving}
      onCreate={() => setRootDraft({ kind: "sop", values: blankSop })}
      onOpen={(id) => {
        setSelectedSopId(id);
        go("sop-detail");
      }}
    />
  ) : view === "sop-detail" && selectedSop ? (
    <SopDetail
      sop={selectedSop}
      journeys={journeys}
      canManage={canSop}
      saving={saving}
      onBack={() => go("sops")}
      onNewVersion={() => versionSop(selectedSop)}
      onPublish={publishSop}
      onRefresh={refresh}
    />
  ) : (
    <Empty
      icon={GraduationCap}
      text="Select a Crew learning area to continue."
    />
  );
  const title =
    view === "overview"
      ? "Learning overview"
      : view === "journeys"
        ? "Learning journeys"
        : view === "progress"
          ? "Crew progress"
          : view === "sops"
            ? "SOP library"
            : view === "builder"
              ? "Journey builder"
              : view === "sop-detail"
                ? "SOP editor"
                : "Journey detail";
  const description =
    view === "overview"
      ? "Follow up on the people and journeys that need attention."
      : view === "progress"
        ? "Server-owned assignment status is shown here; progress cannot be overridden."
        : "Draft edits use authenticated RLS. Publishing, versioning and assignment stay within their existing controlled authorities.";
  return (
    <div className="space-y-5">
      <PageHeader
        section="Crew · Learning"
        title={title}
        description={description}
        actions={<AdminNav active={view} onNavigate={go} />}
      />
      {content}
      {rootDraft && (
        <RootDraftModal
          draft={rootDraft}
          setDraft={setRootDraft}
          onSave={createRoot}
          saving={saving}
        />
      )}
      {assignDraft && (
        <AssignFlow
          values={assignDraft}
          setValues={setAssignDraft}
          employees={employees}
          journey={journeys.find((item) => item.id === assignDraft.journeyId)}
          onClose={() => setAssignDraft(null)}
          onSave={assignCrew}
          saving={saving}
        />
      )}
    </div>
  );
}

function AdminNav({ active, onNavigate }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      <button
        className={active === "overview" ? "btn-primary" : "btn-ghost"}
        onClick={() => onNavigate("overview")}
      >
        Overview
      </button>
      <button
        className={
          active === "journeys" ||
          active === "journey-detail" ||
          active === "builder"
            ? "btn-primary"
            : "btn-ghost"
        }
        onClick={() => onNavigate("journeys")}
      >
        Journeys
      </button>
      <button
        className={active === "progress" ? "btn-primary" : "btn-ghost"}
        onClick={() => onNavigate("progress")}
      >
        Crew progress
      </button>
      <button
        className={
          active === "sops" || active === "sop-detail"
            ? "btn-primary"
            : "btn-ghost"
        }
        onClick={() => onNavigate("sops")}
      >
        SOP library
      </button>
    </div>
  );
}
function LearningOverview({
  assignments,
  journeys,
  onOpenProgress,
  onOpenJourney,
}) {
  const active = assignments.filter((item) => item.status !== "completed");
  const complete = assignments.filter((item) => item.status === "completed");
  const overdue = assignments.filter(
    (item) =>
      item.due_at &&
      new Date(item.due_at) < new Date() &&
      item.status !== "completed",
  );
  const attention = [
    ...overdue,
    ...assignments.filter(
      (item) => item.status === "not_started" && !overdue.includes(item),
    ),
  ].slice(0, 6);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <section className="crew-admin-health">
          <div>
            <p className="text-sm font-semibold text-text-secondary">
              Learning health
            </p>
            <h2>
              {assignments.length
                ? Math.round((complete.length / assignments.length) * 100)
                : 0}
              % completion
            </h2>
            <p>Across {assignments.length} Crew assignments.</p>
          </div>
          <div className="crew-admin-health-bars">
            <HealthBar
              label="In progress"
              value={active.length}
              total={assignments.length}
              tone="primary"
            />
            <HealthBar
              label="Completed"
              value={complete.length}
              total={assignments.length}
              tone="success"
            />
            <HealthBar
              label="Needs attention"
              value={attention.length}
              total={assignments.length}
              tone="warning"
            />
            <HealthBar
              label="Overdue"
              value={overdue.length}
              total={assignments.length}
              tone="danger"
            />
          </div>
        </section>
        <Card
          title="Active journeys"
          description="Open a journey to manage its content, assignments, progress and versions."
        >
          <div className="divide-y divide-border">
            {journeys
              .filter((journey) => journey.status === "published")
              .map((journey) => {
                const rows = assignments.filter(
                  (item) => item.journey_id === journey.id,
                );
                const completed = rows.filter(
                  (item) => item.status === "completed",
                ).length;
                return (
                  <button
                    key={journey.id}
                    onClick={() => onOpenJourney(journey.id)}
                    className="crew-admin-list-row"
                  >
                    <span>
                      <strong>{journey.name}</strong>
                      <small>
                        {journey.modules?.length || 0} modules ·{" "}
                        {lessonCount(journey)} lessons · {quizCount(journey)}{" "}
                        quizzes
                      </small>
                    </span>
                    <span className="text-right">
                      <strong>
                        {rows.length
                          ? Math.round((completed / rows.length) * 100)
                          : 0}
                        %
                      </strong>
                      <small>{rows.length} assigned</small>
                    </span>
                    <ChevronRight size={18} />
                  </button>
                );
              })}
          </div>
        </Card>
      </div>
      <div className="space-y-5">
        <Card
          title="Needs attention"
          description="The shortest route to a manager follow-up."
        >
          <div className="space-y-3">
            {attention.length ? (
              attention.map((item) => (
                <div key={item.id} className="crew-admin-attention">
                  <AlertTriangle size={17} />
                  <div>
                    <strong>{item.employee?.full_name || "Crew member"}</strong>
                    <p>
                      {item.journey?.name || "Journey"} ·{" "}
                      {item.status === "not_started"
                        ? "Not started"
                        : "Due follow-up"}
                    </p>
                  </div>
                  <span>{formatDate(item.due_at)}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-text-secondary">
                No current follow-up items.
              </p>
            )}
          </div>
          <button
            className="btn-secondary mt-4 w-full"
            onClick={onOpenProgress}
          >
            View all Crew progress
          </button>
        </Card>
        <Card
          title="Recent learning activity"
          description="Activity is intentionally omitted until a server-sourced feed is available."
        >
          <p className="text-sm text-text-secondary">
            No activity feed is shown here to avoid manufacturing events from
            incomplete data.
          </p>
        </Card>
      </div>
    </div>
  );
}
function JourneyLibrary({
  journeys,
  assignments,
  canManage,
  saving,
  onCreate,
  onOpen,
  onBuilder,
  onAssign,
}) {
  const [filter, setFilter] = useState("all");
  const visible = journeys.filter(
    (journey) => filter === "all" || journey.status === filter,
  );
  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div className="crew-admin-filter">
          <button
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            className={filter === "draft" ? "active" : ""}
            onClick={() => setFilter("draft")}
          >
            Draft
          </button>
          <button
            className={filter === "published" ? "active" : ""}
            onClick={() => setFilter("published")}
          >
            Published
          </button>
          <button
            className={filter === "archived" ? "active" : ""}
            onClick={() => setFilter("archived")}
          >
            Archived
          </button>
        </div>
        {canManage && (
          <button
            className="btn-primary inline-flex items-center gap-2"
            onClick={onCreate}
          >
            <Plus size={16} /> Create journey
          </button>
        )}
      </section>
      <div className="grid gap-3">
        {visible.map((journey) => (
          <JourneyRow
            key={journey.id}
            journey={journey}
            assigned={
              assignments.filter((item) => item.journey_id === journey.id)
                .length
            }
            saving={saving}
            canManage={canManage}
            onOpen={() => onOpen(journey.id)}
            onBuilder={() => onBuilder(journey.id)}
            onAssign={() => onAssign(journey.id)}
          />
        ))}
        {!visible.length && (
          <Empty icon={GraduationCap} text="No journeys match this filter." />
        )}
      </div>
    </div>
  );
}
function JourneyRow({
  journey,
  assigned,
  canManage,
  onOpen,
  onBuilder,
  onAssign,
}) {
  const draft = journey.status === "draft";
  return (
    <article className="crew-admin-journey-row">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2>{journey.name}</h2>
          <Badge tone={statusTone(journey.status)}>{journey.status}</Badge>
          <span className="text-xs text-text-secondary">
            v{journey.version}
          </span>
        </div>
        <p>{journey.description || "No description yet."}</p>
        <small>
          {journey.modules?.length || 0} modules · {lessonCount(journey)}{" "}
          lessons · {quizCount(journey)} quizzes · {assigned} assigned ·{" "}
          {journey.sequential_modules ? "Sequential" : "Flexible"}
        </small>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {draft ? (
          <>
            <button className="btn-primary" onClick={onBuilder}>
              Continue editing
            </button>
            <button className="btn-secondary" onClick={onOpen}>
              Preview
            </button>
          </>
        ) : (
          <>
            <button className="btn-primary" onClick={onOpen}>
              Open journey
            </button>
            {canManage && (
              <button className="btn-secondary" onClick={onAssign}>
                <Send size={15} /> Assign
              </button>
            )}
          </>
        )}
        <button className="btn-icon" aria-label="More journey actions">
          <MoreHorizontal size={18} />
        </button>
      </div>
    </article>
  );
}
function JourneyDetail({
  journey,
  assignments,
  canManage,
  saving,
  onBack,
  onAssign,
  onVersion,
  onBuilder,
}) {
  const [tab, setTab] = useState("overview");
  return (
    <div className="space-y-5">
      <button
        className="btn-ghost inline-flex items-center gap-2"
        onClick={onBack}
      >
        <ArrowLeft size={16} /> All journeys
      </button>
      <section className="crew-admin-detail-head">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(journey.status)}>{journey.status}</Badge>
            <span className="text-sm text-text-secondary">
              v{journey.version}
            </span>
          </div>
          <h2>{journey.name}</h2>
          <p>{journey.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {journey.status === "draft" ? (
            <button className="btn-primary" onClick={onBuilder}>
              Continue editing
            </button>
          ) : (
            <>
              {canManage && (
                <button className="btn-primary" onClick={onAssign}>
                  <Send size={16} /> Assign Crew
                </button>
              )}
              <button
                className="btn-secondary"
                disabled={saving}
                onClick={onVersion}
              >
                Create new version
              </button>
            </>
          )}
        </div>
      </section>
      <Tabs
        active={tab}
        setActive={setTab}
        tabs={["overview", "content", "assignments", "progress", "versions"]}
      />
      {tab === "overview" ? (
        <div className="grid gap-4 md:grid-cols-4">
          <DetailMetric label="Modules" value={journey.modules?.length || 0} />
          <DetailMetric label="Lessons" value={lessonCount(journey)} />
          <DetailMetric label="Quizzes" value={quizCount(journey)} />
          <DetailMetric label="Assigned" value={assignments.length} />
        </div>
      ) : tab === "content" ? (
        <ContentPreview journey={journey} />
      ) : tab === "assignments" || tab === "progress" ? (
        <AssignmentTable assignments={assignments} />
      ) : (
        <VersionSummary journey={journey} />
      )}
    </div>
  );
}
function JourneyBuilder({
  journey,
  sops,
  selection,
  setSelection,
  saving,
  onBack,
  onRefresh,
  onPublish,
}) {
  const [newModule, setNewModule] = useState("");
  const [newLesson, setNewLesson] = useState("");
  const [newBlock, setNewBlock] = useState("text");
  const [blockBody, setBlockBody] = useState("");
  const [sopId, setSopId] = useState("");
  const draft = journey.status === "draft";
  const selected = resolveBuilderSelection(journey, selection);
  async function create(table, values, clear) {
    try {
      await crewService.saveDraftRecord(table, values);
      clear?.();
      await onRefresh();
    } catch (error) {
      /* surface through refresh caller next render only */
    }
  }
  if (!draft)
    return (
      <JourneyDetail
        journey={journey}
        assignments={[]}
        canManage={false}
        onBack={onBack}
      />
    );
  return (
    <div className="space-y-4">
      <button
        className="btn-ghost inline-flex items-center gap-2"
        onClick={onBack}
      >
        <ArrowLeft size={16} /> Journey detail
      </button>
      <section className="crew-builder-head">
        <div>
          <Badge tone="warning">Draft</Badge>
          <h2>{journey.name || "Untitled journey"}</h2>
          <p>
            {journey.sequential_modules
              ? "Modules unlock in sequence"
              : "Modules are flexible"}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary">Preview</button>
          <button className="btn-primary" disabled={saving} onClick={onPublish}>
            Publish v{journey.version}
          </button>
        </div>
      </section>
      <div className="crew-builder">
        <aside className="crew-builder-tree">
          <div className="flex items-center justify-between">
            <strong>Structure</strong>
            <span>{journey.modules?.length || 0} modules</span>
          </div>
          <button
            className={selection?.type === "journey" ? "is-selected" : ""}
            onClick={() => setSelection({ type: "journey", id: journey.id })}
          >
            <Layers3 size={16} /> Journey settings
          </button>
          {sortByOrder(journey.modules).map((module) => (
            <div key={module.id} className="crew-builder-module">
              <button
                className={selection?.id === module.id ? "is-selected" : ""}
                onClick={() => setSelection({ type: "module", id: module.id })}
              >
                <span>
                  {module.sort_order}. {module.title}
                </span>
                {module.required ? <CircleDot size={14} /> : null}
              </button>
              {sortByOrder(module.lessons).map((lesson) => (
                <button
                  key={lesson.id}
                  className={`crew-builder-lesson ${selection?.id === lesson.id ? "is-selected" : ""}`}
                  onClick={() =>
                    setSelection({ type: "lesson", id: lesson.id })
                  }
                >
                  <span>{lesson.title}</span>
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          ))}
          <div className="mt-3 flex gap-2">
            <input
              className="input min-w-0"
              value={newModule}
              onChange={(event) => setNewModule(event.target.value)}
              placeholder="Module title"
            />
            <button
              className="btn-secondary"
              disabled={!newModule.trim()}
              onClick={() =>
                create(
                  "crew_journey_modules",
                  {
                    journey_id: journey.id,
                    title: newModule.trim(),
                    sort_order: (journey.modules?.length || 0) + 1,
                    required: true,
                    status: "draft",
                  },
                  () => setNewModule(""),
                )
              }
            >
              <Plus size={15} />
            </button>
          </div>
        </aside>
        <main className="crew-builder-editor">
          {selected?.type === "journey" ? (
            <EntityEditor
              title="Journey settings"
              entity={journey}
              table="crew_journeys"
              onRefresh={onRefresh}
              fields={[
                { key: "name", label: "Journey name", value: journey.name },
                { key: "description", label: "Description", value: journey.description || "", type: "textarea" },
                { key: "sequential_modules", label: "Learning sequence", value: journey.sequential_modules, type: "checkbox", help: "Require required modules in order" },
              ]}
            />
          ) : selected?.type === "module" ? (
            <section className="space-y-5">
              <EntityEditor
                title={selected.entity.title}
                entity={selected.entity}
                table="crew_journey_modules"
                onRefresh={onRefresh}
                fields={[
                  { key: "title", label: "Module title", value: selected.entity.title },
                  { key: "description", label: "Description", value: selected.entity.description || "", type: "textarea" },
                  { key: "required", label: "Requirement", value: selected.entity.required, type: "checkbox", help: "Crew must complete this module before later required modules unlock" },
                  { key: "sort_order", label: "Order", value: selected.entity.sort_order, type: "number" },
                ]}
              />
              <section className="crew-module-lessons-editor">
                <div>
                  <p className="text-sm text-text-secondary">Lessons</p>
                  <h3>Module content</h3>
                </div>
                {sortByOrder(selected.entity.lessons).map((lesson, index, lessons) => (
                  <div className="crew-module-lesson-row" key={lesson.id}>
                    <button onClick={() => setSelection({ type: "lesson", id: lesson.id })}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{lesson.title}</strong>
                      <small>{lesson.required ? "Required" : "Optional"}</small>
                    </button>
                    <DraftOrderActions
                      table="crew_lessons"
                      item={lesson}
                      previous={lessons[index - 1]}
                      next={lessons[index + 1]}
                      onRefresh={onRefresh}
                    />
                  </div>
                ))}
                <div className="crew-module-add-lesson">
                  <input
                    className="input"
                    value={newLesson}
                    onChange={(event) => setNewLesson(event.target.value)}
                    placeholder="Lesson title"
                  />
                  <button
                    className="btn-secondary"
                    disabled={!newLesson.trim()}
                    onClick={() =>
                      create(
                        "crew_lessons",
                        {
                          module_id: selected.entity.id,
                          title: newLesson.trim(),
                          sort_order: (selected.entity.lessons?.length || 0) + 1,
                          content_type: "lesson",
                          required: true,
                        },
                        () => setNewLesson(""),
                      )
                    }
                  >
                    <Plus size={15} /> Add lesson
                  </button>
                </div>
              </section>
            </section>
          ) : selected?.type === "lesson" ? (
            <section className="space-y-5">
              <EntityEditor
                title={selected.entity.title}
                entity={selected.entity}
                table="crew_lessons"
                onRefresh={onRefresh}
                fields={[
                  { key: "title", label: "Lesson title", value: selected.entity.title },
                  { key: "estimated_minutes", label: "Estimated minutes", value: selected.entity.estimated_minutes || 0, type: "number" },
                  { key: "required", label: "Requirement", value: selected.entity.required, type: "checkbox", help: "Required lessons gate later required lessons" },
                  { key: "sort_order", label: "Order", value: selected.entity.sort_order, type: "number" },
                ]}
              />
              <div className="crew-builder-blocks">
                {sortByOrder(selected.entity.blocks).map((block, index, blocks) => (
                  <article
                    key={block.id}
                    className={`crew-builder-block is-${block.block_type}`}
                  >
                    <div>
                      <span>{block.block_type.replace("_", " ")}</span>
                      <p>
                        {block.block_type === "sop_reference"
                          ? sops.find((sop) => sop.id === block.payload?.sop_id)
                              ?.title || "SOP reference"
                          : block.payload?.body ||
                            block.payload?.text ||
                            "Content block"}
                      </p>
                    </div>
                    <DraftOrderActions
                      table="crew_lesson_blocks"
                      item={block}
                      previous={blocks[index - 1]}
                      next={blocks[index + 1]}
                      onRefresh={onRefresh}
                    />
                  </article>
                ))}
                {selected.entity.quizzes?.map((quiz) => (
                  <QuizEditor key={quiz.id} quiz={quiz} create={create} />
                ))}
              </div>
              <div className="crew-builder-add">
                <strong>Add content</strong>
                <div>
                  <button
                    className={newBlock === "text" ? "active" : ""}
                    onClick={() => setNewBlock("text")}
                  >
                    Text
                  </button>
                  <button
                    className={newBlock === "key_point" ? "active" : ""}
                    onClick={() => setNewBlock("key_point")}
                  >
                    Key Point
                  </button>
                  <button
                    className={newBlock === "sop_reference" ? "active" : ""}
                    onClick={() => setNewBlock("sop_reference")}
                  >
                    SOP Reference
                  </button>
                  <button
                    className={newBlock === "quiz" ? "active" : ""}
                    onClick={() => setNewBlock("quiz")}
                  >
                    Quiz
                  </button>
                </div>
                {newBlock === "sop_reference" ? (
                  <>
                    <SelectField
                      ariaLabel="Published SOP"
                      value={sopId}
                      onChange={setSopId}
                      placeholder="Choose published SOP"
                      options={sops.filter((sop) => sop.status === "published").map((sop) => ({ value: sop.id, label: sop.title }))}
                    />
                    <button
                      className="btn-secondary"
                      disabled={!sopId}
                      onClick={() =>
                        create(
                          "crew_lesson_blocks",
                          {
                            lesson_id: selected.entity.id,
                            block_type: "sop_reference",
                            payload: { sop_id: sopId, required_acknowledgement: true },
                            sort_order: (selected.entity.blocks?.length || 0) + 1,
                          },
                          () => setSopId(""),
                        )
                      }
                    >
                      Add SOP reference
                    </button>
                  </>
                ) : newBlock === "quiz" ? (
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      create("crew_quizzes", {
                        lesson_id: selected.entity.id,
                        title: `${selected.entity.title} knowledge check`,
                        passing_score: 80,
                        required: true,
                        status: "draft",
                      })
                    }
                  >
                    Create knowledge check
                  </button>
                ) : (
                  <>
                    <textarea
                      className="input min-h-24"
                      value={blockBody}
                      onChange={(event) => setBlockBody(event.target.value)}
                      placeholder={
                        newBlock === "key_point"
                          ? "A memorable standard or instruction"
                          : "Write lesson content"
                      }
                    />
                    <button
                      className="btn-secondary"
                      disabled={!blockBody.trim()}
                      onClick={() =>
                        create(
                          "crew_lesson_blocks",
                          {
                            lesson_id: selected.entity.id,
                            block_type: newBlock,
                            payload: { body: blockBody.trim() },
                            sort_order:
                              (selected.entity.blocks?.length || 0) + 1,
                          },
                          () => setBlockBody(""),
                        )
                      }
                    >
                      Add{" "}
                      {newBlock === "key_point" ? "key point" : "text block"}
                    </button>
                  </>
                )}
              </div>
            </section>
          ) : (
            <Empty
              icon={ListChecks}
              text="Select a module or lesson from the structure."
            />
          )}
        </main>
      </div>
    </div>
  );
}
function DraftOrderActions({ table, item, previous, next, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function move(other) {
    if (!other) return;
    setBusy(true);
    setError("");
    try {
      await crewService.swapDraftOrder(table, item, other);
      await onRefresh();
    } catch (cause) {
      setError(cause.message || "Unable to reorder this draft item.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm("Delete this draft item? This cannot affect published versions.")) return;
    setBusy(true);
    setError("");
    try {
      await crewService.deleteDraftRecord(table, item.id);
      await onRefresh();
    } catch (cause) {
      setError(cause.message || "Unable to delete this draft item.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="crew-draft-order-actions">
      <button className="btn-icon" disabled={busy || !previous} onClick={() => move(previous)} aria-label="Move up">
        <ArrowUp size={15} />
      </button>
      <button className="btn-icon" disabled={busy || !next} onClick={() => move(next)} aria-label="Move down">
        <ArrowDown size={15} />
      </button>
      <button className="btn-icon is-danger" disabled={busy} onClick={remove} aria-label="Delete">
        <Trash2 size={15} />
      </button>
      {error && <small className="text-red-600">{error}</small>}
    </div>
  );
}
function QuizEditor({ quiz, create }) {
  const [prompt, setPrompt] = useState("");
  const questions = sortByOrder(quiz.questions);
  return (
    <section className="crew-quiz-editor">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span>Knowledge check</span>
          <h4>{quiz.title}</h4>
          <p>
            {questions.length} questions · {quiz.passing_score}% passing score ·{" "}
            {quiz.required ? "Required" : "Optional"}
          </p>
        </div>
        <button className="btn-icon" aria-label="Quiz settings">
          <MoreHorizontal size={16} />
        </button>
      </div>
      {questions.map((question, index) => (
        <article key={question.id} className="crew-quiz-question">
          <div className="flex justify-between gap-2">
            <strong>Question {index + 1}</strong>
            <Badge tone="neutral">
              {question.question_type === "multiple_choice"
                ? "Multiple choice"
                : "Single choice"}
            </Badge>
          </div>
          <p>{question.prompt}</p>
          {sortByOrder(question.options).map((option) => (
            <div className="crew-quiz-option" key={option.id}>
              <span>{option.is_correct ? "✓" : "○"}</span>
              {option.label}
              {option.is_correct ? <small>Correct</small> : null}
            </div>
          ))}
        </article>
      ))}
      <div className="flex gap-2">
        <input
          className="input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Add a question"
        />
        <button
          className="btn-secondary"
          disabled={!prompt.trim()}
          onClick={() =>
            create(
              "crew_quiz_questions",
              {
                quiz_id: quiz.id,
                prompt: prompt.trim(),
                question_type: "single_choice",
                sort_order: questions.length + 1,
              },
              () => setPrompt(""),
            )
          }
        >
          Add question
        </button>
      </div>
    </section>
  );
}
function CrewProgress({ assignments, onOpenJourney }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const rows = assignments.filter(
    (item) =>
      (status === "all" || item.status === status) &&
      `${item.employee?.full_name} ${item.journey?.name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="space-y-4">
      <section className="flex flex-wrap gap-3">
        <input
          className="input min-w-64"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search employee or journey"
        />
        <SelectField className="w-44" ariaLabel="Status" value={status} onChange={setStatus} options={[{ value: "all", label: "All" }, { value: "not_started", label: "Not started" }, { value: "in_progress", label: "In progress" }, { value: "completed", label: "Completed" }]} />
      </section>
      <Card
        title="Learning assignments"
        description="Open a journey for its content and assignment context."
      >
        <AssignmentTable
          assignments={rows}
          onOpenJourney={onOpenJourney}
          detailed
        />
      </Card>
    </div>
  );
}
function SopLibrary({ sops, canManage, onCreate, onOpen }) {
  const [filter, setFilter] = useState("all");
  const visible = sops.filter(
    (sop) =>
      filter === "all" ||
      (filter === "published" && sop.status === "published") ||
      (filter === "draft" &&
        sop.versions?.some((version) => version.status === "draft")) ||
      (filter === "ack" &&
        sop.versions?.some((version) => version.require_acknowledgement)),
  );
  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div className="crew-admin-filter">
          <button
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            className={filter === "published" ? "active" : ""}
            onClick={() => setFilter("published")}
          >
            Published
          </button>
          <button
            className={filter === "draft" ? "active" : ""}
            onClick={() => setFilter("draft")}
          >
            Draft available
          </button>
          <button
            className={filter === "ack" ? "active" : ""}
            onClick={() => setFilter("ack")}
          >
            Acknowledgement required
          </button>
        </div>
        {canManage && (
          <button
            className="btn-primary inline-flex items-center gap-2"
            onClick={onCreate}
          >
            <Plus size={16} /> New SOP
          </button>
        )}
      </section>
      <div className="grid gap-3">
        {visible.map((sop) => {
          const current =
            (sop.versions || []).find(
              (version) => version.version === sop.current_version,
            ) ||
            (sop.versions || []).find(
              (version) => version.status === "published",
            );
          const draft = (sop.versions || []).find(
            (version) => version.status === "draft",
          );
          return (
            <article className="crew-admin-sop-row" key={sop.id}>
              <div>
                <div className="flex items-center gap-2">
                  <h2>{sop.title}</h2>
                  <Badge tone={statusTone(sop.status)}>{sop.status}</Badge>
                </div>
                <p>{sop.summary || sop.category}</p>
                <dl>
                  <div>
                    <dt>Current version</dt>
                    <dd>v{current?.version || "—"}</dd>
                  </div>
                  <div>
                    <dt>Acknowledgement</dt>
                    <dd>
                      {current?.require_acknowledgement
                        ? "Required"
                        : "Not required"}
                    </dd>
                  </div>
                  <div>
                    <dt>Draft</dt>
                    <dd>{draft ? `v${draft.version} available` : "None"}</dd>
                  </div>
                </dl>
              </div>
              <button className="btn-primary" onClick={() => onOpen(sop.id)}>
                Open SOP
              </button>
            </article>
          );
        })}
        {!visible.length && (
          <Empty icon={BookOpenCheck} text="No SOPs match this filter." />
        )}
      </div>
    </div>
  );
}
function SopDetail({
  sop,
  journeys,
  canManage,
  saving,
  onBack,
  onNewVersion,
  onPublish,
  onRefresh,
}) {
  const [tab, setTab] = useState("content");
  const versions = [...(sop.versions || [])].sort(
    (a, b) => b.version - a.version,
  );
  const active =
    versions.find((version) => version.status === "draft") ||
    versions.find((version) => version.status === "published");
  return (
    <div className="space-y-5">
      <button
        className="btn-ghost inline-flex items-center gap-2"
        onClick={onBack}
      >
        <ArrowLeft size={16} /> SOP Library
      </button>
      <section className="crew-admin-detail-head">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(active?.status)}>
              {active?.status || sop.status}
            </Badge>
            <span className="text-sm text-text-secondary">
              v{active?.version || "—"}
            </span>
          </div>
          <h2>{sop.title}</h2>
          <p>{sop.summary || sop.category}</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            {active?.status === "draft" && (
              <button
                className="btn-primary"
                disabled={saving}
                onClick={() => onPublish(active)}
              >
                Publish v{active.version}
              </button>
            )}
            {active?.status === "published" && (
              <button
                className="btn-primary"
                disabled={saving}
                onClick={onNewVersion}
              >
                Create new version
              </button>
            )}
          </div>
        )}
      </section>
      <Tabs
        active={tab}
        setActive={setTab}
        tabs={["content", "versions", "usage"]}
      />
      {tab === "content" ? (
        <SopDocumentEditor
          version={active}
          editable={active?.status === "draft" && canManage}
          onRefresh={onRefresh}
        />
      ) : tab === "versions" ? (
        <div className="grid gap-3">
          {versions.map((version) => (
            <article key={version.id} className="crew-admin-version">
              <div>
                <Badge tone={statusTone(version.status)}>
                  {version.status}
                </Badge>
                <h3>v{version.version}</h3>
                <p>
                  {version.published_at
                    ? `Published ${formatDate(version.published_at)}`
                    : "Editable draft"}
                </p>
              </div>
              <span>
                {version.require_acknowledgement
                  ? "Acknowledgement required"
                  : "No acknowledgement"}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <Card
          title="Usage"
          description="Published SOPs can be referenced by journeys without exposing editable live content."
        >
          <div className="divide-y divide-border">
            {journeys
              .filter((journey) => JSON.stringify(journey).includes(sop.id))
              .map((journey) => (
                <div className="py-3" key={journey.id}>
                  <strong>{journey.name}</strong>
                  <p className="text-sm text-text-secondary">
                    v{journey.version}
                  </p>
                </div>
              ))}
            <p className="text-sm text-text-secondary">
              Usage is limited to data visible through existing authenticated
              RLS.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
function SopDocumentEditor({ version, editable, onRefresh }) {
  const orderedSections = sortByOrder(version?.sections);
  const [selectedId, setSelectedId] = useState(orderedSections[0]?.id || "new");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const first = sortByOrder(version?.sections)[0]?.id || "new";
    setSelectedId((current) =>
      version?.sections?.some((section) => section.id === current) ? current : first,
    );
  }, [version?.id, version?.sections]);
  if (!version)
    return (
      <Empty
        icon={FileText}
        text="Create a version to start writing this SOP."
      />
    );
  async function addSection() {
    if (!title.trim()) return;
    setAdding(true);
    setError("");
    try {
      const section = await crewService.saveDraftRecord("crew_sop_sections", {
        sop_version_id: version.id,
        title: title.trim(),
        body: body.trim(),
        sort_order: (version.sections?.length || 0) + 1,
        key_point: false,
      });
      setTitle("");
      setBody("");
      setSelectedId(section.id);
      await onRefresh();
    } catch (cause) {
      setError(cause.message || "Unable to add this section.");
    } finally {
      setAdding(false);
    }
  }
  const selected = orderedSections.find((section) => section.id === selectedId);
  return (
    <div className="crew-sop-editor">
      <aside>
        <div className="crew-sop-outline-heading">
          <strong>Section outline</strong>
          <span>{orderedSections.length}</span>
        </div>
        {orderedSections.map((section, index) => (
          <button
            key={section.id}
            className={selectedId === section.id ? "is-selected" : ""}
            onClick={() => setSelectedId(section.id)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {section.title}
          </button>
        ))}
        {editable && (
          <button className="is-add" onClick={() => setSelectedId("new")}>
            <Plus size={15} /> Add section
          </button>
        )}
      </aside>
      <main>
        <p className="text-sm text-text-secondary">
          {editable ? "Draft document" : "Published document · read only"}
        </p>
        {!editable && selected ? (
          <article className={selected.key_point ? "is-key" : ""}>
            <h3>{selected.title}</h3>
            <p>{selected.body}</p>
            {selected.key_point && <span>Key point</span>}
          </article>
        ) : editable && selected ? (
          <section className="space-y-4">
            <EntityEditor
              title={selected.title}
              entity={selected}
              table="crew_sop_sections"
              onRefresh={onRefresh}
              fields={[
                { key: "title", label: "Section title", value: selected.title },
                { key: "body", label: "Section content", value: selected.body || "", type: "textarea" },
                { key: "key_point", label: "Key point", value: selected.key_point, type: "checkbox", help: "Highlight this section as a key operational point" },
              ]}
            />
            <div className="crew-sop-section-order">
              <span>Section position</span>
              <DraftOrderActions
                table="crew_sop_sections"
                item={selected}
                previous={orderedSections[orderedSections.indexOf(selected) - 1]}
                next={orderedSections[orderedSections.indexOf(selected) + 1]}
                onRefresh={onRefresh}
              />
            </div>
          </section>
        ) : editable ? (
          <section className="crew-sop-new-section">
            <div>
              <h3>Add section</h3>
              <p>Write one clear procedure or standard at a time.</p>
            </div>
            <input
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="New section title"
            />
            <textarea
              className="input min-h-28"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write the procedure or guidance"
            />
            <button
              className="btn-primary"
              disabled={adding || !title.trim()}
              onClick={addSection}
            >
              {adding ? "Adding…" : "Add section"}
            </button>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </section>
        ) : (
          <Empty icon={FileText} text="This published SOP has no sections." />
        )}
      </main>
    </div>
  );
}
function AssignFlow({
  values,
  setValues,
  employees,
  journey,
  onClose,
  onSave,
  saving,
}) {
  const change = (next) => setValues({ ...values, ...next });
  const selected = new Set(values.employeeIds);
  const toggle = (id) =>
    change({
      employeeIds: selected.has(id)
        ? values.employeeIds.filter((item) => item !== id)
        : [...values.employeeIds, id],
    });
  const activeEmployees = employees.filter(
    (employee) =>
      employee.employment_status !== "resigned" &&
      employee.employment_status !== "terminated",
  );
  return (
    <div className="modal-backdrop">
      <section className="modal-content w-full max-w-3xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-primary">
              Step {values.step} of 2
            </p>
            <h2 className="text-xl font-bold text-text-primary">
              {values.step === 1 ? "Select Crew" : "Review assignment"}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {values.step === 1
                ? "Choose the Crew members who should receive this published journey."
                : "Confirm the journey, Crew selection and optional due date."}
            </p>
          </div>
          <button
            className="btn-icon"
            onClick={onClose}
            aria-label="Close assignment flow"
          >
            ×
          </button>
        </div>
        {values.step === 1 ? (
          <div className="mt-5">
            <div className="mb-3 flex justify-between">
              <span className="text-sm text-text-secondary">
                {values.employeeIds.length} selected
              </span>
              <button
                className="btn-ghost"
                onClick={() =>
                  change({
                    employeeIds: activeEmployees.map((employee) => employee.id),
                  })
                }
              >
                Select all active
              </button>
            </div>
            <div className="max-h-96 divide-y overflow-auto rounded-xl border border-border">
              {activeEmployees.map((employee) => (
                <label
                  key={employee.id}
                  className="flex cursor-pointer items-center gap-3 p-3"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(employee.id)}
                    onChange={() => toggle(employee.id)}
                  />
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {employee.full_name?.slice(0, 1)}
                  </span>
                  <span className="flex-1">
                    <strong className="block text-sm">
                      {employee.full_name}
                    </strong>
                    <small>
                      {employee.position || "Crew"} ·{" "}
                      {employee.workplace || "No outlet"}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl bg-slate-50 p-4">
              <span className="text-xs text-text-secondary">Journey</span>
              <strong className="mt-1 block">
                {journey?.name} · v{journey?.version}
              </strong>
              <p className="mt-1 text-sm text-text-secondary">
                {values.employeeIds.length} Crew members selected
              </p>
            </div>
            <label className="block text-sm font-semibold">
              Due date{" "}
              <input
                className="input mt-1 w-full"
                type="date"
                value={values.dueAt}
                onChange={(event) => change({ dueAt: event.target.value })}
              />
            </label>
          </div>
        )}
        <div className="mt-6 flex justify-between">
          <button
            className="btn-secondary"
            onClick={values.step === 1 ? onClose : () => change({ step: 1 })}
          >
            {values.step === 1 ? "Cancel" : "Back"}
          </button>
          {values.step === 1 ? (
            <button
              className="btn-primary"
              disabled={!values.employeeIds.length}
              onClick={() => change({ step: 2 })}
            >
              Continue
            </button>
          ) : (
            <button className="btn-primary" disabled={saving} onClick={onSave}>
              {saving ? "Assigning…" : "Confirm assignment"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
function RootDraftModal({ draft, setDraft, onSave, saving }) {
  const values = draft.values;
  const journey = draft.kind === "journey";
  const change = (key, value) =>
    setDraft({ ...draft, values: { ...values, [key]: value } });
  return (
    <div className="modal-backdrop">
      <section className="modal-content w-full max-w-lg p-6">
        <h2 className="text-xl font-bold text-text-primary">
          {journey ? "Create journey" : "Create SOP"}
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          This starts an editable draft. Published content is never edited in
          place.
        </p>
        <div className="mt-5 grid gap-4">
          <label className="text-sm font-semibold">
            {journey ? "Journey name" : "SOP title"}
            <input
              className="input mt-1 w-full"
              value={journey ? values.name : values.title}
              onChange={(event) =>
                change(journey ? "name" : "title", event.target.value)
              }
            />
          </label>
          {journey ? (
            <>
              <label className="text-sm font-semibold">
                Description
                <textarea
                  className="input mt-1 min-h-24 w-full"
                  value={values.description}
                  onChange={(event) =>
                    change("description", event.target.value)
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(values.sequential_modules)}
                  onChange={(event) =>
                    change("sequential_modules", event.target.checked)
                  }
                />{" "}
                Require modules in order
              </label>
            </>
          ) : (
            <>
              <label className="text-sm font-semibold">
                Category
                <input
                  className="input mt-1 w-full"
                  value={values.category}
                  onChange={(event) => change("category", event.target.value)}
                />
              </label>
              <label className="text-sm font-semibold">
                Summary
                <textarea
                  className="input mt-1 min-h-24 w-full"
                  value={values.summary}
                  onChange={(event) => change("summary", event.target.value)}
                />
              </label>
            </>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setDraft(null)}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={saving || !(journey ? values.name : values.title)?.trim()}
            onClick={() => onSave(draft.kind, values)}
          >
            {saving ? "Saving…" : "Create draft"}
          </button>
        </div>
      </section>
    </div>
  );
}
function Tabs({ active, setActive, tabs }) {
  return (
    <div className="crew-admin-tabs">
      {tabs.map((tab) => (
        <button
          key={tab}
          className={active === tab ? "active" : ""}
          onClick={() => setActive(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
function ContentPreview({ journey }) {
  return (
    <div className="space-y-3">
      {sortByOrder(journey.modules).map((module) => (
        <Card
          key={module.id}
          title={`${module.sort_order}. ${module.title}`}
          description={module.required ? "Required module" : "Optional module"}
        >
          {sortByOrder(module.lessons).map((lesson) => (
            <div
              className="flex items-center justify-between border-t py-3 text-sm"
              key={lesson.id}
            >
              <span>
                {lesson.sort_order}. {lesson.title}
              </span>
              <span className="text-text-secondary">
                {lesson.blocks?.length || 0} blocks ·{" "}
                {lesson.quizzes?.length || 0} quiz
              </span>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
function AssignmentTable({ assignments, onOpenJourney, detailed = false }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-180 text-left text-sm">
        <thead>
          <tr className="border-b text-xs text-text-secondary">
            <th className="p-3">Employee</th>
            <th className="p-3">Journey</th>
            {detailed && (
              <>
                <th className="p-3">Progress</th>
                <th className="p-3">Current state</th>
              </>
            )}
            <th className="p-3">Due</th>
            <th className="p-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((item) => (
            <tr className="border-b border-border/70" key={item.id}>
              <td className="p-3 font-semibold">
                {item.employee?.full_name || "Employee"}
              </td>
              <td className="p-3">
                {onOpenJourney ? (
                  <button
                    className="font-semibold text-primary hover:underline"
                    onClick={() => onOpenJourney(item.journey_id)}
                  >
                    {item.journey?.name} · v{item.journey?.version}
                  </button>
                ) : (
                  `${item.journey?.name || "Journey"} · v${item.journey?.version}`
                )}
              </td>
              {detailed && (
                <>
                  <td className="p-3">
                    <div className="crew-inline-progress">
                      <span
                        style={{
                          width:
                            item.status === "completed"
                              ? "100%"
                              : item.status === "in_progress"
                                ? "50%"
                                : "0%",
                        }}
                      />
                    </div>
                  </td>
                  <td className="p-3 text-text-secondary">
                    {item.status === "not_started"
                      ? "Ready to start"
                      : item.status === "in_progress"
                        ? "Learning in progress"
                        : "Completed"}
                  </td>
                </>
              )}
              <td className="p-3 text-text-secondary">
                {formatDate(item.due_at)}
              </td>
              <td className="p-3">
                <Badge tone={statusTone(item.status)}>
                  {item.status.replace("_", " ")}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!assignments.length && (
        <p className="p-5 text-sm text-text-secondary">
          No assignments match this view.
        </p>
      )}
    </div>
  );
}
function VersionSummary({ journey }) {
  return (
    <Card
      title="Version history"
      description="Published versions remain immutable. A new version is a new editable draft."
    >
      <div className="flex items-center justify-between rounded-lg bg-slate-50 p-4">
        <div>
          <strong>v{journey.version}</strong>
          <p className="text-sm text-text-secondary">
            {journey.status === "published"
              ? "Current live version"
              : "Editable draft"}
          </p>
        </div>
        <Badge tone={statusTone(journey.status)}>{journey.status}</Badge>
      </div>
    </Card>
  );
}
function HealthBar({ label, value, total, tone }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className={`crew-health-bar is-${tone}`}>
        <span style={{ width: `${total ? (value / total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}
function DetailMetric({ label, value }) {
  return (
    <div className="crew-detail-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
function EntityEditor({ title, entity, table, fields, onRefresh }) {
  if (!entity)
    return (
      <section className="crew-entity-editor">
        <p className="text-sm text-text-secondary">Selected item</p>
        <h3>{title}</h3>
        {fields.map((field) => (
          <label key={field.label}>
            {field.label}
            <input className="input" value={field.value ?? ""} readOnly />
          </label>
        ))}
      </section>
    );
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.value])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(
    () =>
      setValues(
        Object.fromEntries(fields.map((field) => [field.key, field.value])),
      ),
    [entity.id],
  );
  async function save() {
    setSaving(true);
    setError("");
    try {
      await crewService.saveDraftRecord(table, { id: entity.id, ...values });
      await onRefresh();
    } catch (cause) {
      setError(cause.message || "Unable to save this draft.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="crew-entity-editor">
      <p className="text-sm text-text-secondary">Selected item · draft only</p>
      <h3>{title}</h3>
      {fields.map((field) => (
        <label key={field.key}>
          {field.label}
          {field.type === "checkbox" ? (
            <span className="mt-1 flex items-center gap-2 text-sm font-normal">
              <input
                type="checkbox"
                checked={Boolean(values[field.key])}
                onChange={(event) =>
                  setValues({ ...values, [field.key]: event.target.checked })
                }
              />{" "}
              {field.help}
            </span>
          ) : field.type === "textarea" ? (
            <textarea
              className="input min-h-28"
              value={values[field.key] ?? ""}
              onChange={(event) =>
                setValues({ ...values, [field.key]: event.target.value })
              }
            />
          ) : (
            <input
              className="input"
              type={field.type || "text"}
              value={values[field.key] ?? ""}
              onChange={(event) =>
                setValues({
                  ...values,
                  [field.key]:
                    field.type === "number"
                      ? Number(event.target.value)
                      : event.target.value,
                })
              }
            />
          )}
        </label>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="mt-5 flex items-center gap-3">
        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save draft"}
        </button>
        <span className="text-xs text-text-secondary">
          Publishing will freeze this version for Crew assignments.
        </span>
      </div>
    </section>
  );
}
function Empty({ icon: Icon, text }) {
  return (
    <div className="grid min-h-48 place-items-center gap-2 rounded-xl bg-slate-50 p-8 text-center text-sm text-text-secondary">
      <Icon size={23} className="text-primary" />
      {text}
    </div>
  );
}
function Loading() {
  return (
    <div className="grid min-h-72 place-items-center">
      <div className="text-sm font-semibold text-text-secondary">
        Loading learning workspace…
      </div>
    </div>
  );
}

export { JourneyBuilder, SopDetail, Tabs };
function lessonCount(journey) {
  return (journey.modules || []).reduce(
    (total, module) => total + (module.lessons?.length || 0),
    0,
  );
}
function quizCount(journey) {
  return (journey.modules || []).reduce(
    (total, module) =>
      total +
      (module.lessons || []).reduce(
        (lessonTotal, lesson) => lessonTotal + (lesson.quizzes?.length || 0),
        0,
      ),
    0,
  );
}
function resolveBuilderSelection(journey, selection) {
  if (!selection) return null;
  if (selection.type === "journey") return { type: "journey", entity: journey };
  for (const module of journey.modules || []) {
    if (selection.type === "module" && module.id === selection.id)
      return { type: "module", entity: module };
    for (const lesson of module.lessons || [])
      if (selection.type === "lesson" && lesson.id === selection.id)
        return { type: "lesson", entity: lesson };
  }
  return null;
}
