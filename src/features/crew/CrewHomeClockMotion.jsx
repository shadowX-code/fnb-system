import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

export default function CrewHomeClockMotion({ attendanceMode, transition, loading, children }) {
  const root = useRef(null);

  useGSAP(() => {
    const rootNode = root.current;
    if (!rootNode || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;

    const halo = rootNode.querySelector(".crew-home-clock-halo");
    const ring = rootNode.querySelector(".crew-home-clock-semantic-ring");
    const action = rootNode.querySelector(".crew-home-clock-action");
    const state = attendanceMode === "completed" || transition === "confirmed" ? "success" : "default";
    let removePressListener = () => {};
    const context = gsap.context(() => {
      gsap.set([halo, ring, action].filter(Boolean), { clearProps: "transform,opacity" });

      if (attendanceMode === "ready" && !loading && !transition && halo) {
        gsap.to(halo, { opacity: 0.72, scale: 1.03, duration: 3.1, ease: "sine.inOut", repeat: -1, yoyo: true });
      }

      if ((transition === "locating" || transition === "scanning") && ring) {
        gsap.to(ring, { rotation: 360, duration: 1.25, ease: "none", repeat: -1, transformOrigin: "50% 50%" });
      }

      if (transition === "confirmed") {
        gsap.timeline()
          .fromTo(ring, { opacity: 0.46, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.2, ease: "power2.out" })
          .fromTo(action, { scale: 0.96 }, { scale: 1, duration: 0.2, ease: "back.out(2)" }, 0);
      }

      const press = () => {
        if (!action || action.disabled) return;
        gsap.fromTo(action, { scale: 1 }, { scale: 0.965, duration: 0.08, ease: "power2.out", yoyo: true, repeat: 1 });
      };
      action?.addEventListener("pointerdown", press);
      removePressListener = () => action?.removeEventListener("pointerdown", press);
    }, root);

    rootNode.dataset.clockState = state;
    return () => {
      removePressListener();
      context.revert();
    };
  }, { scope: root, dependencies: [attendanceMode, transition, loading], revertOnUpdate: true });

  return <div ref={root} className={`crew-home-clock-zone is-${attendanceMode}${transition ? ` is-${transition}` : ""}`}>
    <span className="crew-home-clock-halo" aria-hidden="true" />
    <span className="crew-home-clock-semantic-ring" aria-hidden="true" />
    {children}
  </div>;
}
