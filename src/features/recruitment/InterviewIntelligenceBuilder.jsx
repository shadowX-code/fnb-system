import AdminFormField from "../../components/forms/AdminFormField.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import {
  RecruitmentSection,
  RecruitmentState,
} from "./RecruitmentPresentation.jsx";
const areaFields = {
  goal: "Goal",
  evidence_guidance: "Evidence guidance",
  follow_up_signals: "Follow-up signals",
  stop_condition: "Stop condition",
};
const scenarioFields = {
  brief: "Situation",
  purpose: "Purpose",
  when_to_use: "When to use",
  follow_up_guidance: "Follow-up guidance",
  stop_condition: "Stop condition",
};
export default function InterviewIntelligenceBuilder({
  definition,
  onChange,
  version,
}) {
  const editable = !!onChange;
  const patch = (key, value) => onChange({ ...definition, [key]: value });
  const objects = (key, fields) =>
    definition[key].map((original, index) => {
      const item =
        typeof original === "string" ? { brief: original } : original;
      const update = (field, value) =>
        patch(
          key,
          definition[key].map((x, i) =>
            i === index ? { ...item, [field]: value } : x,
          ),
        );
      return (
        <details key={index} className="border-b border-border py-3">
          <summary className="cursor-pointer text-sm font-semibold">
            {item.name || `Delayed-food scenario ${index + 1}`}{" "}
            {item.priority && <RecruitmentState value={item.priority} />}
          </summary>
          <div className="grid gap-3 mt-3 md:grid-cols-2">
            {editable && key === "evidence_areas" && (
              <AdminFormField label="Priority">
                <SelectField
                  value={item.priority}
                  onChange={(v) => update("priority", v)}
                  ariaLabel={`Priority for ${item.name}`}
                  options={["Core", "Important", "Optional"].map((value) => ({
                    value,
                    label: value,
                  }))}
                />
              </AdminFormField>
            )}
            {Object.entries(fields).map(([field, label]) => (
              <AdminFormField key={field} label={label}>
                {editable ? (
                  <textarea
                    className="control w-full"
                    rows={3}
                    maxLength={1000}
                    value={
                      item[field] || (field === "goal" ? item.intent : "") || ""
                    }
                    onChange={(e) => update(field, e.target.value)}
                  />
                ) : (
                  <p className="text-sm text-text-secondary">
                    {item[field] ||
                      (field === "goal" ? item.intent : "") ||
                      "Not configured in this version"}
                  </p>
                )}
              </AdminFormField>
            ))}
            {key === "scenarios" && (
              <>
                <AdminFormField label="Evidence areas" as="div">
                  {editable ? (
                    <div className="space-y-2">
                      {definition.evidence_areas.map((a) => (
                        <label key={a.name} className="flex gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={(item.evidence_areas || []).includes(
                              a.name,
                            )}
                            onChange={(e) =>
                              update(
                                "evidence_areas",
                                e.target.checked
                                  ? [...(item.evidence_areas || []), a.name]
                                  : (item.evidence_areas || []).filter(
                                      (n) => n !== a.name,
                                    ),
                              )
                            }
                          />
                          {a.name}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm">
                      {(item.evidence_areas || []).join(" · ") ||
                        "Legacy scenario"}
                    </p>
                  )}
                </AdminFormField>
                <AdminFormField label="Scenario requirement" as="div">
                  {editable ? (
                    <label className="flex gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={item.required === true}
                        onChange={(e) => update("required", e.target.checked)}
                      />
                      Require the hypothetical even when equivalent real
                      evidence exists
                    </label>
                  ) : (
                    <p className="text-sm">
                      {item.required === false
                        ? "Equivalent real evidence may replace this scenario"
                        : "Scenario answer required"}
                    </p>
                  )}
                </AdminFormField>
              </>
            )}
          </div>
        </details>
      );
    });
  const text = (key, label) => (
    <RecruitmentSection title={label}>
      {editable ? (
        <textarea
          aria-label={label}
          className="control w-full min-h-28"
          value={definition[key]}
          maxLength={key === "role_context" ? 2000 : 4000}
          onChange={(e) => patch(key, e.target.value)}
        />
      ) : (
        <p className="text-sm text-text-secondary">{definition[key]}</p>
      )}
    </RecruitmentSection>
  );
  return (
    <div className="space-y-4">
      {text("role_context", "Role context")}
      <RecruitmentSection
        title="Evidence areas"
        description="Guidance for understanding the candidate. One answer may support several areas."
      >
        {objects("evidence_areas", areaFields)}
      </RecruitmentSection>
      <RecruitmentSection title="Scenarios">
        {objects("scenarios", scenarioFields)}
      </RecruitmentSection>
      {text("follow_up_guidance", "Interview strategy")}
      <RecruitmentSection title="Completion">
        <div className="grid gap-3 sm:grid-cols-2">
          {["target_minutes", "max_minutes"].map((key) => (
            <AdminFormField
              key={key}
              label={
                key === "target_minutes" ? "Target minutes" : "Maximum minutes"
              }
            >
              {editable ? (
                <input
                  className="control w-full"
                  type="number"
                  min={5}
                  max={120}
                  value={definition[key]}
                  onChange={(e) => patch(key, Number(e.target.value))}
                />
              ) : (
                <p>{definition[key]}</p>
              )}
            </AdminFormField>
          ))}
          {["Important", "Optional"].map((priority) => (
            <AdminFormField
              key={priority}
              label={`${priority} evidence minimum`}
            >
              {editable ? (
                <SelectField
                  value={definition.completion_criteria[priority]}
                  ariaLabel={`${priority} evidence minimum`}
                  options={(priority === "Important"
                    ? ["partial", "covered"]
                    : ["unresolved", "partial", "covered"]
                  ).map((value) => ({ value, label: value }))}
                  onChange={(value) =>
                    patch("completion_criteria", {
                      ...definition.completion_criteria,
                      [priority]: value,
                    })
                  }
                />
              ) : (
                <p className="capitalize">
                  {definition.completion_criteria[priority]}
                </p>
              )}
            </AdminFormField>
          ))}
        </div>
        <p className="text-sm text-text-secondary mt-3">
          Core evidence must be Covered. Required scenarios need an answer;
          optional scenarios may use cited equivalent real evidence. Offer
          candidate questions before requesting server permission to conclude.
        </p>
      </RecruitmentSection>
      <RecruitmentSection title="Version">
        <p className="text-sm">
          Version {version} ·{" "}
          {editable ? "Unpublished draft" : "Published and immutable"}.
          Publication creates a new version and never changes existing
          invitations.
        </p>
      </RecruitmentSection>
    </div>
  );
}
