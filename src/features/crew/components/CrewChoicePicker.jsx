import { useState } from "react";
import { useTranslation } from "react-i18next";
import ChoiceList from "../../../components/forms/ChoiceList.jsx";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewPickerField from "./CrewPickerField.jsx";

export function CrewChoiceList(props) {
  return <ChoiceList {...props} crew />;
}

/** Shared Crew single-choice field: a compact trigger backed by the canonical sheet/list vocabulary. */
export default function CrewChoicePicker({ label, value, options, onChange, placeholder, description, disabled = false, variant = "field" }) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder || t("picker.chooseOption");
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return <CrewPickerField label={label} display={selected?.label || resolvedPlaceholder} ariaLabel={resolvedPlaceholder} open={open}
    onOpen={() => setOpen(true)} disabled={disabled} variant={variant}>
    <CrewBottomSheet title={label || resolvedPlaceholder} description={description} onClose={() => setOpen(false)}>
      <CrewChoiceList label={label || resolvedPlaceholder} options={options} value={value} onChange={nextValue => { onChange(nextValue); setOpen(false); }} />
    </CrewBottomSheet>
  </CrewPickerField>;
}
