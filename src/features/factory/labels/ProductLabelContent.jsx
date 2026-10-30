import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import {
  labelContentFields,
  labelElementName,
  labelContentWarnings,
} from "./labelManagementModel.js";
import { legacyLabelContentField } from "./labelRenderer.js";
import { openLabelManagement } from "./labelManagementNavigation.js";

export default function ProductLabelContent({
  payload,
  data,
  template,
  definition,
  disabled,
  dirty,
  update,
  updateContent,
  onAssign,
}) {
  const warnings = definition ? labelContentWarnings(payload, definition) : [];
  const referenceMatches = (definition?.elements || []).flatMap((e, i) => {
    const field = legacyLabelContentField(definition, i);
    return field && payload.content?.[field] === e.text && e.text
      ? [labelContentFields.find(([key]) => key === field)?.[1]]
      : [];
  });
  return (
    <div className="label-studio-content-form">
      <section className="label-studio-form-section">
        <div className="label-studio-section-heading">
          <h2>Product content</h2>
          <span>Editable · this Packaging SKU</span>
        </div>
        <p className="label-studio-hint">
          Label-specific wording. Product identity remains owned by Finished
          Goods.
        </p>
        <div className="label-studio-fields">
          {labelContentFields.slice(0, 3).map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                aria-label={label}
                className={inputClass()}
                disabled={disabled}
                value={payload.content?.[key] || ""}
                onChange={(e) => updateContent(key, e.target.value)}
                maxLength={3900}
              />
            </Field>
          ))}
        </div>
        <div className="label-studio-fields label-studio-fields-two">
          <Field label="Ingredients">
            <textarea
              aria-label="Ingredients"
              rows={3}
              className={inputClass()}
              disabled={disabled}
              value={payload.content?.ingredients || ""}
              onChange={(e) => updateContent("ingredients", e.target.value)}
              maxLength={3900}
              placeholder="Enter this SKU’s approved ingredients"
            />
          </Field>
          <Field label="Storage instructions">
            <textarea
              aria-label="Storage instructions"
              rows={3}
              className={inputClass()}
              disabled={disabled}
              value={payload.storage_instructions}
              onChange={(e) => update("storage_instructions", e.target.value)}
            />
          </Field>
          <Field label="Net weight">
            <input
              aria-label="Net weight"
              className={inputClass()}
              disabled={disabled}
              value={payload.net_weight}
              onChange={(e) => update("net_weight", e.target.value)}
            />
          </Field>
        </div>
        {(warnings.length > 0 || referenceMatches.length > 0) && (
          <details className="label-studio-content-check" open>
            <summary>Content checks</summary>
            {warnings.map((message) => (
              <p key={message}>{message}</p>
            ))}
            {referenceMatches.length > 0 && (
              <p>
                {referenceMatches.join(", ")} matches the template reference.
                Verify it is correct for this SKU before approval. Saved content
                is retained for review.
              </p>
            )}
          </details>
        )}
      </section>
      <section className="label-studio-form-section">
        <div className="label-studio-section-heading">
          <h2>Manufacturer</h2>
          <span>Editable · label wording</span>
        </div>
        <div className="label-studio-fields label-studio-fields-two">
          {labelContentFields.slice(4).map(([key, label]) => (
            <Field key={key} label={label}>
              <textarea
                aria-label={label}
                rows={key === "manufacturer_address" ? 3 : 2}
                className={inputClass()}
                disabled={disabled}
                value={payload.content?.[key] || ""}
                onChange={(e) => updateContent(key, e.target.value)}
                maxLength={3900}
              />
            </Field>
          ))}
        </div>
      </section>
      <details className="label-studio-form-section" open>
        <summary>
          Label configuration{" "}
          <span>
            {payload.width_mm} × {payload.height_mm} mm
          </span>
        </summary>
        <div className="label-studio-assignment">
          <Field label="Approved template version">
            <SearchableSelect
              value={payload.template_id}
              disabled={disabled}
              options={data.templates.map((t) => ({
                value: t.id,
                label: `${t.name} · v${t.version}`,
              }))}
              onChange={onAssign}
            />
          </Field>
          {template && (
            <button
              type="button"
              className="btn-ghost"
              disabled={disabled || dirty}
              onClick={() =>
                openLabelManagement({
                  section: "templates",
                  template: template.template_key,
                })
              }
            >
              Open Shared Template
            </button>
          )}
        </div>
        <p className="label-studio-hint">
          Pinned version. Publishing a shared layout never upgrades this SKU
          automatically.
        </p>
        <div className="label-studio-fields">
          {[
            ["width_mm", "Width (mm)"],
            ["height_mm", "Height (mm)"],
            ["shelf_life_days", "Approved shelf life (days)"],
          ].map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                aria-label={label}
                type="number"
                min="1"
                step={key === "shelf_life_days" ? "1" : "0.1"}
                className={inputClass()}
                disabled={disabled}
                value={payload[key] ?? ""}
                onChange={(e) =>
                  update(
                    key,
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              />
            </Field>
          ))}
        </div>
        <Field label="When recorded expiry is missing">
          <SearchableSelect
            value={payload.expiry_rule}
            disabled={disabled}
            options={[
              {
                value: "production",
                label: "Require confirmed Production expiry",
              },
              { value: "days_after", label: "Manufacturing date + shelf life" },
              {
                value: "inclusive_days",
                label: "Manufacturing date + shelf life − 1 day",
              },
            ]}
            onChange={(value) => update("expiry_rule", value)}
          />
        </Field>
      </details>
      {definition?.elements.some(
        (e, i) =>
          e.type === "text" &&
          !e.field &&
          !legacyLabelContentField(definition, i),
      ) && (
        <details className="label-studio-form-section">
          <summary>Captions & additional text</summary>
          <p className="label-studio-hint">
            SKU-only overrides of this pinned version’s static captions.
          </p>
          <div className="label-studio-fields label-studio-fields-two">
            {definition.elements.map((e, i) =>
              e.type === "text" &&
              !e.field &&
              !legacyLabelContentField(definition, i) ? (
                <Field
                  key={i}
                  label={labelElementName(e, i, definition.elements)}
                >
                  <input
                    aria-label={`Caption: ${labelElementName(e, i, definition.elements)}`}
                    className={inputClass()}
                    disabled={disabled}
                    value={payload.content?.text_overrides?.[i] ?? e.text ?? ""}
                    onChange={(event) =>
                      updateContent("text_overrides", {
                        ...payload.content?.text_overrides,
                        [i]: event.target.value,
                      })
                    }
                  />
                </Field>
              ) : null,
            )}
          </div>
        </details>
      )}
    </div>
  );
}
