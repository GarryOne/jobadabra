# Adopt GitHub Spec Kit

**Status:** Adoption setup in review; not adopted on `main` until the owner merges the PR.

## Intent

Make the current GitHub Spec Kit CLI and Codex integration available to Jobadabra, while preserving
the project's safety rules, current spec archive, Superpowers practices, and owner-controlled PR
merge process.

## Approaches considered

- Initialize Spec Kit in place through a clean isolated worktree (chosen): provides the official
  generated Codex skills and shared templates with a reviewable diff.
- Hand-copy selected skills/templates: rejected because it would drift from the supported CLI and
  require manual maintenance of generated agent commands.
- Keep using Superpowers specs without Spec Kit: rejected because the owner explicitly asked to
  adopt Spec Kit.

## Scope and boundaries

- Install uv and a version-verified Specify CLI with an official supported installer.
- Initialize in this task's isolated Jobadabra worktree using the current `codex` integration.
- Preserve existing dated specs and established project rules; do not infer or backfill specs for
  existing behavior.
- Make Spec Kit the canonical authoring workflow for substantial new features, with feature
  artifacts together under `docs/superpowers/specs/`.
- Keep Superpowers' design, debugging, TDD, review, and verification methods as practices that
  complement Spec Kit, without duplicate artifacts or approval chains.
- Keep small fixes lightweight, preserve CI/ship freezes, and hand a reviewable PR to the owner.

## Acceptance criteria

1. `uv` and `specify` are installed for the owner; `specify version` reports the verified CLI.
2. The Codex integration's generated skills and `.specify/` assets are present in the isolated
   branch, with secrets and agent-local state excluded from staging.
3. The constitution links to existing project guidance and does not override its safety,
   architecture, testing-tier, or owner-merge rules.
4. Project instructions name the current `$speckit-*` entrypoints, artifact location, and
   small-fix exception; old specs remain in place.
5. Focused generated-asset/setup checks and the repository fast gate complete, then a normal PR is
   opened with its watcher and ship-log registration intact.

## Progress

- [x] Read canonical repo instructions and current Spec Kit official docs. (proof: docs/spec-driven-development.md)
- [x] Create the dedicated `adopt-spec-kit` worktree from `origin/main`. (proof: none: worktree creation is recorded in the task session; no changed repo file can prove the base)
- [x] Install and verify uv 0.13.6 and Specify CLI 1.2.3. (proof: docs/spec-driven-development.md)
- [x] Initialize and inspect the generated Codex integration in the worktree. (proof: .specify/integrations/codex.manifest.json)
- [x] Write the constitution, adoption guide, and bounded implementation plan. (proof: .specify/memory/constitution.md, docs/spec-driven-development.md, docs/superpowers/plans/2026-10-27-adopt-spec-kit.md)
- [ ] Run focused checks and the normal fast gate.
- [ ] Open the review PR and report its head, ship log, and current CI status.

## Risks and constraints

- The CLI's `--force` merge can replace files at generated managed paths. The run occurred only
  in a clean dedicated worktree based on `origin/main`, and its generated diff is reviewed here.
- `.agents/` may contain private local agent state; Git allowlists only the generated Spec Kit
  skill files.
- Generated default Spec Kit prompts can need adaptation for future features. Project-specific
  artifact placement and rules are documented outside those generated command files, which must
  remain unmodified by hand.
