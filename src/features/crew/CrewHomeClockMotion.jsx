import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

export default function CrewHomeClockMotion({ attendanceMode, transition, loading, hasException = false, children }) {
  const root = useRef(null);

  useGSAP((context, contextSafe) => {
    const rootNode = root.current;
    if (!rootNode || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;

    const ring = rootNode.querySelector(".crew-home-clock-semantic-ring");
    const orbitHighlight = rootNode.querySelector(".crew-home-clock-orbit-highlight");
    const action = rootNode.querySelector(".crew-home-clock-action");
    const state = attendanceMode === "completed" || transition === "confirmed" ? "success" : "default";

    const isReadyIdle = attendanceMode === "ready" && !loading && !transition && !hasException;
    if (isReadyIdle) {
      gsap.to(orbitHighlight, { rotation: 360, duration: 5.8, ease: "none", repeat: -1, transformOrigin: "50% 50%" });
    }

    if (transition === "locating" || transition === "scanning") {
      gsap.to(orbitHighlight, { opacity: 0.9, rotation: 360, duration: 0.95, ease: "none", repeat: -1, transformOrigin: "50% 50%" });
    }

    if (transition === "confirmed") {
      gsap.timeline()
        .fromTo(ring, { opacity: 0.42, scale: 0.96 }, { opacity: 0.72, scale: 1, duration: 0.2, ease: "power2.out" })
        .fromTo(action, { scale: 0.965 }, { scale: 1, duration: 0.2, ease: "power2.out" }, 0);
    }

    const press = contextSafe(() => {
      if (!action || action.disabled) return;
      gsap.fromTo(action, { scale: 1 }, { scale: 0.965, duration: 0.09, ease: "power2.out", yoyo: true, repeat: 1 });
    });
    action?.addEventListener("pointerdown", press);

    rootNode.dataset.clockState = state;
    return () => {
      action?.removeEventListener("pointerdown", press);
    };
  }, { scope: root, dependencies: [attendanceMode, transition, loading, hasException], revertOnUpdate: true });

  return <div ref={root} className={`crew-home-clock-zone is-${attendanceMode}${transition ? ` is-${transition}` : ""}`}>
    <span className="crew-home-clock-halo" aria-hidden="true" />
    <span className="crew-home-clock-semantic-ring" aria-hidden="true" />
    <svg className="crew-home-clock-orbit-highlight" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="crew-home-clock-energy-trail" x1="88" y1="112" x2="120" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--crew-color-cyan)" stopOpacity="0" />
          <stop offset="0.54" stopColor="var(--crew-color-cyan)" stopOpacity="0.16" />
          <stop offset="0.82" stopColor="var(--crew-color-cyan)" stopOpacity="0.62" />
          <stop offset="1" stopColor="var(--crew-color-cyan)" stopOpacity="0.94" />
        </linearGradient>
      </defs>
      <circle className="crew-home-clock-orbit-trail" cx="60" cy="60" r="59" />
      <circle className="crew-home-clock-orbit-leading-edge" cx="119" cy="60" r="1.15" />
    </svg>
    {children}
  </div>;
}
