import AdminFormField from "../../components/forms/AdminFormField.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import { RecruitmentState } from "./RecruitmentPresentation.jsx";
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
        <details key={index} className="recruitment-plan-detail">
          <summary className="cursor-pointer text-sm font-semibold">
            <span className="min-w-0">
              <strong>{item.name || `Scenario ${index + 1}`}</strong>
              <span className="recruitment-plan-detail-summary">
                {key === "evidence_areas"
                  ? item.goal || item.intent
                  : item.purpose || item.brief}
              </span>
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
            {key === "evidence_areas" && <>
              <AdminFormField label="Area name" as={editable ? "label" : "div"}>
                {editable ? <input className="control w-full" maxLength={160} value={item.name} onChange={e => {
                  const name = e.target.value;
                  // Scenario links use canonical area names; rename atomically in the draft.
                  onChange({...definition, evidence_areas: definition.evidence_areas.map((a,i) => i === index ? {...a,name} : a),
                    scenarios: definition.scenarios.map(s => typeof s === "string" ? s : {...s,evidence_areas:(s.evidence_areas || []).map(n => n === item.name ? name : n)})});
                }} /> : <p className="text-sm">{item.name}</p>}
              </AdminFormField>
              <AdminFormField label="Linked scenarios" as="div">
                <p className="text-sm text-text-secondary">{definition.scenarios.filter(s => typeof s !== "string" && (s.evidence_areas || []).includes(item.name)).map(s => s.brief).join(" · ") || "None — optional; link areas in Scenarios below."}</p>
              </AdminFormField>
            </>}
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
            {key === "evidence_areas" && <details className="md:col-span-2 recruitment-config-details">
              <summary>Optional rubric assessment{item.rubric ? " · 4 criterion levels" : " · Not configured"}</summary>
              <p className="my-2 text-sm text-text-secondary">Define observable job-related behavior for each level. Missing evidence stays unscored. Coverage and job fit remain separate. Published rubrics apply only to interviews pinned to that future version.</p>
              {editable && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="admin-checkbox" checked={!!item.rubric} onChange={e=>{const next={...item};if(e.target.checked)next.rubric={levels:[1,2,3,4].map(level=>({level,criteria:""}))};else delete next.rubric;patch(key,definition[key].map((a,i)=>i===index?next:a));}} />Enable criterion-based assessment</label>}
              {item.rubric?.levels.map((level,i)=><AdminFormField key={level.level} label={`Level ${level.level} criteria`}>
                {editable ? <textarea className="control w-full" rows={2} minLength={20} maxLength={800} value={level.criteria} onChange={e=>update("rubric",{levels:item.rubric.levels.map((l,j)=>i===j?{...l,criteria:e.target.value}:l)})} /> : <p className="text-sm">{level.criteria}</p>}
              </AdminFormField>)}
            </details>}
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
          </div>
        </details>
      );
    });
  const text = (key, label) => (
    <section className="recruitment-profile-section">
      <h2>{label}</h2>
      {editable ? (
        <textarea
          aria-label={label}
          className="control w-full min-h-28"
          value={definition[key]}
          maxLength={key === "role_context" ? 2000 : 4000}
          onChange={(e) => patch(key, e.target.value)}
        />
      ) : (
        <div className="recruitment-profile-prose">
          {(definition[key] || "").split(/(?<=[.!?])\s+/).map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
    </section>
  );
  return (
    <div className="recruitment-profile-plan">
      {text("role_context", "Role context")}
      <section className="recruitment-profile-section">
        <h2>Assessment Areas</h2>
        <p className="text-xs text-text-secondary mb-3">
          Define observable job-related behavior, not personality or speaking style. One answer may support several areas. Coverage describes understanding, not requirement fit.
        </p>
        {objects("evidence_areas", areaFields)}
        {editable && definition.evidence_areas.length < 30 && <button type="button" className="btn-secondary mt-3" onClick={() => {
          let n = definition.evidence_areas.length + 1;
          while(definition.evidence_areas.some(a => a.name === `New area ${n}`)) n++;
          patch("evidence_areas",[...definition.evidence_areas,{name:`New area ${n}`,priority:"Important",goal:"",evidence_guidance:"",follow_up_signals:"",stop_condition:""}]);
        }}>Add assessment area</button>}
      </section>
      <section className="recruitment-profile-section">
        <h2>Scenarios</h2>
        {objects("scenarios", scenarioFields)}
      </section>
      <details className="recruitment-profile-strategy">
        <summary>
          Interview Strategy <span aria-hidden="true">+</span>
        </summary>
        {text("follow_up_guidance", "Conversational guidance")}
      </details>
      <section className="recruitment-profile-section">
        <h2>Completion Rules</h2>
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
        <dl className="recruitment-completion-rules">
          <div>
            <dt>Core requirement</dt>
            <dd>Covered</dd>
          </div>
          <div>
            <dt>Scenario completion</dt>
            <dd>
              Required scenarios need an answer; optional scenarios may use
              cited equivalent real evidence.
            </dd>
          </div>
        </dl>
        <p className="text-xs text-text-secondary mt-3">
          Offer candidate questions before requesting permission to conclude.
        </p>
      </section>
      <p className="text-xs text-text-secondary">
        Version {version} ·{" "}
        {editable
          ? "Unpublished draft — publication creates a new version."
          : "Published and immutable — existing invitations keep this version."}
      </p>
    </div>
  );
}
