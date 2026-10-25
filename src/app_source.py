"""The Source / event source value for what the Desktop App logs itself: 'Jobadabra app', and the older 'Job Pilotto app' still in people's rows."""

APP_SOURCE = 'Jobadabra app'
LEGACY_APP_SOURCE = 'Job Pilotto app'   # written before the rename, in the user's own Notion table or SQLite; never rewritten
APP_SOURCES = (APP_SOURCE, LEGACY_APP_SOURCE)


def is_app_source(value):
    """True for either name: every reader of 'logged by the app' goes through here."""
    return (value or '').strip() in APP_SOURCES
