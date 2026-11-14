import AdminFormField from "../../components/forms/AdminFormField.jsx";

const legacyLabels = {
  employment_type: "Employment type",
  offered_salary: "Offered salary",
  working_hours: "Working hours",
  shift_arrangement: "Shift arrangement",
  public_holidays: "Public holiday terms",
  benefits: "Benefits",
};

export default function RecruitmentJobFacts({ config, description, onChange }) {
  const confirmed = config.job_facts || {};
  const pending = config.unverified_job_facts || {};
  const context = config.job_context || {};
  const value = confirmed.additional_facts ?? pending.additional_facts ?? "";
  const verified = Object.hasOwn(confirmed, "additional_facts");
  const legacy = [
    ["Job scope", description],
    ["Operating days", context.operating_days?.join(", ")],
    ["Operating hours", [context.operating_start, context.operating_end].filter(Boolean).join("–")],
    ["Additional job information", context.shared_facts],
    ...(context.additional_information || []).map(({ topic, information }) => [topic, information]),
    ...Object.entries(legacyLabels).flatMap(([key, label]) => [
      [`${label} · Verified`, confirmed[key]],
      [`${label} · Unverified`, pending[key]],
    ]),
  ].filter(([, text]) => text);

  function update(text, isVerified) {
    const job_facts = { ...confirmed };
    const unverified_job_facts = { ...pending };
    delete job_facts.additional_facts;
    delete unverified_job_facts.additional_facts;
    (isVerified ? job_facts : unverified_job_facts).additional_facts = text;
    onChange({ job_facts, unverified_job_facts });
  }

  return (
    <>
      <AdminFormField label="Additional AI Knowledge"
        helper="Add optional job-specific facts the interviewer can share, such as where to report on the first day. Use Employment & Pay for terms and Job Requirements for checks.">
        <textarea className="control w-full" rows={4} maxLength={1000}
          value={value} onChange={(event) => update(event.target.value, false)} />
      </AdminFormField>
      {value.trim() && (
        <label className="recruitment-knowledge-confirm">
          <input className="admin-checkbox" type="checkbox" checked={verified}
            onChange={(event) => update(value, event.target.checked)} />
          <span>Confirmed and approved to share with candidates
            {!verified && <small>Unverified · visible to HR only</small>}
          </span>
        </label>
      )}
      {legacy.length > 0 && (
        <details className="recruitment-job-detail">
          <summary>Previously saved job information</summary>
          <dl className="recruitment-saved-facts">
            {legacy.map(([label, text], index) => (
              <div key={index}>
                <dt>{label}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </>
  );
}
