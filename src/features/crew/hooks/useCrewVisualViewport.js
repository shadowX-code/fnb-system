import { useEffect } from "react";

export default function useCrewVisualViewport() {
  useEffect(() => {
    const update = () => {
      const viewport = window.visualViewport;
      const height = viewport?.height || window.innerHeight;
      const top = viewport?.offsetTop || 0;
      const keyboardInset = Math.max(0, window.innerHeight - height - top);
      document.documentElement.style.setProperty("--crew-mobile-keyboard-inset", `${Math.round(keyboardInset)}px`);
      document.documentElement.style.setProperty("--crew-mobile-visual-viewport-height", `${Math.round(height)}px`);
    };
    update();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--crew-mobile-keyboard-inset");
      document.documentElement.style.removeProperty("--crew-mobile-visual-viewport-height");
    };
  }, []);
}
