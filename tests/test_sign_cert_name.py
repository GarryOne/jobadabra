"""The Mac build's signature check names the same certificate sign.cjs signs with (beta 0.8.29, 25 Oct 2026: a rename changed the check, not the certificate)."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SignCertNameTests(unittest.TestCase):
    def test_workflow_check_names_the_certificate_sign_cjs_uses(self):
        name = re.search(r"const NAME = '([^']+)'", (ROOT / 'desktop' / 'scripts' / 'sign.cjs').read_text()).group(1)
        checks = re.findall(r'Authority=([^"\n]+)"', (ROOT / '.github' / 'workflows' / 'desktop.yml').read_text())
        self.assertTrue(checks, 'desktop.yml no longer checks the signature authority')
        self.assertEqual({name}, set(checks))


if __name__ == '__main__':
    unittest.main()
