export default function AdminUnderlineTabs({ value, onChange, tabs, ariaLabel = "Sections" }) {
  return <div className="border-b border-border" role="tablist" aria-label={ariaLabel}>
    <div className="flex flex-wrap gap-1">{tabs.map((tab) => {
      const active = tab.value === value;
      return <button key={tab.value} className={`border-b-2 px-3 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${active ? "border-primary text-primary" : "border-transparent text-text-secondary hover:border-border hover:text-text-primary"}`}
        type="button" role="tab" aria-selected={active} onClick={() => onChange(tab.value)}>{tab.label}</button>;
    })}</div>
  </div>;
}
