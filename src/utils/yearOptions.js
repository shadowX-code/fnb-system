export function currentBusinessYear() {
  return new Date().getFullYear();
}

export function distinctYearsFrom(values = []) {
  return [...new Set(values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 1900 && value < 3000))]
    .sort((a, b) => a - b);
}

export function buildDynamicYearOptions(years = [], currentYear = currentBusinessYear()) {
  const historicalYears = distinctYearsFrom(years);
  const fallbackYears = historicalYears.length
    ? historicalYears
    : [Number(currentYear) - 1, Number(currentYear), Number(currentYear) + 1];
  return distinctYearsFrom([...fallbackYears, Number(currentYear), Number(currentYear) + 1]);
}

export function yearsFromRecords(records = [], key = "year") {
  return distinctYearsFrom(records.map((record) => record?.[key]));
}
