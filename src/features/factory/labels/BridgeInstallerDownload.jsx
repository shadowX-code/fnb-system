import { useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { factoryLabelService } from "../../../services/factoryLabelService.js";

export default function BridgeInstallerDownload({ platform, primary = false }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setDownloading(true);
    setError("");
    try {
      const { fileName, file } = await factoryLabelService.downloadInstaller(platform);
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(failure.message || "Unable to download the installer.");
    } finally {
      setDownloading(false);
    }
  }

  return <div className="space-y-1">
    <button type="button" className={primary ? "btn-primary" : "btn-secondary"} disabled={downloading} onClick={download}>
      <ArrowDownToLine size={15} aria-hidden="true" />
      {downloading ? "Downloading…" : primary ? "Download Installer" : "Download Update"}
    </button>
    {error && <p role="alert" className="text-sm text-text-secondary">{error}</p>}
  </div>;
}
