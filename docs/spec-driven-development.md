# Spec-driven development

Jobadabra uses GitHub Spec Kit for substantial new features. This keeps the feature specification,
implementation plan, and task list together while preserving the existing project rules and
lightweight path for small fixes.

## Tool setup

The owner installs the CLI once per machine. The current supported install is:

```sh
uv tool install specify-cli==1.2.3
specify version
```

Spec Kit requires Python 3.11+ and uv. The project was initialized with the Codex integration;
the generated skills live in `.agents/skills/speckit-*/SKILL.md`. Invoke them in Codex with the
`$speckit-...` syntax. The adoption setup verified Specify CLI 1.2.3 and uv 0.13.6. See the [official installation guide](https://github.github.io/spec-kit/installation.html),
[existing-project guide](https://github.github.io/spec-kit/guides/existing-projects.html), and
[Codex integration guide](https://github.github.io/spec-kit/integrations/codex.html) for current
CLI details. Do not rerun `specify init` in this repository as routine setup.

## New feature workflow

Use this for substantial new behavior, after the owner has asked for the work and its scope is
clear. Keep each feature's artifacts together in a dated directory under
`docs/superpowers/specs/`, for example `docs/superpowers/specs/2026-10-27-search-export/`.
Before invoking `$speckit-specify`, set `SPECIFY_FEATURE_DIRECTORY` to that directory. The
generated `spec.md`, `plan.md`, `tasks.md`, and supporting artifacts are the canonical artifacts
for that feature. `spec.md` keeps a high-level `## Progress` checklist for `report-progress`, while
the sibling `tasks.md` tracks detailed implementation tasks. The project-local override supplies
that section through the supported Spec Kit template resolution mechanism. Older flat dated specs
remain valid with their existing `## Progress` section; do not migrate or duplicate them.

1. Set the feature directory and invoke `$speckit-specify` with the requested outcome and
   compatibility boundaries.
2. Review the specification. Resolve real unknowns with `$speckit-clarify` when needed.
3. Invoke `$speckit-plan`; make it fit the architecture, current test tier, and relevant project
   rules. Add a bounded task list with `$speckit-tasks` and use `$speckit-analyze` when useful.
4. Apply Superpowers' design, debugging, TDD, and review practices where they improve the work;
   these practices do not create another specification or approval chain. The bundled Spec Kit
   full-cycle workflow is optional; do not add a second user approval gate to an already authorized
   task.
5. Implement with `$speckit-implement`, review the diff and artifacts, and use `$speckit-converge`
   to find remaining work. Verify using the project's change tier and method, then ship with
   `tools/ship.sh --background --body=<file>`. The owner merges the PR.

The constitution is [`.specify/memory/constitution.md`](../.specify/memory/constitution.md).
It summarizes existing rules and links to their canonical sources: [AGENTS.md](../AGENTS.md),
[`CLAUDE.md`](../CLAUDE.md), [architecture](ARCHITECTURE.md), and [change-loop rules](rules/change-loop.md).

## Small fixes

Small bug fixes and Tier 0 changes stay on the existing lightweight path in
[`docs/rules/change-loop.md`](rules/change-loop.md). Use the systematic debugging and test-first
practices when applicable; no Spec Kit spec, plan, task list, or extension is required for a
straightforward fix. Spec Kit's optional bug-fixing extension is available on demand with
`specify extension add bug` if a structured diagnosis would help.

## Adoption acceptance and progress

- [x] Install uv and a verified, pinned Specify CLI version for the owner.
- [x] Initialize only in the isolated project worktree with Codex integration.
- [x] Review generated files and prevent agent-local credentials/config from entering Git.
- [x] Establish a project constitution that preserves current safety and shipping rules.
- [x] Define canonical artifact locations and the relationship to existing specs and Superpowers.
- [x] Document concrete commands and the lightweight path for small fixes.
- [ ] Complete focused setup checks and the repository fast gate.
- [ ] Open a PR and hand it to the owner for review; adoption is not on `main` until merged.
