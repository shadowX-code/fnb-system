import { Check } from "lucide-react";

export default function WorkflowStepper({ steps, current, complete = false, label = "Steps" }) {
  return (
    <ol aria-label={label} className="flex gap-1">
      {steps.map((step, index) => {
        const done = index < current || (complete && index === current);
        const active = index === current && !done;
        const marker = done ? "badge-success border"
          : active ? "border border-action-primary bg-action-primary text-white"
            : "border border-border bg-surface text-text-secondary";
        return (
          <li key={step} aria-current={active ? "step" : undefined}
            className={`relative flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center text-[11px] leading-tight sm:text-xs ${active || done ? "text-text-primary" : "text-text-secondary"} ${active ? "font-semibold" : ""}`}>
            {index > 0 && <span aria-hidden="true" className="absolute top-3 right-1/2 h-px w-[calc(100%+0.25rem)] bg-border" />}
            <span aria-hidden="true" className={`relative z-[1] grid size-6 place-items-center rounded-full text-[11px] font-semibold ${marker}`}>
              {done ? <Check size={13} /> : index + 1}
            </span>
            <span>{step}</span>
            {!active && <span className="sr-only">{done ? "Completed" : "Pending"}</span>}
          </li>
        );
      })}
    </ol>
  );
}
