// SQL templates own time-of-day values; builder fields use their public task names.
export function taskDraftFromTemplate(template) {
  if (!template) return template;
  return {
    ...template,
    start_time: template.start_time ?? template.available_from ?? "",
    due_time: template.due_time ?? template.available_until ?? "",
  };
}

export function taskTimeError(task) {
  const start = task.start_time;
  const due = task.due_time;
  if (start && due && start.slice(0, 5) >= due.slice(0, 5)) return "Due time must be after Start time.";
  return "";
}
