// Escapes only the characters Telegram HTML mode cares about
export function escapeTelegramHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function htmlToTelegramHtml(html: string): string {
  // Use html-to-text but with tags preserved as Telegram-safe equivalents
  // We'll do a targeted strip instead of full conversion

  return html
    // Drop elements we never want
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<img[^>]*>/gi, "")

    // Keep block structure as line breaks
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/h[1-6]>/gi, "\n\n")

    // Map to Telegram-supported inline tags
    .replace(/<(strong|b)[^>]*>/gi, "<b>")
    .replace(/<\/(strong|b)>/gi, "</b>")
    .replace(/<(em|i)[^>]*>/gi, "<i>")
    .replace(/<\/(em|i)>/gi, "</i>")
    .replace(/<(u|ins)[^>]*>/gi, "<u>")
    .replace(/<\/(u|ins)>/gi, "</u>")
    .replace(/<(s|strike|del)[^>]*>/gi, "<s>")
    .replace(/<\/(s|strike|del)>/gi, "</s>")
    .replace(/<code[^>]*>/gi, "<code>")
    .replace(/<pre[^>]*>/gi, "<pre>")

    // Keep anchor hrefs
    .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>/gi, '<a href="$1">')

    // Strip all remaining unknown tags (but keep their text content)
    .replace(/<(?!\/?(?:b|i|u|s|code|pre|a)\b)[^>]+>/gi, "")

    // Clean up excess blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}