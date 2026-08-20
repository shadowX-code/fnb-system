import i18n from "../../../i18n/index.js";

export const MALAYSIA_TIME_ZONE = "Asia/Kuala_Lumpur";
export const crewLocale = (language = i18n.resolvedLanguage || i18n.language) => language === "zh-CN" ? "zh-CN" : language === "ms" ? "ms-MY" : "en-MY";
export const formatCrewDate = (value, options = {}) => value ? new Intl.DateTimeFormat(crewLocale(), { timeZone: MALAYSIA_TIME_ZONE, ...options }).format(new Date(value)) : "—";
export const formatCrewTime = (value, options = {}) => value ? new Intl.DateTimeFormat(crewLocale(), { timeZone: MALAYSIA_TIME_ZONE, hour: "numeric", minute: "2-digit", ...options }).format(new Date(value)) : "—";
export const formatCrewMoney = (value) => new Intl.NumberFormat(crewLocale(), { style: "currency", currency: "MYR", currencyDisplay: "symbol", minimumFractionDigits: 2 }).format(Number(value || 0)).replace(/^MYR\s?/, "RM ");
export const statusKey = (status) => `status.${String(status || "pending").toLowerCase().replaceAll(" ", "_")}`;
export const translateStatus = (status, t = i18n.t.bind(i18n)) => t(statusKey(status), { defaultValue: String(status || "") });
