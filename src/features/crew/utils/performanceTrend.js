import { crewLocale } from "./crewI18n.js";

const SCORE_DELTA_PRECISION = 10;

const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const scoreStates = new Set(["unavailable", "partial", "complete", "finalized"]);

const componentScoreCount = (breakdown) => Object.values(breakdown || {}).filter((component) => finiteNumber(component?.score) != null).length;

// The database owns the score and completion projection. This only makes older
// responses and focused UI fixtures safe to render while the mobile contract
// rolls out.
export const getPerformanceScorePresentation = (performance) => {
  const explicitState = performance?.score_state;
  const fallbackState = performance?.status === "finalized"
    ? "finalized"
    : finiteNumber(performance?.total_score) != null
      ? "complete"
      : finiteNumber(performance?.current_score) != null || performance?.status === "review_required"
        ? "partial"
        : finiteNumber(performance?.score) != null
          ? "complete"
          : "unavailable";
  const state = scoreStates.has(explicitState) ? explicitState : fallbackState;
  const score = state === "partial"
    ? finiteNumber(performance?.current_score) ?? finiteNumber(performance?.score)
    : state === "unavailable"
      ? null
      : finiteNumber(performance?.total_score) ?? finiteNumber(performance?.score);
  const scoredComponents = performance?.scored_components != null && Number.isInteger(Number(performance.scored_components))
    ? Number(performance.scored_components)
    : componentScoreCount(performance?.breakdown);
  const totalComponents = performance?.total_components != null && Number.isInteger(Number(performance.total_components))
    ? Number(performance.total_components)
    : 5;
  const pendingComponents = performance?.pending_components != null && Number.isInteger(Number(performance.pending_components))
    ? Number(performance.pending_components)
    : Math.max(0, totalComponents - scoredComponents);

  return {
    state,
    score,
    scoredComponents,
    totalComponents,
    pendingComponents,
    isPartial: state === "partial",
    isComparable: state === "complete" || state === "finalized",
  };
};

const byPeriod = (left, right) => String(left.period_start || "").localeCompare(String(right.period_start || ""));

export const getFinalizedPerformanceTrend = (trend, limit = 4) => (Array.isArray(trend) ? trend : [])
  .filter((item) => item?.status === "finalized" && finiteNumber(item.score) != null)
  .sort(byPeriod)
  .slice(-limit);

// Crew Performance scores are authoritative server values. This helper only
// creates a compact, locale-aware display projection and never changes scoring.
export const normalizePerformanceScoreDelta = (value) => {
  const number = finiteNumber(value);
  if (number == null) return null;
  const rounded = Math.round(number * SCORE_DELTA_PRECISION) / SCORE_DELTA_PRECISION;
  return rounded === 0 ? 0 : rounded;
};

export const formatPerformanceScorePoints = (value, language) => {
  const number = finiteNumber(value);
  return number == null ? null : new Intl.NumberFormat(crewLocale(language), { maximumFractionDigits: 1 }).format(Math.abs(number));
};

export const getPerformanceScoreComparison = (performance) => {
  if (!getPerformanceScorePresentation(performance).isComparable) return null;
  const { score, period_start: periodStart, trend } = performance || {};
  const currentScore = getPerformanceScorePresentation(performance).score ?? finiteNumber(score);
  if (currentScore == null) return null;

  const comparable = getFinalizedPerformanceTrend(trend, Number.POSITIVE_INFINITY);
  const previous = periodStart
    ? [...comparable].reverse().find((item) => String(item.period_start) < String(periodStart))
    : comparable.at(-2);

  if (!previous) return null;
  const delta = normalizePerformanceScoreDelta(currentScore - finiteNumber(previous.score));
  if (delta == null) return null;
  return {
    delta,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "neutral",
    points: formatPerformanceScorePoints(delta),
    previousPeriod: previous.period_start,
  };
};
