"""Every folder an e2e run writes its logs to (E2E_ARTIFACTS) is uploaded: the second try of a red suite writes to e2e-rerun/<suite>, which nothing uploaded, so a
retry's own failure could not be read (owner's coordinator, 26 Oct 2026, #2087's quality run 40340783596: the retry stored no job and only the first try's logs were kept)."""
import re
import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parent.parent / '.github' / 'workflows'
SET = re.compile(r'E2E_ARTIFACTS[:=]\s*"?\$\{\{ github\.workspace \}\}/((?:[^"\s$]|\$\{\{[^}]*\}\})+)')


def uploaded(text):
    """-> the `path:` entries of every upload-artifact step (one line, or a `|` list indented under it)."""
    out = set()
    for block in re.split(r'(?m)^      - ', text)[1:]:
        if 'actions/upload-artifact@' not in block:
            continue
        lines = block.splitlines()
        for i, line in enumerate(lines):
            if not line.startswith('          path:'):
                continue
            value = line.split(':', 1)[1].strip()
            if value and value != '|':
                out.add(value)
            else:
                for more in lines[i + 1:]:
                    if not more.startswith('            '):
                        break   # the next key of `with:`, or the step's end
                    out.add(more.strip())
    return out


class ArtifactsUploaded(unittest.TestCase):
    def test_every_artifacts_folder_a_run_writes_is_uploaded(self):
        checked = 0
        for path in sorted(WORKFLOWS.glob('*.yml')):
            text = path.read_text(encoding='utf-8')
            paths = uploaded(text)
            for folder in sorted(set(SET.findall(text))):
                checked += 1
                self.assertIn(folder, paths, f'{path.name}: E2E_ARTIFACTS={folder} is written but never uploaded (add an upload-artifact step, if: always())')
        self.assertGreaterEqual(checked, 4, 'positive control: the first try and the retry folders of e2e.yml and desktop.yml are read')


if __name__ == '__main__':
    unittest.main()
