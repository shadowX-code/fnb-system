import { useRef } from "react";
import AdminFormField from "../../components/forms/AdminFormField.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import { RecruitmentState } from "./RecruitmentPresentation.jsx";
const approaches = {
  behavioral: {
    label: "Behavioral examples",
    guidance: "Ask one question at a time. Start with a relevant real example, clarify the candidate’s own actions and results, and move on once enough evidence is available.",
  },
  experience: {
    label: "Role experience",
    guidance: "Start with the candidate’s relevant responsibilities and use concrete examples to clarify their contribution and results.",
  },
  scenarios: {
    label: "Scenario-led",
    guidance: "Use the profile’s configured scenarios where they add useful evidence. Explore the candidate’s reasoning and build on relevant real examples.",
  },
};
const areaFields = {
  goal: "Assessment goal",
  evidence_guidance: "Useful behavioral evidence",
  follow_up_signals: "Follow-up signals",
  stop_condition: "Sufficient evidence / stop condition",
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
  profile,
  reusableCompetencies = [],
}) {
  const editable = !!onChange;
  const assessment = useRef(null);
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
      const renderFields = (entries) => (
        <>
          {entries.map(([field, label]) => (
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
        </>
      );
      return (
        <details key={index} className="recruitment-plan-detail" data-profile-item={key}>
          <summary className="cursor-pointer text-sm font-semibold">
            <span className="min-w-0">
              <strong>{item.name || item.brief || `Scenario ${index + 1}`}</strong>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {item.priority && <RecruitmentState value={item.priority} />}
              {key === "scenarios" && (
                <RecruitmentState value="neutral">
                  {item.required === false
                    ? "Equivalent evidence allowed"
                    : "Required"}
                </RecruitmentState>
              )}
              <span aria-hidden="true" className="recruitment-detail-toggle">
                +
              </span>
            </span>
          </summary>
          <div className="recruitment-plan-detail-body grid gap-4 md:grid-cols-2">
            {key === "evidence_areas" && (
              <>
                <AdminFormField
                  label="Competency name"
                  as={editable ? "label" : "div"}
                >
                  {editable ? (
                    <input
                      className="control w-full"
                      maxLength={160}
                      value={item.name}
                      onChange={(e) => {
                        const name = e.target.value;
                        // Scenario links use canonical area names; rename atomically in the draft.
                        onChange({
                          ...definition,
                          evidence_areas: definition.evidence_areas.map(
                            (a, i) => (i === index ? { ...a, name } : a),
                          ),
                          scenarios: definition.scenarios.map((s) =>
                            typeof s === "string"
                              ? s
                              : {
                                  ...s,
                                  evidence_areas: (s.evidence_areas || []).map(
                                    (n) => (n === item.name ? name : n),
                                  ),
                                },
                          ),
                        });
                      }}
                    />
                  ) : (
                    <p className="text-sm">{item.name}</p>
                  )}
                </AdminFormField>
                <AdminFormField label="Linked scenarios" as="div">
                  <p className="text-sm text-text-secondary">
                    {definition.scenarios
                      .filter(
                        (s) =>
                          typeof s !== "string" &&
                          (s.evidence_areas || []).includes(item.name),
                      )
                      .map((s) => s.brief)
                      .join(" · ") ||
                      "None — optional; link areas in Scenarios below."}
                  </p>
                </AdminFormField>
              </>
            )}
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
            {renderFields(
              Object.entries(fields).filter(([field]) =>
                key === "evidence_areas"
                  ? field === "goal"
                  : ["brief", "purpose"].includes(field),
              ),
            )}
            <details className="md:col-span-2 recruitment-config-details">
              <summary>
                {key === "evidence_areas"
                  ? "Evidence collection guidance"
                  : "Scenario selection & follow-up guidance"}
              </summary>
              <p className="my-2 text-xs text-text-secondary">
                {key === "evidence_areas"
                  ? "Guidance for useful evidence and when to move on. These are not mandatory questions or performance levels."
                  : "Use only when this situation adds missing evidence. One response can support multiple areas."}
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {renderFields(
                  Object.entries(fields).filter(([field]) =>
                    key === "evidence_areas"
                      ? field !== "goal"
                      : !["brief", "purpose"].includes(field),
                  ),
                )}
              </div>
            </details>
            {key === "evidence_areas" && (
              <details className="md:col-span-2 recruitment-config-details">
                <summary>
                  Optional rubric assessment
                  {item.rubric ? " · 4 criterion levels" : " · Not configured"}
                </summary>
                <p className="my-2 text-sm text-text-secondary">
                  Evaluation only — not an interviewer question script. Define
                  observable job-related behavior for each level. Missing
                  evidence stays unscored. Coverage and job fit remain separate.
                  Published rubrics apply only to interviews pinned to that
                  future version.
                </p>
                {editable && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="admin-checkbox"
                      checked={!!item.rubric}
                      onChange={(e) => {
                        const next = { ...item };
                        if (e.target.checked)
                          next.rubric = {
                            levels: [1, 2, 3, 4].map((level) => ({
                              level,
                              criteria: "",
                            })),
                          };
                        else delete next.rubric;
                        patch(
                          key,
                          definition[key].map((a, i) =>
                            i === index ? next : a,
                          ),
                        );
                      }}
                    />
                    Enable criterion-based assessment
                  </label>
                )}
                {item.rubric?.levels.map((level, i) => (
                  <AdminFormField
                    key={level.level}
                    label={`Level ${level.level} criteria`}
                  >
                    {editable ? (
                      <textarea
                        className="control w-full"
                        rows={2}
                        minLength={20}
                        maxLength={800}
                        value={level.criteria}
                        onChange={(e) =>
                          update("rubric", {
                            levels: item.rubric.levels.map((l, j) =>
                              i === j ? { ...l, criteria: e.target.value } : l,
                            ),
                          })
                        }
                      />
                    ) : (
                      <p className="text-sm">{level.criteria}</p>
                    )}
                  </AdminFormField>
                ))}
              </details>
            )}
            {key === "scenarios" && (
              <>
                <AdminFormField label="Assessment areas" as="div">
                  {editable ? (
                    <div className="space-y-2">
                      {definition.evidence_areas.map((a) => (
                        <label key={a.name} className="flex gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="admin-checkbox"
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
                        className="admin-checkbox"
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
            {editable && (
              <button type="button" className="btn-secondary justify-self-start md:col-span-2"
                onClick={() => onChange({
                  ...definition,
                  [key]: definition[key].filter((_, i) => i !== index),
                  ...(key === "evidence_areas" ? {
                    scenarios: definition.scenarios.map(s => typeof s === "string" ? s : {
                      ...s, evidence_areas: (s.evidence_areas || []).filter(name => name !== item.name),
                    }),
                  } : {}),
                })}>
                {key === "evidence_areas" ? "Remove assessment area" : "Remove scenario"}
              </button>
            )}
          </div>
        </details>
      );
    });
  const approach = Object.entries(approaches).find(([, { guidance }]) =>
    definition.follow_up_guidance === guidance ||
      definition.follow_up_guidance?.startsWith(`${guidance}\n\n`),
  );
  const additionalGuidance = approach
    ? definition.follow_up_guidance.slice(approach[1].guidance.length + 2)
    : definition.follow_up_guidance || "";

  const existingNames = new Set(definition.evidence_areas.map((area) => area.name.trim().toLowerCase()));
  const choices = reusableCompetencies.filter((area) => !existingNames.has(area.definition.name.trim().toLowerCase()));
  function appendCompetency(value) {
    const reused = choices[Number(value)];
    let number = definition.evidence_areas.length + 1;
    while (existingNames.has(`new competency ${number}`)) number++;
    patch("evidence_areas", [...definition.evidence_areas, reused ? structuredClone(reused.definition) : {
      name: `New competency ${number}`,
      priority: "Important",
      goal: "",
      evidence_guidance: "",
      follow_up_signals: "",
      stop_condition: "",
    }]);
    requestAnimationFrame(() => {
      const row = assessment.current?.querySelectorAll('[data-profile-item="evidence_areas"]');
      if (!row?.length) return;
      row[row.length - 1].open = true;
      row[row.length - 1].querySelector("input")?.focus();
    });
  }

  return (
    <div className="recruitment-profile-plan">
      <section className="recruitment-profile-section">
        <h2>Profile</h2>
        {profile && <dl className="recruitment-profile-facts-grid">
          <div><dt>Profile name</dt><dd>{profile.name}</dd></div>
          <div><dt>Job Position</dt><dd>{profile.position}</dd></div>
          <div><dt>Starting template</dt><dd>{profile.template}</dd></div>
        </dl>}
        <AdminFormField label="Role context" as={editable ? "label" : "div"}>
          {editable ? (
            <textarea className="control w-full recruitment-role-context" rows={2}
              value={definition.role_context} maxLength={2000}
              onChange={(event) => patch("role_context", event.target.value)} />
          ) : <p className="recruitment-profile-prose">{definition.role_context || "No role description."}</p>}
        </AdminFormField>
      </section>

      <section className="recruitment-profile-section" ref={assessment}>
        <h2>Assessment</h2>
        {objects("evidence_areas", areaFields)}
        {!definition.evidence_areas.length && <p className="text-sm text-text-secondary">No competencies yet.</p>}
        {editable && definition.evidence_areas.length < 30 && (
          <SelectField className="recruitment-profile-add" ariaLabel="Add Competency"
            placeholder="Add Competency" value="" searchable="auto"
            options={[
              { value: "new", label: "Create role-specific competency" },
              ...choices.map((area, index) => ({ value: String(index), label: area.definition.name, description: area.source })),
            ]}
            onChange={appendCompetency} />
        )}
        {(editable || definition.scenarios.length > 0) && (
          <details className="recruitment-profile-disclosure">
            <summary>Scenarios <small>{definition.scenarios.length || "Optional"}</small></summary>
            {objects("scenarios", scenarioFields)}
            {editable && definition.scenarios.length < 20 && (
              <button type="button" className="btn-secondary mt-3" onClick={() => patch("scenarios", [
                ...definition.scenarios,
                { brief: "", purpose: "", when_to_use: "", follow_up_guidance: "", stop_condition: "", evidence_areas: [], required: false },
              ])}>Add scenario</button>
            )}
          </details>
        )}
      </section>

      <section className="recruitment-profile-section">
        <h2>Interview Settings</h2>
        <div className="recruitment-profile-facts-grid">
          {[
            ["target_minutes", "Target minutes", 90],
            ["max_minutes", "Maximum minutes", 120],
          ].map(([key, label, max]) => (
            <AdminFormField key={key} label={label} as={editable ? "label" : "div"}>
              {editable ? (
                <input className="control w-full" type="number" min={5} max={max}
                  value={definition[key]} onChange={(event) => patch(key, Number(event.target.value))} />
              ) : <p>{definition[key]}</p>}
            </AdminFormField>
          ))}
          <AdminFormField label="Interview approach" as={editable ? "label" : "div"}>
            {editable ? (
              <SelectField ariaLabel="Interview approach" value={approach?.[0] || "existing"}
                options={[
                  ...(!approach ? [{ value: "existing", label: "Existing guidance" }] : []),
                  ...Object.entries(approaches).map(([value, { label }]) => ({ value, label, disabled: [approaches[value].guidance, additionalGuidance].filter(Boolean).join("\n\n").length > 4000 })),
                ]}
                onChange={(value) => {
                  if (approaches[value]) patch("follow_up_guidance", [approaches[value].guidance, additionalGuidance].filter(Boolean).join("\n\n"));
                }} />
            ) : <p>{approach?.[1].label || "Profile guidance"}</p>}
          </AdminFormField>
        </div>
        {(editable || additionalGuidance) && (
          <details className="recruitment-profile-disclosure">
            <summary>Additional Interviewer Guidance <small>{additionalGuidance ? "Configured" : "Optional"}</small></summary>
            {editable ? (
              <textarea aria-label="Additional Interviewer Guidance" className="control w-full mt-2" rows={3}
                placeholder="Add role-specific interviewing guidance"
                value={additionalGuidance}
                maxLength={4000 - (approach ? approach[1].guidance.length + 2 : 0)}
                onChange={(event) => {
                  const guidance = event.target.value;
                  patch("follow_up_guidance", [approach?.[1].guidance || (!guidance ? approaches.behavioral.guidance : ""), guidance].filter(Boolean).join("\n\n"));
                }} />
            ) : <p className="recruitment-profile-prose mt-2">{additionalGuidance}</p>}
          </details>
        )}
        <details className="recruitment-profile-disclosure">
          <summary>Advanced completion settings <small>Core covered</small></summary>
          <div className="recruitment-profile-facts-grid mt-2">
            {["Important", "Optional"].map((priority) => (
              <AdminFormField key={priority} label={`${priority} evidence minimum`} as={editable ? "label" : "div"}>
                {editable ? (
                  <SelectField value={definition.completion_criteria[priority]} ariaLabel={`${priority} evidence minimum`}
                    options={(priority === "Important" ? ["partial", "covered"] : ["unresolved", "partial", "covered"])
                      .map((value) => ({ value, label: value }))}
                    onChange={(value) => patch("completion_criteria", { ...definition.completion_criteria, [priority]: value })} />
                ) : <p className="capitalize">{definition.completion_criteria[priority]}</p>}
              </AdminFormField>
            ))}
          </div>
          <p className="text-xs text-text-secondary mt-2">Required scenarios need an answer. Optional scenarios can use equivalent real evidence.</p>
        </details>
      </section>
    </div>
  );
}
