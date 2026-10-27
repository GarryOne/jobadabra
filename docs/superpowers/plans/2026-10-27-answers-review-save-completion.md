# Application Answers save completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show immediate Set feedback in Needs review after a persisted answer, then remove the row without waiting for the queue reread.

**Architecture:** The question drawer publishes a completion event only after a successful, usable save and continues its existing local progress update. Application Answers keeps a transient row snapshot keyed by normalized question identity, excludes it from counts, and fades/removes it after a short bounded timer; canonical persistence remains authoritative.

**Tech Stack:** Electron renderer ES modules, Node test runner, tiny DOM tests, CSS variables and existing reduced-motion media query conventions.

**Spec:** [2026-10-27-answers-review-save-completion-design.md](../specs/2026-10-27-answers-review-save-completion-design.md)

## Global Constraints

- Never mark a job Applied; show Set only after successful persistence of a usable answer.
- Failures leave the row, value and error available; no user data or paid model calls.
- Animation state is transient, keyed by question identity, and survives redraw/filter changes only for its short lifetime.
- Keep renderer edits compatible with d9 profile routing and d14 typed date controls.

## Review Focus

- A persisted Your details answer leaves Needs review immediately while staying in Your details — cover the details question route.
- A reusable answer is recognized by label identity even when queue keys differ — cover normalized question matching.
- A failed/empty result must not acknowledge or reduce progress — cover failure result and empty action.
- A forced queue refresh and filter/rerender must not duplicate, resurrect, or remove another question — cover redraw and replacement timer identity.
- Reduced motion must skip the fade transition — cover CSS reduced-motion selector.

---

### Task 1: Reproduce queue-page lag in a focused renderer test

**Files:**
- Modify: `desktop/test/question-review.test.js`
- Modify: `desktop/test/profile-tabs-render.test.js`

- [ ] **Step 1: Assert successful drawer save publishes completion and advances count immediately; failed/empty saves do not.**
- [ ] **Step 2: Run only the changed test files and confirm the new assertion fails for missing immediate bridge.**

### Task 2: Bridge saved completion to Application Answers

**Files:**
- Modify: `desktop/renderer/pages/question-review.js`
- Modify: `desktop/renderer/pages/application-answers.js`
- Modify: `desktop/renderer/style.css`
- Modify: `desktop/test/question-review.test.js`
- Modify: `desktop/test/profile-tabs-render.test.js`

- [ ] **Step 1: After a successful usable answer, dispatch question identity/value/home metadata and keep the drawer's existing local queue progression.**
- [ ] **Step 2: Capture the matching visible row in Application Answers, decrement its Needs review count immediately, render Set, then fade/remove after roughly 1.5 seconds.**
- [ ] **Step 3: Guard timer replacement/removal by record identity; keep state across filter changes and queue refresh, and never create it for failures or empty answers.**
- [ ] **Step 4: Add reduced-motion CSS so the row exits without a transition under `prefers-reduced-motion`.**
- [ ] **Step 5: Run focused tests and inspect fictional before/after screenshots.**

### Task 3: Verify and ship

**Files:** changed files above and spec progress.

- [ ] **Step 1: Run changed-JS lint, adjacent save/filter/modal tests and the repository fast gate in this worktree.**
- [ ] **Step 2: Update spec evidence, prepare PR body/assets, register exact ship log and open PR using `tools/ship.sh`.**
- [ ] **Step 3: Monitor current-head checks/comments and hand off for owner merge; never merge.**
