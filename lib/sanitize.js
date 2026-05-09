// ─── Minimal HTML Sanitizer ──────────────────────────────────────
// Allows only safe tags/attributes for assessment content.
// Used by the extension player before rendering resolved HTML.

function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Safety net: DOMParser may return a document with null body in some contexts
  if (!doc || !doc.body) return html;
  const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'img']);
  const ALLOWED_ATTRS = new Set(['src', 'alt', 'style']);

  function clean(node) {
    if (node.nodeType === Node.COMMENT_NODE) {
      node.remove();
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (!ALLOWED_TAGS.has(node.tagName.toLowerCase())) {
        while (node.firstChild) {
          node.parentNode.insertBefore(node.firstChild, node);
        }
        node.remove();
        return;
      }
      for (const attr of [...node.attributes]) {
        if (!ALLOWED_ATTRS.has(attr.name)) {
          node.removeAttribute(attr.name);
        }
      }
      if (node.tagName.toLowerCase() === 'img') {
        const src = node.getAttribute('src');
        if (src && /^javascript:/i.test(src.trim())) {
          node.removeAttribute('src');
        }
      }
    }
    for (const child of [...node.childNodes]) {
      clean(child);
    }
  }

  clean(doc.body);
  return doc.body.innerHTML;
}
