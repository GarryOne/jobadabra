# Apply flow

One Chrome tab. The extension fills a form that is already on the page. Claude-in-Chrome only walks to that form and finishes what the extension left. The owner clicks Submit.

Shipped in `6cdb387` (extension 0.8.35). A new session picks this up after the desktop app is quit and reopened.

## Start

1. (Off for now, owner 15 Oct 2026) **Apply with Claude** starts a Claude session. The app opens no tab: claude-in-chrome acts only on tabs in its own group and cannot see one the app opened (a second tab appeared beside it on 1 Oct 2026). Claude opens the one tab itself, `tabs_context_mcp` with `createIfEmpty`, then navigates to the job link with `#jobadabra-fill`.
2. The extension joins that tab. 1.5 seconds after load it counts visible controls and writes `data-jobadabra-fill` on `<html>`:
   - **form** — 3 or more fields, a textarea, or a file input. It fills.
   - **no-form** — a job page, a search box, or an Apply button. It does not type.
   - **account** — any password field. Sign-in and sign-up. It does not type.
3. Claude reads the state every 3 seconds, up to 90 seconds, in its own tab.
4. Each new address is classified again. A tab opened by that tab is the same session.
5. The owner does CAPTCHA, legal-consent boxes, and Submit.

| State | Claude does |
|---|---|
| `running` | Wait |
| `done` | Fill only the leftover list, then press Next if the form has another page |
| `no-form` | Press Apply or Next in this same tab |
| `account` | Sign in or create the account. Password from `python3 -m src.ai.passwords`, pasted from the clipboard. Confirmation email through Gmail |
| `error`, or no extension hook after 10 seconds | Fill this page itself |

## Who does what

| Situation | Who |
|---|---|
| The form is already on the link (Greenhouse, Lever, Ashby) | Extension. Kit, contact, and CV first. One Claude call only for questions nothing else covers. No call when the kit covers the form. Dropdowns that need a real click are clicked by the extension |
| Job board or careers page, then a redirect in the same tab | Claude clicks Apply or Next. The extension fills the page when a form appears |
| Apply opens a new tab from the armed tab | Extension follows it and uses the same rules |
| Sign-in or create-account | Claude. The extension never types a password |
| A site the extension may not run on | Claude continues alone after 10 seconds. **Work on every job site** lets the extension in |
| A page opened by hand | Ignored, until **Use on this tab**. That button uses the same three-way decision |

## Speed

A form already on the page is the fast path: known fields in about 10 seconds when the extension is on the tab. The 1.5 second pause after load is the same wait the fill already had.

Claude stays out of those fields. It is still one action at a time for the walk, an account, a confirmation email, a CAPTCHA handoff, and a widget the extension cannot drive. A full Claude retype of a form already on the page (about 4 minutes, on a tab with no fill mark) is the path this design replaces. Not re-timed on a live signup journey after `6cdb387`.

## Still open

- A form that appears without the address changing is classified once. A slow page, or a step that swaps the form in place, stays `no-form`.
- The count looks at the top document only. A careers page that only embeds the form can be called `no-form`. An embed opened as the tab's own address is a form.
- A new tab with no opener (`rel="noopener"`) is not followed. Claude can use it; the extension is not on it unless **Use on this tab** is pressed.
- A real step with one or two fields looks like `no-form`. Claude types it.
- A signup page with a password is entirely `account`, including name, email, and CV on that page.
- A filter page with three or more inputs can be treated as the application form.
- Another browser, or another Chrome profile, is invisible to Claude.

Code: `desktop/lib/apply.js` opens the tab, `extension/tab-pages.js` (`pageRole`) classifies it, `extension/background.js` (`consider`, `followOpener`) fills or follows, `desktop/lib/claude-session.js` is the prompt Claude follows.
