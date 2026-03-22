export function extractUnsubscribeLinkFromBody(payload: any): string | null {
  if (!payload) return null;

  // Decode the body part
  const decode = (data: string) =>
    Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");

  const findHtml = (part: any): string | null => {
    if (part.mimeType === "text/html" && part.body?.data) {
      return decode(part.body.data);
    }
    if (part.parts) {
      for (const child of part.parts) {
        const result = findHtml(child);
        if (result) return result;
      }
    }
    return null;
  };

  const html = findHtml(payload);
  if (!html) return null;

  // Match links whose text or href contains "unsubscribe"
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const text = match[2].replace(/<[^>]+>/g, "").toLowerCase();
    if (text.includes("unsubscribe") || href.toLowerCase().includes("unsubscribe")) {
      return href;
    }
  }

  return null;
}

