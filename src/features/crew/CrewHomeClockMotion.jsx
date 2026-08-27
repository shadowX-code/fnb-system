import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

export default function CrewHomeClockMotion({ attendanceMode, transition, loading, hasException = false, children }) {
  const root = useRef(null);

  useGSAP((context, contextSafe) => {
    const rootNode = root.current;
    if (!rootNode || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;

    const halo = rootNode.querySelector(".crew-home-clock-halo");
    const ring = rootNode.querySelector(".crew-home-clock-semantic-ring");
    const orbitHighlight = rootNode.querySelector(".crew-home-clock-orbit-highlight");
    const action = rootNode.querySelector(".crew-home-clock-action");
    const state = attendanceMode === "completed" || transition === "confirmed" ? "success" : "default";

    const isReadyIdle = attendanceMode === "ready" && !loading && !transition && !hasException;
    if (isReadyIdle) {
      gsap.to(halo, { opacity: 0.62, scale: 1.018, duration: 7, ease: "sine.inOut", repeat: -1, yoyo: true });
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
    <span className="crew-home-clock-orbit-highlight" aria-hidden="true" />
    {children}
  </div>;
}
