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
            ) : (
              <input className="control w-full" value={values[field.name] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} placeholder={field.placeholder} />
            )}
          </FieldLabel>
        ))}
      </div>
    </Modal>
  );
}
