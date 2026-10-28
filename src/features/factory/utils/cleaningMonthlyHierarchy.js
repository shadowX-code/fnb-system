// Project only server-owned occurrences; never infer schedules or rewrite status.
export function cleaningMonthlyHierarchy(rows) {
  return rows.map(row => {
    const key = row.requirement_id || row.logical_requirement_id;
    const locations = new Map();
    for (const day of row.days || []) {
      for (const occurrence of day.occurrences || []) {
        const locationKey = occurrence.location_id || occurrence.location_name;
        if (!locations.has(locationKey)) locations.set(locationKey, {
          ...row, matrix_key: `${key}:location:${locationKey}`, location_name: occurrence.location_name || "Location", calendarCells: new Map(),
        });
        locations.get(locationKey).calendarCells.set(day.due_date, occurrence);
      }
    }
    return { ...row, matrix_key: key, calendarCells: new Map((row.days || []).map(day => [day.due_date, day])), children: [...locations.values()].sort((a, b) => a.location_name.localeCompare(b.location_name)) };
  });
}
