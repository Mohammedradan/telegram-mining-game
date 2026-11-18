# World Progression — Mining Adventure

## First release scope
Only Stone Mine is content-complete for the first playable slice. Other zones remain locked or legacy until their gameplay systems are migrated and tested.

## Stone Mine map grammar
A connected world with:
- safe entrance/checkpoint and return route;
- upper gallery and lower work floor;
- at least one climbable ladder and one physically constrained vertical transition;
- one mineable stone/ore deposit;
- one worker station and a visible worker route;
- drill worksite, conveyor segment, cart loading/unloading point and warehouse;
- one maintenance interaction;
- one event location and one optional discovery;
- explicit collision, hazard and interaction geometry.

The first map should be large enough for a following camera to matter, but small enough to test the entire loop quickly. Coordinates and geometry live in data, not CSS offsets.

## Mission sequence
1. Safety briefing: reach the worksite.
2. Prospect: inspect the deposit.
3. Extract: mine a specified deposit using player action.
4. Crew: assign one worker to a task and observe arrival/work.
5. Mechanize: activate the drill and conveyor with valid prerequisites.
6. Transport: load a defined quantity into a cart/container and deliver it.
7. Store: warehouse accepts cargo subject to capacity.
8. Incident: repair one disabled machine OR rescue one trapped worker; do not introduce both until the first is stable.
9. Report: server validates the objective and persists completion.
10. Return: reload and verify checkpoint, inventory and mission state.

## Later zone progression
- Iron Mine: heavier machinery, metal ore, first machine upgrade and spare-parts dependency.
- Gold Mine: higher value deposits, energy budgeting and worker scheduling trade-offs.
- Crystal Mine: navigation puzzle, robot scouting and hidden chambers.
- Lava Mine: heat/steam hazards, emergency shutdown and rescue/repair chain.
- Legendary Mine: endgame route combining logistics, hazards, multi-worker coordination and boss/guardian encounter.
Unlock requirements must be server-owned and tied to completed milestones, not localStorage flags.

## Vertical traversal
A ladder, lift or cart is a physical world object with collision, boarding/call state, movement, destination constraints and persisted checkpoint behavior. A visual animation that changes a floor label is not sufficient. Passenger lift and rideable cart are later slices after Stone Mine baseline.

## World events
Each event definition specifies trigger, affected entities/geometry, warning, player/crew response, resolution, failure consequence, cooldown and persisted outcome. Start with deterministic scripted events for reliable tests. Randomized scheduling is deferred.

## Secrets and discoveries
Discovery requires proximity and a real interaction or puzzle. Discovery state is account-scoped and server-validated. No client-only stash may grant currency or progression.

## Save points
Checkpoint is committed only after server acknowledgement. A safe return location is maintained separately from transient predicted movement. On reconnect, restore last acknowledged state and explain any uncommitted movement loss.

## Content acceptance
Every new zone must ship with a map data file, collision test, route reachability test, mobile viewport test, mission progression test, server persistence test, asset audit and a short recorded playthrough.