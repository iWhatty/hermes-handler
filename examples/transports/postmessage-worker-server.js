import { HermesHandler } from "hermes-handler";
import { servePostMessage } from "hermes-handler/transports/postmessage";

const hermes = new HermesHandler({
  "bytes.echo": (message, ctx) => {
    ctx.transfer(message.payload.bytes);
    return { ok: true, result: message.payload };
  },
  "telemetry.record": (message) => {
    console.log(message.payload);
    return { ok: true };
  },
});

// Worker termination releases the listener with the global context.
servePostMessage(hermes, self);
