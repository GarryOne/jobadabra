# Jobadabra — privacy policy

Jobadabra is a personal job-search tool. This Google Cloud app ("Jobadabra") is used by its owner to
connect their own Google account to their own copy of Jobadabra. It is not offered to anyone else.

## What it accesses

With the owner's consent, read-only:

- **Gmail** (`gmail.readonly`): recent emails from job-application systems, recruiter platforms and
  scheduling tools, and emails that name a company the owner applied to.
- **Google Calendar** (`calendar.readonly`): upcoming events, to recognise job interviews.

It never sends, changes or deletes email or calendar events.

## How the data is used

- Matching emails are classified (for example "application received", "interview scheduled",
  "rejected") by the Anthropic API, and matching calendar events are linked to the owner's applications.
- The results (the kind of email, a short summary, its subject and date; interview times) are stored in
  the owner's own private Notion workspace and sent to the owner's own Telegram chat.
- The access token is kept in the owner's macOS Keychain and in their private GitHub repository's
  encrypted secrets.

No data is sold, shared with third parties for advertising, or used for anything other than the
owner's own job search. Google user data is used in line with the Google API Services User Data Policy,
including its Limited Use requirements.

## Removing access

Access can be revoked at any time at <https://myaccount.google.com/permissions>.
