import { useEffect, useRef, useState } from "react";
import {
  Maximize,
  ZoomIn,
  ZoomOut,
  ScanLine,
  AlertTriangle,
} from "lucide-react";
import { mmToDots } from "./labelRenderer.js";
import { labelElementName } from "./labelManagementModel.js";

// Editor guides never enter the canonical monochrome print raster.
export default function LabelStudioCanvas({
  width,
  height,
  image,
  loading,
  error,
  issues = [],
  elements = [],
  surfaceRef,
  children,
  onSelect,
  title = "Live preview",
  sample = false,
}) {
  width = Math.max(1, Number(width) || 80);
  height = Math.max(1, Number(height) || 90);
  const viewport = useRef(null);
  const [zoom, setZoom] = useState("fit"),
    [fit, setFit] = useState(0.6),
    [guides, setGuides] = useState(true);
  useEffect(() => {
    const measure = () => {
      const bounds = viewport.current?.getBoundingClientRect();
      if (bounds?.width > 48 && bounds?.height > 48)
        setFit(
          Math.max(
            0.1,
            Math.min(
              (bounds.width - 48) / mmToDots(width),
              (bounds.height - 48) / mmToDots(height),
              1,
            ),
          ),
        );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [width, height]);
  const scale = zoom === "fit" ? fit : zoom;
  const changeZoom = (delta) =>
    setZoom(
      Math.min(2, Math.max(0.25, Math.round((scale + delta) * 100) / 100)),
    );
  return (
    <section className="label-studio-preview" aria-label={title}>
      <div className="label-studio-canvas-toolbar">
        <div>
          <strong>{title}</strong>
          <span>
            {width} × {height} mm · 203 DPI
          </span>
        </div>
        <div
          className="label-studio-zoom"
          role="group"
          aria-label="Canvas view"
        >
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setZoom("fit")}
            aria-pressed={zoom === "fit"}
          >
            <Maximize size={14} /> Fit
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Zoom out"
            onClick={() => changeZoom(-0.25)}
            disabled={scale <= 0.25}
          >
            <ZoomOut size={15} />
          </button>
          <output aria-label="Canvas zoom">{Math.round(scale * 100)}%</output>
          <button
            type="button"
            className="icon-btn"
            aria-label="Zoom in"
            onClick={() => changeZoom(0.25)}
            disabled={scale >= 2}
          >
            <ZoomIn size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Safe area guides"
            aria-pressed={guides}
            onClick={() => setGuides(!guides)}
          >
            <ScanLine size={15} />
          </button>
        </div>
      </div>
      <div className="label-studio-artboard" ref={viewport}>
        <div
          className="label-studio-artboard-space"
          style={{
            width: mmToDots(width) * scale + 48,
            minHeight: mmToDots(height) * scale + 48,
          }}
        >
          <div
            ref={surfaceRef}
            className="label-canvas"
            style={{
              width: mmToDots(width) * scale,
              height: mmToDots(height) * scale,
            }}
            aria-busy={loading}
          >
            {image && (
              <img
                src={image}
                alt={
                  sample
                    ? "Live label layout preview"
                    : "Product label live preview"
                }
                draggable="false"
              />
            )}
            {!image && (
              <div className="label-studio-preview-empty">
                {loading
                  ? "Rendering preview…"
                  : "Preview unavailable. Check the validation feedback."}
              </div>
            )}
            {guides && (
              <div
                className="label-safe-area"
                aria-hidden="true"
                style={{
                  inset: `${(2 / height) * 100}% ${(2 / width) * 100}%`,
                }}
              />
            )}
            {issues.map((issue, i) => {
              const e = elements[issue.index];
              return (
                e && (
                  <span
                    key={i}
                    className={`label-issue-outline ${issue.severity === "error" ? "is-error" : ""}`}
                    style={{
                      left: `${(e.x / width) * 100}%`,
                      top: `${(e.y / height) * 100}%`,
                      width: `${(e.w / width) * 100}%`,
                      height: `${(e.h / height) * 100}%`,
                    }}
                    aria-hidden="true"
                  />
                )
              );
            })}
            {children}
          </div>
        </div>
      </div>
      <div className="label-studio-canvas-caption">
        <span>
          {sample
            ? "Illustrative SKU fields · Production placeholders"
            : "Selected SKU content · Production placeholders"}
        </span>
        <span>
          {guides ? "2 mm edge guide · not printed" : "Guides hidden"}
        </span>
      </div>
      {(error || issues.length > 0) && (
        <div className="label-studio-validation" aria-live="polite">
          {error && !issues.some((i) => i.severity === "error") && (
            <p role="alert">
              <AlertTriangle size={15} />
              {error}
            </p>
          )}
          {issues.map((issue, i) => (
            <button
              type="button"
              key={i}
              className={issue.severity === "error" ? "is-error" : ""}
              onClick={() => onSelect?.(issue.index)}
              disabled={!onSelect}
            >
              <AlertTriangle size={14} />
              <span>
                <strong>
                  {labelElementName(
                    elements[issue.index] || {},
                    issue.index,
                    elements,
                  )}
                </strong>{" "}
                · {issue.message}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
