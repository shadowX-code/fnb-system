import { crewLocale } from "./crewI18n.js";

const SCORE_DELTA_PRECISION = 10;

const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
  const { score, period_start: periodStart, trend } = performance || {};
  const currentScore = finiteNumber(score);
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
