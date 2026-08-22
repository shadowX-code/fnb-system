import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";
import {
  ArrowUpRight,
  Award,
  BadgeCheck,
  BookOpenCheck,
  CalendarCheck2,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleHelp,
  Clock3,
  Gift,
  Search,
  ShieldCheck,
  SmilePlus,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import { Area, AreaChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CrewSectionHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";
import CrewMobileDetailHeader from "./CrewMobileDetailHeader.jsx";
import { formatCrewDate, translateStatus } from "../utils/crewI18n.js";
import "./CrewPerformanceComponentModal.css";
import "./CrewGrowthMobile.css";

const statusCopy = {
  certified: "Certified",
  in_progress: "In Progress",
  ready_for_review: "Ready for Review",
  not_started: "Not Started",
  needs_renewal: "Ready for Review",
  expired: "Expired",
};

const statusClass = (status) => `is-${String(status || "not_started").replaceAll("_", "-")}`;
const percentFor = (skill) => {
  const total = Number(skill?.requirements_total) || 0;
  return total ? Math.round(((Number(skill?.requirements_completed) || 0) / total) * 100) : 0;
};
const formatDate = (value) => formatCrewDate(value, { day: "numeric", month: "short", year: "numeric" });

function ProgressBar({ value }) {
  return <div className="crew-ui-linear-progress" aria-label={`${value}% complete`}><span style={{ width: `${value}%` }} /></div>;
}

function PageHeader({ title, onBack, action }) {
  if (onBack) return <CrewMobileDetailHeader title={title} onBack={onBack} action={action} />;
  return <header className="crew-v2-page-header">
    <div><h1>{title}</h1></div>
    {action}
  </header>;
}

function GrowthHelpModal({ onClose }) {
  const { t } = useTranslation();
  const modalRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") return onClose();
      if (event.key !== "Tab") return;
      const focusable = [...modalRef.current.querySelectorAll("button, [href], [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [onClose]);
  return <div className="crew-growth-final-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={modalRef} className="crew-growth-final-modal" role="dialog" aria-modal="true" aria-label={t("growth.about")} onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>{t("growth.about")}</h2><button ref={closeRef} type="button" aria-label={t("common.close")} onClick={onClose}><X size={19} /></button></header>
      <div>
        <section><strong>{t("growth.skills")}</strong><p>{t("growth.helpSkills")}</p></section>
        <section><strong>{t("growth.readyForReview")}</strong><p>{t("growth.helpReview")}</p></section>
        <section><strong>{t("growth.performance")}</strong><p>{t("growth.helpPerformance")}</p></section>
      </div>
    </section>
  </div>;
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

function GrowthMilestoneHero({ skill, onOpen }) {
  const { t } = useTranslation();
  return <article className="crew-growth-final-hero">
    <div className="crew-growth-final-hero-copy">
      <small>{t("growth.nextMilestone")}</small>
      <h2>{skill?.name || t("growth.allCaughtUp")}</h2>
      <p>{skill?.category || t("growth.skillsCurrent")}</p>
      {skill ? <><CrewStatusBadge tone={skill.status === "ready_for_review" ? "ready" : "neutral"}>{translateStatus(skill.status, t)}</CrewStatusBadge><button type="button" onClick={() => onOpen(skill)}>{t("growth.viewSkill")} <ChevronRight size={17} /></button></> : null}
    </div>
  </article>;
}

const skillSummaryCards = [
  { key: "certified", label: "Certified", icon: BadgeCheck, tone: "green" },
  { key: "in_progress", label: "In Progress", icon: Circle, tone: "blue" },
  { key: "ready_for_review", label: "Ready for Review", icon: Star, tone: "amber" },
  { key: "not_started", label: "Not Started", icon: Clock3, tone: "neutral" },
];

function GrowthSkillSummary({ summary, onViewAll }) {
  const { t } = useTranslation();
  return <section className="crew-growth-final-skills">
    <header><span><h2>{t("growth.yourSkills")}</h2><p>{t("growth.skillsCaption")}</p></span><button type="button" onClick={onViewAll}>{t("growth.viewAllSkills")} <ChevronRight size={17} /></button></header>
    <div className="crew-growth-final-stat-grid">
      {skillSummaryCards.map(({ key, label, icon: Icon, tone }) => <article key={key} className={`is-${tone}`}><Icon size={25} /><strong>{summary?.[key] || 0}</strong><span>{translateStatus(key, t) || label}</span></article>)}
    </div>
  </section>;
}

function GrowthReadyList({ skills, onOpen, onViewAll }) {
  const { t } = useTranslation();
  if (!skills.length) return null;
  return <section className="crew-growth-final-ready">
    <header><h3>{t("growth.readyForReview")}</h3><span>{t("growth.skillCount", { count: skills.length })}</span></header>
    <div>{skills.slice(0, 3).map((skill) => <button type="button" key={skill.id} onClick={() => onOpen(skill)}><i><BookOpenCheck size={20} /></i><span><strong>{skill.name}</strong><small>{skill.category || t("growth.skills")}</small></span><em>{t("growth.readyForReview")}</em><ChevronRight size={18} /></button>)}</div>
    <button type="button" className="crew-growth-final-view-all" onClick={onViewAll}>{t("growth.viewAllSkills")} <ChevronRight size={18} /></button>
  </section>;
}

function GrowthPerformanceCard({ performance, onOpen }) {
  const { t } = useTranslation();
  const score = performance?.score == null ? null : Math.round(Number(performance.score));
  const trend = (performance?.trend || []).filter((item) => item.score != null).slice(-6).map((item) => ({ ...item, score: Number(item.score), label: formatCrewDate(`${item.period_start}T00:00:00`, { month: "short" }) }));
  return <button type="button" className="crew-growth-final-performance" onClick={onOpen} aria-label={t("growth.viewPerformance")}>
    <header><span><h2>{t("growth.performance")}</h2><p>{t("growth.performanceCaption")}</p></span></header>
    <div className="crew-growth-final-performance-body">
      <div className="crew-growth-final-score"><strong>{score ?? "—"}</strong><span>/100</span><i /><em><b>{performanceLevel(score, t)}</b><small>{t("growth.thisMonth")}</small></em></div>
      <div className="crew-growth-final-trend" aria-label={trend.length > 1 ? t("growth.recentTrend") : t("growth.noTrend")}>
        {trend.length > 1 ? <ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{ top: 12, right: 7, bottom: 5, left: 7 }}><XAxis dataKey="label" hide /><YAxis domain={[0, 100]} hide /><Tooltip content={() => null} /><Line type="monotone" dataKey="score" stroke="#079b69" strokeWidth={3} dot={{ r: 4, fill: "#fff", stroke: "#079b69", strokeWidth: 2 }} activeDot={false} /></LineChart></ResponsiveContainer> : <span>{t("growth.noTrend")}</span>}
      </div>
    </div>
    <footer>{t("growth.viewPerformance")} <ChevronRight size={18} /></footer>
  </button>;
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
const rewardEarnRate = (score) => score >= 95 ? 100 : score >= 90 ? 90 : score >= 85 ? 80 : score >= 80 ? 65 : score >= 75 ? 45 : score >= 70 ? 20 : 0;
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

function PerformanceModal({ title, onClose, children }) {
  const { t } = useTranslation();
  const modalRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") return onClose();
      if (event.key !== "Tab") return;
      const focusable = [...modalRef.current.querySelectorAll("button, [href], [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [onClose]);
  return <div className="crew-performance-final-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={modalRef} className="crew-performance-final-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>{title}</h2><button ref={closeRef} type="button" aria-label={t("common.closeNamed", { title })} onClick={onClose}><X size={19} /></button></header>
      <div>{children}</div>
    </section>
  </div>;
}

function PerformanceComponentModal({ component, onClose, onNavigate }) {
  const { t } = useTranslation();
  const Icon = component.icon;
  const guidance = buildComponentGuidance(component, t);
  return <PerformanceModal title={component.label} onClose={onClose}>
    <div className="crew-performance-component-modal">
      <header className="crew-performance-component-summary">
        <i><Icon size={22} /></i>
        <span><strong>{guidance.level}</strong><small>{t("performance.current")}</small></span>
        <div><strong>{component.value ?? "—"}</strong><small>/ {component.max}</small></div>
      </header>
      <section className="crew-performance-component-section">
        <h3>{t("performance.whyScore")}</h3>
        <div className="crew-performance-component-evidence">
          {guidance.why.map((row, index) => <div key={`${row.label}-${index}`} className={`is-${row.tone || "neutral"}`}><span><strong>{row.label}</strong><small>{row.value}</small></span><i>{row.tone === "success" ? <CheckCircle2 size={15} /> : row.tone === "warning" ? <CircleHelp size={15} /> : <Circle size={13} />}</i></div>)}
        </div>
      </section>
      <section className="crew-performance-component-section is-improve">
        <h3>{component.value === component.max ? t("performance.keepItUp") : t("performance.howImprove")}</h3>
        <ul>{guidance.improve.map((item) => <li key={item}><CheckCircle2 size={15} /><span>{item}</span></li>)}</ul>
      </section>
      <section className="crew-performance-component-section is-counts"><h3>{t("performance.whatCounts")}</h3><p>{guidance.whatCounts}</p></section>
      {guidance.cta ? <button type="button" className="crew-performance-component-cta" onClick={() => onNavigate(guidance.cta.action)}>{guidance.cta.label} <ArrowUpRight size={17} /></button> : null}
    </div>
  </PerformanceModal>;
}

function PerformanceHero({ performance }) {
  const { t } = useTranslation();
  const score = performance.score == null ? null : Math.round(Number(performance.score));
  const finalizedTrend = (performance.trend || []).filter((item) => item.status === "finalized" && item.score != null).sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
  const previous = [...finalizedTrend].reverse().find((item) => item.period_start !== performance.period_start);
  const delta = score != null && previous ? score - Math.round(Number(previous.score)) : null;
  return <article className="crew-performance-final-hero">
    <span className="crew-performance-final-signal" aria-hidden="true"><i /><i /><i /></span>
    <div className="crew-performance-final-hero-copy">
      <div className="crew-performance-final-period"><strong>{monthLabel(performance.period_start, "long", t)}</strong><span className={`is-${performance.status}`}>{performanceStatus(performance.status, t)}</span></div>
      <div className="crew-performance-final-total"><strong>{score ?? "—"}</strong><span>/100</span></div>
      <h2>{score == null ? t("performance.reviewProgress") : performanceLevel(score, t)}</h2>
      <p>{score == null ? t("performance.evidenceReview") : performanceMessage(score, t)}</p>
      {delta != null ? <small className={delta < 0 ? "is-down" : ""}><TrendingUp size={13} /> {t("performance.vsPeriod", { delta: `${delta > 0 ? "+" : ""}${delta}`, period: monthLabel(previous.period_start, "long", t) })}</small> : null}
    </div>
  </article>;
}

function PerformanceBreakdown({ performance, onSelect, onExplain }) {
  const { t } = useTranslation();
  const total = performance.score == null ? null : Math.round(Number(performance.score));
  return <section className="crew-performance-final-breakdown">
    <header><h2>{t("performance.scoreBreakdown")}</h2><strong>{total == null ? "—" : total} / 100</strong></header>
    <div className="crew-performance-final-breakdown-card">
      {performanceComponents(t).map(({ key, label, max, weight, icon: Icon }) => {
        const item = performance.breakdown?.[key] || {};
        const value = item.score == null ? null : Math.round(Number(item.score));
        const progress = value == null ? 0 : Math.min(100, value * 100 / max);
        return <button type="button" key={key} onClick={() => onSelect({ key, label, max, weight, icon: Icon, item, value })} aria-label={t("performance.viewEvidence", { label })}>
          <i><Icon size={19} /></i>
          <span><strong>{label}</strong><small>{t("performance.weight", { weight })}</small></span>
          <div className="crew-performance-final-meter" aria-label={`${label} ${value ?? 0} of ${max}`}><span style={{ width: `${progress}%` }} /></div>
          <b>{value == null ? "—" : value} / {max}</b><ChevronRight size={17} />
        </button>;
      })}
      <button type="button" className="crew-performance-final-evidence" onClick={onExplain}><i><ShieldCheck size={19} /></i><span><strong>{t("performance.verifiedEvidence")}</strong><small>{t("performance.learnCalculation")}</small></span><ChevronRight size={17} /></button>
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
  return <section className="crew-performance-final-strengths"><h2>{t("performance.strengthsTitle")}</h2><div>{strengths.map(({ key, label, icon: Icon, body }) => <article key={key}><i><Icon size={18} /></i><span><strong>{label}</strong><p>{body}</p></span></article>)}</div></section>;
}

function PerformanceTrend({ performance }) {
  const { t } = useTranslation();
  const trend = (performance.trend || []).filter((item) => item.status === "finalized" && item.score != null).sort((a, b) => String(a.period_start).localeCompare(String(b.period_start))).slice(-4).map((item) => ({ ...item, score: Math.round(Number(item.score)), month: formatCrewDate(`${item.period_start}T00:00:00`, { month: "short", year: "numeric" }) }));
  if (!trend.length) return null;
  return <section className="crew-performance-final-trend-section"><header><h2>{t("performance.trend")}</h2><span>{t("performance.lastMonths")}</span></header>
    {trend.length > 1 ? <div className="crew-performance-final-chart" aria-label={t("performance.finalizedTrend")}><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 20, right: 12, bottom: 2, left: 12 }}><defs><linearGradient id="performanceTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#14a873" stopOpacity=".24"/><stop offset="100%" stopColor="#14a873" stopOpacity=".02"/></linearGradient></defs><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#52627a", fontSize: 9 }} /><YAxis domain={[0, 100]} hide /><Tooltip content={() => null} /><Area type="monotone" dataKey="score" stroke="#0aa875" strokeWidth={2.5} fill="url(#performanceTrendFill)" dot={{ r: 3.5, fill: "#0aa875", strokeWidth: 0 }} activeDot={false} label={{ position: "top", fill: "#1d2a44", fontSize: 9, fontWeight: 800 }} /></AreaChart></ResponsiveContainer></div> : <article className="crew-performance-final-single-trend"><strong>{trend[0].score} · {monthLabel(trend[0].period_start, "long", t)}</strong><p>{t("performance.trendMore")}</p></article>}
  </section>;
}

function PerformanceRewardImpact({ performance, onViewReward }) {
  const { t } = useTranslation();
  const score = performance.score == null ? null : Math.round(Number(performance.score));
  const finalized = performance.status === "finalized";
  const rate = score == null ? null : rewardEarnRate(score);
  return <section className="crew-performance-final-reward"><i><Gift size={21} /></i><span><strong>{t("performance.rewardImpact")}</strong><small>{finalized ? t("performance.finalizedPerformance") : t("performance.estimatedPerformance")}</small></span><div><small>{t("growth.performance")}</small><strong>{score ?? "—"} / 100</strong></div><div><small>{t("performance.earnRate")}</small><strong>{rate == null ? "—" : `${rate}%`}</strong></div><button type="button" onClick={onViewReward}>{t("performance.viewReward")} <ChevronRight size={17} /></button></section>;
}

function CrewPerformanceDetail({ performance, onBack, onViewReward, onNavigate }) {
  const { t } = useTranslation();
  const [modal, setModal] = useState(null);
  return <section className="crew-v2-growth crew-performance-final">
    <PageHeader title={t("performance.title")} onBack={onBack} action={<button type="button" className="crew-performance-final-help" aria-label={t("performance.help")} onClick={() => setModal({ type: "help" })}><CircleHelp size={22} /></button>} />
    <PerformanceHero performance={performance} />
    <PerformanceBreakdown performance={performance} onSelect={(component) => setModal({ type: "component", component })} onExplain={() => setModal({ type: "calculation" })} />
    <PerformanceStrengths performance={performance} />
    <PerformanceTrend performance={performance} />
    <PerformanceRewardImpact performance={performance} onViewReward={onViewReward} />
    {modal?.type === "component" ? <PerformanceComponentModal component={modal.component} onClose={() => setModal(null)} onNavigate={(target) => { setModal(null); onNavigate?.(target); }} /> : null}
    {modal?.type === "calculation" ? <PerformanceModal title={t("performance.calculationTitle")} onClose={() => setModal(null)}>{performanceComponents(t).map(({ key, label, weight }) => <section key={key}><strong>{label} · {weight}%</strong><p>{performance.breakdown?.[key]?.explanation || t("performance.componentCalculation")}</p></section>)}</PerformanceModal> : null}
    {modal?.type === "help" ? <PerformanceModal title={t("performance.about")} onClose={() => setModal(null)}><section><strong>{t("performance.monthlyScore")}</strong><p>{t("performance.monthlyScoreHelp")}</p></section><section><strong>{t("performance.scoreBreakdown")}</strong><p>{t("performance.breakdownHelp")}</p></section><section><strong>{t("performance.rewardImpact")}</strong><p>{t("performance.rewardHelp")}</p></section></PerformanceModal> : null}
  </section>;
}

export default function CrewGrowthMobile({ data, performance, loading, error, onRetry, onViewReward, onNavigate, initialView = "overview" }) {
  const { t } = useTranslation();
  const [view, setView] = useState(initialView);
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [skillReturnView, setSkillReturnView] = useState("overview");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; }, [view]);
  const skills = data?.skills || [];
  const summary = data?.summary || { certified: 0, in_progress: 0, ready_for_review: 0, not_started: 0, total: 0 };
  const categories = useMemo(() => ["All", ...new Set(skills.map((skill) => skill.category).filter(Boolean))], [skills]);
  const filtered = useMemo(() => skills.filter((skill) => {
    const matchesQuery = !query || `${skill.name} ${skill.category}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (category === "All" || skill.category === category);
  }), [skills, query, category]);
  const completeRequirements = skills.reduce((sum, skill) => sum + (Number(skill.requirements_completed) || 0), 0);
  const allRequirements = skills.reduce((sum, skill) => sum + (Number(skill.requirements_total) || 0), 0);
  const overall = allRequirements ? Math.round((completeRequirements / allRequirements) * 100) : 0;
  const nextMilestone = skills.find((skill) => skill.status === "ready_for_review") || skills.find((skill) => skill.status === "in_progress") || skills.find((skill) => skill.status === "not_started");
  const readySkills = skills.filter((skill) => ["ready_for_review", "needs_renewal"].includes(skill.status));

  function openSkill(skill) {
    setSkillReturnView(view === "skill" ? "overview" : view);
    setSelectedSkill(skill);
    setView("skill");
  }

  if (loading) return <section className="crew-v2-state"><span className="crew-v2-spinner" /><strong>{t("growth.loading")}</strong></section>;
  if (error) return <section className="crew-v2-state is-error"><Target size={24} /><strong>{t("growth.unavailable")}</strong><p>{error}</p><button type="button" onClick={onRetry}>{t("common.retry")}</button></section>;

  if (view === "skill" && selectedSkill) {
    const progress = percentFor(selectedSkill);
    return <section className="crew-v2-growth">
      <PageHeader title={t("growth.skillDetail")} onBack={() => { setView(skillReturnView); setSelectedSkill(null); }} />
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

  if (view === "skills") return <section className="crew-v2-growth">
    <PageHeader title={t("growth.skills")} onBack={() => setView("overview")} />
    <label className="crew-v2-search"><Search size={17} /><input aria-label={t("growth.searchSkills")} placeholder={t("growth.searchSkills")} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="crew-v2-chips" aria-label={t("growth.skillCategories")}>{categories.map((item) => <button type="button" key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item === "All" ? t("growth.all") : item}</button>)}</div>
    {[[t("status.ready_for_review"), filtered.filter((skill) => ['ready_for_review', 'needs_renewal'].includes(skill.status))], [t("status.in_progress"), filtered.filter((skill) => skill.status === 'in_progress')], [t("status.certified"), filtered.filter((skill) => skill.status === 'certified')], [t("status.not_started"), filtered.filter((skill) => skill.status === 'not_started')]].filter(([, rows]) => rows.length).map(([label, rows]) => <section className="crew-v3-skill-group" key={label}><CrewSectionHeader title={`${label} · ${rows.length}`} /><div className="crew-v2-skill-list">{rows.map((skill) => <button type="button" key={skill.id} onClick={() => openSkill(skill)}>
      <div className="crew-v2-row-icon"><BookOpenCheck size={17} /></div>
      <span><strong>{skill.name}</strong><small>{skill.category}{skill.status === 'ready_for_review' ? ` · ${t("growth.requirementsComplete")}` : ''}</small>{skill.status === "in_progress" && <ProgressBar value={percentFor(skill)} />}</span>
      <em className={`crew-v2-status ${statusClass(skill.status)}`}>{translateStatus(skill.status, t)}</em>
      <ChevronRight size={16} />
    </button>)}</div></section>)}
    {!filtered.length && <div className="crew-v2-empty">{t("growth.noMatch")}</div>}
  </section>;

  if (view === "path") {
    const next = skills.find((skill) => skill.status === "ready_for_review") || skills.find((skill) => skill.status === "in_progress") || skills.find((skill) => skill.status === "not_started");
    return <section className="crew-v2-growth">
      <PageHeader title={t("growth.myPath")} onBack={() => setView("overview")} />
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
      <PageHeader title={t("growth.certifications")} onBack={() => setView("overview")} />
      {groups.map(([label, rows]) => <section className="crew-v2-cert-group" key={label}><div className="crew-v2-section-title"><h2>{label}</h2><span>{rows.length}</span></div>
        {rows.length ? <div className="crew-v2-skill-list">{rows.map((skill) => <button type="button" key={skill.id} onClick={() => openSkill(skill)}><div className="crew-v2-row-icon"><Award size={17} /></div><span><strong>{skill.name}</strong><small>{skill.status === "certified" ? t("growth.certifiedOn", { date: formatDate(skill.certification?.certified_at) }) : t("growth.requirementCount", { completed: skill.requirements_completed, total: skill.requirements_total })}</small></span><ChevronRight size={16} /></button>)}</div> : <p className="crew-v2-group-empty">{t("growth.noStageSkills")}</p>}
      </section>)}
    </section>;
  }

  if (view === "performance") {
    return performance ? <CrewPerformanceDetail performance={performance} onBack={() => setView("overview")} onViewReward={onViewReward} onNavigate={(target) => target === "skills" || target === "growth" ? setView(target === "skills" ? "skills" : "overview") : onNavigate?.(target)} /> : <section className="crew-v2-growth crew-v2-performance"><PageHeader title={t("performance.title")} onBack={() => setView("overview")} /><section className="crew-v2-performance-empty"><Target size={28} /><h2>{t("performance.unavailable")}</h2><p>{t("performance.unavailableBody")}</p></section></section>;
  }

  return <section className="crew-v2-growth crew-growth-final">
    <PageHeader title={t("growth.title")} action={<button type="button" className="crew-growth-final-help" aria-label={t("growth.help")} onClick={() => setHelpOpen(true)}><CircleHelp size={23} /></button>} />
    <GrowthMilestoneHero skill={nextMilestone} onOpen={openSkill} />
    <div className="crew-growth-final-skill-card">
      <GrowthSkillSummary summary={summary} onViewAll={() => setView("skills")} />
      <GrowthReadyList skills={readySkills} onOpen={openSkill} onViewAll={() => setView("skills")} />
    </div>
    <GrowthPerformanceCard performance={performance} onOpen={() => setView("performance")} />
    {helpOpen ? <GrowthHelpModal onClose={() => setHelpOpen(false)} /> : null}
  </section>;
}
