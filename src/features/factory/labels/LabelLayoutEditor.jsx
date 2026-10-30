import { useRef, useState } from "react";
import { Plus, Trash2, Copy, ImagePlus } from "lucide-react";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import {
  labelFieldOptions,
  moveLabelElement,
  updateLabelElement,
} from "./labelManagementModel.js";
import "./labelManagement.css";

export default function LabelLayoutEditor({
  definition,
  width,
  height,
  image,
  error,
  onChange,
  disabled,
}) {
  const [selected, setSelected] = useState(0),
    [uploadError, setUploadError] = useState("");
  const surface = useRef(null),
    drag = useRef(null);
  const elements = definition.elements,
    element = elements[selected];
  const patch = (changes) =>
    onChange(updateLabelElement(definition, selected, changes));
  function begin(event, index, resize = false) {
    if (disabled) return;
    event.preventDefault();
    setSelected(index);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      index,
      resize,
      startX: event.clientX,
      startY: event.clientY,
      original: { ...elements[index] },
      bounds: surface.current.getBoundingClientRect(),
    };
  }
  function move(event) {
    if (!drag.current) return;
    const d = drag.current;
    onChange({
      ...definition,
      elements: elements.map((e, i) =>
        i === d.index
          ? moveLabelElement(
              d.original,
              ((event.clientX - d.startX) / d.bounds.width) * width,
              ((event.clientY - d.startY) / d.bounds.height) * height,
              width,
              height,
              d.resize,
            )
          : e,
      ),
    });
  }
  const stop = () => {
    drag.current = null;
  };
  function add(type) {
    if (elements.length >= 50) return;
    const e = {
      type,
      x: 5,
      y: 5,
      w: Math.min(60, width - 10),
      h: type === "text" ? 10 : Math.min(20, height - 10),
      ...(type === "text"
        ? { text: "New text", size: 3 }
        : type === "rect" || type === "line"
          ? { stroke: 0.3 }
          : type === "qr" || type === "barcode"
            ? { field: "batch_no" }
            : {}),
    };
    if (type === "qr") e.w = e.h;
    onChange({ ...definition, elements: [...elements, e] });
    setSelected(elements.length);
  }
  async function upload(event) {
    setUploadError("");
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== "image/png" || file.size > 300000) {
      setUploadError("Choose a PNG file under 300 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const e = {
        type: "image",
        src: String(reader.result),
        x: 5,
        y: 5,
        w: Math.min(20, width - 10),
        h: Math.min(20, height - 10),
      };
      onChange({ ...definition, elements: [...elements, e] });
      setSelected(elements.length);
    };
    reader.onerror = () => setUploadError("Unable to read this PNG.");
    reader.readAsDataURL(file);
  }
  return (
    <div className="label-layout-grid">
      <div className="space-y-3">
        <h3 className="font-semibold">Elements</h3>
        <div className="space-y-1" role="list" aria-label="Label elements">
          {elements.map((e, i) => (
            <button
              type="button"
              key={i}
              className={`label-layer ${selected === i ? "label-layer-selected" : ""}`}
              aria-pressed={selected === i}
              onClick={() => setSelected(i)}
            >
              {i + 1}.{" "}
              {labelFieldOptions.find((f) => f.value === e.field)?.label ||
                e.text?.slice(0, 35) ||
                e.type}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {["text", "rect", "line", "qr", "barcode"].map((type) => (
            <button
              key={type}
              type="button"
              className="btn-secondary"
              disabled={disabled || elements.length >= 50}
              onClick={() => add(type)}
            >
              <Plus size={13} />
              {type === "rect"
                ? "Border"
                : type === "qr"
                  ? "QR"
                  : type === "barcode"
                    ? "Barcode"
                    : type === "text"
                      ? "Text"
                      : "Line"}
            </button>
          ))}
          <label className="btn-secondary cursor-pointer">
            <ImagePlus size={14} />
            PNG image
            <input
              aria-label="Add PNG image"
              type="file"
              accept="image/png"
              className="sr-only"
              disabled={disabled || elements.length >= 50}
              onChange={upload}
            />
          </label>
        </div>
        {uploadError && <p role="alert">{uploadError}</p>}
      </div>
      <div className="min-w-0 space-y-3">
        <p className="text-sm text-text-secondary">
          Drag to move, use the corner handle to resize, or use arrow keys to
          move by 0.5 mm. Preview placeholders identify read-only Production
          fields.
        </p>
        <div
          ref={surface}
          className="label-canvas"
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          {image && (
            <img
              src={image}
              alt="Live label layout preview"
              draggable="false"
            />
          )}
          {elements.map((e, i) => (
            <button
              type="button"
              key={i}
              aria-label={`Select element ${i + 1}`}
              className={`label-element ${selected === i ? "label-element-selected" : ""}`}
              style={{
                left: `${(e.x / width) * 100}%`,
                top: `${(e.y / height) * 100}%`,
                width: `${(e.w / width) * 100}%`,
                height: `${(e.h / height) * 100}%`,
              }}
              disabled={disabled}
              onPointerDown={(event) => begin(event, i)}
              onPointerMove={move}
              onPointerUp={stop}
              onPointerCancel={stop}
              onKeyDown={(event) => {
                const direction = {
                  ArrowLeft: [-0.5, 0],
                  ArrowRight: [0.5, 0],
                  ArrowUp: [0, -0.5],
                  ArrowDown: [0, 0.5],
                }[event.key];
                if (direction) {
                  event.preventDefault();
                  onChange(
                    updateLabelElement(
                      definition,
                      i,
                      moveLabelElement(e, ...direction, width, height),
                    ),
                  );
                }
              }}
            />
          ))}
          {element && !disabled && (
            <button
              type="button"
              className="label-resize"
              aria-label="Resize selected element"
              style={{
                left: `${((element.x + element.w) / width) * 100}%`,
                top: `${((element.y + element.h) / height) * 100}%`,
              }}
              onPointerDown={(event) => begin(event, selected, true)}
              onPointerMove={move}
              onPointerUp={stop}
              onPointerCancel={stop}
            />
          )}
        </div>
        <p className="text-sm text-text-secondary">
          {width} × {height} mm · 203 DPI
        </p>
        {error && (
          <p role="alert" className="text-sm text-text-primary">
            {error}
          </p>
        )}
      </div>
      <div className="space-y-3">
        <h3 className="font-semibold">
          {element ? `Element ${selected + 1}` : "Choose an element"}
        </h3>
        {element && (
          <>
            {element.type === "text" ||
            element.type === "qr" ||
            element.type === "barcode" ? (
              <Field label="Content source">
                <SearchableSelect
                  value={element.field || ""}
                  disabled={disabled}
                  options={[
                    { value: "", label: "Shared static text" },
                    ...labelFieldOptions,
                  ]}
                  onChange={(field) => {
                    const e = { ...element };
                    if (field) {
                      e.field = field;
                      delete e.text;
                    } else {
                      delete e.field;
                      e.text = "New text";
                    }
                    onChange({
                      ...definition,
                      elements: elements.map((previous, index) =>
                        index === selected ? e : previous,
                      ),
                    });
                  }}
                />
              </Field>
            ) : null}
            {element.type === "text" && !element.field && (
              <Field label="Shared template text">
                <textarea
                  aria-label="Shared template text"
                  className={inputClass()}
                  disabled={disabled}
                  value={element.text || ""}
                  onChange={(e) => patch({ text: e.target.value })}
                />
              </Field>
            )}
            {["text", "qr", "barcode"].includes(element.type) && (
              <div className="grid grid-cols-2 gap-2">
                {["prefix", "suffix"].map((key) => (
                  <Field
                    key={key}
                    label={key === "prefix" ? "Prefix" : "Suffix"}
                  >
                    <input
                      aria-label={key}
                      className={inputClass()}
                      disabled={disabled}
                      value={element[key] || ""}
                      onChange={(e) => patch({ [key]: e.target.value })}
                    />
                  </Field>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {[
                ["x", "X (mm)"],
                ["y", "Y (mm)"],
                ["w", "Width (mm)"],
                ["h", "Height (mm)"],
                ...(element.type === "text"
                  ? [["size", "Font size (mm)"]]
                  : []),
                ...(["rect", "line"].includes(element.type)
                  ? [["stroke", "Border (mm)"]]
                  : []),
                ...(element.type === "rect"
                  ? [["radius", "Corner radius (mm)"]]
                  : []),
              ].map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    type="number"
                    aria-label={label}
                    step="0.1"
                    min="0"
                    className={inputClass()}
                    disabled={disabled}
                    value={element[key] ?? 0}
                    onChange={(e) => patch({ [key]: Number(e.target.value) })}
                  />
                </Field>
              ))}
            </div>
            {element.type === "text" && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!element.bold}
                    disabled={disabled}
                    onChange={(e) => patch({ bold: e.target.checked })}
                  />
                  Bold
                </label>
                <Field label="Alignment">
                  <SearchableSelect
                    value={element.align || "left"}
                    options={["left", "center", "right"].map((value) => ({
                      value,
                      label: value,
                    }))}
                    disabled={disabled}
                    onChange={(align) => patch({ align })}
                  />
                </Field>
              </>
            )}
            {element.field &&
              ["manufacturing_date", "expiry_date"].includes(element.field) && (
                <p className="text-sm text-text-secondary">
                  Read-only Production date. Content cannot be entered here.
                </p>
              )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={disabled || elements.length >= 50}
                onClick={() => {
                  onChange({
                    ...definition,
                    elements: [...elements, { ...element }],
                  });
                  setSelected(elements.length);
                }}
              >
                <Copy size={14} />
                Duplicate
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={disabled || elements.length <= 1}
                onClick={() => {
                  onChange({
                    ...definition,
                    elements: elements.filter((_, i) => i !== selected),
                  });
                  setSelected(Math.max(0, selected - 1));
                }}
              >
                <Trash2 size={14} />
                Remove
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
