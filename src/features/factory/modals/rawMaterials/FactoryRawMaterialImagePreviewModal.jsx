import { useRef, useState } from "react";
import Modal from "../../../../components/feedback/Modal.jsx";
import { Field, inputClass } from "../../components/FactoryBulkSelectionModal.jsx";
import SearchableSelect from "../../components/SearchableSelect.jsx";

const rawMaterialLabel = (material) => material?.name_en || material?.name || "";
export default function RawMaterialImagePreviewModal({ material, onClose }) {
  return (
    <Modal
      title={rawMaterialLabel(material)}
      description={material?.material_code || "Raw material image"}
      size="2xl"
      onClose={onClose}
      footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
    >
      <div className="overflow-hidden rounded-2xl border border-border bg-slate-50">
        <img className="max-h-[70vh] w-full object-contain" src={material?.image_url || ""} alt={rawMaterialLabel(material)} />
      </div>
    </Modal>
  );
}
