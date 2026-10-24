#!/usr/bin/env bash
# Publishes templates/github-actions to the public starter template repo (GarryOne/job-pilotto-starter),
# which users "Use this template" on to create their private jobadabra-personal-always-on. Run after changing the
# templates. Needs gh signed in as the repo owner.
set -euo pipefail
repo=GarryOne/job-pilotto-starter
root="$(git rev-parse --show-toplevel)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
if ! gh repo view "$repo" >/dev/null 2>&1; then
  gh repo create "$repo" --public --description "Starter for your private Jobadabra repository: use this template, keep it private." >/dev/null
fi
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
