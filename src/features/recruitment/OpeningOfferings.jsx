import AdminFormField from "../../components/forms/AdminFormField.jsx";
import TimePickerField from "../../components/forms/TimePickerField.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import { hourlyExplanation } from "../../../supabase/functions/recruitment-realtime/offerings.ts";
const types = {
  full_time: "Full time",
  part_time: "Part time",
  contract: "Contract",
  temporary: "Temporary",
  internship: "Internship",
};
export const days = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];
function Field({ label, value, onChange, type = "text", helper }) {
  if (type === "time") return <TimePickerField label={label} value={value || ""} onChange={v=>onChange(v || undefined)} />;
  return (
    <AdminFormField label={label} helper={helper}>
      <input
        className="control w-full"
        type={type}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "any" : undefined}
        maxLength={2000}
        value={value ?? ""}
        onChange={(e) =>
          onChange(
            e.target.value === ""
              ? undefined
              : type === "number"
                ? Number(e.target.value)
                : e.target.value,
          )
        }
      />
    </AdminFormField>
  );
}
function Choice({ label, value, onChange, options }) {
  return (
    <AdminFormField label={label}>
      <SelectField
        ariaLabel={label}
        value={value === undefined ? "" : String(value)}
        onChange={(v) =>
          onChange(
            v === ""
              ? undefined
              : v === "true"
                ? true
                : v === "false"
                  ? false
                  : v,
          )
        }
        options={[
          { value: "", label: "Unconfirmed" },
          ...Object.entries(options).map(([value, label]) => ({
            value,
            label,
          })),
        ]}
      />
    </AdminFormField>
  );
}
export function JobContextFields({
  value,
  onChange,
  description,
  onDescription,
}) {
  const set = (key, v) => {
    const next = { ...value };
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length))
      delete next[key];
    else next[key] = v;
    onChange(next);
  };
  return (
    <fieldset>
      <legend>Job / Workplace Context</legend>
      <p className="recruitment-config-note">
        Confirmed facts the interviewer may share. Blank information stays
        unconfirmed.
      </p>
      <div className="recruitment-form-grid">
        <Field
          label="Candidate-facing location"
          value={value.location}
          onChange={(v) => set("location", v)}
          helper="Opening-specific location; the canonical workplace stays linked above."
        />
        <Field
          label="Job scope"
          value={description}
          onChange={(v) => onDescription(v || "")}
        />
        <AdminFormField as="div" label="Operating days" className="md:col-span-2">
          <div className="recruitment-days">
            {days.map((d) => (
              <label key={d.value} className="admin-checkbox">
                <input
                  type="checkbox"
                  checked={(value.operating_days || []).includes(d.value)}
                  onChange={(e) =>
                    set(
                      "operating_days",
                      e.target.checked
                        ? [...(value.operating_days || []), d.value]
                        : (value.operating_days || []).filter(
                            (v) => v !== d.value,
                          ),
                    )
                  }
                />
                {d.label}
              </label>
            ))}
          </div>
        </AdminFormField>
        <Field
          label="Opens at"
          type="time"
          value={value.operating_start}
          onChange={(v) => set("operating_start", v)}
        />
        <Field
          label="Closes at"
          type="time"
          value={value.operating_end}
          onChange={(v) => set("operating_end", v)}
        />
      </div>
      <details className="recruitment-config-details">
        <summary>Other shared confirmed facts</summary>
        <Field
          label="Shared job facts"
          value={value.shared_facts}
          onChange={(v) => set("shared_facts", v)}
        />
      </details>
    </fieldset>
  );
}
export default function OpeningOfferings({ value = [], onChange }) {
  function patch(index, key, v) {
    onChange(
      value.map((o, i) => {
        if (i !== index) return o;
        const next = { ...o };
        if (v === undefined || v === "") delete next[key];
        else next[key] = v;
        return next;
      }),
    );
  }
  return (
    <fieldset className="recruitment-offerings">
      <legend>Employment Offerings</legend>
      <p className="recruitment-config-note">
        Configure the terms candidates can ask about. Both offerings use the
        same Interview Profile. Missing terms remain unconfirmed.
      </p>
      {value.map((o, i) => {
        const set = (k, v) => patch(i, k, v);
        const six = hourlyExplanation(o, 6),
          ten = hourlyExplanation(o, 10);
        return (
          <details
            key={o.id}
            className="recruitment-offering"
            open={value.length === 1 ? true : undefined}
          >
            <summary>
              <span>{types[o.employment_type] || "Employment offering"}</span>
              <span className="text-text-secondary">
                {o.amount_min !== undefined
                  ? `${o.currency || ""} ${o.amount_min}${o.amount_max !== undefined ? `–${o.amount_max}` : ""} / ${o.compensation_type === "hourly" ? "hour" : "month"}`
                  : "Compensation unconfirmed"}
              </span>
            </summary>
            <div className="recruitment-offering-body">
              <div className="recruitment-form-grid">
                <Choice
                  label="Employment type"
                  value={o.employment_type}
                  onChange={(v) => set("employment_type", v)}
                  options={types}
                />
                <Choice
                  label="Compensation"
                  value={o.compensation_type}
                  onChange={(v) => {
                    set("compensation_type", v);
                  }}
                  options={{
                    hourly: "Hourly / per hour",
                    monthly: "Monthly / per month",
                  }}
                />
                {o.compensation_type && (
                  <>
                    <Choice
                      label="Currency"
                      value={o.currency}
                      onChange={(v) => set("currency", v)}
                      options={{
                        MYR: "MYR · Malaysian ringgit",
                        SGD: "SGD",
                        USD: "USD",
                      }}
                    />
                    <Field
                      label="Amount / range from"
                      type="number"
                      value={o.amount_min}
                      onChange={(v) => set("amount_min", v)}
                    />
                    <Field
                      label="Range to (optional)"
                      type="number"
                      value={o.amount_max}
                      onChange={(v) => set("amount_max", v)}
                    />
                  </>
                )}
                <Field
                  label="Schedule / availability arrangement"
                  value={o.schedule}
                  onChange={(v) => set("schedule", v)}
                />
                <Field
                  label="Minimum commitment (months)"
                  type="number"
                  value={o.minimum_commitment_months}
                  onChange={(v) => set("minimum_commitment_months", v)}
                />
              </div>
              <p className="recruitment-config-note">
                Any final salary must be confirmed by the Supervisor. The
                interviewer cannot negotiate or promise an amount.
              </p>
              <details className="recruitment-config-details">
                <summary>Hours, breaks & meals</summary>
                <div className="recruitment-form-grid">
                  {[
                    ["working_start", "Starts at", "time"],
                    ["working_end", "Ends at", "time"],
                    [
                      "minimum_hours_per_shift",
                      "Minimum hours / shift (0 = no minimum)",
                      "number",
                    ],
                    [
                      "minimum_days_per_week",
                      "Minimum days / week (0 = no minimum)",
                      "number",
                    ],
                    [
                      "break_threshold_hours",
                      "Meal break applies from (worked hours)",
                      "number",
                    ],
                    ["break_minutes", "Meal break (minutes)", "number"],
                  ].map(([key, label, type]) => (
                    <Field
                      key={key}
                      label={label}
                      type={type}
                      value={o[key]}
                      onChange={(v) => set(key, v)}
                    />
                  ))}
                  <Choice
                    label="Is the break paid?"
                    value={o.break_paid}
                    onChange={(v) => set("break_paid", v)}
                    options={{
                      true: "Paid",
                      false: "Excluded from paid hours",
                    }}
                  />
                  <Field
                    label="Break timing / coverage"
                    value={o.break_guidance}
                    onChange={(v) => set("break_guidance", v)}
                  />
                  <Field
                    label="Staff meals / working day"
                    type="number"
                    value={o.staff_meals_per_workday}
                    onChange={(v) => set("staff_meals_per_workday", v)}
                  />
                  <Field
                    label="Staff meal applies from (worked hours)"
                    type="number"
                    value={o.staff_meal_threshold_hours}
                    onChange={(v) => set("staff_meal_threshold_hours", v)}
                  />
                  <Field
                    label="Rest days / week"
                    type="number"
                    value={o.rest_days_per_week}
                    onChange={(v) => set("rest_days_per_week", v)}
                  />
                </div>
                {six && ten && (
                  <p className="recruitment-pay-preview">
                    Configured ordinary-rate examples: 6h → {six.paid_hours}{" "}
                    paid hours → {six.currency} {six.amount}; 10h →{" "}
                    {ten.paid_hours} paid hours → {ten.currency} {ten.amount}.
                    OT and holiday calculations are not included.
                  </p>
                )}
              </details>
              <details className="recruitment-config-details">
                <summary>Benefits, probation & payment</summary>
                <div className="recruitment-form-grid">
                  <Choice
                    label="Public-holiday terms"
                    value={o.public_holiday_rule}
                    onChange={(v) => set("public_holiday_rule", v)}
                    options={{
                      double_pay: "Double pay",
                      custom: "Other confirmed terms",
                    }}
                  />
                  {o.public_holiday_rule === "custom" && (
                    <Field
                      label="Confirmed public-holiday terms"
                      value={o.public_holiday_details}
                      onChange={(v) => set("public_holiday_details", v)}
                    />
                  )}
                  <Field
                    label="Monthly payday (day)"
                    type="number"
                    value={o.payday_day}
                    onChange={(v) => set("payday_day", v)}
                  />
                  <Choice
                    label="Payment method"
                    value={o.payment_method}
                    onChange={(v) => set("payment_method", v)}
                    options={{
                      bank: "Bank account",
                      cash: "Cash",
                      other: "Other confirmed arrangement",
                    }}
                  />
                  <Choice
                    label="Uniform provided"
                    value={o.uniform_provided}
                    onChange={(v) => set("uniform_provided", v)}
                    options={{ true: "Provided", false: "Not provided" }}
                  />
                  <Field
                    label="Probation from (months)"
                    type="number"
                    value={o.probation_min_months}
                    onChange={(v) => set("probation_min_months", v)}
                  />
                  <Field
                    label="Probation to (months)"
                    type="number"
                    value={o.probation_max_months}
                    onChange={(v) => set("probation_max_months", v)}
                  />
                  <Field
                    label="Post-confirmation terms"
                    value={o.post_confirmation_terms}
                    onChange={(v) => set("post_confirmation_terms", v)}
                  />
                  <Field
                    label="Salary confirmation"
                    value={o.salary_confirmation}
                    onChange={(v) => set("salary_confirmation", v)}
                  />
                  <Field
                    label="Other approved candidate-facing facts"
                    value={o.other_facts}
                    onChange={(v) => set("other_facts", v)}
                  />
                </div>
              </details>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  onChange(value.filter((_, index) => index !== i))
                }
              >
                Remove offering
              </button>
            </div>
          </details>
        );
      })}
      {!value.length && (
        <p className="recruitment-config-note">
          No confirmed employment terms yet. Add an offering when the hiring
          team has confirmed them.
        </p>
      )}
      <button
        type="button"
        className="btn-secondary"
        disabled={value.length >= 6}
        onClick={() =>
          onChange([
            ...value,
            { id: crypto.randomUUID(), employment_type: "full_time" },
          ])
        }
      >
        + Add employment offering
      </button>
      <p className="recruitment-config-note mt-3">
        OT policy and calculation are unconfirmed. Unspecified benefits,
        increments and leave entitlements must not be promised.
      </p>
    </fieldset>
  );
}
