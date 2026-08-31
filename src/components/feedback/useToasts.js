import { useCallback, useEffect, useRef, useState } from "react";

// Presentation only. Each workspace owns its own messages and timer lifetime.
export default function useToasts() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Set());
  useEffect(() => () => {
    timers.current.forEach(window.clearTimeout);
    timers.current.clear();
  }, []);
  const dismiss = useCallback((id) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const notify = useCallback(({ title, message = "", tone = "success" }) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, title, message, tone }]);
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      dismiss(id);
    }, 3200);
    timers.current.add(timer);
  }, [dismiss]);
  return { toasts, notify, dismiss };
}
