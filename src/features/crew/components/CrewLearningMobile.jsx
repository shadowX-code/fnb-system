import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";
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
import CrewSopDocument from "./CrewSopDocument.jsx";
import CrewLearnHome from "./CrewLearnHome.jsx";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
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
  const { t } = useTranslation();
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
      setError(cause.message || t("learn.unable"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHome();
  }, [token]);

  useEffect(() => {
    if (screen !== "sop" && screen !== "lesson-sop") return;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [screen, sop?.id]);

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
      setError(cause.message || t("errors.acknowledgeSop"));
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
        {t("learn.loading")}
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
  const { t } = useTranslation();
  if (!assignment) {
    return (
      <section className="crew-learning-empty">
        <button className="crew-learning-back" onClick={onBack}><ArrowLeft size={17} /> {t("learn.title")}</button>
        <ClipboardCheck size={28} />
        <h2>{t("learn.onboardingPending")}</h2>
        <p>{t("learn.onboardingPendingBody")}</p>
      </section>
    );
  }
  return (
    <section className="crew-learning-home">
      <button className="crew-learning-back" onClick={onBack}><ArrowLeft size={17} /> {t("learn.title")}</button>
      {error && <p className="crew-mobile-error">{error}</p>}
      <div className="crew-learning-hero">
        <span>{t("learn.mandatory")}</span>
        <h2>{assignment.journey?.name || "New Crew Onboarding"}</h2>
        <p>{assignment.status === "completed" ? t("learn.completedReview") : assignment.journey?.description}</p>
        <div>
          <strong>{home?.assignment?.lessons_completed || 0}/{home?.assignment?.lessons_total || 0}</strong>
          <Progress value={home?.assignment?.progress_percentage || 0} />
        </div>
      </div>
      <div className="crew-learning-section-title"><h2>{t("learn.modulesTitle")}</h2><span>{assignment.modules?.length || 0}</span></div>
      {assignment.modules?.map((module, index) => (
        <section className={module.locked ? "crew-learning-module is-locked" : "crew-learning-module"} key={module.module?.id}>
          <div className="crew-module-head">
            <span className="crew-module-order">{String(index + 1).padStart(2, "0")}</span>
            <div><h3>{module.module?.title}</h3><p>{t("learn.percentComplete", { count: module.progress_percentage })}</p></div>
            {module.completed ? <CheckCircle2 size={20} /> : module.locked ? <LockKeyhole size={18} /> : <BookOpenCheck size={20} />}
          </div>
          <Progress value={module.progress_percentage} />
          {module.lessons?.map((item) => (
            <button key={item.lesson?.id} className={item.locked ? "crew-lesson-row is-locked" : "crew-lesson-row"} disabled={item.locked} onClick={() => onOpenLesson({ ...item, moduleTitle: module.module?.title })}>
              <span className="crew-lesson-marker">{item.completed ? <CheckCircle2 size={16} /> : item.locked ? <LockKeyhole size={15} /> : <PlayCircle size={16} />}</span>
              <span><strong>{item.lesson?.title}</strong><small>{item.completed ? t("learn.completedReview") : item.locked ? t("learn.completeEarlier") : item.quiz?.required ? t("learn.lessonQuiz") : t("learn.readyLearn")}</small></span>
              <ChevronRight size={17} />
            </button>
          ))}
        </section>
      ))}
    </section>
  );
}


function SopReader({ token, sop, saving, error, onBack, onAcknowledge }) {
  const { t } = useTranslation();
  if (!sop) return null;
  const acknowledgement = sop.acknowledgement_required
    ? sop.acknowledged ? t("learn.acknowledged") : t("learn.acknowledgementRequired")
    : t("learn.noAcknowledgement");
  return (
    <section className="crew-learning-reader">
      <CrewMobileDetailHeader title={sop.title} onBack={onBack} className="crew-sop-mobile-nav" />
      <header className="crew-sop-mobile-intro">
        <div className="crew-sop-mobile-meta" aria-label={t("learn.metadata")}>
          <span>{sop.category || "Other"}</span>
          <span>v{sop.version}</span>
          <span className={sop.acknowledged ? "is-acknowledged" : ""}>{acknowledgement}</span>
        </div>
        <h2>{sop.title}</h2>
        {(sop.summary || sop.change_summary) && <p className="crew-learning-summary">{sop.summary || sop.change_summary}</p>}
      </header>
      <CrewSopDocument sections={sop.sections} token={token} sopVersionId={sop.id} className="is-mobile" />
      {error && <p className="crew-mobile-error">{error}</p>}
      {sop.acknowledgement_required && (
        sop.acknowledged
          ? (
            <div className="crew-sop-acknowledged" role="status" aria-label={t("learn.acknowledgedTitle")}>
              <span className="crew-sop-acknowledged-icon" aria-hidden="true"><CheckCircle2 size={20} /></span>
              <span>
                <strong>{t("learn.acknowledgedTitle")}</strong>
                <small>{t("learn.acknowledgedBody", { version: sop.version })}</small>
              </span>
            </div>
          )
          : <button className="crew-mobile-primary" disabled={saving} onClick={onAcknowledge}>{saving ? t("common.saving") : t("learn.acknowledge")}</button>
      )}
    </section>
  );
}

function LessonReader({ token, lesson, activeLesson, answers, result, saving, error, onBack, onOpenSop, onChoose, onSubmitQuiz, onComplete }) {
  const { t } = useTranslation();
  return (
    <section className="crew-learning-reader">
      <button className="crew-learning-back" onClick={onBack}><ArrowLeft size={17} /> {t("learn.onboarding")}</button>
      <span className="crew-learning-kicker">{lesson.moduleTitle || t("learn.moduleLesson")}</span>
      <h2>{lesson.lesson.title}</h2>
      <p className="crew-learning-summary">{lesson.lesson.estimated_minutes ? t("learn.minutes", { count: lesson.lesson.estimated_minutes }) : t("learn.ownPace")}</p>
      {lesson.blocks?.map((block) =>
        block.block_type === "sop_reference" ? (
          <button key={block.id} className="crew-sop-link" onClick={() => onOpenSop(block.payload?.sop_version_id)}>
            <FileText size={18} /><span><strong>{block.payload?.title || t("learn.requiredSop")}</strong><small>{t("learn.version", { version: block.payload?.version || "—" })}{block.payload?.required_acknowledgement ? ` · ${t("learn.acknowledgementRequired")}` : ""}</small></span><ChevronRight size={18} />
          </button>
        ) : (
          <article key={block.id} className={`crew-content-block is-${block.block_type}`}><span>{block.block_type === "key_point" ? t("tasks.types.key_point") : t("learn.lesson")}</span><CrewRichContent html={richBlock(block)} />{block.payload?.media ? <CrewLearningImage token={token} media={block.payload.media} /> : null}</article>
        ),
      )}
      {activeLesson?.quiz && (
        <section className="crew-quiz">
          <div><span className="crew-learning-kicker">{t("learn.knowledgeCheck")}</span><h3>{activeLesson.quiz.title}</h3><p>{t("learn.passScore", { score: activeLesson.quiz.passing_score })}</p></div>
          {activeLesson.quiz.questions?.map((question, index) => (
            <fieldset key={question.id}>
              <legend>{index + 1}. {question.prompt}</legend>
              <small>{question.question_type === "multiple_choice" ? t("learn.selectAll") : t("learn.selectOne")}</small>
              {question.options?.map((option) => (
                <label key={option.id} className={answers[question.id]?.includes(option.id) ? "is-selected" : ""}>
                  <input type={question.question_type === "multiple_choice" ? "checkbox" : "radio"} name={question.id} checked={Boolean(answers[question.id]?.includes(option.id))} onChange={() => onChoose(question, option.id)} />{option.label}
                </label>
              ))}
            </fieldset>
          ))}
          {result ? <div className={result.passed ? "crew-quiz-result is-pass" : "crew-quiz-result is-retry"}><strong>{result.passed ? t("learn.passed") : t("common.retry")}</strong><span>{result.score}% · {t("learn.attempt", { number: result.attempt_number })}</span></div> : <button className="crew-mobile-primary" disabled={saving} onClick={onSubmitQuiz}>{saving ? t("learn.checking") : t("learn.submitQuiz")}</button>}
        </section>
      )}
      {error && <p className="crew-mobile-error">{error}</p>}
      <button className="crew-mobile-primary crew-complete-lesson" disabled={saving || Boolean(activeLesson?.locked)} onClick={onComplete}>{lesson.completed ? t("status.completed") : saving ? t("common.saving") : t("learn.completeLesson")}</button>
    </section>
  );
}
