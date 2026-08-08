import { useEffect, useRef, useState } from "react";

export default function useFactoryNumberPreview({ assignedValue = "", previewKey = "", loadPreview, enabled = true, scope }) {
  const [state, setState] = useState(() => ({ value: assignedValue, loading: enabled && !assignedValue, error: false }));
  const [retryVersion, setRetryVersion] = useState(0);
  const requestRef = useRef(0);
  const loadPreviewRef = useRef(loadPreview);
  loadPreviewRef.current = loadPreview;

  useEffect(() => {
    if (assignedValue) {
      setState({ value: assignedValue, loading: false, error: false });
      return undefined;
    }
    if (!enabled || !previewKey) {
      setState({ value: "", loading: false, error: false });
      return undefined;
    }

    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    let active = true;
    setState((current) => ({ ...current, loading: true, error: false }));
    Promise.resolve(loadPreviewRef.current())
      .then((value) => {
        if (!active || requestRef.current !== requestId) return;
        setState({ value: String(value || "").trim(), loading: false, error: false });
      })
      .catch((error) => {
        if (!active || requestRef.current !== requestId) return;
        console.error(`factory.${scope || "number"}.preview`, error);
        setState({ value: "", loading: false, error: true });
      });

    return () => {
      active = false;
      if (requestRef.current === requestId) requestRef.current += 1;
    };
  }, [assignedValue, enabled, previewKey, retryVersion, scope]);

  return { ...state, retry: () => setRetryVersion((current) => current + 1) };
}
