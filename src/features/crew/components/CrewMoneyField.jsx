import "./CrewMoneyField.css";

/** Shared Crew money entry with a fixed currency prefix and mobile decimal keyboard. */
export default function CrewMoneyField({ label, value, onChange, currency = "RM", min = 0, max, step = "0.01", required = false, disabled = false, error = "" }) {
  const validDraft = (nextValue) => /^\d*(?:\.\d{0,2})?$/.test(nextValue);
  const numberValue = Number(value);
  const invalid = Boolean(error) || (value !== "" && (!Number.isFinite(numberValue) || numberValue < Number(min) || (max != null && numberValue > Number(max))));
  return <label className="crew-ui-form-field crew-money-field"><span>{label}</span><span className="crew-money-field-control"><b>{currency}</b><input required={required} aria-label={label} aria-invalid={invalid || undefined} inputMode="decimal" pattern="[0-9]*[.]?[0-9]{0,2}" type="text" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => { if (validDraft(event.target.value)) onChange(event.target.value); }} /></span>{error ? <small role="alert">{error}</small> : null}</label>;
}
