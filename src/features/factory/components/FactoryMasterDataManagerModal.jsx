import Modal from "../../../components/feedback/Modal.jsx";
import { FactoryDataSurface, FactoryTable } from "./FactoryDataDisplay.jsx";

export default function FactoryMasterDataManagerModal({
  title,
  description,
  editorTitle,
  editorDescription,
  editor,
  columns,
  rows,
  emptyTitle,
  emptyDescription,
  footer,
  onClose,
  saving = false,
  size = "2xl",
}) {
  return (
    <Modal
      title={title}
      description={description}
      size={size}
      onClose={saving ? undefined : onClose}
      footer={footer}
    >
      <div className="space-y-5">
        <section className="border-b border-border pb-5">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-text-primary">{editorTitle}</h3>
            {editorDescription ? <p className="mt-1 text-xs text-text-secondary">{editorDescription}</p> : null}
          </div>
          {editor}
        </section>
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Records</h3>
          </div>
          <FactoryDataSurface>
            <FactoryTable
              columns={columns}
              rows={rows}
              emptyTitle={emptyTitle}
              emptyDescription={emptyDescription}
              rowHover="mint"
            />
          </FactoryDataSurface>
        </section>
      </div>
    </Modal>
  );
}
