#!/usr/bin/env bash
# Publishes templates/github-actions to the public starter template repo (jobadabra/jobadabra-user-template; GarryOne/job-pilotto-starter until it is renamed and moved),
# which users "Use this template" on to create their private jobadabra-personal-always-on. Run after changing the
# templates. Needs gh signed in as the repo owner.
set -euo pipefail
# Why (1 Nov 2026, owner: "for us it should be joabdabra-....-template ... in the middle can be user, or byok, both"): the starter is renamed and moved to the
# org; it publishes to whichever exists (STARTER_REPO overrides), and never creates a repo by itself: a wrong name must not make a new public template.
repo=${STARTER_REPO:-}
for candidate in jobadabra/jobadabra-user-template GarryOne/job-pilotto-starter; do
  [ -n "$repo" ] || { gh api "repos/$candidate" >/dev/null 2>&1 && repo=$candidate; }
done
[ -n "$repo" ] || { echo "publish-starter: no starter template repo found (set STARTER_REPO)" >&2; exit 1; }
root="$(git rev-parse --show-toplevel)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
gh repo edit "$repo" --template --homepage "https://www.jobpilotto.top" >/dev/null
git clone -q "https://github.com/$repo.git" "$work/repo" 2>/dev/null || git init -q -b main "$work/repo"
cd "$work/repo"
rm -rf .github && mkdir -p .github/workflows
cp "$root"/templates/github-actions/*.yml .github/workflows/
cp "$root/templates/github-actions/README.md" README.md
git add -A
if git diff --cached --quiet; then echo "Starter already up to date."; exit 0; fi
git -c user.name=GarryOne -c user.email=6481499+GarryOne@users.noreply.github.com commit -q -m "Update from job-pilotto templates/github-actions"
git branch -M main
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$repo.git"
git push -q -u origin main
echo "Published $repo"
