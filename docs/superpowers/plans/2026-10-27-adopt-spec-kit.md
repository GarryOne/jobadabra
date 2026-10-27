# Plan: Adopt GitHub Spec Kit

**Spec:** [2026-10-27-adopt-spec-kit.md](../specs/2026-10-27-adopt-spec-kit.md)

## Scope

Add the supported Specify CLI-generated Codex integration and shared project scaffolding, then
connect it to Jobadabra's current rules without changing product code or frozen workflow files.

## Tasks

1. Install uv through an official supported method, install Specify CLI from its official
   distribution at a verified version, and confirm the Codex integration key and initialization
   options from official documentation.
2. Initialize Spec Kit only in the isolated, clean worktree; review every generated path and limit
   staged `.agents/` files to the generated skill Markdown.
3. Replace the generated constitution placeholder with principles that point to existing canonical
   rules and preserve owner decisions; add the workflow guide, adoption spec/progress, and a
   project-local spec template override that retains `## Progress` reporting.
4. Link the guide from `AGENTS.md` and `CLAUDE.md`; confirm legacy specs remain untouched and small
   fixes have no mandatory Spec Kit ceremonies.
5. Run focused CLI and generated-file checks, inspect the complete diff, run the normal fast gate,
   register the ship log, and open the PR through `tools/ship.sh` for owner review.

## Verification

- `specify version` reports 1.2.3; `specify init --help` exposes current options; generated
  `.specify/init-options.json` identifies `codex` and 1.2.3.
- `specify integration status` succeeds in the initialized worktree and shows the configured
  integration; inspect the generated skills/manifest for complete Codex skill files.
- `.specify/scripts/bash/resolve-template.sh spec-template` resolves the project-local override,
  whose rendered output contains `## Progress` and `### N.` outcome headings; the
  `tools/ladder-progress.mjs` parser returns a bar for the generated checklist, while detailed
  implementation tasks remain in sibling `tasks.md`.
- `git check-ignore` excludes an unrelated `.agents` local-state file while `git status` includes
  only the generated allowlisted `SKILL.md` files.
- Review all changed paths for generated scripts, secrets, auth/config, unrelated files, and
  untouched existing specs; then run the project's fast ship gate.

## Constraints

Node commands use the explicit Node 22 PATH. Do not touch the primary checkout, frozen
`.github/workflows`, `tools/ship*`, or `desktop/e2e` harness libraries. Do not run a broad local
suite or paid-model call. Preserve the PR watcher and owner-only merge.
