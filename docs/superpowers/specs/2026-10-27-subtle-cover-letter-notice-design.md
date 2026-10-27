# Subtle cover-letter notice

## Intent
The extension panel’s missing-letter notices currently read like urgent alerts and consume too much space. Make missing-draft and delivery-failed states compact, calm, and aligned with the dark panel while keeping the reason and next action clear.

## Observable behavior and acceptance
- Both a missing usable draft and a form that did not retain a letter use the same restrained notice treatment: small aligned icon, sentence-case title, readable concise message, soft neutral surface and border, and a quiet inline action.
- Missing draft links to the existing Profile → Cover letter destination using `panelOpenApp` / `setup:cover-letter`; clicking it only navigates and does not start drafting or invoke a model.
- Delivery failure keeps its recovery-specific explanation and a clearly named “Show on form” action that focuses the failed letter control. It never suggests the letter was saved or attached.
- The actual high-priority queue entry, ready/count semantics, and routing remain unchanged. This is presentation and copy only.
- Focus remains visible, text remains readable in light and dark themes, and actions wrap without horizontal overflow in a narrow panel.
- Apply the same treatment to equivalent cover-letter variants rendered by the shared notice.

## Constraints and non-goals
Reuse the existing panel tokens and routing; no dependency, font, design-system, business-logic, queue, or priority changes. Never hide the delivery error or automate letter creation.

## Approaches
A separate visual variant for each state would preserve more bespoke styling but risks returning to inconsistent alert treatments. Reuse one compact neutral notice with state-specific concise copy and action is the chosen approach because the states share the same cover-letter context and the panel already has a single component for them.

## Progress
- [x] Inspect landed cover-letter implementation and confirm route contract. (proof: extension/panel-markup.js)
- [x] Implement the shared notice presentation and state-specific inline actions. (proof: extension/panel-markup.js)
- [x] Verify both rendered states, setup navigation without generation, manual recovery, normal/narrow screenshots, lint, focused tests, and journey proof. (proof: desktop/test/journeys-cover-letter-notice.js)
- [ ] Run the complete fast gate on the reviewed PR head. (proof: desktop/test/journeys-cover-letter-notice.js)
- [ ] Open PR for owner review; owner merges manually.
