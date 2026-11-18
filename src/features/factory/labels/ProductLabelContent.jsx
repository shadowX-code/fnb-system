import { LockKeyhole } from "lucide-react";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import {
  boundLabelContentFields,
  labelContentWarnings,
  labelPrintFields,
} from "./labelManagementModel.js";
import { legacyLabelContentField } from "./labelRenderer.js";

const multilineFields = new Set(["ingredients", "storage_instructions", "manufacturer_address"]);

export default function ProductLabelContent({
  payload,
  baseline,
  templates,
  definition,
  disabled,
  update,
  updateContent,
  onAssign,
  onOpenTemplate,
}) {
  const fields = boundLabelContentFields(definition);
  const setupFields = definition ? labelPrintFields.filter(([key]) =>
    !fields.some(([field]) => field === key) && (!baseline[key]?.trim() || !payload[key]?.trim()),
  ) : [];
  const warnings = definition ? labelContentWarnings(payload, definition) : [];
  const referenceMatches = fields.filter(([field]) => definition.elements.some((element, index) =>
    legacyLabelContentField(definition, index) === field && element.text &&
    payload.content?.[field] === element.text,
  )).map(([, label]) => label);

  function renderField([key, label]) {
    const isPrintField = labelPrintFields.some(([field]) => field === key);
    const Control = multilineFields.has(key) ? "textarea" : "input";
    return (
      <Field key={key} label={label}>
        <Control
          aria-label={label}
          className={inputClass()}
          disabled={disabled}
          value={(isPrintField ? payload[key] : payload.content?.[key]) ?? ""}
          onChange={(event) => (isPrintField ? update : updateContent)(key, event.target.value)}
          maxLength={key === "net_weight" ? 100 : key === "storage_instructions" ? 1000 : 3900}
          {...(Control === "textarea" ? { rows: 3 } : {})}
        />
      </Field>
    );
  }

  return (
    <>
      <section className="label-studio-form-section label-studio-product-template">
        <div className="label-studio-section-heading">
          <h2>Template</h2>
          {definition && <span>{payload.width_mm} × {payload.height_mm} mm</span>}
        </div>
        <Field label="Template version">
          <SearchableSelect
            value={payload.template_id}
            disabled={disabled}
            ariaLabel="Template version"
            placeholder="Select a template"
            options={templates.map((template) => ({
              value: template.id,
              label: `${template.name} · v${template.version}`,
            }))}
            onChange={onAssign}
          />
        </Field>
        {definition && <div className="label-studio-section-heading">
          <p className="label-studio-hint">Saving a new assignment leaves the active label in use until you activate the draft.</p>
          <button type="button" className="btn-ghost" disabled={disabled} onClick={onOpenTemplate}>
            Open Shared Template
          </button>
        </div>}
      </section>

      <div className="label-studio-content-form">
        {(fields.length > 0 || setupFields.length > 0) && (
          <section className="label-studio-form-section">
            <div className="label-studio-section-heading">
              <h2>Label content</h2>
              <span>This Packaging SKU</span>
            </div>
            {fields.length > 0 && (
              <div className="label-studio-fields">
                {fields.map(renderField)}
              </div>
            )}
            {setupFields.length > 0 && (
              <>
                <p className="label-studio-hint">Required for activation even when the template leaves these values off the label.</p>
                <div className="label-studio-fields">
                  {setupFields.map(renderField)}
                </div>
              </>
            )}
            {(warnings.length > 0 || referenceMatches.length > 0) && (
              <details className="label-studio-content-check" open>
                <summary>Content checks</summary>
                {warnings.map((message) => <p key={message}>{message}</p>)}
                {referenceMatches.length > 0 && (
                  <p>{referenceMatches.join(", ")} matches the template reference. Verify this wording before activation.</p>
                )}
              </details>
            )}
          </section>
        )}

        <section className="label-studio-form-section">
          <div className="label-studio-section-heading">
            <h2>Automatic Production fields</h2>
            <span><LockKeyhole size={14} /> Read-only</span>
          </div>
          <p className="label-studio-hint">MFG, EXP, batch number and actual packaged quantity come from the batch when you print from a Job Order.</p>
        </section>
        <section className="label-studio-form-section">
          <div className="label-studio-section-heading"><h2>Expiry fallback</h2></div>
          <div className="label-studio-fields">
            <Field label="When recorded expiry is missing">
              <SearchableSelect
                value={payload.expiry_rule}
                disabled={disabled}
                options={[
                  { value: "production", label: "Require confirmed Production expiry" },
                  { value: "days_after", label: "Manufacturing date + shelf life" },
                  { value: "inclusive_days", label: "Manufacturing date + shelf life − 1 day" },
                ]}
                onChange={(value) => update("expiry_rule", value)}
              />
            </Field>
            <Field label="Approved shelf life (days)">
              <input
                aria-label="Approved shelf life (days)"
                type="number"
                min="1"
                step="1"
                className={inputClass()}
                disabled={disabled}
                value={payload.shelf_life_days ?? ""}
                onChange={(event) => update("shelf_life_days", event.target.value === "" ? "" : Number(event.target.value))}
              />
            </Field>
          </div>
          <p className="label-studio-hint">Recorded Production expiry and shelf-life snapshots take precedence.</p>
        </section>
      </div>
    </>
  );
}
