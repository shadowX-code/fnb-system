import { useRef } from "react";
import { Check, ClipboardCheck, TriangleAlert } from "lucide-react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

export default function CrewHomeTaskActivityMotion({ state = "pending" }) {
  const root = useRef(null);

  useGSAP(() => {
    const marker = root.current?.querySelector(".crew-home-task-activity-mark");
    if (!marker || state === "complete" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const isOverdue = state === "overdue";
    return gsap.to(marker, {
      opacity: isOverdue ? 1 : 0.92,
      scale: isOverdue ? 1.1 : 1.075,
      duration: isOverdue ? 1.25 : 1.5,
      ease: "sine.inOut",
      repeat: -1,
      yoyo: true,
      transformOrigin: "50% 50%",
    });
  }, { scope: root, dependencies: [state], revertOnUpdate: true });

  const Icon = state === "complete" ? Check : state === "overdue" ? TriangleAlert : ClipboardCheck;
  return <span ref={root} className={`crew-home-task-activity is-${state}`} title={state === "complete" ? "All tasks completed" : state === "overdue" ? "Overdue task needs attention" : "Tasks still in progress"} aria-hidden="true"><span className="crew-home-task-activity-mark"><Icon size={14} /></span></span>;
}
