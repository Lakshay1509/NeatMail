// Removes HTML tags from text that is only used as plain text (classification, LLM context, link matching)

// Repeats until nothing changes, so a nested trick like "<scr<b>ipt>" can never leave a tag behind
export function stripTags(html: string): string {
  let text = html;
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]*>?/g, "");
  } while (text !== previous);
  return text;
}
