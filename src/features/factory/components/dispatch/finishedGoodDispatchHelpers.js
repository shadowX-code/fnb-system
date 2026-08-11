import { isFactoryPermissionError } from "../../utils/factoryPermissions.js";
import { strictDateValue, strictTimeValueMinutes } from "../../../../services/factoryService.js";
import { factoryTimeAmPmLabel } from "../productionExecution/productionExecutionHelpers.js";

export function finishedGoodDispatchOperatorError(error, fallback = "Unable to save the Dispatch. Please retry.") {
  if (isFactoryPermissionError(error)) return "Your current role does not allow this Dispatch action.";
  const message = String(error?.message || "").trim();
  const safeMessages = [
    "Select a Customer.",
    "Dispatch Date is required.",
    "Add at least one dispatch item.",
    "Every dispatch item needs a Packaging SKU",
    "Confirm a complete batch allocation",
    "Clear or confirm a complete batch allocation",
    "Allocated Qty must exactly equal Dispatch Qty.",
    "Allocated quantity exceeds available batch balance.",
    "Selected finished-goods batch is unavailable.",
    "Expired finished-goods batches cannot be dispatched.",
    "Selected batch is not in an active Finished Goods storage location.",
    "Only draft dispatches can be",
    "Insufficient finished goods balance",
    "Dispatch request ID is required.",
    "This Dispatch request was already completed with different details.",
    "This Dispatch request is already linked to another Dispatch.",
    "This Dispatch is linked to another request.",
    "Packaging SKU is no longer active.",
  ];
  return safeMessages.some((value) => message.startsWith(value)) ? message : fallback;
}

export function createFinishedGoodDispatchRequestId() {
  return crypto.randomUUID();
}

export function factoryActivityDateTime(dateValue, timeValue, timestampValue = "") {
  const dateTimestamp = strictDateValue(dateValue);
  const timeMinutes = strictTimeValueMinutes(String(timeValue || "").slice(0, 5));
  if (dateTimestamp !== null && timeMinutes !== null) {
    const [year, month, day] = String(dateValue).split("-");
    const monthLabel = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1];
    const localDate = new Date(Number(year), Number(month) - 1, Number(day), Math.floor(timeMinutes / 60), timeMinutes % 60);
    return {
      sortValue: localDate.getTime(),
      dateLabel: monthLabel ? `${day} ${monthLabel} ${year}` : "—",
      timeLabel: factoryTimeAmPmLabel(timeValue),
    };
  }
  const timestamp = new Date(timestampValue);
  if (Number.isNaN(timestamp.getTime())) return { sortValue: 0, dateLabel: "—", timeLabel: "—" };
  return {
    sortValue: timestamp.getTime(),
    dateLabel: timestamp.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    timeLabel: timestamp.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: true }).toUpperCase(),
  };
}

export function validDispatchPackQty(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && Number.isInteger(numeric) && numeric > 0;
}
