import { useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { FieldLabel } from "../../../components/forms/Selectors.jsx";

export default function EntityModal({ title, description, fields, initialValues = {}, onClose, onSubmit, submitLabel = "Save" }) {
  const [values, setValues] = useState(initialValues);

  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" onClick={() => onSubmit(values)}>{submitLabel}</button>
        </>
      }
    >
      <div className="space-y-4">
        {fields.map((field) => (
          <FieldLabel key={field.name} label={field.label}>
            {field.type === "select" ? (
              <SelectField
                value={values[field.name] ?? ""}
                options={field.options}
                onChange={(nextValue) => setValues((current) => ({ ...current, [field.name]: nextValue }))}
              />
            ) : field.type === "multiselect" ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {field.options.map((option) => {
                    const selected = (values[field.name] ?? []).includes(option.value);
                    return (
                      <button
                        key={option.value}
                        className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${selected ? "border-primary bg-primary/10 text-primary" : "border-border bg-white text-text-secondary hover:bg-slate-50"}`}
                        type="button"
                        onClick={() => {
                          setValues((current) => {
                            const currentValues = current[field.name] ?? [];
                            const nextValues = currentValues.includes(option.value)
                              ? currentValues.filter((value) => value !== option.value)
                              : [...currentValues, option.value];
                            return { ...current, [field.name]: nextValues };
                          });
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {field.helper ? <div className="text-[11px] text-text-muted">{field.helper}</div> : null}
              </div>
            ) : (
              <input
                className="control w-full"
                value={values[field.name] ?? ""}
                onBlur={() => {
                  if (field.formatOnBlur) {
                    setValues((current) => ({ ...current, [field.name]: field.formatOnBlur(current[field.name]) }));
                  }
                }}
                onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                placeholder={field.placeholder}
              />
            )}
          </FieldLabel>
        ))}
      </div>
    </Modal>
  );
}
