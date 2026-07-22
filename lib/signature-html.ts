// Dependency-free signature helpers safe for both client and server; sanitization lives in lib/sanitize-signature.ts.

// Gated on known editor tags only, so legacy plain text like "Jane Smith <jane@acme.com>" isn't misread as HTML and stripped.
const HTML_TAG_RE =
  /<\/?(?:p|div|span|br|a|img|ul|ol|li|strong|b|em|i|u|s|strike|blockquote|h[1-3])(?=[\s/>])/i;

/** Does this string contain real (allowlisted) HTML markup, vs plain text? */
export function looksLikeHtml(value: string): boolean {
  return HTML_TAG_RE.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Passes new HTML signatures through untouched; escapes legacy plain-text ones and converts line breaks to <br> so they don't collapse.
export function toEditorHtml(stored: string | null | undefined): string {
  if (!stored) return "";
  if (looksLikeHtml(stored)) return stored;
  return `<p>${escapeHtml(stored).replace(/\r?\n/g, "<br>")}</p>`;
}
