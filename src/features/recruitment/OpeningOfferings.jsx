import { useState } from "react";
import { Plus } from "lucide-react";
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
function Field({ label, value, onChange, type = "text", helper }) {
  if (type === "time")
    return (
      <TimePickerField
        label={label}
        value={value || ""}
        onChange={(v) => onChange(v || undefined)}
      />
    );
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
function Choice({ label, value, onChange, options, allowUnconfirmed = true }) {
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
          ...(allowUnconfirmed ? [{ value: "", label: "Unconfirmed" }] : []),
          ...Object.entries(options).map(([value, label]) => ({
            value,
            label,
          })),
        ]}
      />
    </AdminFormField>
  );
}
const payTypes = { hourly: "Hourly", monthly: "Monthly" };
const currencies = { MYR: "MYR", SGD: "SGD", USD: "USD" };
const holidayRules = { double_pay: "Double pay", custom: "Other confirmed terms" };
const paymentMethods = { bank: "Bank account", cash: "Cash", other: "Other arrangement" };
const hasValue = (value) => value !== undefined && value !== null && value !== "";
const summary = (...parts) => parts.filter(Boolean).join(" · ");
const quantity = (value, unit) => hasValue(value) ? `${value} ${unit}` : "";

const optionalGroups = [
  {
    id: "breaks",
    label: "Breaks",
    fields: [
      ["break_threshold_hours", "Applies from (worked hours)", "number"],
      ["break_minutes", "Break length (minutes)", "number"],
      ["break_paid", "Is the break paid?", { true: "Paid", false: "Excluded from paid hours" }],
      ["break_guidance", "Break timing / coverage"],
    ],
    summarize: (offer) => summary(
      quantity(offer.break_minutes, "min"),
      hasValue(offer.break_threshold_hours) && `from ${offer.break_threshold_hours}h`,
      offer.break_paid === true && "Paid",
      offer.break_paid === false && "Unpaid",
      offer.break_guidance && "Timing set",
    ),
  },
  {
    id: "meals",
    label: "Staff meals",
    fields: [
      ["staff_meals_per_workday", "Meals per working day", "number"],
      ["staff_meal_threshold_hours", "Applies from (worked hours)", "number"],
    ],
    summarize: (offer) => summary(
      quantity(offer.staff_meals_per_workday, "per day"),
      hasValue(offer.staff_meal_threshold_hours) && `from ${offer.staff_meal_threshold_hours}h`,
    ),
  },
  {
    id: "benefits",
    label: "Benefits & holidays",
    fields: [
      ["uniform_provided", "Uniform provided", { true: "Provided", false: "Not provided" }],
      ["public_holiday_rule", "Public holiday terms", holidayRules],
      ["public_holiday_details", "Confirmed public holiday details"],
      ["other_facts", "Benefits and other confirmed terms"],
    ],
    summarize: (offer) => summary(
      offer.uniform_provided === true && "Uniform provided",
      offer.uniform_provided === false && "No uniform",
      holidayRules[offer.public_holiday_rule] || (offer.public_holiday_details && "Holiday details set"),
      offer.other_facts && "Other terms set",
    ),
  },
  {
    id: "probation",
    label: "Probation",
    fields: [
      ["probation_min_months", "From (months)", "number"],
      ["probation_max_months", "To (months)", "number"],
      ["post_confirmation_terms", "Post-confirmation terms"],
    ],
    summarize: (offer) => summary(
      quantity(offer.probation_min_months, "months from"),
      quantity(offer.probation_max_months, "months to"),
      offer.post_confirmation_terms && "Confirmation terms set",
    ),
  },
  {
    id: "payment",
    label: "Payment details",
    fields: [
      ["payment_method", "Payment method", paymentMethods],
      ["payday_day", "Monthly payday (day)", "number"],
      ["salary_confirmation", "Salary confirmation"],
    ],
    summarize: (offer) => summary(
      paymentMethods[offer.payment_method],
      hasValue(offer.payday_day) && `Payday ${offer.payday_day}`,
      offer.salary_confirmation && "Salary confirmation set",
    ),
  },
  {
    id: "commitment",
    label: "Minimum commitment",
    fields: [["minimum_commitment_months", "Minimum commitment (months)", "number"]],
    summarize: (offer) => quantity(offer.minimum_commitment_months, "months"),
  },
];

function OfferingTerms({ offer, set, editing, onRemove }) {
  const [showTimes, setShowTimes] = useState(false);
  const [addedGroup, setAddedGroup] = useState("");
  const hasTimes = hasValue(offer.working_start) || hasValue(offer.working_end);
  const configured = (group) => group.fields.some(([key]) => hasValue(offer[key]));
  const hiddenGroups = optionalGroups.filter((group) => !configured(group) && group.id !== addedGroup);
  const six = hourlyExplanation(offer, 6);
  const ten = hourlyExplanation(offer, 10);
  const field = (key, label, type, helper) => (
    <Field key={key} label={label} value={offer[key]} type={type} helper={helper}
      onChange={(value) => set(key, value)} />
  );
  const choice = (key, label, options, allowUnconfirmed) => (
    <Choice key={key} label={label} value={offer[key]} options={options} allowUnconfirmed={allowUnconfirmed}
      onChange={(value) => set(key, value)} />
  );

  return (
    <div className="recruitment-offering-body">
      <div className="recruitment-offering-group">
        <h3>Pay &amp; Employment</h3>
        <div className="recruitment-offering-fields recruitment-offering-fields--two">
          {choice("employment_type", "Employment type", types, false)}
          {choice("compensation_type", "Pay type", payTypes)}
        </div>
        {(offer.compensation_type || [offer.currency, offer.amount_min, offer.amount_max].some(hasValue)) && (
          <div className="recruitment-offering-fields recruitment-offering-fields--three">
            {choice("currency", "Currency", offer.currency && !Object.hasOwn(currencies, offer.currency)
              ? { ...currencies, [offer.currency]: offer.currency }
              : currencies)}
            {field("amount_min", "Amount from", "number")}
            {field("amount_max", "Amount to (optional)", "number")}
          </div>
        )}
        {offer.compensation_type && (
          <p className="recruitment-offering-hint">Final pay is confirmed by the Supervisor.</p>
        )}
      </div>

      <div className="recruitment-offering-group">
        <h3>Working Arrangement</h3>
        {field("schedule", "Schedule")}
        <div className="recruitment-offering-fields recruitment-offering-fields--three">
          {field("minimum_hours_per_shift", "Minimum hours / shift", "number")}
          {field("minimum_days_per_week", "Minimum days / week", "number")}
          {field("rest_days_per_week", "Rest days / week", "number")}
        </div>
        <p className="recruitment-offering-hint">Leave a minimum blank if unconfirmed. Enter 0 for no minimum.</p>
        {(hasTimes || showTimes) ? (
          <div className="recruitment-offering-fields recruitment-offering-fields--two">
            {field("working_start", "Starts at", "time")}
            {field("working_end", "Ends at", "time")}
          </div>
        ) : editing && (
          <button className="btn-secondary" type="button" onClick={() => setShowTimes(true)}>
            <Plus size={16} aria-hidden="true" /> Add start and end times
          </button>
        )}
      </div>

      {(editing || optionalGroups.some(configured)) && (
        <div className="recruitment-offering-group">
          <h3>Optional terms</h3>
          {optionalGroups.filter((group) => configured(group) || group.id === addedGroup).map((group) => (
            <details key={group.id} className="recruitment-offering-option" open={group.id === addedGroup || undefined}>
              <summary>
                <span className="recruitment-offering-option-label">
                  <strong>{group.label}</strong>
                  {configured(group) && <small>{group.summarize(offer)}</small>}
                </span>
              </summary>
              <div className="recruitment-offering-fields recruitment-offering-fields--three">
                {group.fields.map(([key, label, type]) => {
                  if (key === "public_holiday_details" && offer.public_holiday_rule !== "custom" && !hasValue(offer[key])) {
                    return null;
                  }
                  return typeof type === "object" ? choice(key, label, type) : (
                    <div key={key} className={type ? undefined : "recruitment-offering-wide"}>
                      {field(key, label, type)}
                    </div>
                  );
                })}
              </div>
              {group.id === "breaks" && six && ten && (
                <p className="recruitment-pay-preview">
                  Ordinary pay examples: 6h worked → {six.paid_hours}h paid, {six.currency} {six.amount}.
                  {" "}10h worked → {ten.paid_hours}h paid, {ten.currency} {ten.amount}. Excludes overtime and public holidays.
                </p>
              )}
            </details>
          ))}
          {editing && hiddenGroups.length > 0 && (
            <SelectField className="recruitment-offering-add-term" ariaLabel="Add optional terms"
              placeholder="Add optional terms" value=""
              options={hiddenGroups.map((group) => ({ value: group.id, label: group.label }))}
              onChange={setAddedGroup} />
          )}
        </div>
      )}
      {editing && <button type="button" className="btn-secondary" onClick={onRemove}>Remove offering</button>}
    </div>
  );
}

function offeringPay(offer) {
  if (!hasValue(offer.amount_min)) return "Pay unconfirmed";
  const from = Number(offer.amount_min).toLocaleString("en-MY");
  const to = hasValue(offer.amount_max) ? `–${Number(offer.amount_max).toLocaleString("en-MY")}` : "";
  const basis = { hourly: " / hour", monthly: " / month" }[offer.compensation_type] || "";
  return `${offer.currency ? `${offer.currency} ` : ""}${from}${to}${basis}`;
}

function offeringSchedule(offer) {
  const time = offer.working_start && offer.working_end
    ? `${offer.working_start}–${offer.working_end}`
    : offer.working_start ? `Starts ${offer.working_start}` : offer.working_end && `Ends ${offer.working_end}`;
  const minimum = [
    offer.minimum_hours_per_shift === 0 ? "No minimum hours" : quantity(offer.minimum_hours_per_shift, "h/shift min"),
    offer.minimum_days_per_week === 0 ? "No minimum days" : quantity(offer.minimum_days_per_week, "days/week min"),
  ];
  return summary(offer.schedule, time, ...minimum, quantity(offer.rest_days_per_week, "rest days/week")) || "Schedule unconfirmed";
}

export default function OpeningOfferings({ value = [], onChange, editing = true }) {
  const [openOfferingId, setOpenOfferingId] = useState(null);
  function patch(id, key, valueToSave) {
    onChange(value.map((offer) => {
      if (offer.id !== id) return offer;
      const next = { ...offer };
      if (hasValue(valueToSave)) next[key] = valueToSave;
      else delete next[key];
      return next;
    }));
  }

  return (
    <div className="recruitment-offerings">
      {value.map((offer) => (
        <details key={offer.id} open={openOfferingId === offer.id} className="recruitment-offering">
          <summary onClick={(event) => {
            event.preventDefault();
            setOpenOfferingId((current) => current === offer.id ? null : offer.id);
          }}>
            <span className="recruitment-offering-summary">
              <strong>{types[offer.employment_type] || "Employment offering"}</strong>
              <span>{offeringPay(offer)}</span>
              <small>{offeringSchedule(offer)}</small>
            </span>
          </summary>
          {openOfferingId === offer.id && (
            <OfferingTerms offer={offer} editing={editing}
              set={(key, next) => patch(offer.id, key, next)}
              onRemove={() => onChange(value.filter((entry) => entry.id !== offer.id))} />
          )}
        </details>
      ))}
      {!value.length && <p className="recruitment-config-note">Add an offering to set employment and pay terms.</p>}
      {editing && (
        <button type="button" className="btn-secondary" disabled={value.length >= 6} onClick={() => {
          const id = crypto.randomUUID();
          const nextType = Object.keys(types).find((type) => !value.some((offer) => offer.employment_type === type));
          onChange([...value, { id, employment_type: nextType || "full_time" }]);
          setOpenOfferingId(id);
        }}>
          <Plus size={16} aria-hidden="true" /> Add offering
        </button>
      )}
    </div>
  );
}
