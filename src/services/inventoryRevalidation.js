// Notification only: readers retain their own scoped, complete-read authority.
const listeners = new Set();
export function subscribeInventoryRevalidation(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function invalidateInventoryReads(context) {
  for (const listener of listeners) listener(context);
}
