# Onboarding Tooltip Copy for NeatMail

## Tooltip 1: Label Hover
**Primary (12 words):**
Click to create a label—organize your inbox your way

**Alternative A (11 words):**
Create a label to sort emails by priority or topic

**Alternative B (13 words):**
Organize emails into labels. Start with what matters most.

---

## Tooltip 2: Generate Draft Button
**Primary (12 words):**
Let AI write your reply. Review and send in seconds.

**Alternative A (10 words):**
AI writes the draft. You pick what to send.

**Alternative B (12 words):**
Generate a smart reply based on your email history

---

## Tooltip 3: Email Hover
**Primary (11 words):**
Email is ready to go. Label it or draft a reply.

**Alternative A (10 words):**
Ready to organize? Label this or generate a draft.

**Alternative B (13 words):**
This email is waiting. Label it or reply automatically.

---

## Implementation Notes

These tooltips are designed for `react-joyride` tour component and should appear:

1. **On first login** for new users
2. **Sequential order:** Label → Draft → Email
3. **Tone:** Encouraging, not instructional
4. **Duration:** Show for 4-6 seconds, then auto-advance
5. **Skip option:** Users can skip the tour

### Usage Example

```tsx
const steps = [
  {
    target: '.label-button',
    content: 'Click to create a label—organize your inbox your way',
  },
  {
    target: '.generate-draft-button',
    content: 'Let AI write your reply. Review and send in seconds.',
  },
  {
    target: '.email-item',
    content: 'Email is ready to go. Label it or draft a reply.',
  },
];
```
