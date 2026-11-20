import { useTranslation } from "react-i18next";
import CrewDatePicker from "./CrewDatePicker.jsx";
import CrewTimePicker from "./CrewTimePicker.jsx";

export default function CrewClosingCountFields({ month, cutoff, onMonthChange, onCutoffChange }) {
  const { t } = useTranslation();
  const [date = "", time = ""] = cutoff.split("T");
  return <div className="grid min-w-0 gap-3">
    <CrewDatePicker monthOnly label={t("inventory.accountingMonth")} placeholder={t("inventory.selectAccountingMonth")}
      value={month} onChange={onMonthChange} />
    <fieldset className="crew-ui-form-fields crew-choice-picker">
      <legend>{t("inventory.stockCountDateTime")}</legend>
      <div className="crew-ui-field-grid">
        <CrewDatePicker label={t("inventory.stockCountDate")} value={date} onChange={next => onCutoffChange(`${next}T${time}`)} />
        <CrewTimePicker label={t("inventory.stockCountTime")} value={time} onChange={next => onCutoffChange(`${date}T${next}`)} />
      </div>
      <p className="crew-picker-helper">{t("inventory.stockCountDateTimeHelp")}</p>
    </fieldset>
  </div>;
}
