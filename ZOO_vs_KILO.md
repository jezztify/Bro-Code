# Zoo-Code vs Kilo-Code

Comparison of `zoo/main` (Zoo-Code-Org/Zoo-Code, SHA `515437b453`) against the currently
checked-out `kilo/main` (Kilo-Org/kilocode, SHA `a19d44c3ef`).

## Relationship

These histories are **unrelated** — `git merge-base` returns nothing between them. This is not
a fork-with-drift situation like Bro-Code/zoo (see `REBASE_FROM_ZOO.md`); it's two separate
products that happen to share a lineage further back (both descend from Roo-Code), but have
since diverged into different monorepo layouts, package managers, and even different top-level
purposes.

Raw diff: 10,845 files changed, +522,127 / -1,311,354 lines. Not meaningful to read as a patch —
treat it as "these are different codebases," not "here's what changed."

|                   | zoo/main                   | kilo/main                                     |
| ----------------- | -------------------------- | --------------------------------------------- |
| Tracked files     | 2,450                      | 8,457                                         |
| Package manager   | pnpm (`pnpm@10.8.1`)       | bun (`bun@1.3.14`)                            |
| Root package name | `roo-code`                 | `@kilocode/kilo`                              |
| Product identity  | Roo Code fork ("Zoo Code") | Kilo Code — VS Code, JetBrains, and CLI agent |

## Structural differences

**zoo/main top level:** `apps/`, `src/`, `webview-ui/`, `.roo/`, `.roomodes`, `.rooignore`,
`pnpm-workspace.yaml`, `renovate.json`, `knip.json`, `codecov.yml` — a single VS Code extension
monorepo (extension host in `src/`, webview in `webview-ui/`, CLI/e2e in `apps/`) in the
classic Roo-Code shape.

**kilo/main top level:** `packages/`, `.kilo/`, `.kilocode/`, `.opencode/`, `.zed/`, `.idea/`,
`bun.lock`, `bunfig.toml`, `flake.nix`/`flake.lock`, `patches/`, `plans/`. Everything lives under
`packages/`, which is much wider than Zoo-Code's `apps/`:

```
packages/core            packages/kilo-vscode       packages/opencode
packages/containers       packages/kilo-jetbrains    packages/plugin
packages/effect-drizzle-sqlite  packages/kilo-web-ui packages/plugin-atomic-chat
packages/effect-sqlite-node     packages/kilo-console packages/sdk
packages/extensions       packages/kilo-docs         packages/server
packages/http-recorder     packages/kilo-gateway     packages/storybook
packages/kilo-i18n          packages/kilo-indexing     packages/tui
packages/kilo-memory         packages/kilo-sandbox      packages/ui
                                                        packages/script
```

Notably, `kilo/main`'s root `dev` script (`bun run --cwd packages/opencode ...`) and the
`packages/opencode` directory indicate Kilo-Code has absorbed/builds on top of **OpenCode**
(hence `.opencode/`, `.zed/` editor integration, `flake.nix`, `opentui`), in addition to the
VS Code/JetBrains extension surface (`kilo-vscode`, `kilo-jetbrains`). Zoo-Code has no
equivalent — it is scoped to a single VS Code extension + webview + CLI.

## Practical takeaway

Don't diff these two directly expecting a reviewable patch — there isn't a common ancestor and
the layouts don't line up file-for-file. If the goal is porting a specific feature or fix from
one to the other, locate the equivalent file by _purpose_ (e.g. Zoo-Code's `src/core/` ↔
Kilo-Code's `packages/core/` or `packages/kilo-vscode/`) rather than by path, and port the logic
by hand.

For the actual maintained fork chain in this repo (Zoo-Code → Bro-Code), see
`REBASE_FROM_ZOO.md` and the `bro-code` branch, which _does_ rebase cleanly onto `zoo/main`
(clean merge-base, 42 commits ahead, no divergence).
