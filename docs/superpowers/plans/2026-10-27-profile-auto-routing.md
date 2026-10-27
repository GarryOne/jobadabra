# Automatic Profile Routing Implementation Plan

**Goal:** Organize saved lines without asking the applicant to select a technical home.
**Architecture:** Extend the existing profile-move judge with a supplied destination catalogue and source context. An organizer validates the result and performs verified, preserving store moves; the existing question-read path runs it for legacy unplaced items. Keep cached legacy answer handling, retire home-picker production/display.
**Tech Stack:** JavaScript ES modules, openStore SQLite/Notion, Node 22, fictional fake AI/Notion, tiny DOM and demo renders.
**Spec:** ../specs/2026-10-27-profile-auto-routing.md

## Constraints
No paid AI, live account/app/form automation, applicant data in repo/logs/images, new keyword meaning rules, stacked PRs or frozen harness/tooling edits. Preserve d5 extras/setup rows. New exported functions document invariants. Existing Why decisions remain unless deliberately updated.

## Tasks
1. Add a public-flow regression file: seeded legacy metadata + real source pages, fixed fictional AI destinations, real organizer through openShown/judgeNew, both adapters. Include writing rules in another language, repeated copies, same label/different values, unavailable/invalid AI, write/read-back failure, stale source and restarted queue. Watch it fail.
2. Add a pure shared writing-preferences heading model and destination catalogue. Extend judge's optional routing contract; retain ordinary callers. Implement a single-flight organizer using exact contextual source identities, backup, destination read-back and source revalidation.
3. Invoke organizer in judgeNew; retire technical where items from pending and cached renderer queues, retaining legacy key compatibility. Update the tests that intentionally assert manual-home behavior; preserve genuine personal-answer reviews.
4. Run focused tests/lint, render fictional before/after using existing components, request one independent owner-scenario review. Commit and ship a new main-based PR. Monitor current-head checks/comments, report exact evidence.
