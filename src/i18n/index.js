import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en/crew.js";
import zhCN from "../locales/zh-CN/crew.js";
import ms from "../locales/ms/crew.js";

export const CREW_LANGUAGE_STORAGE_KEY = "feedx.crew.language";
export const SUPPORTED_CREW_LANGUAGES = ["en", "zh-CN", "ms"];

function storedLanguage() {
  try {
    const value = localStorage.getItem(CREW_LANGUAGE_STORAGE_KEY);
    return SUPPORTED_CREW_LANGUAGES.includes(value) ? value : "en";
  } catch { return "en"; }
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, "zh-CN": { translation: zhCN }, ms: { translation: ms } },
    lng: storedLanguage(),
    fallbackLng: "en",
    supportedLngs: SUPPORTED_CREW_LANGUAGES,
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    saveMissing: false,
  });
}

function syncDocument(language) {
  if (typeof document !== "undefined") document.documentElement.lang = language;
  try { localStorage.setItem(CREW_LANGUAGE_STORAGE_KEY, language); } catch { /* local preference is best-effort */ }
}
syncDocument(i18n.resolvedLanguage || i18n.language || "en");
i18n.on("languageChanged", syncDocument);

export default i18n;
