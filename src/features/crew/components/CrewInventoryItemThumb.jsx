import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";
import CrewImageViewer from "./CrewImageViewer.jsx";

export default function CrewInventoryItemThumb({ item, className = "", inspectable = false }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [viewing, setViewing] = useState(false);
  const url = item?.photo_url;
  const content = <span className={`crew-inventory-thumb ${className}`.trim()} aria-hidden="true">
    {url && !failed ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <Package size={19} />}
  </span>;
  if (!inspectable || !url || failed) return content;
  return <><button className="crew-inventory-thumb-action" type="button" aria-label={t("inventory.viewItemImage", { name: item?.name || t("inventory.item") })} onClick={() => setViewing(true)}>{content}</button>
    {viewing && <CrewImageViewer src={url} alt={item?.name || t("inventory.item")} title={item?.name || t("inventory.item")} onClose={() => setViewing(false)} />}</>;
}
