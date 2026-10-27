# AI hallucinations: check the PR against the repo, not against its own word

Why (owner, 27 Oct 2026): "From AI Slop, from AI hallucinations." Each item is a blocking finding (no approval) with file:line. Open the repo (and the installed dependency) and check; never accept the PR's description as the proof.

- **A thing that does not exist:** a call, import, function, class, method, option or CLI flag missing from this repo or from the installed version (gh, npm, playwright, chrome.* APIs, python stdlib).
- **A reference that does not resolve:** a path, file, script, npm script, workflow, job or step name, env var, secret, ruleset or setting that is absent or spelled differently; list the real ones before saying one is missing.
- **A key with one side:** a config key or flag written but read nowhere, or read but set nowhere.
- **Words that describe other code:** a comment, docstring, doc or skill line that states behaviour the code does not have.
- **A claim with nothing behind it:** a PR body or commit message citing a number, "tested", "fails on main", a run id, a PR number or a sha that no run, test or file shows; check the cited ids and shas exist.
- **A test against a fake:** it mocks an interface the real code does not have, so it passes against the mock.
- **A package, version, URL or doc link** that does not exist.
