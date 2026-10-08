import InterviewIntelligenceBuilder from "./InterviewIntelligenceBuilder.jsx";
import { profileDraft } from "./serviceCrewV2.js";
import { useEffect, useRef, useState } from "react";
import { recruitmentService } from "./recruitmentService.js";
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
    [saved, setSaved] = useState(null),
    [drafts, setDrafts] = useState([]),
    [loading, setLoading] = useState(true),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false);
  const operation = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    recruitmentService
      .profileDrafts(controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setDrafts(rows);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  const selected =
    profiles.find((p) => p.id === versionId) ||
    drafts.find((p) => p.id === versionId);
  const families = [...new Set(profiles.map((p) => p.name))].map((name) =>
    profiles
      .filter((p) => p.name === name)
      .sort((a, b) => b.version - a.version),
  );
  const versions = selected
    ? families.find((f) => f[0].name === selected.name) || []
    : [];
  const latest = versions[0];
  const isDraft = selected?.status === "draft";
  const dirty =
    editing &&
    JSON.stringify(draft) !== JSON.stringify(profileDraft(saved?.definition));
  const locked = busy || pending || loading;
  function library() {
    setVersionId(null);
    setEditing(false);
    setError("");
    setConflict(false);
  }
  function view(id, rows = drafts) {
    const record = rows.find((p) => p.id === id);
    setVersionId(id);
    setEditing(Boolean(record && canManage));
    setSaved(record || null);
    setDraft(record ? profileDraft(record.definition) : null);
    setError("");
    setConflict(false);
  }
  async function run(action) {
    if (operation.current) return;
    operation.current = true;
    setPending(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e.message);
      setConflict(["PT409", "40001"].includes(e.cause?.code));
    } finally {
      operation.current = false;
      setPending(false);
    }
  }
  function remember(record) {
    setDrafts((rows) => [record, ...rows.filter((r) => r.id !== record.id)]);
    setSaved(record);
    setDraft(profileDraft(record.definition));
    setVersionId(record.id);
    setEditing(true);
    setConflict(false);
  }
  function prepare() {
    return run(async () =>
      remember(
        await recruitmentService.prepareProfileDraft(
          latest.profile_key,
          latest.version,
        ),
      ),
    );
  }
  function save() {
    return run(async () =>
      remember(
        await recruitmentService.saveProfileDraft(
          saved.id,
          saved.revision,
          draft,
        ),
      ),
    );
  }
  function reload() {
    return run(async () => {
      const rows = await recruitmentService.profileDrafts();
      setDrafts(rows);
      if (versionId && rows.some((p) => p.id === versionId))
        view(versionId, rows);
      else library();
    });
  }
  function publish() {
    return run(async () => {
      await onPublish(saved.id, saved.revision);
      setDrafts(await recruitmentService.profileDrafts());
      library();
    });
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
                value={isDraft ? "draft" : selected.status || "published"}
              />
              <span>
                Version {selected.version}
                {!isDraft && selected.id === latest?.id ? " · Latest" : ""}
                {isDraft
                  ? ` · ${dirty ? "Unsaved changes" : "Saved draft"}`
                  : ""}
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
                  disabled={locked}
                  onClick={() => view(latest.id)}
                >
                  View published version
                </button>
                <button
                  className="btn-secondary"
                  disabled={locked || !dirty || conflict}
                  onClick={save}
                >
                  Save Draft
                </button>
                <button
                  className="btn-primary"
                  disabled={locked || dirty || conflict}
                  onClick={publish}
                >
                  Publish {selected.name} v{selected.version}
                </button>
              </>
            ) : (
              <button
                className="btn-secondary"
                disabled={locked}
                onClick={prepare}
              >
                {drafts.some((p) => p.name === selected.name)
                  ? "Resume draft"
                  : "Prepare next version"}
              </button>
            )
          ) : null
        }
      />
      {error && (
        <div role="alert" className="text-red-700">
          {error}
          <button className="btn-secondary" disabled={pending} onClick={reload}>
            {conflict
              ? "Discard local edits and reload saved draft"
              : "Reload drafts"}
          </button>
        </div>
      )}
      {loading && <p role="status">Loading saved drafts…</p>}
      {editing && (
        <p className="text-sm text-text-secondary" role="status">
          {dirty
            ? "Unsaved changes. Save Draft before leaving or publishing."
            : "Draft saved. You can return later to continue editing. Publication is a separate action."}
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
            rows={[...drafts, ...families.map((f) => f[0])]}
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
                header: "Version",
                render: (p) => (
                  <div className="recruitment-cell-stack">
                    <RecruitmentState value={p.status || "published"} />
                    <span>
                      Version {p.version}
                      {p.status === "draft"
                        ? " · Saved draft"
                        : " · Latest published"}
                    </span>
                  </div>
                ),
              },
              {
                key: "evidence",
                header: "Assessment plan",
                render: (p) => (
                  <div className="recruitment-cell-stack">
                    <span>
                      {(p.definition.evidence_areas || []).length} assessment
                      areas
                    </span>
                    <span>
                      {(p.definition.scenarios || []).length}{" "}
                      {(p.definition.scenarios || []).length === 1
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
                    aria-label={`${p.status === "draft" && canManage ? "Resume" : "View"} ${p.name}${p.status === "draft" ? " draft" : " profile"}`}
                    onClick={() => view(p.id)}
                  >
                    {p.status === "draft" && canManage
                      ? "Resume draft"
                      : "View"}
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
          <fieldset disabled={locked || conflict} className="min-w-0">
            <InterviewIntelligenceBuilder
              definition={current}
              onChange={editing ? setDraft : undefined}
              version={selected.version}
              unpublished={isDraft}
            />
          </fieldset>
          {!isDraft && (
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
