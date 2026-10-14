# CI fix: await server welcome before race commands

Parent commit: `3d2bda1167a056f770f75400d84e2e0b0dd2fbd9`.

## Failure
The PostgreSQL WebSocket CI pass reported the private-room test failing with `timeout waiting matched; got welcome,room_created`. WebSocket transport `open` precedes the asynchronous `store.getUser` call in the server connection handler. The server attaches the command handler only after that query. The test's connect helper returned on open, allowing join/create/quick to be sent before the handler existed. The browser had the same readiness assumption.

## Reproduction and fix
The test-only fixture now delays user loading by 100ms, regardless of database. With the original helper, the private-room test failed deterministically (`timeout waiting room_created; got welcome`). The corrected helper waits for the server's existing `welcome` message. No production database delays, enlarged test timeout, or score/reward rule changes were added.

The browser also awaits welcome, shares one in-flight readiness promise, and only reuses an open socket after server readiness. A bounded 8-second welcome timeout and close/error handling clear pending readiness and permit retry. Stale/malformed messages cannot establish readiness. Existing race protocol messages are unchanged; the server source did not need modification in this follow-up.

Four VM-based browser behavior tests cover transport-open vs welcome, concurrent calls, close-before-welcome/reconnect, timeout and stale messages. The existing integration tests run with the delayed user loading to prevent the race from being masked by a fast SQLite query.

## Actually executed
Node.js 22.23.3:
- Deterministic reproduction before the fix: failed as expected.
- Build and inline script syntax checks: passed.
- Full SQLite suite: **42/42 passed**, no skipped tests.
- Full suite with API/transactions on PostgreSQL 18.4: **43/43 passed**, no skipped tests. WebSocket in that full pass uses SQLite.
- Separate WebSocket suite using PostgreSQL 18.4: **11/11 passed**, no skipped tests.
- git diff --check and bundle verify: passed.

Remote CI for this follow-up has not yet run; local PostgreSQL was 18.4 while CI uses 16. No manual Telegram/mobile QA was performed. Do not merge until the new remote run succeeds.

## Files
- public/index.html
- test/multiplayer.test.js
- test/fixtures/race-storage-delay.cjs
- test/client-security.test.js
- this document

GitHub write access remains unavailable in the assistant environment. The attached follow-up bundle should be fast-forward merged into the user's existing `fix/race-state-validation` branch, then tested and pushed normally (no force push). It fixes readiness only; it does not make client-submitted scores authoritative or resolve the other documented economy risks.
