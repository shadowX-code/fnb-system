// The server catalog controls which document types may be issued. This module
// formats the shared legacy warning labels and the server-projected type label.
export const warningTypeLabels = Object.freeze({
  first_written_warning: "First Written Warning",
  written_warning: "Written Warning",
  final_written_warning: "Final Written Warning",
});

export const warningTypeOptions = Object.freeze([
  { value: "written_warning", label: warningTypeLabels.written_warning },
  { value: "final_written_warning", label: warningTypeLabels.final_written_warning },
]);

export function isWarningRecord(record) {
  return (record?.document_type ?? "warning") === "warning";
}

export function letterNoticeTypeLabel(record) {
  return isWarningRecord(record)
    ? warningTypeLabels[record?.warning_type] ?? "Warning"
    : record?.type_label ?? "Notice";
}

export function letterNoticeReference(record) {
  return isWarningRecord(record) && record?.display_sequence
    ? `Warning #${record.display_sequence}`
    : letterNoticeTypeLabel(record);
}
