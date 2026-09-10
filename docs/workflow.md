# Workflow — timekeep

## Change process (standing requirement)

Every change — feature, fix, or cleanup — follows this order, no exceptions:

1. **File an issue ticket** describing the change, scope, and acceptance
   criteria.
2. **Implement** the fix against `main`.
3. **Test** it (local server + checks; see below).
4. **Push** to `main`, then **close the issue** with the commit reference.

Don't batch unrelated changes into one issue, and don't close an issue until
the change is pushed and verified.

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
