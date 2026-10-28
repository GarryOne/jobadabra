"""Lays out a PR summary for GitHub (owner, 15 Oct 2026: "use headings, font sizes, proper spacing; a run number is a link, not plain text").
Reads the session's summary (tools/pr-body-template.md shape) on stdin, prints it with: the verdict as a big heading, Why / Unblocks / Root cause each in its own coloured callout,
a small heading over each block (impact, what changed, before/after, screens), a quiet "No screenshots" line, and every "run <id>" linked
to its Actions run. Lines the CI reads (live-row: ...) and anything already under a heading stay as written. Guard: tests/test_pr_body.py.
Usage: python3 tools/pr-body-format.py <owner/repo or ''> < summary.md"""
import re
import sys

RUN = re.compile(r'(?<![\[/\w])run (\d{8,})\b(?![\]\w])')
HEADINGS = [   # (what starts the block, its heading)
    (re.compile(r'^\|\s*Area\s*\|\s*Impact\b', re.I), '### 📊 Impact'),
    (re.compile(r'^\|\s*What changed\s*\|\s*Before\s*\|\s*After\b', re.I), '### 🖼️ Screens'),   # the screens table (tools/pr-screens.py), before the numbers table
    (re.compile(r'^\|(?!\s*What changed\s*\|)[^|]*\|[^|]*\bBefore\s*\|[^|]*\bAfter\b', re.I), '### 🔍 Before → After'),   # also after style_before_after's emoji headers
    (re.compile(r'^\*\*Design checks\*\*'), '### 🎨 Design checks'),   # the desktop window's 6 checks (tools/pr-body.sh); its bold title becomes the heading
    (re.compile(r'^\*\*Plan progress\*\*'), '### 🗺️ Plan progress'),   # a PR titled "[xx] n/N ..." (tools/pr-body-check.py plan_gap)
    (re.compile(r'^- '), '### ✅ What changed'),
    (re.compile(r'^(\*\*Before\*\*|!\[|<img |\|\s*!\[)', re.I), '### 🖼️ Screens'),
]
NOTE = re.compile(r'^\*\*(Why|Unblocks|Root cause):?\*\*:?', re.I)
# Why (owner, 28 Oct 2026: "Why, What it Unblockes and Root cause, should be 3 panels with 3 differnt colors"): GitHub alert kinds.
PANEL = {'why': 'NOTE', 'unblocks': 'TIP', 'root cause': 'CAUTION'}   # blue, green, red


def panels(note):
    """One GitHub alert per Why / Unblocks / Root cause line, each in its own colour, a blank line between them."""
    out = []
    for line in note:
        out += ['', f'> [!{PANEL[NOTE.match(line).group(1).lower()]}]', '> ' + line]
    return out


def link_runs(line, repo):
    return RUN.sub(lambda m: f'[run {m.group(1)}](https://github.com/{repo}/actions/runs/{m.group(1)})', line) if repo else line


BEFORE_AFTER = re.compile(r'^\|(?!\s*What changed\s*\|)([^|]*)\|\s*Before\s*\|\s*After\s*\|\s*$', re.I)   # not the screens table: its cells are images


def cells(line):
    return [cell.strip() for cell in line.strip().strip('|').split('|')]


def style_before_after(lines):
    """The Before/After table (owner, 15 Oct 2026: "make it more beautiful"): coloured headers, centred values, the label and a changed After in bold,
    an unchanged After marked as such. Only a plain 3-column table is restyled; anything else is left as written."""
    out, at = [], 0
    while at < len(lines):
        line = lines[at]
        if BEFORE_AFTER.match(line) and at + 1 < len(lines) and re.match(r'^\|[\s:|-]+\|$', lines[at + 1].strip()):
            label = cells(line)[0] or 'What'
            out += [f'| 📏 {label} | 🔴 Before | 🟢 After |', '|:---|:---:|:---:|']
            at += 2
            while at < len(lines) and lines[at].startswith('|'):
                row = cells(lines[at])
                if len(row) != 3:
                    out.append(lines[at])
                else:
                    name, before, after = row
                    name = name if not name or name.startswith('**') else f'**{name}**'
                    after = f'↔ {after} <sub>(unchanged)</sub>' if after == before else (after if after.startswith('**') or not after else f'**{after}**')
                    out.append(f'| {name} | {before} | {after} |')
                at += 1
            continue
        out.append(line)
        at += 1
    return out


def lay_out(text, repo=''):
    lines = style_before_after(text.rstrip('\n').split('\n'))
    if any(line.startswith('### ') or line.startswith('## ') for line in lines[1:]):
        return '\n'.join(link_runs(line, repo) for line in lines) + '\n'   # the author laid it out already: links only
    out, used, note, first = [], set(), [], True
    for line in lines:
        line = link_runs(line, repo)
        if first and line.strip():
            first = False
            out.append(line if line.startswith('#') else '## ' + line)
            continue
        if NOTE.match(line):
            note.append(line)
            continue
        if note and not line.strip():
            continue
        if note:   # the Why/Unblocks/Root cause lines end: one callout each
            out += panels(note) + ['']
            note = []
        if line.startswith('No screenshots:') or line.startswith('No visual:'):
            out.append('<sub>📷 ' + line + '</sub>')
            continue
        for start, heading in HEADINGS:
            if heading not in used and start.match(line) and (not out or not out[-1].startswith('|') and not out[-1].startswith('- ')):
                used.add(heading)
                if out and out[-1].strip():
                    out.append('')
                out += ['---', '', heading, '']   # a rule between sections (owner, 15 Oct 2026); the blank line above keeps it a rule, never a setext heading
                break
        if line.startswith('**Design checks**') or line.startswith('**Plan progress**'):
            continue
        out.append(line)
    if note:
        out += panels(note)
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).strip('\n') + '\n'


if __name__ == '__main__':
    sys.stdout.write(lay_out(sys.stdin.read(), sys.argv[1] if len(sys.argv) > 1 else ''))
