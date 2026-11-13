# Mining window adventure audit — 2026-11-13

## Baseline and scope

- Inspected `main` at `397b7a2d80293e1fb25499f0a1b7fedfda24c09e`, also the session base. PR #77 is merged at that commit.
- PR #75 (machinery browser coverage) and #76 (mining layout) are open, with failed checks at their inspected heads. Neither was merged, closed, or modified.
- Reviewed their diffs: #75 adds start/stop browser assertions; #76 introduces layout overrides and a literal `\\n` in the HTML link insertion. #77 already provides expanded expedition layout. Do not blindly stack #76 on it. The full historical Actions logs could not be downloaded because the log-storage host is inaccessible here; no claim about all historical failure causes is made.
- Work remains on the Arena session branch. No workflows, production configuration, schemas, secrets, or accounting rules changed.

## What exists vs what is actually playable

| Requested feature | Existing implementation and limitation |
| --- | --- |
| Six themed mines | `mine-world.js` defines Stone through Legendary; `dig-site.js` updates biome presentation. Traversal tested in rules and Chromium. Exploration unlocks are not server economy entitlements. |
| Movement and collision | Normalized 2.5D walking, rock separation and approach/dig controls exist in the mining window. This is **not** a large side-scrolling world with gravity, jump/run/platform collision. A separate platform game already implements side-scrolling mechanics; moving the player to that tab is not a solution to this request. |
| Ladders/elevator | Shaft proximity changes the floor flag. Elevator animation responds to floor changes. These are not a physical passenger lift with call buttons, platform collision and a persistent position. Depth walking can leave the floor flag stale. Exit checks now require the actual upper-tunnel height too. |
| Traversal | The old fixed `x >= .91` exit was unreachable with a measured mobile body-safe limit of `.80`. Fixed to use measured band bounds, require movement toward the exit, and keep visited routes open. Cave arrival now clears held controls/automatic approach instead of carrying a strike into a new cave. |
| Camera/world size | The mining window is a viewport-sized scene; no expansive coordinate map or following camera yet. |
| Machines | Authenticated start/claim/stop, server clock, mine permission check, capped production and ledger writes exist in `mine-machinery-api.js`. Persistent job restoration exists in the machinery client. This is one job with three required switches, not independently upgradable machines with resource routes. |
| Carts, workers, robots | Animated presentation and assignment switches exist. No rideable cart, transported inventory, worker pathfinding or per-zone job dispatch in this window yet. |
| Secrets/objectives | Nearby cache interaction and local discovery journal exist, plus visit objectives. The cache is a local discovery, not a server reward or physical secret-room route. Daily/weekly reward quests elsewhere must not be confused with these visit objectives. |
| Save/restore | Server economy/job storage exists; discoveries use local storage. Miner position, current cave and route unlocks are not yet a persisted adventure checkpoint. Local discoveries are not account-scoped and must never become a source of reward authority. |
| Mobile UI | Focus/fullscreen fallback, floating controls, map/objective sheets, reduced motion exist. Sheets now expand one at a time, close with Escape and restore summary focus without resizing the field. Focused summaries/buttons/editors no longer steer the miner. Key release clears movement even if focus/modifiers change. |

## Changes in this reviewable increment

1. Shared `canAdvance()` rule for movement and exit sign; final mine has an explicit end-of-route label.
2. Body-safe mobile exits, upper-position/direction checks, and bidirectional revisits.
3. Safe arrival input reset and cancellation of stale automatic approach; no landing strike from the previous cave's held controls.
4. Keyboard release/focused-control fixes and exclusive, Escape-dismissable exploration sheets.
5. Regression rules and real Chromium coverage integrated into the existing `test:clicker` entrypoint via a small separate helper, without changing CI workflows.

## Verification

- Baseline: build passed; 840 tests, 839 passed, 1 skipped, 0 failed.
- After runtime changes: build passed; 844 tests, 843 passed, 1 skipped, 0 failed. A further safe-arrival unit test was added afterward and the dig-site suite passed 34/34.
- Focused world/dig/expedition suite: 46/46 passed before that additional arrival test.
- `node scripts/trial-smoke.cjs`: 22/22 passed, including authenticated economy, replay rejection, account isolation, restart persistence, WebSocket first-message authentication and rejection cases.
- `test:clicker`: real Chromium 153 passed on 320×568, 360×740, 360×800, 375×667, 375×812, 390×844, 844×390, 821×934 and 1280×800, plus the existing reduced-motion checks. The added helper verifies sheet layout/focus, real keyboard climbing and progression through all six mines, scene updates, final exit state and unchanged gold. No page/console/request errors.
- A failing browser assertion was investigated rather than removed: diagnostics proved `stats.swings` incremented and gold increased on cave arrival while the right key was still held. Fixed by cancelling carried input and suppressing mining on the transition frame. The unchanged-gold assertion remains.
- Installation initially failed because nodejs.org headers are blocked. `npm_config_nodedir=/usr/local npm ci` succeeded with installed headers. Chromium was installed outside the repository through npm; its bundled runtime libraries were used locally. No browser binaries/dependencies were added to the repository.
- PostgreSQL service is not available locally; PostgreSQL checks require CI. Real Telegram host validation and production Render HTTP access are not available in this sandbox's network allowlist. No deployment or Telegram-device success is claimed.
- Existing dependency audit reports `body-parser`/`qs` advisories (1 moderate, 1 high); no unrelated dependency upgrade was applied.

## Remaining stages / acceptance gates

This increment is **not the completed adventure**. Do not treat the decorative scene as completed gameplay.

- Stage 2: following camera, larger world coordinates, mobile target visibility and panel/controls usability in that expanded world.
- Stage 3: physical floor constraints, jump/run/fall, connected collision geometry, passenger elevator; preserve rock reach and touch mining while adding them.
- Stage 4: rideable carts and inventory transport; per-machine progression and worker/robot scheduling tied to server-owned resource rules. Existing server job must not be bypassed.
- Stage 5: server-verifiable exploration missions/keys/rewards and account-scoped checkpoints. Design compatibility with existing platform replay and quest systems before adding reward endpoints.
- Stage 6: draw/per-frame profiling, asset streaming if needed, reusable modules only where justified.
- Stage 7: full PostgreSQL + WebSocket + browser CI at the exact PR head, review, safe merge, then verifiable Render deployment and Telegram-device validation. No cleanup/closure of older PRs without reviewing their complete failures and overlap.
