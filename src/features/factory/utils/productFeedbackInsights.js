const demographicPattern = /\b(age|ethnicity|gender|occupation|household|location|segment)\b/i;

const labelFor = (question) => question?.label_en || question?.label || question?.key || "Question";
const optionFor = (question, value) => (question?.options || []).find((option) => option.value === value);
const displayFor = (question, value) => optionFor(question, value)?.display_label || optionFor(question, value)?.label_en || value;
const percent = (count, total) => total ? Math.round((count / total) * 100) : 0;
const isDemographic = (question) => question?.analytics_role === "demographic" || demographicPattern.test(`${question?.key || ""} ${labelFor(question)}`);

function semanticQuestion(question = {}) {
  const next = structuredClone(question);
  delete next.order;
  next.required = Boolean(next.required);
  ["helper_en", "helper_zh", "helper_ms", "label_zh", "label_ms", "rating_low_label_en", "rating_low_label_zh", "rating_low_label_ms", "rating_high_label_en", "rating_high_label_zh", "rating_high_label_ms"].forEach((key) => delete next[key]);
  next.options = (next.options || []).map((option) => { const value = { ...option }; delete value.label_zh; delete value.label_ms; return value; });
  return next;
}
function compatibleResponses(question, responses) {
  const expected = JSON.stringify(semanticQuestion(question));
  return responses.filter((response) => {
    if (!response.questions_snapshot) return true;
    const snapshot = response.questions_snapshot.find((item) => item.key === question.key);
    return snapshot && JSON.stringify(semanticQuestion(snapshot)) === expected;
  });
}

function answersFor(responses, key) {
  return responses.flatMap((response) => {
    const answer = response?.answers?.[key];
    if (answer === null || answer === undefined || answer === "") return [];
    return Array.isArray(answer) ? answer : [answer];
  });
}

function distribution(question, responses) {
  const answers = answersFor(responses, question.key).map(String);
  const counts = new Map();
  answers.forEach((answer) => counts.set(answer, (counts.get(answer) || 0) + 1));
  return [...counts.entries()].map(([value, count]) => ({ value, label: displayFor(question, value), count, percent: percent(count, responses.length) })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function questionInsight(question, responses) {
  responses = compatibleResponses(question, responses);
  const answered = answersFor(responses, question.key);
  if (!answered.length || question.type === "short_text") return null;
  if (question.type === "rating") {
    const values = answered.map(Number).filter(Number.isFinite);
    if (!values.length) return null;
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return { key: question.key, label: labelFor(question), type: "rating", role: question.analytics_role, answered: values.length, average: Number(average.toFixed(2)), distribution: distribution(question, responses) };
  }
  const values = distribution(question, responses);
  if (!values.length) return null;
  if (question.type === "price_choice") {
    const priced = answered.map((value) => optionFor(question, String(value))).filter((option) => Number.isFinite(Number(option?.amount)));
    const average = priced.length ? priced.reduce((sum, option) => sum + Number(option.amount), 0) / priced.length : null;
    return { key: question.key, label: labelFor(question), type: "price", role: question.analytics_role, answered: answered.length, average: average === null ? null : Number(average.toFixed(2)), currency: priced[0]?.currency || "MYR", distribution: values };
  }
  return { key: question.key, label: labelFor(question), type: question.type === "multi_choice" ? "multi" : "choice", role: question.analytics_role, answered: answered.length, distribution: values };
}

function segmentInsights(questions, responses, outcomes) {
  const demographic = questions.filter(isDemographic);
  const outcome = outcomes.find((item) => item.type === "rating") || outcomes.find((item) => item.type === "choice");
  if (!demographic.length || !outcome || responses.length < 3) return [];
  const outcomeQuestion = questions.find((question) => question.key === outcome.key);
  return demographic.flatMap((segment) => {
    const compatible = compatibleResponses(segment, compatibleResponses(outcomeQuestion, responses));
    const groups = new Map();
    compatible.forEach((response) => {
      const value = response?.answers?.[segment.key];
      const answer = response?.answers?.[outcome.key];
      if (value === undefined || answer === undefined || answer === "") return;
      const key = String(value);
      const group = groups.get(key) || [];
      group.push(answer);
      groups.set(key, group);
    });
    const ranked = [...groups.entries()].filter(([, answers]) => answers.length >= 2).map(([value, answers]) => {
      if (outcome.type === "rating") return { segment: displayFor(segment, value), value: Number((answers.map(Number).filter(Number.isFinite).reduce((sum, item) => sum + item, 0) / answers.length).toFixed(2)), count: answers.length, kind: "average" };
      const counts = new Map(); answers.forEach((answer) => counts.set(String(answer), (counts.get(String(answer)) || 0) + 1));
      const [top, count] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0] || [];
      return { segment: displayFor(segment, value), value: displayFor(questions.find((question) => question.key === outcome.key), top), count, kind: "top" };
    }).filter((item) => Number.isFinite(item.value) || item.value);
    return ranked.length > 1 ? [{ segmentLabel: labelFor(segment), outcomeLabel: outcome.label, values: ranked }] : [];
  });
}

export function buildProductFeedbackInsights({ questions = [], responses = [] } = {}) {
  const questionInsights = questions.map((question) => questionInsight(question, responses)).filter(Boolean);
  const findings = questionInsights.slice().sort((left, right) => (right.role ? 1 : 0) - (left.role ? 1 : 0)).slice(0, 4).map((item) => {
    if (item.type === "rating") return `${item.label} averages ${item.average.toFixed(2)} out of 5 across ${item.answered} response${item.answered === 1 ? "" : "s"}.`;
    if (item.type === "price" && item.average !== null) return `${item.label} averages ${item.currency} ${item.average.toFixed(2)} across ${item.answered} selections.`;
    const top = item.distribution[0];
    return `${top.label} is the leading response to ${item.label} (${top.percent}%${item.type === "multi" ? " selected" : ""}).`;
  });
  const sampleNote = responses.length < 5 ? `Directional only: based on ${responses.length} response${responses.length === 1 ? "" : "s"}.` : `${responses.length} responses analysed.`;
  return { responseCount: responses.length, sampleNote, questionInsights, findings, segments: segmentInsights(questions, responses, questionInsights) };
}
