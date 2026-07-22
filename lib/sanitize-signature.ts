import sanitizeHtml from "sanitize-html";

// Colours the editor can emit (setColor / setBackgroundColor): hex or rgb(a).
const COLOR_VALUES = [
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
  /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/,
  /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\)$/,
];

const LENGTH = [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/];

// Cap on the raw signature (validated by zod before sanitizing); sanitizing can grow it slightly since each link gains rel/target.
export const MAX_SIGNATURE_LENGTH = 10_000;

// Strips the signature to presentational markup only, since lib/gmail.ts and lib/outlook.ts embed it raw into outgoing HTML.
export function sanitizeSignatureHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: [
      "p", "br", "div", "span",
      "strong", "b", "em", "i", "u", "s", "strike",
      "a", "ul", "ol", "li", "blockquote",
      "img", "h1", "h2", "h3",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "style"],
      "*": ["style"],
    },
    allowedStyles: {
      "*": {
        color: COLOR_VALUES,
        "background-color": COLOR_VALUES,
        "font-size": LENGTH,
        "font-family": [/^[\w\s"',-]+$/],
        "font-weight": [/^(?:normal|bold|[1-9]00)$/],
        "font-style": [/^(?:normal|italic)$/],
        "text-align": [/^(?:left|right|center|justify)$/],
        "text-decoration": [/^(?:none|underline|line-through)$/],
        "max-width": [/^\d+(?:\.\d+)?(?:px|%)$/],
        width: [/^\d+(?:\.\d+)?(?:px|%)$/],
        height: [/^\d+(?:\.\d+)?(?:px|%|auto)$/],
      },
    },
    // No data: URIs, since base64 blobs bloat outgoing email and most clients strip them anyway.
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https"] },
    // Reject schemeless //host URLs so they can't bypass the img host restriction or turn an anchor off-origin.
    allowProtocolRelative: false,
    transformTags: {
      // Force safe link attributes while keeping the author's href.
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      }),
    },
  }).trim();
}
