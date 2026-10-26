"""A role that cannot be done from home (pilot, nurse, electrician) is judged by the AI, in a fixed answer the code validates; Strategy then says
so in one line when Remote jobs is on (src/onsite_nature.py). No network: decide.decide is fed."""
import unittest
from unittest import mock

from src import onsite_nature

PILOT = {'role_keywords': ['first officer', 'pilot'], 'remote_jobs': ['Yes']}


def judged(answers):
    return mock.patch.object(onsite_nature.decide, 'decide', lambda topic, items, allowed, task, **k: {key: answers.get(key, 'unknown') for key in items})


class OnsiteNatureTest(unittest.TestCase):
    def test_roles_on_site_by_nature_with_remote_on_get_the_note(self):
        with judged({'first officer': 'on_site', 'pilot': 'on_site'}):
            note = onsite_nature.note(PILOT)
        self.assertEqual(note['roles'], ['first officer', 'pilot'])
        self.assertIn('on site', note['text'].lower())

    def test_no_note_when_remote_is_off_or_any_role_can_be_remote_or_nothing_was_judged(self):
        with judged({'first officer': 'on_site', 'pilot': 'can_be_remote'}):
            self.assertIsNone(onsite_nature.note(PILOT))
        with judged({'first officer': 'on_site', 'pilot': 'on_site'}):
            self.assertIsNone(onsite_nature.note({**PILOT, 'remote_jobs': ['No']}))
            self.assertIsNone(onsite_nature.note({'remote_jobs': ['Yes']}))
        with judged({}):   # AI absent or unsure: no claim
            self.assertIsNone(onsite_nature.note(PILOT))
        with mock.patch.object(onsite_nature.decide, 'decide', lambda *a, **k: None):
            self.assertIsNone(onsite_nature.note(PILOT))

    def test_the_answer_is_fixed_values_only(self):
        self.assertEqual(onsite_nature.ANSWERS, ('on_site', 'can_be_remote'))


if __name__ == '__main__':
    unittest.main()
