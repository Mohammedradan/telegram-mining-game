# Mining Clicker Empire — Game Design Document

Status: approved target design; implementation not implied.
Reference: user-provided 3x3 screen concepts (control room, repair, rescue, robots, workshop, warehouse, hazards, discovery gate, mine overview). These are visual/functional references, not proof of existing features.

## Product vision
A persistent 2D mining-adventure and mine-management game inside the existing Telegram Mini App and browser app. The player directly controls a miner in a connected world, explores and mines, assigns crew and robots, operates machines, transports ore, repairs failures, rescues workers, discovers routes, and grows a functioning mine.

## First playable vertical slice
One Stone Mine, end-to-end:
1. Enter at a safe checkpoint.
2. Walk/run/jump/climb with keyboard or touch; camera follows the miner.
3. Mine a reachable rock vein and receive server-validated ore.
4. Assign one worker to a specific mining/hauling task; observe the worker travel and work.
5. Start a drill and conveyor; machines have visible states and real inputs/outputs.
6. Load ore into a rideable cart or a clearly defined transport container.
7. Deliver ore to a warehouse; warehouse inventory and capacity update.
8. Complete one objective, claim a server-validated result, leave and return.
9. Restore the last acknowledged checkpoint and all authoritative progression.

The slice is not complete if any step is merely decorative, client-only, or simulated by changing labels.

## Core player loop
Explore -> identify deposit/objective -> mine -> collect -> assign/operate -> transport -> process/store -> resolve risk/repair -> complete objective -> upgrade/unlock -> explore further.

## Player and controls
- States: idle, walk, run, jump, fall, climb, mine, interact, ride, hurt/rescue.
- Controls must work with keyboard and touch; no control may be trapped beneath overlays.
- Movement uses one authoritative ruleset shared with browser tests and server replay where appropriate.
- Camera follows the player in world coordinates and clamps to map bounds.
- Collision geometry, ladders, ledges, hazards, doors and interactive ranges are explicit world objects.

## World structure
- Initial zone: Stone Mine. It must be fun and complete before scaling content.
- Later biomes: Iron, Gold, Crystal, Lava, Legendary. Their unlocks and art must not be mistaken for implemented gameplay until each has acceptance evidence.
- Each zone contains connected horizontal/vertical routes, work sites, safe checkpoint, resources, hazards, interactables, optional discovery and mission objectives.
- Avoid fixed viewport-only scenery as the final world model.

## Resources and production
Separate raw ore, processed goods, currency, energy and spare parts. Each resource has an authoritative owner, capacity, source, sink and ledger event. No client-provided amount is trusted.

## Crew and robots
Workers have role, level, location, task, status, movement/assignment state and applicable operating cost. Roles initially: miner, hauler, mechanic, safety/rescue. Robots have explicit type, battery, durability, task and work radius. Assignment must result in observable world behavior and server-owned state transitions.

## Machines and logistics
Drill extracts; conveyor transports; cart carries; processor converts; warehouse stores; shipping/sale converts only permitted goods to currency. Every stage has input/output, rate, capacity, energy, durability, operating state and failure modes. Blocked downstream capacity must stop or buffer upstream production safely.

## Missions and events
First slice: one mining/delivery objective and one repair or rescue event. Events have preconditions, world effects, resolution actions, rewards, timeout/failure behavior and persisted state. Randomness must be reproducible or server-authoritative.

## Visual direction
Use supplied images as visual references: polished colorful 2.5D cartoon game art, deep blue UI frames, vivid cyan/blue crystal lighting, warm orange lamps, gold/yellow accents, readable Arabic RTL controls, consistent miner/worker/robot silhouettes. Keep gameplay area visible; art cannot obscure hit targets or movement.

## UX principles
- Phone-first; no page-level scroll during active play.
- 44px minimum touch targets where practical.
- HUD remains compact; panels open one at a time and do not steal movement input.
- Pause/resume, audio, accessibility/reduced motion, safe-area insets and landscape layout are tested.
- All screen concepts are built only after the underlying system exposes real state and actions.

## Non-goals for first slice
No multiplayer economy, paid monetization redesign, six-zone content rollout, elaborate crafting tree, or new reward currency until the single-zone loop is proven fun, secure and persistent.

## Definition of fun/quality
A tester can understand the objective without instruction, move fluidly, make meaningful choices about a worker or machine, see the consequences in the world, and return after reload to the same acknowledged progress.