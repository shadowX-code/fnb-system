import { useState } from "react";
import { useTranslation } from "react-i18next";
import CrewBottomSheet from "./CrewBottomSheet.jsx";
import CrewChoicePicker from "./CrewChoicePicker.jsx";
import CrewPickerField from "./CrewPickerField.jsx";

const timeOptions = length => Array.from({ length }, (_, i) => {
  const value = String(i).padStart(2, "0");
  return { value, label: value };
});
const hours = timeOptions(24);
const minutesAndSeconds = timeOptions(60);

export default function CrewTimePicker({ label, value, onChange }) {
  const { t } = useTranslation();
  const [parts, setParts] = useState(null);
  const units = [
    { label: t("picker.hour"), options: hours },
    { label: t("picker.minute"), options: minutesAndSeconds },
    { label: t("picker.second"), options: minutesAndSeconds },
  ];
  function changePart(index, nextValue) {
    setParts(current => current.map((part, i) => i === index ? nextValue : part));
  }
  function confirm(next) {
    onChange(next);
    setParts(null);
  }
  return <CrewPickerField label={label} display={value || t("picker.selectTime")} open={parts !== null}
    onOpen={() => { const [hour, minute, second = "00"] = (value || "09:00").split(":"); setParts([hour, minute, second]); }}>
    {parts && <CrewBottomSheet title={label} onClose={() => setParts(null)} footer={<>
      <button className="crew-mobile-secondary" type="button" onClick={() => confirm("")}>{t("picker.clear")}</button>
      <button className="crew-mobile-primary" type="button" onClick={() => confirm(parts.join(":"))}>{t("common.done")}</button>
    </>}>
      <div className="crew-ui-field-grid">
        {units.map((unit, index) => <CrewChoicePicker key={unit.label} label={unit.label} value={parts[index]}
          options={unit.options} onChange={next => changePart(index, next)} />)}
      </div>
    </CrewBottomSheet>}
  </CrewPickerField>;
}
