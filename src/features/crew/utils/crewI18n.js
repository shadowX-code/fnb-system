import i18n from "../../../i18n/index.js";

export const MALAYSIA_TIME_ZONE = "Asia/Kuala_Lumpur";
export const crewLocale = (language = i18n.resolvedLanguage || i18n.language) => language === "zh-CN" ? "zh-CN" : language === "ms" ? "ms-MY" : "en-MY";
export const formatCrewDate = (value, options = {}) => value ? new Intl.DateTimeFormat(crewLocale(), { timeZone: MALAYSIA_TIME_ZONE, ...options }).format(new Date(value)) : "—";
export const formatCrewTime = (value, options = {}) => value ? new Intl.DateTimeFormat(crewLocale(), { timeZone: MALAYSIA_TIME_ZONE, hour: "numeric", minute: "2-digit", ...options }).format(new Date(value)) : "—";
export const formatCrewMoney = (value) => new Intl.NumberFormat(crewLocale(), { style: "currency", currency: "MYR", currencyDisplay: "symbol", minimumFractionDigits: 2 }).format(Number(value || 0)).replace(/^MYR\s?/, "RM ");
// Cash records use the same fixed operational date standard everywhere, while
// the time remains locale-aware for the active Crew language.
export const formatCrewOperationalDate = (value) => value
  ? new Intl.DateTimeFormat("en-GB", { timeZone: MALAYSIA_TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value))
  : "—";
export const formatCrewOperationalDateTime = (value) => value
  ? `${formatCrewOperationalDate(value)} · ${formatCrewTime(value, { hour12: true }).replace(/\b(am|pm)\b/gi, (meridiem) => meridiem.toUpperCase())}`
  : "—";
export const formatCrewEmployee = (employee, fallback = "—") => {
  if (!employee) return fallback;
  if (typeof employee === "string") return employee || fallback;
  return employee.name || employee.full_name || employee.employee_name || fallback;
};
export const statusKey = (status) => `status.${String(status || "pending").toLowerCase().replaceAll(" ", "_")}`;
export const translateStatus = (status, t = i18n.t.bind(i18n)) => t(statusKey(status), { defaultValue: String(status || "") });
