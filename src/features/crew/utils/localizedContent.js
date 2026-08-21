export const CONTENT_LANGUAGES = ["en", "zh-CN", "ms"];

export const CONTENT_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "ms", label: "Bahasa Melayu" },
];

export const LOCALIZATION_STATUS = {
  original: { label: "Original", tone: "success" },
  ai_translated: { label: "AI Translated", tone: "info" },
  reviewed: { label: "Reviewed", tone: "success" },
  outdated: { label: "Outdated", tone: "warning" },
  missing: { label: "Missing", tone: "neutral" },
};

export function detectContentLanguage(value = "") {
  const text = String(value).replace(/<[^>]*>/g, " ").trim();
  if (!text) return "en";
  const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
  if (han / Math.max(text.length, 1) > 0.12) return "zh-CN";
  const malaySignals = text.toLowerCase().match(/\b(yang|dan|untuk|dengan|anda|sila|sebelum|selepas|pekerja|pelanggan|kedai|tugas|keselamatan|makanan|pembersihan|pembukaan|penutupan|stesen|kerja|semakan|pengakuan)\b/g) || [];
  return malaySignals.length >= 1 ? "ms" : "en";
}

const value = (source) => JSON.stringify(String(source ?? ""));
const stableSegment = (entity, fallback) => String(entity?.id || fallback).toLowerCase().replace(/[^a-z0-9_.:-]/g, "-");
const unit = (unitKey, fieldKind, sourceLanguage, sourceValue, label) => ({
  unit_key: unitKey,
  field_kind: fieldKind,
  source_language: sourceLanguage,
  source_value: JSON.parse(value(sourceValue)),
  label,
});

export function sopLocalizationUnits(sop, version, sections, sourceLanguage) {
  const rows = [unit("sop.title", "plain_text", sourceLanguage, sop?.title, "SOP title")];
  (sections || []).forEach((section, index) => {
    const parsed = parseSopBody(section.body, section.key_point);
    const key = `sections.${stableSegment(section, index + 1)}`;
    rows.push(unit(`${key}.title`, "plain_text", sourceLanguage, section.title, `Section ${index + 1} title`));
    rows.push(unit(`${key}.content`, "rich_text", sourceLanguage, section.editorHtml ?? parsed.html, `Section ${index + 1} content`));
    const keyPoint = section.keyPointContent ?? section.key_point_content ?? parsed.keyPointContent;
    if (String(keyPoint || "").trim()) rows.push(unit(`${key}.key_point`, "plain_text", sourceLanguage, keyPoint, `Section ${index + 1} key point`));
    const caption = section.pendingImage?.caption ?? section.media?.caption ?? section.media_caption;
    if (String(caption || "").trim()) rows.push(unit(`${key}.image_caption`, "image_caption", sourceLanguage, caption, `Section ${index + 1} image caption`));
  });
  return rows.filter((row) => String(row.source_value || "").trim());
}

export function onboardingLocalizationUnits(journey, sourceLanguage) {
  const rows = [unit("journey.title", "plain_text", sourceLanguage, journey?.name, "Onboarding title")];
  (journey?.modules || []).forEach((module, moduleIndex) => {
    const moduleKey = `modules.${stableSegment(module, moduleIndex + 1)}`;
    rows.push(unit(`${moduleKey}.title`, "plain_text", sourceLanguage, module.title, `Module ${moduleIndex + 1} title`));
    if (module.description) rows.push(unit(`${moduleKey}.description`, "plain_text", sourceLanguage, module.description, `Module ${moduleIndex + 1} description`));
    (module.lessons || []).forEach((lesson, lessonIndex) => {
      const lessonKey = `${moduleKey}.lessons.${stableSegment(lesson, lessonIndex + 1)}`;
      rows.push(unit(`${lessonKey}.title`, "plain_text", sourceLanguage, lesson.title, `Lesson ${moduleIndex + 1}.${lessonIndex + 1} title`));
      (lesson.blocks || []).forEach((block, blockIndex) => {
        if (!["text", "key_point", "intro", "steps", "scenario"].includes(block.block_type)) return;
        const blockId = stableSegment(block, blockIndex + 1);
        const blockKey = `${lessonKey}.blocks.${blockId}.content`;
        rows.push(unit(blockKey, block.payload?.body_html ? "rich_text" : "plain_text", sourceLanguage, block.payload?.body_html || block.payload?.body || block.payload?.text, `Lesson ${moduleIndex + 1}.${lessonIndex + 1} content ${blockIndex + 1}`));
        if (block.payload?.media?.caption) rows.push(unit(`${lessonKey}.blocks.${blockId}.image_caption`, "image_caption", sourceLanguage, block.payload.media.caption, `Lesson image caption`));
      });
      (lesson.quizzes || []).forEach((quiz, quizIndex) => {
        const quizKey = `${lessonKey}.quizzes.${stableSegment(quiz, quizIndex + 1)}`;
        rows.push(unit(`${quizKey}.title`, "plain_text", sourceLanguage, quiz.title, "Knowledge Check title"));
        (quiz.questions || []).forEach((question, questionIndex) => {
          const questionKey = `${quizKey}.questions.${stableSegment(question, questionIndex + 1)}`;
          rows.push(unit(`${questionKey}.prompt`, "plain_text", sourceLanguage, question.prompt, `Question ${questionIndex + 1}`));
          (question.options || []).forEach((option, optionIndex) => rows.push(unit(`${questionKey}.options.${stableSegment(option, optionIndex + 1)}`, "plain_text", sourceLanguage, option.label, `Question ${questionIndex + 1} option ${optionIndex + 1}`)));
        });
      });
    });
  });
  return rows.filter((row) => String(row.source_value || "").trim());
}

export function taskLocalizationUnits(task, sourceLanguage) {
  const rows = [unit("task.name", "plain_text", sourceLanguage, task?.name, "Task name")];
  (task?.blocks || []).forEach((block, index) => {
    const key = `blocks.${stableSegment(block, index + 1)}`;
    rows.push(unit(`${key}.title`, "plain_text", sourceLanguage, block.title, `Block ${index + 1} title`));
    if (block.description) rows.push(unit(`${key}.description`, "plain_text", sourceLanguage, block.description, `Block ${index + 1} instruction`));
    (block.config?.options || []).forEach((option, optionIndex) => rows.push(unit(`${key}.options.${stableSegment(typeof option === "string" ? null : option, optionIndex + 1)}`, "plain_text", sourceLanguage, typeof option === "string" ? option : option.label, `Block ${index + 1} option ${optionIndex + 1}`)));
  });
  return rows.filter((row) => String(row.source_value || "").trim());
}

export function resolveLocalizedValue(localizations, unitKey, fallback = "") {
  const candidate = localizations?.[unitKey];
  return typeof candidate === "string" ? candidate : candidate ?? fallback;
}

export function localizationStatus(unit, language) {
  if (!unit) return "missing";
  if (unit.source_language === language) return "original";
  return unit.translations?.[language]?.status || "missing";
}

export function localizationLanguageSummary(localization) {
  const units = Object.values(localization?.units || {});
  return CONTENT_LANGUAGES.map((language) => {
    const statuses = units.map((storedUnit) => localizationStatus(storedUnit, language));
    const isSource = units.some((storedUnit) => storedUnit.source_language === language);
    const status = isSource
      ? "original"
      : statuses.includes("outdated")
        ? "outdated"
        : statuses.includes("missing") || !statuses.length
          ? "missing"
          : statuses.includes("ai_translated")
            ? "ai_translated"
            : "reviewed";
    const label = CONTENT_LANGUAGE_OPTIONS.find((item) => item.value === language)?.label || language;
    return `${label}: ${LOCALIZATION_STATUS[status].label}`;
  }).join(" · ");
}

export function applySopLocalization(sop, localizations = {}) {
  if (!sop) return sop;
  const sections = [...(sop.sections || [])].sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0));
  return {
    ...sop,
    title: resolveLocalizedValue(localizations, "sop.title", sop.title),
    sections: sections.map((section, index) => {
      const key = `sections.${stableSegment(section, index + 1)}`;
      const parsed = parseSopBody(section.body, section.key_point);
      const html = resolveLocalizedValue(localizations, `${key}.content`, parsed.html);
      const keyPoint = resolveLocalizedValue(localizations, `${key}.key_point`, parsed.keyPointContent);
      return {
        ...section,
        title: resolveLocalizedValue(localizations, `${key}.title`, section.title),
        body: serializeSopBody(html, keyPoint),
        media_caption: resolveLocalizedValue(localizations, `${key}.image_caption`, section.media_caption),
      };
    }),
  };
}

export function applyTaskLocalization(task, localizations = {}) {
  if (!task) return task;
  return {
    ...task,
    name: resolveLocalizedValue(localizations, "task.name", task.name),
    blocks: (task.blocks || []).map((block, index) => {
      const key = `blocks.${stableSegment(block, index + 1)}`;
      const options = (block.config?.options || []).map((option, optionIndex) => {
        const translated = resolveLocalizedValue(localizations, `${key}.options.${stableSegment(typeof option === "string" ? null : option, optionIndex + 1)}`, typeof option === "string" ? option : option.label);
        return typeof option === "string" ? translated : { ...option, label: translated };
      });
      return {
        ...block,
        title: resolveLocalizedValue(localizations, `${key}.title`, block.title),
        description: resolveLocalizedValue(localizations, `${key}.description`, block.description),
        config: { ...(block.config || {}), options },
      };
    }),
  };
}

export function applyOnboardingLocalization(assignment, localizations = {}) {
  if (!assignment) return assignment;
  return {
    ...assignment,
    journey: { ...assignment.journey, name: resolveLocalizedValue(localizations, "journey.title", assignment.journey?.name) },
    modules: (assignment.modules || []).map((module, moduleIndex) => {
      const moduleKey = `modules.${stableSegment(module.module || module, moduleIndex + 1)}`;
      return {
        ...module,
        module: {
          ...module.module,
          title: resolveLocalizedValue(localizations, `${moduleKey}.title`, module.module?.title),
          description: resolveLocalizedValue(localizations, `${moduleKey}.description`, module.module?.description),
        },
        lessons: (module.lessons || []).map((lesson, lessonIndex) => {
          const lessonKey = `${moduleKey}.lessons.${stableSegment(lesson.lesson || lesson, lessonIndex + 1)}`;
          return {
            ...lesson,
            lesson: { ...lesson.lesson, title: resolveLocalizedValue(localizations, `${lessonKey}.title`, lesson.lesson?.title) },
            blocks: (lesson.blocks || []).map((block, blockIndex) => {
              const contentKey = `${lessonKey}.blocks.${stableSegment(block, blockIndex + 1)}`;
              const content = resolveLocalizedValue(localizations, `${contentKey}.content`, block.payload?.body_html || block.payload?.body || block.payload?.text);
              return { ...block, payload: { ...(block.payload || {}), body_html: content, media: block.payload?.media ? { ...block.payload.media, caption: resolveLocalizedValue(localizations, `${contentKey}.image_caption`, block.payload.media.caption) } : block.payload?.media } };
            }),
            quiz: lesson.quiz ? localizeQuiz(lesson.quiz, `${lessonKey}.quizzes.${stableSegment(lesson.quiz, 1)}`, localizations) : lesson.quiz,
          };
        }),
      };
    }),
  };
}

function localizeQuiz(quiz, quizKey, localizations) {
  return {
    ...quiz,
    title: resolveLocalizedValue(localizations, `${quizKey}.title`, quiz.title),
    questions: (quiz.questions || []).map((question, questionIndex) => {
      const questionKey = `${quizKey}.questions.${stableSegment(question, questionIndex + 1)}`;
      return {
        ...question,
        prompt: resolveLocalizedValue(localizations, `${questionKey}.prompt`, question.prompt),
        options: (question.options || []).map((option, optionIndex) => ({ ...option, label: resolveLocalizedValue(localizations, `${questionKey}.options.${stableSegment(option, optionIndex + 1)}`, option.label) })),
      };
    }),
  };
}
import { parseSopBody, serializeSopBody } from "./sopDocumentContent.js";
