# Acceptance Tests — Mining Adventure Rebuild

A feature is complete only when its behavior, persistence, security and device UX pass. Screenshots alone are not acceptance evidence.

## Movement and world
- Walk/run/jump/fall/climb through the Stone Mine using keyboard and touch.
- Collision prevents crossing walls, floors, closed gates and out-of-range exits.
- Camera follows both axes, clamps to map bounds and does not alter physics.
- Scene transitions clear held input; focus loss/pause/tab-hidden clears controls.
- Every target and interactable remains reachable at 320x568, 390x844, 844x390 and 1280x800.

## Mining and inventory
- Only reachable, unlocked deposits can be mined.
- Tool strength and deposit durability determine valid progress.
- Server calculates awarded quantity; client-supplied amount is ignored.
- Inventory capacity is enforced; overflow has explicit behavior.
- Repeated/replayed mining commands cannot duplicate output.

## Worker dispatch
- Assigning a worker validates ownership, skill, location and prerequisites.
- Worker path is observable and reaches task site.
- Work advances only while task is valid; blocked/no-path task does not produce.
- Stop/reassign/reload restores correct state and cannot duplicate output.

## Machinery and logistics
- Drill cannot start without unlocked deposit/prerequisites.
- Conveyor moves only actual input cargo.
- Cart/container capacity is enforced; cargo has a single owner/state.
- Warehouse capacity rejects or buffers unload; no cargo duplication on retry.
- Machine stops when required energy/input/output capacity is unavailable.
- Repair consumes required parts once and restores machine operation.
- Every resource movement is transactionally ledgered.

## Mission/event
- Objective progress derives from authoritative actions, not client flags.
- Event changes world state and has at least one meaningful resolution.
- Completion/reward is idempotent and account-isolated.
- Reload restores mission/event stage and route state.

## Persistence/security
- Player checkpoint, route unlock, crew, machines, inventory, logistics and mission state restore after server restart.
- Client cannot forge balances, resources, time, position or completion.
- Concurrent requests and repeated sequence numbers are safe.
- Guest mode remains development-only; Telegram initData verification remains intact.
- Existing economy, race and quest regressions are covered.

## UI/accessibility
- All screen buttons perform their advertised operation.
- Panels do not cover controls or steal movement input.
- 44px touch targets where practical; Arabic RTL labels readable.
- No page-level scroll during active gameplay.
- Reduced motion and sound settings work.
- Errors and pending server acknowledgement are visible.

## Required CI gates
- Syntax and build checks.
- Full Node test suite.
- PostgreSQL API/transaction tests.
- Auth/save-restore/WebSocket smoke tests.
- Chromium E2E: clicker/mining, platform, guide, bosses/worlds, deep dive, station and new Stone Mine slice.
- Viewports: 320x568, 360x740, 390x844, 844x390, 821x934, 1280x800 and 1920x1080.
- No skipped acceptance test introduced to bypass failure; existing documented skips must be explained.
- All checks must pass on the exact PR head SHA before merge.
- Post-merge deployment and Telegram device tests are separate release gates.