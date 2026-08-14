import SelectField from "../../../components/forms/SelectField.jsx";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";

export function CrewAdminOutletField({ value, onChange, options, allowAll = false, allValue = "all", ariaLabel = "Outlet" }) {
  const shared = useCrewAdminOutlet();
  const outletOptions = options || shared.outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }));
  return <SelectField className="crew-admin-toolbar-outlet" label="Outlet" ariaLabel={ariaLabel} value={value ?? shared.outletId} onChange={onChange || shared.setOutletId} options={allowAll ? [{ value: allValue, label: "All" }, ...outletOptions] : outletOptions} />;
}

export default function CrewAdminToolbar({ outlet, time, search, filters, secondary, primary, children, ariaLabel = "Page controls", className = "" }) {
  return <section className={`crew-admin-toolbar ${className}`.trim()} aria-label={ariaLabel} data-crew-admin-toolbar>
    <div className="crew-admin-toolbar-controls">
      {outlet ? <div data-toolbar-slot="outlet">{outlet}</div> : null}
      {time ? <div data-toolbar-slot="time">{time}</div> : null}
      {search ? <div data-toolbar-slot="search">{search}</div> : null}
      {filters ? <div className="crew-admin-toolbar-filter-group" data-toolbar-slot="filters">{filters}</div> : null}
      {children}
    </div>
    {secondary || primary ? <div className="crew-admin-toolbar-actions" data-toolbar-slot="actions">{secondary}{primary}</div> : null}
  </section>;
}
