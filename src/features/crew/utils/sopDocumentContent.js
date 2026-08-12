const ALLOWED_TAGS = new Set(["P", "BR", "STRONG", "B", "EM", "I", "MARK", "UL", "OL", "LI", "A"]);
const DROP_WITH_CONTENT_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "META", "LINK"]);
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

function templateContentHtml(template) {
  const container = document.createElement("div");
  container.append(template.content.cloneNode(true));
  return container.innerHTML;
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
      if (DROP_WITH_CONTENT_TAGS.has(child.tagName)) {
        child.remove();
        return;
      }
      if (child.tagName === "SPAN" && /background(?:-color)?\s*:/i.test(child.getAttribute("style") || "")) {
        const mark = document.createElement("mark");
        mark.append(...child.childNodes);
        child.replaceWith(mark);
        cleanNode(mark);
        return;
      }
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
  return templateContentHtml(template);
}

export function parseSopBody(value = "", legacyKeyPoint = false) {
  let source = String(value || "");
  if (typeof document === "undefined") {
    return { html: source, keyPointContent: legacyKeyPoint ? source : "" };
  }
  let template = document.createElement("template");
  template.innerHTML = source;
  let keyPoints = [...template.content.querySelectorAll(KEY_POINT_SELECTOR)];
  if (!keyPoints.length && /&lt;\/?(?:p|br|strong|b|em|i|mark|ul|ol|li|a|aside)\b/i.test(source)) {
    const decoder = document.createElement("textarea");
    decoder.innerHTML = source;
    source = decoder.value;
    template = document.createElement("template");
    template.innerHTML = source;
    keyPoints = [...template.content.querySelectorAll(KEY_POINT_SELECTOR)];
  }
  const keyPointContent = keyPoints[0]?.textContent?.trim() || (legacyKeyPoint ? template.content.textContent?.trim() || "" : "");
  keyPoints.forEach((node) => node.remove());
  template.content.querySelectorAll("p,div").forEach((node) => {
    const text = node.textContent?.trim() || "";
    if (text.startsWith("<aside") && text.includes("data-feedx-key-point") && text.endsWith("</aside>")) node.remove();
  });
  if (legacyKeyPoint && !keyPoints.length) return { html: "", keyPointContent };
  const remainingHtml = templateContentHtml(template);
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(remainingHtml);
  return {
    html: sanitizeSopHtml(looksLikeHtml ? remainingHtml : plainTextToSopHtml(template.content.textContent || "")),
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
