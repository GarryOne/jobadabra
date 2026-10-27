# Jobadabra Spec Kit Constitution

Spec Kit is the canonical authoring workflow for substantial new features. Its feature artifacts
(specification, plan, tasks, and any supporting design) live together under
`docs/superpowers/specs/`; use `SPECIFY_FEATURE_DIRECTORY=docs/superpowers/specs/YYYY-MM-DD-<slug>`
before `$speckit-specify`. The project-local `spec-template` override keeps a `## Progress`
checklist of high-level outcomes in `spec.md` for `report-progress`; the sibling `tasks.md` holds
detailed implementation tasks. Existing dated specifications in that directory remain valid and
are not migrated or regenerated. Link relevant existing specs and architecture/rule documents
rather than copying them.

## Principles

### Preserve project safety and data boundaries

Every feature must honor `CLAUDE.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, and the applicable
`docs/rules/` documents. Never automate application submission, fabricate user facts, leak
credentials, or move user data outside its owning store. A plan must identify relevant safety,
privacy, and data-ownership constraints.

### Fit the existing architecture

Use the established runtime, store interface, component, and test conventions. Keep public and
private repository boundaries intact. Do not introduce site-specific scraping logic or duplicate
existing project guidance in feature artifacts; link to the canonical rule instead.

### Verify proportionately

Use the project's change tiers and cheapest test method that demonstrates the requirement, as
documented in `AGENTS.md` and `docs/rules/change-loop.md`. A new behavior gets focused evidence;
do not add broad local suites or ceremonies beyond the applicable tier. Tests do not use the
owner's live accounts, data, secrets, or paid AI services.

### Keep approval and shipping authority with the owner

Agents prepare a reviewable branch and PR through `tools/ship.sh`; the owner reviews and merges.
Never bypass the required checks, modify frozen workflow/ship/harness files outside the stated
authorization, or weaken a project safety rule. Record explicit owner decisions in the project
artifacts or decision log when applicable. Follow `AGENTS.md`'s delegation limit: do not dispatch
subagents unless the owner or an applicable repo rule explicitly calls for them.

## Workflow relationship

Spec Kit owns the canonical feature specification, implementation plan, and task artifacts for
substantial new work. Superpowers remains the source of design, debugging, TDD, review, and
verification practices; use these practices without creating a second copy of the same spec or
requiring two approval chains. Small bug fixes and Tier 0 changes remain lightweight under
`docs/rules/change-loop.md`; Spec Kit's optional bug-fixing extension may be used when helpful,
but is not mandatory.

For the detailed entrypoints and commands, see `docs/spec-driven-development.md`.

## Governance

This constitution summarizes existing owner-approved project rules; it does not override them.
If it conflicts with `AGENTS.md`, `CLAUDE.md`, or an applicable `docs/rules/` document, follow the
more specific canonical project rule and propose a constitution update in the same reviewed
change. Amend this file only to reflect an explicit owner decision or a correction to the source
rules.

**Version**: 1.0.0 | **Ratified**: 2026-10-27 | **Last Amended**: 2026-10-27
