# Security policy

> **Found a security problem? Report it privately:** this repository's **Security** tab → **Report a vulnerability**.
> Please don't open a public issue for it.

## What to report

- A way to read someone's data: keys, Notion content, CV, emails, form answers.
- A way around the app's protections: the local server's pairing and token, the extension's origin check, the scrubbing
  of technical reports, the rule that Jobadabra never clicks Submit.
- Anything secret shipped in the app or the repository, or a hole in the website's endpoints (`/report/*`, Notion sign-in).

## What happens next

| When | What |
|---|---|
| within 3 days | We confirm we received it |
| within 14 days | We share what we found and the plan to fix it |
| when fixed | A new stable release; you're credited if you want to be |

## Supported versions

Only the latest **stable release** gets security fixes; the app updates itself ("Update to …" in its menu).

## How Jobadabra protects data

Keys are encrypted on the user's computer and sent only to their own service. User data lives in the user's own
Notion. Technical reports are scrubbed on the computer before they're sent, and can be turned off
(Settings → Advanced). More: the website's privacy page.
