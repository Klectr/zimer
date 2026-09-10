# Workflow — timekeep

## Change process (standing requirement)

Every change — feature, fix, or cleanup — goes through an issue **and** a
pull request, so each issue ends up with a complete timeline and history.
No direct pushes to `main` (this supersedes the earlier commit-straight-to-
main workflow).

1. **File an issue** describing the problem, scope, acceptance criteria, and
   non-goals.
2. **Create a branch** named `issue-<N>-<short-slug>` off `main`, and **open
   a PR** against `main` titled after the change, with `Closes #N` in the
   body. Do this before writing code, even if the PR starts empty — the PR
   existing early is what makes the timeline valid.
3. **Implement** on the branch. Commit messages reference the issue
   (`#N: short description`).
4. **Narrate decisions on the timeline as they happen.** When a decision is
   made mid-work (scope change, approach pivot, spec interpretation, test
   result), post it as an issue comment (prefix `Decision:`) and/or PR
   comment. The issue timeline must read as the full story: filed → PR
   opened → decisions → tests → merged. Don't reconstruct it after the fact.
5. **Test** on a local server (see below); post the test evidence as a PR
   comment.
6. **Merge the PR** (merge commit, preserving branch history), which auto-
   closes the issue via `Closes #N`. Add a closing comment only if something
   notable isn't already on the timeline.

Don't batch unrelated changes into one issue/PR, and don't merge until the
change is pushed to the branch and verified.

Tooling (no git auth on some machines): `gh_push.py` pushes file sets to any
branch via the git-database API; `/tmp/gh_pr.py` handles `create-branch`,
`open`, `comment`, and `merge` through the same stored GitHub credential.

## Local dev

```bash
cd site
TIMEKEEP_TOKEN=dev-token bun server.ts   # or omit; a token is auto-generated
```

One process, one SQLite file (WAL mode). The browser extension points at the
site URL and authenticates with `TIMEKEEP_TOKEN` as a Bearer token.

## Pushing without git auth

Some machines working on this repo have no git credentials and the working
copy may not even be a git checkout. That's supported — push through the
GitHub **git-database API**:

1. `GET /repos/{owner}/{repo}/git/refs/heads/main` → head SHA
2. `POST /repos/{owner}/{repo}/git/blobs` per changed file (base64)
3. `POST /repos/{owner}/{repo}/git/trees` (`base_tree` = head's tree + your blobs)
4. `POST /repos/{owner}/{repo}/git/commits` (parents = head SHA)
5. `PATCH /repos/{owner}/{repo}/git/refs/heads/main` → new commit SHA

Never ask the user to paste tokens or keys to make this work. If your
environment has no stored GitHub credential, say so and stop — don't invent
a workaround.

On a normal machine with git, it's just `git pull` / `git push` on `main`.

## Issue / slice conventions

- Work is planned as **milestones** (one per epic), implemented as **thin
  vertical slices** filed as issues against the milestone.
- Each slice must be independently shippable: **DB → API → UI** in one issue.
- Every issue states: scope (DB/API/UI), constraints, acceptance criteria,
  and non-goals. Dependencies on other slices are noted up front.
- Infrastructure-only slices are allowed when they unlock the rest, but say
  so plainly ("no visible UI change").
- Don't reopen settled product decisions (see AGENTS.md) inside a slice
  issue — if one needs revisiting, that's a conversation first.
