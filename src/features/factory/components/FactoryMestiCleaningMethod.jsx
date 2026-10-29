import SelectField from "../../../components/forms/SelectField.jsx";

export const cleaningMethodLabel = reference => reference?.name || "Not Specified";

export function FactoryMestiCleaningMethodReference({ reference, compact = false }) {
  if (!reference) return <p className="text-xs text-text-secondary">Method: Not Specified</p>;
  const content = <div className="mt-2 space-y-2 text-xs text-text-secondary">
    <p><span className="font-semibold">Materials:</span> {(reference.materials || []).join(", ")}</p>
    <ol className="list-decimal space-y-1 pl-4">{(reference.steps || []).map(step => <li key={step}>{step}</li>)}</ol>
    <p><span className="font-semibold">Verification:</span> {reference.verification}</p>
    <p className="text-text-muted">Reference procedure only; not validated chemical-use parameters.</p>
  </div>;
  return compact ? <details className="mt-1 text-xs text-text-secondary"><summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Method: {reference.name}</summary>{content}</details> : <section aria-label="Cleaning Method reference"><h3 className="text-sm font-semibold text-text-primary">{reference.name}</h3>{content}</section>;
}

export function FactoryMestiCleaningMethodField({ draft, methods, onChange }) {
  const reference = draft.cleaning_method_reference?.code === draft.cleaning_method ? draft.cleaning_method_reference : methods.find(method => method.code === draft.cleaning_method);
  return <div className="min-w-0 space-y-2 md:col-span-2">
    <SelectField label="Cleaning Method" ariaLabel="Cleaning Method" value={draft.cleaning_method || ""} options={methods.map(method => ({ value: method.code, label: method.name }))} onChange={onChange} required={!draft.id} placeholder={draft.id ? "Not Specified" : "Select Cleaning Method"} />
    {reference ? <FactoryMestiCleaningMethodReference reference={reference} compact /> : null}
  </div>;
}
