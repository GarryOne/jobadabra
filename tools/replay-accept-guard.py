#!/usr/bin/env python3
"""PreToolUse guard (owner, 14 Oct 2026): a session never accepts a replay drop itself. Every session posts to GitHub as the owner, so its `Replay-accept:` comment would
count as the owner's (replay-accepts.mjs trusts OWNER). It blocks a gh command that posts text with `Replay-accept:` (gh pr comment / gh issue comment / gh pr review /
gh api, the text inline, in a heredoc or in a --body-file / -F file) unless the command carries REPLAY_ACCEPT_OK=1, which a session sets ONLY when the owner asked for that
accept in its own chat (like FG_OK=1). Reads of it (grep, git commit -m) pass. Registered in .claude/settings.json; cases: bash tools/replay-accept-guard.cases.sh"""
import json, os, re, shlex, sys

POSTS = re.compile(r'\bgh\s+(?:pr\s+(?:comment|review|edit)|issue\s+(?:comment|edit)|api)\b')
TEXT = re.compile(r'Replay-accept:', re.I)

def files_named(cmd, cwd):
    """The text of files the command hands to gh as a body (--body-file x, -F x, -F body=@x, -f body=@x)."""
    try: words = shlex.split(cmd, posix=True)
    except ValueError: words = cmd.split()
    paths = []
    for i, word in enumerate(words):
        if word in ('--body-file', '-F', '-f', '--input') and i + 1 < len(words): paths.append(words[i + 1])
        elif word.startswith('--body-file='): paths.append(word.split('=', 1)[1])
    out = ''
    for path in paths:
        path = path.split('=@', 1)[1] if '=@' in path else path.lstrip('@')
        try: out += open(os.path.join(cwd or '.', os.path.expanduser(path)), errors='replace').read()
        except OSError: pass
    return out

def main():
    try: data = json.load(sys.stdin)
    except Exception: return
    if data.get('tool_name') != 'Bash': return
    cmd = (data.get('tool_input') or {}).get('command') or ''
    if 'REPLAY_ACCEPT_OK=1' in cmd or not POSTS.search(cmd): return
    if TEXT.search(cmd) or TEXT.search(files_named(cmd, data.get('cwd') or '')):
        print("Blocked by tools/replay-accept-guard.py: a `Replay-accept:` comment accepts a replay drop AS THE OWNER (every session posts through the owner's GitHub account). "
              "Never accept your own drop: show the owner the gate's field-by-field diff (the replay gate's job log) and wait. Only when the owner asked for exactly this "
              "accept in this chat: put REPLAY_ACCEPT_OK=1 in the command. See docs/rules/apply-flow-workflow.md.", file=sys.stderr)
        sys.exit(2)

main()
