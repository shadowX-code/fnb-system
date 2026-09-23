import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import AdminFormField from "../../../components/forms/AdminFormField.jsx";
import "./SopKeyPointField.css";

export default function SopKeyPointField({ value = "", onChange }) {
  const [active, setActive] = useState(Boolean(value));
  useEffect(() => { if (value) setActive(true); }, [value]);

  return <div className="crew-sop-key-point-field">
    {!active ? <button type="button" className="btn-secondary" onClick={() => setActive(true)}><Plus size={15} aria-hidden="true" /> Add Key Point</button> : <>
      <div className="crew-sop-key-point-head"><div><strong>Key Point</strong><small>Optional callout shown after the Section content.</small></div><button type="button" className="btn-ghost" onClick={() => { onChange(""); setActive(false); }}>Remove Key Point</button></div>
      <AdminFormField label="Key Point Content"><textarea className="control min-h-24 w-full py-3" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Write the key point…" /></AdminFormField>
    </>}
  </div>;
}
