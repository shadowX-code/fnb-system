import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./CrewGrowthMobile.css";
import "./CrewPerformanceComponentModal.css";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import "../../../i18n/index.js";
import {
  ArrowUpRight,
  Award,
  BadgeCheck,
  BookOpenCheck,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleHelp,
  Clock3,
  ShieldCheck,
  SmilePlus,
  Sparkles,
  Star,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CrewMobilePageHeader, CrewSectionHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import { CrewHelpSheet, CrewHelpTrigger } from "./CrewHelp.jsx";
import { formatCrewDate, translateStatus } from "../utils/crewI18n.js";
import { getPerformanceScoreComparison } from "../utils/performanceTrend.js";
import growthPerformanceHeroBackground from "../assets/growth-performance-hero-approved.webp";
import performanceDetailHeroBackground from "../assets/performance-detail-hero-approved.webp";

gsap.registerPlugin(useGSAP);

const statusCopy = {
  certified: "Certified",
  in_progress: "In Progress",
  ready_for_review: "Ready for Review",
  not_started: "Not Started",
  needs_renewal: "Ready for Review",
  expired: "Expired",
};

const statusTone = (status) => status === "certified" ? "success" : ["ready_for_review", "needs_renewal"].includes(status) ? "ready" : status === "in_progress" ? "info" : "neutral";
const percentFor = (skill) => {
  const total = Number(skill?.requirements_total) || 0;
  return total ? Math.round(((Number(skill?.requirements_completed) || 0) / total) * 100) : 0;
};
const formatDate = (value) => formatCrewDate(value, { day: "numeric", month: "short", year: "numeric" });

function ProgressBar({ value }) {
  return <div className="crew-ui-linear-progress" aria-label={`${value}% complete`}><span style={{ width: `${value}%` }} /></div>;
}

function PageHeader({ title, subtitle, onBack, action }) {
  if (onBack) return <CrewMobileDetailHeader title={title} onBack={onBack} action={action} />;
  if (subtitle) return <CrewMobilePageHeader title={title} subtitle={subtitle} action={action} />;
  return <CrewMobilePageHeader title={title} action={action} />;
}

function GrowthHelpSheet({ onClose }) {
  const { t } = useTranslation();
  return <CrewHelpSheet title={t("growth.about")} onClose={onClose}>
    <section className="crew-ui-help-section"><strong>{t("growth.skills")}</strong><p>{t("growth.helpSkills")}</p></section>
    <section className="crew-ui-help-section"><strong>{t("growth.readyForReview")}</strong><p>{t("growth.helpReview")}</p></section>
    <section className="crew-ui-help-section"><strong>{t("growth.performance")}</strong><p>{t("growth.helpPerformance")}</p></section>
  </CrewHelpSheet>;
}

const performanceLevel = (score, t) => {
  if (score == null || Number.isNaN(Number(score))) return t("performance.awaitingData");
  if (score >= 95) return t("reward.levels.outstanding");
  if (score >= 90) return t("reward.levels.excellent");
  if (score >= 85) return t("reward.levels.strong");
  if (score >= 80) return t("status.good");
  if (score >= 75) return t("reward.levels.meetsStandard");
  if (score >= 70) return t("reward.levels.developing");
  return t("reward.levels.belowStandard");
};

const skillSummaryCards = [
  { key: "certified", icon: BadgeCheck, tone: "success" },
  { key: "in_progress", icon: Clock3, tone: "info" },
  { key: "ready_for_review", icon: Star, tone: "warning" },
  { key: "not_started", icon: Circle },
];

function GrowthSkillSummary({ summary }) {
  const { t } = useTranslation();
  return <section className="crew-growth-overview-summary" aria-label={t("growth.skillsOverview")}>
    <CrewSectionHeader title={t("growth.skillsOverview")} />
    <div className="crew-growth-overview-metrics">
      {skillSummaryCards.map(({ key, icon: Icon, tone }) => <article key={key}>
        <i className={`crew-ui-icon-container crew-ui-icon-container--micro${tone ? ` is-${tone}` : ""}`}><Icon size={12} /></i>
        <strong>{summary?.[key] || 0}</strong>
        <span>{translateStatus(key, t)}</span>
      </article>)}
    </div>
  </section>;
}

function GrowthPerformanceScore({ score, label }) {
  const root = useRef(null);
  const scoreLabel = useRef(null);
  const previousScore = useRef(Number.isFinite(Number(score)) ? Math.max(0, Math.min(100, Math.round(Number(score)))) : 0);
  const hasAnimated = useRef(false);
  const initialFrame = useRef(null);
  const gradientId = `crew-growth-score-gradient-${useId().replaceAll(":", "")}`;
  const segmentIndexes = useMemo(() => Array.from({ length: 100 }, (_, index) => index), []);
  const safeScore = Number.isFinite(Number(score)) ? Math.max(0, Math.min(100, Math.round(Number(score)))) : 0;

  useGSAP(() => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const segments = Array.from(root.current?.querySelectorAll(".crew-growth-performance-segment") || []);
    const isInitialPresentation = !hasAnimated.current;
    const priorScore = isInitialPresentation ? 0 : previousScore.current;
    const newlyActive = safeScore > priorScore ? segments.slice(priorScore, safeScore) : [];
    const newlyInactive = safeScore < priorScore ? segments.slice(safeScore, priorScore) : [];

    if (reducedMotion || !segments.length) {
      previousScore.current = safeScore;
      hasAnimated.current = true;
      if (scoreLabel.current) scoreLabel.current.textContent = String(score == null ? "—" : safeScore);
      return undefined;
    }

    const entrance = gsap.timeline();
    if (score == null) {
      if (scoreLabel.current) scoreLabel.current.textContent = "—";
    } else {
      const scoreValue = { value: priorScore };
      if (scoreLabel.current) scoreLabel.current.textContent = String(priorScore);
      entrance.to(scoreValue, {
        value: safeScore,
        duration: isInitialPresentation ? 0.86 : 0.46,
        ease: "power2.out",
        onUpdate: () => {
          if (scoreLabel.current) scoreLabel.current.textContent = String(Math.round(scoreValue.value));
        },
      }, 0);
    }
    if (newlyActive.length) {
      entrance.set(newlyActive, { opacity: 0.1 }, 0).to(newlyActive, {
        opacity: 1,
        duration: 0.38,
        ease: "power2.out",
        stagger: { each: 0.006, from: "start" },
      }, 0);
    }
    if (newlyInactive.length) {
      entrance.to(newlyInactive, {
        opacity: 0.42,
        duration: 0.22,
        ease: "power1.out",
        stagger: { each: 0.0035, from: "end" },
      }, 0);
    }

    const highlightSegments = Array.from(root.current?.querySelectorAll(".crew-growth-performance-highlight-segment") || []);
    const sweepSpan = Math.min(7, Math.max(0, highlightSegments.length - 1));
    const maxSweepStart = Math.max(0, highlightSegments.length - sweepSpan - 1);
    const applySweep = (startIndex) => {
      highlightSegments.forEach((segment, index) => {
        const distance = index - startIndex;
        const opacity = distance < 0 || distance > sweepSpan ? 0 : 0.24 + (distance / Math.max(sweepSpan, 1)) * 0.76;
        gsap.set(segment, { opacity });
      });
    };
    const sweepState = { index: 0 };
    const idleSweep = highlightSegments.length > 1
      ? gsap.timeline({ delay: 1.25, repeat: -1, repeatDelay: 1.1 })
        .call(() => applySweep(0))
        .to(sweepState, {
          index: maxSweepStart,
          duration: 4.2,
          ease: "none",
          onUpdate: () => applySweep(sweepState.index),
        })
        .set(highlightSegments, { opacity: 0 })
      : null;

    if (isInitialPresentation) {
      initialFrame.current = requestAnimationFrame(() => {
        previousScore.current = safeScore;
        hasAnimated.current = true;
        initialFrame.current = null;
      });
    } else {
      previousScore.current = safeScore;
    }
    return () => {
      if (initialFrame.current) cancelAnimationFrame(initialFrame.current);
      entrance.kill();
      idleSweep?.kill();
    };
  }, { scope: root, dependencies: [safeScore], revertOnUpdate: true });

  return <div ref={root} className="crew-growth-performance-score" aria-label={label}>
    <svg className="crew-growth-performance-score-ring" viewBox="0 0 160 160" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="22" y1="22" x2="138" y2="138" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--crew-color-cyan)" />
          <stop offset="1" stopColor="var(--crew-color-mist-mint)" />
        </linearGradient>
      </defs>
      <circle className="crew-growth-performance-calibration" cx="80" cy="80" r="72" />
      <g className="crew-growth-performance-segments">
        {segmentIndexes.map((index) => <line
          key={index}
          className={`crew-growth-performance-segment${index < safeScore ? " is-active" : ""}`}
          x1="80"
          y1="11"
          x2="80"
          y2="17"
          transform={`rotate(${index * 3.6 - 90} 80 80)`}
          stroke={index < safeScore ? `url(#${gradientId})` : undefined}
        />)}
      </g>
      <g className="crew-growth-performance-highlight" aria-hidden="true">
        {segmentIndexes.slice(0, safeScore).map((index) => <line
          key={index}
          className="crew-growth-performance-highlight-segment"
          x1="80"
          y1="11"
          x2="80"
          y2="17"
          transform={`rotate(${index * 3.6 - 90} 80 80)`}
          stroke={`url(#${gradientId})`}
        />)}
      </g>
    </svg>
    <span className="crew-growth-performance-score-readout"><strong ref={scoreLabel}>{score == null ? "—" : safeScore}</strong><b>/100</b></span>
  </div>;
}

function GrowthPerformanceHero({ performance, onOpen }) {
  const { t } = useTranslation();
  const score = performance?.score == null ? null : Math.round(Number(performance.score));
  const comparison = getPerformanceScoreComparison(performance);
  const trendCopy = comparison
    ? { value: comparison.direction === "up" ? t("performance.trendUp", { points: comparison.points }) : comparison.direction === "down" ? t("performance.trendDown", { points: comparison.points }) : t("performance.trendNoChange"), context: t("performance.vsPreviousPeriod") }
    : { value: t("growth.noTrend"), context: null };
  const TrendIcon = comparison?.direction === "down" ? TrendingDown : comparison?.direction === "neutral" ? null : TrendingUp;
  return <article className="crew-growth-performance-hero" style={{ "--crew-growth-performance-background": `url(${growthPerformanceHeroBackground})` }}>
    <div className="crew-growth-performance-copy">
      <small>{t("growth.performance")}</small>
      <h2>{performanceLevel(score, t)}</h2>
      <p>{t("growth.thisMonth")}</p>
      <span className={`crew-growth-performance-trend is-${comparison?.direction || "neutral"}`}>{TrendIcon ? <TrendIcon size={17} aria-hidden="true" /> : <i aria-hidden="true">—</i>}<span><strong>{trendCopy.value}</strong>{trendCopy.context ? <small>{trendCopy.context}</small> : null}</span></span>
      <button type="button" className="crew-mobile-secondary" onClick={onOpen}>{t("growth.viewPerformance")} <ChevronRight size={18} /></button>
    </div>
    <GrowthPerformanceScore score={score} label={score == null ? t("performance.awaitingData") : `${score} / 100`} />
  </article>;
}

function GrowthSkillList({ skills, onOpen }) {
  const { t } = useTranslation();
  const [descending, setDescending] = useState(false);
  const orderedSkills = useMemo(() => {
    const rank = { ready_for_review: 0, needs_renewal: 0, in_progress: 1, not_started: 2, certified: 3 };
    return [...skills].sort((a, b) => descending ? rank[b.status] - rank[a.status] : rank[a.status] - rank[b.status]);
  }, [descending, skills]);
  return <section className="crew-growth-all-skills" aria-labelledby="crew-growth-all-skills">
    <CrewSectionHeader title={<>{t("growth.allSkillsTitle")} <span className="crew-ui-count">{skills.length}</span></>} action={<><span>{t("growth.sortStatus")}</span><ChevronDown size={17} /></>} actionLabel={t("growth.sortStatus")} onAction={() => setDescending((value) => !value)} />
    <div>{orderedSkills.map((skill) => <button type="button" className="crew-growth-skill-row" key={skill.id} onClick={() => onOpen(skill)}>
      <i className="crew-ui-row-icon"><BookOpenCheck size={19} /></i>
      <span><strong className="crew-list-dense-primary">{skill.name}</strong><small className="crew-list-secondary">{skill.category || t("growth.skills")}</small></span>
      <CrewStatusBadge tone={statusTone(skill.status)}>{translateStatus(skill.status, t)}</CrewStatusBadge>
      <ChevronRight size={18} />
    </button>)}</div>
  </section>;
}

const performanceComponents = (t) => [
  { key: "attendance", label: t("performance.components.attendance"), max: 30, weight: 30, icon: CalendarCheck2, strength: t("performance.strengths.attendance") },
  { key: "service", label: t("performance.components.service"), max: 30, weight: 30, icon: ShieldCheck, strength: t("performance.strengths.service") },
  { key: "customer", label: t("performance.components.customer"), max: 15, weight: 15, icon: SmilePlus, strength: t("performance.strengths.customer") },
  { key: "knowledge", label: t("performance.components.knowledge"), max: 15, weight: 15, icon: BookOpenCheck, strength: t("performance.strengths.knowledge") },
  { key: "conduct", label: t("performance.components.conduct"), max: 10, weight: 10, icon: Star, strength: t("performance.strengths.conduct") },
];

const performanceStatus = (status, t) => status === "finalized" ? t("status.finalized") : status === "draft" ? t("performance.draft") : t("performance.inReview");
const performanceMessage = (score, t) => score >= 95 ? t("performance.messages.excellent") : score >= 85 ? t("performance.messages.strong") : score >= 75 ? t("performance.messages.meets") : score >= 70 ? t("performance.messages.progress") : t("performance.messages.improve");
const monthLabel = (value, style = "long", t) => value ? formatCrewDate(`${value}T00:00:00`, { month: style, year: "numeric" }) : t("growth.thisMonth");

const readableTag = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const asNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const percentLabel = (value, t) => value == null ? t("performanceGuidance.evidenceUnavailable") : `${Math.round(Number(value) * 100)}%`;

function buildComponentGuidance(component, t) {
  const { key, item, value, max } = component;
  const evidence = item?.evidence && typeof item.evidence === "object" && !Array.isArray(item.evidence) ? item.evidence : {};
  const fullScore = value != null && value >= max;
  const criteriaLabel = (criteriaKey) => t(`performanceGuidance.criteria.${criteriaKey}`, { defaultValue: readableTag(criteriaKey) });
  const ratingLabel = (rating) => t(`performanceGuidance.ratings.${rating}`, { defaultValue: readableTag(rating) });
  const criteria = Array.isArray(item?.criteria) ? item.criteria.filter((row) => row?.key && row?.rating) : [];
  const gaps = criteria.filter((row) => row.rating !== "meets_standard");
  const why = [];
  let improve = [];
  let whatCounts = t("performanceGuidance.verifiedEvidencePeriod");
  let cta = null;

  if (key === "attendance") {
    const records = asNumber(evidence.records);
    const completed = asNumber(evidence.completed);
    const incomplete = asNumber(evidence.incomplete);
    const exceptions = asNumber(evidence.location_exceptions);
    const approvedLeave = asNumber(evidence.approved_leave_days);
    if (records != null) why.push({ label: t("performanceGuidance.attendance.records"), value: t("performanceGuidance.attendance.completed", { completed: completed ?? 0, records }), tone: incomplete > 0 ? "warning" : "success" });
    if (incomplete > 0) why.push({ label: t("performanceGuidance.attendance.incomplete"), value: String(incomplete), tone: "warning" });
    if (approvedLeave > 0) why.push({ label: t("performanceGuidance.attendance.approvedLeave"), value: t("performanceGuidance.attendance.daysExcluded", { count: approvedLeave }), tone: "neutral" });
    if (exceptions != null) why.push({ label: t("performanceGuidance.attendance.locationExceptions"), value: t("performanceGuidance.attendance.evidenceFlags", { count: exceptions }), tone: exceptions > 0 ? "warning" : "neutral" });
    improve = fullScore ? [t("performanceGuidance.attendance.maintainComplete")] : [
      incomplete > 0 ? t("performanceGuidance.attendance.completeClock") : t("performanceGuidance.attendance.keepComplete"),
      t("performanceGuidance.attendance.completePeriod"),
      exceptions > 0 ? t("performanceGuidance.attendance.resolveExceptions") : null,
    ].filter(Boolean);
    whatCounts = t("performanceGuidance.attendance.whatCounts");
    cta = { label: t("home.viewAttendance"), action: "attendance" };
  } else if (key === "service" || key === "conduct") {
    criteria.forEach((row) => why.push({ label: criteriaLabel(row.key), value: ratingLabel(row.rating), tone: row.rating === "meets_standard" ? "success" : row.rating === "needs_improvement" ? "warning" : "neutral" }));
    if (!criteria.length) why.push({ label: t("performanceGuidance.reviewStatus"), value: item?.status === "review_required" ? t("status.review_required") : t("performanceGuidance.reviewRecorded"), tone: item?.status === "review_required" ? "warning" : "success" });
    if (fullScore && !gaps.length) improve = [t(key === "service" ? "performanceGuidance.service.keep" : "performanceGuidance.conduct.keep")];
    else if (key === "service") {
      improve = gaps.filter((row) => row.rating === "needs_improvement").map((row) => t(`performanceGuidance.service.${row.key}`)).filter(Boolean).slice(0, 3);
      if (!improve.length) improve = [t("performanceGuidance.service.nextReview")];
    } else {
      improve = gaps.filter((row) => row.rating === "needs_improvement").map((row) => t(`performanceGuidance.conduct.${row.key}`)).filter(Boolean).slice(0, 3);
      if (!improve.length) improve = [t("performanceGuidance.conduct.nextReview")];
    }
    whatCounts = t(key === "service" ? "performanceGuidance.service.whatCounts" : "performanceGuidance.conduct.whatCounts");
    cta = { label: t(key === "service" ? "performanceGuidance.viewSkills" : "performanceGuidance.viewGrowth"), action: key === "service" ? "skills" : "growth" };
  } else if (key === "customer") {
    const samples = asNumber(item?.sample_count) ?? 0;
    const positives = asNumber(item?.positive_count) ?? 0;
    const improvements = asNumber(item?.improvement_count) ?? 0;
    const confidence = item?.confidence;
    why.push({ label: t("performanceGuidance.customer.feedback"), value: t("performanceGuidance.customer.responses", { count: samples }), tone: samples >= 3 ? "success" : "neutral" });
    why.push({ label: t("performanceGuidance.customer.positive"), value: String(positives), tone: "success" });
    if (improvements > 0) why.push({ label: t("performanceGuidance.customer.improvement"), value: String(improvements), tone: "warning" });
    if (confidence !== "established") why.push({ label: t("performanceGuidance.customer.confidence"), value: samples === 0 ? t("performanceGuidance.customer.insufficient") : t("performanceGuidance.customer.lowSample"), tone: "warning" });
    const positiveTags = Array.isArray(item?.top_positive_tags) ? item.top_positive_tags.map((row) => readableTag(row.tag)).filter(Boolean) : [];
    const improvementTags = Array.isArray(item?.top_improvement_tags) ? item.top_improvement_tags.map((row) => readableTag(row.tag)).filter(Boolean) : [];
    if (positiveTags.length) why.push({ label: t("performanceGuidance.customer.positiveSignals"), value: positiveTags.slice(0, 3).join(" · "), tone: "success" });
    if (improvementTags.length) why.push({ label: t("performanceGuidance.customer.needsAttention"), value: improvementTags.slice(0, 3).join(" · "), tone: "warning" });
    improve = improvementTags.map((tag) => t(`performanceGuidance.customer.tags.${tag.replaceAll(" ", "_").toLowerCase()}`, { defaultValue: "" })).filter(Boolean).slice(0, 3);
    if (!improve.length) improve = [t(confidence !== "established" ? "performanceGuidance.customer.needMore" : fullScore ? "performanceGuidance.customer.keep" : "performanceGuidance.customer.improve")];
    whatCounts = t("performanceGuidance.customer.whatCounts");
  } else if (key === "knowledge") {
    const onboarding = asNumber(evidence.onboarding_ratio);
    const sop = asNumber(evidence.sop_ratio);
    const quiz = asNumber(evidence.quiz_ratio);
    const growth = asNumber(evidence.growth_ratio);
    why.push({ label: t("learn.onboarding"), value: onboarding === 1 ? t("status.completed") : percentLabel(onboarding, t), tone: onboarding === 1 ? "success" : "warning" });
    why.push({ label: t("performanceGuidance.knowledge.requiredSop"), value: sop === 1 ? t("performanceGuidance.upToDate") : t("performanceGuidance.knowledge.acknowledged", { percent: percentLabel(sop, t) }), tone: sop === 1 ? "success" : "warning" });
    why.push({ label: t("performanceGuidance.knowledge.checks"), value: quiz === 1 ? t("performanceGuidance.knowledge.allPassed") : t("performanceGuidance.knowledge.passed", { percent: percentLabel(quiz, t) }), tone: quiz === 1 ? "success" : "warning" });
    why.push({ label: t("performanceGuidance.knowledge.requiredLearning"), value: growth === 1 ? t("performanceGuidance.upToDate") : t("performanceGuidance.knowledge.complete", { percent: percentLabel(growth, t) }), tone: growth === 1 ? "success" : "warning" });
    improve = fullScore ? [t("performanceGuidance.knowledge.keep")] : [onboarding < 1 ? t("performanceGuidance.knowledge.lessons") : null, sop < 1 ? t("performanceGuidance.knowledge.sops") : null, quiz < 1 ? t("performanceGuidance.knowledge.retry") : null, growth < 1 ? t("performanceGuidance.knowledge.learning") : null].filter(Boolean).slice(0, 4);
    whatCounts = t("performanceGuidance.knowledge.whatCounts");
    cta = { label: t("performanceGuidance.goLearn"), action: "learn" };
  }

  if (!why.length) why.push({ label: t("performanceGuidance.verifiedEvidence"), value: item?.explanation || t("performanceGuidance.calculating"), tone: item?.status === "review_required" ? "warning" : "neutral" });
  return { why, improve, whatCounts, cta, level: value == null ? (item?.status === "review_required" ? t("status.review_required") : t("performance.awaitingEvidence")) : performanceLevel(Math.round(value * 100 / max), t) };
}

function PerformanceDetailSheet({ title, onClose, children }) {
  return <CrewBottomSheet title={title} onClose={onClose} className="crew-performance-detail-sheet" contentClassName="crew-performance-detail-sheet-content">
    {children}
  </CrewBottomSheet>;
}

function PerformanceComponentModal({ component, onClose, onNavigate }) {
  const { t } = useTranslation();
  const Icon = component.icon;
  const guidance = buildComponentGuidance(component, t);
  return <PerformanceDetailSheet title={component.label} onClose={onClose}>
    <div className="crew-performance-component-modal">
      <header className="crew-performance-component-summary">
        <i className="crew-ui-icon-container crew-ui-icon-container--emphasis"><Icon size={22} /></i>
        <span><strong>{guidance.level}</strong><small>{t("performance.current")}</small></span>
        <div><strong>{component.value ?? "—"}</strong><small>/ {component.max}</small></div>
      </header>
      <section className="crew-performance-component-section">
        <h3>{t("performance.whyScore")}</h3>
        <div className="crew-performance-component-evidence">
          {guidance.why.map((row, index) => <div key={`${row.label}-${index}`}><span><strong>{row.label}</strong><small>{row.value}</small></span><i className={`crew-ui-icon-container crew-ui-icon-container--small${row.tone ? ` is-${row.tone}` : ""}`}>{row.tone === "success" ? <CheckCircle2 size={15} /> : row.tone === "warning" ? <CircleHelp size={15} /> : <Circle size={13} />}</i></div>)}
        </div>
      </section>
      <section className={`crew-performance-component-section is-improve ${component.value === component.max ? "is-success" : "is-warning"}`}>
        <h3>{component.value === component.max ? t("performance.keepItUp") : t("performance.howImprove")}</h3>
        <ul>{guidance.improve.map((item) => <li key={item}><CheckCircle2 size={15} /><span>{item}</span></li>)}</ul>
      </section>
      <section className="crew-performance-component-section is-counts"><h3>{t("performance.whatCounts")}</h3><p>{guidance.whatCounts}</p></section>
      {guidance.cta ? <button type="button" className="crew-mobile-primary crew-performance-component-cta" onClick={() => onNavigate(guidance.cta.action)}>{guidance.cta.label} <ArrowUpRight size={17} /></button> : null}
    </div>
  </PerformanceDetailSheet>;
}

function PerformanceHero({ performance }) {
  const { t } = useTranslation();
  const score = performance.score == null ? null : Math.round(Number(performance.score));
  const comparison = getPerformanceScoreComparison(performance);
  const deltaLabel = comparison?.direction === "up" ? t("performance.trendUp", { points: comparison.points }) : comparison?.direction === "down" ? t("performance.trendDown", { points: comparison.points }) : comparison ? t("performance.trendNoChange") : null;
  const TrendIcon = comparison?.direction === "down" ? TrendingDown : comparison?.direction === "neutral" ? null : TrendingUp;
  return <article className="crew-performance-final-hero" style={{ "--crew-performance-detail-background": `url(${performanceDetailHeroBackground})` }}>
    <div className="crew-performance-final-hero-copy">
      <div className="crew-performance-final-period"><strong>{monthLabel(performance.period_start, "long", t)}</strong><span className={`is-${performance.status}`}>{performanceStatus(performance.status, t)}</span></div>
      <div className="crew-performance-final-total"><strong>{score ?? "—"}</strong><span>/100</span></div>
      <h2>{score == null ? t("performance.reviewProgress") : performanceLevel(score, t)}</h2>
      <p>{score == null ? t("performance.evidenceReview") : performanceMessage(score, t)}</p>
      {comparison ? <small className={`is-${comparison.direction}`}>{TrendIcon ? <TrendIcon size={13} aria-hidden="true" /> : <i aria-hidden="true">—</i>} {t("performance.vsPeriod", { delta: deltaLabel, period: monthLabel(comparison.previousPeriod, "long", t) })}</small> : null}
    </div>
  </article>;
}

function PerformanceBreakdown({ performance, onSelect }) {
  const { t } = useTranslation();
  const total = performance.score == null ? null : Math.round(Number(performance.score));
  return <section className="crew-performance-final-breakdown">
    <header className="crew-performance-final-breakdown-head"><h2 className="crew-type-section-title">{t("performance.scoreBreakdown")}</h2><strong aria-hidden="true">{total == null ? "— / 100" : `${total} / 100`}</strong></header>
    <div className="crew-performance-final-breakdown-card">
      {performanceComponents(t).map(({ key, label, max, weight, icon: Icon }) => {
        const item = performance.breakdown?.[key] || {};
        const value = item.score == null ? null : Math.round(Number(item.score));
        const progress = value == null ? 0 : Math.min(100, value * 100 / max);
        return <button type="button" key={key} onClick={() => onSelect({ key, label, max, weight, icon: Icon, item, value })} aria-label={t("performance.viewEvidence", { label })}>
          <i className="crew-ui-icon-container crew-ui-icon-container--small"><Icon size={17} /></i>
          <span><strong>{label}</strong><small>{t("performance.weight", { weight })}</small></span>
          <div className="crew-performance-final-meter" aria-label={`${label} ${value ?? 0} of ${max}`}><span style={{ width: `${progress}%` }} /></div>
          <b>{value == null ? "—" : value} / {max}</b><ChevronRight size={17} />
        </button>;
      })}
    </div>
  </section>;
}

function PerformanceStrengths({ performance }) {
  const { t } = useTranslation();
  const strengths = performanceComponents(t).map((definition) => {
    const item = performance.breakdown?.[definition.key] || {};
    const score = item.score == null ? null : Number(item.score);
    return score === definition.max && item.status !== "review_required" ? { ...definition, body: definition.strength } : null;
  }).filter(Boolean).slice(0, 3);
  if (!strengths.length) return null;
  return <section className="crew-performance-final-strengths"><CrewSectionHeader title={t("performance.strengthsTitle")} /><div>{strengths.map(({ key, label, icon: Icon, body }) => <article key={key}><i className="crew-ui-icon-container crew-ui-icon-container--compact"><Icon size={18} /></i><span><strong>{label}</strong><p>{body}</p></span></article>)}</div></section>;
}

function PerformanceTrend({ performance }) {
  const { t } = useTranslation();
  const trend = (performance.trend || []).filter((item) => item.status === "finalized" && item.score != null).sort((a, b) => String(a.period_start).localeCompare(String(b.period_start))).slice(-4).map((item) => ({ ...item, score: Math.round(Number(item.score)), month: formatCrewDate(`${item.period_start}T00:00:00`, { month: "short", year: "numeric" }) }));
  if (!trend.length) return null;
  return <section className="crew-performance-final-trend-section"><CrewSectionHeader title={t("performance.trend")} trailing={<span className="crew-performance-final-trend-context">{t("performance.lastMonths")}</span>} />
    {trend.length > 1 ? <div className="crew-performance-final-chart" aria-label={t("performance.finalizedTrend")}><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 20, right: 12, bottom: 2, left: 12 }}><defs><linearGradient id="performanceTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00b7c7" stopOpacity=".24"/><stop offset="100%" stopColor="#00b7c7" stopOpacity=".02"/></linearGradient></defs><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#52627a", fontSize: 9 }} /><YAxis domain={[0, 100]} hide /><Tooltip content={() => null} /><Area type="monotone" dataKey="score" stroke="#00b7c7" strokeWidth={2.5} fill="url(#performanceTrendFill)" dot={{ r: 3.5, fill: "#00b7c7", strokeWidth: 0 }} activeDot={false} label={{ position: "top", fill: "#1d2a44", fontSize: 9, fontWeight: 800 }} /></AreaChart></ResponsiveContainer></div> : <article className="crew-performance-final-single-trend"><strong>{trend[0].score} · {monthLabel(trend[0].period_start, "long", t)}</strong><p>{t("performance.trendMore")}</p></article>}
  </section>;
}

function CrewPerformanceDetail({ performance, onBack, onNavigate }) {
  const { t } = useTranslation();
  const [modal, setModal] = useState(null);
  return <section className="crew-v2-growth crew-performance-final">
    <PageHeader title={t("performance.title")} onBack={onBack} action={<CrewHelpTrigger variant="header" label={t("performance.help")} onClick={() => setModal({ type: "help" })} />} />
    <PerformanceHero performance={performance} />
    <PerformanceBreakdown performance={performance} onSelect={(component) => setModal({ type: "component", component })} />
    <PerformanceStrengths performance={performance} />
    <PerformanceTrend performance={performance} />
    {modal?.type === "component" ? <PerformanceComponentModal component={modal.component} onClose={() => setModal(null)} onNavigate={(target) => { setModal(null); onNavigate?.(target); }} /> : null}
    {modal?.type === "help" ? <CrewHelpSheet title={t("performance.about")} onClose={() => setModal(null)}><section className="crew-ui-help-section"><strong>{t("performance.monthlyScore")}</strong><p>{t("performance.monthlyScoreHelp")}</p></section><section className="crew-ui-help-section"><strong>{t("performance.scoreBreakdown")}</strong><p>{t("performance.breakdownHelp")}</p></section></CrewHelpSheet> : null}
  </section>;
}

export default function CrewGrowthMobile({ data, performance, loading, error, onRetry, onNavigate, onViewChange, initialView = "overview" }) {
  const { t } = useTranslation();
  const [view, setView] = useState(initialView);
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [skillReturnView, setSkillReturnView] = useState("overview");
  const [helpOpen, setHelpOpen] = useState(false);
  const changeView = (nextView) => { setView(nextView); onViewChange?.(nextView); };
  useEffect(() => { setView(initialView); }, [initialView]);
  useEffect(() => { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; }, [view]);
  const skills = data?.skills || [];
  const summary = data?.summary || { certified: 0, in_progress: 0, ready_for_review: 0, not_started: 0, total: 0 };
  const completeRequirements = skills.reduce((sum, skill) => sum + (Number(skill.requirements_completed) || 0), 0);
  const allRequirements = skills.reduce((sum, skill) => sum + (Number(skill.requirements_total) || 0), 0);
  const overall = allRequirements ? Math.round((completeRequirements / allRequirements) * 100) : 0;

  function openSkill(skill) {
    setSkillReturnView(view === "skill" ? "overview" : view);
    setSelectedSkill(skill);
    changeView("skill");
  }

  if (loading) return <section className="crew-v2-state"><span className="crew-v2-spinner" /><strong>{t("growth.loading")}</strong></section>;
  if (error) return <section className="crew-v2-state is-error"><Target size={24} /><strong>{t("growth.unavailable")}</strong><p>{error}</p><button type="button" onClick={onRetry}>{t("common.retry")}</button></section>;

  if (view === "skill" && selectedSkill) {
    const progress = percentFor(selectedSkill);
    return <section className="crew-v2-growth">
      <PageHeader title={t("growth.skillDetail")} onBack={() => { changeView(skillReturnView); setSelectedSkill(null); }} />
      <article className="crew-v2-skill-hero">
        <div className="crew-v2-icon-token"><BadgeCheck size={23} /></div>
        <div><h2>{selectedSkill.name}</h2><p>{selectedSkill.category}</p></div>
        <CrewStatusBadge tone={selectedSkill.status === "certified" ? "success" : selectedSkill.status === "ready_for_review" ? "ready" : "neutral"}>{translateStatus(selectedSkill.status, t)}</CrewStatusBadge>
      </article>
      {selectedSkill.description && <p className="crew-v2-skill-description">{selectedSkill.description}</p>}
      <section className="crew-v2-section-block">
        <div className="crew-v2-section-title"><h2>{t("growth.myProgress")}</h2><strong>{selectedSkill.requirements_completed} / {selectedSkill.requirements_total}</strong></div>
        <ProgressBar value={progress} />
        <div className="crew-v2-requirements">
          {(selectedSkill.requirements || []).map((requirement) => <div key={requirement.requirement_id}>
            {requirement.completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
            <span><strong>{requirement.label}</strong><small>{requirement.detail}</small></span>
            <em>{requirement.completed ? t("status.completed") : requirement.type === "practical" ? t("growth.managerReview") : t("status.pending")}</em>
          </div>)}
        </div>
      </section>
      {selectedSkill.status === "ready_for_review" && <section className="crew-ui-note crew-growth-next-action"><Target size={19} /><span><strong>{t("growth.nextAction")}</strong><small>{t("growth.waitingReview")}</small></span></section>}
      {selectedSkill.certification && <section className="crew-v2-certificate-note"><Award size={20} /><div><strong>{t("growth.certifiedOn", { date: formatDate(selectedSkill.certification.certified_at) })}</strong><small>{selectedSkill.certification.expires_at ? t("growth.validUntil", { date: formatDate(selectedSkill.certification.expires_at) }) : t("growth.noExpiry")}</small></div></section>}
    </section>;
  }

  if (view === "path") {
    const next = skills.find((skill) => skill.status === "ready_for_review") || skills.find((skill) => skill.status === "in_progress") || skills.find((skill) => skill.status === "not_started");
    return <section className="crew-v2-growth">
      <PageHeader title={t("growth.myPath")} onBack={() => changeView("overview")} />
      <article className="crew-v2-path-hero"><Sparkles size={23} /><p>{t("growth.keepGoing")}</p><h2>{next ? next.name : t("growth.nextMilestone")}</h2><ProgressBar value={next ? percentFor(next) : overall} /><small>{next ? t("growth.requirementCount", { completed: next.requirements_completed, total: next.requirements_total }) : t("growth.allMilestones")}</small></article>
      <section className="crew-v2-section-block"><div className="crew-v2-section-title"><h2>{t("growth.timeline")}</h2><span>{t("growth.updates", { count: data?.timeline?.length || 0 })}</span></div>
        <div className="crew-v2-timeline">{(data?.timeline || []).map((event, index) => <div key={`${event.type}-${event.occurred_at}-${index}`}><span><CheckCircle2 size={15} /></span><div><strong>{event.label}</strong><small>{event.skill_name} · {formatDate(event.occurred_at)}{event.score != null ? ` · ${event.score}%` : ""}</small></div></div>)}</div>
        {!data?.timeline?.length && <div className="crew-v2-empty">{t("growth.noTimeline")}</div>}
      </section>
    </section>;
  }

  if (view === "certifications") {
    const groups = [
      [t("status.ready_for_review"), skills.filter((skill) => ["ready_for_review", "needs_renewal"].includes(skill.status))],
      [t("status.in_progress"), skills.filter((skill) => skill.status === "in_progress")],
      [t("status.completed"), skills.filter((skill) => skill.status === "certified")],
    ];
    return <section className="crew-v2-growth">
      <PageHeader title={t("growth.certifications")} onBack={() => changeView("overview")} />
      {groups.map(([label, rows]) => <section className="crew-v2-cert-group" key={label}><div className="crew-v2-section-title"><h2>{label}</h2><span>{rows.length}</span></div>
        {rows.length ? <div className="crew-v2-skill-list">{rows.map((skill) => <button type="button" key={skill.id} onClick={() => openSkill(skill)}><div className="crew-v2-row-icon"><Award size={17} /></div><span><strong>{skill.name}</strong><small>{skill.status === "certified" ? t("growth.certifiedOn", { date: formatDate(skill.certification?.certified_at) }) : t("growth.requirementCount", { completed: skill.requirements_completed, total: skill.requirements_total })}</small></span><ChevronRight size={16} /></button>)}</div> : <p className="crew-v2-group-empty">{t("growth.noStageSkills")}</p>}
      </section>)}
    </section>;
  }

  if (view === "performance") {
    return performance ? <CrewPerformanceDetail performance={performance} onBack={() => changeView("overview")} onNavigate={(target) => target === "skills" || target === "growth" ? changeView("overview") : onNavigate?.(target)} /> : <section className="crew-v2-growth crew-v2-performance"><PageHeader title={t("performance.title")} onBack={() => changeView("overview")} /><section className="crew-v2-performance-empty"><Target size={28} /><h2>{t("performance.unavailable")}</h2><p>{t("performance.unavailableBody")}</p></section></section>;
  }

  return <section className="crew-v2-growth crew-growth-overview">
    <PageHeader title={t("growth.title")} subtitle={t("growth.subtitle")} action={<CrewHelpTrigger variant="header" label={t("growth.help")} onClick={() => setHelpOpen(true)} />} />
    <GrowthPerformanceHero performance={performance} onOpen={() => changeView("performance")} />
    <GrowthSkillSummary summary={summary} />
    <GrowthSkillList skills={skills} onOpen={openSkill} />
    {helpOpen ? <GrowthHelpSheet onClose={() => setHelpOpen(false)} /> : null}
  </section>;
}
