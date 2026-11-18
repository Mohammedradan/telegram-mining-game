# Phase 0 Baseline Audit

Audit date: 2026-11-18
Repository: Mohammedradan/telegram-mining-game
Working baseline: main SHA referenced as PR #92 base, `696006ce78241ce8a98c4cdc94dbbda5edfc698a`.
This is a GitHub metadata/source review, not a fresh local checkout or fresh local test execution.

## Repository state observed
Open PR search returned #92, #88, #86, #85, #80 and #76. No PR was merged, closed or modified during this audit.
- #92: open, not merged, base main at 696006c, head 1a43d62. It addresses cave traversal/station browser interactions, paused/responsive layout, leaderboard isolation and mobile stage height. Its declared test plan is broad (build, clicker, browser, guide, bosses, deep dive, full test).
- #88: open, not merged, base main at f84cb1e (older than #92 base), head 5ec0482. It addresses showcase lobby controls, resume hit-testing, live topbar, miner sizing and leaderboard/boss tests. Because it is based on an older main, it must not be merged or stacked without rebase/overlap review.
- #86, #85, #80, #76: remain open according to search. Their complete overlap and latest CI status were not fully audited in this increment. Do not merge or close blindly.

## CI evidence
PR #88 head 5ec048288a70d7b36ffc490dc459d475cc471c9a has workflow run 43912614329, conclusion failure.
Successful steps include syntax, full Node suite (893 tests: 892 pass, 1 skipped, 0 fail), PostgreSQL API/transactions, trial smoke, WebSocket race protocol, deep-dive, worlds/bosses, classic, adventure quests and prestige.
Failed browser steps:
- First-run coach E2E.
- Platform browser E2E.
- Clicker/mining browser E2E: `scripts/test-clicker-browser.cjs:87`, assertion "the miner stands beside the rock on a tall phone (103px)".
- Guide browser E2E: `scripts/test-guide-browser.cjs:114`, assertion "the two big buttons keep their room".
This proves the unit/backend suite passing is not enough to accept the PR.
PR #92's workflow run was not returned by the PR-triggered workflow lookup for its head during this audit. This is not evidence that its CI passed or failed; inspect Actions directly before relying on it.

## Current gameplay truth from existing audit and source documents
- Six mine biome definitions and connected traversal exist, but that does not equal six fully featured worlds.
- Mining window movement is a normalized 2.5D walk/rock-separation model; it is not the full gravity/jump/follow-camera world required for the target adventure.
- Separate platform runtime has jump, gravity, collision, ladders and server replay patterns that may be reusable; do not move the user to a different tab as a substitute for a true mining adventure.
- Existing machine shift API validates start/claim/stop and server-clock production with caps and ledger writes. It is not a complete logistics network or independently managed fleet.
- Existing robot/worker and machine visuals/controls are partial; no complete worker pathfinding and dispatch network has been proven.
- Current mining scene is viewport-sized; expansive camera-follow world remains missing.
- Existing mine-world shaft floor switching/elevator animation is not a physical passenger lift.
- Station prototype provides replay-validated checkpoint/movement patterns but explicitly does not implement a finished lift, cart, processor, repairs or production.
- Some discovery state is local-only; it must not be treated as account-persistent reward authority.

## Assets and design reference
The supplied 3x3 image boards are target design references for nine screens. They do not establish that their pictured gameplay exists. Preserve the bright blue/gold framed UI, cyan crystals, warm lanterns, cartoon miner and RTL Arabic labels. Each screen must later bind to real state and server-backed actions.

## Risks
1. Browser E2E regressions in responsive layout and first-run flow.
2. Multiple open PRs touching overlapping styles and platform/mining runtime.
3. Divergent mining and platform movement models.
4. Client-only discovery or predicted state accidentally becoming reward authority.
5. Logistics duplication/loss across retries, restart and concurrent requests.
6. Expanding content before the single-zone loop is fun and stable.
7. Treating visual controls as working features without server-side state transitions.

## Actions completed in Phase 0 so far
- Confirmed chosen hybrid strategy and single-zone vertical-slice priority.
- Reviewed current mining adventure audit and station prototype document.
- Inspected open PRs #92 and #88 and exact head/base SHAs.
- Retrieved #88 workflow job and classified the three explicit browser failures plus first-run/platform browser failures.
- Created a documentation-only branch from baseline main SHA: `docs/mining-adventure-rebuild-phase-zero`.
- Added the game design, technical architecture, world progression, systems, acceptance tests, roadmap and this baseline audit.
- No runtime code, schema, workflow, production config, secrets, permissions, main branch, merge or deployment changed.

## Remaining Phase 0 gates
- Inspect #92 exact-head Actions run and logs; if no run exists, request/trigger only through an authorized normal PR update, not workflow edits.
- Fetch exact diffs and latest CI for #86/#85/#80/#76; classify overlaps and whether superseded.
- Reproduce current main baseline in a clean checkout and record install/build/full test/browser/DB results.
- Build a file/module dependency map for player movement, dig-site, platform runtime, station replay, mine APIs and persistence.
- Resolve/close Phase 0 only after evidence is reviewed; do not merge docs branch without user approval.
