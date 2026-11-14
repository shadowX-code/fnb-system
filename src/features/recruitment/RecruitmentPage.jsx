import {
  invitationAction,
  currentInvitation,
} from "./invitationPresentation.js";
import AdminSummaryGrid from "../../components/ui/AdminSummaryGrid.jsx";
import AdminFilterToolbar from "../../components/layout/AdminFilterToolbar.jsx";
import {
  BriefcaseBusiness,
  Users,
  AudioLines,
  ClipboardCheck,
} from "lucide-react";
import DataTable from "../../components/tables/DataTable.jsx";
import {
  preferenceLabels,
  interviewStateLabel,
  formatRecruitmentTime,
} from "./candidateOperations.js";
import OpeningForm, { initialOpening } from "./OpeningForm.jsx";
import { useEffect, useState } from "react";
import SelectField from "../../components/forms/SelectField.jsx";
import AdminSearchField from "../../components/forms/AdminSearchField.jsx";
import ActionMenu from "../../components/ui/ActionMenu.jsx";
import PageHeader from "../../components/layout/PageHeader.jsx";
import {
  RecruitmentSection,
  RecruitmentEmpty,
  RecruitmentState,
  OpeningPlan,
  CandidateFitSummary,
} from "./RecruitmentPresentation.jsx";
import Modal from "../../components/feedback/Modal.jsx";
import AdminSegmentedControl from "../../components/forms/AdminSegmentedControl.jsx";
import AdminFormField from "../../components/forms/AdminFormField.jsx";
import RecruitmentVoiceLab, {
  voiceLabAvailable,
} from "./RecruitmentVoiceLab.jsx";
import InterviewProfileSettings from "./InterviewProfileSettings.jsx";
import RecruitmentEvidenceReview from "./RecruitmentEvidenceReview.jsx";
import { recruitmentService } from "./recruitmentService.js";

const fieldClass = "control w-full";
const stages = {
  registered: "Registered",
  invited: "Invited",
  interviewing: "Interviewing",
  needs_review: "Needs review",
  shortlisted: "Shortlisted",
  final_interview: "Final interview",
  rejected: "Rejected",
  hired: "Hired",
};
const filterOptions = [
  "all",
  "invited",
  "interviewing",
  "needs_review",
  "shortlisted",
  "rejected",
].map((value) => ({ value, label: value === "all" ? "All" : stages[value] }));
const pipeline = [
  { key: "total", label: "Candidates" },
  { key: "invited", label: "Invited" },
  { key: "interviewing", label: "Interviewing" },
  { key: "needs_review", label: "Needs review" },
  { key: "shortlisted", label: "Shortlisted" },
];
const eventLabels = {
  opening_saved: "Opening updated",
  application_registered: "Application registered",
  invitation_issued: "Invitation issued",
  invitation_revoked: "Invitation revoked",
  interview_finalized: "Interview saved",
  manager_decision: "Application decision",
};

export default function RecruitmentPage({ auth }) {
  const [data, setData] = useState(null),
    [openingId, setOpeningId] = useState(null),
    [tab, setTab] = useState("candidates");
  const [stage, setStage] = useState("all"),
    [page, setPage] = useState(1),
    [includeQa, setIncludeQa] = useState(false),
    [includeClosed, setIncludeClosed] = useState(false);
  const [search, setSearch] = useState(""),
    [statusFilter, setStatusFilter] = useState("open"),
    [workplaceFilter, setWorkplaceFilter] = useState("all"),
    [positionFilter, setPositionFilter] = useState("all");
  const [voiceLabOpen, setVoiceLabOpen] = useState(
    new URLSearchParams(window.location.search).get("voiceLab") === "1",
  );
  const [formOpening, setFormOpening] = useState(undefined),
    [profilesOpen, setProfilesOpen] = useState(false),
    [resumeProfileDraft, setResumeProfileDraft] = useState(null),
    [resumeProfileJob, setResumeProfileJob] = useState(null),
    [applicationForm, setApplicationForm] = useState(false);
  const [selectedOpening, setSelectedOpening] = useState(""),
    [selectedApplicant, setSelectedApplicant] = useState(""),
    [applicantQuery, setApplicantQuery] = useState(""),
    [applicantResults, setApplicantResults] = useState([]);
  const [applicant, setApplicant] = useState({
      full_name: "",
      contact: "",
      email: "",
    }),
    [reviewApplication, setReviewApplication] = useState(null),
    [invitation, setInvitation] = useState("");
  const [issuedLinks, setIssuedLinks] = useState({}),
    [addedCandidate, setAddedCandidate] = useState(null),
    [copied, setCopied] = useState(false);
  const [actionMenuId, setActionMenuId] = useState(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const canManage = Boolean(
    auth?.hasPermission?.("recruitment.manage") ||
      auth?.permissions?.includes?.("recruitment.manage"),
  );
  const [candidateSearch, setCandidateSearch] = useState(""),
    [offeringFilter, setOfferingFilter] = useState("all");
  const query = {
    openingId,
    stage,
    page,
    includeQa,
    search: candidateSearch,
    offering: offeringFilter,
  };
  async function load() {
    const next = await recruitmentService.workspace(query);
    setData(next);
  }
  useEffect(() => {
    let active = true;
    setLoading(!data);
    setError("");
    recruitmentService
      .workspace(query)
      .then((next) => {
        if (active) setData(next);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [openingId, stage, page, includeQa, candidateSearch, offeringFilter]);
  useEffect(() => {
    if (!applicationForm || applicantQuery.trim().length < 2) {
      setApplicantResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(
      () =>
        recruitmentService
          .findApplicants(applicantQuery.trim())
          .then((rows) => {
            if (active) setApplicantResults(rows);
          })
          .catch((e) => {
            if (active) setError(e.message);
          }),
      250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [applicationForm, applicantQuery]);
  async function mutate(action) {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      await load();
      return result;
    } catch (e) {
      setError(e.message || "Action failed.");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  function selectOpening(id) {
    setCandidateSearch("");
    setOfferingFilter("all");
    setOpeningId(id);
    setSelectedOpening(id || "");
    setTab("candidates");
    setStage("all");
    setPage(1);
  }
  function closeJobForm() {
    setFormOpening(undefined);
    if (resumeProfileDraft) setProfilesOpen(true);
  }
  async function register(e) {
    e.preventDefault();
    try {
      const applicationId = await mutate(() =>
        recruitmentService.registerApplication(
          selectedOpening,
          applicant,
          selectedApplicant || null,
        ),
      );
      setAddedCandidate({
        id: applicationId,
        name: selectedApplicant
          ? applicantResults.find((a) => a.id === selectedApplicant)
              ?.full_name || "Candidate"
          : applicant.full_name,
      });
      setApplicationForm(false);
      setOpeningId(selectedOpening);
      setStage("all");
      setPage(1);
      setTab("candidates");
    } catch {
      /* visible error */
    }
  }
  async function issue(row) {
    try {
      const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      const token = await mutate(() =>
        recruitmentService.issueInvitation(row.id, expiresAt),
      );
      const origin = import.meta.env.VITE_INTERVIEW_WEB_APP_HOSTNAME
        ? `https://${import.meta.env.VITE_INTERVIEW_WEB_APP_HOSTNAME}`
        : ["os.feedx.my", "feedx-os.vercel.app"].includes(
              window.location.hostname,
            )
          ? "https://interview.feedx.my"
          : window.location.origin;
      const link = {
        url: `${origin}/i/${token}`,
        expiresAt,
        applicationId: row.id,
        name: row.name,
      };
      setIssuedLinks((current) => ({ ...current, [row.id]: link }));
      setInvitation(link);
      setCopied(false);
      setAddedCandidate(null);
    } catch {
      /* visible error */
    }
  }
  async function copyLink(link) {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(link.url);
    } catch {
      setError("Could not copy automatically. Select and copy the link below.");
    }
  }
  function candidateAction(row, action) {
    if (action === "issue") return issue(row);
    if (action === "copy") {
      const link = currentInvitation(row, issuedLinks);
      setCopied(false);
      if (link) {
        setInvitation(link);
        copyLink(link);
      } else
        setInvitation({
          applicationId: row.id,
          name: row.name,
          expiresAt: row.expires_at,
        });
      return;
    }
    setReviewApplication(row);
  }
  const opening = data?.openings.find((o) => o.id === openingId);
  const profile = data?.profiles.find(
    (p) => p.id === opening?.config.interview_profile_id,
  );
  const employer =
    opening?.employer_name ||
    data?.legal_entities.find((e) => e.id === opening?.legal_entity_id)?.name ||
    "Employer";
  const visibleOpenings = (data?.openings || []).filter(
    (o) =>
      (includeClosed || o.status !== "closed") &&
      (statusFilter === "all" || o.status === statusFilter) &&
      (workplaceFilter === "all" || o.workplace === workplaceFilter) &&
      (positionFilter === "all" || o.position_id === positionFilter) &&
      `${o.title} ${o.workplace} ${o.position_name || ""} ${o.profile?.name || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  function attention(stageValue, id = openingId) {
    if (id !== openingId) selectOpening(id);
    setStage(stageValue);
    setPage(1);
    setTab("candidates");
  }
  const activity = (
    <ul className="divide-y divide-border">
      {data?.activity.map((e, i) => (
        <li key={i} className="py-3 text-sm">
          <p>
            {eventLabels[e.action] || "Recruitment updated"}
            {e.candidate ? ` · ${e.candidate}` : ""}
          </p>
          <time className="text-xs text-text-secondary">
            {new Date(e.occurred_at).toLocaleString()}
          </time>
        </li>
      ))}
    </ul>
  );
  if (voiceLabOpen && canManage && voiceLabAvailable())
    return (
      <div className="recruitment-workspace">
        <RecruitmentVoiceLab onClose={() => setVoiceLabOpen(false)} />
      </div>
    );
  if (profilesOpen && data)
    return (
      <div className="recruitment-workspace">
        <InterviewProfileSettings
          profiles={data.profiles}
          positions={data.positions}
          openings={data.openings}
          onJobFacts={(job, profileDraft) => {
            setResumeProfileDraft(profileDraft.id);
            setProfilesOpen(false);
            setFormOpening(job || {
              ...initialOpening,
              position_id: profileDraft.position_id || "",
              title: profileDraft.name,
            });
          }}
          resumeDraftId={resumeProfileDraft}
          resumeJobId={resumeProfileJob}
          busy={busy}
          canManage={canManage}
          onPublish={(id, revision) =>
            mutate(() => recruitmentService.publishProfileDraft(id, revision))
          }
          onClose={() => {setResumeProfileDraft(null);setResumeProfileJob(null);setProfilesOpen(false);}}
        />
      </div>
    );
  if (formOpening !== undefined && data)
    return (
      <div className="recruitment-workspace">
        <PageHeader
          breadcrumbs={[
            { label: resumeProfileDraft ? "Interview Profiles" : "Recruitment", onClick: closeJobForm },
            { label: formOpening ? "Edit job" : "Create Job" },
          ]}
          title={formOpening ? "Edit job opening" : "Create Job"}
          description="Set employment terms and choose how candidates are interviewed."
        />
        <OpeningForm
          opening={formOpening}
          data={data}
          busy={busy}
          onSave={async (o) => {
            const id = await mutate(() => recruitmentService.saveOpening(o));
            if (resumeProfileDraft) {
              setResumeProfileJob(id);
              if (/^QA([ :_-]|$)/i.test(o.title)) setIncludeQa(true);
            }
          }}
          onClose={closeJobForm}
        />
      </div>
    );
  return (
    <div className="recruitment-workspace">
      <PageHeader
        breadcrumbs={
          opening
            ? [
                { label: "Recruitment", onClick: () => selectOpening(null) },
                { label: opening.title },
              ]
            : undefined
        }
        metadata={
          opening ? (
            <>
              <RecruitmentState value={opening.status} />
              <span>
                {(opening.config.employment_offerings || [])
                  .map(
                    (o) =>
                      preferenceLabels[o.employment_type] ||
                      o.employment_type?.replaceAll("_", " "),
                  )
                  .join(" + ")}
              </span>
              <span>
                {profile
                  ? `${profile.name} v${profile.version}`
                  : "Opening interview plan"}
              </span>
            </>
          ) : null
        }
        section={opening ? undefined : "People"}
        title={opening?.title || "Recruitment"}
        description={
          opening
            ? `${opening.workplace} · ${employer}`
            : "Open roles and candidates, ready for your next decision."
        }
        secondaryActions={
          !openingId ? (
            <div className="flex gap-2">
              {canManage && voiceLabAvailable() && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setVoiceLabOpen(true)}
                >
                  Voice Lab
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setProfilesOpen(true)}
              >
                Interview Profiles
              </button>
            </div>
          ) : null
        }
        primaryActions={
          canManage ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() =>
                openingId ? setApplicationForm(true) : setFormOpening(null)
              }
            >
              {openingId ? "Add candidate" : "Create Job"}
            </button>
          ) : null
        }
      />
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {!openingId && data && (
        <AdminSummaryGrid
          ariaLabel="Recruitment summary"
          items={[
            {
              label: "Open jobs",
              value: data.summary.open_roles,
              icon: BriefcaseBusiness,
            },
            {
              label: "Active candidates",
              value: data.summary.active_candidates ?? "—",
              helper: "Excludes hired and rejected",
              icon: Users,
            },
            {
              label: "Interviewing",
              value: data.summary.interviewing,
              icon: AudioLines,
            },
            {
              label: "Needs review",
              value: data.summary.needs_review,
              icon: ClipboardCheck,
              tone: data.summary.needs_review ? "warning" : "neutral",
            },
          ]}
        />
      )}
      {loading ? (
        <div
          role="status"
          className="recruitment-section p-6 text-sm text-text-secondary"
        >
          Loading Recruitment…
        </div>
      ) : !data ? (
        <button
          className="btn-secondary"
          onClick={() => load().catch((e) => setError(e.message))}
        >
          Retry
        </button>
      ) : !openingId ? (
        <>
          <AdminFilterToolbar
            compact
            denseFields
            ariaLabel="Job filters"
            search={
              <AdminSearchField
                label="Search openings"
                ariaLabel="Search openings"
                placeholder="Search openings…"
                value={search}
                onChange={setSearch}
              />
            }
            filters={
              <>
                <SelectField
                  label="Status"
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(value)}
                  ariaLabel="Opening status"
                  placeholder="All"
                  options={[
                    { value: "all", label: "All" },
                    { value: "open", label: "Open" },
                    { value: "draft", label: "Draft" },
                    ...(includeClosed
                      ? [{ value: "closed", label: "Closed" }]
                      : []),
                  ]}
                />
                <SelectField
                  label="Workplace"
                  value={workplaceFilter}
                  onChange={(value) => setWorkplaceFilter(value)}
                  ariaLabel="Workplace filter"
                  placeholder="All"
                  searchable
                  options={[
                    { value: "all", label: "All" },
                    ...[...new Set(data.openings.map((o) => o.workplace))].map(
                      (w) => ({ value: w, label: w }),
                    ),
                  ]}
                />
                <SelectField
                  label="Position"
                  value={positionFilter}
                  onChange={(value) => setPositionFilter(value)}
                  ariaLabel="Position filter"
                  placeholder="All"
                  searchable
                  options={[
                    { value: "all", label: "All" },
                    ...data.positions
                      .filter((p) =>
                        data.openings.some((o) => o.position_id === p.id),
                      )
                      .map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
              </>
            }
            moreFilters={
              <div className="grid gap-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="admin-checkbox"
                    checked={includeClosed}
                    onChange={(e) => {
                      setIncludeClosed(e.target.checked);
                      if (!e.target.checked) setStatusFilter("all");
                    }}
                  />
                  Include closed
                </label>
                <label className="flex items-center gap-2 ml-auto">
                  <input
                    type="checkbox"
                    className="admin-checkbox"
                    checked={includeQa}
                    onChange={(e) => setIncludeQa(e.target.checked)}
                  />
                  Include QA openings
                </label>
              </div>
            }
          />
          <div className="recruitment-layout">
            <RecruitmentSection
              title={
                includeClosed
                  ? "All jobs"
                  : statusFilter === "open"
                    ? "Open jobs"
                    : "Jobs"
              }
              className="is-list"
              description={`${visibleOpenings.length} ${visibleOpenings.length === 1 ? "opening" : "openings"} in this view`}
            >
              <DataTable
                density="compact"
                minWidth={700}
                rows={visibleOpenings}
                onRowClick={(o) => selectOpening(o.id)}
                getRowKey={(o) => o.id}
                tableClassName="recruitment-jobs-table"
                columns={[
                  {
                    key: "job",
                    header: "Job",
                    render: (o) => (
                      <div>
                        <button
                          type="button"
                          className="btn-ghost !p-0 font-semibold text-left"
                          aria-label={`Open opening: ${o.title}`}
                          onClick={() => selectOpening(o.id)}
                        >
                          {o.title}
                        </button>
                        <p className="text-xs text-text-secondary mt-1">
                          {o.profile
                            ? `${o.profile.name} v${o.profile.version}`
                            : "Interview plan"}
                        </p>
                      </div>
                    ),
                  },
                  {
                    key: "workplace",
                    header: "Workplace",
                    render: (o) => (
                      <div>
                        <span>{o.workplace}</span>
                        <p className="text-xs text-text-secondary mt-1">
                          {(o.config.employment_offerings || [])
                            .map((f) => f.employment_type?.replaceAll("_", " "))
                            .join(" · ") || "Offerings not configured"}
                        </p>
                      </div>
                    ),
                  },
                  {
                    key: "candidates",
                    header: "Candidates",
                    render: (o) => o.pipeline.total,
                  },
                  {
                    key: "interviewing",
                    header: "Interviewing",
                    render: (o) => o.pipeline.interviewing,
                  },
                  {
                    key: "review",
                    header: "Needs review",
                    render: (o) =>
                      o.pipeline.needs_review ? (
                        <button
                          className="btn-ghost !p-0"
                          onClick={() => attention("needs_review", o.id)}
                        >
                          <RecruitmentState value="needs_review">
                            {o.pipeline.needs_review} Review →
                          </RecruitmentState>
                        </button>
                      ) : (
                        <span className="text-text-muted">0</span>
                      ),
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (o) => <RecruitmentState value={o.status} />,
                  },
                ]}
              />
              {!visibleOpenings.length && (
                <div className="px-5">
                  <RecruitmentEmpty>
                    {data.openings.length
                      ? "No openings match these filters. Adjust your search or filters."
                      : "No openings yet. Create an opening to begin recruitment."}
                  </RecruitmentEmpty>
                </div>
              )}
            </RecruitmentSection>
            <aside className="grid gap-5">
              <RecruitmentSection title="Needs attention">
                {data.openings
                  .filter((o) => includeClosed || o.status !== "closed")
                  .flatMap((o) =>
                    [
                      o.pipeline.needs_review > 0 && {
                        opening: o,
                        stage: "needs_review",
                        count: o.pipeline.needs_review,
                        label: "Interviews ready for review",
                      },
                      o.pipeline.invited > 0 && {
                        opening: o,
                        stage: "invited",
                        count: o.pipeline.invited,
                        label: "Invitation follow-up",
                      },
                    ].filter(Boolean),
                  )
                  .sort(
                    (a, b) =>
                      (a.stage === "needs_review" ? 0 : 1) -
                      (b.stage === "needs_review" ? 0 : 1),
                  )
                  .map((item) => (
                    <button
                      key={`${item.opening.id}-${item.stage}`}
                      className="recruitment-attention-row"
                      onClick={() => attention(item.stage, item.opening.id)}
                    >
                      <span>
                        <strong>{item.label}</strong>
                        <small>
                          {item.opening.title} · {item.count} candidates
                        </small>
                      </span>
                      <span aria-hidden="true">→</span>
                    </button>
                  ))}
                {data.applications
                  .filter(
                    (row) =>
                      row.attempt_status === "interrupted" ||
                      ["partial", "invalid", "failed"].includes(
                        row.recording_state,
                      ),
                  )
                  .map((row) => (
                    <button
                      key={row.id}
                      className="recruitment-attention-row"
                      onClick={() => setReviewApplication(row)}
                    >
                      <span>
                        {row.name}
                        <small>
                          {row.attempt_status === "interrupted"
                            ? "Interview interrupted"
                            : `Recording ${row.recording_state}`}
                        </small>
                      </span>
                      <span>Check →</span>
                    </button>
                  ))}
                {!data.openings.some(
                  (o) => o.pipeline.needs_review || o.pipeline.invited,
                ) &&
                  !data.applications.some(
                    (row) =>
                      row.attempt_status === "interrupted" ||
                      ["partial", "invalid", "failed"].includes(
                        row.recording_state,
                      ),
                  ) && (
                    <RecruitmentEmpty>
                      No interviews awaiting review or invitation follow-up.
                    </RecruitmentEmpty>
                  )}
              </RecruitmentSection>
              {data.activity.length > 0 && (
                <RecruitmentSection title="Recent activity">
                  {activity}
                </RecruitmentSection>
              )}
            </aside>
          </div>
        </>
      ) : !opening ? (
        <RecruitmentEmpty>
          This opening is unavailable in the current view.
        </RecruitmentEmpty>
      ) : (
        <>
          <AdminSegmentedControl
            value={tab}
            onChange={setTab}
            label="Opening workspace"
            options={[
              { value: "candidates", label: "Candidates" },
              { value: "setup", label: "Setup" },
            ]}
          />
          {tab === "candidates" && (
            <>
              <AdminSummaryGrid
                variant="compact"
                ariaLabel="Candidate pipeline"
                items={pipeline.map((item) => ({
                  key: item.key,
                  label: item.label,
                  value: opening.pipeline[item.key] ?? 0,
                  ariaLabel: `${item.label}: ${opening.pipeline[item.key] ?? 0}. View candidates`,
                  active: stage === (item.key === "total" ? "all" : item.key),
                  tone:
                    item.key === "needs_review" &&
                    opening.pipeline[item.key] > 0
                      ? "warning"
                      : "neutral",
                  onClick: () =>
                    attention(
                      item.key === "total" ? "all" : item.key,
                      opening.id,
                    ),
                }))}
              />
              <AdminFilterToolbar
                compact
                denseFields
                ariaLabel="Candidate filters"
                search={
                  <AdminSearchField
                    label="Search candidates"
                    value={candidateSearch}
                    onChange={(value) => {
                      setCandidateSearch(value.slice(0, 120));
                      setPage(1);
                    }}
                    placeholder="Search candidates"
                    ariaLabel="Search candidates"
                  />
                }
                filters={
                  <>
                    <SelectField
                      label="Stage"
                      value={stage}
                      onChange={(value) => {
                        setStage(value);
                        setPage(1);
                      }}
                      ariaLabel="Candidate stage"
                      options={filterOptions}
                    />
                    <SelectField
                      label="Offering"
                      value={offeringFilter}
                      onChange={(value) => {
                        setOfferingFilter(value);
                        setPage(1);
                      }}
                      ariaLabel="Offering filter"
                      options={[
                        { value: "all", label: "All" },
                        ...Object.entries(preferenceLabels).map(
                          ([value, label]) => ({ value, label }),
                        ),
                      ]}
                    />
                  </>
                }
              />
              <RecruitmentSection
                title="Candidates"
                description={`${data.applications_total} ${data.applications_total === 1 ? "candidate" : "candidates"} · Application stage, interview evidence and requirement fit`}
                className="is-list"
              >
                <DataTable
                  minWidth="100%"
                  density="compact"
                  tableClassName="recruitment-candidates-table"
                  rows={data.applications}
                  getRowKey={(row) => row.id}
                  columns={[
                    {
                      key: "candidate",
                      header: "Candidate",
                      render: (row) => (
                        <>
                          {" "}
                          <button
                            className="recruitment-candidate-identity"
                            onClick={() => setReviewApplication(row)}
                          >
                            <span
                              className="recruitment-avatar"
                              aria-hidden="true"
                            >
                              {row.name
                                .split(" ")
                                .map((x) => x[0])
                                .slice(0, 2)
                                .join("")}
                            </span>
                            <div className="min-w-0">
                              <p className="font-semibold text-sm break-words">
                                {row.name}
                              </p>
                              <p className="text-xs text-text-secondary mt-1">
                                {row.contact}
                              </p>
                            </div>
                          </button>
                          <small className="recruitment-row-meta">
                            Registered{" "}
                            {formatRecruitmentTime(row.registered_at)}
                          </small>
                        </>
                      ),
                    },
                    {
                      key: "offering",
                      header: "Offering",
                      render: (row) =>
                        preferenceLabels[row.employment_preference] ||
                        "Unknown",
                    },
                    {
                      key: "stage",
                      header: "Stage",
                      render: (row) => (
                        <RecruitmentState value={row.stage}>
                          {stages[row.stage]}
                        </RecruitmentState>
                      ),
                    },
                    {
                      key: "invitation",
                      header: "Invitation",
                      priority: "secondary",
                      render: (row) => (
                        <div className="recruitment-cell-stack">
                          <span>
                            {!row.issued_at
                              ? "Not invited"
                              : row.revoked_at
                                ? "Revoked"
                                : Date.parse(row.expires_at) < Date.now()
                                  ? "Expired"
                                  : "Active"}
                          </span>
                          {row.issued_at && (
                            <small>
                              {formatRecruitmentTime(row.issued_at)}
                            </small>
                          )}
                          {row.stage === "invited" && row.expires_at && (
                            <small>
                              Expires {formatRecruitmentTime(row.expires_at)}
                            </small>
                          )}
                        </div>
                      ),
                    },
                    {
                      key: "interview",
                      header: "Interview",
                      render: (row) => (
                        <div className="recruitment-cell-stack">
                          <span>{interviewStateLabel(row.attempt_status)}</span>
                          {(row.completed_at || row.started_at) && (
                            <small>
                              {formatRecruitmentTime(
                                row.completed_at || row.started_at,
                              )}
                            </small>
                          )}
                          {row.duration_seconds != null && (
                            <small>
                              {Math.floor(row.duration_seconds / 60)}m{" "}
                              {Math.floor(row.duration_seconds % 60)}s elapsed
                            </small>
                          )}
                        </div>
                      ),
                    },
                    {
                      key: "evidence",
                      header: "Fit / Evidence",
                      priority: "secondary",
                      render: (row) => (
                        <div className="recruitment-cell-stack">
                          {row.recording_state &&
                            !["complete", "not_started"].includes(
                              row.recording_state,
                            ) && (
                              <RecruitmentState value={row.recording_state}>
                                Recording {row.recording_state}
                              </RecruitmentState>
                            )}
                          <CandidateFitSummary
                            application={row}
                            revision={data}
                          />
                        </div>
                      ),
                    },
                    {
                      key: "action",
                      header: "Action",
                      render: (row) => (
                        <div className="recruitment-candidate-actions flex items-center gap-1">
                          <button
                            className="btn-secondary"
                            disabled={busy}
                            data-action={invitationAction(
                              row,
                              canManage,
                              opening.status,
                            )}
                            onClick={(event) =>
                              candidateAction(
                                row,
                                event.currentTarget.dataset.action,
                              )
                            }
                          >
                            {invitationAction(
                              row,
                              canManage,
                              opening.status,
                            ) === "issue"
                              ? "Issue interview link"
                              : invitationAction(
                                    row,
                                    canManage,
                                    opening.status,
                                  ) === "copy"
                                ? "Copy link"
                                : "Review"}
                          </button>
                          {canManage &&
                            !["hired", "rejected"].includes(
                              row.decision_state,
                            ) && (
                              <ActionMenu
                                open={actionMenuId === row.id}
                                onOpenChange={(open) =>
                                  setActionMenuId(open ? row.id : null)
                                }
                                ariaLabel={`Actions for ${row.name}`}
                                trigger={({ toggle, open, ariaLabel }) => (
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    aria-label={ariaLabel}
                                    aria-haspopup="menu"
                                    aria-expanded={open}
                                    onClick={toggle}
                                  >
                                    •••
                                  </button>
                                )}
                              >
                                <div
                                  role="menu"
                                  aria-label={`Actions for ${row.name}`}
                                >
                                  {currentInvitation(row, issuedLinks) && (
                                    <a
                                      role="menuitem"
                                      href={
                                        currentInvitation(row, issuedLinks).url
                                      }
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      Open interview link
                                    </a>
                                  )}
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      setActionMenuId(null);
                                      setReviewApplication(row);
                                    }}
                                  >
                                    Review application
                                  </button>
                                  {opening.status === "open" && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      disabled={busy}
                                      onClick={() => {
                                        setActionMenuId(null);
                                        issue(row);
                                      }}
                                    >
                                      {row.issued_at
                                        ? "Reissue interview link"
                                        : "Issue interview link"}
                                    </button>
                                  )}
                                  {row.issued_at && !row.revoked_at && (
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="is-danger"
                                      disabled={busy}
                                      onClick={() => {
                                        setActionMenuId(null);
                                        mutate(() =>
                                          recruitmentService.revokeInvitation(
                                            row.id,
                                          ),
                                        ).catch(() => {});
                                      }}
                                    >
                                      Revoke invitation
                                    </button>
                                  )}
                                </div>
                              </ActionMenu>
                            )}
                        </div>
                      ),
                    },
                  ]}
                />
                {!data.applications.length && (
                  <div className="px-5">
                    <RecruitmentEmpty>
                      No candidates in this stage. Choose another stage or add a
                      candidate.
                    </RecruitmentEmpty>
                  </div>
                )}
              </RecruitmentSection>
              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span>
                  {data.applications_total} candidates · Page {data.page}
                </span>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="btn-secondary"
                    disabled={page * data.page_size >= data.applications_total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
          {tab === "setup" &&
            (canManage ? (
              <OpeningForm
                key={opening.id}
                opening={opening}
                data={data}
                busy={busy}
                inline
                onSave={(o) => mutate(() => recruitmentService.saveOpening(o))}
                onClose={() => setTab("candidates")}
              />
            ) : (
              <RecruitmentSection title="Interview setup">
                <OpeningPlan opening={opening} profile={profile} />
              </RecruitmentSection>
            ))}
        </>
      )}
      {applicationForm && data ? (
        <Modal
          title="Register application"
          onClose={() => setApplicationForm(false)}
          size="md"
          footer={
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setApplicationForm(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                form="recruitment-application-form"
                className="btn-primary"
                disabled={busy}
              >
                Register
              </button>
            </>
          }
        >
          <form
            id="recruitment-application-form"
            onSubmit={register}
            className="grid gap-4"
          >
            <AdminFormField label="Open opening" required>
              <SelectField
                required
                value={selectedOpening}
                onChange={(value) => setSelectedOpening(value)}
                ariaLabel="Open opening"
                placeholder="Select opening"
                searchable
                options={data.openings
                  .filter((x) => x.status === "open")
                  .map((x) => ({ value: x.id, label: x.title }))}
              />
            </AdminFormField>
            <AdminFormField
              label="Find existing applicant"
              helper="Search by name or contact number; leave empty to register a new applicant."
            >
              <input
                className={fieldClass}
                value={applicantQuery}
                onChange={(e) => {
                  setApplicantQuery(e.target.value);
                  setSelectedApplicant("");
                }}
              />
            </AdminFormField>
            {applicantResults.length ? (
              <AdminFormField label="Matching applicant">
                <SelectField
                  value={selectedApplicant}
                  onChange={(value) => setSelectedApplicant(value)}
                  ariaLabel="Matching applicant"
                  placeholder="Register new applicant"
                  searchable
                  options={[
                    { value: "", label: "Register new applicant" },
                    ...applicantResults.map((x) => ({
                      value: x.id,
                      label: `${x.name} · ${x.contact}`,
                    })),
                  ]}
                />
              </AdminFormField>
            ) : null}
            <AdminFormField label="Employment preference">
              <SelectField
                ariaLabel="Employment preference"
                value={applicant.employment_preference || "unknown"}
                onChange={(value) =>
                  setApplicant({ ...applicant, employment_preference: value })
                }
                options={Object.entries(preferenceLabels).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
            </AdminFormField>
            {!selectedApplicant ? (
              <>
                <AdminFormField label="Full name" required>
                  <input
                    required
                    className={fieldClass}
                    value={applicant.full_name}
                    onChange={(e) =>
                      setApplicant({ ...applicant, full_name: e.target.value })
                    }
                  />
                </AdminFormField>
                <AdminFormField label="Contact number" required>
                  <input
                    required
                    className={fieldClass}
                    value={applicant.contact}
                    onChange={(e) =>
                      setApplicant({ ...applicant, contact: e.target.value })
                    }
                  />
                </AdminFormField>
                <AdminFormField label="Email (optional)">
                  <input
                    type="email"
                    className={fieldClass}
                    value={applicant.email}
                    onChange={(e) =>
                      setApplicant({ ...applicant, email: e.target.value })
                    }
                  />
                </AdminFormField>
              </>
            ) : null}
          </form>
        </Modal>
      ) : null}
      {reviewApplication && (
        <RecruitmentEvidenceReview
          application={reviewApplication}
          onChanged={() => load()}
          onClose={() => setReviewApplication(null)}
        />
      )}
      {addedCandidate && (
        <Modal
          title="Candidate added"
          description={`${addedCandidate.name} is registered for this opening.`}
          onClose={() => setAddedCandidate(null)}
          footer={
            <>
              <button
                className="btn-secondary"
                onClick={() => setAddedCandidate(null)}
              >
                Done
              </button>
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => issue(addedCandidate)}
              >
                Issue interview link
              </button>
            </>
          }
        >
          <p className="text-sm text-text-secondary">
            Issue a personal link when you’re ready to invite this candidate.
          </p>
        </Modal>
      )}
      {invitation && (
        <Modal
          title={
            invitation.url
              ? "Interview link issued"
              : Date.parse(invitation.expiresAt) > Date.now()
                ? "Invitation active"
                : "Invitation expired"
          }
          description={invitation.name}
          onClose={() => setInvitation("")}
          footer={
            <>
              {invitation.url && (
                <>
                  <a
                    className="btn-secondary"
                    href={invitation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open interview link
                  </a>
                  <button
                    className="btn-primary"
                    onClick={() => copyLink(invitation)}
                  >
                    {copied === invitation.url ? "Copied" : "Copy link"}
                  </button>
                </>
              )}
              {!invitation.url && (
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={() =>
                    issue({
                      id: invitation.applicationId,
                      name: invitation.name,
                    })
                  }
                >
                  Reissue interview link
                </button>
              )}
            </>
          }
        >
          <p className="text-sm mb-3">
            Expires {new Date(invitation.expiresAt).toLocaleString()}
          </p>
          {invitation.url ? (
            <>
              <p className="text-sm text-text-secondary mb-3">
                Copy this candidate-specific link now. It stays available here
                until this page is refreshed.
              </p>
              <p className="break-all rounded-lg bg-surface-muted p-3 text-sm select-all">
                {invitation.url}
              </p>
            </>
          ) : (
            <p className="text-sm text-text-secondary">
              The original link is not stored and cannot be retrieved. Use the
              link you previously copied, or reissue a new one. Reissuing
              invalidates the previous link.
            </p>
          )}
          <div className="flex gap-3 mt-4">
            {invitation.url && (
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() =>
                  issue({ id: invitation.applicationId, name: invitation.name })
                }
              >
                Reissue link
              </button>
            )}
            <button
              className="btn-ghost text-danger"
              disabled={busy}
              onClick={() =>
                mutate(() =>
                  recruitmentService.revokeInvitation(invitation.applicationId),
                )
                  .then(() => setInvitation(""))
                  .catch(() => {})
              }
            >
              Revoke invitation
            </button>
          </div>
          {error && (
            <p role="alert" className="text-danger mt-3">
              {error}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
