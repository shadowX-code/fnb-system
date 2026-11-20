export const MONTH_END_CLOSING = "Month-End Closing";

// The controls represent Malaysia business time, even on a device in another zone.
export const toPhysicalCountCutoff = (localValue) => localValue ? `${localValue}+08:00` : null;

export function toClosingLocalTime(value) {
  if (!value) return "";
  const instant = new Date(value);
  return new Date(instant.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 19);
}
