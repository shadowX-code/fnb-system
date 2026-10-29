import { useEffect, useRef, useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { factoryLabelService } from "../../../services/factoryLabelService.js";
import { validateDefinition, renderLabel } from "./labelRenderer.js";

export default function LabelConfigModal({ sku, onClose }) {
  const [data, setData] = useState(null),
    [form, setForm] = useState(null),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [contentApproved, setContentApproved] = useState(false),
    [custom, setCustom] = useState(false),
    [definition, setDefinition] = useState(""),
    [preview, setPreview] = useState(null),
    [previewError, setPreviewError] = useState("");
  const request = useRef(crypto.randomUUID()),
    lock = useRef(false);
  const load = () =>
    factoryLabelService
      .settings(sku.id)
      .then((result) => {
        setData(result);
        setForm(
          result.config || {
            template_id: result.templates[0]?.id,
            width_mm: 80,
            height_mm: 90,
            net_weight: sku.pack_size_qty
              ? `${sku.pack_size_qty} ${sku.pack_size_uom || ""}`
              : "",
            storage_instructions: "",
            shelf_life_days: sku.shelf_life_days || "",
            expiry_rule: "production",
            approval_note: "",
          },
        );
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [sku.id]);
  useEffect(() => {
    let active = true;
    setPreview(null);
    setPreviewError("");
    if (form && data) {
      Promise.resolve()
        .then(() =>
          renderLabel({
            ...form,
            product_name:
              sku.product_family_name ||
              sku.product_name_en ||
              sku.product_name,
            product_name_cn:
              sku.product_family_name_cn || sku.product_name_cn || "",
            product_name_bm:
              sku.product_family_name_bm || sku.product_name_bm || "",
            product_code: sku.product_code || "",
            manufacturing_date: "—",
            expiry_date: "—",
            batch_no: "—",
            definition: custom
              ? JSON.parse(definition)
              : data.templates.find((t) => t.id === form.template_id)
                  ?.definition,
          }),
        )
        .then((result) => {
          if (active) setPreview(result.preview);
        })
        .catch((e) => {
          if (active) setPreviewError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [form, data, custom, definition, sku]);
  const change = (key, value) => {
    setContentApproved(false);
    setForm((f) => ({ ...f, [key]: value }));
    request.current = crypto.randomUUID();
  };
  async function save(e) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const template = custom
        ? JSON.parse(definition)
        : data.templates.find((t) => t.id === form.template_id)?.definition;
      validateDefinition(
        template,
        Number(form.width_mm),
        Number(form.height_mm),
      );
      const config = Object.fromEntries(
        [
          "template_id",
          "width_mm",
          "height_mm",
          "net_weight",
          "storage_instructions",
          "shelf_life_days",
          "expiry_rule",
          "approval_note",
        ].map((k) => [k, form[k]]),
      );
      config.width_mm = Number(config.width_mm);
      config.height_mm = Number(config.height_mm);
      config.shelf_life_days =
        config.shelf_life_days === "" ? null : Number(config.shelf_life_days);
      config.content_approved = contentApproved;
      if (custom) config.new_template = template;
      await factoryLabelService.saveConfig(
        sku.id,
        config,
        data.config?.version || 0,
        request.current,
      );
      onClose();
    } catch (e) {
      setError(e.message || "Unable to save label configuration.");
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <Modal
      title="Label Configuration"
      description={`${sku.product_code || ""} · ${sku.product_name_en || sku.product_name || "Packaging SKU"}`}
      size="lg"
      onClose={saving ? undefined : onClose}
      footer={
        <>
          <button className="btn-secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            form="label-config"
            type="submit"
            className="btn-primary"
            disabled={
              !form ||
              saving ||
              !contentApproved ||
              Boolean(previewError) ||
              !preview
            }
          >
            {saving ? "Saving…" : "Save Approved Version"}
          </button>
        </>
      }
    >
      {error && (
        <p role="alert" className="mb-4 text-sm text-text-primary">
          {error}{" "}
          {!form && (
            <button className="btn-secondary" onClick={load}>
              Retry
            </button>
          )}
        </p>
      )}
      {!form ? (
        <p role="status">Loading label configuration…</p>
      ) : (
        <form id="label-config" onSubmit={save} className="space-y-4">
          <p className="text-sm text-text-secondary">
            Label settings belong to this Packaging SKU. Saving creates a new
            approved version; historical batch labels retain their saved
            version. Production shelf life and expiry records remain
            authoritative.
          </p>
          <Field label="Reusable template">
            <SearchableSelect
              value={form.template_id}
              options={data.templates.map((t) => ({
                value: t.id,
                label: `${t.name} · v${t.version}`,
              }))}
              onChange={(v) => change("template_id", v)}
              disabled={saving || custom}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["width_mm", "Width (mm)", 20, 120],
              ["height_mm", "Height (mm)", 20, 200],
            ].map(([key, label, min, max]) => (
              <Field key={key} label={label}>
                <input
                  aria-label={label}
                  className={inputClass()}
                  type="number"
                  step="0.1"
                  min={min}
                  max={max}
                  required
                  disabled={saving}
                  value={form[key]}
                  onChange={(e) => change(key, e.target.value)}
                />
              </Field>
            ))}
            <Field label="Net weight">
              <input
                aria-label="Net weight"
                className={inputClass()}
                required
                maxLength={100}
                disabled={saving}
                value={form.net_weight}
                onChange={(e) => change("net_weight", e.target.value)}
              />
            </Field>
            <Field label="Approved shelf life (days)">
              <input
                aria-label="Approved shelf life (days)"
                className={inputClass()}
                type="number"
                min="1"
                max="3650"
                required={form.expiry_rule !== "production"}
                disabled={saving}
                value={form.shelf_life_days ?? ""}
                onChange={(e) => change("shelf_life_days", e.target.value)}
              />
            </Field>
          </div>
          <Field label="Storage instructions">
            <textarea
              aria-label="Storage instructions"
              className={inputClass()}
              required
              maxLength={1000}
              disabled={saving}
              value={form.storage_instructions}
              onChange={(e) => change("storage_instructions", e.target.value)}
            />
          </Field>
          <Field label="When Production expiry is missing">
            <SearchableSelect
              value={form.expiry_rule}
              disabled={saving}
              options={[
                { value: "production", label: "Require confirmed expiry date" },
                {
                  value: "days_after",
                  label: "Manufacturing date + approved shelf life",
                },
                {
                  value: "inclusive_days",
                  label: "Manufacturing date + shelf life − 1 day",
                },
              ]}
              onChange={(v) => change("expiry_rule", v)}
            />
          </Field>
          <Field label="Approval / change reason">
            <input
              aria-label="Approval / change reason"
              className={inputClass()}
              required
              minLength={3}
              maxLength={1000}
              disabled={saving}
              value={form.approval_note}
              onChange={(e) => change("approval_note", e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={custom}
              disabled={saving}
              onChange={(e) => {
                setCustom(e.target.checked);
                setDefinition(
                  JSON.stringify(
                    data.templates.find((t) => t.id === form.template_id)
                      ?.definition,
                    null,
                    2,
                  ),
                );
                request.current = crypto.randomUUID();
              }}
            />
            Create a reusable template from this layout
          </label>
          {custom && (
            <Field
              label="Template layout"
              helper="Millimetre coordinates. Supports text, embedded PNG logos/images, QR and Code 39 barcode. Every element must fit; overflowing labels cannot print."
            >
              <textarea
                aria-label="Template layout"
                className={`${inputClass()} min-h-64`}
                value={definition}
                disabled={saving}
                onChange={(e) => {
                  setContentApproved(false);
                  setDefinition(e.target.value);
                  request.current = crypto.randomUUID();
                }}
              />
            </Field>
          )}
          <div className="space-y-2 border-t border-border pt-4">
            <h3 className="font-semibold text-text-primary">
              Template Preview
            </h3>
            <p className="text-sm text-text-secondary">
              Dates and batch are blank here; actual labels use completed
              Production evidence.
            </p>
            {previewError ? (
              <p role="alert" className="text-sm text-text-primary">
                {previewError}
              </p>
            ) : null}
            {preview ? (
              <img
                className="mx-auto h-auto w-full max-w-80 border border-border bg-white"
                src={preview}
                alt="Packaging SKU label template preview"
              />
            ) : null}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={contentApproved}
              disabled={saving}
              onChange={(e) => {
                setContentApproved(e.target.checked);
                request.current = crypto.randomUUID();
              }}
            />
            <span>
              I reviewed and approve this label’s product names, ingredients,
              storage, manufacturer details and regulatory content.
              Certification logos require separately approved artwork.
            </span>
          </label>
          <p className="text-sm text-text-secondary">
            The initial S08 layout follows the supplied Labelife reference.
            Printing uses 203 DPI. Certification artwork is omitted until
            approved.
          </p>
        </form>
      )}
    </Modal>
  );
}
