import { useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Copy,
  ChevronDown,
  Type,
  Square,
  Minus,
  QrCode,
  Barcode,
  ImagePlus,
} from "lucide-react";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import {
  labelFieldOptions,
  labelElementName,
  labelElementSource,
  productionLabelFields,
  reorderLabelElement,
  moveLabelElement,
  updateLabelElement,
} from "./labelManagementModel.js";
import "./labelManagement.css";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";
import AdminSortableList from "../../../components/ui/AdminSortableList.jsx";
import LabelStudioCanvas from "./LabelStudioCanvas.jsx";

export default function LabelLayoutEditor({
  definition,
  width,
  height,
  image,
  error,
  issues = [],
  loading,
  configuration,
  onChange,
  disabled,
}) {
  const [selected, setSelected] = useState(0),
    [uploadError, setUploadError] = useState(""),
    [addOpen, setAddOpen] = useState(false),
    [layerIds, setLayerIds] = useState(() => definition.elements.map(() => crypto.randomUUID())),
    [orderMessage, setOrderMessage] = useState("");
  const surface = useRef(null),
    drag = useRef(null),
    uploadInput = useRef(null),
    latestAppend = useRef(null);
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
  function placeLayer(id, targetId, position) {
    const from = layerIds.indexOf(id);
    const target = layerIds.indexOf(targetId);
    if (from < 0 || target < 0 || from === target) return;
    const destination = target + (position === "after" ? 1 : 0) - (from < target ? 1 : 0);
    if (destination === from) return;
    const next = reorderLabelElement(definition, from, destination);
    setLayerIds(reorderLabelElement({ elements: layerIds }, from, destination).elements);
    setSelected(destination);
    setOrderMessage(`${labelElementName(elements[from])} moved to layer ${destination + 1} of ${elements.length}.`);
    onChange(next);
  }
  function append(element) {
    if (disabled || elements.length >= 50) return;
    const id = crypto.randomUUID();
    setLayerIds((ids) => [...ids, id]);
    onChange({ ...definition, elements: [...elements, element] });
    setSelected(elements.length);
  }
  latestAppend.current = append;

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
    append(e);
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
      latestAppend.current(e);
    };
    reader.onerror = () => setUploadError("Unable to read this PNG.");
    reader.readAsDataURL(file);
  }
  return (
    <div className="label-layout-grid">
      <aside className="label-studio-layers" aria-label="Layers">
        <div className="label-studio-panel-heading">
          <h2>
            Layers <span>{elements.length}</span>
          </h2>
          <ActionMenu
            open={addOpen}
            onOpenChange={setAddOpen}
            ariaLabel="Add Element"
            align="left"
            trigger={({ toggle, open }) => (
              <button
                type="button"
                className="btn-secondary"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={toggle}
                disabled={disabled || elements.length >= 50}
              >
                <Plus size={14} /> Add Element <ChevronDown size={12} />
              </button>
            )}
          >
            <div role="menu" aria-label="Add label element">
              {[
                ["text", "Text", Type],
                ["rect", "Border", Square],
                ["line", "Line", Minus],
                ["qr", "QR", QrCode],
                ["barcode", "Barcode", Barcode],
                ["image", "Image", ImagePlus],
              ].map(([type, label, Icon]) => (
                <button
                  className="flex gap-2"
                  role="menuitem"
                  type="button"
                  key={type}
                  onClick={() => {
                    setAddOpen(false);
                    if (type === "image") uploadInput.current.click();
                    else add(type);
                  }}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>
          </ActionMenu>
          <input
            ref={uploadInput}
            aria-label="Add PNG image"
            type="file"
            accept="image/png"
            className="sr-only"
            disabled={disabled || elements.length >= 50}
            onChange={upload}
          />
        </div>
        <AdminSortableList
          className="label-studio-layer-list"
          items={layerIds}
          getId={(id) => id}
          getLabel={(_, index) => `Reorder ${labelElementName(elements[index])}, layer ${index + 1}`}
          disabled={disabled || elements.length < 2}
          onMove={placeLayer}
        >
          {({ index, handle }) => {
            const layer = elements[index];
            const name = labelElementName(layer);
            return (
              <div className={`label-layer-row ${selected === index ? "label-layer-selected" : ""}`}>
                {handle}
                <button
                  type="button"
                  className="label-layer"
                  aria-label={`Layer ${index + 1}: ${name}`}
                  aria-pressed={selected === index}
                  onClick={() => setSelected(index)}
                >
                  <span className="label-layer-number">{index + 1}</span>
                  <span>
                    <strong>{name}</strong>
                    <small>{layer.field
                      ? labelElementSource(layer) === "production" ? "Production Field" : "SKU Field"
                      : { text: "Static Text", rect: "Border", line: "Line", image: "Image", qr: "QR code", barcode: "Barcode" }[layer.type]}</small>
                  </span>
                </button>
              </div>
            );
          }}
        </AdminSortableList>
        <span className="sr-only" aria-live="polite">{orderMessage}</span>
        <p className="label-studio-hint">Drag a handle or use ↑ and ↓. Layers print from back to front.</p>
        {uploadError && <p role="alert">{uploadError}</p>}
      </aside>
      <LabelStudioCanvas
        width={width}
        height={height}
        image={image}
        error={error}
        issues={issues}
        elements={elements}
        loading={loading}
        surfaceRef={surface}
        onSelect={setSelected}
        title="Canvas"
        sample
      >
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
      </LabelStudioCanvas>
      <aside className="label-studio-properties" aria-label="Properties">
        {configuration}
        <div className="label-studio-property-group">
          <h2>Layer Properties</h2>
          <h3>
            {element
              ? labelElementName(element, selected, elements)
              : "Choose an element"}
          </h3>
          {element && (
            <>
              {element.type === "text" ||
              element.type === "qr" ||
              element.type === "barcode" ? (
                <>
                  <Field label="Content source">
                    <SearchableSelect
                      value={labelElementSource(element)}
                      disabled={disabled}
                      options={[
                        { value: "static", label: "Static Text" },
                        { value: "sku", label: "SKU Field" },
                        { value: "production", label: "Production Field" },
                      ]}
                      onChange={(source) => {
                        const next = { ...element };
                        delete next.field;
                        delete next.text;
                        if (source === "static") next.text = "New text";
                        else
                          next.field =
                            source === "production"
                              ? "batch_no"
                              : "product_name";
                        onChange({
                          ...definition,
                          elements: elements.map((e, i) =>
                            i === selected ? next : e,
                          ),
                        });
                      }}
                    />
                  </Field>
                  {element.field && (
                    <Field
                      label={
                        labelElementSource(element) === "production"
                          ? "Production field"
                          : "SKU field"
                      }
                    >
                      <SearchableSelect
                        value={element.field}
                        disabled={disabled}
                        options={labelFieldOptions.filter(
                          (option) =>
                            productionLabelFields.includes(option.value) ===
                            (labelElementSource(element) === "production"),
                        )}
                        onChange={(field) => patch({ field })}
                      />
                    </Field>
                  )}
                  {element.field && (
                    <p className="label-studio-hint">
                      {labelElementSource(element) === "production"
                        ? "Read-only. Values come from the completed Production batch when printing."
                        : "Uses the selected Packaging SKU’s label content. Template sample text is never a SKU default."}
                    </p>
                  )}
                </>
              ) : null}
              {["text", "qr", "barcode"].includes(element.type) &&
                !element.field && (
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
                productionLabelFields.includes(element.field) && (
                  <p className="text-sm text-text-secondary">
                    Read-only Production date. Content cannot be entered here.
                  </p>
                )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={disabled || elements.length >= 50}
                  onClick={() => append({ ...element })}
                >
                  <Copy size={14} />
                  Duplicate
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={disabled || elements.length <= 1}
                  onClick={() => {
                    setLayerIds((ids) => ids.filter((_, index) => index !== selected));
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
        <p className="label-studio-hint">
          Drag to move. Corner handle to resize. Arrow keys move 0.5 mm. All
          dimensions are millimeters.
        </p>
      </aside>
    </div>
  );
}
