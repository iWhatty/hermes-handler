# Scope: `hermes-handler/guard`

The guard is in the unpublished 1.2.0 candidate. WebRadar, SpellBolt, and
Helios completed their supported browser pilots. Consumer adoption is a
separate step.

## Candidate verification and browser handoff

The release archive `hermes-handler-1.2.0.tgz` is based on source commit
`e8f21f9` and the README correction in `84b5d2f`. Its SHA-256 is
`23a17b3f34851df9f7a27e89299572c8195dc14ec9cf71b777f77ae87327caec`.
SpellBolt and Helios used this exact archive. WebRadar used the earlier archive
with SHA-256
`656019c162a691a4023867fe29a5401d94eebf6f2cfb27dbaf507b4478c223cc`.
The archives contain the same 32 files. Only `README.md` differs, so WebRadar
exercised the same runtime files and declarations.

### WebRadar

The isolated Chromium pilot at `7cca256` passed six runtime routes across the
page, popup, and diagnostics checks. In the native toolbar popup, the request
sender had no `sender.tab`. A valid explicit tab ID reached the intended console
session for both writes and reads. Requests with missing or malformed IDs
received no response. The harnesses are `webradar-browser-pilot/pilot-browser.mjs`
and `webradar-browser-pilot/native-popup-pilot.mjs` in the pilot artifacts.

### SpellBolt

The production pilot used base `df732170` and isolated commit `8b2303a3`. Its
final run passed all seven cases on Chromium `148.0.7778.96` in the seeded test
slot. Popup settings and page spellcheck requests succeeded. Pre-dispatch
unknown-route, `SENDER_REFUSED`, and `FEATURE_HELD` replies omitted `requestId`.
The sender restriction ran before the feature gate, and the invalid-payload
reply carried `info.code: INVALID_PAYLOAD` and echoed the request ID. The held
stream port disconnected without sending data. The test slot closed with no
Chromium process remaining.

The guard matched the original SpellBolt router on HermesHandler 1.1.1 in
424 refusal cases and 424 dispatch cases offline. The Chromium and Firefox
MV2 and MV3 package checks passed. A focused rerun with scratch Git metadata
passed all 29 tests across the four files with earlier source-discovery
failures. Evidence under `spellbolt-guard-pilot/` includes
`verified-build-receipt.json`, `spellbolt-live-retry.log`,
`spellbolt-guard-parity-release.log`, and `spellbolt-source-checks-recheck.log`.

### Helios

The Lab pilot used local main at `d89556ba` with the guard adapter and temporary
tarball pin. The operator loaded Lab build `a4779327f2e7cf16` in Brave Web Lab
(Chromium 158). The bridge matched the running build and source hash to the
candidate and reported three passes. The browser reported a service-worker
background, an extension-page `GET_PLAN_APPROVAL` request returned `ok: true`,
and the content-script fixture completed its plan on the IANA example-domains
page. The self-test uses temporary tabs in the already-open Web Lab profile.

Offline checks covered the direct `CONTENT_READY` acknowledgement,
`runtime_sender_rejected` details and correlation, the standard unknown-route
reply, and the controlled `runtime_handler_timeout` envelope. The live
self-test covers extension-page messaging and content-script execution. The
Helios Node suite reported 7,845 passes and four existing TODOs. Chromium,
Firefox, and Firefox Lab package checks passed. The pilot artifacts include
`helios-main-candidate-receipt.json`, `helios-web-lab-freshness.json`,
`helios-web-lab-selftest.json`, and `helios-offline-contracts.log`.

### Release approval

The release recheck passed all 316 tests, the source and package-consumer
type checks, lint, documentation links, both example checks, and the package
dry run. An isolated consumer imported all six entry points from the verified
archive and passed the package-consumer type check and a guard dispatch smoke
test. GitHub `main` matched the candidate's upstream base `57b35ed`. The npm
registry listed `1.1.1` as `latest` and had no entry for `1.2.0`.
The final evidence, package, and compatibility reviews found no release
blockers.

A fresh pack contained the same 32 files. The only payload differences were
LF versus CRLF line endings in `dist/guard.js` and
`dist/transports/chrome-runtime.js`. Keep the verified tarball and checksum
together. Recheck GitHub `main` and npm before release, then follow the
[publishing checklist](PUBLISHING.md) with the archive identified above. Get
explicit approval before pushing any commit or publishing that archive.

The local Helios tarball pin is for the pilot. Consumer adoption can use the
registry version once it exists.

## Summary

Add one tree-shakable subpath, `hermes-handler/guard`, with three exports:

| Export | Replaces |
| --- | --- |
| `defineBoundary(label, names, options?)` | SpellBolt `MESSAGE_POLICIES` pairing and `createMessageRouter` start-up checks; WebRadar `isMessageOf` and `assertHandlersCover`; Helios `withHermesHandlerBudgets` |
| `classifySender(sender, options)` | SpellBolt `senderKind`; Helios `isExtensionPageSender`; WebRadar `isPopupSender` |
| `createGuard(boundary, classify, options?)` | SpellBolt `refusal()` and its dispatch wrapper; Helios in-handler sender checks |

It is additive, so it ships as a minor release (1.2.0) under the roadmap's
release boundaries (`docs/ROADMAP.md`, "Release Boundaries"). No existing export
or default changes. Measured cost is 0.6 KB gzip in a content script and
1.0 KB gzip for all three exports.

Recommended adoption order: WebRadar, then Helios, then SpellBolt. SpellBolt
has since completed its Hermes `0.0.3` to `1.1.1` upgrade. See the candidate
verification above for current pilot status.

No `broadcastToTabs` helper. See "Left out".

## Checkout at the time of scoping

The working copy was at `f1eab10` (package version 1.1.0), a detached HEAD four
commits behind `origin/main` at `09e9f7d` (1.1.1, published). The source
differences between the two are comments and three lines in `src/client.js`;
nothing the guard touches. Every file and line reference below is to
`origin/main` at `09e9f7d`. The checkout should be moved to `origin/main`
before any build work starts. I did not move it, because other sessions share
this folder.

## What hermes-handler provides today (verified)

| Claim | Where |
| --- | --- |
| Constructor takes a handler map; entries are a function or `{ handler, timeoutMs }` | `src/HermesHandler.js:133-142`, `:159-173` |
| `register`, `registerMany`, `unregister`, `has`, `types` | `:246`, `:255`, `:263`, `:269`, `:234` |
| Per-handler `timeoutMs` overrides the class default; `0` disables it | `:424` |
| Middleware `use(fn(msg, ctx, next))`, first registered is outermost, may short-circuit by returning an envelope | `:217-223`, `:447-459` |
| Middleware runs for unknown types too (the unknown-type answer is inside the innermost call) | `:418-420` |
| Middleware only sees messages that are objects with a non-empty string `type` | `:357-365` |
| `ctx.sender`, `ctx.tabId` (`sender?.tab?.id`), `ctx.signal`, `ctx.requestId` | `:383-387` |
| `ctx.signal` is aborted when the dispatch ends, including after a timeout | `:479-482` |
| `shouldHandle(msg, sender)` and `ignoreUnknown` gate the runtime listener only; `dispatch()` bypasses them | `:325-341`, `:284` |
| `logger` defaults to `console` | `:166` |
| Timeout error text is `Handler ${type} timed out (${ms} ms)` | `:430` |
| Unknown-type error text is `Unknown msg.type: ${type}` | `:162` |
| Client `.on(type, handler)` for broadcasts | `src/client.js:272` |
| Transports: postMessage (plus `servePostMessage`), chrome-runtime, BroadcastChannel | `src/transports/postmessage.js:55`, `:169`; `chrome-runtime.js:38`; `broadcast-channel.js:29` |
| Canonical error envelope keys are `ok`, `error`, `info`, `requestId`; any other key is moved into `info` and a warning is logged | `src/internal/envelope.js:29`, `:215-227` |

The last row decides the refusal shape. A middleware that returns SpellBolt's
current refusal, `{ ok: false, error, code: 'SENDER_REFUSED' }`, comes out as
`{ ok: false, error, info: { code } }` and writes
`[Hermes] ok:false response contained extra fields` to the console. I confirmed
this by running it. That is why SpellBolt answers refusals outside
hermes-handler today (`messageRegistry.js:145-148`, `:185`).

## Changes to the starting proposal

1. **One object per boundary instead of one registry with
   `allows(type, boundary)`.** WebRadar uses the same wire string in more than
   one boundary (`features:update` is both `TAB.FEATURES_APPLY` and
   `PAGE_BROADCAST.FEATURES_UPDATE`; `console-session:update` is in both too),
   so a lookup keyed by type alone is ambiguous. Separate boundary objects make
   this a non-issue, need no boundary lookup by string key (which Closure
   Compiler's property renaming would break), and let a bundle carry only the
   boundaries it uses.
2. **The guard does not own the name maps.** Extensions keep their frozen
   `{ KEY: 'wire-value' }` objects and pass them in. WebRadar's
   `document_start` early-capture script imports a few names and must not pull
   in the guard; SpellBolt's Closure build needs the values to stay plain
   string literals.
3. **The guard is usable without a `HermesHandler`.** `createGuard` returns
   both a middleware and a plain `check(type, sender)`. WebRadar's background
   worker is a bare `onMessage` chain with non-Hermes replies
   (`fps-devtools-js/src/background.js:76-100`), and SpellBolt checks a port by
   name in `onConnect` (`SpellBolt-ChromeExt/src/background.js:1452`). Neither
   goes through middleware.
4. **Refusals carry the code in `info.code`,** not top-level, for the reason
   above.
5. **Per-message `timeoutMs` belongs in the rule,** and `pair()` turns it into
   hermes-handler's own `{ handler, timeoutMs }` entry. All three extensions
   hand-write this today.
6. **A `gate` hook** keeps feature gating per-extension while preserving
   SpellBolt's refusal order (unknown name, then sender, then release gate).

## Proposed API

```js
import { defineBoundary, classifySender, createGuard } from 'hermes-handler/guard';
```

### `defineBoundary(label, names, options?)`

```ts
type Rule = {
  from?: string | string[];   // sender kinds; default 'any'
  timeoutMs?: number;         // passed to hermes-handler per handler
  port?: boolean;             // a runtime.connect port name, never a handler
  [meta: string]: unknown;    // extension-owned, e.g. feature: 'ai'
};

function defineBoundary(
  label: string,                               // used only in error messages
  names: Record<string, string> | string[],    // wire values
  options?: {
    rules?: Record<string, Rule>;              // keyed by wire value
    trusted?: string;                          // a kind allowed to send everything
  }
): Boundary;

type Boundary = Readonly<{
  label: string;
  types: readonly string[];
  has(type: unknown): boolean;
  owns(msg: unknown): boolean;                 // object whose type is declared here
  rule(type: string): Rule | undefined;        // {} when declared without a rule
  allows(type: string, kind: string | null): boolean;
  pair<H>(handlers: H): Record<string, Function | { handler: Function; timeoutMs: number }>;
}>;
```

Throws at definition when a name is not a non-empty string, when two names in
the boundary share a wire value, or when `rules` is given and does not have
exactly one row per name.

`allows` is false for a `null` kind, always. Otherwise it is true when the kind
is `trusted`, or when `from` is `'any'`, or when `from` lists the kind or its
prefix: `from: 'extension'` accepts `'extension'` and `'extension:popup'`;
`from: 'extension:popup'` accepts only the popup.

`pair(handlers)` throws unless every non-port name has a function, no handler
is undeclared, and no port row has a handler. It returns a map ready for
`new HermesHandler(...)`, with `{ handler, timeoutMs }` where the rule sets a
timeout. The error names every offending type, as WebRadar's does now.

`owns` is the predicate for hermes-handler's `shouldHandle` option.

### `classifySender(sender, options)`

```ts
function classifySender(
  sender: unknown,
  options: {
    origin: string;                  // runtime.getURL(''), must end with '/'
    id?: string;                     // runtime.id; when given, a sender.id must match
    pages?: Record<string, string>;  // { popup: '/popup.html' } -> 'extension:popup'
  }
): 'extension' | `extension:${string}` | 'page' | null;
```

Order, taken from SpellBolt's `senderKind` (`messageRegistry.js:114-119`):

1. Not an object: `null`.
2. `sender.url` starts with `origin`: an extension page. If `id` is given and
   `sender.id` is present and different: `null`. If the path (query and hash
   removed) equals a `pages` entry: `'extension:<name>'`. Otherwise
   `'extension'`.
3. `sender.tab` is set, or `sender.url` is non-empty: `'page'`. The URL
   alternative is what keeps Safari working when it omits `sender.tab`.
4. Otherwise `null`.

The function reads only `url`, `id` and `tab`. It never throws and never logs.

### `createGuard(boundary, classify, options?)`

```ts
function createGuard(
  boundary: Boundary,
  classify: (sender: unknown) => string | null,
  options?: {
    gate?: (rule: Rule, info: { type: string; kind: string; sender: unknown; msg?: unknown })
      => object | null | undefined;    // return a refusal envelope to refuse
  }
): {
  check(type: string, sender: unknown, msg?: unknown): Refusal | null;
  middleware(msg, ctx, next): Promise<unknown>;   // for hermes.use()
};
```

`check` refuses in a fixed order and returns the first refusal: undeclared
type, sender not allowed, then whatever `gate` returns. `middleware` is
`check(msg.type, ctx.sender, msg) ?? next()`.

### Refusal envelope

```js
{ ok: false, error: 'Unknown msg.type: <type>',                    info: { code: 'UNKNOWN_TYPE',   type } }
{ ok: false, error: '<type> is not accepted from this sender.',   info: { code: 'SENDER_REFUSED', type } }
```

Both error strings are the ones in use today (`HermesHandler.js:162`,
SpellBolt `messageRegistry.js:124`). The codes are the stable part; the text
may change. Through the middleware a request's `requestId` is echoed by
hermes-handler as usual, and no warning is logged because `info` is a canonical
key (`envelope.js:93-97`, confirmed by running it). A `gate` refusal is returned
as given, so an extension that calls `check` directly may keep any shape it
likes, including a top-level `code`.

## Worked example: SpellBolt's policy table

`MESSAGE_POLICIES` (`messageRegistry.js:38-103`) is already in the rule shape.
It moves over unchanged, including `feature`, `timeoutMs` and `port: true`.

```js
// messageRegistry.js after migration (about 60 lines shorter)
export const WORKER = defineBoundary('worker', HERMES_MESSAGE.TYPES, {
    rules: MESSAGE_POLICIES,   // { feature, from, timeoutMs?, port? } per wire value
    trusted: 'extension',      // SpellBolt's pages may send every command
});

export function createMessageRouter(handlers, { isReleased, extensionOrigin }) {
    const guard = createGuard(
        WORKER,
        (sender) => classifySender(sender, { origin: extensionOrigin }),
        { gate: (rule) => (rule.feature !== CORE && !isReleased(rule.feature) ? heldFeatureResponse() : null) },
    );
    const hermes = new HermesHandler(WORKER.pair(handlers), { timeoutMs: DEFAULT_TIMEOUT_MS, logger: null });
    return {
        refusal: guard.check,   // background.js:1452 keeps calling refusal(port.name, port.sender)
        dispatch: async (msg, sender) => guard.check(msg?.type, sender) ?? hermes.dispatch(msg, sender),
    };
}
```

Behaviour kept, checked against the prototype:

| Today | After |
| --- | --- |
| `from: 'extension'` refuses a content script | same, `SENDER_REFUSED` |
| `from: 'page'` still accepts SpellBolt's own pages (`senderAllowed`, `:122`) | `trusted: 'extension'` |
| A sender with no url and no tab is refused for every command | `classifySender` returns `null`, `allows` is false |
| Safari sender with a url and no tab counts as a page | same |
| Held feature answers `heldFeatureResponse()` after the sender check | `gate`, same order |
| `port: true` row: no handler allowed, name still checked in `onConnect` | `pair` throws on a handler; `check` works on the port name |
| Start-up throws on a handler without a row or a row without a handler | `defineBoundary` and `pair` throw |
| Per-row `timeoutMs`, default 10 s, `ctx.signal` aborts, text contains "timed out" | hermes-handler per-handler timeout; `runWithTimeout` (`:126-142`) is deleted |

One visible difference: the sender refusal's code moves from top-level `code`
to `info.code`. The held-feature refusal keeps its top-level `code` because
SpellBolt's own function builds it and `dispatch` above bypasses middleware, so
`scripts/store/held-features-check.mjs:354` (reads `a.code`) is unaffected.
`tests/messageRegistry.spec.js:82` reads `response.code` for `SENDER_REFUSED`
and needs a one-line change.

## Worked example: WebRadar's boundary maps

`src/messages.mjs` keeps its six frozen name maps exactly as they are. The
`BOUNDARIES` map, the lazy allowlist cache, `isMessageOf` and
`assertHandlersCover` (`messages.mjs:85-129`) are replaced by boundary objects
in a separate module, so the early-capture bundle that only imports names is
unchanged.

```js
// src/messageBoundaries.mjs
import { defineBoundary } from 'hermes-handler/guard';
import { RUNTIME, TAB, PAGE_REQUEST, PAGE_BROADCAST, PAGE_EVIDENCE, CODE_EXPLORER } from './messages.mjs';

const POPUP = 'extension:popup';

export const RUNTIME_BOUNDARY = /* @__PURE__ */ defineBoundary('RUNTIME', RUNTIME, {
  rules: {
    [RUNTIME.SETTINGS_MUTATE]: { from: [POPUP, 'page'] },
    [RUNTIME.CSS_RULES_MUTATE]: { from: 'page' },
    [RUNTIME.SEO_RESPONSE_HEADERS_GET]: { from: 'any' },
    [RUNTIME.CONSOLE_SESSION_GET]: { from: 'any' },
    [RUNTIME.CONSOLE_SESSION_SET]: { from: 'any' },
    [RUNTIME.OPEN_TAB]: { from: 'page' },
  },
});
export const TAB_BOUNDARY = /* @__PURE__ */ defineBoundary('TAB', TAB);
export const PAGE_REQUEST_BOUNDARY = /* @__PURE__ */ defineBoundary('PAGE_REQUEST', PAGE_REQUEST);
export const PAGE_BROADCAST_BOUNDARY = /* @__PURE__ */ defineBoundary('PAGE_BROADCAST', PAGE_BROADCAST);
export const PAGE_EVIDENCE_BOUNDARY = /* @__PURE__ */ defineBoundary('PAGE_EVIDENCE', PAGE_EVIDENCE);
export const CODE_EXPLORER_BOUNDARY = /* @__PURE__ */ defineBoundary('CODE_EXPLORER', CODE_EXPLORER);
```

```js
// src/contentScript.js:270
const pageHermes = new HermesHandler(PAGE_REQUEST_BOUNDARY.pair({ /* handlers unchanged */ }));

// src/background.js, top of the onMessage listener
const guard = createGuard(RUNTIME_BOUNDARY, (sender) =>
  classifySender(sender, { origin: chrome.runtime.getURL(''), pages: { popup: '/popup.html' } }));
```

The `from` values for `SETTINGS_MUTATE` come from `settingsStore.mjs:26-28`
(popup or page tab). The other five rows are my reading of the callers and are
placeholders: assigning them is the WebRadar owner's call and part of the
migration, not this scope.

`TAB_BOUNDARY.has('features:update')` and
`PAGE_BROADCAST_BOUNDARY.has('features:update')` are both true and independent,
which is the shared-wire-string case. All five boundaries that WebRadar uses
through `isMessageOf` today map to `has()` or `owns()`.

What does not move: `pageUrl()` in `settingsStore.mjs:16-21` checks for an
integer tab id and an http, https, file or ftp protocol and returns the parsed
URL for the store to use. That is stricter than the `'page'` kind and stays in
WebRadar. `isPopupSender` (`:9-15`) is replaced by the `'extension:popup'`
kind. The background's reply shapes (`{ value }`, `{ evidence }`, `{ session }`)
are a wire contract with already-injected content scripts and are not touched;
`guard.check` is called first and the listener decides how to answer a refusal.

## What stays per-extension

- Message names and wire values, as plain frozen string maps.
- Which boundary a message belongs to and who may send it (`from`).
- Extension page paths (`pages`) and whether own pages are `trusted`.
- Payload validation. The guard never reads `msg.payload`.
- Feature and release gating, through `gate`. The guard knows nothing about
  release features.
- The refusal shape for gate refusals, and how a non-Hermes listener answers.
- Default timeout value and any extension-specific timeout envelope (Helios's
  `runtime_handler_timeout`).
- Tests that scan the extension's own source, such as WebRadar's rule that no
  file in `src/` spells a message name as a literal (`test/messages.test.mjs:59`).
- Tab-level checks stricter than the sender kind (WebRadar's `pageUrl`).

## Constraints

**Bundle cost, measured.** The shipped `src/guard.js`, as reported by
`test/guard.size.test.js` (esbuild, bundle, minify, iife, gzip level 9,
baseline subtracted):

| Bundle imports | Minified | Gzip |
| --- | --- | --- |
| `defineBoundary` only (a content script) | 1,529 B | 734 B |
| all three exports (a background worker) | 2,488 B | 1,214 B |

The scoping prototype measured 633 B and 997 B gzip; input validation and
fuller error messages account for the difference.

For scale, `HermesHandler` alone is 6,002 B minified and 2,194 B gzip. The
final file will differ a little from the prototype; the build should fail a
size test above 1,300 B gzip for the full subpath. WebRadar's content script
also drops about 30 lines of `messages.mjs` it carries today, so its net change
is smaller than the first row.

**No logging or telemetry.** The guard takes no logger and writes nothing. The
refusal shape was chosen so it does not trigger hermes-handler's "extra fields"
warning. Separately, `HermesHandler` still defaults `logger` to `console`
(`HermesHandler.js:166`) and logs handler errors and timeouts
(`:438`); changing that default is a major-version change under the roadmap and
is out of scope. The migration notes pass `logger: null` in release builds.

**Closure Compiler.** The original scope considered a Closure-based SpellBolt
build. The pilot verified the current esbuild/Terser release build. The guard
uses computed wire values as rule keys and reads rule fields such as `from`,
`timeoutMs`, and `port` as unquoted properties. If a future build uses Closure
ADVANCED optimisation, compile the guard and rule tables together or supply
an externs file for those fields.

**Safari sender shape.** Covered by step 3 of `classifySender`, and by a test
with a sender that has a url and no tab.

**Runtime dependencies.** None, per `AGENTS.md`. The guard does not import
`HermesHandler`; it only produces values `HermesHandler` accepts.

## Left out

- **`broadcastToTabs`.** No extension needs it. SpellBolt records that it has
  no broadcast messages and syncs through `storage.onChanged`
  (`messageProtocol.js:6-7`); WebRadar moved settings to `storage.onChanged`
  in `b1542ac`; Helios's `tabs.query` calls are for browser actions and
  self-tests, not fan-out. Add it only when a second extension asks.
- **Name-map construction** (a `defineMessages` that returns names). See change
  2 above.
- **Payload validation hooks.** Already listed as a separate roadmap idea.
- **A shared source-scan test helper.** Useful, but it is test tooling, not
  part of the runtime package.
- **Cerberus and WebX.** Cerberus has five bare message constants
  (`CerberusShield-js/src/utils/messageTypes.js`) and no hermes-handler; WebX
  has no messaging. Neither gains from adopting now.

## Versioning and migration

Ship as hermes-handler **1.2.0**: a new `./guard` entry in `package.json`
`exports`, JSDoc-generated declarations like the other entries, a CHANGELOG
entry, and a README section.

### WebRadar (`^1.0.3`), first

Smallest step and already closest in shape. Bump to `^1.2.0`, add
`messageBoundaries.mjs`, replace `assertHandlersCover` and `isMessageOf` call
sites, replace `isPopupSender`, add `guard.check` to the background listener
with a real `from` table. Moving 1.0.3 to 1.2.0 also brings 1.1.1's client
change: dispatches pending at `close()` now resolve at once with a closed-client
error. `test/messages.test.mjs` keeps its frozen-values, wire-values and
source-scan tests; its `isMessageOf` and `assertHandlersCover` tests move to the
package.

### Helios (`^1.0.3`), second

- `isExtensionPageSender` (`extensionPageSender.js:5-9`) becomes
  `classifySender(sender, { origin, id })` and the five in-handler checks in
  `planMessageHandlers.js`, `answerMessageHandlers.js` and `selftestBridge.js`
  become `from: 'extension'` rules plus `hermes.use(guard.middleware)`.
- `withHermesHandlerBudgets` (`runtimeHandlerTimeouts.js`) is replaced by
  `timeoutMs` in the rules and `pair()`. Helios's own inner timeout, its
  `runtime_handler_timeout` envelope and the timeout report stay, reading
  `boundary.rule(type).timeoutMs`.
- `RuntimeMessages` is one flat map served by five routers (background,
  content, popup, cockpit, logs). Each router needs its own boundary built from
  a subset of names. Deciding those subsets is the real work here.
- The dev bridge calls a handler function directly
  (`src/background.js:46`), so it never passes through the guard. That matches
  today's behaviour and should stay a deliberate, documented exception.
- Helios wraps handlers with its own middleware helper
  (`runtimeMessageMiddleware.js`) that predates its use of `hermes.use`. It can
  stay; folding it into `hermes.use` is optional and separate.

### SpellBolt, last

SpellBolt now depends on `^1.1.1`. The prior `0.0.3` upgrade was a prerequisite
because the guard ships in 1.2.0 and `pair()` emits `{ handler, timeoutMs }`
entries that 0.0.3 rejects.

What the upgrade involves, from running the installed 0.0.3 and 1.1.1 side by
side on thirteen handler return shapes:

| Handler returns | 0.0.3 | 1.1.1 |
| --- | --- | --- |
| request has a top-level `requestId` | not echoed | echoed on every response |
| `{ ok: true, a: 1 }` (no `result`) | `{ ok: true, info: { a: 1 } }` | `{ ok: true, result: { a: 1 } }` |
| `{ ok: false, error, info: X }` | `info: { handlerInfo: X }` | `info: X` |
| `{ ok: true, result, info: X }` | `info: { handlerInfo: X }` | `info: X` |
| value, `undefined`, `{ ok, result }`, `{ ok: false, error }`, extra keys on an error | same | same |

So the audit is: every worker handler that returns `ok: true` without
`result`, every handler that sets `info`, and every caller that reads
`info.handlerInfo`. Responses are frozen in both versions and the unknown-type
and timeout texts are the same. SpellBolt sends with the raw runtime API, so
the client and transports are optional for it. The registry migration itself is
then the worked example above.

SpellBolt is last because it has the most handlers (54 rows), a release gate
that store checks depend on, and a Closure build to verify.

## Test plan

Vitest, one new file `test/guard.test.js`, importing from `../src/guard.js`,
in the existing style (`describe`/`it`, `it.each` tables, real `HermesHandler`
instances, no mocks beyond plain sender objects). Type cases are added to
`test/types.test-d.ts`, and `scripts/check-package-exports.mjs` gains an import
of `hermes-handler/guard` so the built entry is exercised.

`defineBoundary`

- accepts a name map and an array; `types` is frozen; the boundary is frozen
- throws on duplicate wire values, empty or non-string names
- throws when rules and names differ, naming both directions (SpellBolt:
  "gives every message name a ... policy, and nothing else")
- `has` is true only for declared names, false for non-strings (WebRadar:
  "isMessageOf accepts only names declared for that boundary")
- two boundaries sharing a wire value stay independent
- `owns` rejects non-objects and undeclared types, and works as `shouldHandle`
- `pair` throws on a missing handler, an undeclared handler, and a handler for
  a port row; returns the handlers otherwise (WebRadar: "pairs handlers with
  the registry in both directions"; SpellBolt: "will not start with a handler
  missing, or one the table does not know")
- `pair` emits `{ handler, timeoutMs }` only where the rule sets a timeout,
  including `timeoutMs: 0`

`classifySender`

- extension page versus content script by URL (SpellBolt: "tells SpellBolt's
  pages from content scripts by URL")
- named pages, with query and hash ignored; an unlisted extension page is
  plain `'extension'`
- sender with a url and no tab is `'page'` (Safari)
- `null`, non-object, and `{}` are `null`
- a mismatched `sender.id` is `null`; a missing `sender.id` is accepted
  (Helios)
- an origin that is a prefix of another extension's id does not match

`createGuard` with a real `HermesHandler`

- table test: each name from a page and from an extension page is accepted or
  refused as declared (SpellBolt: "accepts or refuses each name ... as
  declared")
- refuses a sender that is neither, an unknown name, and a gated message, in
  that order (SpellBolt: "refuses a sender that is neither, an unknown name and
  a held feature")
- `trusted` lets an extension page send a `from: 'page'` message
- `from: 'extension:popup'` refuses other extension pages
- the handler still receives the runtime sender on `ctx.sender`
- a refusal through `use()` keeps `info.code`, echoes `requestId`, and produces
  no logger call (spy logger)
- a refused message never reaches the handler or later middleware
- `check` on a port row returns `null` or the refusal without a handler
- a handler times out at its rule's limit and `ctx.signal` is aborted
  (SpellBolt: "times a handler out at its own limit and aborts ctx.signal")
- a `gate` that throws becomes an error envelope through middleware

Size: a test that bundles the subpath and fails above the agreed gzip limit,
if the owner wants esbuild as a dev dependency (open question 6).

## Effort

| Piece | Size |
| --- | --- |
| `src/guard.js` with JSDoc types (about 110 lines) | S |
| `test/guard.test.js`, type tests, export check | M |
| `package.json` exports, README section, CHANGELOG | S |
| WebRadar migration | S |
| Helios migration (boundary subsets are the work) | M |
| SpellBolt upgrade 0.0.3 to 1.x (handler audit, full local gates) | M to L |
| SpellBolt registry migration after the upgrade | S |
| Closure ADVANCED verification in SpellBolt | S |

## Decisions for the owner

1. **Approve the API shape:** per-boundary objects, extension-owned name maps,
   and `createGuard` returning both `check` and `middleware`, in place of the
   starting proposal's single `defineMessages` registry.
2. **Refusal code location:** `info.code` (recommended; it is the only shape
   that passes through hermes-handler middleware without a rewrite and a
   console warning). The alternative is to add `code` as a canonical envelope
   key, which the roadmap classes as a wire-envelope change and therefore a
   major version.
3. **Default for `trusted`:** off, so an extension page must be listed in
   `from` unless the extension opts in (recommended). SpellBolt opts in with
   one line.
4. **Version:** 1.2.0, and whether the unreleased client fix already on `main`
   ships with it.
5. **Adoption order:** WebRadar, Helios, SpellBolt.
6. **Size gate:** add esbuild as a dev dependency to enforce the size limit in
   the package's tests, or measure by hand at release.
7. **Logger default:** leave `logger = console` as is and have extensions pass
   `logger: null` (recommended for now), or schedule a default change for 2.0.
8. **WebRadar's stricter page check:** keep `pageUrl()` in WebRadar
   (recommended), or add a `pageProtocols` option to `classifySender`.

## Open questions from the original scope

- Which callers actually send WebRadar's five `RUNTIME` messages other than
  `SETTINGS_MUTATE`? The `from` rows above are placeholders.
- How should Helios split `RuntimeMessages` across its five routers, and should
  the dev bridge's direct handler call get an explicit rule rather than a
  bypass?
- Does any SpellBolt handler return `ok: true` without `result`, or read
  `info.handlerInfo`? Not audited in this scope; it decides whether the 0.0.3
  upgrade is M or L.
