import { createElement, Fragment, useMemo } from "react";
import { sanitizeSopHtml } from "../utils/sopDocumentContent.js";

const ALLOWED_ELEMENTS = new Set(["p", "br", "strong", "b", "em", "i", "mark", "ul", "ol", "li", "a"]);

function safeHref(value = "") {
  const href = String(value || "").trim();
  return /^(https?:|mailto:|tel:)/i.test(href) ? href : "";
}

function toReactNode(node, key) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.tagName.toLowerCase();
  const children = [...node.childNodes].map((child, index) => toReactNode(child, `${key}-${index}`));
  if (!ALLOWED_ELEMENTS.has(tag)) return createElement(Fragment, { key }, children);
  if (tag === "a") {
    const href = safeHref(node.getAttribute("href"));
    if (!href) return createElement(Fragment, { key }, children);
    return createElement("a", {
      key,
      href,
      target: "_blank",
      rel: "noopener noreferrer",
    }, children);
  }
  return createElement(tag, { key }, children);
}

export function safeRichTextNodes(html = "") {
  if (typeof document === "undefined") return [String(html || "")];
  const template = document.createElement("template");
  template.innerHTML = sanitizeSopHtml(html);
  return [...template.content.childNodes].map((node, index) => toReactNode(node, `rich-${index}`));
}

export default function CrewRichContent({ html = "", fallback = "", className = "" }) {
  const content = html || fallback;
  const nodes = useMemo(() => safeRichTextNodes(content), [content]);
  return <div className={`crew-rich-content ${className}`.trim()}>{nodes}</div>;
}
