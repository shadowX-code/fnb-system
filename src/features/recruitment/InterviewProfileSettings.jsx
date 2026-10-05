import { useState } from "react";
import Modal from "../../components/feedback/Modal.jsx";
import AdminFormField from "../../components/forms/AdminFormField.jsx";

export default function InterviewProfileSettings({
  profiles,
  busy,
  onPublish,
  onClose,
}) {
  const latest = profiles[0];
  const [versionId, setVersionId] = useState(latest?.id);
  const selected = profiles.find((p) => p.id === versionId) || latest;
  const [draft, setDraft] = useState(() => structuredClone(latest?.definition));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const patch = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  async function publish() {
    setError("");
    try {
      await onPublish(draft, latest.version);
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <Modal
      title="Interview Profiles"
      size="xl"
      description="Published versions stay fixed. Openings and invited interviews keep their selected version."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          {editing ? (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={publish}
            >
              Publish Service Crew v{latest.version + 1}
            </button>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setDraft(structuredClone(latest.definition));
                setEditing(true);
              }}
            >
              Prepare next version
            </button>
          )}
        </>
      }
    >
      {error && (
        <p role="alert" className="mb-4 text-red-700">
          {error}
        </p>
      )}
      {!editing ? (
        <div className="space-y-4">
          <AdminFormField label="Published version">
            <select
              className="control"
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} v{p.version}
                </option>
              ))}
            </select>
          </AdminFormField>
          <p className="text-sm text-text-secondary">
            {selected.definition.role_context}
          </p>
          <div className="divide-y divide-border">
            {selected.definition.evidence_areas.map((area) => (
              <div key={area.name} className="py-3">
                <p className="font-medium">
                  {area.name}{" "}
                  <span className="ml-2 text-xs text-text-muted">
                    {area.priority}
                  </span>
                </p>
                <p className="text-sm text-text-secondary">{area.intent}</p>
              </div>
            ))}
          </div>
          <p className="text-sm">{selected.definition.follow_up_guidance}</p>
          <p className="text-sm">
            Scenario: {selected.definition.scenarios.join(" · ")}
          </p>
          <p className="text-sm text-text-secondary">
            Target {selected.definition.target_minutes} min · Maximum{" "}
            {selected.definition.max_minutes} min · Core:{" "}
            {selected.definition.completion_criteria.Core}; Important:{" "}
            {selected.definition.completion_criteria.Important}; Optional:{" "}
            {selected.definition.completion_criteria.Optional}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <AdminFormField label="Role context">
            <textarea
              className="control w-full"
              value={draft.role_context}
              onChange={(e) => patch("role_context", e.target.value)}
            />
          </AdminFormField>
          {draft.evidence_areas.map((area, index) => (
            <div
              key={index}
              className="grid gap-3 border-t border-border pt-3 md:grid-cols-3"
            >
              <AdminFormField label="Evidence area">
                <input
                  className="control w-full"
                  value={area.name}
                  onChange={(e) =>
                    patch(
                      "evidence_areas",
                      draft.evidence_areas.map((a, i) =>
                        i === index ? { ...a, name: e.target.value } : a,
                      ),
                    )
                  }
                />
              </AdminFormField>
              <AdminFormField label="Priority">
                <select
                  className="control w-full"
                  value={area.priority}
                  onChange={(e) =>
                    patch(
                      "evidence_areas",
                      draft.evidence_areas.map((a, i) =>
                        i === index ? { ...a, priority: e.target.value } : a,
                      ),
                    )
                  }
                >
                  {["Core", "Important", "Optional"].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </AdminFormField>
              <AdminFormField label="Evidence intent">
                <textarea
                  className="control w-full"
                  value={area.intent}
                  onChange={(e) =>
                    patch(
                      "evidence_areas",
                      draft.evidence_areas.map((a, i) =>
                        i === index ? { ...a, intent: e.target.value } : a,
                      ),
                    )
                  }
                />
              </AdminFormField>
            </div>
          ))}
          <AdminFormField label="Follow-up guidance">
            <textarea
              className="control min-h-28 w-full"
              value={draft.follow_up_guidance}
              onChange={(e) => patch("follow_up_guidance", e.target.value)}
            />
          </AdminFormField>
          <AdminFormField label="Scenarios" helper="One brief per line.">
            <textarea
              className="control w-full"
              value={draft.scenarios.join("\n")}
              onChange={(e) =>
                patch(
                  "scenarios",
                  e.target.value.split("\n").filter((s) => s.trim()),
                )
              }
            />
          </AdminFormField>
          <div className="grid gap-3 sm:grid-cols-2">
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
                  className="control w-full"
                  type="number"
                  min="5"
                  max="120"
                  value={draft[key]}
                  onChange={(e) => patch(key, Number(e.target.value))}
                />
              </AdminFormField>
            ))}
            {["Important", "Optional"].map((priority) => (
              <AdminFormField
                key={priority}
                label={`${priority} completion minimum`}
              >
                <select
                  className="control w-full"
                  value={draft.completion_criteria[priority]}
                  onChange={(e) =>
                    patch("completion_criteria", {
                      ...draft.completion_criteria,
                      [priority]: e.target.value,
                    })
                  }
                >
                  {(priority === "Important"
                    ? ["partial", "covered"]
                    : ["unresolved", "partial", "covered"]
                  ).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </AdminFormField>
            ))}
          </div>
          <p className="text-sm text-text-muted">
            Core evidence must be Covered and scenarios answered. Publication
            creates a new version; existing openings are not changed.
          </p>
        </div>
      )}
    </Modal>
  );
}
