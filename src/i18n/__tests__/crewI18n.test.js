import { afterEach, describe, expect, it } from "vitest";
import i18n, { CREW_LANGUAGE_STORAGE_KEY, SUPPORTED_CREW_LANGUAGES } from "../index.js";
import { formatCrewDate, formatCrewMoney, translateStatus } from "../../features/crew/utils/crewI18n.js";

afterEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.removeItem(CREW_LANGUAGE_STORAGE_KEY);
});

describe("Crew i18n foundation", () => {
  it("ships English, Simplified Chinese and Bahasa Melayu with English fallback", () => {
    expect(SUPPORTED_CREW_LANGUAGES).toEqual(["en", "zh-CN", "ms"]);
    for (const language of SUPPORTED_CREW_LANGUAGES) {
      expect(i18n.getResourceBundle(language, "translation").nav.home).toBeTruthy();
    }
    expect(i18n.options.fallbackLng).toContain("en");
  });

  it("switches immediately and persists the Crew language preference", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(i18n.t("nav.home")).toBe("首页");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(localStorage.getItem(CREW_LANGUAGE_STORAGE_KEY)).toBe("zh-CN");

    await i18n.changeLanguage("ms");
    expect(i18n.t("nav.home")).toBe("Utama");
    expect(localStorage.getItem(CREW_LANGUAGE_STORAGE_KEY)).toBe("ms");
  });

  it("formats Malaysia dates, MYR and shared statuses using the active locale", async () => {
    const instant = "2026-08-15T02:30:00Z";
    expect(formatCrewMoney(120.72)).toContain("120.72");
    expect(formatCrewDate(instant, { day: "numeric", month: "short", year: "numeric" })).toContain("2026");
    expect(translateStatus("in_progress")).toBe("In Progress");

    await i18n.changeLanguage("zh-CN");
    expect(translateStatus("in_progress")).toBe("进行中");
    expect(formatCrewDate(instant, { day: "numeric", month: "short", year: "numeric" })).toContain("2026");
  });

  it("uses localized system copy with English configured as the safe fallback", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(i18n.t("home.workedDuration")).toBe("工作时长");
    expect(i18n.options.fallbackLng).toContain("en");
  });

  it("uses locale-aware singular and plural day units", async () => {
    expect(i18n.t("common.day", { count: 1 })).toBe("day");
    expect(i18n.t("common.day", { count: 2 })).toBe("days");
    await i18n.changeLanguage("ms");
    expect(i18n.t("common.day", { count: 1 })).toBe("hari");
    expect(i18n.t("common.day", { count: 2 })).toBe("hari");
  });
});
