import { formatCrewDate, formatCrewTime, crewLocale } from "./crewI18n.js";

export const formatTime = (value) => formatCrewTime(value, { hour: "2-digit", minute: "2-digit" });
export const formatEmploymentType = (value) => String(value || "").split(/[_-]/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("-");
export const malaysiaDateKey = (value = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
export const formatHomeDate = (value = new Date()) => formatCrewDate(value, { weekday: "short", day: "numeric", month: "short" });
export const formatHomeClock = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat(crewLocale(), { timeZone: "Asia/Kuala_Lumpur", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(value));
  return {
    time: `${parts.find((part) => part.type === "hour")?.value || "—"}:${parts.find((part) => part.type === "minute")?.value || "—"}`,
    period: (parts.find((part) => part.type === "dayPeriod")?.value || "").toUpperCase(),
  };
};
export const formatDuration = (start, end = new Date()) => {
  const milliseconds = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor(milliseconds % 3600000 / 60000);
  const seconds = Math.floor(milliseconds % 60000 / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};
export const formatRosterTime = (value) => {
  if (!value) return "—";
  const [hours, minutes] = String(value).split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(crewLocale(), { hour: "numeric", minute: "2-digit" });
};
export const rosterEntryLabel = (entry, t) => ({ off: t("schedule.off"), leave: t("schedule.annualLeave"), medical: "MC", annual_leave: t("schedule.annualLeave"), medical_leave: t("schedule.medicalLeave"), unpaid_leave: t("schedule.unpaidLeave"), other_leave: t("schedule.otherLeave") }[entry?.entry_type] || entry?.template?.name || t("schedule.working"));
export const distanceMeters = (a, b, c, d) => {
  const radians = (value) => value * Math.PI / 180;
  const latitude = radians(c - a);
  const longitude = radians(d - b);
  const point = Math.sin(latitude / 2) ** 2 + Math.cos(radians(a)) * Math.cos(radians(c)) * Math.sin(longitude / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(point), Math.sqrt(1 - point));
};
export const getLocation = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) return reject(new Error("Device location unavailable"));
  navigator.geolocation.getCurrentPosition(
    (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_meters: position.coords.accuracy }),
    (cause) => reject(new Error(cause.code === 1 ? "Location permission unavailable" : "Device location unavailable")),
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
});
