import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bold,
  Check,
  ChevronRight,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import FloatingLayer from "../../../components/ui/FloatingLayer.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { IMAGE_UPLOAD_ACCEPT, validateLearningImageFile } from "../../../utils/imageUpload.js";
import { crewService } from "../../../services/crewService.js";
import { sanitizeSopHtml } from "../utils/sopDocumentContent.js";

const byOrder = (rows = []) => [...rows].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
const temporaryId = (type) => `temp:${type}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
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
  const [mediaBusy, setMediaBusy] = useState(false);
  const [pane, setPane] = useState("edit");
  const uploadedMedia = useRef(new Set());
  const selectedModule = draft.modules.find((module) => module.id === selection.moduleId) || draft.modules[0];
  const selectedLesson = selectedModule?.lessons.find((lesson) => lesson.id === selection.lessonId);
  const stats = editorStats(draft);

  function mutate(updater) {
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
  function moveModule(direction) {
    mutate((next) => {
      moveInArray(next.modules, selectedModule.id, direction);
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
  function addLesson() {
    const id = temporaryId("lesson");
    mutate((next) => {
      const module = next.modules.find((item) => item.id === selectedModule.id);
      module.lessons.push({ id, title: "Untitled Lesson", sort_order: module.lessons.length + 1, content_type: "lesson", required: true, estimated_minutes: 5, blocks: [], quizzes: [] });
      return normalizeOrders(next);
    });
    setSelection({ type: "lesson", moduleId: selectedModule.id, lessonId: id });
  }
  function deleteLesson(lessonId) {
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
  function deleteBlock(blockId) {
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
    if (mediaBusy) return false;
    setBusy(true);
    try {
      const saved = await onSave(normalizeOrders(clone(draft)));
      await cleanupUploadedMedia(saved);
      uploadedMedia.current.clear();
      setDraft(hydrateOnboardingDraft(saved));
      setDirty(false);
      return saved;
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    const saved = dirty ? await saveDraft() : draft;
    if (saved) await onPublish(saved, editorStats(saved));
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

  const footer = <div className="crew-onboarding-editor-footer"><button className="btn-secondary" type="button" onClick={() => setPane((value) => value === "preview" ? "edit" : "preview")}>{pane === "preview" ? "Back to Editor" : "Preview"}</button><div><button className="btn-primary" type="button" disabled={!dirty || busy || saving || mediaBusy} onClick={saveDraft}>{busy || mediaBusy ? "Saving…" : "Save Draft"}</button><button className="btn-secondary" type="button" disabled={busy || saving || mediaBusy} onClick={publish}>Publish</button></div></div>;
  return <Modal title="Edit New Crew Onboarding" description={`${outlet?.name || "Outlet"} · Draft v${draft.version}`} size="2xl" panelClassName="crew-onboarding-editor-modal" bodyClassName="crew-onboarding-editor-body" headerActions={<span className={`crew-onboarding-save-state ${dirty ? "is-dirty" : "is-saved"}`}>{dirty ? "Unsaved Changes" : <><Check size={13} /> Saved</>}</span>} footer={footer} footerClassName="block" onClose={requestClose}>
    {pane === "preview" ? <OnboardingPreview draft={draft} sops={sops} /> : <div className="crew-onboarding-editor-layout">
      <aside className="crew-onboarding-module-outline"><header><strong>Modules</strong><span>{draft.modules.length}</span></header>{draft.modules.map((module, index) => <button key={module.id} className={selectedModule?.id === module.id ? "is-active" : ""} onClick={() => setSelection({ type: "module", moduleId: module.id })}><span>{String(index + 1).padStart(2, "0")}</span><strong>{module.title}</strong><ChevronRight size={15} /></button>)}</aside>
      <main className="crew-onboarding-editor-main">{selection.type === "lesson" && selectedLesson ? <LessonEditor module={selectedModule} lesson={selectedLesson} sops={sops} onBack={() => setSelection({ type: "module", moduleId: selectedModule.id })} onUpdate={updateLesson} onUpdateBlock={updateBlock} onUploadMedia={uploadBlockMedia} onAddBlock={addBlock} onMoveBlock={moveBlock} onDeleteBlock={deleteBlock} onUpdateQuiz={updateQuiz} /> : <ModuleEditor module={selectedModule} moduleIndex={draft.modules.indexOf(selectedModule)} moduleCount={draft.modules.length} onUpdate={updateModule} onMove={moveModule} onSelectLesson={(lessonId) => setSelection({ type: "lesson", moduleId: selectedModule.id, lessonId })} onAddLesson={addLesson} onMoveLesson={moveLesson} onDeleteLesson={deleteLesson} />}</main>
    </div>}
  </Modal>;
}

function ModuleEditor({ module, moduleIndex, moduleCount, onUpdate, onMove, onSelectLesson, onAddLesson, onMoveLesson, onDeleteLesson }) {
  if (!module) return null;
  return <section className="crew-onboarding-module-editor"><header><div><span>Module {String(moduleIndex + 1).padStart(2, "0")}</span><h2>{module.title}</h2></div><div><button className="icon-btn" aria-label="Move module up" disabled={!moduleIndex} onClick={() => onMove(-1)}><ArrowUp size={16} /></button><button className="icon-btn" aria-label="Move module down" disabled={moduleIndex === moduleCount - 1} onClick={() => onMove(1)}><ArrowDown size={16} /></button></div></header><div className="crew-onboarding-editor-fields"><label>Module Title<input className="control" value={module.title} onChange={(event) => onUpdate({ title: event.target.value })} /></label><label>Description<textarea className="control" value={module.description || ""} onChange={(event) => onUpdate({ description: event.target.value })} /></label><Toggle label="Required" detail="Crew must complete this module before later required modules unlock." checked={Boolean(module.required)} onChange={(required) => onUpdate({ required })} /></div><section className="crew-onboarding-lessons"><header><div><h3>Lessons</h3><span>{module.lessons.length}</span></div><button className="btn-secondary" onClick={onAddLesson}><Plus size={15} /> Add Lesson</button></header>{module.lessons.map((lesson, index) => <article key={lesson.id}><button className="crew-onboarding-lesson-entry" onClick={() => onSelectLesson(lesson.id)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{lesson.title}</strong><small>{lesson.blocks.length} content · {lesson.quizzes.length ? "Knowledge Check" : "No quiz"}</small><ChevronRight size={15} /></button><div><button className="icon-btn" aria-label={`Move ${lesson.title} up`} disabled={!index} onClick={() => onMoveLesson(lesson.id, -1)}><ArrowUp size={15} /></button><button className="icon-btn" aria-label={`Move ${lesson.title} down`} disabled={index === module.lessons.length - 1} onClick={() => onMoveLesson(lesson.id, 1)}><ArrowDown size={15} /></button><button className="icon-btn is-danger" aria-label={`Delete ${lesson.title}`} disabled={module.lessons.length === 1} onClick={() => onDeleteLesson(lesson.id)}><Trash2 size={15} /></button></div></article>)}</section></section>;
}

function LessonEditor({ module, lesson, sops, onBack, onUpdate, onUpdateBlock, onUploadMedia, onAddBlock, onMoveBlock, onDeleteBlock, onUpdateQuiz }) {
  return <section className="crew-onboarding-lesson-editor"><button className="btn-ghost crew-onboarding-editor-back" onClick={onBack}><ArrowLeft size={15} /> {module.title}</button><header><span>Lesson</span><h2>{lesson.title}</h2></header><div className="crew-onboarding-editor-fields is-lesson"><label>Lesson Title<input className="control" value={lesson.title} onChange={(event) => onUpdate({ title: event.target.value })} /></label><label>Estimated Minutes<input className="control" type="number" min="0" value={lesson.estimated_minutes || 0} onChange={(event) => onUpdate({ estimated_minutes: Number(event.target.value) })} /></label><Toggle label="Required" detail="Required lessons gate later required lessons." checked={Boolean(lesson.required)} onChange={(required) => onUpdate({ required })} /></div><section className="crew-onboarding-content"><header><h3>Content</h3><AddContentMenu disabledQuiz={Boolean(lesson.quizzes.length)} onAdd={onAddBlock} /></header>{lesson.blocks.map((block, index) => <ContentBlockEditor key={block.id} block={block} index={index} count={lesson.blocks.length} sops={sops} onChange={(values) => onUpdateBlock(block.id, values)} onUpload={(file) => onUploadMedia(block.id, file)} onMove={(direction) => onMoveBlock(block.id, direction)} onDelete={() => onDeleteBlock(block.id)} />)}{lesson.quizzes.map((quiz) => <QuizEditor key={quiz.id} quiz={quiz} onChange={onUpdateQuiz} />)}{!lesson.blocks.length && !lesson.quizzes.length ? <p className="crew-onboarding-empty-content">Add the first content item for this lesson.</p> : null}</section></section>;
}

function AddContentMenu({ disabledQuiz, onAdd }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  return <><button ref={anchorRef} className="btn-secondary" onClick={() => setOpen((value) => !value)}><Plus size={15} /> Add Content</button><FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="end" width={220} estimatedHeight={190} className="p-1"><div className="crew-onboarding-add-menu" role="menu">{[["text", "Text"], ["key_point", "Key Point"], ["sop_reference", "SOP Reference"], ["quiz", "Knowledge Check"]].map(([type, label]) => <button key={type} role="menuitem" disabled={type === "quiz" && disabledQuiz} onClick={() => { setOpen(false); onAdd(type); }}>{label}</button>)}</div></FloatingLayer></>;
}

function ContentBlockEditor({ block, index, count, sops, onChange, onUpload, onMove, onDelete }) {
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
  return <article className={`crew-onboarding-content-card is-${block.block_type}`}><header><div><Badge tone={block.block_type === "key_point" ? "success" : "neutral"}>{label}</Badge><p>{summary}</p></div><div><button className="btn-secondary crew-sop-compact-action" onClick={() => setEditing((value) => !value)}>{editing ? "Done" : "Edit"}</button><button className="icon-btn" aria-label={`Move ${label} up`} disabled={!index} onClick={() => onMove(-1)}><ArrowUp size={14} /></button><button className="icon-btn" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown size={14} /></button><button className="icon-btn is-danger" aria-label={`Delete ${label}`} onClick={onDelete}><Trash2 size={14} /></button></div></header>{editing ? <div className="crew-onboarding-content-form">{block.block_type === "sop_reference" ? <><SelectField label="Published SOP" ariaLabel="Published SOP" value={block.payload?.sop_id || ""} onChange={(sopId) => onChange({ payload: { ...block.payload, sop_id: sopId, required_acknowledgement: true } })} placeholder="Choose SOP" options={publishedSops.map((sop) => ({ value: sop.id, label: sop.title }))} /><Toggle label="Acknowledgement Required" checked={block.payload?.required_acknowledgement !== false} onChange={(required_acknowledgement) => onChange({ payload: { ...block.payload, required_acknowledgement } })} /></> : <><RichTextEditor value={blockHtml(block)} onChange={(body_html) => onChange({ payload: { ...block.payload, body_html, body: plainText(body_html) } })} onImage={chooseImage} imageInputId={imageInputId} />{uploading ? <p className="crew-onboarding-media-note" role="status">Uploading image…</p> : null}{media ? <div className="crew-onboarding-media-editor"><AdminLearningImage media={media} previewUrl={block.media_preview_url} /><label>Image Caption<input className="control" value={media.caption || ""} onChange={(event) => onChange({ payload: { ...block.payload, media: { ...media, caption: event.target.value } } })} placeholder="Optional caption" /></label><label>Alternative Text<input className="control" value={media.alt_text || ""} onChange={(event) => onChange({ payload: { ...block.payload, media: { ...media, alt_text: event.target.value } } })} placeholder="Describe the image" /></label><div><button type="button" className="btn-secondary" onClick={() => document.getElementById(imageInputId)?.click()}>Replace Image</button><button type="button" className="btn-ghost is-danger" onClick={() => onChange({ media_preview_url: "", payload: { ...block.payload, media: null } })}>Remove Image</button></div></div> : null}</>}{imageError ? <p className="crew-onboarding-media-note" role="alert">{imageError}</p> : null}</div> : null}</article>;
}

function QuizEditor({ quiz, onChange }) {
  function update(values) { onChange((next) => Object.assign(next, values)); }
  function updateQuestion(questionId, values) { onChange((next) => Object.assign(next.questions.find((question) => question.id === questionId), values)); }
  function addQuestion() { onChange((next) => next.questions.push({ id: temporaryId("question"), prompt: "Untitled question", question_type: "single_choice", explanation: "", sort_order: next.questions.length + 1, options: [{ id: temporaryId("option"), label: "Option 1", is_correct: true, sort_order: 1 }, { id: temporaryId("option"), label: "Option 2", is_correct: false, sort_order: 2 }] })); }
  return <article className="crew-onboarding-quiz-editor"><header><div><Badge tone="info">Knowledge Check</Badge><p>{quiz.questions.length} Questions · Pass {quiz.passing_score}%</p></div></header><div className="crew-onboarding-quiz-settings"><label>Title<input className="control" value={quiz.title} onChange={(event) => update({ title: event.target.value })} /></label><label>Passing Score<input className="control" type="number" min="0" max="100" value={quiz.passing_score} onChange={(event) => update({ passing_score: Number(event.target.value) })} /></label><Toggle label="Required" checked={Boolean(quiz.required)} onChange={(required) => update({ required })} /></div>{quiz.questions.map((question, questionIndex) => <section className="crew-onboarding-question" key={question.id}><header><strong>Question {questionIndex + 1}</strong><button className="btn-ghost is-danger" disabled={quiz.questions.length === 1} onClick={() => onChange((next) => { next.questions = next.questions.filter((item) => item.id !== question.id); })}>Delete</button></header><input className="control" value={question.prompt} onChange={(event) => updateQuestion(question.id, { prompt: event.target.value })} /><SelectField ariaLabel={`Question ${questionIndex + 1} type`} value={question.question_type} onChange={(question_type) => updateQuestion(question.id, { question_type })} options={[{ value: "single_choice", label: "Single choice" }, { value: "multiple_choice", label: "Multiple choice" }]} /><div>{question.options.map((option, optionIndex) => <label key={option.id}><input type={question.question_type === "single_choice" ? "radio" : "checkbox"} name={`correct-${question.id}`} checked={Boolean(option.is_correct)} onChange={() => onChange((next) => { const target = next.questions.find((item) => item.id === question.id); if (target.question_type === "single_choice") target.options.forEach((item) => { item.is_correct = item.id === option.id; }); else target.options.find((item) => item.id === option.id).is_correct = !option.is_correct; })} aria-label={`Option ${optionIndex + 1} correct`} /><input className="control" value={option.label} onChange={(event) => onChange((next) => { next.questions.find((item) => item.id === question.id).options.find((item) => item.id === option.id).label = event.target.value; })} /><button className="icon-btn is-danger" aria-label={`Delete option ${optionIndex + 1}`} disabled={question.options.length <= 2} onClick={() => onChange((next) => { const target = next.questions.find((item) => item.id === question.id); target.options = target.options.filter((item) => item.id !== option.id); })}><Trash2 size={14} /></button></label>)}</div><button className="btn-ghost" onClick={() => onChange((next) => { const target = next.questions.find((item) => item.id === question.id); target.options.push({ id: temporaryId("option"), label: `Option ${target.options.length + 1}`, is_correct: false, sort_order: target.options.length + 1 }); })}><Plus size={14} /> Add Option</button></section>)}<button className="btn-secondary" onClick={addQuestion}><Plus size={15} /> Add Question</button></article>;
}

function RichTextEditor({ value, onChange, onImage, imageInputId }) {
  const editorRef = useRef(null);
  const imageRef = useRef(null);
  const rangeRef = useRef(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  useEffect(() => { if (editorRef.current && editorRef.current.innerHTML !== value) editorRef.current.innerHTML = value || ""; }, [value]);
  function emit() { onChange(sanitizeSopHtml(editorRef.current?.innerHTML || "")); }
  function remember() { const selection = window.getSelection?.(); if (selection?.rangeCount && editorRef.current?.contains(selection.anchorNode)) rangeRef.current = selection.getRangeAt(0).cloneRange(); }
  function command(name, argument = null) { editorRef.current?.focus(); if (rangeRef.current) { const selection = window.getSelection?.(); selection?.removeAllRanges(); selection?.addRange(rangeRef.current); } document.execCommand?.(name, false, argument); emit(); }
  const tools = [["Bold", Bold, () => command("bold")], ["Italic", Italic, () => command("italic")], ["Highlight", Highlighter, () => command("hiliteColor", "#fff1a8")], ["Bullet List", List, () => command("insertUnorderedList")], ["Numbered List", ListOrdered, () => command("insertOrderedList")], ["Link", Link2, () => { remember(); setLinkOpen((current) => !current); }], ["Image", ImagePlus, () => imageRef.current?.click()], ["Undo", Undo2, () => command("undo")], ["Redo", Redo2, () => command("redo")]];
  return <div className="crew-sop-rich-editor"><div className="crew-sop-rich-toolbar" role="toolbar" aria-label="Content formatting">{tools.map(([label, Icon, action]) => <button key={label} type="button" aria-label={label} title={label} onMouseDown={(event) => event.preventDefault()} onClick={action}><Icon size={15} /></button>)}<input id={imageInputId} ref={imageRef} className="sr-only" type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={(event) => { const file = event.target.files?.[0]; if (file) onImage(file); event.target.value = ""; }} /></div>{linkOpen ? <div className="crew-sop-link-editor"><input className="control" aria-label="Link URL" value={linkValue} onChange={(event) => setLinkValue(event.target.value)} placeholder="https://example.com" /><button className="btn-secondary crew-sop-compact-action" onClick={() => { if (linkValue.trim()) command("createLink", linkValue.trim()); setLinkOpen(false); setLinkValue(""); }}>Apply Link</button><button className="btn-ghost" onClick={() => setLinkOpen(false)}>Cancel</button></div> : null}<div ref={editorRef} className="crew-sop-rich-surface" contentEditable role="textbox" aria-label="Content" aria-multiline="true" data-placeholder="Write lesson content…" onInput={emit} onBlur={emit} onMouseUp={remember} onKeyUp={remember} suppressContentEditableWarning /></div>;
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

function Toggle({ label, detail, checked, onChange }) {
  return <label className="crew-onboarding-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong>{detail ? <small>{detail}</small> : null}</span></label>;
}

function OnboardingPreview({ draft, sops }) {
  return <section className="crew-onboarding-preview"><header><h2>Onboarding Preview</h2><p>{draft.modules.length} modules · {editorStats(draft).lessons} lessons · {editorStats(draft).quizzes} knowledge checks</p></header>{draft.modules.map((module, moduleIndex) => <article key={module.id}><div><span>{String(moduleIndex + 1).padStart(2, "0")}</span><h3>{module.title}</h3><small>{module.required ? "Required" : "Optional"}</small></div>{module.lessons.map((lesson, lessonIndex) => <section key={lesson.id}><h4>{String(lessonIndex + 1).padStart(2, "0")} {lesson.title}</h4>{lesson.blocks.map((block) => block.block_type === "sop_reference" ? <p key={block.id}><strong>SOP Reference:</strong> {sops.find((sop) => sop.id === block.payload?.sop_id)?.title || "Unselected SOP"}</p> : <div key={block.id} className={block.block_type === "key_point" ? "is-key" : ""}><div dangerouslySetInnerHTML={{ __html: blockHtml(block) }} />{block.payload?.media ? <AdminLearningImage media={block.payload.media} previewUrl={block.media_preview_url} /> : null}</div>)}{lesson.quizzes?.length ? <p><strong>Knowledge Check:</strong> {lesson.quizzes[0].questions.length} questions · Pass {lesson.quizzes[0].passing_score}%</p> : null}</section>)}</article>)}</section>;
}

function moveInArray(rows, id, direction) { const index = rows.findIndex((item) => item.id === id); const target = index + direction; if (index < 0 || target < 0 || target >= rows.length) return; [rows[index], rows[target]] = [rows[target], rows[index]]; }
function findLesson(journey, moduleId, lessonId) { return journey.modules.find((module) => module.id === moduleId)?.lessons.find((lesson) => lesson.id === lessonId); }
function normalizeOrders(journey) { journey.modules.forEach((module, moduleIndex) => { module.sort_order = moduleIndex + 1; module.lessons.forEach((lesson, lessonIndex) => { lesson.sort_order = lessonIndex + 1; lesson.blocks.forEach((block, blockIndex) => { block.sort_order = blockIndex + 1; }); lesson.quizzes?.forEach((quiz) => quiz.questions.forEach((question, questionIndex) => { question.sort_order = questionIndex + 1; question.options.forEach((option, optionIndex) => { option.sort_order = optionIndex + 1; }); })); }); }); return journey; }
function newQuiz(lesson) { return { id: temporaryId("quiz"), title: `${lesson.title} Knowledge Check`, passing_score: 80, required: true, status: "draft", questions: [{ id: temporaryId("question"), prompt: "Untitled question", question_type: "single_choice", explanation: "", sort_order: 1, options: [{ id: temporaryId("option"), label: "Option 1", is_correct: true, sort_order: 1 }, { id: temporaryId("option"), label: "Option 2", is_correct: false, sort_order: 2 }] }] }; }
