import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { crewService } from "../../../services/crewService.js";

export default function CrewSopImage({ media, token = "", sopVersionId = "", admin = false }) {
  const [url, setUrl] = useState(media?.previewUrl || "");
  const [state, setState] = useState(media?.previewUrl ? "ready" : "loading");
  useEffect(() => {
    let active = true;
    if (!media?.id) return undefined;
    if (media.previewUrl) { setUrl(media.previewUrl); setState("ready"); return undefined; }
    setState("loading");
    const request = admin
      ? crewService.sopMediaAdminUrl(media.id).then((signedUrl) => ({ signed_url: signedUrl }))
      : crewService.sopMediaUrl(token, sopVersionId, media.id);
    request.then((result) => {
      if (!active) return;
      setUrl(result?.signed_url || "");
      setState(result?.signed_url ? "ready" : "error");
    }).catch(() => active && setState("error"));
    return () => { active = false; };
  }, [admin, media?.id, media?.previewUrl, sopVersionId, token]);
  if (!media?.id) return null;
  return <figure className="crew-sop-media">
    {state === "loading" ? <div className="crew-sop-media-state" aria-label="Loading SOP image" /> : null}
    {state === "error" ? <div className="crew-sop-media-state is-error" role="status"><ImageOff size={22} /> Image unavailable</div> : null}
    {state === "ready" ? <img src={url} alt={media.caption || "SOP illustration"} width={media.width || undefined} height={media.height || undefined} loading="lazy" /> : null}
    {media.caption ? <figcaption>{media.caption}</figcaption> : null}
  </figure>;
}
