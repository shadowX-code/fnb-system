export default function FactorySegmentedControl({ value, onChange, options, label = "View" }) {
  return (
    <div className="factory-segmented-control" role="group" aria-label={label}>
      {options.map((option) => {
        const active = option.value === value;
        return <button key={option.value} className={active ? "is-active" : ""} type="button" aria-pressed={active} onClick={() => onChange(option.value)}>{option.label}</button>;
      })}
    </div>
  );
}
