# The website and /admin live in a private repo

Owner, 19 Oct 2026: "leave open-source rather less than more … make it hard for someone to copy our product from the source code". Moved 20 Oct 2026 (private spec jobadabra-lab:docs/specs/2026-10-19-site-private-repo.md).

**Visibility (owner, 24 Oct 2026):** `GarryOne/jobadabra-web` is public until 1 Nov 2026, then private again; nothing secret in it meanwhile.

## What is where
- **Private, `GarryOne/jobadabra-web`** (clone: `~/jobadabra-web`): its folders sit at the top level by audience (21 Oct 2026): `web/` (public pages), `admin/`, `api/`, `shared/`, `workers/www` (the ONE Worker serving them; also `workers/hosted-runner`, `workers/ready-runner`), `db/migrations/`, `test/`, `media/`, `preview/`, and `jobs/` (the scheduled jobs that feed /admin: ops overview, changelog, daily digest, e2e-intel, hosted e2e, the Lab Job Search uploads) with their workflows. There is no `site/` folder.
- **Public, here**: the desktop app, extension, engine (`src/`), the Telegram bot Worker (`worker/`), the hosted image (`hosted/`), the tests of all of those, and **`docs/site-routes.json`**: the list of every route the app, extension and engine call, with a kind. The public tests `desktop/test/site-routes.test.js` (code calls only listed routes) and the site's `test/site-routes.test.js` (the Worker answers each) pair on it.
- **The rule: private may read public, public never reads private.** The private repo works inside a tree of this repo with its own files laid over it (`tools/overlay.sh`, `tools/tree.sh` there).

## Landing order: the site (private) half lands first (owner, 21 Oct 2026)
Owner: "Stop the cross-repo reds: for a change that touches both repos, the site lands first, and its tests check 'the site has everything public lists' instead of an exact match." 75 reds in two days (20-21 Oct) came from pairs waiting on each other, not from bugs.
- **For a change on both sides: the private PR lands first** (the site accepts the new route, feed type, tag, step or reason word), **then the public PR** (it lists and starts using it). Open both at once; merge in that order.
- **The check is one way:** the site may know MORE than public lists (green); public may never list or send what the site (on its main) lacks (red, a real break for users). Helpers: `tests/site_private.py` `assert_site_accepts`, `desktop/test/site-private.js` `assertSiteAccepts` (tests prove both directions); in the site: `SITE_ROUTES_STRICT=1` (its daily run) fails a Worker route public never listed.
- **Why the old order was public first:** the site CLAUDE.md (20 Oct 2026) said "first add the route to docs/site-routes.json here, then the Worker", because `desktop/test/site-routes.test.js` fails for a route in shipped code that is not listed, and the site tests compared lists exactly, so either order was red for one side. Now only the real break is red.
- Left exact on purpose: `tests/test_pool_contract.py` (the site's fixture of what the engine sends today: the engine changes first, so the fixture follows in the site PR after) and the ladder-move `SHAPE` regex.
- **A new key in `/api/index` is the exception** (jobadabra-web#131 red, 26 Oct 2026): `tests/test_employer_index_cache_keeps_served_keys.py` (run in the site's CI) fails on a served key the app's cache does not keep. Split it: the site PR stores and computes it without serving it (lands first), the public PR keeps it in the cache and adds it to that test's `FULL_ANSWER`, then a one-line site PR serves it.

## What it means for your change
- **A new route the app calls**: the Worker route in the private repo first (it lands as "site ahead": told, not failed), then here: list it in `docs/site-routes.json` and call it (the public test fails until it is listed; the private test fails until the Worker answers it).
- **Test file names are split by repo** (`docs/site-test-names.json`; 3 clashes 24-26 Oct 2026, web main red only after both sides merged): the site's tests in a shared folder start with its prefix (`tests/test_site_*`, `desktop/test/media-*` or `web-*`, all of `test/`), public's never do (`tests/test_names_kept_for_the_site.py`; the site's `tools/site-guards.sh` checks its side).
- **A test that reads a `site/` file** uses `tests/site_private.py` (`@needs_site`) or `desktop/test/site-private.js` (`siteTest`): it is skipped here and runs in the private repo's CI (daily against the newest public main too).
- **Shared tables** the public pool and eval tools need live here: `desktop/e2e/lib/platform.mjs`, `applying-status.mjs`, `desktop/lib/free-ai-models.js`, `free-ai-translate.js`, `desktop/test/fixtures/host-cases.json`. The site re-exports them.
- **Reading the admin tools** from here (needs-fix-causes and friends): `~/jobadabra-web/tools/site-run.sh node jobs/needs-fix-causes.mjs`.
- **The product media** (the site's screenshots and videos, owner 20 Oct 2026: marketing stays private): recorded there (`media`, `product-media.yml`) from this repo's app in demo mode; here only the app's hook `JOB_PILOTTO_DEMO_DIR` (`desktop/lib/demo.js`). A change to `desktop/renderer`, `desktop/demo` or `extension` re-records it there the next day.
- **Editing the site**: in `~/jobadabra-web` (its own worktrees and PRs). A public PR cannot start a workflow there; `public-watch.yml` there looks every 6 hours and starts a deploy when a public file the site bundles changed.
- Everything pushed before 20 Oct 2026 stays in this repo's history and in forks.
