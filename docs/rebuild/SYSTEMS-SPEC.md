# Systems Specification — Crew, Machines, Logistics and Economy

## Resource taxonomy
- Raw materials: stone, iron ore, gold ore, crystal and rare ore.
- Processed materials: only defined by recipes.
- Currency: existing game currency; no new currency for the first slice.
- Operations: energy, durability and spare parts.
Every quantity has a defined unit, owner, source, sink and ledger event. No display-only resource counters.

## Worker lifecycle
States: idle, assigned, walking, working, blocked, injured/trapped, returning, unavailable.
Assignment validates worker ownership, skill, task requirements, zone unlock, reachability and required equipment. The simulation moves the worker along a navigable path; server resolves task progress. If no path exists, the task is rejected or marked blocked, not silently completed.
Initial roles: miner, hauler, mechanic, safety/rescue. Begin with one worker and one task type in the vertical slice.

## Robot lifecycle
States: idle, assigned, moving, working, charging, maintenance, blocked.
Properties: type, battery, durability, level, operating radius and task. A robot may not produce resources outside its allowed job or while blocked/depleted. Initial slice may defer robots until worker dispatch and logistics are stable.

## Machine contract
Every machine defines:
- stable ID, type, zone and world location;
- prerequisites, level, input inventory and output inventory;
- energy rate, work rate, capacity and durability;
- on/off/working/blocked/broken/maintenance states;
- start/stop/repair commands with idempotency keys;
- authoritative server update timestamp and version.
Drill extracts from a valid deposit. Conveyor moves only cargo present at its input. Cart carries bounded cargo along a traversable route. Processor converts only valid recipes. Warehouse enforces capacity. Shipping consumes inventory before issuing existing currency.

## Production pipeline
Deposit -> drill/player extraction -> input buffer -> conveyor -> cart/transfer -> processor (optional first slice) -> warehouse -> sale/shipment.
Each transfer is atomic or represented by a durable in-transit job so reload/crash cannot duplicate or lose cargo. Backpressure propagates when buffers or warehouse are full.

## Maintenance and repair
Machine failure has cause, severity, required parts, repair duration/work, assigned mechanic and resolution. Stop unsafe production when appropriate. Repair consumes parts once, changes machine state, and is recorded. First slice uses one scripted fault with no random damage.

## Warehouse and shipping
Inventory is server-owned, capacity-limited and separated by material. Incoming shipments reserve capacity; unload completes only once. The UI shows available, reserved and in-transit quantities. A full warehouse stops/re-routes upstream jobs safely.

## Energy
Energy source and capacity are explicit. Machines draw energy only while active. Insufficient energy blocks eligible machines and emits a visible reason. Avoid passive UI counters disconnected from machine state.

## Economy invariants
- Client cannot set balances, ore, production time, worker progress or mission rewards.
- Server derives outputs from validated state, elapsed server time and configured rates.
- Claims and transfers are idempotent.
- Resource and currency mutations share a transaction with ledger writes.
- Duplicate requests, replay, stale version and cross-account access are tested.
- Existing caps, offline earnings and race rewards remain unchanged unless separately reviewed and approved.

## First slice scope
Implement one worker assignment, one drill, one conveyor, one cargo transfer/delivery and one warehouse. Robot fleet, full crafting tree, multiple recipes and automated market are deferred.

## UI bindings
Control room reads server snapshots and sends commands. Worker/robot cards show authoritative status and reason. Machine buttons show pending/acknowledged/error states. Warehouse panel reads inventory/capacity. No button should optimistically claim success before server acknowledgement.