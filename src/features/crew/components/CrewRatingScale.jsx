export default function CrewRatingScale({ label, value, scale, onChange, chooseLabel, labelFor }) {
  return <fieldset className="crew-ui-rating-scale"><legend>{label}</legend><div>{scale.map((word, index) => <button type="button" key={word} className={value === index + 1 ? "is-active" : ""} aria-label={`${index + 1} ${labelFor(word)}`} aria-pressed={value === index + 1} onClick={() => onChange(index + 1)}>{index + 1}</button>)}</div><small aria-live="polite">{value ? `${value} · ${labelFor(scale[value - 1])}` : chooseLabel}</small></fieldset>;
}
