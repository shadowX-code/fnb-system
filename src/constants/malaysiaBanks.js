// Canonical stored names; historical Employee values remain unchanged until explicitly replaced.
export const MALAYSIA_BANKS = Object.freeze([
  "Maybank", "CIMB Bank", "Public Bank", "RHB Bank", "Hong Leong Bank", "AmBank",
  "Bank Islam", "Bank Muamalat", "Alliance Bank", "Affin Bank", "BSN", "Bank Rakyat",
  "UOB Malaysia", "OCBC Malaysia", "HSBC Malaysia", "Standard Chartered Malaysia", "Citibank Malaysia",
]);

export function malaysiaBankOptions(currentValue = "") {
  const options = MALAYSIA_BANKS.map(name => ({ value: name, label: name }));
  if (currentValue && !MALAYSIA_BANKS.includes(currentValue)) {
    options.unshift({ value: currentValue, label: `${currentValue} (Existing value)` });
  }
  return [{ value: "", label: "Not provided" }, ...options];
}

export function hasCompleteEmployeeBankInfo(employee) {
  return [employee?.bank_name, employee?.bank_account_name, employee?.bank_account_number]
    .every(value => typeof value === "string" && value.trim().length > 0);
}
