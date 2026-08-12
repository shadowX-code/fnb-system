const ALLOWED_TAGS = new Set(["P", "BR", "STRONG", "B", "EM", "I", "MARK", "UL", "OL", "LI", "A"]);
const KEY_POINT_SELECTOR = 'aside[data-feedx-key-point="true"]';

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeHref(value = "") {
  const href = String(value).trim();
  if (!href) return "";
  if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
  return "";
}

export function plainTextToSopHtml(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`).join("");
}

export function sanitizeSopHtml(value = "") {
  if (typeof document === "undefined") return escapeHtml(String(value || ""));
  const template = document.createElement("template");
  template.innerHTML = String(value || "");
  const cleanNode = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      if (!ALLOWED_TAGS.has(child.tagName)) {
        cleanNode(child);
        child.replaceWith(...child.childNodes);
        return;
      }
      const originalHref = child.tagName === "A" ? child.getAttribute("href") : "";
      [...child.attributes].forEach((attribute) => child.removeAttribute(attribute.name));
      if (child.tagName === "A") {
        const href = safeHref(originalHref);
        if (href) {
          child.setAttribute("href", href);
          child.setAttribute("target", "_blank");
          child.setAttribute("rel", "noopener noreferrer");
        } else child.replaceWith(...child.childNodes);
      }
      cleanNode(child);
    });
  };
  cleanNode(template.content);
  return template.innerHTML;
}

export function parseSopBody(value = "", legacyKeyPoint = false) {
  const source = String(value || "");
  if (typeof document === "undefined") {
    return { html: source, keyPointContent: legacyKeyPoint ? source : "" };
  }
  const template = document.createElement("template");
  template.innerHTML = source;
  const keyPoint = template.content.querySelector(KEY_POINT_SELECTOR);
  const keyPointContent = keyPoint?.textContent?.trim() || (legacyKeyPoint ? template.content.textContent?.trim() || "" : "");
  keyPoint?.remove();
  if (legacyKeyPoint && !keyPoint) return { html: "", keyPointContent };
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(template.innerHTML);
  return {
    html: sanitizeSopHtml(looksLikeHtml ? template.innerHTML : plainTextToSopHtml(source)),
    keyPointContent,
  };
}

export function serializeSopBody(html = "", keyPointContent = "") {
  const cleanHtml = sanitizeSopHtml(html);
  const cleanKeyPoint = String(keyPointContent || "").trim();
  return `${cleanHtml}${cleanKeyPoint ? `<aside data-feedx-key-point="true"><p>${escapeHtml(cleanKeyPoint).replaceAll("\n", "<br>")}</p></aside>` : ""}`;
}

export function sopBodyPlainText(value = "") {
  if (typeof document === "undefined") return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const template = document.createElement("template");
  template.innerHTML = String(value || "");
  template.content.querySelectorAll("p,li,br,aside").forEach((node) => node.append(document.createTextNode(" ")));
  return template.content.textContent?.replace(/\s+/g, " ").trim() || "";
}
