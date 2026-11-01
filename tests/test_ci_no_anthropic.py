"""No CI workflow or composite action calls the Anthropic API: every CI AI call goes through the Codex broker (owner, 28 Oct 2026: "use/switch to Codex subscription for anything CI related";
31 Oct 2026: four "AI credit is 0 anthropic" alerts from one UI-verdict run, "Why Anthropic is reached? We should use fully the Codex").

A workflow may not use claude-code-action, pass an Anthropic key (ANTHROPIC_API_KEY, anthropic_api_key, any secret with ANTHROPIC in its name) or name `anthropic` at all, comments aside.
The ALLOWED table below is what is not moved, per file and per word. It may only shrink: a word that is no longer in its file fails the test until its entry is deleted,
and a new word anywhere fails it at once. Two categories are left: the user pipelines (the user's own key in the user's own repo, not a CI call of ours) and the e2e lane (the harness engine under test, owned by the e2e lane;
its entries go when that lane's harness engine leaves the key; spec 2026-10-28-ci-on-codex-subscription-design.md)."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORD = re.compile(r'[\w.@/-]*anthropic[\w.@/-]*', re.I)

# User pipelines (user's own key): daily.yml, mail.yml and scout.yml are `workflow_call` pipelines the product's users run in THEIR repo with THEIR key (Always on, hosted or personal); the owner's own copy is
# GarryOne/jobadabra-personal-always-on. They are not CI calls of ours: no key of ours reaches them. They stay on the user's key by design (coordinator, 31 Oct 2026).
USER_PIPELINES = {
    '.github/workflows/daily.yml': {'ANTHROPIC_API_KEY', 'secrets.ANTHROPIC_API_KEY'},
    '.github/workflows/mail.yml': {'ANTHROPIC_API_KEY', 'secrets.ANTHROPIC_API_KEY'},
    '.github/workflows/scout.yml': {'ANTHROPIC_API_KEY', 'secrets.ANTHROPIC_API_KEY'},
}

# Owned by the e2e / pool lane (the harness engine under test, the live pool, the PR prompt cases, the cost report): not part of the move above, still listed so the class cannot grow.
E2E_LANE = {
    '.github/actions/e2e-review/action.yml': {'Anthropic', 'E2E_ANTHROPIC_KEY', 'anthropic-key', 'inputs.anthropic-key', 'secrets.E2E_ANTHROPIC_KEY'},
    '.github/workflows/desktop.yml': {'E2E_ANTHROPIC_KEY', 'anthropic', 'env.E2E_ANTHROPIC_KEY', 'secrets.E2E_ANTHROPIC_KEY'},
    '.github/workflows/e2e-windows.yml': {'E2E_ANTHROPIC_KEY', 'anthropic', 'anthropic-key', 'env.E2E_ANTHROPIC_KEY', 'secrets.E2E_ANTHROPIC_KEY'},
    '.github/workflows/e2e.yml': {'E2E_ANTHROPIC_KEY', 'anthropic', 'anthropic-key', 'env.E2E_ANTHROPIC_KEY', 'secrets.E2E_ANTHROPIC_KEY'},
    '.github/workflows/prompt-cases.yml': {'@anthropic-ai/claude-code@2.1.296', 'PR_PROOF_ANTHROPIC_KEY', 'secrets.PR_PROOF_ANTHROPIC_KEY'},
    '.github/workflows/record-sites.yml': {'E2E_ANTHROPIC_KEY', 'LIVE_POOL_ANTHROPIC_KEY', 'secrets.E2E_ANTHROPIC_KEY', 'secrets.LIVE_POOL_ANTHROPIC_KEY'},
    # The replay refill is the harness's proxy + fill-memo (lib/live-row.mjs, lib/refill.mjs): which model records the pool's stored answers is the e2e lane's decision, not a workflow edit.
    '.github/workflows/replay-refill.yml': {'Anthropic', 'REPLAY_REFILL_ANTHROPIC_KEY', 'secrets.REPLAY_REFILL_ANTHROPIC_KEY'},
    '.github/workflows/review-eval.yml': {'Anthropic', 'E2E_ANTHROPIC_KEY', 'secrets.E2E_ANTHROPIC_KEY'},
    '.github/workflows/watch-live.yml': {'E2E_ANTHROPIC_KEY', 'LIVE_POOL_ANTHROPIC_KEY', 'secrets.E2E_ANTHROPIC_KEY', 'secrets.LIVE_POOL_ANTHROPIC_KEY'},
}
ALLOWED = {**USER_PIPELINES, **E2E_LANE}

# Allowed by name anywhere, not on the shrinking list (coordinator, 31 Oct 2026): the Admin key only READS what Anthropic billed (daily.yml here; ai-cost-billed.yml moved to jobadabra-web, rs 6a/6); it makes no model call and spends nothing.
# The guard bans keys that buy model calls.
COST_READERS = {'ANTHROPIC_ADMIN_KEY', 'secrets.ANTHROPIC_ADMIN_KEY'}


def words(text):
    """-> the set of words naming Anthropic in a YAML file, comments left out (a `#` at the start of a line or after a space)."""
    code = '\n'.join(re.sub(r'(^|\s)#.*$', '', line) for line in text.splitlines())
    return set(WORD.findall(code)) - COST_READERS


def found(root=ROOT):
    files = sorted((root / '.github' / 'workflows').glob('*.yml')) + sorted((root / '.github' / 'actions').glob('*/action.yml'))
    return {path.relative_to(root).as_posix(): words(path.read_text(encoding='utf-8')) for path in files}


class NoAnthropicInCI(unittest.TestCase):
    def test_no_workflow_names_anthropic_beyond_the_allowlist(self):
        extra = {file: sorted(w - ALLOWED.get(file, set())) for file, w in found().items() if w - ALLOWED.get(file, set())}
        self.assertEqual(extra, {}, 'CI AI goes through the Codex broker (desktop/e2e/lib/broker-client.mjs): no Anthropic key, no claude-code-action')

    def test_the_allowlist_only_shrinks(self):
        seen = found()
        stale = {file: sorted(words - seen.get(file, set())) for file, words in ALLOWED.items() if words - seen.get(file, set())}
        self.assertEqual(stale, {}, 'these words left their files: delete them from ALLOWED so the list shrinks')

    def test_the_moved_workflows_use_the_broker(self):
        moved = {'ui-verdict': r'node desktop/e2e/judge-codex\.mjs', 'ui-findings': r'node desktop/e2e/judge-codex\.mjs', 'ui-fix': r'node desktop/e2e/edit-codex\.mjs',
                 'finder-review': r'node desktop/e2e/edit-codex\.mjs', 'judge-exam': r'node desktop/e2e/judge-codex\.mjs',
                 'product-brain': r'node desktop/e2e/brain-codex\.mjs', 'central-scout': r'node desktop/e2e/broker-relay-run\.mjs'}
        for name, script in moved.items():
            text = (ROOT / '.github' / 'workflows' / f'{name}.yml').read_text(encoding='utf-8')
            self.assertIn('id-token: write', text, f'{name}: the broker knows a run by its OIDC token')
            self.assertRegex(text, script, name)
            self.assertIn('ai-skipped-alert', text, f'{name}: a refused call tells the owner once')

    def test_user_pipelines_are_reusable_workflows_not_ci_jobs(self):
        for file in USER_PIPELINES:
            text = (ROOT / file).read_text(encoding='utf-8')
            self.assertRegex(text, r'(?m)^\s+workflow_call:', f'{file}: runs in the user\'s repo with the user\'s key, called by their workflow')
            self.assertNotRegex(text, r'(?m)^\s+(schedule|push|pull_request):', f'{file}: nothing of ours starts it')

    def test_the_guard_sees_a_planted_key(self):
        self.assertEqual(words('env:\n  K: ${{ secrets.NEW_ANTHROPIC_KEY }}  # fine\n# anthropic in a comment\n'), {'secrets.NEW_ANTHROPIC_KEY'})
        self.assertEqual(words('uses: anthropics/claude-code-action@v1\n'), {'anthropics/claude-code-action@v1'})


if __name__ == '__main__':
    unittest.main()
