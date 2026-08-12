import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { crewService } from "../../../services/crewService.js";

export default function CrewLearningImage({ token, media }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState("loading");

  useEffect(() => {
    let active = true;
    setUrl("");
    setState("loading");
    crewService.learningMediaUrl(token, media?.id)
      .then((result) => {
        if (!active) return;
        setUrl(result.signed_url);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => { active = false; };
  }, [token, media?.id]);

  if (!media?.id) return null;
  return (
    <figure className="crew-learning-media">
      {state === "loading" ? <div className="crew-learning-media-state" aria-label="Loading lesson image" /> : null}
      {state === "error" ? <div className="crew-learning-media-error" role="status"><ImageOff size={20} /><span>Image unavailable</span></div> : null}
      {state === "ready" ? (
        <img
          src={url}
          alt={media.alt_text || media.caption || "Lesson image"}
          width={media.width || undefined}
          height={media.height || undefined}
          loading="lazy"
          onError={() => setState("error")}
        />
      ) : null}
      {media.caption ? <figcaption>{media.caption}</figcaption> : null}
    </figure>
  );
}
