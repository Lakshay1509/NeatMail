// Font/size/colour presets for the signature editor, adapted per mailbox provider so the picker feels native (Gmail named sizes, Outlook point sizes).

export type FontOption = { label: string; value: string };
export type SizeOption = { label: string; value: string };

// Gmail's compose/signature font menu (labels match Gmail's own wording).
export const GMAIL_FONTS: FontOption[] = [
  { label: "Sans Serif", value: "Arial, sans-serif" },
  { label: "Serif", value: '"Times New Roman", Times, serif' },
  { label: "Fixed Width", value: '"Courier New", monospace' },
  { label: "Wide", value: '"Arial Black", sans-serif' },
  { label: "Narrow", value: '"Arial Narrow", sans-serif' },
  { label: "Comic Sans MS", value: '"Comic Sans MS", cursive' },
  { label: "Garamond", value: "Garamond, serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Tahoma", value: "Tahoma, sans-serif" },
  { label: "Trebuchet MS", value: '"Trebuchet MS", sans-serif' },
  { label: "Verdana", value: "Verdana, sans-serif" },
];

// Gmail exposes four named sizes rather than raw pixels.
export const GMAIL_SIZES: SizeOption[] = [
  { label: "Small", value: "13px" },
  { label: "Normal", value: "14px" },
  { label: "Large", value: "18px" },
  { label: "Huge", value: "24px" },
];

// Outlook's font list, Calibri first to mirror its default.
export const OUTLOOK_FONTS: FontOption[] = [
  { label: "Calibri", value: "Calibri, sans-serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Times New Roman", value: '"Times New Roman", serif' },
  { label: "Courier New", value: '"Courier New", monospace' },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Segoe UI", value: '"Segoe UI", sans-serif' },
  { label: "Tahoma", value: "Tahoma, sans-serif" },
  { label: "Trebuchet MS", value: '"Trebuchet MS", sans-serif' },
  { label: "Verdana", value: "Verdana, sans-serif" },
];

// Outlook uses point sizes.
export const OUTLOOK_SIZES: SizeOption[] = [
  "8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "36", "48", "72",
].map((pt) => ({ label: pt, value: `${pt}pt` }));

// Google-Docs-style swatch grid used by the colour popover.
export const SIGNATURE_SWATCHES: string[] = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#ffffff",
  "#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8",
  "#0000ff", "#9900ff", "#ff00ff", "#e06666", "#f6b26b", "#93c47d", "#6d9eeb",
];

export type SignatureProviderConfig = {
  fonts: FontOption[];
  sizes: SizeOption[];
  defaultFont: string;
  defaultSize: string;
  /** Outlook's editor exposes paragraph alignment; Gmail's signature box does not. */
  showAlignment: boolean;
};

export function getSignatureConfig(isGmail: boolean): SignatureProviderConfig {
  if (isGmail) {
    return {
      fonts: GMAIL_FONTS,
      sizes: GMAIL_SIZES,
      defaultFont: GMAIL_FONTS[0].value,
      defaultSize: GMAIL_SIZES[1].value, // Normal
      showAlignment: false,
    };
  }
  return {
    fonts: OUTLOOK_FONTS,
    sizes: OUTLOOK_SIZES,
    defaultFont: OUTLOOK_FONTS[0].value,
    defaultSize: OUTLOOK_SIZES[4].value, // 12pt
    showAlignment: true,
  };
}
