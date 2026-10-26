"""The Always on workflows tell a person by the channels they chose (JOB_PILOTTO_NOTIFY, set by the app): a failed run is told by e-mail too, and Telegram stays quiet when it was turned off.

The class: every workflow a user's private repo runs (templates/github-actions → daily, mail, scout). Found 26 Oct 2026: scout and mail sent a failure only to Telegram (or not at all),
and the Telegram failure line ignored a Telegram-off choice. Messages from the engine itself go through src/telegram.py → src/notify.py (tests/test_notify.py).
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
USER_WORKFLOWS = sorted(p.name for p in (ROOT / 'templates' / 'github-actions').glob('*.yml'))
TELEGRAM_CHOSEN = 'case ",$JOB_PILOTTO_NOTIFY," in ,,|*,telegram,*) ;; *) exit 0 ;; esac'


def steps(name):
    """Each step of the workflow as its text block (from one '- name:'/'- uses:' to the next)."""
    text = (ROOT / '.github' / 'workflows' / name).read_text(encoding='utf-8')
    return re.split(r'\n(?=      - (?:name|uses):)', text)


class FailureNoticeTests(unittest.TestCase):
    def test_the_user_workflows_are_the_ones_checked(self):
        self.assertEqual(USER_WORKFLOWS, ['daily.yml', 'mail.yml', 'scout.yml'])

    def test_every_user_workflow_reports_a_failure_by_e_mail(self):
        for name in USER_WORKFLOWS:
            with self.subTest(name):
                self.assertTrue(any('if: failure()' in step and 'python -m src.notify' in step for step in steps(name)),
                                f'{name}: no failure step sends `python -m src.notify` (e-mail-only users never hear of a failed run)')

    def test_every_telegram_post_in_a_workflow_follows_the_choice(self):
        for name in USER_WORKFLOWS:
            for step in steps(name):
                if 'api.telegram.org' not in step or 'STARTED_BY_SOMEONE' in step:   # the answer to a press in Telegram goes back where it was pressed
                    continue
                with self.subTest(name, step=step.strip().splitlines()[0]):
                    self.assertIn(TELEGRAM_CHOSEN, step, f'{name}: a Telegram post ignores a Telegram-off choice')

    def test_the_choice_reaches_every_user_workflow(self):
        for name in USER_WORKFLOWS:
            text = (ROOT / '.github' / 'workflows' / name).read_text(encoding='utf-8')
            with self.subTest(name):
                self.assertIn('JOB_PILOTTO_NOTIFY: ${{ vars.JOB_PILOTTO_NOTIFY }}', text)
                self.assertIn('JOB_PILOTTO_TRIAL_KEY: ${{ secrets.JOB_PILOTTO_TRIAL_KEY }}', text)


if __name__ == '__main__':
    unittest.main()
