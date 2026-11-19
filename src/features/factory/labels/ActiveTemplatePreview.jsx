import { useEffect, useState } from "react";
import Modal from "../../../components/feedback/Modal.jsx";
import { factoryLabelService } from "../../../services/factoryLabelService.js";
import LabelStudioCanvas from "./LabelStudioCanvas.jsx";
import { labelTemplateDimensions, templatePreviewSnapshot } from "./labelManagementModel.js";
import useLabelPreview from "./useLabelPreview.js";
import "./labelManagement.css";

export default function ActiveTemplatePreview({ templateKey, name, onClose }) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    factoryLabelService.editor("template", templateKey).then(
      ({ published }) => { if (active) setResult({ published }); },
      (error) => { if (active) setResult({ error: error.message || "Unable to load the active template." }); },
    );
    return () => { active = false; };
  }, [templateKey, attempt]);

  const published = result?.published;
  return (
    <Modal
      title="Active template preview"
      description={published ? `${published.name} · v${published.version}` : name}
      size="md"
      onClose={onClose}
    >
      {published ? (
        <ActiveLayout template={published} />
      ) : result?.error ? (
        <div className="space-y-2">
          <p role="alert">{result.error}</p>
          <button type="button" className="btn-secondary" onClick={() => {
            setResult(null);
            setAttempt((current) => current + 1);
          }}>Retry</button>
        </div>
      ) : result ? (
        <p>This template has no active version.</p>
      ) : (
        <p role="status">Loading active template…</p>
      )}
    </Modal>
  );
}

function ActiveLayout({ template }) {
  const definition = template.definition;
  const dimensions = labelTemplateDimensions(template);
  const preview = useLabelPreview(templatePreviewSnapshot(dimensions, definition));
  return (
    <LabelStudioCanvas
      width={dimensions.width_mm}
      height={dimensions.height_mm}
      image={preview.image}
      loading={preview.loading}
      error={preview.error}
      issues={preview.issues}
      elements={definition.elements}
      title="Active layout"
      sample
    />
  );
}
