export default function FactoryViewTabs({ value, onChange, tabs }) {
  return (
    <div className="border-b border-border" role="tablist" aria-label="View">
      <div className="flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const active = tab.value === value;
          return <button key={tab.value} className={`border-b-2 px-3 py-2 text-sm font-semibold transition ${active ? "border-primary text-primary" : "border-transparent text-text-secondary hover:border-border hover:text-text-primary"}`} type="button" role="tab" aria-selected={active} onClick={() => onChange(tab.value)}>{tab.label}</button>;
        })}
      </div>
    </div>
  );
}
