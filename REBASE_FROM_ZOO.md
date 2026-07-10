# Rebasing a Bro Code branch onto zoo/main

This repo is a rebrand fork of [Zoo-Code-Org/Zoo-Code](https://github.com/Zoo-Code-Org/Zoo-Code)
(remote `zoo`, branch `zoo/main`). Periodically our branches need to be rebased onto a newer
`zoo/main` to pick up upstream fixes/features. This is a large, conflict-heavy operation —
this doc captures the process and pitfalls found while rebasing
`fix/provider-settings-affecting-active-mode` (2026-07).

## 1. Environment setup (do this first, every time)

This repo uses Git LFS, and historically at least one LFS object
(`src/assets/docs/demo.gif`) has 404'd from the LFS server. Any git command that touches the
working tree during the rebase must skip LFS smudging, or checkouts fail with
`Smudge error ... object does not exist on the server`:

```bash
export GIT_LFS_SKIP_SMUDGE=1
```

Set this in the shell for the whole session rather than prefixing every command.

## 2. Fetch and identify the correct base

```bash
git fetch zoo
git log --oneline -1 zoo/main        # note this SHA — this is your rebase target
```

## 3. Start the rebase with explicit `--onto`, and verify the target immediately

**This is the single most important lesson from the last rebase.** During the 2026-07 rebase,
a full 16-commit conflict-resolution pass completed "successfully" — clean `git status`,
"Successfully rebased" — but `zoo/main` had never actually been incorporated: the commits were
silently replayed back onto the branch's _old_ tip, and this was only caught afterward by
manually checking ancestry (`git merge-base --is-ancestor`).

We never fully root-caused it. The confirmed facts: a stale, half-finished rebase from an
earlier session had been aborted just before, the reflog showed no `rebase (start)` entry for
the failed attempt (only `rebase (continue)` lines), and the rebase had been invoked in the
two-arg form (`git rebase zoo/main <branch>`). A plain two-arg rebase on a clean repo computes
the correct merge-base, so the stale state was likely involved — but that's a hypothesis, not
a diagnosis. Treat the defenses below as insurance that catches the failure regardless of its
cause:

1. Use the explicit three-arg form, which leaves nothing implicit:

```bash
git rebase --onto <new-zoo-main-sha> <old-fork-point-sha> <branch-name>
```

Find `<old-fork-point-sha>` with:

```bash
git merge-base <branch-name> zoo/main
```

(Safe to run before or after fetching — the fork point is an ancestor of both the branch and
the new `zoo/main`, so the result is the same.)

2. Verify the target the moment the rebase starts (see step 4) — don't resolve a single
   conflict until `.git/rebase-merge/onto` matches the SHA you intended.

If a previous rebase attempt is abandoned, `git rebase --abort` first, confirm `git status` is
clean and `.git/rebase-merge` / `.git/rebase-apply` no longer exist, _then_ start the new
`--onto` invocation from a known-clean `HEAD`.

## 4. Verify the target immediately after starting

Before resolving a single conflict, confirm the rebase is actually aimed at the right commit:

```bash
cat .git/rebase-merge/onto     # must equal the new zoo/main SHA from step 2
cat .git/rebase-merge/msgnum   # current commit number
cat .git/rebase-merge/end      # total commit count
```

Re-check `onto` periodically during the rebase (it doesn't change, but it's a cheap sanity
check if anything feels off).

## 5. Resolving conflicts — which side is which

During replay, `<<<<<<< HEAD` is the `zoo/main` (upstream) lineage plus already-replayed
Bro Code commits; `>>>>>>> <commit>` is the incoming Bro Code commit. Merge — don't blindly
pick a side:

- **Branding** (`packages/*/package.json`, `src/package.json`, `webview-ui/package.json`,
  command/view IDs, i18n strings): keep Bro Code's name/publisher/displayName/keywords, but
  take any new deps/scripts/fields upstream added independently.
- **`@zoo-code/*` / `@roo-code/*` → `@bro-code/*`, `@zoo/*` / `@roo/*` → `@bro/*`**: any file
  newly introduced or touched by upstream will use the old scope name. These conflicts often
  don't show as git conflicts at all (upstream added a _new_ file with the old import path,
  which doesn't collide with anything) — see the typecheck step below, this is the main thing
  it catches.
- **`RooCodeEventName` / `ZooCodeEventName` → `BroCodeEventName`**, and similar enum/class
  renames: same story — new files from upstream won't have been renamed yet.
- **`.roo/` or `.zoo/` config directories → `.bro/`**: check both file paths _and_ string
  literals inside test fixtures (e.g. `path.join(cwd, ".roo", "rules")` in test setup code) —
  these don't typecheck-fail, only test-fail.
- **Behavior-default conflicts**: if upstream changes a default (e.g. an opt-in/opt-out flip)
  that Bro Code intentionally diverges from, this is a product decision, not a merge mechanics
  question — flag it and ask rather than silently picking either side. Whichever way it's
  resolved, the corresponding test needs updating to match, or it'll fail post-rebase.
- **Persistence/API refactors** (e.g. a method like `updateTaskHistory` being replaced by
  `taskHistoryStore.atomicReadAndUpdate`): if a test mocks the _old_ method name, the rebase
  can complete with no conflict in the test file at all, and it'll only fail at test-run time
  with a runtime error, not a type error. Grep for usages of removed/renamed methods in test
  mocks specifically.
- **`pnpm-lock.yaml`**: don't hand-merge it. Regenerate instead — resolve every other conflict
  in the commit first, then `pnpm install --frozen-lockfile=false` and `git add pnpm-lock.yaml`.
  Fall back to manual merging only if install fails or hangs.
- **Binary assets** (icon PNGs/SVGs): take the incoming Bro Code side —
  `git checkout --theirs <path> && git add <path>` — since the fork intentionally rebrands
  icons. Keep upstream's (`--ours`) only if the file is clearly a new upstream asset unrelated
  to branding.

One trap when continuing: `git rebase --continue` can fail with "You must edit all merge
conflicts" even when no `UU`/`AA` files remain. The cause is usually a file you edited during
resolution but forgot to stage (shows as `MM` in `git status --porcelain`). Check for stray
modified entries and `git add` them — no need to abort.

If a conflict is genuinely large (many files on one commit — the branding/rebrand commit is
usually the worst), it's reasonable to delegate that single commit's conflict resolution to a
background agent, but always re-verify its output per the checklist below rather than trusting
its self-reported success — see the mandatory verification section.

## 6. Mandatory post-rebase verification — do not skip any step

A "Successfully rebased" message and clean `git status` are **not sufficient**. Run all of
these before considering the rebase done:

```bash
# 1. The critical check: is the new zoo/main actually an ancestor of HEAD?
git merge-base --is-ancestor <new-zoo-main-sha> HEAD && echo OK || echo BROKEN

# 2. merge-base should equal the new zoo/main SHA exactly
git merge-base HEAD zoo/main

# 3. Commit count/list sanity check
git log --oneline zoo/main..HEAD

# 4. No leftover real conflict markers. This codebase's own diff-format test fixtures use
#    literal "<<<<<<< SEARCH" / ">>>>>>> REPLACE" strings, so filter those out; anything
#    that survives the filter needs a manual look.
grep -rn '^<<<<<<<\|^=======$\|^>>>>>>>' --include='*.ts' --include='*.tsx' --include='*.json' \
  src/ webview-ui/src/ packages/ apps/ .bro/ | grep -v node_modules | grep -v 'SEARCH\|REPLACE'

# 5. No stale upstream-scoped imports/identifiers left behind
grep -rln '@roo-code/\|@zoo-code/\|@roo/\|@zoo/\|RooCodeEventName\|ZooCodeEventName\|roo-config\|zoo-config' \
  --include='*.ts' --include='*.tsx' . | grep -v node_modules | grep -v /dist/

# 6. Merged lockfile is installable
GIT_LFS_SKIP_SMUDGE=1 pnpm install --frozen-lockfile=false

# 7. Full typecheck across the monorepo
GIT_LFS_SKIP_SMUDGE=1 pnpm check-types

# 8. Full test suites — not just the packages that had conflicts
cd src && GIT_LFS_SKIP_SMUDGE=1 npx vitest run
cd ../webview-ui && GIT_LFS_SKIP_SMUDGE=1 npx vitest run
```

Step 7 (typecheck) catches import-path/identifier issues but **not** stale string literals in
test fixtures (e.g. `.roo/` paths) or stale mocks of renamed methods — only step 8 (running the
actual tests) catches those. Both are necessary; neither is sufficient alone.

## 7. If something looks wrong mid-rebase

Don't fight it blind. `git rebase --abort` is always safe as long as you haven't already
finished and want to discard the whole attempt — it returns you to the branch's pre-rebase
tip via `ORIG_HEAD`. If you're not sure whether to abort, it's cheap to save the current
(possibly-broken) state to a throwaway branch first:

```bash
git branch backup/rebase-attempt-<date> HEAD
git rebase --abort
```

That preserves any conflict-resolution work already done for reference, without blocking a
clean restart.
