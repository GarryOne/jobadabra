# Application answers location column

Add a persistent Location column to All, Needs review, and Saved answer rows so a person can find and edit a reusable answer in its canonical home. Derive destinations from the existing section/home metadata and preserve the single-store ownership model. Reuse the Profile tab routes and existing design tokens; don't duplicate answer facts or change them during navigation. Unknown destinations remain honestly unlinked. Keep d16's save-completion behavior intact.

Approaches considered: keep location as the subtitle (doesn't satisfy the requested column); add a nested table (conflicts with the existing row grid); add a location cell to the existing row grid and stack it under the question at narrow widths (chosen; preserves one row model and gives each home a clear route).

Acceptance: every rendered row has a consistent question/location/status/action alignment; known locations open the correct Profile tab and editing context; saved rows retain their destination; narrow layouts keep the link visible and unclipped; location clicks don't toggle the row; search, filters, remembered view, editor drafts, and leave guards remain intact. Unknown destinations have truthful text without a dead link.

Design system and UI checks: [desktop UI rules](../../rules/desktop-ui.md), [desktop change loop](../../rules/change-loop.md), [UI look and feel skill](../../../.claude/skills/ui-look-and-feel/SKILL.md).

## Progress

### 1. Destination map and row interaction
- [ ] Build destinations from authoritative row/home metadata; cover Your details, reusable answers, cover-letter style, and unknowns. (proof: focused navigation behavior test)
- [ ] Add Location to All, Needs review, and Saved while preserving d16's completion behavior. (proof: answers tests and rendered states)
- [ ] Verify known links select their canonical tab/context and don't toggle/edit the answer. (proof: focused navigation behavior test)

### 2. Responsive screen and delivery
- [ ] Render fictional before/after examples at standard and narrow sizes in light and dark; inspect the actual images.
- [ ] Run touched tests, changed-JS lint and the repository fast gate; create the d20 PR and monitor its current-head CI until owner merge.
