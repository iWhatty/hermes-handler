# Roadmap

HermesHandler works well as a browser-extension runtime message router today. The next useful step is to keep that use case excellent while naming the more general primitive underneath: a small message dispatch contract for JavaScript runtimes.

## Near-Term Hardening

- Keep listener ownership controls focused: `ignoreUnknown` for common multi-listener extension pages, `shouldHandle` for scoped ownership rules.
- Add more tests around callback-style `sendResponse`, thrown `shouldHandle` predicates, and malformed messages.
- Keep direct `dispatch()` behavior deterministic for tests, non-extension runtimes, and adapters.
- Add type-level examples once the public option surface settles.

## General JavaScript Direction

HermesHandler does not need to be Chrome-extension-only. The current core already works as a framework-agnostic router when callers use `dispatch()`.

Useful adapter targets:

- Browser extension runtime listeners.
- Web worker and service worker message events.
- Node event emitters or lightweight RPC channels.
- Test harnesses and agent tool buses.

The core should stay transport-agnostic. Transport-specific helpers should be thin adapters around the same message envelope and handler map.

## API Ideas

- `createRuntimeListener(hermes, options)` if browser-specific behavior grows beyond `getListener()`.
- `createMessageEventListener(hermes)` for worker-style `postMessage` flows.
- Optional request validation hooks before dispatch.
- Optional error classification helpers for richer `info` metadata.
- A small TypeScript generic story for typed handler maps and typed `dispatch()`.

## Non-Goals

- No runtime dependencies for the core package.
- No framework-specific assumptions.
- No silent changes to the response envelope.
- No automatic npm publishing from routine development commits.

