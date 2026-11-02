import "./CrewOnboardingBuilder.css";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  ChevronDown,
  ListTree,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import AdminSegmentedControl from "../../../components/forms/AdminSegmentedControl.jsx";
import { CrewLessonBlocks, CrewQuizQuestions } from "./CrewLessonContent.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import AdminSortableList from "../../../components/ui/AdminSortableList.jsx";
import FloatingLayer from "../../../components/ui/FloatingLayer.jsx";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import ToggleField from "../../../components/forms/ToggleField.jsx";
import { validateLearningImageFile } from "../../../utils/imageUpload.js";
import { crewService } from "../../../services/crewService.js";
import { sanitizeSopHtml } from "../utils/sopDocumentContent.js";
import LocalizedContentEditor from "./LocalizedContentEditor.jsx";
import { detectContentLanguage, onboardingLocalizationUnits } from "../utils/localizedContent.js";

const RichTextEditor = lazy(() => import("./CrewAdminRichTextEditor.jsx"));

const byOrder = (rows = []) => [...rows].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
const temporaryId = () => globalThis.crypto.randomUUID();
const escapeHtml = (value = "") => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const plainText = (html = "") => {
  if (typeof document === "undefined") return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const template = document.createElement("template");
  template.innerHTML = sanitizeSopHtml(html);
  return (template.content.textContent || "").replace(/\s+/g, " ").trim();
};
const blockHtml = (block) => sanitizeSopHtml(block?.payload?.body_html || (block?.payload?.body ? `<p>${escapeHtml(block.payload.body)}</p>` : ""));
const clone = (value) => JSON.parse(JSON.stringify(value));

export function hydrateOnboardingDraft(journey) {
  return {
    ...clone(journey),
    modules: byOrder(journey?.modules).map((module, moduleIndex) => ({
      ...clone(module),
      sort_order: moduleIndex + 1,
      lessons: byOrder(module.lessons).map((lesson, lessonIndex) => ({
        ...clone(lesson),
        sort_order: lessonIndex + 1,
        blocks: byOrder(lesson.blocks).map((block, blockIndex) => ({ ...clone(block), sort_order: blockIndex + 1 })),
        quizzes: (lesson.quizzes || []).map((quiz) => ({
          ...clone(quiz),
          questions: byOrder(quiz.questions).map((question, questionIndex) => ({
            ...clone(question),
            sort_order: questionIndex + 1,
            options: byOrder(question.options).map((option, optionIndex) => ({ ...clone(option), sort_order: optionIndex + 1 })),
          })),
        })),
      })),
    })),
  };
}

const editorStats = (journey) => ({
  modules: journey.modules.length,
  lessons: journey.modules.reduce((total, module) => total + module.lessons.length, 0),
  quizzes: journey.modules.reduce((total, module) => total + module.lessons.filter((lesson) => lesson.quizzes?.length).length, 0),
});

export default function CrewOnboardingEditor({ journey, outlet, sops, saving, confirm, onClose, onSave, onPublish }) {
  const [draft, setDraft] = useState(() => hydrateOnboardingDraft(journey));
  const [selection, setSelection] = useState({ type: "module", moduleId: journey.modules?.[0]?.id || "" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [pane, setPane] = useState("edit");
  const [sourceLanguage, setSourceLanguage] = useState(() => journey._source_language || detectContentLanguage(journey.name));
  const uploadedMedia = useRef(new Set());
  const saveLock = useRef(false);
  const publishLock = useRef(false);
  const saveAttempt = useRef(null);
  const [error, setError] = useState("");
  const [errorTitle, setErrorTitle] = useState("Draft not saved");
  const [collapsed, setCollapsed] = useState(new Set());
  const [mobileOutline, setMobileOutline] = useState(true);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const selectedModule = draft.modules.find((module) => module.id === selection.moduleId) || draft.modules[0];
  const selectedLesson = selectedModule?.lessons.find((lesson) => lesson.id === selection.lessonId);
  const stats = editorStats(draft);

  function mutate(updater) {
    if (saveLock.current || publishLock.current) return;
    saveAttempt.current = null;
    setDraft((current) => updater(clone(current)) || current);
    setDirty(true);
  }
  function updateModule(values) {
    mutate((next) => {
      const module = next.modules.find((item) => item.id === selectedModule.id);
      Object.assign(module, values);
      return next;
    });
  }
  function updateLesson(values) {
    mutate((next) => {
      const lesson = next.modules.find((item) => item.id === selectedModule.id)?.lessons.find((item) => item.id === selectedLesson.id);
      Object.assign(lesson, values);
      return next;
    });
  }
  function moveModule(moduleId, direction) {
    mutate((next) => {
      moveInArray(next.modules, moduleId, direction);
      return normalizeOrders(next);
    });
  }
  function moveModuleTo(moduleId, targetModuleId, position) {
    mutate((next) => {
      moveToTarget(next.modules, moduleId, targetModuleId, position);
      return normalizeOrders(next);
    });
  }
  function moveLesson(lessonId, direction) {
    mutate((next) => {
      const module = next.modules.find((item) => item.id === selectedModule.id);
      moveInArray(module.lessons, lessonId, direction);
      return normalizeOrders(next);
    });
  }
  function moveLessonTo(lessonId, targetLessonId, position, moduleId = selectedModule.id) {
    mutate((next) => {
      const module = next.modules.find((item) => item.id === moduleId);
      moveToTarget(module.lessons, lessonId, targetLessonId, position);
      return normalizeOrders(next);
    });
  }
  function addLesson(moduleId = selectedModule.id) {
    const id = temporaryId("lesson");
    mutate((next) => {
      const module = next.modules.find((item) => item.id === moduleId);
      module.lessons.push({ id, title: "Untitled Lesson", sort_order: module.lessons.length + 1, content_type: "lesson", required: true, estimated_minutes: 5, blocks: [], quizzes: [] });
      return normalizeOrders(next);
    });
    setSelection({ type: "lesson", moduleId, lessonId: id });
    setCollapsed((current) => { const next = new Set(current); next.delete(moduleId); return next; });
    setPane("edit");
    setMobileOutline(false);
  }
  async function deleteLesson(lessonId) {
    if (!await confirm({ title: "Delete lesson?", message: "Remove this lesson and its content from this Draft? Published learning and Crew progress stay unchanged.", confirmLabel: "Delete Lesson", tone: "danger" })) return;
    mutate((next) => {
      const module = next.modules.find((item) => item.id === selectedModule.id);
      module.lessons = module.lessons.filter((item) => item.id !== lessonId);
      return normalizeOrders(next);
    });
    setSelection({ type: "module", moduleId: selectedModule.id });
  }
  function updateBlock(blockId, values) {
    mutate((next) => {
      const lesson = findLesson(next, selectedModule.id, selectedLesson.id);
      Object.assign(lesson.blocks.find((block) => block.id === blockId), values);
      return next;
    });
  }
  async function uploadBlockMedia(blockId, file) {
    setMediaBusy(true);
    try {
      const uploaded = await crewService.uploadLearningMedia(file, outlet.id);
      uploadedMedia.current.add(uploaded.media.id);
      updateBlock(blockId, {
        media_preview_url: uploaded.previewUrl,
        payload: {
          ...(findLesson(draft, selectedModule.id, selectedLesson.id)?.blocks.find((block) => block.id === blockId)?.payload || {}),
          media: uploaded.media,
        },
      });
      return uploaded;
    } finally {
      setMediaBusy(false);
    }
  }
  async function cleanupUploadedMedia(nextDraft = null) {
    const retained = new Set(
      (nextDraft?.modules || [])
        .flatMap((module) => module.lessons || [])
        .flatMap((lesson) => lesson.blocks || [])
        .map((block) => block.payload?.media?.id)
        .filter(Boolean),
    );
    const cleanup = [...uploadedMedia.current].filter((id) => !retained.has(id));
    await Promise.allSettled(cleanup.map((id) => crewService.deleteLearningMedia(id)));
    cleanup.forEach((id) => uploadedMedia.current.delete(id));
  }
  function addBlock(type) {
    mutate((next) => {
      const lesson = findLesson(next, selectedModule.id, selectedLesson.id);
      if (type === "quiz") {
        if (!lesson.quizzes.length) lesson.quizzes = [newQuiz(lesson)];
      } else {
        lesson.blocks.push({ id: temporaryId("block"), block_type: type, sort_order: lesson.blocks.length + 1, payload: type === "sop_reference" ? { sop_id: "", required_acknowledgement: true } : { body: "", body_html: "" } });
      }
      return normalizeOrders(next);
    });
  }
  function moveBlock(blockId, direction) {
    mutate((next) => {
      const lesson = findLesson(next, selectedModule.id, selectedLesson.id);
      moveInArray(lesson.blocks, blockId, direction);
      return normalizeOrders(next);
    });
  }
  function moveBlockTo(blockId, targetBlockId, position) {
    mutate((next) => {
      const lesson = findLesson(next, selectedModule.id, selectedLesson.id);
      moveToTarget(lesson.blocks, blockId, targetBlockId, position);
      return normalizeOrders(next);
    });
  }
  async function deleteBlock(blockId) {
    if (!await confirm({ title: "Delete content?", message: "Remove this content item from the Draft?", confirmLabel: "Delete Content", tone: "danger" })) return;
    mutate((next) => {
      const lesson = findLesson(next, selectedModule.id, selectedLesson.id);
      lesson.blocks = lesson.blocks.filter((block) => block.id !== blockId);
      return normalizeOrders(next);
    });
  }
  function updateQuiz(updater) {
    mutate((next) => {
      const lesson = findLesson(next, selectedModule.id, selectedLesson.id);
      updater(lesson.quizzes[0]);
      return normalizeOrders(next);
    });
  }
  async function saveDraft() {
    if (mediaBusy || saveLock.current) return false;
    saveLock.current = true;
    setBusy(true); setError("");
    try {
      const next = normalizeOrders(clone(draft));
      const fingerprint = JSON.stringify([next, sourceLanguage]);
      if (saveAttempt.current?.fingerprint !== fingerprint) saveAttempt.current = { fingerprint, requestId: crypto.randomUUID() };
      const saved = await onSave(next, { requestId: saveAttempt.current.requestId, sourceLanguage });
      setDraft(hydrateOnboardingDraft(saved));
      setDirty(false); saveAttempt.current = null;
      await cleanupUploadedMedia(saved);
      uploadedMedia.current.clear();
      return saved;
    } catch (cause) {
      setErrorTitle("Draft not saved");
      setError(cause.message || "Unable to save the draft. Your changes are retained. Try Save Draft again.");
      return false;
    } finally { saveLock.current = false; setBusy(false); }
  }
  async function publish() {
    if (publishLock.current || saveLock.current || mediaBusy) return;
    publishLock.current = true; setPublishing(true);
    try {
      const saved = dirty || !draft.draft_revision ? await saveDraft() : draft;
      if (saved) await onPublish(saved, { ...editorStats(saved), sourceLanguage });
    } catch (cause) { setErrorTitle("Unable to publish"); setError(cause.message || "Unable to publish. Your saved draft is retained."); }
    finally { publishLock.current = false; setPublishing(false); }
  }
  function selectItem(moduleId, lessonId) {
    setSelection({ type: lessonId ? "lesson" : "module", moduleId, lessonId });
    setMobileOutline(false);
    setPane("edit");
  }
  function addModule() {
    const id = temporaryId();
    mutate((next) => { next.modules.push({ id, title: "Untitled Module", description: "", required: true, estimated_minutes: 0, lessons: [] }); return normalizeOrders(next); });
    selectItem(id);
  }
  async function deleteModule() {
    if (!selectedModule || !await confirm({ title: "Delete module?", message: "Remove this module and its lessons from the Draft? Published learning and Crew progress stay unchanged.", confirmLabel: "Delete Module", tone: "danger" })) return;
    mutate((next) => { next.modules = next.modules.filter((m) => m.id !== selectedModule.id); return normalizeOrders(next); });
    setSelection({ type: "module", moduleId: "" });
  }
  async function deleteQuiz() {
    if (!await confirm({ title: "Delete Knowledge Check?", message: "Remove this Knowledge Check and its questions from the Draft? Published versions and existing Crew results stay unchanged.", confirmLabel: "Delete Knowledge Check", tone: "danger" })) return;
    updateLesson({ quizzes: [] });
  }
  async function requestClose() {
    if (!dirty) return onClose();
    const discard = await confirm({ title: "You have unsaved changes.", message: "Discard all changes from this editing session?", confirmLabel: "Discard Changes", cancelLabel: "Continue Editing", tone: "danger" });
    if (discard) {
      await Promise.allSettled([...uploadedMedia.current].map((id) => crewService.deleteLearningMedia(id)));
      uploadedMedia.current.clear();
      onClose();
    }
  }

  const localizationUnits = onboardingLocalizationUnits(draft, sourceLanguage);
  const locked = busy || saving || mediaBusy || publishing;
  return <section className="crew-onboarding-builder" aria-label="Onboarding Builder">
    <PageHeader title="Onboarding Builder" description={`${outlet?.name || "Outlet"} · Draft v${draft.version}`} breadcrumbs={[{ label: "New Crew Onboarding", onClick: requestClose }, { label: "Builder" }]} metadata={<span role="status" className={`crew-onboarding-save-state ${dirty ? "is-dirty" : "is-saved"}`}>{dirty ? `Draft v${draft.version} · Unsaved changes` : <><Check size={13} /> Draft v{draft.version} · All changes saved</>}</span>} secondaryActions={<><button className="btn-secondary" disabled={locked} onClick={() => { setPane((v) => v === "preview" ? "edit" : "preview"); setMobileOutline(false); }}>{pane === "preview" ? "Exit Preview" : "Preview"}</button><button className="btn-secondary" disabled={locked} onClick={() => setPane((v) => v === "languages" ? "edit" : "languages")}>{pane === "languages" ? "Back to Editor" : "Languages"}</button></>} primaryActions={<><button className="btn-secondary" disabled={locked || !dirty && draft.draft_revision > 0} onClick={saveDraft}>{busy ? "Saving…" : "Save Draft"}</button><button className="btn-primary" disabled={locked} onClick={publish}>Publish v{draft.version}</button></>} />
    {error && <div className="crew-onboarding-save-error" role="alert"><strong>{errorTitle}</strong><p>{error}</p><span>{dirty ? "Your unsaved changes are retained." : "Your saved draft is retained."}</span></div>}
    <button type="button" className="btn-secondary crew-onboarding-outline-toggle" onClick={() => setMobileOutline((v) => !v)}><ListTree size={16} />{mobileOutline ? "Show Editor" : "Course Outline"}</button>
    <fieldset disabled={locked} inert={locked} className={`crew-onboarding-builder-workspace ${mobileOutline ? "is-outline" : "is-editor"}`}>
      <aside className="crew-onboarding-module-outline" aria-label="Course outline"><header><strong>Course Outline</strong><button type="button" className="btn-secondary crew-onboarding-add-module" onClick={addModule}><Plus size={15} /> Add Module</button></header>
        <AdminSortableList className="crew-onboarding-outline-list" items={draft.modules} disabled={locked} getLabel={(_module,index) => `Reorder module ${index + 1}`} onMove={moveModuleTo}>{({item: module,index,handle}) => <div className="crew-onboarding-outline-group"><div className="crew-onboarding-outline-row">{handle}<button type="button" className="icon-btn" aria-label={`${collapsed.has(module.id) ? "Expand" : "Collapse"} ${module.title}`} aria-expanded={!collapsed.has(module.id)} onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(module.id)) next.delete(module.id); else next.add(module.id); return next; })}>{collapsed.has(module.id) ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</button><button type="button" className={selectedModule?.id === module.id && selection.type === "module" ? "is-active" : ""} aria-current={selectedModule?.id === module.id && selection.type === "module" ? "true" : undefined} onClick={() => selectItem(module.id)}><strong><span className="crew-outline-number">{index + 1}.</span> {module.title}</strong><small>{module.lessons.length} lessons</small></button></div>
          {!collapsed.has(module.id) && <><AdminSortableList className="crew-onboarding-outline-lessons" items={module.lessons} disabled={locked} getLabel={(_lesson,i) => `Reorder lesson ${i + 1} in ${module.title}`} onMove={(id,target,position) => moveLessonTo(id,target,position,module.id)}>{({item: lesson,index: lessonIndex,handle: lessonHandle}) => <div className="crew-onboarding-outline-row">{lessonHandle}<button type="button" aria-current={selectedLesson?.id === lesson.id ? "true" : undefined} className={selectedLesson?.id === lesson.id ? "is-active" : ""} onClick={() => selectItem(module.id,lesson.id)}><strong><span className="crew-outline-number">{index + 1}.{lessonIndex + 1}</span> {lesson.title}</strong><small>{lesson.required ? "Required" : "Optional"}{lesson.quizzes.length ? " · Knowledge Check" : ""}</small></button></div>}</AdminSortableList><button type="button" className="btn-ghost crew-onboarding-add-lesson" onClick={() => addLesson(module.id)}><Plus size={14} /> Add Lesson</button></>}
        </div>}</AdminSortableList>
        {!draft.modules.length && <p>Add a module to begin.</p>}
      </aside>
      <main className="crew-onboarding-editor-main">{pane === "preview" ? <OnboardingPreview draft={draft} selectedLessonId={selectedLesson?.id} selectedModuleId={selectedModule?.id} onSelect={(moduleId, lessonId) => setSelection({ type: "lesson", moduleId, lessonId })} /> : pane === "languages" ? <LocalizedContentEditor domain="onboarding" versionId={draft.id} sourceLanguage={sourceLanguage} onSourceLanguageChange={(next) => { setSourceLanguage(next); setDirty(true); }} onHydrateSourceLanguage={setSourceLanguage} sourceUnits={localizationUnits} sourceDirty={dirty} confirm={confirm} disabled={locked} /> : selection.type === "lesson" && selectedLesson ? <LessonEditor module={selectedModule} lesson={selectedLesson} sops={sops} onBack={() => selectItem(selectedModule.id)} onUpdate={updateLesson} onUpdateBlock={updateBlock} onUploadMedia={uploadBlockMedia} onAddBlock={addBlock} onMoveBlock={moveBlock} onMoveBlockTo={moveBlockTo} onDeleteBlock={deleteBlock} onUpdateQuiz={updateQuiz} onDeleteQuiz={deleteQuiz} onDeleteLesson={() => deleteLesson(selectedLesson.id)} /> : selectedModule ? <ModuleEditor module={selectedModule} moduleIndex={draft.modules.indexOf(selectedModule)} onDeleteModule={deleteModule} onUpdate={updateModule} onSelectLesson={(id) => selectItem(selectedModule.id,id)} onAddLesson={() => addLesson()} onMoveLesson={moveLesson} onMoveLessonTo={moveLessonTo} onDeleteLesson={deleteLesson} /> : <p>Select or add a module from the course outline.</p>}</main>
    </fieldset>
  </section>;
}

function ModuleEditor({ module, moduleIndex, onUpdate, onSelectLesson, onAddLesson, onMoveLesson, onMoveLessonTo, onDeleteLesson, onDeleteModule }) {
  if (!module) return null;
  return <section className="crew-onboarding-module-editor"><header><div><span>Module {String(moduleIndex + 1).padStart(2, "0")} · {module.lessons.length} lessons</span><h2>{module.title || "Untitled module"}</h2></div><OverflowActions label="Module actions" actions={[{ label: "Delete Module", danger: true, onClick: onDeleteModule }]} /></header><div className="crew-onboarding-editor-fields"><AdminFormField label="Module Title"><input className="control" value={module.title} onChange={(event) => onUpdate({ title: event.target.value })} /></AdminFormField><AdminFormField label="Description"><textarea className="control" value={module.description || ""} onChange={(event) => onUpdate({ description: event.target.value })} /></AdminFormField><Toggle label="Required" detail="Crew must complete this module before later required modules unlock." checked={Boolean(module.required)} onChange={(required) => onUpdate({ required })} /></div><section className="crew-onboarding-lessons"><header><div><h3>Lessons</h3><span>{module.lessons.length}</span></div><button className="btn-secondary" onClick={onAddLesson}><Plus size={15} /> Add Lesson</button></header><AdminSortableList items={module.lessons} scope="onboarding-lesson" getLabel={(_lesson, index) => `Reorder lesson ${index + 1}`} onMove={onMoveLessonTo}>{({ item: lesson, index, handle }) => <article>{handle}<button className="crew-onboarding-lesson-entry" onClick={() => onSelectLesson(lesson.id)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{lesson.title}</strong><small>{lesson.blocks.length} content · {lesson.quizzes.length ? "Knowledge Check" : "No quiz"}</small><ChevronRight size={15} /></button><OverflowActions label={`${lesson.title} actions`} actions={[{ label: "Delete", danger: true, onClick: () => onDeleteLesson(lesson.id) }]} /></article>}</AdminSortableList></section></section>;
}

function OverflowActions({ label, actions }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  return <div className="crew-onboarding-overflow"><button ref={anchorRef} className="icon-btn" type="button" aria-label={label} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={16} /></button><FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="end" width={150} estimatedHeight={actions.length * 38 + 8} className="p-1"><div className="crew-onboarding-add-menu" role="menu">{actions.map((action) => <button key={action.label} type="button" role="menuitem" disabled={action.disabled} className={action.danger ? "is-danger" : ""} onClick={() => { setOpen(false); action.onClick(); }}>{action.label}</button>)}</div></FloatingLayer></div>;
}

function LessonEditor({ module, lesson, sops, onBack, onUpdate, onUpdateBlock, onUploadMedia, onAddBlock, onMoveBlock, onMoveBlockTo, onDeleteBlock, onUpdateQuiz, onDeleteQuiz, onDeleteLesson }) {
  return <section className="crew-onboarding-lesson-editor"><header><span>{module.title} · Lesson</span><h2>{lesson.title || "Untitled lesson"}</h2><OverflowActions label="Lesson actions" actions={[{ label: "Delete Lesson", danger: true, onClick: onDeleteLesson }]} /></header><div className="crew-onboarding-editor-fields is-lesson"><AdminFormField label="Lesson Title"><input className="control" value={lesson.title} onChange={(event) => onUpdate({ title: event.target.value })} /></AdminFormField><AdminFormField label="Estimated Minutes"><input className="control" type="number" min="0" value={lesson.estimated_minutes || 0} onChange={(event) => onUpdate({ estimated_minutes: Number(event.target.value) })} /></AdminFormField><Toggle label="Required" detail="Required lessons gate later required lessons." checked={Boolean(lesson.required)} onChange={(required) => onUpdate({ required })} /></div><section className="crew-onboarding-content"><header><h3>Content</h3><AddContentMenu disabledQuiz={Boolean(lesson.quizzes.length)} onAdd={onAddBlock} /></header><AdminSortableList items={lesson.blocks} scope="onboarding-content" onMove={onMoveBlockTo}>{({ item: block, index, handle }) => <ContentBlockEditor block={block} index={index} count={lesson.blocks.length} handle={handle} sops={sops} onChange={(values) => onUpdateBlock(block.id, values)} onUpload={(file) => onUploadMedia(block.id, file)} onMove={(direction) => onMoveBlock(block.id, direction)} onDelete={() => onDeleteBlock(block.id)} />}</AdminSortableList>{lesson.quizzes.map((quiz) => <QuizEditor key={quiz.id} quiz={quiz} onChange={onUpdateQuiz} onDelete={onDeleteQuiz} />)}{!lesson.blocks.length && !lesson.quizzes.length ? <p className="crew-onboarding-empty-content">Add the first content item for this lesson.</p> : null}</section></section>;
}

function AddContentMenu({ disabledQuiz, onAdd }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  return <><button ref={anchorRef} className="btn-secondary" onClick={() => setOpen((value) => !value)}><Plus size={15} /> Add Content</button><FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="end" width={220} estimatedHeight={190} className="p-1"><div className="crew-onboarding-add-menu" role="menu">{[["text", "Text"], ["key_point", "Key Point"], ["sop_reference", "SOP Reference"], ["quiz", "Knowledge Check"]].map(([type, label]) => <button key={type} role="menuitem" disabled={type === "quiz" && disabledQuiz} onClick={() => { setOpen(false); onAdd(type); }}>{label}</button>)}</div></FloatingLayer></>;
}

function ContentBlockEditor({ block, index, count, handle, sops, onChange, onUpload, onMove, onDelete }) {
  const [editing, setEditing] = useState(String(block.id).startsWith("temp:"));
  const [imageError, setImageError] = useState("");
  const [uploading, setUploading] = useState(false);
  const publishedSops = useMemo(() => sops.filter((sop) => sop.versions?.some((version) => version.status === "published")), [sops]);
  const label = block.block_type === "key_point" ? "Key Point" : block.block_type === "sop_reference" ? "SOP Reference" : "Text";
  const summary = block.block_type === "sop_reference" ? publishedSops.find((sop) => sop.id === block.payload?.sop_id)?.title || "Choose a published SOP" : plainText(blockHtml(block)) || "Empty content";
  async function chooseImage(file) {
    try {
      validateLearningImageFile(file);
      setImageError("");
      setUploading(true);
      await onUpload(file);
    } catch (cause) { setImageError(cause.message); }
    finally { setUploading(false); }
  }
  const media = block.payload?.media;
  const imageInputId = `learning-image-${String(block.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return <article className={`crew-onboarding-content-card is-${block.block_type}`}><header><div>{handle}<Badge tone={block.block_type === "key_point" ? "success" : "neutral"}>{label}</Badge><p>{summary}</p></div><div><button className="btn-secondary crew-sop-compact-action" onClick={() => setEditing((value) => !value)}>{editing ? "Done" : "Edit"}</button><OverflowActions label={`${label} actions`} actions={[{ label: "Delete", danger: true, onClick: onDelete }]} /></div></header>{editing ? <div className="crew-onboarding-content-form">{block.block_type === "sop_reference" ? <><SelectField label="Published SOP" ariaLabel="Published SOP" value={block.payload?.sop_id || ""} onChange={(sopId) => onChange({ payload: { ...block.payload, sop_id: sopId, required_acknowledgement: true } })} placeholder="Choose SOP" options={publishedSops.map((sop) => ({ value: sop.id, label: sop.title }))} /><Toggle label="Acknowledgement Required" checked={block.payload?.required_acknowledgement !== false} onChange={(required_acknowledgement) => onChange({ payload: { ...block.payload, required_acknowledgement } })} /></> : <><Suspense fallback={<div role="status">Loading editor…</div>}><RichTextEditor value={blockHtml(block)} onChange={(body_html) => onChange({ payload: { ...block.payload, body_html, body: plainText(body_html) } })} onImage={chooseImage} imageInputId={imageInputId} imageActionLabel="Add or replace lesson image" placeholder="Write lesson content…" /></Suspense>{uploading ? <p className="crew-onboarding-media-note" role="status">Uploading image…</p> : null}{media ? <div className="crew-onboarding-media-editor"><AdminLearningImage media={media} previewUrl={block.media_preview_url} /><AdminFormField label="Image Caption"><input className="control" value={media.caption || ""} onChange={(event) => onChange({ payload: { ...block.payload, media: { ...media, caption: event.target.value } } })} placeholder="Optional caption" /></AdminFormField><AdminFormField label="Alternative Text"><input className="control" value={media.alt_text || ""} onChange={(event) => onChange({ payload: { ...block.payload, media: { ...media, alt_text: event.target.value } } })} placeholder="Describe the image" /></AdminFormField><div><button type="button" className="btn-secondary" onClick={() => document.getElementById(imageInputId)?.click()}>Replace Image</button><button type="button" className="btn-ghost is-danger" onClick={() => onChange({ media_preview_url: "", payload: { ...block.payload, media: null } })}>Remove Image</button></div></div> : null}</>}{imageError ? <p className="crew-onboarding-media-note" role="alert">{imageError}</p> : null}</div> : null}</article>;
}

function QuizEditor({ quiz, onChange, onDelete }) {
  const [editing, setEditing] = useState(false);
  function update(values) { onChange((next) => Object.assign(next, values)); }
  function updateQuestion(questionId, values) { onChange((next) => Object.assign(next.questions.find((question) => question.id === questionId), values)); }
  function addQuestion() { onChange((next) => next.questions.push({ id: temporaryId("question"), prompt: "Untitled question", question_type: "single_choice", explanation: "", sort_order: next.questions.length + 1, options: [{ id: temporaryId("option"), label: "Option 1", is_correct: true, sort_order: 1 }, { id: temporaryId("option"), label: "Option 2", is_correct: false, sort_order: 2 }] })); }
  return <article className="crew-onboarding-quiz-editor"><header><div><Badge tone="info">Knowledge Check</Badge><p>{quiz.questions.length} Questions · Pass {quiz.passing_score}%</p></div><div><button type="button" className="btn-secondary crew-sop-compact-action" onClick={() => setEditing((v) => !v)}>{editing ? "Done" : "Edit"}</button><OverflowActions label="Knowledge Check actions" actions={[{ label: "Delete", danger: true, onClick: onDelete }]} /></div></header>{editing && <div className="crew-onboarding-quiz-body"><div className="crew-onboarding-quiz-settings"><label>Title<input className="control" value={quiz.title} onChange={(event) => update({ title: event.target.value })} /></label><label>Passing Score<input className="control" type="number" min="0" max="100" value={quiz.passing_score} onChange={(event) => update({ passing_score: Number(event.target.value) })} /></label><Toggle label="Required" checked={Boolean(quiz.required)} onChange={(required) => update({ required })} /></div>{quiz.questions.map((question, questionIndex) => <section className="crew-onboarding-question" key={question.id}><header><strong>Question {questionIndex + 1}</strong><button className="btn-ghost is-danger" disabled={quiz.questions.length === 1} onClick={() => onChange((next) => { next.questions = next.questions.filter((item) => item.id !== question.id); })}>Delete</button></header><input className="control" value={question.prompt} onChange={(event) => updateQuestion(question.id, { prompt: event.target.value })} /><SelectField ariaLabel={`Question ${questionIndex + 1} type`} value={question.question_type} onChange={(question_type) => updateQuestion(question.id, { question_type })} options={[{ value: "single_choice", label: "Single choice" }, { value: "multiple_choice", label: "Multiple choice" }]} /><div>{question.options.map((option, optionIndex) => <label key={option.id}><input type={question.question_type === "single_choice" ? "radio" : "checkbox"} name={`correct-${question.id}`} checked={Boolean(option.is_correct)} onChange={() => onChange((next) => { const target = next.questions.find((item) => item.id === question.id); if (target.question_type === "single_choice") target.options.forEach((item) => { item.is_correct = item.id === option.id; }); else target.options.find((item) => item.id === option.id).is_correct = !option.is_correct; })} aria-label={`Option ${optionIndex + 1} correct`} /><input className="control" value={option.label} onChange={(event) => onChange((next) => { next.questions.find((item) => item.id === question.id).options.find((item) => item.id === option.id).label = event.target.value; })} /><button className="icon-btn is-danger" aria-label={`Delete option ${optionIndex + 1}`} disabled={question.options.length <= 2} onClick={() => onChange((next) => { const target = next.questions.find((item) => item.id === question.id); target.options = target.options.filter((item) => item.id !== option.id); })}><Trash2 size={14} /></button></label>)}</div><button className="btn-ghost" onClick={() => onChange((next) => { const target = next.questions.find((item) => item.id === question.id); target.options.push({ id: temporaryId("option"), label: `Option ${target.options.length + 1}`, is_correct: false, sort_order: target.options.length + 1 }); })}><Plus size={14} /> Add Option</button></section>)}<button className="btn-secondary" onClick={addQuestion}><Plus size={15} /> Add Question</button></div>}</article>;
}

function AdminLearningImage({ media, previewUrl = "" }) {
  const [url, setUrl] = useState(previewUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    if (previewUrl) { setUrl(previewUrl); return () => { active = false; }; }
    setUrl("");
    crewService.learningMediaAdminUrl(media.id)
      .then((nextUrl) => { if (active) setUrl(nextUrl); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [media.id, previewUrl]);
  if (failed) return <p className="crew-onboarding-media-note" role="status">Image preview unavailable.</p>;
  return url ? <img className="crew-onboarding-media-preview" src={url} alt={media.alt_text || media.caption || "Learning content preview"} /> : <div className="crew-onboarding-media-loading" aria-label="Loading image preview" />;
}

function Toggle({ label, detail, checked, onChange, className }) {
  return <ToggleField label={label} helper={detail} checked={checked} onChange={onChange} className={className} />;
}

export function OnboardingPreview({ draft, selectedLessonId, selectedModuleId, onSelect }) {
  const [inspectAnswers, setInspectAnswers] = useState(false);
  const [answers, setAnswers] = useState({});
  const viewport = useRef(null);
  const lessons = draft.modules.flatMap((module) => module.lessons.map((lesson) => ({ module, lesson })));
  const matched = lessons.findIndex((row) => selectedLessonId ? row.lesson.id === selectedLessonId : row.module.id === selectedModuleId);
  const index = Math.max(0, matched);
  const current = lessons[index];
  useEffect(() => { setAnswers({}); setInspectAnswers(false); viewport.current?.scrollIntoView?.({ block: "start" }); }, [current?.lesson.id]);
  if (!current) return <section><h2>Crew Learning Preview</h2><p>Add a lesson to preview this Draft.</p></section>;
  const { module, lesson } = current;
  function choose(question, optionId) {
    setAnswers((value) => ({ ...value, [question.id]: question.question_type === "multiple_choice" ? value[question.id]?.includes(optionId) ? value[question.id].filter((id) => id !== optionId) : [...(value[question.id] || []), optionId] : [optionId] }));
  }
  function navigate(offset) { const next = lessons[index + offset]; if (next) onSelect(next.module.id, next.lesson.id); }
  return <section className="crew-onboarding-lesson-preview" ref={viewport} aria-label="Crew Learning Preview">
    <header className="crew-preview-toolbar"><div><h2>Crew Learning Preview</h2><p>Draft v{draft.version} · Read-only · Lesson {index + 1} of {lessons.length}</p></div><AdminSegmentedControl label="Preview mode" value={inspectAnswers ? "answers" : "crew"} onChange={(mode) => setInspectAnswers(mode === "answers")} options={[{ value: "crew", label: "Crew Preview" }, { value: "answers", label: "Inspect Answers" }]} /></header>
    <div className="crew-learning-reader"><header className="crew-learning-lesson-header"><span className="crew-learning-context">{module.title}</span><h2>{lesson.title}</h2><p className="crew-learning-summary">{lesson.estimated_minutes || 0} min · {lesson.required ? "Required" : "Optional"}</p></header>
      <CrewLessonBlocks blocks={lesson.blocks} renderImage={(block) => <AdminLearningImage media={block.payload.media} previewUrl={block.media_preview_url} />} />
      {lesson.quizzes?.map((quiz) => <section className="crew-quiz" key={quiz.id}><div className="crew-learning-quiz-header"><span className="crew-learning-section-label">Knowledge Check</span><h3>{quiz.title}</h3><p>Pass score: {quiz.passing_score}%</p></div><CrewQuizQuestions quiz={quiz} answers={answers} onChoose={choose} inspectAnswers={inspectAnswers} /></section>)}
    </div>
    <footer className="crew-preview-navigation"><button type="button" className="btn-secondary" disabled={index === 0} onClick={() => navigate(-1)}>Previous Lesson</button><span>{index + 1} / {lessons.length}</span><button type="button" className="btn-secondary" disabled={index === lessons.length - 1} onClick={() => navigate(1)}>Next Lesson</button></footer>
  </section>;
}

function moveInArray(rows, id, direction) { const index = rows.findIndex((item) => item.id === id); const target = index + direction; if (index < 0 || target < 0 || target >= rows.length) return; [rows[index], rows[target]] = [rows[target], rows[index]]; }
function moveToTarget(rows, id, targetId, position = "before") { const fromIndex = rows.findIndex((item) => item.id === id); const targetIndex = rows.findIndex((item) => item.id === targetId); if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return; const [item] = rows.splice(fromIndex, 1); const target = rows.findIndex((row) => row.id === targetId); rows.splice(target + (position === "after" ? 1 : 0), 0, item); }
function findLesson(journey, moduleId, lessonId) { return journey.modules.find((module) => module.id === moduleId)?.lessons.find((lesson) => lesson.id === lessonId); }
function normalizeOrders(journey) { journey.modules.forEach((module, moduleIndex) => { module.sort_order = moduleIndex + 1; module.lessons.forEach((lesson, lessonIndex) => { lesson.sort_order = lessonIndex + 1; lesson.blocks.forEach((block, blockIndex) => { block.sort_order = blockIndex + 1; }); lesson.quizzes?.forEach((quiz) => quiz.questions.forEach((question, questionIndex) => { question.sort_order = questionIndex + 1; question.options.forEach((option, optionIndex) => { option.sort_order = optionIndex + 1; }); })); }); }); return journey; }
function newQuiz(lesson) { return { id: temporaryId("quiz"), title: `${lesson.title} Knowledge Check`, passing_score: 80, required: true, status: "draft", questions: [{ id: temporaryId("question"), prompt: "Untitled question", question_type: "single_choice", explanation: "", sort_order: 1, options: [{ id: temporaryId("option"), label: "Option 1", is_correct: true, sort_order: 1 }, { id: temporaryId("option"), label: "Option 2", is_correct: false, sort_order: 2 }] }] }; }
