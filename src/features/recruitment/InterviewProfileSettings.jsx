import InterviewIntelligenceBuilder from "./InterviewIntelligenceBuilder.jsx";
import { profileDraft } from "./serviceCrewV2.js";
import { useState } from "react";
import PageHeader from "../../components/layout/PageHeader.jsx";
import DataTable from "../../components/tables/DataTable.jsx";
import {
  RecruitmentSection,
  RecruitmentState,
  RecruitmentEmpty,
} from "./RecruitmentPresentation.jsx";

export default function InterviewProfileSettings({
  profiles,
  busy,
  onPublish,
  onClose,
  canManage = false,
}) {
  const [versionId, setVersionId] = useState(null),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(null),
    [error, setError] = useState("");
  const selected = profiles.find((p) => p.id === versionId);
  const families = [...new Set(profiles.map((p) => p.name))].map((name) =>
    profiles
      .filter((p) => p.name === name)
      .sort((a, b) => b.version - a.version),
  );
  const versions = selected
    ? families.find((f) => f[0].name === selected.name)
    : [];
  const latest = versions[0];
  function library() {
    setVersionId(null);
    setEditing(false);
    setError("");
  }
  function view(id) {
    setVersionId(id);
    setEditing(false);
    setError("");
  }
  async function publish() {
    setError("");
    try {
      await onPublish(draft, latest.version);
      library();
    } catch (e) {
      setError(e.message);
    }
  }
  const current = editing ? draft : selected?.definition;
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Recruitment", onClick: onClose },
          selected
            ? { label: "Interview Profiles", onClick: library }
            : { label: "Interview Profiles" },
          ...(selected ? [{ label: selected.name }] : []),
        ]}
        title={selected ? selected.name : "Interview Profiles"}
        description={
          selected
            ? "A reusable evidence plan for this role."
            : "Reusable interview plans with fixed published versions."
        }
        metadata={
          selected ? (
            <>
              <RecruitmentState
                value={editing ? "draft" : selected.status || "published"}
              />
              <span>
                Version {editing ? latest.version + 1 : selected.version}
                {!editing && selected.id === latest.id ? " · Latest" : ""}
              </span>
              <span>
                Target {current.target_minutes} min · Maximum{" "}
                {current.max_minutes} min
              </span>
            </>
          ) : null
        }
        primaryActions={
          selected && canManage ? (
            editing ? (
              <>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  Discard draft
                </button>
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={publish}
                >
                  Publish {latest.name} v{latest.version + 1}
                </button>
              </>
            ) : (
              <button
                className="btn-secondary"
                onClick={() => {
                  setDraft(profileDraft(latest.definition));
                  setEditing(true);
                }}
              >
                Prepare next version
              </button>
            )
          ) : null
        }
      />
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {!selected ? (
        <RecruitmentSection
          title="Profile library"
          className="is-list"
          description={`${families.length} reusable ${families.length === 1 ? "plan" : "plans"}`}
        >
          <DataTable
            density="compact"
            minWidth={700}
            rows={families.map((f) => f[0])}
            getRowKey={(p) => p.id}
            tableClassName="recruitment-profile-table"
            onRowClick={(p) => view(p.id)}
            columns={[
              {
                key: "name",
                header: "Interview Plan",
                render: (p) => (
                  <div>
                    <strong className="text-sm">{p.name}</strong>
                    <p className="recruitment-row-meta">
                      {p.definition.role_context ||
                        "Reusable role evidence plan"}
                    </p>
                  </div>
                ),
              },
              {
                key: "version",
                header: "Published version",
                render: (p) => (
                  <div className="recruitment-cell-stack">
                    <RecruitmentState value={p.status || "published"} />
                    <span>Version {p.version} · Latest</span>
                  </div>
                ),
              },
              {
                key: "evidence",
                header: "Assessment plan",
                render: (p) => (
                  <div className="recruitment-cell-stack">
                    <span>
                      {p.definition.evidence_areas.length} assessment areas
                    </span>
                    <span>
                      {p.definition.scenarios.length}{" "}
                      {p.definition.scenarios.length === 1
                        ? "scenario"
                        : "scenarios"}
                    </span>
                  </div>
                ),
              },
              {
                key: "duration",
                header: "Duration",
                render: (p) => (
                  <div className="recruitment-cell-stack">
                    <span>Target {p.definition.target_minutes} min</span>
                    <span className="text-text-secondary">
                      Maximum {p.definition.max_minutes} min
                    </span>
                  </div>
                ),
              },
              {
                key: "action",
                header: "Action",
                render: (p) => (
                  <button
                    className="btn-secondary"
                    aria-label={`View ${p.name} profile`}
                    onClick={() => view(p.id)}
                  >
                    View
                  </button>
                ),
              },
            ]}
          />
          {!families.length && (
            <RecruitmentEmpty>
              No interview profiles are available.
            </RecruitmentEmpty>
          )}
        </RecruitmentSection>
      ) : (
        <>
          <InterviewIntelligenceBuilder
            definition={current}
            onChange={editing ? setDraft : undefined}
            version={editing ? latest.version + 1 : selected.version}
          />
          {!editing && (
            <section
              className="recruitment-profile-history"
              aria-labelledby="profile-history-title"
            >
              <h2 id="profile-history-title">Version History</h2>
              <p className="text-xs text-text-secondary">
                Published versions stay fixed. Existing invitations retain their
                selected plan.
              </p>
              <ol className="mt-3 divide-y divide-border">
                {versions.map((p) => (
                  <li key={p.id}>
                    <button
                      className="recruitment-attention-row"
                      onClick={() => view(p.id)}
                      aria-current={p.id === versionId ? "true" : undefined}
                    >
                      <span>
                        Version {p.version}
                        {p.id === latest.id ? " · Latest" : ""}
                        {p.id === versionId ? " · Viewing" : ""}
                      </span>
                      <RecruitmentState value={p.status || "published"} />
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
    </>
  );
}
