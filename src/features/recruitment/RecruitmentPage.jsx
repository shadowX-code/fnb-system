import {
  invitationAction,
  currentInvitation,
} from "./invitationPresentation.js";
import { useEffect, useState } from "react";
import SelectField from "../../components/forms/SelectField.jsx";
import AdminSearchField from "../../components/forms/AdminSearchField.jsx";
import ActionMenu from "../../components/ui/ActionMenu.jsx";
import PageHeader from "../../components/layout/PageHeader.jsx";
import {
  RecruitmentMetrics,
  RecruitmentSection,
  RecruitmentEmpty,
  RecruitmentState,
  OpeningPlan,
  CandidateFitSummary,
} from "./RecruitmentPresentation.jsx";
import Modal from "../../components/feedback/Modal.jsx";
import AdminSegmentedControl from "../../components/forms/AdminSegmentedControl.jsx";
import AdminFormField from "../../components/forms/AdminFormField.jsx";
import InterviewProfileSettings from "./InterviewProfileSettings.jsx";
import RecruitmentEvidenceReview from "./RecruitmentEvidenceReview.jsx";
import { recruitmentService } from "./recruitmentService.js";

const initialOpening = {
  title: "",
  position_id: "",
  outlet_id: "",
  workplace: "",
  legal_entity_id: "",
  description: "",
  status: "draft",
  config: {
    required_topics: ["Relevant experience", "Availability"],
    scenario_briefs: [],
    language_guidance:
      "Use the candidate's preferred EN, BM or Chinese naturally, including code-switching.",
    target_minutes: 10,
    max_minutes: 15,
    candidate_instructions:
      "Please find a quiet place with a stable connection.",
    interview_instructions: "Collect relevant evidence naturally.",
  },
};
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

function OpeningForm({ opening, data, busy, onSave, onClose, inline = false }) {
  const [draft, setDraft] = useState(() =>
    structuredClone(
      opening || {
        ...initialOpening,
        config: {
          ...initialOpening.config,
          interview_profile_id: data.profiles[0]?.id || "",
          opening_requirements: {},
        },
      },
    ),
  );
  const [error, setError] = useState("");
  const patch = (key, value) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const patchConfig = (key, value) =>
    setDraft((current) => ({
      ...current,
      config: { ...current.config, [key]: value },
    }));
  const profile = data.profiles.find(
    (p) => p.id === draft.config.interview_profile_id,
  );
  const jobFacts = draft.config.job_facts || {};
  const requirements = draft.config.opening_requirements || {};
  const patchRequirements = (key, value) =>
    patchConfig("opening_requirements", { ...requirements, [key]: value });
  const workplaceValue = draft.outlet_id || draft.workplace;
  async function submit() {
    setError("");
    try {
      await onSave({
        ...draft,
        outlet_id: data.outlets.some((row) => row.id === workplaceValue)
          ? workplaceValue
          : null,
        workplace: data.outlets.some((row) => row.id === workplaceValue)
          ? ""
          : workplaceValue,
      });
      onClose();
    } catch (cause) {
      setError(cause.message || "Unable to save opening.");
    }
  }
  const Surface = inline ? SetupSurface : Modal;
  return (
    <Surface
      title={opening ? "Edit opening" : "New opening"}
      description="Interview topics describe evidence to collect; the AI will choose its questions conversationally."
      size="xl"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={submit}
          >
            Save opening
          </button>
        </>
      }
    >
      <div className="recruitment-form">
        <fieldset>
          <legend>Opening</legend>
          <div className="recruitment-form-grid">
            <AdminFormField label="Job-facing title" required>
              <input
                className={fieldClass}
                value={draft.title}
                onChange={(e) => patch("title", e.target.value)}
              />
            </AdminFormField>
            <AdminFormField label="Position" required>
              <SelectField
                value={draft.position_id}
                onChange={(value) => patch("position_id", value)}
                ariaLabel="Position"
                placeholder="Select position"
                searchable
                options={data.positions.map((row) => ({
                  value: row.id,
                  label: row.name,
                }))}
              />
            </AdminFormField>
            <AdminFormField label="Workplace" required>
              <SelectField
                value={workplaceValue}
                onChange={(value) => {
                  patch("outlet_id", value);
                  patch("workplace", value);
                }}
                ariaLabel="Workplace"
                placeholder="Select workplace"
                searchable
                options={[
                  ...data.outlets.map((row) => ({
                    value: row.id,
                    label: row.name,
                  })),
                  { value: "Factory", label: "Factory" },
                  { value: "Management", label: "Management" },
                ]}
              />
            </AdminFormField>
            <AdminFormField label="Legal employer" required>
              <SelectField
                value={draft.legal_entity_id}
                onChange={(value) => patch("legal_entity_id", value)}
                ariaLabel="Legal employer"
                placeholder="Select legal employer"
                searchable
                options={data.legal_entities.map((row) => ({
                  value: row.id,
                  label: row.name,
                }))}
              />
            </AdminFormField>
            <AdminFormField label="Status">
              <SelectField
                value={draft.status}
                onChange={(value) => patch("status", value)}
                ariaLabel="Status"
                placeholder="Select status"
                options={[
                  { value: "draft", label: "Draft" },
                  { value: "open", label: "Open" },
                  { value: "closed", label: "Closed" },
                ]}
              />
            </AdminFormField>
            <AdminFormField label="Description">
              <input
                className={fieldClass}
                value={draft.description}
                onChange={(e) => patch("description", e.target.value)}
              />
            </AdminFormField>
          </div>
        </fieldset>
        <fieldset>
          <legend>Job Information</legend>
          <p className="text-sm text-text-secondary mb-3">
            Confirmed information for candidates only. Leave unconfirmed details
            blank. Position, workplace and employer use the masters above;
            employee contracts and payroll remain separate.
          </p>
          <div className="recruitment-form-grid">
            {Object.entries({
              employment_type: "Offered employment type",
              job_scope: "Job scope",
              offered_salary:
                "Offered salary / range (include currency and pay period)",
              working_hours: "Working / operating hours",
              shift_arrangement: "Shift arrangement",
              public_holidays: "Public-holiday expectation",
              benefits: "Confirmed benefits",
              additional_facts: "Other approved job information",
            }).map(([key, label]) => (
              <AdminFormField key={key} label={label}>
                <input
                  className={fieldClass}
                  maxLength={1000}
                  value={jobFacts[key] || ""}
                  onChange={(e) => {
                    const next = { ...jobFacts };
                    if (e.target.value.trim()) next[key] = e.target.value;
                    else delete next[key];
                    patchConfig("job_facts", next);
                  }}
                />
              </AdminFormField>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Interview</legend>
          <div className="recruitment-form-grid">
            <AdminFormField
              label="Interview Profile"
              required
              className="md:col-span-2"
              helper="This version is pinned when an invitation is issued."
            >
              <SelectField
                value={draft.config.interview_profile_id || ""}
                onChange={(value) => patchConfig("interview_profile_id", value)}
                ariaLabel="Interview Profile"
                placeholder="Select profile version"
                searchable
                options={data.profiles.map((p) => ({
                  value: p.id,
                  label: `${p.name} v${p.version}`,
                  description: `${p.definition.target_minutes}–${p.definition.max_minutes} min · ${p.definition.evidence_areas.length} evidence areas · ${p.definition.scenarios.length} scenarios`,
                }))}
              />
            </AdminFormField>
            {profile && (
              <p className="md:col-span-2 text-sm text-text-secondary">
                {profile.definition.evidence_areas
                  .map((a) => a.name)
                  .join(" · ")}
                <br />
                Target {profile.definition.target_minutes} min · Maximum{" "}
                {profile.definition.max_minutes} min
              </p>
            )}
          </div>
        </fieldset>
        <fieldset>
          <legend>Interview Requirements</legend>
          <div className="recruitment-form-grid">
            <AdminFormField label="Weekend availability">
              <SelectField
                value={requirements.weekend_required ? "required" : "flexible"}
                onChange={(value) =>
                  patchRequirements("weekend_required", value === "required")
                }
                ariaLabel="Weekend availability"
                placeholder="Weekend availability"
                options={[
                  { value: "flexible", label: "Discuss availability" },
                  { value: "required", label: "Weekend availability required" },
                ]}
              />
            </AdminFormField>
            <AdminFormField label="Closing shift requirement / time">
              <input
                className={fieldClass}
                maxLength={240}
                value={requirements.closing_shift || ""}
                onChange={(e) =>
                  patchRequirements("closing_shift", e.target.value)
                }
              />
            </AdminFormField>
            <AdminFormField
              label="Preferred start timing"
              className="md:col-span-2"
            >
              <input
                className={fieldClass}
                maxLength={240}
                value={requirements.preferred_start || ""}
                onChange={(e) =>
                  patchRequirements("preferred_start", e.target.value)
                }
              />
            </AdminFormField>
          </div>
        </fieldset>
        <fieldset>
          <legend>Additional Settings</legend>
          <details>
            <summary>Language & candidate guidance</summary>
            <div className="grid gap-4 mt-3">
              {!profile && (
                <details className="md:col-span-2">
                  <summary className="cursor-pointer text-sm text-text-secondary">
                    Existing interview configuration
                  </summary>
                  <div className="mt-3 grid gap-3">
                    <AdminFormField label="Evidence topics">
                      <textarea
                        className={fieldClass}
                        value={(draft.config.required_topics || []).join("\n")}
                        onChange={(e) =>
                          patchConfig(
                            "required_topics",
                            e.target.value.split("\n").filter(Boolean),
                          )
                        }
                      />
                    </AdminFormField>
                    <AdminFormField label="Scenario briefs">
                      <textarea
                        className={fieldClass}
                        value={(draft.config.scenario_briefs || []).join("\n")}
                        onChange={(e) =>
                          patchConfig(
                            "scenario_briefs",
                            e.target.value.split("\n").filter(Boolean),
                          )
                        }
                      />
                    </AdminFormField>
                    <AdminFormField label="Interview guidance">
                      <textarea
                        className={fieldClass}
                        value={draft.config.interview_instructions}
                        onChange={(e) =>
                          patchConfig("interview_instructions", e.target.value)
                        }
                      />
                    </AdminFormField>
                    <div className="grid grid-cols-2 gap-3">
                      {["target_minutes", "max_minutes"].map((key) => (
                        <AdminFormField
                          key={key}
                          label={
                            key === "target_minutes"
                              ? "Target minutes"
                              : "Maximum minutes"
                          }
                        >
                          <input
                            type="number"
                            className={fieldClass}
                            value={draft.config[key]}
                            onChange={(e) =>
                              patchConfig(key, Number(e.target.value))
                            }
                          />
                        </AdminFormField>
                      ))}
                    </div>
                  </div>
                </details>
              )}
              <AdminFormField
                label="Language guidance"
                className="md:col-span-2"
              >
                <textarea
                  className={fieldClass}
                  value={draft.config.language_guidance}
                  onChange={(e) =>
                    patchConfig("language_guidance", e.target.value)
                  }
                />
              </AdminFormField>
              <AdminFormField
                label="Candidate instructions"
                className="md:col-span-2"
              >
                <textarea
                  className={fieldClass}
                  value={draft.config.candidate_instructions}
                  onChange={(e) =>
                    patchConfig("candidate_instructions", e.target.value)
                  }
                />
              </AdminFormField>
            </div>
          </details>
        </fieldset>
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-red-700">
          {error}
        </p>
      ) : null}
    </Surface>
  );
}

function SetupSurface({ children, footer }) {
  return (
    <div className="recruitment-setup">
      {children}
      <div className="recruitment-setup-actions">{footer}</div>
    </div>
  );
}

export default function RecruitmentPage({ auth }) {
  const [data, setData] = useState(null),
    [openingId, setOpeningId] = useState(null),
    [tab, setTab] = useState("overview");
  const [stage, setStage] = useState("all"),
    [page, setPage] = useState(1),
    [includeQa, setIncludeQa] = useState(false),
    [includeClosed, setIncludeClosed] = useState(false);
  const [search, setSearch] = useState(""),
    [statusFilter, setStatusFilter] = useState("all"),
    [workplaceFilter, setWorkplaceFilter] = useState("all"),
    [positionFilter, setPositionFilter] = useState("all");
  const [formOpening, setFormOpening] = useState(undefined),
    [profilesOpen, setProfilesOpen] = useState(false),
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
  const query = { openingId, stage, page, includeQa };
  async function load() {
    const next = await recruitmentService.workspace(query);
    setData(next);
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    recruitmentService
      .workspace({ openingId, stage, page, includeQa })
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
  }, [openingId, stage, page, includeQa]);
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
    setOpeningId(id);
    setSelectedOpening(id || "");
    setTab("overview");
    setStage("all");
    setPage(1);
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
  const position =
    opening?.position_name ||
    data?.positions.find((p) => p.id === opening?.position_id)?.name ||
    "Position";
  const requirements = opening?.config.opening_requirements || {};
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
  if (profilesOpen && data)
    return (
      <div className="recruitment-workspace">
        <InterviewProfileSettings
          profiles={data.profiles}
          busy={busy}
          canManage={canManage}
          onPublish={(definition, version) =>
            mutate(() => recruitmentService.publishProfile(definition, version))
          }
          onClose={() => setProfilesOpen(false)}
        />
      </div>
    );
  return (
    <div className="recruitment-workspace">
      {openingId && (
        <button
          type="button"
          className="text-sm text-text-secondary hover:text-primary justify-self-start"
          onClick={() => selectOpening(null)}
        >
          ← Recruitment
        </button>
      )}
      <PageHeader
        section="People"
        title={opening?.title || "Recruitment"}
        description={
          opening
            ? `${opening.workplace} · ${employer}`
            : "Open roles and candidates, ready for your next decision."
        }
        secondaryActions={
          !openingId ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setProfilesOpen(true)}
            >
              Interview Profiles
            </button>
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
              {openingId ? "Add candidate" : "New opening"}
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
        <RecruitmentMetrics
          items={[
            { label: "Open roles", value: data.summary.open_roles },
            {
              label: "Candidates",
              value: data.openings.reduce((n, o) => n + o.pipeline.total, 0),
            },
            { label: "Interviewing", value: data.summary.interviewing },
            {
              label: "Needs review",
              value: data.summary.needs_review,
              attention: true,
            },
            { label: "Shortlisted", value: data.summary.shortlisted },
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
        <div className="recruitment-layout">
          <RecruitmentSection
            title={includeClosed ? "All openings" : "Active openings"}
            className="is-list"
            description={`${visibleOpenings.length} ${visibleOpenings.length === 1 ? "opening" : "openings"} in this view`}
          >
            <div className="recruitment-toolbar">
              <AdminSearchField
                label="Search openings"
                ariaLabel="Search openings"
                placeholder="Search openings…"
                value={search}
                onChange={setSearch}
              />
              <SelectField
                value={statusFilter}
                onChange={(value) => setStatusFilter(value)}
                ariaLabel="Opening status"
                placeholder="All statuses"
                options={[
                  { value: "all", label: "All statuses" },
                  { value: "open", label: "Open" },
                  { value: "draft", label: "Draft" },
                  ...(includeClosed
                    ? [{ value: "closed", label: "Closed" }]
                    : []),
                ]}
              />
              <SelectField
                value={workplaceFilter}
                onChange={(value) => setWorkplaceFilter(value)}
                ariaLabel="Workplace filter"
                placeholder="All workplaces"
                searchable
                options={[
                  { value: "all", label: "All workplaces" },
                  ...[...new Set(data.openings.map((o) => o.workplace))].map(
                    (w) => ({ value: w, label: w }),
                  ),
                ]}
              />
              <SelectField
                value={positionFilter}
                onChange={(value) => setPositionFilter(value)}
                ariaLabel="Position filter"
                placeholder="All positions"
                searchable
                options={[
                  { value: "all", label: "All positions" },
                  ...data.positions
                    .filter((p) =>
                      data.openings.some((o) => o.position_id === p.id),
                    )
                    .map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </div>
            {visibleOpenings.map((o) => (
              <button
                key={o.id}
                type="button"
                className="recruitment-opening-row"
                aria-label={`Open opening: ${o.title}`}
                onClick={() => selectOpening(o.id)}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{o.title}</strong>
                    <RecruitmentState value={o.status} />
                  </div>
                  <p>
                    {o.workplace} ·{" "}
                    {o.profile
                      ? `${o.profile.name} v${o.profile.version}`
                      : "Opening interview plan"}
                  </p>
                </div>
                <div className="recruitment-row-pipeline">
                  <span>
                    <b>{o.pipeline.total}</b>Candidates
                  </span>
                  <span>
                    <b>{o.pipeline.interviewing}</b>Interviewing
                  </span>
                  <span>
                    <b>{o.pipeline.needs_review}</b>
                    {o.pipeline.needs_review > 0 ? (
                      <RecruitmentState value="needs_review">
                        Needs review
                      </RecruitmentState>
                    ) : (
                      "Needs review"
                    )}
                  </span>
                  <span>
                    <b>{o.pipeline.shortlisted}</b>Shortlisted
                  </span>
                </div>
                <span aria-hidden="true">→</span>
              </button>
            ))}
            {!visibleOpenings.length && (
              <div className="px-5">
                <RecruitmentEmpty>
                  {data.openings.length
                    ? "No openings match these filters. Adjust your search or filters."
                    : "No openings yet. Create an opening to begin recruitment."}
                </RecruitmentEmpty>
              </div>
            )}
            <div className="recruitment-toolbar border-b-0 text-xs text-text-secondary">
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
          </RecruitmentSection>
          <aside className="grid gap-5">
            <RecruitmentSection title="Needs attention">
              {data.openings
                .filter(
                  (o) =>
                    (includeClosed || o.status !== "closed") &&
                    (o.pipeline.needs_review > 0 || o.pipeline.invited > 0),
                )
                .map((o) => (
                  <button
                    key={o.id}
                    className="recruitment-attention-row"
                    onClick={() =>
                      attention(
                        o.pipeline.needs_review ? "needs_review" : "invited",
                        o.id,
                      )
                    }
                  >
                    <span>
                      {o.title}
                      <small>
                        {o.pipeline.needs_review
                          ? `${o.pipeline.needs_review} ${o.pipeline.needs_review === 1 ? "interview" : "interviews"} ready for review`
                          : `${o.pipeline.invited} invitations to follow up`}
                      </small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                ))}
              {!data.openings.some(
                (o) => o.pipeline.needs_review || o.pipeline.invited,
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
      ) : !opening ? (
        <RecruitmentEmpty>
          This opening is unavailable in the current view.
        </RecruitmentEmpty>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <AdminSegmentedControl
              value={tab}
              onChange={setTab}
              label="Opening workspace"
              options={[
                { value: "overview", label: "Overview" },
                { value: "candidates", label: "Candidates" },
                { value: "setup", label: "Setup" },
              ]}
            />
            <div className="flex items-center gap-2">
              <RecruitmentState value={opening.status} />
              <span className="text-xs text-text-secondary">
                {profile
                  ? `${profile.name} v${profile.version}`
                  : "Opening interview plan"}
              </span>
            </div>
          </div>
          {tab === "overview" && (
            <>
              <RecruitmentMetrics
                items={pipeline.map((item) => ({
                  ...item,
                  value: opening.pipeline[item.key],
                  attention: item.key === "needs_review",
                  onSelect: () =>
                    attention(
                      item.key === "total" ? "all" : item.key,
                      opening.id,
                    ),
                }))}
              />
              <div className="recruitment-form-grid">
                <RecruitmentSection
                  title="Opening details"
                  action={
                    canManage && (
                      <button
                        className="btn-ghost"
                        onClick={() => setTab("setup")}
                      >
                        Edit setup →
                      </button>
                    )
                  }
                >
                  <dl className="recruitment-facts">
                    <dt>Position</dt>
                    <dd>{position}</dd>
                    <dt>Workplace</dt>
                    <dd>{opening.workplace}</dd>
                    <dt>Employer</dt>
                    <dd>{employer}</dd>
                  </dl>
                  {opening.description && (
                    <p className="mt-4 text-sm text-text-secondary">
                      {opening.description}
                    </p>
                  )}
                </RecruitmentSection>
                <RecruitmentSection
                  title="Interview plan"
                  action={
                    profile && (
                      <button
                        className="btn-ghost"
                        onClick={() => setProfilesOpen(true)}
                      >
                        View profiles →
                      </button>
                    )
                  }
                >
                  <OpeningPlan opening={opening} profile={profile} />
                </RecruitmentSection>
                <RecruitmentSection title="Needs attention">
                  {opening.pipeline.needs_review > 0 && (
                    <button
                      className="recruitment-attention-row"
                      onClick={() => attention("needs_review")}
                    >
                      <span>Interviews ready for review</span>
                      <RecruitmentState value="needs_review">
                        {opening.pipeline.needs_review} →
                      </RecruitmentState>
                    </button>
                  )}
                  {opening.pipeline.invited > 0 && (
                    <button
                      className="recruitment-attention-row"
                      onClick={() => attention("invited")}
                    >
                      <span>Invited candidates</span>
                      <strong>{opening.pipeline.invited} →</strong>
                    </button>
                  )}
                  {!opening.pipeline.needs_review &&
                    !opening.pipeline.invited && (
                      <RecruitmentEmpty>
                        No interviews awaiting review or invitation follow-up.
                      </RecruitmentEmpty>
                    )}
                </RecruitmentSection>
                <RecruitmentSection title="Recent activity">
                  {data.activity.length ? (
                    activity
                  ) : (
                    <RecruitmentEmpty>
                      No recent activity for this opening.
                    </RecruitmentEmpty>
                  )}
                </RecruitmentSection>
              </div>
            </>
          )}
          {tab === "candidates" && (
            <>
              <div className="overflow-x-auto">
                <AdminSegmentedControl
                  value={stage}
                  onChange={(value) => {
                    setStage(value);
                    setPage(1);
                  }}
                  label="Candidate stage"
                  options={filterOptions}
                />
              </div>
              <RecruitmentSection
                title="Candidates"
                description={`${data.applications_total} ${data.applications_total === 1 ? "candidate" : "candidates"} · Application stage, interview evidence and requirement fit`}
                className="is-list"
              >
                {data.applications.map((row) => (
                  <div key={row.id} className="recruitment-candidate-row">
                    <button
                      className="recruitment-candidate-identity"
                      onClick={() => setReviewApplication(row)}
                    >
                      <span className="recruitment-avatar" aria-hidden="true">
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
                    <div className="grid gap-1 justify-items-start">
                      <RecruitmentState value={row.stage}>
                        {stages[row.stage]}
                      </RecruitmentState>
                      <span className="text-xs text-text-secondary">
                        {row.revoked_at
                          ? "Invitation revoked"
                          : row.expires_at &&
                              Date.parse(row.expires_at) < Date.now()
                            ? "Invitation expired"
                            : (row.attempt_status
                                ? `Interview: ${row.attempt_status === "failed" ? "Evidence incomplete" : row.attempt_status.replaceAll("_", " ")}`
                                : "") || "Not interviewed"}
                      </span>
                      {row.expires_at &&
                        !row.revoked_at &&
                        Date.parse(row.expires_at) > Date.now() &&
                        row.stage === "invited" && (
                          <span className="text-xs text-text-secondary">
                            Link active · Expires{" "}
                            {new Date(row.expires_at).toLocaleDateString()}
                          </span>
                        )}
                    </div>
                    <div className="recruitment-candidate-evidence grid gap-1.5">
                      {row.recording_state && (
                        <span className="text-xs text-text-secondary">
                          Recording:{" "}
                          <RecruitmentState value={row.recording_state} />
                        </span>
                      )}
                      <CandidateFitSummary application={row} revision={data} />
                    </div>
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
                        {invitationAction(row, canManage, opening.status) ===
                        "issue"
                          ? "Issue interview link"
                          : invitationAction(row, canManage, opening.status) ===
                              "copy"
                            ? "Copy link"
                            : "Review"}
                      </button>
                      {canManage &&
                        !["hired", "rejected"].includes(row.decision_state) && (
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
                                  href={currentInvitation(row, issuedLinks).url}
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
                  </div>
                ))}
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
                onClose={() => setTab("overview")}
              />
            ) : (
              <RecruitmentSection title="Interview setup">
                <OpeningPlan opening={opening} profile={profile} />
              </RecruitmentSection>
            ))}
        </>
      )}
      {formOpening !== undefined && data && (
        <OpeningForm
          opening={formOpening}
          data={data}
          busy={busy}
          onSave={(o) => mutate(() => recruitmentService.saveOpening(o))}
          onClose={() => setFormOpening(undefined)}
        />
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
