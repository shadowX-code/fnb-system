import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpenCheck, CheckCircle2, ChevronRight, ClipboardCheck, FileText, LockKeyhole, PlayCircle, ShieldCheck } from "lucide-react";
import { crewService } from "../../../services/crewService.js";

function Progress({ value = 0 }) {
  return <div className="crew-learning-progress" aria-label={`${value}% complete`}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

function plainBlock(block) {
  const payload = block?.payload || {};
  return payload.body || payload.text || payload.content || payload.title || "";
}

export default function CrewLearningMobile({ token, onRefreshHome }) {
  const [home, setHome] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [sop, setSop] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const activeLesson = useMemo(() => lesson && assignment?.modules?.flatMap((module) => module.lessons || []).find((item) => item.lesson?.id === lesson.lesson?.id), [assignment, lesson]);
  async function loadHome() {
    setLoading(true); setError("");
    try {
      const nextHome = await crewService.learningHome(token);
      setHome(nextHome);
      if (nextHome?.assignment?.id) setAssignment(await crewService.learningAssignment(token, nextHome.assignment.id));
      else setAssignment(null);
      onRefreshHome?.(nextHome);
    } catch (cause) { setError(cause.message || "Unable to load your learning."); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadHome(); }, [token]);

  async function openLesson(nextLesson) { setError(""); setLesson(nextLesson); setResult(null); setAnswers({}); setSop(null); }
  async function openSop(versionId) { setSaving(true); setError(""); try { setSop(await crewService.sopVersion(token, versionId)); } catch (cause) { setError(cause.message || "This SOP is unavailable."); } finally { setSaving(false); } }
  async function acknowledge() { if (!sop) return; setSaving(true); setError(""); try { await crewService.acknowledgeSop(token, sop.id); setSop({ ...sop, acknowledged: true }); } catch (cause) { setError(cause.message || "Unable to acknowledge this SOP."); } finally { setSaving(false); } }
  function choose(question, optionId) {
    setAnswers((current) => {
      const selected = current[question.id] || [];
      return { ...current, [question.id]: question.question_type === "multiple_choice" ? (selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId]) : [optionId] };
    });
  }
  async function submitQuiz() {
    if (!activeLesson?.quiz) return;
    setSaving(true); setError("");
    try {
      const payload = activeLesson.quiz.questions.map((question) => ({ question_id: question.id, option_ids: answers[question.id] || [] }));
      setResult(await crewService.submitQuiz(token, assignment.id, activeLesson.quiz.id, payload));
    } catch (cause) { setError(cause.message || "Please review your answers and try again."); } finally { setSaving(false); }
  }
  async function completeLesson() {
    if (!activeLesson) return;
    setSaving(true); setError("");
    try {
      const completion = await crewService.completeLesson(token, assignment.id, activeLesson.lesson.id);
      if (!completion.completed) { setError("Finish the listed requirements before completing this lesson."); return; }
      await loadHome(); setLesson(null);
    } catch (cause) { setError(cause.message || "This lesson is not ready to complete."); } finally { setSaving(false); }
  }

  if (loading) return <section className="crew-learning-loading" aria-live="polite">Loading your learning journey…</section>;
  if (!assignment) return <section className="crew-learning-empty"><GraduationIcon /><h2>Learning starts with your next assignment.</h2><p>Your manager will add a journey here when it is ready for you.</p></section>;
  if (sop) return <section className="crew-learning-reader"><button className="crew-learning-back" onClick={() => setSop(null)}><ArrowLeft size={17} /> Back to lesson</button><span className="crew-learning-kicker">SOP · v{sop.version}</span><h2>{sop.title}</h2><p className="crew-learning-summary">{sop.summary || sop.change_summary}</p>{sop.sections?.map((section) => <article key={section.id} className={section.key_point ? "crew-sop-section is-key" : "crew-sop-section"}><h3>{section.title}</h3><p>{section.body}</p></article>)}{sop.acknowledged ? <p className="crew-learning-success"><CheckCircle2 size={17} /> Acknowledged</p> : <button className="crew-mobile-primary" disabled={saving} onClick={acknowledge}>{saving ? "Saving…" : "I acknowledge this SOP"}</button>}</section>;
  if (lesson) return <section className="crew-learning-reader"><button className="crew-learning-back" onClick={() => setLesson(null)}><ArrowLeft size={17} /> Learning journey</button><span className="crew-learning-kicker">{lesson.moduleTitle || "Module lesson"}</span><h2>{lesson.lesson.title}</h2><p className="crew-learning-summary">{lesson.lesson.estimated_minutes ? `${lesson.lesson.estimated_minutes} min` : "Complete the lesson at your own pace"}</p>{lesson.blocks?.map((block) => block.block_type === "sop_reference" ? <button key={block.id} className="crew-sop-link" onClick={() => openSop(block.payload?.sop_version_id)}><FileText size={18} /><span><strong>{block.payload?.title || "Required SOP"}</strong><small>Version {block.payload?.version || "—"}{block.payload?.required_acknowledgement ? " · acknowledgement required" : ""}</small></span><ChevronRight size={18} /></button> : <article key={block.id} className={`crew-content-block is-${block.block_type}`}><span>{block.block_type === "key_point" ? "Key point" : block.block_type === "steps" ? "Steps" : "Lesson"}</span><p>{plainBlock(block)}</p></article>)}{activeLesson?.quiz && <section className="crew-quiz"><div><span className="crew-learning-kicker">Knowledge check</span><h3>{activeLesson.quiz.title}</h3><p>Pass score: {activeLesson.quiz.passing_score}%</p></div>{activeLesson.quiz.questions?.map((question, index) => <fieldset key={question.id}><legend>{index + 1}. {question.prompt}</legend><small>{question.question_type === "multiple_choice" ? "Select all that apply" : "Select one answer"}</small>{question.options?.map((option) => <label key={option.id} className={answers[question.id]?.includes(option.id) ? "is-selected" : ""}><input type={question.question_type === "multiple_choice" ? "checkbox" : "radio"} name={question.id} checked={Boolean(answers[question.id]?.includes(option.id))} onChange={() => choose(question, option.id)} />{option.label}</label>)}</fieldset>)}{result ? <div className={result.passed ? "crew-quiz-result is-pass" : "crew-quiz-result is-retry"}><strong>{result.passed ? "Passed" : "Try again"}</strong><span>{result.score}% · Attempt {result.attempt_number}</span></div> : <button className="crew-mobile-primary" disabled={saving} onClick={submitQuiz}>{saving ? "Checking…" : "Submit quiz"}</button>}</section>}{error && <p className="crew-mobile-error">{error}</p>}<button className="crew-mobile-primary crew-complete-lesson" disabled={saving || Boolean(activeLesson?.locked)} onClick={completeLesson}>{lesson.completed ? "Completed" : saving ? "Saving…" : "Complete lesson"}</button></section>;
  return <section className="crew-learning-home">{error && <p className="crew-mobile-error">{error}</p>}<div className="crew-learning-hero"><span>Your journey</span><h2>{assignment.journey?.name || "Learning journey"}</h2><p>{assignment.journey?.description || "Keep building confidence, one lesson at a time."}</p><div><strong>{home?.assignment?.lessons_completed || 0}/{home?.assignment?.lessons_total || 0}</strong><Progress value={home?.assignment?.lessons_total ? Math.round((home.assignment.lessons_completed / home.assignment.lessons_total) * 100) : 0} /></div></div><div className="crew-learning-section-title"><h2>Modules</h2><span>Server-managed</span></div>{assignment.modules?.map((module) => <section className={module.locked ? "crew-learning-module is-locked" : "crew-learning-module"} key={module.module?.id}><div className="crew-module-head"><div><h3>{module.module?.title}</h3><p>{module.progress_percentage}% complete · {module.required ? "Required" : "Optional"}</p></div>{module.completed ? <CheckCircle2 size={20} /> : module.locked ? <LockKeyhole size={18} /> : <BookOpenCheck size={20} />}</div><Progress value={module.progress_percentage} />{module.lessons?.map((item) => <button key={item.lesson?.id} className={item.locked ? "crew-lesson-row is-locked" : "crew-lesson-row"} disabled={item.locked} onClick={() => openLesson({ ...item, moduleTitle: module.module?.title })}><span className="crew-lesson-marker">{item.completed ? <CheckCircle2 size={16} /> : item.locked ? <LockKeyhole size={15} /> : <PlayCircle size={16} />}</span><span><strong>{item.lesson?.title}</strong><small>{item.completed ? "Completed" : item.locked ? "Complete earlier required learning" : item.quiz?.required ? "Lesson + knowledge check" : "Ready to learn"}</small></span><ChevronRight size={17} /></button>)}</section>)}</section>;
}

function GraduationIcon() { return <ClipboardCheck size={28} aria-hidden="true" />; }
