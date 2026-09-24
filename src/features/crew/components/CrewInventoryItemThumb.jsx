import { useState } from "react";
import { Package } from "lucide-react";

export default function CrewInventoryItemThumb({ item, className = "" }) {
  const [failed, setFailed] = useState(false);
  const url = item?.photo_url;
  return <span className={`crew-inventory-thumb ${className}`.trim()} aria-hidden="true">
    {url && !failed ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <Package size={19} />}
  </span>;
}
