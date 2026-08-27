import { CircleAlert } from "lucide-react";
import CrewRichContent from "./CrewRichContent.jsx";
import CrewSopImage from "./CrewSopImage.jsx";
import { parseSopBody } from "../utils/sopDocumentContent.js";
import "./CrewSopDocument.css";

const orderedSections = (sections = []) => [...sections].sort(
  (left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0),
);

export default function CrewSopDocument({
  sections = [],
  token = "",
  sopVersionId = "",
  admin = false,
  className = "",
  sectionRefs,
}) {
  const rows = orderedSections(sections);

  if (!rows.length) {
    return (
      <div className="crew-sop-reader-empty" role="status">
        <strong>No content yet</strong>
        <p>This SOP has no content in this version.</p>
      </div>
    );
  }

  return (
    <article className={`crew-sop-reader-document ${className}`.trim()}>
      {rows.map((section, index) => {
        const content = parseSopBody(section.body, section.key_point);
        const media = section.media || (section.media_id ? {
          id: section.media_id,
          caption: section.media_caption,
        } : null);

        return (
          <section
            key={section.id || `${section.title}-${index}`}
            className="crew-sop-reader-section"
            ref={(node) => { if (section.id && sectionRefs?.current) sectionRefs.current[section.id] = node; }}
            tabIndex={sectionRefs ? -1 : undefined}
          >
            <span className="crew-sop-reader-number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="crew-sop-reader-section-content">
              <h3>{section.title}</h3>
              {content.html ? <CrewRichContent html={content.html} /> : null}
              <CrewSopImage media={media} token={token} sopVersionId={sopVersionId} admin={admin} />
              {content.keyPointContent ? (
                <aside className="crew-ui-note crew-ui-note--mint crew-sop-reader-key-point" aria-label="Key point">
                  <CircleAlert size={17} aria-hidden="true" />
                  <span><p>{content.keyPointContent}</p></span>
                </aside>
              ) : null}
            </div>
          </section>
        );
      })}
    </article>
  );
}
