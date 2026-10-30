import { useEffect, useState } from "react";
import { renderLabel } from "./labelRenderer.js";
export default function useLabelPreview(snapshot) {
  const [result, setResult] = useState({
    image: null,
    error: "",
    loading: true,
  });
  const key = JSON.stringify(snapshot);
  useEffect(() => {
    let active = true;
    setResult({ image: null, error: "", loading: true });
    const timer = setTimeout(() => {
      renderLabel(snapshot)
        .then((rendered) => {
          if (active)
            setResult({ image: rendered.preview, error: "", loading: false });
        })
        .catch((error) => {
          if (active)
            setResult({ image: null, error: error.message, loading: false });
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key]);
  return result;
}
