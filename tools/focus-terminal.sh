#!/usr/bin/env bash
# focus-terminal.sh </dev/ttysNNN> — bring the Terminal window whose tab owns that tty to the front
# and select the tab. Run when a Jobadabra notification is clicked (see notify.sh).
tty="${1:?usage: $0 /dev/ttysNNN}"
osascript - "$tty" <<'OSA'
on run argv
  set wanted to item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is wanted then
          set selected of t to true
          set index of w to 1
        end if
      end repeat
    end repeat
    activate
  end tell
end run
OSA
