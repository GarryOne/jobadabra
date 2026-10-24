"""The user's own time zone: JOB_PILOTTO_TZ (the desktop app sets it from the computer), else the machine's, else UTC.
Never a fixed city: dates, "today" and interview times are the user's, wherever they live."""
import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


def zone_name():
    name = os.getenv('JOB_PILOTTO_TZ') or os.getenv('TZ', '').lstrip(':')
    if not name:
        try:
            target = os.path.realpath('/etc/localtime')
            name = target.split('zoneinfo/', 1)[1] if 'zoneinfo/' in target else ''
        except OSError:
            name = ''
    if not name and Path('/etc/timezone').is_file():
        name = Path('/etc/timezone').read_text().strip()
    try:
        ZoneInfo(name)
        return name
    except Exception:
        return 'UTC'


def local_zone():
    try:
        return ZoneInfo(zone_name())
    except Exception:  # noqa: BLE001 — no time-zone database at all (Windows without the tzdata package: not even "UTC" loads): the computer's own offset
        return datetime.now().astimezone().tzinfo


def local_iso(value, zone=''):
    """A time a message states ("2026-10-27T10:00:00", the clock as written) plus the IANA zone it is in, as ISO 8601 with the
    offset of THAT date: 10:00 Zurich is +02:00 in summer, +01:00 after the clock change. A reader's fixed offset is never
    trusted when it names the zone; no zone means the owner's; an offset without a zone is kept; unreadable text comes back as is."""
    if not value:
        return ''
    try:
        moment = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return value
    try:
        zone_info = ZoneInfo(zone) if zone else None
    except Exception:  # noqa: BLE001 — an unknown zone name: the owner's own
        zone_info = None
    if zone_info is None:
        if moment.tzinfo:
            return moment.isoformat()
        zone_info = local_zone()
    return moment.replace(tzinfo=None).replace(tzinfo=zone_info).isoformat()
