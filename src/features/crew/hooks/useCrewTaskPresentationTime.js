import { useCallback, useEffect, useState } from "react";

// Refresh presentation at Task window boundaries, including off-shift sessions.
// No Task reads or lifecycle writes are triggered by this clock.
export default function useCrewTaskPresentationTime(tasks = []) {
  const [now, setNow] = useState(() => Date.now());
  const refresh = useCallback(() => setNow(Date.now()), []);
  const boundaries = tasks.filter(Boolean).flatMap((task) => {
    const date = task.business_date || task.task_date || task.effective_date;
    return [task.available_from || (date ? `${date}T00:00:00+08:00` : ""), task.due_at || task.available_until];
  }).filter(Boolean).join("|");
  useEffect(refresh, [boundaries, refresh]);
  useEffect(() => {
    const future = boundaries.split("|").map(Date.parse).filter((value) => Number.isFinite(value) && value >= Date.now());
    const timer = future.length ? window.setTimeout(refresh, Math.min(2147483647, Math.max(1, Math.min(...future) - Date.now() + 1))) : null;
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [boundaries, now, refresh]);
  return [now, refresh];
}
