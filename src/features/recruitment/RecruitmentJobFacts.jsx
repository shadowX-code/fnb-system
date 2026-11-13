import AdminFormField from "../../components/forms/AdminFormField.jsx";
import SelectField from "../../components/forms/SelectField.jsx";

const fields = [
  ["employment_type", "Employment type"],
  ["offered_salary", "Offered salary"],
  ["working_hours", "Working hours"],
  ["shift_arrangement", "Shift arrangement"],
  ["public_holidays", "Public holiday terms"],
  ["benefits", "Benefits"],
  ["additional_facts", "Other hiring information"],
];

export default function RecruitmentJobFacts({ config, onChange, initiallyOpen }) {
  const confirmed = config.job_facts || {};
  const pending = config.unverified_job_facts || {};
  const hasOfferings = Boolean(config.employment_offerings?.length);
  function setFact(key, status, value) {
    const nextConfirmed = { ...confirmed };
    const nextPending = { ...pending };
    delete nextConfirmed[key];
    delete nextPending[key];
    if (status === "verified") nextConfirmed[key] = value;
    if (status === "unverified") nextPending[key] = value;
    onChange({ ...config, job_facts:nextConfirmed, unverified_job_facts:nextPending });
  }

  return (
    <details className="recruitment-config-details" open={initiallyOpen || undefined}>
      <summary>Job Facts</summary>
      <p className="recruitment-config-note">
        Verified terms may be shared with candidates. Unverified terms are for HR follow-up.
        Use Employment Offerings for terms that differ by employment type.
      </p>
      <div className="grid gap-3">
        {fields.map(([key, label]) => {
          const status = Object.hasOwn(confirmed,key) ? "verified" : Object.hasOwn(pending,key) ? "unverified" : "unspecified";
          const value = confirmed[key] ?? pending[key] ?? "";
          return (
            <div key={key} className="grid items-end gap-2 sm:grid-cols-[minmax(10rem,1fr)_2fr]">
              <AdminFormField label={label}>
                <SelectField ariaLabel={`${label} verification`} value={status}
                  options={[
                    {value:"unspecified",label:"Unspecified"},
                    {value:"unverified",label:"Unverified"},
                    {value:"verified",label:"Verified",disabled:hasOfferings && key !== "additional_facts" && status !== "verified"},
                  ]}
                  onChange={next => setFact(key,next,value)} />
              </AdminFormField>
              {status !== "unspecified" && (
                <AdminFormField label={`${label} details`}>
                  <input className="control w-full" value={value} maxLength={1000}
                    onChange={e => setFact(key,status,e.target.value)} />
                </AdminFormField>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}
