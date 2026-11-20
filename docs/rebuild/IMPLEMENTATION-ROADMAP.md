# Implementation Roadmap — Hybrid Mining Adventure Rebuild

## Chosen direction
Rebuild the mining world/runtime and preserve verified backend systems. First release priority is one complete Stone Mine vertical slice. No merge or deployment is authorized by this roadmap; each phase requires review.

## Phase 0 — Baseline, stabilization and design
1. Record exact main SHA, open PRs, branch bases, diffs and overlap.
2. Capture CI runs and exact failed job/step/log for main and every candidate PR.
3. Do not merge or close existing PRs. Resolve conflicts and ownership before any code work.
4. Establish reproducible local baseline: install, build, full test, focused browser tests, DB smoke, dependency audit.
5. Map current modules and dependencies; distinguish real gameplay from decorative presentation.
6. Write and review the five companion design/spec documents.
7. Decide whether to extend the current platform runtime or run a bounded renderer proof-of-concept. No engine migration before evidence.
8. Produce a baseline report with blockers, risk register and proposed first implementation PRs.

Exit criteria: exact baseline SHA; all known failures classified; tests reproducible or environment blockers documented; no unexplained CI regression; documents reviewed; no deployment.

## Phase 1 — Stone Mine runtime foundation
- Create world-coordinate map data, camera, collision geometry, fixed-step simulation and input router.
- Reuse shared movement primitives where deterministic parity tests prove safe.
- Add a single world scene without changing old game modes.
- Validate reachability and mobile input.
Exit: movement/camera/collision tests pass on all target viewports.

## Phase 2 — Complete mining loop
- Add deposits, tool interaction, inventory capacity and server-validated mining actions.
- Add one worker assignment with pathing and persisted task.
- Add drill/conveyor/cargo/warehouse pipeline with durable transfers.
- Add one mission and one scripted repair/rescue event.
Exit: end-to-end vertical slice passes reload, restart, replay and account isolation tests.

## Phase 3 — Production management
- Expand machine states, energy, durability, spare parts, workshop recipes and crew panel.
- Add robot roles only after worker scheduler is stable.
- Add control room and warehouse UI bound to authoritative APIs.
Exit: every control action changes real state and produces audit evidence.

## Phase 4 — Adventure expansion
- Physical passenger lift and rideable cart.
- Additional routes, secret chambers, hazards, rescue and repair chains.
- Account-scoped checkpoint and mission/event progression.
Exit: route and event state persists and is validated on server.

## Phase 5 — Biome/content rollout
- Iron, Gold, Crystal, Lava, Legendary zones with unique geometry, resource and event.
- Each zone meets the same acceptance template.
Exit: six zones are genuinely playable, not recolored backgrounds.

## Phase 6 — UI and art production
- Implement the nine reference screens from real system data/actions.
- Asset pipeline, animation, audio, localization, reduced motion and mobile polish.
Exit: visual reference parity plus functional acceptance.

## Phase 7 — Release
- Full CI exact SHA; security/performance review; backup and rollback plan.
- Explicit release approval, then staged deployment and health verification.
- Telegram real-device acceptance.
Exit: verified deployed version and release report.

## Work rules
- One cohesive PR at a time; avoid parallel PRs touching the same core files.
- Preserve main; no force push; no permission/workflow/secret changes.
- Never weaken/delete an assertion to make CI green.
- No merge until exact-head CI is green and user review gate is satisfied.
- No deployment until explicit release approval.
