export default function AdminUnderlineTabs({ value, onChange, tabs, ariaLabel = "Sections", className = "" }) {
  return <div className={`border-b border-border ${className}`} role="tablist" aria-label={ariaLabel}>
    <div className="flex flex-wrap gap-1">{tabs.map((tab) => {
      const active = tab.value === value;
      const Icon = tab.icon;
      return <button key={tab.value} className={`border-b-2 px-3 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${active ? "border-[var(--factory-success-text)] text-[var(--factory-success-text)]" : "border-transparent text-text-secondary hover:border-border hover:text-text-primary"}`}
        type="button" role="tab" aria-selected={active} onClick={() => onChange(tab.value)}>{Icon ? <Icon size={15} aria-hidden="true" className="mr-1.5 inline-block align-text-bottom" /> : null}{tab.label}</button>;
    })}</div>
  </div>;
}
