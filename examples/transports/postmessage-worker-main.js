import { createHermesClient } from "hermes-handler/client";
import { postMessageTransport } from "hermes-handler/transports/postmessage";

const worker = new Worker(new URL("./postmessage-worker-server.js", import.meta.url), {
  type: "module",
});
const transport = postMessageTransport(worker);
const dispatch = createHermesClient({ ...transport, defaultTimeoutMs: 5_000 });

// Fire-and-forget: send directly when no response is needed. The awaited
// request below keeps this example's Worker alive while telemetry is queued.
transport.send({ type: "telemetry.record", payload: { event: "started" } });

const bytes = new ArrayBuffer(1024);
const response = await dispatch({
  type: "bytes.echo",
  payload: { bytes },
  transfer: [bytes],
  timeoutMs: 2_000,
});

if (!response.ok) console.error(response.error, response.info);

// A local abort/timeout stops waiting; it does not cancel work in the Worker.
dispatch.close();
worker.terminate();
