import { describe, expect, it } from "vitest";
import {
  applyOnboardingLocalization,
  applySopLocalization,
  applyTaskLocalization,
  detectContentLanguage,
  localizationStatus,
  onboardingLocalizationUnits,
  resolveLocalizedValue,
  taskLocalizationUnits,
} from "../localizedContent.js";

describe("Crew localized business content", () => {
  it("detects supported source languages and preserves an explicit fallback", () => {
    expect(detectContentLanguage("Welcome to the team")).toBe("en");
    expect(detectContentLanguage("欢迎加入我们的团队")).toBe("zh-CN");
    expect(detectContentLanguage("Sila semak tugas yang anda perlu lakukan sebelum kedai dibuka")).toBe("ms");
    expect(resolveLocalizedValue({}, "missing", "Source fallback")).toBe("Source fallback");
  });

  it("marks original, generated, reviewed, outdated and missing states honestly", () => {
    const unit = { source_language: "en", translations: { ms: { status: "ai_translated" }, "zh-CN": { status: "outdated" } } };
    expect(localizationStatus(unit, "en")).toBe("original");
    expect(localizationStatus(unit, "ms")).toBe("ai_translated");
    expect(localizationStatus(unit, "zh-CN")).toBe("outdated");
    expect(localizationStatus(unit, "fr")).toBe("missing");
  });

  it("localizes Task copy without changing block identity or response semantics", () => {
    const task = { id: "task-1", name: "Opening", blocks: [{ id: "block-1", title: "Count float", description: "Before opening", config: { options: [{ id: "option-a", label: "Yes" }] } }] };
    const localized = applyTaskLocalization(task, { "task.name": "开店", "blocks.block-1.title": "点算备用金", "blocks.block-1.options.option-a": "是" });
    expect(localized.name).toBe("开店");
    expect(localized.blocks[0].id).toBe("block-1");
    expect(localized.blocks[0].config.options[0]).toEqual({ id: "option-a", label: "是" });
    expect(taskLocalizationUnits(task, "en").map((row) => row.unit_key)).toEqual(["task.name", "blocks.block-1.title", "blocks.block-1.description", "blocks.block-1.options.option-a"]);
  });

  it("localizes quiz display text while preserving question and option IDs", () => {
    const assignment = { journey: { id: "journey-1", name: "Onboarding" }, modules: [{ module: { id: "module-1", title: "Welcome" }, lessons: [{ lesson: { id: "lesson-1", title: "Greeting" }, blocks: [], quiz: { id: "quiz-1", title: "Check", questions: [{ id: "question-1", prompt: "When?", options: [{ id: "option-1", label: "Now" }] }] } }] }] };
    const units = onboardingLocalizationUnits({ name: "Onboarding", modules: [{ id: "module-1", title: "Welcome", lessons: [{ id: "lesson-1", title: "Greeting", blocks: [], quizzes: [assignment.modules[0].lessons[0].quiz] }] }] }, "en");
    expect(units.some((row) => row.unit_key.endsWith("questions.question-1.options.option-1"))).toBe(true);
    const localized = applyOnboardingLocalization(assignment, { "journey.title": "入职培训", "modules.module-1.lessons.lesson-1.quizzes.quiz-1.questions.question-1.prompt": "什么时候？", "modules.module-1.lessons.lesson-1.quizzes.quiz-1.questions.question-1.options.option-1": "现在" });
    expect(localized.journey.id).toBe("journey-1");
    expect(localized.modules[0].lessons[0].quiz.questions[0].id).toBe("question-1");
    expect(localized.modules[0].lessons[0].quiz.questions[0].options[0]).toEqual({ id: "option-1", label: "现在" });
  });

  it("localizes SOP rich content through the existing sanitized document format", () => {
    const sop = { id: "version-1", title: "Safety", sections: [{ id: "section-1", title: "Hands", sort_order: 1, body: "<p>Wash hands</p>" }] };
    const localized = applySopLocalization(sop, { "sop.title": "安全", "sections.section-1.title": "双手", "sections.section-1.content": "<p>清洗双手</p>", "sections.section-1.key_point": "每次都要做" });
    expect(localized.title).toBe("安全");
    expect(localized.sections[0].body).toContain("清洗双手");
    expect(localized.sections[0].body).toContain("data-feedx-key-point");
  });
});
