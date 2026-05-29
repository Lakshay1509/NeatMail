---
name: NeatMail
description: An AI-powered email management tool that organizes your inbox with calm, sharp focus.
colors:
  canvas: "#ffffff"
  ink: "#1a1a1a"
  ink-secondary: "#6b6b6b"
  ink-muted: "#828282"
  surface-raised: "#f9f9f9"
  surface-subtle: "#f5f5f5"
  hairline: "#e8e8e8"
  destructive: "#c43a3a"
  ring: "#ababab"
  digest-critical: "#C45B4A"
  digest-attention: "#B8860B"
  digest-new: "#6B9080"
  digest-canvas: "#fafaf8"
typography:
  display:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontWeight: 400
    lineHeight: 1.1
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: 1rem
    lineHeight: 1.6
  mono:
    fontFamily: "Geist Mono, monospace"
    fontSize: 0.875rem
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "0.625rem"
  lg: "10px"
  xl: "14px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "rgba(26, 26, 26, 0.9)"
  button-secondary:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  badge-default:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  badge-soft:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
---

# Design System: NeatMail

## 1. Overview

**Creative North Star: "The Clear Horizon"**

NeatMail's visual system is built on restraint. The interface should feel like standing at a clear horizon: open, uncluttered, with priorities naturally visible and noise receding to nothing. Every pixel earns its place; every element that does not advance the user's task is removed without ceremony.

The palette is deliberately achromatic. Pure grayscale neutrals (OKLCH chroma 0) carry the surface. Color enters only through semantic status signals (critical, attention, new) in the digest system and destructive actions. This is not "safe" or "boring": it is the deliberate choice of a tool that refuses to compete with its content. Color belongs to the user's emails, not to the chrome.

The system is flat by default. Surfaces sit at the same elevation at rest. Shadows appear only in response to state: hover elevation on interactive cards, modal backdrops, dropdown surfaces. This keeps the canvas calm and the affordances clear.

What this system rejects: decorative gradients, hero-stat templates, glassmorphism, side-stripe borders, gradient text, identical card grids, and any visual flourish that announces "SaaS product" before it communicates utility. Alignment with PRODUCT.md anti-references: no over-designed SaaS clichés, no information overload, no decoration that competes with function.

**Key Characteristics:**
- Achromatic neutral palette with pure grayscale
- Color reserved for meaning (status, destruction, focus rings)
- Flat-at-rest elevation; shadows as state signals only
- Bricolage Grotesque display + Geist body in restrained hierarchy
- shadcn/ui component primitives, customized for the neutral palette
- Dark mode with inverted token assignments
- Digest editorial palette as a self-contained subsystem

## 2. Colors

The palette is monochromatic by design. Every surface, border, and text color is a step on a 9-stop grayscale ramp from pure white to near-black. This is the system's identity, not its absence: the tool stays quiet so the user's email stays loud.

### Neutral

- **Canvas** (#ffffff / oklch(1 0 0)): The base page background. Every page starts here in light mode.
- **Ink** (#1a1a1a / oklch(0.205 0 0)): Primary text color. All body copy, headings, and critical labels. Also serves as the primary button fill.
- **Ink Secondary** (#6b6b6b): Supporting text. Descriptions, secondary labels, metadata. Used sparingly; primary copy always returns to Ink.
- **Ink Muted** (#828282 / oklch(0.556 0 0)): Placeholder text, disabled labels, timestamps. Least prominent text tier.
- **Surface Raised** (#f9f9f9 / oklch(0.985 0 0)): Cards, sidebars, popovers. One step above Canvas for subtle grouping.
- **Surface Subtle** (#f5f5f5 / oklch(0.97 0 0)): Secondary button fills, hover states, selected items, muted section backgrounds.
- **Hairline** (#e8e8e8 / oklch(0.922 0 0)): Borders, input strokes, dividers. Thin and quiet.
- **Destructive** (#c43a3a / oklch(0.577 0.245 27.325)): Delete buttons, error states, critical warnings. The one saturated color in the core palette.
- **Ring** (#ababab / oklch(0.708 0 0)): Focus ring color.

### Semantic (Digest-only)

The digest editorial palette is a self-contained subsystem used exclusively in digest emails and the digest dashboard section. These colors never bleed into the core app chrome.

- **Digest Critical** (#C45B4A): Action-needed emails, deadlines, urgent replies.
- **Digest Attention** (#B8860B): Pending responses, items that need a follow-up.
- **Digest New** (#6B9080): Fresh arrivals, unread, new since last check.
- **Digest Canvas** (#fafaf8): The digest email background. Slightly warmer than the app Canvas.

### Dark Mode

Dark mode inverts the neutral ramp. Canvas becomes near-black (oklch(0.145 0 0)). Ink becomes near-white (oklch(0.985 0 0)). All intermediate stops shift accordingly. The pure-grayscale commitment holds; the dark palette carries no blue or purple tint.

### Named Rules

**The Achromatic Default Rule.** The core palette uses zero chroma. Color is only introduced through semantic signals (destructive, digest status) or when the user's content (emails, labels, charts) brings its own. The chrome itself stays neutral.

**The Color Belongs to Content Rule.** If a color appears in the interface and it isn't destructive red, a status indicator, or chart data, it's a mistake. The tool is black and white; the user's emails are not.

## 3. Typography

**Display Font:** Bricolage Grotesque (with system-ui fallback)
**Body Font:** Geist (with system-ui fallback)
**Mono Font:** Geist Mono (with monospace fallback)

**Character:** Bricolage Grotesque brings a crafted, editorial quality through its variable weight axis and subtle Grotesque quirks. Geist provides a neutral, highly readable sans-serif body that stays out of the way. Together they create a clear hierarchy where display moments feel intentional and reading feels effortless.

### Hierarchy

- **Display** (weight: variable 400-800, clamp(2rem, 5vw, 3.5rem), line-height: 1.1): Dashboard page titles, hero moments. Bricolage Grotesque only. Use weight 600 for emphasis, 400 for calm presence.
- **Title** (weight: 600, 1.25rem, line-height: 1.3): Section headings within pages. Card titles. Bricolage Grotesque or Geist at this size.
- **Body** (weight: 400, 1rem, line-height: 1.6): All body copy, descriptions, labels, form text. Geist. Max line length 68ch.
- **Label** (weight: 500, 0.875rem, line-height: 1.4): Form labels, navigation items, button text, badge text. Geist. No uppercase tracking; labels are sentence case.
- **Mono** (weight: 400, 0.875rem, line-height: 1.5): Email headers, timestamps, code, data values. Geist Mono.

### Named Rules

**The Two-Voice Rule.** Bricolage Grotesque is the editorial voice: page titles, section headings, logo. Geist is the utility voice: body, labels, forms, navigation. Never use Bricolage for body copy; never use Geist for display moments above 1.25rem.

**The No All-Caps Rule.** Labels, buttons, and navigation items use sentence case or title case. All-caps is reserved exclusively for the digest status badges (CRITICAL, ATTENTION, NEW) where it serves a scan-purpose function. Nowhere else.

## 4. Elevation

The system is flat by default. All surfaces sit at the same elevation in their rest state. Depth and layering are communicated through background color contrast (Canvas → Surface Raised → Surface Subtle) and hairline borders, not through persistent shadows.

Shadows appear only as a response to interactive state. This is not a "no shadows" prohibition; it is a "shadows mean something is happening" contract. A shadow that persists at rest trains the user to ignore it. A shadow that appears on hover or drag says "this element is now active."

### Shadow Vocabulary

- **Hover elevate** (`box-shadow: 0 2px 8px rgba(0,0,0,0.08)`): Cards, rows, and list items on hover. Light and quick.
- **Floating surface** (`box-shadow: 0 4px 16px rgba(0,0,0,0.12)`): Dropdowns, popovers, tooltips. Medium weight, clearly separated from the canvas.
- **Modal backdrop overlay** (`rgba(0,0,0,0.5)` with z-index elevation): Full-screen dimming behind dialogs and modals. The modal itself carries the Floating surface shadow.

### Named Rules

**The Shadow-As-Event Rule.** No persistent shadows at rest. Every shadow in the interface is a response to an input event: hover, click, focus, drag, or modal open. If a surface sits still and carries a shadow, it's using language reserved for something else.

## 5. Components

### Buttons

- **Shape:** Rounded corners at `--radius` (0.625rem / 10px). Slightly softened, not pill-shaped.
- **Primary:** Near-black fill (`--primary` / #1a1a1a), white text. `h-9 px-4` (36px height, 16px horizontal). Hover lightens to 90% opacity. Focus ring: 3px at ring/50.
- **Secondary:** Surface Subtle fill (`--secondary` / #f5f5f5), near-black text. Same dimensions. Hover lightens to 80% opacity.
- **Destructive:** Destructive red fill, white text. Same dimensions. Dedicated destructive focus ring.
- **Outline:** White/Canvas background, Hairline border. Hover fills with Surface Subtle.
- **Ghost:** No background, no border. Hover fills with Surface Subtle. Used in toolbars and inline actions.
- **Link:** Text-only, primary text color, underline on hover. Used for navigation and inline links.
- **Sizes:** Icon (32px), XS (24px), SM (32px), Default (36px), LG (40px). Icon buttons carry data attributes for variant tracking.
- **Disabled:** 50% opacity, `pointer-events: none`.

### Badges

- **Shape:** Fully rounded pill (`rounded-full`). `px-2 py-0.5` internal padding.
- **Default:** Near-black fill, white text. Used for counts and primary label badges.
- **Secondary:** Surface Subtle fill, near-black text. Used for secondary metadata, tag chips.
- **Destructive:** Destructive red fill, white text. Used for error counts, critical labels.
- **Outline:** Hairline border, transparent background. Used for filter chips.
- **Size:** 12px font size, SVG icons at 12px. Compact and scannable.

### Inputs / Fields

- **Style:** 1px Hairline border on all sides, white/Canvas background, rounded-md corners.
- **Focus:** Border shifts to Ring color, 3px ring/50 glow appears.
- **Error:** Border shifts to Destructive, ring shifts to destructive/20.
- **Disabled:** 50% opacity, `pointer-events: none`.
- **Height:** Default 36px (h-9).

### Cards / Containers

- **Corner Style:** Rounded (`--radius` / 0.625rem).
- **Background:** Surface Raised (`--card` / #f9f9f9) in light mode, or Canvas in flat layouts.
- **Shadow:** None at rest. Hover elevate on interactive cards (0 2px 8px rgba(0,0,0,0.08)).
- **Border:** Hairline when separation from background is needed. Often omitted; background contrast is sufficient.
- **Padding:** `px-6 py-4` (24px horizontal, 16px vertical) standard.

### Navigation (Sidebar)

- **Style:** Surface Subtle background, Hairline right border. Fixed position, scrollable internally.
- **Items:** 16px icon + Geist label at 0.875rem / 500 weight. Active item: Surface Subtle background, bold weight (600). Hover: Surface Subtle fill.
- **Collapsible groups:** ChevronDown icon, animated rotation (framer-motion). Group label at 0.75rem, uppercase, tracked.
- **Mobile:** Collapsed by default. SidebarTrigger (hamburger button) in Navbar toggles open.
- **Footer:** Separator line (Hairline), user info section at bottom.

### Navbar (Top Bar)

- **Style:** Fixed to top, `z-50`. White/80 background with `backdrop-blur-md`. Hairline bottom border, shadow-sm.
- **Height:** `py-6` (24px vertical) on desktop, `py-4` (16px) on mobile.
- **Content:** SidebarTrigger (left), centered logo image (150px wide), Clerk UserButton (right).

### Digest Email Components (Editorial Subsystem)

- **Digest Card:** Digest Canvas background, Hairline border, Digest Shadow at rest. Digest Shadow Hover on hover. Rounded corners at 0.625rem.
- **Status Pills:** Fully rounded. Critical: Digest Critical fill + Digest Critical bg. Attention: Digest Attention fill + Digest Attention bg. New: Digest New fill + Digest New bg.
- **Time Labels:** Age text in Digest Ink Muted, 0.75rem, Geist.

## 6. Do's and Don'ts

### Do:

- **Do** use color only for meaning: destructive actions, status indicators, chart data, focus rings.
- **Do** keep the canvas achromatic. The tool's chrome is black, white, and gray. Let user content provide the color.
- **Do** use Bricolage Grotesque for display moments (page titles, section headings) and Geist for everything else.
- **Do** keep shadows reserved for interactive state. No persistent shadows at rest.
- **Do** use the surface ramp (Canvas → Surface Raised → Surface Subtle) to communicate depth without shadows.
- **Do** keep body line length at 68ch maximum.
- **Do** label buttons with verb + object. "Save changes" not "OK".
- **Do** respect `prefers-reduced-motion`. Every animation must have a no-motion fallback.

### Don't:

- **Don't** introduce a brand accent color. The palette is achromatic by design. Color means something; chrome color means nothing.
- **Don't** use gradient text (`background-clip: text`).
- **Don't** use side-stripe borders (`border-left` > 1px as colored accent).
- **Don't** use glassmorphism or backdrop-blur decoratively. The single use in the Navbar (blur behind fixed header) is functional, not stylistic.
- **Don't** use all-caps for body copy, button labels, or navigation items. Sentence case or title case only.
- **Don't** use hero-metric templates (big number + small label + supporting stats + gradient accent). These are SaaS clichés.
- **Don't** use identical card grids (icon + heading + text, repeated). If every card has the same shape, none of them matter.
- **Don't** use marketing buzzwords: streamline, empower, supercharge, leverage, unleash, seamless, next-generation. Be specific.
- **Don't** add tiny uppercase tracked eyebrows above sections ("ABOUT", "PROCESS", "PRICING"). Not in this product.
- **Don't** use numbered section markers (01 / 02 / 03) as default scaffolding. Only use numbers when the order genuinely carries information.
- **Don't** overflow text out of its container. Test headings at every breakpoint; reduce clamp max or rewrite copy.
