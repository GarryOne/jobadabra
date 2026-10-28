# Clean code: blocking findings

Why (owner, 28 Oct 2026): "I just want that our code is very clean so that AI hallucinations are less prone to introduce bugs", with rules like "don't repeat yourself", modular, reusable, existing patterns. Each item is a blocking finding (no approval) with file:line. It adds to ai-slop.md (a second copy of a mechanism, dead code, file size); it does not repeat it.

- **Reuse before new code:** a new function, constant or type that an existing one already covers; name it with file:line (`node desktop/scripts/codemap.mjs <words>` finds it). Extend the existing one instead.
- **A copied block:** 5+ lines that match a block elsewhere in the repo (name the other file:line); pull both into one helper. A deliberate mirror file names its sync step.
- **More than one source of truth:** the same value, list, threshold or state written in two places (a second constant, a re-typed string, a state kept in two variables); name the owner and make the other read it.
- **A new pattern beside an existing one:** a second way to fetch, store, log, validate, render a card or open a dialog where the repo already has one; use the existing pattern, or say in the PR why it cannot serve.
- **A function that does too much:** a new or edited function that mixes fetching, deciding and rendering, nests 4+ levels, or branches on its own flags; split it by concern into named functions.
- **A repeated literal:** the same string or number 3+ times in new code; one named constant.
