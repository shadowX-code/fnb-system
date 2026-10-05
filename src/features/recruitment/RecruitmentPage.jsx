import { useEffect, useState } from "react";
import PageHeader from "../../components/layout/PageHeader.jsx";
import Card from "../../components/ui/Card.jsx";
import Badge from "../../components/ui/Badge.jsx";
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

function OpeningForm({ opening, data, busy, onSave, onClose }) {
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
  return (
    <Modal
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
      <div className="grid gap-4 md:grid-cols-2">
        <AdminFormField label="Job-facing title" required>
          <input
            className={fieldClass}
            value={draft.title}
            onChange={(e) => patch("title", e.target.value)}
          />
        </AdminFormField>
        <AdminFormField label="Canonical position" required>
          <select
            className={fieldClass}
            value={draft.position_id}
            onChange={(e) => patch("position_id", e.target.value)}
          >
            <option value="">Select position</option>
            {data.positions.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </AdminFormField>
        <AdminFormField label="Workplace" required>
          <select
            className={fieldClass}
            value={workplaceValue}
            onChange={(e) => {
              patch("outlet_id", e.target.value);
              patch("workplace", e.target.value);
            }}
          >
            <option value="">Select workplace</option>
            {data.outlets.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
            <option value="Factory">Factory</option>
            <option value="Management">Management</option>
          </select>
        </AdminFormField>
        <AdminFormField label="Legal employer" required>
          <select
            className={fieldClass}
            value={draft.legal_entity_id}
            onChange={(e) => patch("legal_entity_id", e.target.value)}
          >
            <option value="">Select legal entity</option>
            {data.legal_entities.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </AdminFormField>
        <AdminFormField label="Status">
          <select
            className={fieldClass}
            value={draft.status}
            onChange={(e) => patch("status", e.target.value)}
          >
            <option value="draft">Draft</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </AdminFormField>
        <AdminFormField label="Description">
          <input
            className={fieldClass}
            value={draft.description}
            onChange={(e) => patch("description", e.target.value)}
          />
        </AdminFormField>
        <AdminFormField
          label="Interview Profile"
          required
          className="md:col-span-2"
          helper="This version is pinned when an invitation is issued."
        >
          <select
            className={fieldClass}
            value={draft.config.interview_profile_id || ""}
            onChange={(e) =>
              patchConfig("interview_profile_id", e.target.value)
            }
          >
            {!draft.config.interview_profile_id && (
              <option value="">
                {opening
                  ? "Existing opening configuration"
                  : "Select profile version"}
              </option>
            )}
            {data.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} v{p.version}
              </option>
            ))}
          </select>
        </AdminFormField>
        {profile && (
          <p className="md:col-span-2 text-sm text-text-secondary">
            {profile.definition.evidence_areas.map((a) => a.name).join(" · ")}
            <br />
            Target {profile.definition.target_minutes} min · Maximum{" "}
            {profile.definition.max_minutes} min
          </p>
        )}
        <AdminFormField label="Weekend availability">
          <select
            className={fieldClass}
            value={requirements.weekend_required ? "required" : "flexible"}
            onChange={(e) =>
              patchRequirements(
                "weekend_required",
                e.target.value === "required",
              )
            }
          >
            <option value="flexible">Discuss availability</option>
            <option value="required">Weekend availability required</option>
          </select>
        </AdminFormField>
        <AdminFormField label="Closing shift requirement / time">
          <input
            className={fieldClass}
            maxLength={240}
            value={requirements.closing_shift || ""}
            onChange={(e) => patchRequirements("closing_shift", e.target.value)}
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
                      onChange={(e) => patchConfig(key, Number(e.target.value))}
                    />
                  </AdminFormField>
                ))}
              </div>
            </div>
          </details>
        )}
        <AdminFormField label="Language guidance" className="md:col-span-2">
          <textarea
            className={fieldClass}
            value={draft.config.language_guidance}
            onChange={(e) => patchConfig("language_guidance", e.target.value)}
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
      {error ? (
        <p role="alert" className="mt-4 text-red-700">
          {error}
        </p>
      ) : null}
    </Modal>
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
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const canManage =
    auth?.hasPermission?.("recruitment.manage") ||
    auth?.permissions?.includes?.("recruitment.manage");
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
      await mutate(() =>
        recruitmentService.registerApplication(
          selectedOpening,
          applicant,
          selectedApplicant || null,
        ),
      );
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
      const token = await mutate(() =>
        recruitmentService.issueInvitation(
          row.id,
          new Date(Date.now() + 7 * 86400000).toISOString(),
        ),
      );
      const origin = import.meta.env.VITE_INTERVIEW_WEB_APP_HOSTNAME
        ? `https://${import.meta.env.VITE_INTERVIEW_WEB_APP_HOSTNAME}`
        : ["os.feedx.my", "feedx-os.vercel.app"].includes(
              window.location.hostname,
            )
          ? "https://interview.feedx.my"
          : window.location.origin;
      setInvitation(`${origin}/i/${token}`);
    } catch {
      /* visible error */
    }
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
  return (
    <div className="space-y-5">
      {openingId && (
        <button
          type="button"
          className="text-sm text-text-secondary hover:text-primary"
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
            : "Open roles and the candidates moving through them."
        }
        secondaryActions={
          canManage && !openingId ? (
            <button
              type="button"
              className="btn-ghost"
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
          className="rounded-xl bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {!openingId && data && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-4 sm:grid-cols-4">
          {[
            { key: "open_roles", label: "Open roles" },
            { key: "interviewing", label: "Interviewing" },
            { key: "needs_review", label: "Needs review" },
            { key: "shortlisted", label: "Shortlisted" },
          ].map((item) => (
            <div key={item.key}>
              <dt className="text-xs text-text-secondary">{item.label}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {data.summary[item.key]}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {!openingId && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">
            {includeClosed ? "All openings" : "Active openings"}
          </h2>
          <div className="flex flex-wrap gap-4 text-xs text-text-secondary">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeClosed}
                onChange={(e) => setIncludeClosed(e.target.checked)}
              />
              Include closed
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeQa}
                onChange={(e) => setIncludeQa(e.target.checked)}
              />
              Include QA openings
            </label>
          </div>
        </div>
      )}
      {loading ? (
        <p role="status" className="py-8 text-sm text-text-muted">
          Loading Recruitment…
        </p>
      ) : !data ? (
        <button
          className="btn-secondary"
          onClick={() => load().catch((e) => setError(e.message))}
        >
          Retry
        </button>
      ) : !openingId ? (
        <div className="divide-y divide-border rounded-xl bg-surface">
          {data.openings
            .filter((o) => includeClosed || o.status !== "closed")
            .map((o) => (
              <button
                type="button"
                key={o.id}
                className="flex w-full flex-col gap-3 px-4 py-4 text-left transition-colors hover:bg-surface-muted sm:flex-row sm:items-center sm:justify-between"
                onClick={() => selectOpening(o.id)}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{o.title}</span>
                    <Badge tone={o.status === "open" ? "success" : "neutral"}>
                      {o.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-text-secondary">
                    {o.workplace} ·{" "}
                    {o.profile
                      ? `${o.profile.name} v${o.profile.version}`
                      : "Opening interview configuration"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-secondary">
                  <span>
                    <strong className="text-text-primary">
                      {o.pipeline.total}
                    </strong>{" "}
                    candidates
                  </span>
                  <span>
                    <strong className="text-text-primary">
                      {o.pipeline.interviewing}
                    </strong>{" "}
                    interviewing
                  </span>
                  <span>
                    <strong className="text-text-primary">
                      {o.pipeline.needs_review}
                    </strong>{" "}
                    need review
                  </span>
                  <span>
                    <strong className="text-text-primary">
                      {o.pipeline.shortlisted}
                    </strong>{" "}
                    shortlisted
                  </span>
                  <span aria-hidden="true">→</span>
                </div>
              </button>
            ))}
          {!data.openings.some(
            (o) => includeClosed || o.status !== "closed",
          ) && (
            <p className="p-5 text-sm text-text-secondary">
              No active openings. Create an opening to begin recruitment.
            </p>
          )}
        </div>
      ) : !opening ? (
        <p className="py-6 text-text-secondary">
          This opening is unavailable in the current view.
        </p>
      ) : (
        <>
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
          {tab === "overview" && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <Badge tone={opening.status === "open" ? "success" : "neutral"}>
                  {opening.status}
                </Badge>
                <span>{position}</span>
                <span className="text-text-secondary">
                  {profile
                    ? `${profile.name} v${profile.version}`
                    : "Opening interview configuration"}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-3 border-y border-border py-4 sm:grid-cols-5">
                {pipeline.map((item) => (
                  <div key={item.key}>
                    <dt className="text-xs text-text-secondary">
                      {item.label}
                    </dt>
                    <dd className="mt-1 text-xl font-semibold tabular-nums">
                      {opening.pipeline[item.key]}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="grid gap-6 lg:grid-cols-2">
                <section>
                  <h2 className="font-semibold">Needs attention</h2>
                  <div className="mt-3 space-y-3">
                    {opening.pipeline.needs_review > 0 && (
                      <button
                        type="button"
                        className="flex w-full justify-between rounded-lg bg-surface-muted p-3 text-sm"
                        onClick={() => {
                          setStage("needs_review");
                          setPage(1);
                          setTab("candidates");
                        }}
                      >
                        <span>Interviews ready for review</span>
                        <strong>{opening.pipeline.needs_review} →</strong>
                      </button>
                    )}
                    {opening.pipeline.invited > 0 && (
                      <button
                        type="button"
                        className="flex w-full justify-between rounded-lg bg-surface-muted p-3 text-sm"
                        onClick={() => {
                          setStage("invited");
                          setPage(1);
                          setTab("candidates");
                        }}
                      >
                        <span>Invited candidates</span>
                        <strong>{opening.pipeline.invited} →</strong>
                      </button>
                    )}
                    {!opening.pipeline.needs_review &&
                      !opening.pipeline.invited && (
                        <p className="text-sm text-text-secondary">
                          No interviews awaiting review or invitation follow-up.
                        </p>
                      )}
                  </div>
                </section>
                <section>
                  <h2 className="font-semibold">Recent activity</h2>
                  <ul className="mt-2 divide-y divide-border">
                    {data.activity.map((e, i) => (
                      <li key={i} className="py-2 text-sm">
                        <p>
                          {eventLabels[e.action] || "Recruitment updated"}
                          {e.candidate ? ` · ${e.candidate}` : ""}
                        </p>
                        <time className="text-xs text-text-muted">
                          {new Date(e.occurred_at).toLocaleString()}
                        </time>
                      </li>
                    ))}
                  </ul>
                  {!data.activity.length && (
                    <p className="mt-3 text-sm text-text-secondary">
                      No recent activity.
                    </p>
                  )}
                </section>
              </div>
            </div>
          )}
          {tab === "candidates" && (
            <div className="space-y-3">
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
              <div className="divide-y divide-border rounded-xl bg-surface">
                {data.applications.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => setReviewApplication(row)}
                    >
                      <p className="font-medium hover:text-primary">
                        {row.name}
                      </p>
                      <p className="mt-0.5 text-xs text-text-secondary">
                        {stages[row.stage]} · {row.contact}
                        {row.recording_state &&
                        ["partial", "failed"].includes(row.recording_state)
                          ? ` · ${row.recording_state} recording`
                          : ""}
                        {row.revoked_at
                          ? " · Invitation revoked"
                          : row.expires_at &&
                              Date.parse(row.expires_at) < Date.now()
                            ? " · Invitation expired"
                            : ""}
                      </p>
                    </button>
                    <div className="flex items-center gap-2">
                      {row.stage === "registered" && canManage ? (
                        <button
                          className="btn-secondary"
                          disabled={busy || opening.status !== "open"}
                          onClick={() => issue(row)}
                        >
                          Invite
                        </button>
                      ) : row.stage === "needs_review" ? (
                        <button
                          className="btn-secondary"
                          onClick={() => setReviewApplication(row)}
                        >
                          Review
                        </button>
                      ) : null}
                      {canManage &&
                        !["hired", "rejected"].includes(row.decision_state) && (
                          <details className="relative">
                            <summary
                              aria-label={`Actions for ${row.name}`}
                              className="btn-ghost cursor-pointer list-none"
                            >
                              •••
                            </summary>
                            <div className="absolute right-0 top-full z-10 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-md">
                              <button
                                type="button"
                                className="block w-full rounded p-2 text-left text-sm hover:bg-surface-muted"
                                onClick={() => setReviewApplication(row)}
                              >
                                Application details
                              </button>
                              {opening.status === "open" && (
                                <button
                                  type="button"
                                  className="block w-full rounded p-2 text-left text-sm hover:bg-surface-muted"
                                  disabled={busy}
                                  onClick={() => issue(row)}
                                >
                                  Issue new invitation
                                </button>
                              )}
                              {row.issued_at && !row.revoked_at && (
                                <button
                                  type="button"
                                  className="block w-full rounded p-2 text-left text-sm hover:bg-surface-muted"
                                  disabled={busy}
                                  onClick={() =>
                                    mutate(() =>
                                      recruitmentService.revokeInvitation(
                                        row.id,
                                      ),
                                    ).catch(() => {})
                                  }
                                >
                                  Revoke invitation
                                </button>
                              )}
                            </div>
                          </details>
                        )}
                    </div>
                  </div>
                ))}
                {!data.applications.length && (
                  <p className="p-5 text-sm text-text-secondary">
                    No candidates in this stage.
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span>
                  {data.applications_total} candidates · Page {data.page}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={page * data.page_size >= data.applications_total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
          {tab === "setup" && (
            <div className="grid gap-5 lg:grid-cols-2">
              <Card
                title="Opening details"
                action={
                  canManage ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setFormOpening(opening)}
                    >
                      Edit setup
                    </button>
                  ) : null
                }
              >
                <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
                  <dt className="text-text-secondary">Position</dt>
                  <dd>{position}</dd>
                  <dt className="text-text-secondary">Workplace</dt>
                  <dd>{opening.workplace}</dd>
                  <dt className="text-text-secondary">Employer</dt>
                  <dd>{employer}</dd>
                  <dt className="text-text-secondary">Status</dt>
                  <dd>{opening.status}</dd>
                </dl>
                {opening.description && (
                  <p className="px-4 pb-4 text-sm">{opening.description}</p>
                )}
              </Card>
              <Card title="Interview plan">
                <div className="space-y-3 p-4 text-sm">
                  <p className="font-medium">
                    {profile
                      ? `${profile.name} v${profile.version}`
                      : "Existing opening configuration"}
                  </p>
                  <p className="text-text-secondary">
                    Target {opening.config.target_minutes} min · Maximum{" "}
                    {opening.config.max_minutes} min
                  </p>
                  <p>
                    {requirements.weekend_required
                      ? "Weekend availability required"
                      : "Discuss weekend availability"}
                    {requirements.closing_shift
                      ? ` · Closing: ${requirements.closing_shift}`
                      : ""}
                    {requirements.preferred_start
                      ? ` · Preferred start: ${requirements.preferred_start}`
                      : ""}
                  </p>
                  <div className="divide-y divide-border">
                    {(
                      profile?.definition.evidence_areas ||
                      opening.config.required_topics.map((name) => ({
                        name,
                        priority: "Required",
                      }))
                    ).map((a) => (
                      <p key={a.name} className="py-2">
                        {a.name}
                        <span className="ml-2 text-xs text-text-muted">
                          {a.priority}
                        </span>
                      </p>
                    ))}
                  </div>
                  <p className="text-text-secondary">
                    {opening.config.scenario_briefs.join(" · ")}
                  </p>
                  <p className="text-xs text-text-muted">
                    Invitations use a version fixed at issue time. New setup
                    versions do not change earlier interviews. Issue or revoke
                    individual invitations from Candidates.
                  </p>
                </div>
              </Card>
            </div>
          )}
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
      {profilesOpen && data?.profiles.length > 0 && (
        <InterviewProfileSettings
          profiles={data.profiles}
          busy={busy}
          onPublish={(definition, version) =>
            mutate(() => recruitmentService.publishProfile(definition, version))
          }
          onClose={() => setProfilesOpen(false)}
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
              <select
                required
                className={fieldClass}
                value={selectedOpening}
                onChange={(e) => setSelectedOpening(e.target.value)}
              >
                <option value="">Select opening</option>
                {data.openings
                  .filter((x) => x.status === "open")
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title}
                    </option>
                  ))}
              </select>
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
                <select
                  className={fieldClass}
                  value={selectedApplicant}
                  onChange={(e) => setSelectedApplicant(e.target.value)}
                >
                  <option value="">Register new applicant</option>
                  {applicantResults.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {x.contact}
                    </option>
                  ))}
                </select>
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
      {invitation && (
        <Modal
          title="Interview invitation"
          description="Copy this link now. The full token cannot be retrieved later."
          onClose={() => setInvitation("")}
          footer={
            <button
              className="btn-primary"
              type="button"
              onClick={() => navigator.clipboard.writeText(invitation)}
            >
              Copy link
            </button>
          }
        >
          <p className="break-all rounded-lg bg-surface-muted p-3 text-sm">
            {invitation}
          </p>
        </Modal>
      )}
    </div>
  );
}
