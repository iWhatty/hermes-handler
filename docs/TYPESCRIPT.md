# TypeScript

HermesHandler ships declarations for its public package entry points. The most precise generic API currently lives on the root `hermes-handler` entry.

## Infer routes from handlers

Keep the handler map as a named value, then derive its route table with `Routes`:

```ts
import {
  HermesHandler,
  createHermesClient,
  type ClientOf,
  type HermesClientTransport,
  type Routes,
} from "hermes-handler";

const handlers = {
  ping: (): "pong" => "pong",
  echo: (msg: { payload: { value: string } }) => ({ value: msg.payload.value }),
};

const hermes = new HermesHandler(handlers);
type AppRoutes = Routes<typeof handlers>;
type AppClient = ClientOf<typeof hermes>;

const transport: HermesClientTransport = {
  send: (message, transfer) => {
    void message;
    void transfer;
  },
  subscribe: (receive) => {
    void receive;
    return () => {};
  },
};

const client: AppClient = createHermesClient<AppRoutes>(transport);
```

`Routes<typeof handlers>` is the route table accepted by the generic root client factory. `ClientOf<typeof hermes>` is the corresponding callable client type; it is useful as an annotation, but it is not the generic argument to `createHermesClient`.

## Narrow responses with `ok`

Every typed dispatch resolves to a `HermesResponse<T>` discriminated union. Check `ok` before reading branch-specific fields:

```ts
const response = await client({
  type: "echo",
  payload: { value: "hello" },
});

if (response.ok) {
  response.result?.value;
} else {
  console.error(response.error, response.info);
}
```

`result` remains optional because the public success envelope permits successful responses without a result.

## Current payload behavior

Route names and supplied payload shapes are checked. Payload presence is intentionally permissive today: `payload` is optional in the existing message and client request declarations, even for a handler whose message parameter contains a required payload.

```ts
await client({ type: "echo" }); // currently accepted

await client({
  type: "echo",
  // @ts-expect-error value must be a string when payload is supplied
  payload: { value: 42 },
});
```

Applications that require payload presence should validate it at their boundary or in the handler. Do not rely on the current type declarations to enforce presence.

## Root entry and client subpath

The root entry and size-focused `hermes-handler/client` subpath expose the same generic `createHermesClient` API. The client subpath advertises only client runtime values, plus client-focused types:

```ts
import { type RoutesOf } from "hermes-handler";
import { createHermesClient } from "hermes-handler/client";

type AppRoutes = RoutesOf<typeof hermes>;
const client = createHermesClient<AppRoutes>(transport);
```

See [`examples/typescript`](../examples/typescript/) for a compile-checked version of the recommended pattern.
