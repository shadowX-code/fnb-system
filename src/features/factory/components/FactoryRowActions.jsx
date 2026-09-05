import { Ellipsis, Pencil } from "lucide-react";
import { useState } from "react";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";
import FactoryRowAction from "./FactoryRowAction.jsx";

const menuItemClass = "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold text-text-primary transition hover:bg-primary/5 focus:bg-primary/10";
const destructiveMenuItemClass = "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-semibold text-rose-700 transition hover:bg-rose-500/10 focus:bg-rose-500/10";

export default function FactoryRowActions({ onView, viewLabel = "View details", primaryAction, secondaryActions = [], directSingleSecondary = false }) {
  const [open, setOpen] = useState(false);
  const actions = secondaryActions.filter(Boolean);
  return <div className="flex h-8 items-center justify-end gap-1.5 whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
    {primaryAction ? <button className="btn-primary h-8 px-3 text-xs" type="button" disabled={primaryAction.disabled} onClick={primaryAction.onClick}>{primaryAction.label}</button> : null}
    {onView ? <FactoryRowAction label={viewLabel} onClick={onView} /> : null}
    {directSingleSecondary && actions.length === 1 ? (() => { const action = actions[0]; const Icon = action.icon || Pencil; return <button className={`icon-btn h-8 w-8 ${action.destructive ? "text-rose-700 hover:bg-rose-500/10" : ""}`} type="button" aria-label={action.label} title={action.label} disabled={action.disabled} onClick={action.onClick}><Icon size={16} /></button>; })() : null}
    {(!directSingleSecondary || actions.length > 1) && actions.length ? <ActionMenu open={open} onOpenChange={setOpen} width={196} ariaLabel="More row actions" trigger={({ toggle, ariaLabel }) => <button className="icon-btn h-8 w-8" type="button" aria-label={ariaLabel} title="More actions" onClick={toggle}><Ellipsis size={16} /></button>}>
      {actions.map((action) => <button key={action.key || action.label} className={action.destructive ? destructiveMenuItemClass : menuItemClass} type="button" disabled={action.disabled} onClick={() => { setOpen(false); action.onClick?.(); }}>{action.label}</button>)}
    </ActionMenu> : null}
  </div>;
}
