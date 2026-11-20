export const STOCK_CHECK_SKIP_REASONS = [
  { value: "stockInUse", label: "Stock In Use" },
  { value: "cannotAccess", label: "Cannot Access" },
  { value: "pendingVerification", label: "Pending Verification" },
  { value: "itemNotFound", label: "Item Not Found" },
  { value: "other", label: "Other" },
];

const OTHER_PREFIX = "Other: ";

export function stockCheckSkipReason(selection, explanation) {
  if (selection === "other") {
    const text = explanation.trim();
    return text && OTHER_PREFIX + text;
  }
  return STOCK_CHECK_SKIP_REASONS.find(option => option.value === selection)?.label || "";
}

export function localizeStockCheckSkipReason(reason, t) {
  if (reason.startsWith(OTHER_PREFIX)) {
    return `${t("inventory.itemSkipReasons.other")}: ${reason.slice(OTHER_PREFIX.length)}`;
  }
  const option = STOCK_CHECK_SKIP_REASONS.find(option => option.label === reason);
  return option ? t(`inventory.itemSkipReasons.${option.value}`) : reason;
}
