import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";
import {
  BookOpenCheck,
  CircleAlert,
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
import CrewLearnHome, { CrewLearnHero } from "./CrewLearnHome.jsx";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { CrewProgressBar, CrewSectionHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";
import FeedXLoadingMark from "./FeedXLoadingMark.jsx";
import { plainTextToSopHtml } from "../utils/sopDocumentContent.js";
import { applyOnboardingLocalization, applySopLocalization } from "../utils/localizedContent.js";
import { formatCrewDate, formatCrewTime } from "../utils/crewI18n.js";
import onboardingJourneyHero from "../../../assets/crew/onboarding-journey-hero-approved.webp";

const learnHomeCache = new Map();

function learnCacheKey(token, language) {
  return `${token}:${language}`;
}

function onboardingJourneyDescription(description) {
  return String(description || "")
    .replace(/\s*FeedX Crew Onboarding Full Demo\s*·\s*Staging only\s*/i, "")
    .trim();
}

export function resetCrewLearnCacheForTests() {
  learnHomeCache.clear();
}

function plainBlock(block) {
  const payload = block?.payload || {};
  return payload.body || payload.text || payload.content || payload.title || "";
}

function richBlock(block) {
  return block?.payload?.body_html || plainTextToSopHtml(plainBlock(block));
}

export default function CrewLearningMobile({ token }) {
  const { t, i18n } = useTranslation();
  const initialLanguage = i18n.resolvedLanguage || i18n.language || "en";
  const initialCache = learnHomeCache.get(learnCacheKey(token, initialLanguage));
  const [home, setHome] = useState(() => initialCache?.home || null);
  const [assignment, setAssignment] = useState(() => initialCache?.assignment || null);
  const [library, setLibrary] = useState(() => initialCache?.library || { categories: [], sops: [] });
  const [screen, setScreen] = useState("home");
  const [lesson, setLesson] = useState(null);
  const [sop, setSop] = useState(null);
  const [sopLanguage, setSopLanguage] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(() => !initialCache);
  const [showLoadingMark, setShowLoadingMark] = useState(false);
  const [assignmentLoading, setAssignmentLoading] = useState(() => Boolean(initialCache?.home?.assignment?.id && !initialCache?.assignment));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const loadVersionRef = useRef(0);

  const activeLesson = useMemo(
    () =>
      lesson &&
      assignment?.modules
        ?.flatMap((module) => module.lessons || [])
        .find((item) => item.lesson?.id === lesson.lesson?.id),
    [assignment, lesson],
  );

  async function loadHome() {
    const loadVersion = ++loadVersionRef.current;
    const language = i18n.resolvedLanguage || i18n.language || "en";
    const cacheKey = learnCacheKey(token, language);
    const cached = learnHomeCache.get(cacheKey);
    setLoading(!cached);
    setHome(cached?.home || null);
    setLibrary(cached?.library || { categories: [], sops: [] });
    setAssignment(cached?.assignment || null);
    setAssignmentLoading(Boolean(cached?.home?.assignment?.id && !cached?.assignment));
    setError("");
    try {
      const [nextHome, nextLibrary] = await Promise.all([
        crewService.learningHome(token),
        crewService.sopLibrary(token),
      ]);
      if (loadVersion !== loadVersionRef.current) return;
      const retainedAssignment = cached?.assignment?.id === nextHome?.assignment?.id ? cached.assignment : null;
      setHome(nextHome);
      setLibrary(nextLibrary || { categories: [], sops: [] });
      setAssignment(retainedAssignment);
      setLoading(false);
      learnHomeCache.set(cacheKey, { home: nextHome, library: nextLibrary || { categories: [], sops: [] }, assignment: retainedAssignment });

      const sopVersionIds = (nextLibrary?.sops || []).map((item) => item.version_id).filter(Boolean);
      void crewService.localizedContentForCrew(token, "sop", sopVersionIds, language).catch(() => ({})).then((sopLocalizations) => {
        if (loadVersion !== loadVersionRef.current) return;
        setLibrary({
          ...nextLibrary,
          sops: (nextLibrary?.sops || []).map((item) => ({
            ...item,
            title: sopLocalizations[item.version_id]?.["sop.title"] || item.title,
          })),
        });
        const current = learnHomeCache.get(cacheKey);
        if (current) learnHomeCache.set(cacheKey, {
          ...current,
          library: {
            ...nextLibrary,
            sops: (nextLibrary?.sops || []).map((item) => ({
              ...item,
              title: sopLocalizations[item.version_id]?.["sop.title"] || item.title,
            })),
          },
        });
      });

      if (nextHome?.assignment?.id) {
        setAssignmentLoading(!retainedAssignment);
        void crewService.learningAssignment(token, nextHome.assignment.id).then(async (nextAssignment) => {
          const journeyId = nextAssignment?.journey?.id;
          const journeyLocalizations = journeyId
            ? await crewService.localizedContentForCrew(token, "onboarding", [journeyId], language).catch(() => ({}))
            : {};
          if (loadVersion !== loadVersionRef.current) return;
          const localizedAssignment = applyOnboardingLocalization(nextAssignment, journeyLocalizations[journeyId] || {});
          setAssignment(localizedAssignment);
          const current = learnHomeCache.get(cacheKey);
          if (current) learnHomeCache.set(cacheKey, { ...current, assignment: localizedAssignment });
        }).catch((cause) => {
          if (loadVersion === loadVersionRef.current) setError(cause.message || t("learn.unable"));
        }).finally(() => {
          if (loadVersion === loadVersionRef.current) setAssignmentLoading(false);
        });
      }
    } catch (cause) {
      if (loadVersion !== loadVersionRef.current) return;
      setError(cause.message || t("learn.unable"));
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadHome();
    return () => { loadVersionRef.current += 1; };
  }, [token, i18n.resolvedLanguage]);

  useEffect(() => {
    if (!loading) {
      setShowLoadingMark(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setShowLoadingMark(true), 300);
    return () => window.clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    if (screen !== "sop" && screen !== "lesson-sop") return;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [screen, sop?.id]);

  useEffect(() => {
    const language = i18n.resolvedLanguage || i18n.language || "en";
    if (!sop?.id || sopLanguage === language) return undefined;
    let active = true;
    Promise.all([
      crewService.sopVersion(token, sop.id),
      crewService.localizedContentForCrew(token, "sop", [sop.id], language).catch(() => ({})),
    ]).then(([nextSop, localized]) => {
      if (active) {
        setSop(applySopLocalization(nextSop, localized[sop.id] || {}));
        setSopLanguage(language);
      }
    }).catch((cause) => active && setError(cause.message || "This SOP is unavailable."));
    return () => { active = false; };
  }, [token, sop?.id, sopLanguage, i18n.resolvedLanguage, i18n.language]);

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
      const nextSop = await crewService.sopVersion(token, versionId);
      const language = i18n.resolvedLanguage || i18n.language || "en";
      const localized = await crewService.localizedContentForCrew(token, "sop", [versionId], language).catch(() => ({}));
      setSop(applySopLocalization(nextSop, localized[versionId] || {}));
      setSopLanguage(language);
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
      const acknowledgement = await crewService.acknowledgeSop(
        token,
        sop.id,
        screen === "lesson-sop" ? "journey" : "direct_library",
      );
      const acknowledgedAt = acknowledgement?.acknowledged_at || sop.acknowledged_at || null;
      setSop({ ...sop, acknowledged: true, acknowledged_at: acknowledgedAt });
      setLibrary((current) => ({
        ...current,
        sops: current.sops.map((item) =>
          item.version_id === sop.id ? { ...item, acknowledged: true, acknowledged_at: acknowledgedAt } : item,
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
    return <CrewLearnLoadingShell showLoadingMark={showLoadingMark} />;
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
      assignmentLoading={assignmentLoading}
      library={library}
      error={error}
      onOpenOnboarding={() => setScreen("onboarding")}
      onOpenSop={(versionId) => openSop(versionId, "home")}
    />
  );
}

function CrewLearnLoadingShell({ showLoadingMark }) {
  return (
    <section className="crew-learn-final-home crew-learn-loading-shell" aria-busy="true">
      <CrewLearnHero />
      {showLoadingMark && <div className="crew-learn-loading-indicator"><FeedXLoadingMark label="Loading Learn content" /></div>}
    </section>
  );
}

function onboardingModuleState(module) {
  if (module.completed) return "completed";
  if (module.locked) return "locked";
  return module.status === "in_progress" || Number(module.progress_percentage) > 0 ? "in-progress" : "available";
}

function onboardingModuleProgress(module) {
  const lessons = module.lessons || [];
  const requiredLessons = lessons.filter((item) => item.required !== false);
  const scopedLessons = requiredLessons.length ? requiredLessons : lessons;
  return {
    completed: scopedLessons.filter((item) => item.completed).length,
    total: scopedLessons.length,
  };
}

function OnboardingDetail({ assignment, home, error, onBack, onOpenLesson }) {
  const { t } = useTranslation();
  if (!assignment) {
    return (
      <section className="crew-learning-empty">
        <CrewMobileDetailHeader title={t("learn.title")} onBack={onBack} />
        <ClipboardCheck size={28} />
        <h2>{t("learn.onboardingPending")}</h2>
        <p>{t("learn.onboardingPendingBody")}</p>
      </section>
    );
  }
  const journeyDescription = assignment.status === "completed"
    ? t("learn.completedReview")
    : onboardingJourneyDescription(assignment.journey?.description);
  return (
    <section className="crew-learning-home">
      <CrewMobileDetailHeader title={t("learn.title")} onBack={onBack} />
      {error && <p className="crew-mobile-error">{error}</p>}
      <article className="crew-learning-journey-hero crew-ui-functional-surface">
        <img className="crew-learning-journey-art" src={onboardingJourneyHero} alt="" aria-hidden="true" />
        <CrewStatusBadge tone="mint">{t("learn.mandatory")}</CrewStatusBadge>
        <h2>{assignment.journey?.name || "New Crew Onboarding"}</h2>
        {journeyDescription && <p>{journeyDescription}</p>}
        <div className="crew-learning-journey-progress">
          <strong><b>{home?.assignment?.lessons_completed || 0}</b><span className="crew-learning-journey-progress-total">{t("learn.journeyProgressOf", { total: home?.assignment?.lessons_total || 0 })}</span><small>{t("learn.journeyProgressCompleted")}</small></strong>
          <CrewProgressBar value={home?.assignment?.progress_percentage || 0} />
        </div>
      </article>
      <CrewSectionHeader title={<><span>{t("learn.modulesTitle")}</span>{" "}<span className="crew-ui-count crew-learning-modules-count">{assignment.modules?.length || 0}</span></>} />
      {assignment.modules?.map((module, index) => {
        const state = onboardingModuleState(module);
        const progress = onboardingModuleProgress(module);
        const currentLessonId = state === "in-progress"
          ? module.lessons?.find((item) => !item.completed && !item.locked)?.lesson?.id
          : null;
        return (
        <section className={`crew-learning-module crew-ui-functional-surface is-${state}`} key={module.module?.id}>
          <div className={`crew-module-head is-${state}`}>
            <span className="crew-module-order">{String(index + 1).padStart(2, "0")}</span>
            <div><h3>{module.module?.title}</h3><p className="crew-module-progress">{state === "completed" && <CheckCircle2 size={14} aria-hidden="true" />}{state === "completed" ? t("status.completed") : t("learn.moduleProgress", progress)}</p></div>
            {state !== "completed" && <span className={state === "locked" ? "crew-ui-icon-container crew-ui-icon-container--compact is-locked" : state === "in-progress" ? "crew-ui-icon-container crew-ui-icon-container--compact is-active" : "crew-ui-icon-container crew-ui-icon-container--compact"}>{state === "locked" ? <LockKeyhole size={16} /> : <BookOpenCheck size={17} />}</span>}
          </div>
          {state !== "completed" && <CrewProgressBar value={module.progress_percentage} />}
          {module.lessons?.map((item) => (
            <button key={item.lesson?.id} className={`crew-lesson-row${item.locked ? " is-locked" : ""}${item.lesson?.id === currentLessonId ? " is-current" : ""}`} disabled={item.locked} onClick={() => onOpenLesson({ ...item, moduleTitle: module.module?.title })}>
              <span className={item.completed ? "crew-lesson-marker is-success" : item.locked ? "crew-lesson-marker is-locked" : "crew-lesson-marker"}>{item.completed ? <CheckCircle2 size={16} /> : item.locked ? <LockKeyhole size={15} /> : <PlayCircle size={16} />}</span>
              <span><strong>{item.lesson?.title}</strong><small>{item.completed ? t("status.completed") : item.locked ? t("learn.completeEarlier") : t("learn.readyLearn")}</small></span>
              <ChevronRight size={17} />
            </button>
          ))}
        </section>
        );
      })}
    </section>
  );
}


function SopReader({ token, sop, saving, error, onBack, onAcknowledge }) {
  const { t } = useTranslation();
  if (!sop) return null;
  const acknowledgedAt = sop.acknowledged_at
    ? `${formatCrewDate(sop.acknowledged_at, { day: "numeric", month: "short", year: "numeric" })} · ${formatCrewTime(sop.acknowledged_at).toLowerCase()}`
    : "";
  const acknowledgement = sop.acknowledgement_required
    ? sop.acknowledged ? t("learn.acknowledged") : t("learn.acknowledgementRequired")
    : t("learn.noAcknowledgement");
  return (
    <section className="crew-learning-reader">
      <CrewMobileDetailHeader title={sop.title} onBack={onBack} className="crew-sop-mobile-nav" />
      <header className="crew-sop-mobile-intro">
        <div className="crew-sop-mobile-meta" aria-label={t("learn.metadata")}>
          <span className="crew-sop-mobile-meta-context"><CrewStatusBadge>{sop.category || "Other"}</CrewStatusBadge><CrewStatusBadge>v{sop.version}</CrewStatusBadge></span>
          <CrewStatusBadge tone={sop.acknowledged ? "success" : sop.acknowledgement_required ? "warning" : "neutral"}>{acknowledgement}</CrewStatusBadge>
        </div>
        {(sop.summary || sop.change_summary) && <p className="crew-learning-summary">{sop.summary || sop.change_summary}</p>}
      </header>
      <CrewSopDocument sections={sop.sections} token={token} sopVersionId={sop.id} className="is-mobile" />
      {error && <p className="crew-mobile-error">{error}</p>}
      {sop.acknowledgement_required && (
        sop.acknowledged
          ? (
            <div className="crew-ui-note crew-sop-acknowledged" role="status" aria-label={t("learn.acknowledgedTitle")}>
              <span className="crew-ui-icon-container crew-sop-acknowledged-icon" aria-hidden="true"><CheckCircle2 size={20} /></span>
              <span>
                <strong>{t("learn.acknowledgedTitle")}</strong>
                {acknowledgedAt && <small>{t("learn.acknowledgedAt", { timestamp: acknowledgedAt })}</small>}
              </span>
            </div>
          )
          : <div className="crew-sop-acknowledgement-action"><button className="crew-mobile-primary" disabled={saving} onClick={onAcknowledge}>{saving ? t("common.saving") : t("learn.acknowledge")}</button></div>
      )}
    </section>
  );
}

function LessonReader({ token, lesson, activeLesson, answers, result, saving, error, onBack, onOpenSop, onChoose, onSubmitQuiz, onComplete }) {
  const { t } = useTranslation();
  return (
    <section className="crew-learning-reader">
      <CrewMobileDetailHeader title={t("learn.onboarding")} onBack={onBack} />
      <header className="crew-learning-lesson-header">
        <span className="crew-learning-context">{lesson.moduleTitle || t("learn.moduleLesson")}</span>
        <h2>{lesson.lesson.title}</h2>
        <p className="crew-learning-summary">{lesson.lesson.estimated_minutes ? t("learn.minutes", { count: lesson.lesson.estimated_minutes }) : t("learn.ownPace")}</p>
      </header>
      {lesson.blocks?.map((block) =>
        block.block_type === "sop_reference" ? (
          <button key={block.id} className="crew-learning-sop-reference crew-ui-functional-surface" onClick={() => onOpenSop(block.payload?.sop_version_id)}>
            <span className="crew-ui-icon-container crew-ui-icon-container--compact"><FileText size={17} /></span><span><strong>{block.payload?.title || t("learn.requiredSop")}</strong><small>{t("learn.version", { version: block.payload?.version || "—" })}{block.payload?.required_acknowledgement ? ` · ${t("learn.acknowledgementRequired")}` : ""}</small></span><ChevronRight size={18} />
          </button>
        ) : (
          <article key={block.id} className={block.block_type === "key_point" ? "crew-learning-content-block crew-ui-note crew-ui-note--mint is-key-point" : "crew-learning-content-block crew-ui-functional-surface"}>{block.block_type === "key_point" && <CircleAlert size={17} aria-hidden="true" />}<span><strong>{block.block_type === "key_point" ? t("tasks.types.key_point") : t("learn.lesson")}</strong><CrewRichContent html={richBlock(block)} />{block.payload?.media ? <CrewLearningImage token={token} media={block.payload.media} /> : null}</span></article>
        ),
      )}
      {activeLesson?.quiz && (
        <section className="crew-quiz">
          <div className="crew-learning-quiz-header"><span className="crew-learning-section-label">{t("learn.knowledgeCheck")}</span><h3>{activeLesson.quiz.title}</h3><p>{t("learn.passScore", { score: activeLesson.quiz.passing_score })}</p></div>
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
      {lesson.completed ? <div className="crew-learning-completed crew-ui-note crew-ui-note--mint" role="status"><span className="crew-ui-icon-container crew-ui-icon-container--small is-success"><CheckCircle2 size={16} /></span><span><strong>{t("status.completed")}</strong></span></div> : <button className="crew-mobile-primary crew-complete-lesson" disabled={saving || Boolean(activeLesson?.locked)} onClick={onComplete}>{saving ? t("common.saving") : t("learn.completeLesson")}</button>}
    </section>
  );
}
