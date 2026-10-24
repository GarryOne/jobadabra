"""tools/pr-body.sh, the description of a PR that tools/ship.sh opens (owner, 12 Oct 2026: "I have 2-5 seconds to look at it; not an essay").
The session's short summary (--body=<file>) comes first, then a table of the facts, and the commit message only folded in a <details>."""
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent


def git(cwd, *args):
    return subprocess.run(['git', '-C', str(cwd), *args], check=True, capture_output=True, text=True).stdout.strip()


class PrBodyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        self.repo = self.tmp / 'repo'
        self.repo.mkdir()
        git(self.repo, 'init', '-q', '-b', 'main')
        git(self.repo, 'config', 'user.email', 't@x'); git(self.repo, 'config', 'user.name', 'T')
        (self.repo / 'a.txt').write_text('a\n'); git(self.repo, 'add', '.'); git(self.repo, 'commit', '-qm', 'Start')
        self.base = git(self.repo, 'rev-parse', 'HEAD')
        message = ('A control the page did not take is marked\n\nA long paragraph that explains the change in full detail, '
                   'line after line, as a commit message should.\n\nPool-row: Ocado Technology (found 2026-10-10)\nRung: 2\nFixture: fv-en-city-reverted\n'
                   'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n')
        (self.repo / 'b.txt').write_text('b\n'); git(self.repo, 'add', '.'); git(self.repo, 'commit', '-qm', message)

    def body(self, *args):
        result = subprocess.run(['bash', str(ROOT / 'tools' / 'pr-body.sh'), self.base, *args], cwd=self.repo, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_the_summary_comes_first_and_the_commit_message_is_folded(self):
        summary = self.tmp / 'summary.md'
        summary.write_text('### ✅ Ocado: menus picked by meaning\n\n- **Why:** the 11 Oct pool run left 3 menus empty\n- **Impact:** 3 more required menus filled on Ocado-like forms\n\n**Unblocks:** the next PR\n\n| Area | Impact | How |\n|---|---|---|\n| Real users | ⚪ Low | x |\n| Form filling | — None | x |\n| Admin data accuracy | — None | x |\n| Offline replays | — None | x |\n| Tests & harness | 🟢 High | x |\n| Development speed | ⚪ Low | x |\n| Cost | — None | x |\n\nNo visual: a one-line fix\n\n| | Before | After |\n|---|---|---|\n| filled | 8 | 11 |\n')
        text = self.body(f'--body={summary}')
        self.assertTrue(text.startswith('### ✅ Ocado: menus picked by meaning'), text[:200])
        details = text.index('<details>')
        self.assertLess(text.index('**Why:** the 11 Oct pool run left 3 menus empty'), details)
        self.assertGreater(text.index('A long paragraph'), details, 'the essay is folded, never above the fold')
        self.assertIn('</details>', text)
        self.assertTrue(text.rstrip().endswith('🤖 Generated with [Claude Code](https://claude.com/claude-code)'))

    def test_the_facts_are_a_short_table_from_the_trailers(self):
        text = self.body()
        head = text[:text.index('<details>')]
        self.assertIn('| 🎯 Pool row | Ocado Technology (found 2026-10-10) |', head)
        self.assertIn('| 🪜 Rung | 2 |', head)
        self.assertIn('| 🧪 Fixture | fv-en-city-reverted |', head)
        self.assertNotIn('Co-Authored-By', head)

    def test_without_a_summary_the_subject_leads_and_nothing_long_is_above_the_fold(self):
        text = self.body()
        self.assertTrue(text.startswith('### A control the page did not take is marked'), text[:120])
        head = text[:text.index('<details>')]
        self.assertTrue(all(len(line) <= 160 for line in head.splitlines()), head)

    def test_a_pr_body_line_the_ci_reads_stays_in_the_body(self):
        summary = self.tmp / 'summary.md'
        summary.write_text('### 🔧 Fix\n\n- **Why:** the owner saw it\n- **Impact:** unblocks the live row\n\n**Unblocks:** the next PR\n\n| Area | Impact | How |\n|---|---|---|\n| Real users | ⚪ Low | x |\n| Form filling | — None | x |\n| Admin data accuracy | — None | x |\n| Offline replays | — None | x |\n| Tests & harness | 🟢 High | x |\n| Development speed | ⚪ Low | x |\n| Cost | — None | x |\n\nNo visual: a one-line fix\n\n| | Before | After |\n|---|---|---|\n| a | 1 | 2 |\n\nlive-row: Personio form in German\nlive-applicant: thin\n')
        text = self.body(f'--body={summary}')
        self.assertIn('\nlive-row: Personio form in German\n', text)
        self.assertIn('\nlive-applicant: thin\n', text)


    def test_a_summary_without_a_why_or_a_before_after_is_refused(self):
        # Owner, 13 Oct 2026: "Explaining why a change is needed: how we decided that we need this. And a before/after."
        for text, missing in [('### ✅ X\n\n| | Before | After |\n|---|---|---|\n| a | 1 | 2 |\n', 'Why'),
                              ('### ✅ X\n\n- **Why:** the owner saw it\n', 'Before'),
                              ('### ✅ X\n- did a thing\n', 'Why')]:
            summary = self.tmp / 'bad.md'; summary.write_text(text)
            result = subprocess.run(['bash', str(ROOT / 'tools' / 'pr-body.sh'), self.base, f'--body={summary}'], cwd=self.repo, capture_output=True, text=True, timeout=30)
            self.assertNotEqual(result.returncode, 0, text)
            self.assertIn(missing, result.stderr)


    def test_a_pr_that_changes_a_screen_is_refused_without_images(self):
        # Owner, 28 Sep / 13 Oct 2026: a UI PR opens WITH before/after images; #774 (14 Oct) opened without them. The class: every screen folder.
        ok = '### ✅ X\n\n- **Why:** the owner saw it\n- **Impact:** the page reads right\n\n**Unblocks:** the next PR\n\n| Area | Impact | How |\n|---|---|---|\n| Real users | ⚪ Low | x |\n| Form filling | — None | x |\n| Admin data accuracy | — None | x |\n| Offline replays | — None | x |\n| Tests & harness | 🟢 High | x |\n| Development speed | ⚪ Low | x |\n| Cost | — None | x |\n\n| | Before | After |\n|---|---|---|\n| a | 1 | 2 |\n'
        summary = self.tmp / 'summary.md'
        def run(text):
            summary.write_text(text)
            return subprocess.run(['bash', str(ROOT / 'tools' / 'pr-body.sh'), self.base, f'--body={summary}'], cwd=self.repo, capture_output=True, text=True, timeout=30)
        for screen in ('desktop/renderer/pages/jobs.js', 'admin/applying.js', 'web/public/index.html', 'extension/popup.css', 'desktop/renderer/styles.css'):
            git(self.repo, 'reset', '-q', '--hard', self.base)
            (self.repo / screen).parent.mkdir(parents=True, exist_ok=True); (self.repo / screen).write_text('x\n')
            git(self.repo, 'add', '.'); git(self.repo, 'commit', '-qm', 'Change a screen')
            result = run(ok)
            self.assertEqual(result.returncode, 2, screen); self.assertIn('no before/after image', result.stderr)
            images = '\n| What changed | Before | After |\n|---|---|---|\n| The card shows the start date | ![before](https://x/b.png) | ![after](https://x/a.png) |\n'
            if screen.startswith('desktop/renderer/'):
                # The desktop window also carries the 6 design checks, ticked (owner, 17 Oct 2026: the design system).
                result = run(ok + images)
                self.assertEqual(result.returncode, 2, screen); self.assertIn('0 of the 6 design checks', result.stderr)
                self.assertEqual(run(ok + images + '\n**Design checks**\n' + '- [x] a\n' * 5 + '- [ ] b\n').returncode, 2, 'five ticked of six is refused')
                images += '\n**Design checks**\n' + '- [x] checked\n' * 6
            self.assertEqual(run(ok + images).returncode, 0, screen)
            refused = run(ok + 'No screenshots: an API route, nothing drawn changed\n')
            if screen.startswith(('web/public/', 'admin/')):
                # A site page is always visible: "No screenshots" is not an answer for it (owner, 24 Oct 2026, jobadabra-web #74/#75).
                self.assertEqual(refused.returncode, 2, screen); self.assertIn('is not allowed', refused.stderr)
            else:
                self.assertEqual(refused.returncode, 0, screen)
        git(self.repo, 'reset', '-q', '--hard', self.base)
        (self.repo / 'test').mkdir(parents=True, exist_ok=True); (self.repo / 'test' / 'a.test.js').write_text('x\n')
        git(self.repo, 'add', '.'); git(self.repo, 'commit', '-qm', 'Change a test')
        self.assertEqual(run(ok + 'No visual: a test only\n').returncode, 0, 'a change to no screen needs no image')

    def test_more_than_five_before_after_pairs_are_refused(self):
        # Owner, 17 Oct 2026: "max 5 pairs". Ten images pass, eleven are refused, and the message names the rule.
        head = '### ✅ X\n\n- **Why:** the owner saw it\n- **Impact:** the page reads right\n\n**Unblocks:** the next PR\n\n| Area | Impact | How |\n|---|---|---|\n| Real users | ⚪ Low | x |\n| Form filling | — None | x |\n| Admin data accuracy | — None | x |\n| Offline replays | — None | x |\n| Tests & harness | 🟢 High | x |\n| Development speed | ⚪ Low | x |\n| Cost | — None | x |\n\n| | Before | After |\n|---|---|---|\n| a | 1 | 2 |\n\n'
        summary = self.tmp / 'many.md'
        def run(count):
            summary.write_text(head + '| What changed | Before | After |\n|---|---|---|\n' + ''.join(f'| Row {n} shows the new label | ![b{n}](https://x/b{n}.png) | ![a{n}](https://x/a{n}.png) |\n' for n in range(count // 2)))
            return subprocess.run(['bash', str(ROOT / 'tools' / 'pr-body.sh'), self.base, f'--body={summary}'], cwd=self.repo, capture_output=True, text=True, timeout=30)
        self.assertEqual(run(10).returncode, 0)
        result = run(12)
        self.assertEqual(result.returncode, 2)
        self.assertIn('at most 5 before/after pairs', result.stderr)

    def test_the_summary_needs_an_emoji_verdict_an_unblocks_line_and_a_rated_row_per_area(self):
        # Owner, 15 Oct 2026: "drop the chart; more visual presence (colours, emoticons); the impact, how it helps, what it unblocks, on what category".
        areas = {'Real users': '🟢 High', 'Form filling': '🟡 Medium', 'Admin data accuracy': '⚪ Low', 'Offline replays': '— None',
                 'Tests & harness': '— None', 'Development speed': '⚪ Low', 'Cost': '— None'}
        summary = self.tmp / 'i.md'
        def body(first='🟢 X', unblocks=True, skip=None, plain_level=False):
            rows = ''.join(f'| {a} | {(l.split()[-1] if plain_level else l)} | x |\n' for a, l in areas.items() if a != skip)
            return (f'{first}\n\n**Why:** the owner saw it\n' + ('**Unblocks:** #824\n' if unblocks else '') +
                    '\n| | Before | After |\n|---|---|---|\n| a | 1 | 2 |\n\n| Area | Impact | How |\n|---|---|---|\n' + rows)
        def run(text):
            summary.write_text(text)
            return subprocess.run(['bash', str(ROOT / 'tools' / 'pr-body.sh'), self.base, f'--body={summary}'], cwd=self.repo, capture_output=True, text=True, timeout=30)
        self.assertEqual(run(body()).returncode, 0, run(body()).stderr)
        self.assertEqual(run(body(first='### 🔧 X')).returncode, 0)
        for text, word in [(body(first='Plain verdict'), 'emoji'), (body(unblocks=False), 'Unblocks'), (body(plain_level=True), 'rated')]:
            result = run(text); self.assertEqual(result.returncode, 2, word); self.assertIn(word, result.stderr)
        for area in areas:
            result = run(body(skip=area)); self.assertEqual(result.returncode, 2, area); self.assertIn(area, result.stderr)
        self.assertFalse(any('mermaid' in line for line in open(ROOT / 'tools' / 'pr-body.sh')), 'the diagram is no longer asked for')

    def test_the_summary_is_laid_out_with_headings_a_callout_and_linked_runs(self):
        # Owner, 15 Oct 2026: "use headings, different font size, proper spacing/formatting"; "run 38756824411 should be a hyperlink, not plain text".
        git(self.repo, 'remote', 'add', 'origin', 'https://github.com/owner/repo.git')
        summary = self.tmp / 'look.md'
        summary.write_text('🧱 The old build replays as a whole\n\n**Why:** run 38756824411: 12 rows did not replay\n**Unblocks:** #860\n\n'
                           '| Area | Impact | How |\n|---|---|---|\n' + ''.join(f'| {a} | — None | x |\n' for a in ('Real users', 'Form filling', 'Admin data accuracy', 'Offline replays', 'Tests & harness', 'Development speed', 'Cost')) +
                           '\n- ✅ one\n- ✅ two\n\n| | Before | After |\n|---|---|---|\n| a | 1 | 2 |\n\nNo screenshots: CI tooling only.\n\nlive-row: Personio form in German\n')
        text = self.body(f'--body={summary}')
        self.assertTrue(text.startswith('## 🧱 The old build replays as a whole\n'), text[:80])
        self.assertIn('> [!NOTE]\n> **Why:** [run 38756824411](https://github.com/owner/repo/actions/runs/38756824411): 12 rows', text)
        self.assertIn('>\n> **Unblocks:** #860', text)
        for heading in ('### 📊 Impact', '### ✅ What changed', '### 🔍 Before → After'):
            self.assertEqual(text.count(heading), 1, heading)
        self.assertLess(text.index('### 📊 Impact'), text.index('### ✅ What changed'))
        self.assertIn('<sub>📷 No screenshots: CI tooling only.</sub>', text)
        # Owner, 15 Oct 2026: "make the before/after table more beautiful"; "add horizontal lines between sections".
        self.assertIn('| 📏 What | 🔴 Before | 🟢 After |\n|:---|:---:|:---:|\n| **a** | 1 | **2** |', text)
        for heading in ('### 📊 Impact', '### ✅ What changed', '### 🔍 Before → After'):
            self.assertIn('\n\n---\n\n' + heading, text, 'a rule above ' + heading)
        same = subprocess.run(['python3', str(ROOT / 'tools' / 'pr-body-format.py'), ''], input='X\n\n| | Before | After |\n|---|---|---|\n| b | 3 | 3 |\n', capture_output=True, text=True).stdout
        self.assertIn('| **b** | 3 | ↔ 3 <sub>(unchanged)</sub> |', same)
        self.assertIn('\nlive-row: Personio form in German\n', text, 'a line the CI reads stays as written')
        self.assertLess(text.index('\n---\n'), text.index('<details>'), 'a rule above the folded commit message')
        linked = subprocess.run(['python3', str(ROOT / 'tools' / 'pr-body-format.py'), 'owner/repo'], input='## X\n\n### Y\n\nsee run 38756824411 and [run 38756824411](u)\n', capture_output=True, text=True).stdout
        self.assertIn('see [run 38756824411](https://github.com/owner/repo/actions/runs/38756824411) and [run 38756824411](u)', linked, 'a laid-out body only gets its links, never twice')


class PrDescriptionLaidOutTest(unittest.TestCase):
    """tools/pr-body-check.py (owner, 16 Oct 2026: #1043's body had no headings or separators after a raw `gh pr edit --body-file`)."""

    def check(self, body):
        return subprocess.run(['python3', str(ROOT / 'tools' / 'pr-body-check.py')], input=body, capture_output=True, text=True)

    def test_the_formatters_output_passes_and_a_raw_summary_fails(self):
        raw = (ROOT / 'tools' / 'pr-body-template.md').read_text()
        self.assertEqual(self.check(raw).returncode, 1, 'the raw template (what #1043 was edited to) must fail')
        laid = subprocess.run(['python3', str(ROOT / 'tools' / 'pr-body-format.py'), 'owner/repo'], input=raw, capture_output=True, text=True).stdout
        result = self.check(laid)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_each_missing_part_is_named(self):
        err = self.check('🟢 x\n\n- a\n').stderr
        for part in ('"## " heading', '"---" separator', '"### " section heading'):
            self.assertIn(part, err)

    def test_a_title_without_the_session_tag_is_red_and_names_the_fix(self):
        # 21 Oct 2026: site#18 and #19 were red for a missing "[xx] " tag
        laid = subprocess.run(['python3', str(ROOT / 'tools' / 'pr-body-format.py'), 'owner/repo'], input=(ROOT / 'tools' / 'pr-body-template.md').read_text(), capture_output=True, text=True).stdout
        run = lambda title: subprocess.run(['python3', str(ROOT / 'tools' / 'pr-body-check.py')], input=laid, capture_output=True, text=True, env={**os.environ, 'PR_TITLE': title})
        self.assertEqual(run('[75] Fix the thing').returncode, 0)
        self.assertEqual(run('').returncode, 0, 'a bot\'s PR sets no title: no check')
        bad = run('Fix the thing')
        self.assertEqual(bad.returncode, 1)
        self.assertIn('tools/ship.sh', bad.stderr)
        self.assertIn('[xx]', bad.stderr)

    def test_the_required_job_checks_the_description_on_an_edit(self):
        # A step of the one required job, never its own workflow (owner, 17 Oct 2026: two extra check lines per PR).
        self.assertFalse((ROOT / '.github' / 'workflows' / 'pr-description.yml').exists())
        flow = (ROOT / '.github' / 'workflows' / 'pr-gate.yml').read_text()
        self.assertIn('edited', flow)
        self.assertIn('- name: PR description laid out', flow)
        self.assertIn('tools/pr-body-check.py', flow)
        self.assertIn('PR_TITLE:', flow, 'the same step checks the title tag')
        self.assertIn("github.event.action == 'edited'", flow, 'an edit must not cancel the push run (a cancelled run shows red)')


if __name__ == '__main__':
    unittest.main()


SCREENS = ROOT / 'tools' / 'pr-screens.py'
HEADER = '| What changed | Before | After |\n|---|---|---|\n'
CASES = [   # (name, body, the part of the message expected, or None when it passes)
    ('good row', HEADER + '| Start date sits under the dropdown | ![b](https://x/b.png) | ![a](https://x/a.png) |\n', None),
    ('good row, html images', HEADER + '| Start date sits under the dropdown | <img src="https://x/b.png"> | <img src="https://x/a.png"> |\n', None),
    ('new screen, reason in the caption', HEADER + '| A new Languages card, nothing was here before | — | ![a](https://x/a.png) |\n', None),
    ('no images at all', 'No screenshots: an API route, nothing drawn changed\n', None),
    ('image outside any table', '![after](https://x/a.png)\n', 'outside the screens table'),
    ('image in the old two-column table', '| Before | After |\n|---|---|\n| ![b](https://x/b.png) | ![a](https://x/a.png) |\n', 'outside the screens table'),
    ('image in the numbers table', '| | Before | After |\n|---|---|---|\n| ![b](https://x/b.png) | ![a](https://x/a.png) | x |\n', 'outside the screens table'),
    ('image after the table ended', HEADER + '| Start date sits under the dropdown | ![b](https://x/b.png) | ![a](https://x/a.png) |\n\n![late](https://x/l.png)\n', 'outside the screens table'),
    ('missing caption', HEADER + '| | ![b](https://x/b.png) | ![a](https://x/a.png) |\n', 'no caption'),
    ('caption of one word', HEADER + '| Card | ![b](https://x/b.png) | ![a](https://x/a.png) |\n', 'no caption'),
    ('image in the caption cell', HEADER + '| ![c](https://x/c.png) | ![b](https://x/b.png) | ![a](https://x/a.png) |\n', 'What changed" cell'),
    ('one-sided row with a short caption', HEADER + '| New card | — | ![a](https://x/a.png) |\n', 'only one side'),
    ('a side that is neither image nor dash', HEADER + '| Start date sits under the dropdown | later | ![a](https://x/a.png) |\n', 'neither an image'),
    ('two cells', HEADER + '| Start date sits under the dropdown | ![a](https://x/a.png) |\n', 'not 3'),
]


class PrScreensTest(unittest.TestCase):
    """tools/pr-screens.py (owner, 17 Oct 2026, #1290: two stacked full-window shots, no caption: "let it follow ALWAYS the columns Before/After, explain what changed, where to look").
    The same cases run through the checker CI uses on an edited body (tools/pr-body-check.py), so ship time and GitHub agree."""

    def run_tool(self, tool, body):
        return subprocess.run(['python3', str(ROOT / 'tools' / tool)], input=body, capture_output=True, text=True)

    def test_each_case_passes_or_names_its_gap(self):
        for name, body, expected in CASES:
            result = self.run_tool('pr-screens.py', body)
            if expected is None:
                self.assertEqual(result.returncode, 0, f'{name}: {result.stderr}')
            else:
                self.assertEqual(result.returncode, 1, name)
                self.assertIn(expected, result.stderr, name)

    def test_the_ci_checker_refuses_the_same_bodies(self):
        laid_out = '## 🟢 X\n\n---\n\n### 🖼️ Screens\n\n'
        for name, body, expected in CASES:
            result = self.run_tool('pr-body-check.py', laid_out + body)
            self.assertEqual(result.returncode, 0 if expected is None else 1, f'{name}: {result.stderr}')
            if expected:
                self.assertIn(expected, result.stderr, name)

    def test_the_formatter_keeps_the_images_in_the_screens_table(self):
        out = self.run_tool('pr-body-format.py', '🟢 X\n\n**Why:** a\n**Unblocks:** b\n\n| | Before | After |\n|---|---|---|\n| n | 1 | 2 |\n\n' + CASES[0][1]).stdout
        self.assertIn('| Start date sits under the dropdown | ![b](https://x/b.png) | ![a](https://x/a.png) |', out)
        self.assertIn('### 🖼️ Screens', out)
        self.assertEqual(self.run_tool('pr-screens.py', out).returncode, 0)

    def test_the_template_and_the_rules_show_the_row(self):
        for path in ('tools/pr-body-template.md', 'docs/rules/desktop-ui.md'):
            self.assertIn('| What changed | Before | After |', (ROOT / path).read_text(), path)
