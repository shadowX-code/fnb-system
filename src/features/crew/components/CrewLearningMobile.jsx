import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  FileText,
  LockKeyhole,
  PlayCircle,
} from "lucide-react";
import { crewService } from "../../../services/crewService.js";
import CrewRichContent from "./CrewRichContent.jsx";
import CrewLearningImage from "./CrewLearningImage.jsx";
import CrewSopImage from "./CrewSopImage.jsx";
import CrewLearnHome from "./CrewLearnHome.jsx";
import { plainTextToSopHtml } from "../utils/sopDocumentContent.js";

function Progress({ value = 0 }) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="crew-learning-progress" aria-label={`${safe}% complete`}>
      <span style={{ width: `${safe}%` }} />
    </div>
  );
}

function plainBlock(block) {
  const payload = block?.payload || {};
  return payload.body || payload.text || payload.content || payload.title || "";
}

function richBlock(block) {
  return block?.payload?.body_html || plainTextToSopHtml(plainBlock(block));
}

export default function CrewLearningMobile({ token, onRefreshHome }) {
  const [home, setHome] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [library, setLibrary] = useState({ categories: [], sops: [] });
  const [screen, setScreen] = useState("home");
  const [lesson, setLesson] = useState(null);
  const [sop, setSop] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const activeLesson = useMemo(
    () =>
      lesson &&
      assignment?.modules
        ?.flatMap((module) => module.lessons || [])
        .find((item) => item.lesson?.id === lesson.lesson?.id),
    [assignment, lesson],
  );

  async function loadHome() {
    setLoading(true);
    setError("");
    try {
      const [nextHome, nextLibrary] = await Promise.all([
        crewService.learningHome(token),
        crewService.sopLibrary(token),
      ]);
      setHome(nextHome);
      setLibrary(nextLibrary);
      if (nextHome?.assignment?.id) {
        setAssignment(
          await crewService.learningAssignment(token, nextHome.assignment.id),
        );
      } else {
        setAssignment(null);
      }
      onRefreshHome?.(nextHome);
    } catch (cause) {
      setError(cause.message || "Unable to load Learn.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHome();
  }, [token]);

  function openLesson(nextLesson) {
    setError("");
    setLesson(nextLesson);
    setResult(null);
    setAnswers({});
    setSop(null);
    setScreen("lesson");
  }

  async function openSop(versionId, returnScreen = "library") {
    setSaving(true);
    setError("");
    try {
      setSop(await crewService.sopVersion(token, versionId));
      setScreen(returnScreen === "lesson" ? "lesson-sop" : "sop");
    } catch (cause) {
      setError(cause.message || "This SOP is unavailable.");
    } finally {
      setSaving(false);
    }
  }

  async function acknowledge() {
    if (!sop) return;
    setSaving(true);
    setError("");
    try {
      await crewService.acknowledgeSop(
        token,
        sop.id,
        screen === "lesson-sop" ? "journey" : "direct_library",
      );
      setSop({ ...sop, acknowledged: true });
      setLibrary((current) => ({
        ...current,
        sops: current.sops.map((item) =>
          item.version_id === sop.id ? { ...item, acknowledged: true } : item,
        ),
      }));
    } catch (cause) {
      setError(cause.message || "Unable to acknowledge this SOP.");
    } finally {
      setSaving(false);
    }
  }

  function choose(question, optionId) {
    setAnswers((current) => {
      const selected = current[question.id] || [];
      return {
        ...current,
        [question.id]:
          question.question_type === "multiple_choice"
            ? selected.includes(optionId)
              ? selected.filter((id) => id !== optionId)
              : [...selected, optionId]
            : [optionId],
      };
    });
  }

  async function submitQuiz() {
    if (!activeLesson?.quiz) return;
    setSaving(true);
    setError("");
    try {
      const payload = activeLesson.quiz.questions.map((question) => ({
        question_id: question.id,
        option_ids: answers[question.id] || [],
      }));
      setResult(
        await crewService.submitQuiz(
          token,
          assignment.id,
          activeLesson.quiz.id,
          payload,
        ),
      );
    } catch (cause) {
      setError(cause.message || "Please review your answers and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function completeLesson() {
    if (!activeLesson) return;
    setSaving(true);
    setError("");
    try {
      const completion = await crewService.completeLesson(
        token,
        assignment.id,
        activeLesson.lesson.id,
      );
      if (!completion.completed) {
        setError("Finish the required SOP acknowledgement and knowledge check first.");
        return;
      }
      await loadHome();
      setScreen("onboarding");
      setLesson(null);
    } catch (cause) {
      setError(cause.message || "This lesson is not ready to complete.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="crew-learning-loading" aria-live="polite">
        Loading Learn…
      </section>
    );
  }

  if (screen === "lesson-sop" || screen === "sop") {
    return (
      <SopReader
        token={token}
        sop={sop}
        saving={saving}
        error={error}
        onBack={() => setScreen(screen === "lesson-sop" ? "lesson" : "home")}
        onAcknowledge={acknowledge}
      />
    );
  }

  if (screen === "lesson" && lesson) {
    return (
      <LessonReader
        token={token}
        lesson={lesson}
        activeLesson={activeLesson}
        answers={answers}
        result={result}
        saving={saving}
        error={error}
        onBack={() => setScreen("onboarding")}
        onOpenSop={(versionId) => openSop(versionId, "lesson")}
        onChoose={choose}
        onSubmitQuiz={submitQuiz}
        onComplete={completeLesson}
      />
    );
  }

  if (screen === "onboarding") {
    return (
      <OnboardingDetail
        assignment={assignment}
        home={home}
        error={error}
        onBack={() => setScreen("home")}
        onOpenLesson={openLesson}
      />
    );
  }

  return (
    <CrewLearnHome
      home={home}
      assignment={assignment}
      library={library}
      error={error}
      onOpenOnboarding={() => setScreen("onboarding")}
      onOpenSop={(versionId) => openSop(versionId, "home")}
    />
  );
}

function OnboardingDetail({ assignment, home, error, onBack, onOpenLesson }) {
  if (!assignment) {
    return (
      <section className="crew-learning-empty">
        <button className="crew-learning-back" onClick={onBack}><ArrowLeft size={17} /> Learn</button>
        <ClipboardCheck size={28} />
        <h2>Onboarding is not published yet.</h2>
        <p>Your outlet manager is preparing the eight-module setup.</p>
      </section>
    );
  }
  return (
    <section className="crew-learning-home">
      <button className="crew-learning-back" onClick={onBack}><ArrowLeft size={17} /> Learn</button>
      {error && <p className="crew-mobile-error">{error}</p>}
      <div className="crew-learning-hero">
        <span>Mandatory onboarding</span>
        <h2>{assignment.journey?.name || "New Crew Onboarding"}</h2>
        <p>{assignment.status === "completed" ? "Completed · review anytime" : assignment.journey?.description}</p>
        <div>
          <strong>{home?.assignment?.lessons_completed || 0}/{home?.assignment?.lessons_total || 0}</strong>
          <Progress value={home?.assignment?.progress_percentage || 0} />
        </div>
      </div>
      <div className="crew-learning-section-title"><h2>Modules</h2><span>{assignment.modules?.length || 0}</span></div>
      {assignment.modules?.map((module, index) => (
        <section className={module.locked ? "crew-learning-module is-locked" : "crew-learning-module"} key={module.module?.id}>
          <div className="crew-module-head">
            <span className="crew-module-order">{String(index + 1).padStart(2, "0")}</span>
            <div><h3>{module.module?.title}</h3><p>{module.progress_percentage}% complete</p></div>
            {module.completed ? <CheckCircle2 size={20} /> : module.locked ? <LockKeyhole size={18} /> : <BookOpenCheck size={20} />}
          </div>
          <Progress value={module.progress_percentage} />
          {module.lessons?.map((item) => (
            <button key={item.lesson?.id} className={item.locked ? "crew-lesson-row is-locked" : "crew-lesson-row"} disabled={item.locked} onClick={() => onOpenLesson({ ...item, moduleTitle: module.module?.title })}>
              <span className="crew-lesson-marker">{item.completed ? <CheckCircle2 size={16} /> : item.locked ? <LockKeyhole size={15} /> : <PlayCircle size={16} />}</span>
              <span><strong>{item.lesson?.title}</strong><small>{item.completed ? "Completed · review" : item.locked ? "Complete earlier required learning" : item.quiz?.required ? "Lesson + knowledge check" : "Ready to learn"}</small></span>
              <ChevronRight size={17} />
            </button>
          ))}
        </section>
      ))}
    </section>
  );
}


function SopReader({ token, sop, saving, error, onBack, onAcknowledge }) {
  if (!sop) return null;
  return (
    <section className="crew-learning-reader">
      <button className="crew-learning-back" onClick={onBack}><ArrowLeft size={17} /> Back</button>
      <span className="crew-learning-kicker">{sop.category} · v{sop.version}</span>
      <h2>{sop.title}</h2>
      <p className="crew-learning-summary">{sop.summary || sop.change_summary}</p>
      {sop.sections?.map((section) => (
        <article key={section.id} className={section.key_point ? "crew-sop-section is-key" : "crew-sop-section"}>
          <h3>{section.title}</h3><CrewRichContent html={section.body} /><CrewSopImage media={section.media} token={token} sopVersionId={sop.id} />{section.key_point && <span>Key point</span>}
        </article>
      ))}
      {error && <p className="crew-mobile-error">{error}</p>}
      {sop.acknowledgement_required && (
        sop.acknowledged
          ? <p className="crew-learning-success"><CheckCircle2 size={17} /> Acknowledged</p>
          : <button className="crew-mobile-primary" disabled={saving} onClick={onAcknowledge}>{saving ? "Saving…" : "I acknowledge this SOP"}</button>
      )}
    </section>
  );
}

function LessonReader({ token, lesson, activeLesson, answers, result, saving, error, onBack, onOpenSop, onChoose, onSubmitQuiz, onComplete }) {
  return (
    <section className="crew-learning-reader">
      <button className="crew-learning-back" onClick={onBack}><ArrowLeft size={17} /> Onboarding</button>
      <span className="crew-learning-kicker">{lesson.moduleTitle || "Module lesson"}</span>
      <h2>{lesson.lesson.title}</h2>
      <p className="crew-learning-summary">{lesson.lesson.estimated_minutes ? `${lesson.lesson.estimated_minutes} min` : "Complete at your own pace"}</p>
      {lesson.blocks?.map((block) =>
        block.block_type === "sop_reference" ? (
          <button key={block.id} className="crew-sop-link" onClick={() => onOpenSop(block.payload?.sop_version_id)}>
            <FileText size={18} /><span><strong>{block.payload?.title || "Required SOP"}</strong><small>Version {block.payload?.version || "—"}{block.payload?.required_acknowledgement ? " · acknowledgement required" : ""}</small></span><ChevronRight size={18} />
          </button>
        ) : (
          <article key={block.id} className={`crew-content-block is-${block.block_type}`}><span>{block.block_type === "key_point" ? "Key point" : "Lesson"}</span><CrewRichContent html={richBlock(block)} />{block.payload?.media ? <CrewLearningImage token={token} media={block.payload.media} /> : null}</article>
        ),
      )}
      {activeLesson?.quiz && (
        <section className="crew-quiz">
          <div><span className="crew-learning-kicker">Knowledge check</span><h3>{activeLesson.quiz.title}</h3><p>Pass score: {activeLesson.quiz.passing_score}%</p></div>
          {activeLesson.quiz.questions?.map((question, index) => (
            <fieldset key={question.id}>
              <legend>{index + 1}. {question.prompt}</legend>
              <small>{question.question_type === "multiple_choice" ? "Select all that apply" : "Select one answer"}</small>
              {question.options?.map((option) => (
                <label key={option.id} className={answers[question.id]?.includes(option.id) ? "is-selected" : ""}>
                  <input type={question.question_type === "multiple_choice" ? "checkbox" : "radio"} name={question.id} checked={Boolean(answers[question.id]?.includes(option.id))} onChange={() => onChoose(question, option.id)} />{option.label}
                </label>
              ))}
            </fieldset>
          ))}
          {result ? <div className={result.passed ? "crew-quiz-result is-pass" : "crew-quiz-result is-retry"}><strong>{result.passed ? "Passed" : "Try again"}</strong><span>{result.score}% · Attempt {result.attempt_number}</span></div> : <button className="crew-mobile-primary" disabled={saving} onClick={onSubmitQuiz}>{saving ? "Checking…" : "Submit quiz"}</button>}
        </section>
      )}
      {error && <p className="crew-mobile-error">{error}</p>}
      <button className="crew-mobile-primary crew-complete-lesson" disabled={saving || Boolean(activeLesson?.locked)} onClick={onComplete}>{lesson.completed ? "Completed" : saving ? "Saving…" : "Complete lesson"}</button>
    </section>
  );
}
