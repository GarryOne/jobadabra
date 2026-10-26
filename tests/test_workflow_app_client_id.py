"""The CI App's token is minted by its Client ID (a repo variable), never the deprecated `app-id` input (owner, 26 Oct 2026)."""
# actions/create-github-app-token@v3 warned "Input 'app-id' has been deprecated... Use 'client-id'" 24 times a run. The Client ID is not a secret: it lives in
# the repository variable CI_APP_CLIENT_ID (jobadabra and jobadabra-web), the private key stays the secret CI_APP_PRIVATE_KEY.
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = sorted([*ROOT.glob('.github/workflows/*.yml'), *ROOT.glob('.github/actions/*/action.yml')])
CLIENT = re.compile(r'^\s+client-id: \$\{\{ (vars\.CI_APP_CLIENT_ID|inputs\.client-id) \}\}\s*$')


def mint_steps(text):
    """Each create-github-app-token step's `with:` lines -> [(line number, [lines])]."""
    lines, out = text.split('\n'), []
    for number, line in enumerate(lines):
        if 'uses: actions/create-github-app-token@' not in line:
            continue
        indent = len(line) - len(line.lstrip(' -'))
        body = []
        for later in lines[number + 1:]:
            if later.strip() and (len(later) - len(later.lstrip(' ')) < indent or later.lstrip().startswith('- ')):
                break
            body.append(later)
        out.append((number + 1, body))
    return out


class AppClientId(unittest.TestCase):
    def test_no_workflow_or_action_uses_app_id(self):
        bad = [f'{path.relative_to(ROOT)}:{number}: {line.strip()}' for path in FILES
               for number, line in enumerate(path.read_text(encoding='utf-8').split('\n'), 1)
               if re.search(r'\bapp-id\b|secrets\.CI_APP_ID\b|inputs\.app-id\b', line)]
        self.assertEqual(bad, [], 'the CI App goes by client-id: ${{ vars.CI_APP_CLIENT_ID }}:\n' + '\n'.join(bad))

    def test_every_token_step_names_the_client_id(self):
        seen, bad = 0, []
        for path in FILES:
            for number, body in mint_steps(path.read_text(encoding='utf-8')):
                seen += 1
                if not any(CLIENT.match(line) for line in body):
                    bad.append(f'{path.relative_to(ROOT)}:{number}')
        self.assertGreater(seen, 20, 'the lint saw the token steps')
        self.assertEqual(bad, [], 'a create-github-app-token step without client-id: ${{ vars.CI_APP_CLIENT_ID }}:\n' + '\n'.join(bad))

    def test_the_lint_catches_the_old_input(self):
        sample = '      - uses: actions/create-github-app-token@v3\n        with:\n          app-id: ${{ secrets.CI_APP_ID }}\n          private-key: x\n'
        (_, body), = mint_steps(sample)
        self.assertFalse(any(CLIENT.match(line) for line in body))
        good = sample.replace('app-id: ${{ secrets.CI_APP_ID }}', 'client-id: ${{ vars.CI_APP_CLIENT_ID }}')
        self.assertTrue(any(CLIENT.match(line) for line in mint_steps(good)[0][1]))


if __name__ == '__main__':
    unittest.main()
