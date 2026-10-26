"""The job-facts system prompt carries every field's guidance: Free AI's model reads the prompt, not the JSON schema's descriptions."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from src.ai import enrich  # noqa: E402


class FieldGuidanceInPrompt(unittest.TestCase):
    # E2E quality on Free AI (26 Oct 2026, #1992): SRE jobs came back "engineering" and two jobs with empty Technologies, while both
    # rules sat only in the schema's descriptions. A field whose description is not in SYSTEM is guidance some models never read.
    def test_every_described_field_is_in_the_system_prompt(self):
        missing = [name for name, spec in enrich.SCHEMA['properties'].items()
                   if spec.get('description') and f"{name}: {spec['description']}" not in enrich.SYSTEM]
        self.assertEqual(missing, [])


if __name__ == '__main__':
    unittest.main()
