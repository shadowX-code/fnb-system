import { Ellipsis, Pencil } from "lucide-react";
import { useState } from "react";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";
import FactoryRowAction from "./FactoryRowAction.jsx";

const menuItemClass = "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold text-text-primary transition hover:bg-primary/5 focus:bg-primary/10";
const destructiveMenuItemClass = "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold text-rose-700 transition hover:bg-rose-500/10 focus:bg-rose-500/10";

export default function FactoryRowActions({ onView, viewLabel = "View details", primaryAction, directActions = [], secondaryActions = [], directSingleSecondary = false }) {
  const [open, setOpen] = useState(false);
  const visibleActions = directActions.filter(Boolean);
  const actions = secondaryActions.filter(Boolean);
  const overflowOnlyOnSmallScreens = actions.length > 0 && actions.every((action) => action.mobileOnly);
  return <div className="flex h-8 items-center justify-end gap-1.5 whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
    {primaryAction ? <button className="btn-primary h-8 px-3 text-xs" type="button" disabled={primaryAction.disabled} onClick={primaryAction.onClick}>{primaryAction.label}</button> : null}
    {onView ? <FactoryRowAction label={viewLabel} onClick={onView} /> : null}
    {visibleActions.map((action) => {
      const Icon = action.icon || Pencil;
      const buttonClass = action.compact ? "btn-secondary h-7 gap-1 px-2 text-xs" : "btn-secondary h-8 px-2.5 text-xs";
      const responsiveClass = action.desktopOnly ? "hidden md:inline-flex" : "";
      return action.variant === "button"
        ? <button key={action.key || action.label} className={`${buttonClass} ${responsiveClass}`} type="button" disabled={action.disabled} onClick={action.onClick}>{action.icon ? <Icon size={14} /> : null}{action.label}</button>
        : <button key={action.key || action.label} className={`icon-btn h-8 w-8 ${responsiveClass}`} type="button" aria-label={action.label} title={action.label} disabled={action.disabled} onClick={action.onClick}><Icon size={16} /></button>;
    })}
    {directSingleSecondary && actions.length === 1 && !actions[0].destructive ? (() => { const action = actions[0]; const Icon = action.icon || Pencil; return <button className="icon-btn h-8 w-8" type="button" aria-label={action.label} title={action.label} disabled={action.disabled} onClick={action.onClick}><Icon size={16} /></button>; })() : null}
    {(!directSingleSecondary || actions.length > 1 || actions[0]?.destructive) && actions.length ? <ActionMenu open={open} onOpenChange={setOpen} width={196} ariaLabel="More row actions" trigger={({ toggle, ariaLabel }) => <button className={`icon-btn h-8 w-8 ${overflowOnlyOnSmallScreens ? "md:hidden" : ""}`} type="button" aria-label={ariaLabel} title="More actions" onClick={toggle}><Ellipsis size={16} /></button>}>
      {actions.map((action) => <button key={action.key || action.label} className={`${action.destructive ? destructiveMenuItemClass : menuItemClass} ${action.mobileOnly ? "md:hidden" : ""}`} type="button" disabled={action.disabled} onClick={() => { setOpen(false); action.onClick?.(); }}>{action.label}</button>)}
    </ActionMenu> : null}
  </div>;
}
