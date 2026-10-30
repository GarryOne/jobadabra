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


def plan(repo, gh, context):
    """List open PRs once, with latest legacy statuses, using one GraphQL call per 100 PRs.
    Invariants: no REST status scan per PR, no workflow dispatch, no status writes.
    Each candidate enters pr-verdict.yml's shared per-head queue before fresh run reads.
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
    line = 'heads=' + json.dumps(sorted(heads), separators=(',', ':'))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as out:
            print(line, file=out)
    print(line)
    print(f'sweep selection: {len(pages)} GraphQL call(s), 0 REST calls; {len(heads)} candidate head(s)')
