import { useState } from "react";
import { Plus, X } from "lucide-react";
import AdminFormField from "../../components/forms/AdminFormField.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import OpeningOfferings from "./OpeningOfferings.jsx";
import RecruitmentJobFacts from "./RecruitmentJobFacts.jsx";
import { OpeningPlan } from "./RecruitmentPresentation.jsx";

export const initialOpening = {
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
    interview_profile_id: "",
  },
};

const control = "control w-full";
const statusOptions = [
  { value: "draft", label: "Draft" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
];
const requirementOptions = [
  { value: "weekend_required", label: "Weekend availability" },
  { value: "closing_shift", label: "Closing shift", placeholder: "e.g. Available to close at 10 pm" },
  { value: "preferred_start", label: "Preferred start date", placeholder: "e.g. Can start by 1 December" },
];

function JobRequirements({ value, onChange, editing }) {
  const visible = requirementOptions.filter(({ value: key }) => Object.hasOwn(value, key));
  const available = requirementOptions.filter(({ value: key }) => !Object.hasOwn(value, key));
  return (
    <>
      <p className="recruitment-config-note">
        The interviewer checks these with candidates. Put information it should only share under AI Interview &amp; Knowledge.
      </p>
      <div className="recruitment-requirements-list">
        {visible.map(({ value: key, label, placeholder }) => (
          <div className="recruitment-requirement-row" key={key}>
            <AdminFormField label={label}>
              {key === "weekend_required" ? (
                <SelectField
                  ariaLabel={label}
                  value={value[key] ? "required" : "flexible"}
                  options={[
                    { value: "required", label: "Weekend availability required" },
                    { value: "flexible", label: "Discuss availability" },
                  ]}
                  onChange={(next) => onChange({ ...value, [key]: next === "required" })}
                />
              ) : (
                <input className={control} placeholder={placeholder} maxLength={240}
                  value={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.value })} />
              )}
            </AdminFormField>
            {editing && (
              <button type="button" className="btn-secondary" aria-label={`Remove ${label.toLowerCase()}`}
                onClick={() => {
                  const next = { ...value };
                  delete next[key];
                  onChange(next);
                }}>
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        {!visible.length && <p className="text-sm text-text-secondary">No job-specific requirements added.</p>}
        {editing && available.length > 0 && (
          <div className="recruitment-add-requirement">
            <SelectField ariaLabel="Add requirement" placeholder="Add requirement"
              value="" options={available}
              onChange={(key) => {
                if (key) onChange({ ...value, [key]: key === "weekend_required" ? true : "" });
              }} />
          </div>
        )}
      </div>
    </>
  );
}

export default function OpeningForm({ opening, data, busy, onSave, onClose, inline = false }) {
  const [draft, setDraft] = useState(() => structuredClone(opening || initialOpening));
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(!inline);
  const [showLocation, setShowLocation] = useState(false);
  const patch = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const patchConfig = (key, value) => setDraft((current) => ({
    ...current,
    config: { ...current.config, [key]: value },
  }));
  const config = draft.config;
  const context = config.job_context || {};
  const profile = data.profiles.find((row) => row.id === config.interview_profile_id);
  const workplace = draft.outlet_id || draft.workplace;
  const outlet = data.outlets.find((row) => row.id === workplace);
  const workplaceName = outlet?.name || draft.workplace;
  const canonicalLocation = outlet?.candidate_location?.trim();
  const location = context.location || "";
  const isDifferentLocation = (value, name) => Boolean(value?.trim() && value.trim().toLowerCase() !== name?.trim().toLowerCase());
  const hasDifferentLocation = isDifferentLocation(location, workplaceName);
  const showLocationInput = editing ? showLocation || hasDifferentLocation : hasDifferentLocation;

  function changeWorkplace(value) {
    if (value === workplace) return;
    const nextOutlet = data.outlets.find((row) => row.id === value);
    const next = { ...context };
    delete next.location;
    if (isDifferentLocation(nextOutlet?.candidate_location, nextOutlet?.name)) {
      next.location = nextOutlet.candidate_location.trim();
    }
    setShowLocation(false);
    setDraft((current) => ({
      ...current,
      outlet_id: nextOutlet?.id || "",
      workplace: nextOutlet ? "" : value,
      config: { ...current.config, job_context: next },
    }));
  }

  function changeLocation(value) {
    const next = { ...context };
    if (value) next.location = value;
    else delete next.location;
    patchConfig("job_context", next);
  }

  async function submit(status = draft.status) {
    setError("");
    const requirements = Object.fromEntries(Object.entries(config.opening_requirements || {})
      .filter(([, value]) => typeof value !== "string" || value.trim()));
    const nextContext = { ...context };
    if (typeof nextContext.location === "string" && !nextContext.location.trim()) delete nextContext.location;
    // Clearing the optional textarea returns that fact to Unspecified.
    const prepareFacts = (facts) => {
      if (!facts || !Object.hasOwn(facts, "additional_facts") || facts.additional_facts.trim()) return facts;
      const next = { ...facts };
      delete next.additional_facts;
      return next;
    };
    try {
      await onSave({
        ...draft,
        status,
        outlet_id: outlet?.id || null,
        workplace: outlet ? "" : workplace,
        config: {
          ...config,
          job_context: nextContext,
          opening_requirements: requirements,
          job_facts: prepareFacts(config.job_facts) || {},
          unverified_job_facts: prepareFacts(config.unverified_job_facts) || {},
        },
      });
      onClose();
    } catch (cause) {
      setError(cause.message || "Unable to save job setup.");
    }
  }

  return (
    <form className="recruitment-setup" onSubmit={(event) => {
      event.preventDefault();
      if (editing && !busy) submit();
    }}>
      {inline && !editing && (
        <div className="recruitment-setup-header">
          <strong>Job Setup</strong>
          <button type="button" className="btn-primary" onClick={() => setEditing(true)}>Edit setup</button>
        </div>
      )}
      <fieldset disabled={!editing || busy} className="recruitment-setup-fields recruitment-form">
        <section className="recruitment-setup-section" aria-labelledby="job-details">
          <h2 id="job-details">Job Details</h2>
          <div className="recruitment-form-grid">
            <AdminFormField label="Job title" required>
              <input className={control} value={draft.title} maxLength={160} onChange={(event) => patch("title", event.target.value)} />
            </AdminFormField>
            <AdminFormField label="Position" required>
              <SelectField ariaLabel="Position" placeholder="Select position" searchable value={draft.position_id}
                options={data.positions.map((row) => ({ value: row.id, label: row.name }))}
                onChange={(value) => setDraft((current) => ({
                  ...current,
                  position_id: value,
                  config: {
                    ...current.config,
                    interview_profile_id: profile?.position_id && profile.position_id !== value ? "" : current.config.interview_profile_id,
                  },
                }))} />
            </AdminFormField>
            <AdminFormField label="Workplace" required>
              <SelectField ariaLabel="Workplace" placeholder="Select workplace" searchable value={workplace}
                options={[
                  ...data.outlets.map((row) => ({ value: row.id, label: row.name })),
                  { value: "Factory", label: "Factory" },
                  { value: "Management", label: "Management" },
                ]}
                onChange={changeWorkplace} />
            </AdminFormField>
            <AdminFormField label="Legal employer" required>
              <SelectField ariaLabel="Legal employer" placeholder="Select legal employer" searchable value={draft.legal_entity_id}
                options={data.legal_entities.map((row) => ({ value: row.id, label: row.name }))}
                onChange={(value) => patch("legal_entity_id", value)} />
            </AdminFormField>
            <AdminFormField label="Status">
              <SelectField ariaLabel="Status" value={draft.status}
                options={opening?.status === "closed" ? statusOptions.slice(-1) : statusOptions}
                onChange={(value) => patch("status", value)} />
            </AdminFormField>
            {workplace && (showLocationInput ? (
              <AdminFormField label="Candidate-facing location" helper="Use only when it differs from the workplace shown here.">
                <input className={control} maxLength={2000} value={location}
                  placeholder={canonicalLocation || workplaceName}
                  onChange={(event) => {
                    setShowLocation(true);
                    changeLocation(event.target.value);
                  }} />
              </AdminFormField>
            ) : editing && (
              <div className="recruitment-add-location">
                <button type="button" className="btn-secondary" onClick={() => setShowLocation(true)}>
                  <Plus size={16} aria-hidden="true" /> Add candidate-facing location
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="recruitment-setup-section" aria-labelledby="job-offerings">
          <h2 id="job-offerings">Employment &amp; Pay</h2>
          <OpeningOfferings value={config.employment_offerings || []}
            onChange={(value) => patchConfig("employment_offerings", value)} editing={editing} />
        </section>

        <section className="recruitment-setup-section" aria-labelledby="job-requirements">
          <h2 id="job-requirements">Job Requirements</h2>
          <JobRequirements value={config.opening_requirements || {}} editing={editing}
            onChange={(value) => patchConfig("opening_requirements", value)} />
        </section>

        <section className="recruitment-setup-section" aria-labelledby="job-interview">
          <h2 id="job-interview">AI Interview &amp; Knowledge</h2>
          <div className="recruitment-form-grid">
            <AdminFormField label="Interview Profile" helper="Required to open a job. Each invitation keeps the selected version.">
              <SelectField ariaLabel="Interview Profile" placeholder="Select a published profile" searchable
                value={config.interview_profile_id || ""}
                options={data.profiles.filter((row) => !row.position_id || row.position_id === draft.position_id)
                  .map((row) => ({ value: row.id, label: `${row.name} v${row.version}` }))}
                onChange={(value) => patchConfig("interview_profile_id", value)} />
            </AdminFormField>
            {profile && (
              <div className="recruitment-profile-facts">
                <span>{profile.definition.evidence_areas.length} assessment areas · {profile.definition.scenarios.length} scenarios</span>
                <span>{profile.definition.target_minutes} min target · {profile.definition.max_minutes} min maximum</span>
              </div>
            )}
          </div>
          {profile && (
            <details className="recruitment-job-detail">
              <summary>View Profile</summary>
              <OpeningPlan opening={draft} profile={profile} />
            </details>
          )}
          <RecruitmentJobFacts config={config} description={draft.description}
            onChange={(fields) => setDraft((current) => ({ ...current, config: { ...current.config, ...fields } }))} />
          <details className="recruitment-job-detail">
            <summary>Advanced Settings</summary>
            <div className="recruitment-form-grid">
              <AdminFormField label="Candidate instructions" helper="Shown to the candidate before the interview.">
                <textarea className={control} rows={3} maxLength={2000} value={config.candidate_instructions || ""}
                  onChange={(event) => patchConfig("candidate_instructions", event.target.value)} />
              </AdminFormField>
              <AdminFormField label="Language guidance">
                <textarea className={control} rows={3} maxLength={1000} value={config.language_guidance || ""}
                  onChange={(event) => patchConfig("language_guidance", event.target.value)} />
              </AdminFormField>
            </div>
          </details>
        </section>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {editing && (
        <div className="recruitment-setup-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => {
            if (!inline) return onClose();
            setDraft(structuredClone(opening));
            setShowLocation(false);
            setEditing(false);
            setError("");
          }}>Cancel</button>
          {draft.status === "draft" ? (
            <>
              <button type="submit" className="btn-secondary" disabled={busy}>Save draft</button>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => submit("open")}>Open job</button>
            </>
          ) : <button type="submit" className="btn-primary" disabled={busy}>Save changes</button>}
        </div>
      )}
    </form>
  );
}
