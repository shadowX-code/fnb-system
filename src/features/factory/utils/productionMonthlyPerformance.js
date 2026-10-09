export function monthlyPerformanceModel(snapshot) {
  const [year, month] = snapshot.month.split("-").map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const records = new Map(snapshot.days.map(day => [day.day, day]));
  const days = Array.from({ length: count }, (_, index) => {
    const day = `${snapshot.month}-${String(index + 1).padStart(2, "0")}`;
    const row = records.get(day);
    const future = day > snapshot.today;
    return {
      ...row, day, number: index + 1,
      records: future ? [] : row?.records || [],
      state: future ? "future" : row?.missing_output_runs > 0 ? "missing" : "recorded",
      completed_runs: future ? 0 : Number(row?.completed_runs || 0),
      output_kg: future || row?.missing_output_runs > 0 ? null : Number(row?.output_kg || 0),
      productivity: !future && Number(row?.jo_hours) > 0 ? Number(row.productivity_output_kg) / Number(row.jo_hours) : null,
    };
  });
  const sum = key => snapshot.days.reduce((total, day) => total + Number(day[key] || 0), 0);
  const hours = sum("jo_hours");
  return { days, totalOutput: sum("output_kg"), completedRuns: sum("completed_runs"),
    productivity: hours > 0 ? sum("productivity_output_kg") / hours : null,
    hours, productivityRuns: sum("productivity_runs"), missingOutputRuns: sum("missing_output_runs"),
    invalidDurationRuns: sum("invalid_duration_runs"), unattributedRuns: Number(snapshot.unattributed_runs || 0),
  };
}

export const performanceNumber = value => value == null ? "—" : new Intl.NumberFormat("en-MY", { maximumFractionDigits: 2 }).format(value);
