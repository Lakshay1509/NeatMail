import sanitizeHtml from "sanitize-html";

// Escapes only the characters Telegram HTML mode cares about
export function escapeTelegramHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Converts agent HTML into the small tag set Telegram's HTML parse mode accepts
export function htmlToTelegramHtml(html: string): string {
  // Keep block structure as line breaks
  const withBreaks = html
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/h[1-6]>/gi, "\n\n");

  // sanitize-html drops <script>/<style> with their content, unwraps every other tag
  // (keeping its text), and escapes stray < > & so Telegram can always parse the result
  return sanitizeHtml(withBreaks, {
    allowedTags: ["b", "i", "u", "s", "code", "pre", "a"],
    allowedAttributes: { a: ["href"] },
    transformTags: { strong: "b", em: "i", ins: "u", strike: "s", del: "s" },
  })
    // Clean up excess blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
