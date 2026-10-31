"""Select open PR heads needing a verdict; computation and status writes stay in pr-verdict.py."""
import json
import os


QUERY = """query($owner: String!, $name: String!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 100, after: $endCursor) {
      pageInfo { hasNextPage endCursor }
      nodes { headRefOid commits(last: 1) { nodes { commit { status { contexts { context state } } } } } }
    }
  }
}"""


def plan(repo, gh, context, run_list, counted):
    """List open PRs once, with latest legacy statuses, using one GraphQL call per 100 PRs.
    Invariants: no REST status scan per PR, no workflow dispatch, no status writes.
    Live/no-counted-run heads are dropped before taking a head queue. Each eligible head enters pr-verdict.yml's shared per-head queue before fresh run reads.
    """
    owner, name = repo.split('/')
    pages = json.loads(gh('api', 'graphql', '--paginate', '--slurp', '-f', f'query={QUERY}', '-f', f'owner={owner}', '-f', f'name={name}'))
    heads = set()
    for page in pages:
        for pr in page['data']['repository']['pullRequests']['nodes']:
            commit = pr['commits']['nodes'][-1]['commit']
            statuses = (commit.get('status') or {}).get('contexts') or []
            state = next((s['state'] for s in statuses if s['context'] == context), None)
            if state in (None, 'PENDING'):
                heads.add(pr['headRefOid'])
    eligible = []
    for sha in sorted(heads):
        runs = counted(run_list(sha))
        if runs and all(r.get('status') == 'completed' for r in runs):
            eligible.append(sha)
    line = 'heads=' + json.dumps(eligible, separators=(',', ':'))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as out:
            print(line, file=out)
    print(line)
    print(f'sweep selection: {len(pages)} GraphQL call(s), {len(heads)} REST run-list call(s); {len(eligible)} idle counted head(s)')
