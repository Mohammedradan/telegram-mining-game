# Technical Architecture — Mining Adventure Rebuild

Status: target architecture for staged implementation. Existing code must be inspected before moving or replacing modules.

## Architecture decision
Use a hybrid rebuild: retain the existing authentication, account model, economy, database, transaction/ledger, WebSocket and Telegram integration where audits prove them sound. Rebuild the mining-world runtime and its interaction model behind a bounded module boundary. Do not rewrite the whole web app or create parallel identity/economy systems.

## Existing verified building blocks from repository audit
- `public/platform-rules.js`: deterministic platform movement/jump/collision and ladder primitives already used by platform gameplay.
- `platform-api.js`: server-side replay/validation pattern for platform rounds.
- `db.js` and existing user transaction helpers: authenticated account persistence and transactional writes.
- `mine-machinery-api.js` plus `public/mine-machinery-client.js`: authenticated machine-shift start/claim/stop with server clock, caps and ledger.
- `public/mine-world.js`, `public/dig-site.js`, `public/mine-expedition.js`: existing mining zones, presentation, traversal and discovery code; current limitations are documented in MINING-ADVENTURE-AUDIT.md.
- `station-api.js` and `public/station-rules.js`: prototype of replay-validated checkpoint progression and reuse of shared motion rules. Station prototype is not a finished elevator/cart system.

## Proposed runtime boundaries
```
public/game/
  core/       loop, deterministic tick, world state, camera, input, collision
  player/     controller, animation, interaction
  world/      map data, zones, geometry, elevators, carts, interactables
  mining/     deposits, tools, inventory presentation
  crew/       worker and robot presentation, task UI
  machinery/  machine state, production visualization, logistics
  missions/   objective and event presentation
  ui/         HUD, control room, warehouse, workshop, crew, mission panels
server/game/
  world/      authoritative world and checkpoint service
  mining/     validated mining actions
  crew/       assignments and work resolution
  machinery/  machine operations and production
  logistics/  transfer, capacity and shipment transactions
  missions/   mission/event transitions and claims
```
This is a proposed organization, not a mandate to move files before baseline tests and dependency maps exist.

## Simulation contract
- Define fixed simulation tick and explicit units (world pixels/units, seconds, resource quantities).
- Keep render frame rate separate from simulation time.
- Inputs are normalized, bounded and sequenced; held inputs clear on blur, tab hidden, pause, scene transition and disconnect.
- Collision and movement rules are deterministic for a given map/version/input sequence.
- Camera is presentation-only and cannot affect authoritative physics.
- Server validates important outcomes from inputs/actions and its own clock/state; client sends intent, never balances, rewards, arbitrary position or elapsed production.
- Version simulation rules and persist the version needed to replay older sessions.

## Persistence model (logical, adapt to existing schema)
- player_checkpoint: zone, x/y, floor/route, checkpoint version, acknowledged sequence.
- world_progress: unlocked passages, activated mechanisms, completed events, discoveries.
- crew_state: worker/robot IDs, assignments, statuses, levels, locations.
- machine_state: machine ID, level, operating state, durability, last server update.
- inventory/warehouse: resource quantities, capacity, reserved/transit quantities.
- logistics_jobs: origin, destination, cargo, carrier, status, sequence.
- mission_state: mission/event IDs, step, status, timestamps, idempotency key.
Do not add schema until data ownership, migration, indexes, retention and rollback are reviewed.

## API principles
- Authenticated endpoints only for player-owned state.
- Commands are idempotent and carry unique operation IDs/sequence numbers.
- Validate ownership, unlock requirements, proximity, machine capability, input resources, capacity, rate limits and server time.
- Perform resource mutations and ledger writes in one database transaction.
- Return authoritative snapshot/version; client reconciles predicted visuals to acknowledged state.
- Replays, stale sequence, duplicate claims and concurrent device writes fail safely.
- No new reward endpoint until compatibility with existing economy, quests and platform replay has been reviewed.

## Rendering and assets
Start by profiling existing Canvas/DOM rendering and the platform rules. Compare incremental extension against a small Phaser proof-of-concept only if the current runtime cannot provide world camera, layers, collision and mobile performance. Do not adopt a second physics engine without a deterministic replay plan. Asset loading must be local/reliable, cached/versioned, responsive and support reduced motion.

## Module migration
Extract one cohesive boundary at a time. Preserve old public APIs with adapters until call sites migrate. Add parity tests before deleting old code. Avoid giant rewrites, duplicate loops, duplicate movement rules and simultaneous control of the same player by two runtimes.

## Observability
Record simulation version, checkpoint sequence, action result, rejected reason, resource ledger references, machine/job status and errors without secrets or personal data. Add diagnostic mode for E2E, not production shortcuts.

## Security and operations
Keep BOT_TOKEN and database credentials server-side. Guest auth remains development-only. Do not alter GitHub permissions, Actions workflows, production env, secrets or billing configuration as part of this plan. Deploy only after explicit release gate and verifiable health checks.