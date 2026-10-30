import { useEffect, useState } from "react";
import { renderLabel } from "./labelRenderer.js";
export default function useLabelPreview(snapshot) {
  const [result, setResult] = useState({
    image: null,
    error: "",
    loading: true,
    issues: [],
  });
  const key = JSON.stringify(snapshot);
  useEffect(() => {
    let active = true;
    setResult((previous) => ({
      ...previous,
      error: "",
      loading: true,
      issues: [],
    }));
    const timer = setTimeout(() => {
      renderLabel(snapshot, { diagnostics: true })
        .then((rendered) => {
          if (active)
            setResult({
              image: rendered.preview,
              issues: rendered.issues,
              error:
                rendered.issues.find((issue) => issue.severity === "error")
                  ?.message || "",
              loading: false,
            });
        })
        .catch((error) => {
          if (active)
            setResult({
              image: null,
              error: error.message,
              loading: false,
              issues: [],
            });
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key]);
  return result;
}
