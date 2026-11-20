import { HermesHandler } from "hermes-handler";
import { createHermesClient } from "hermes-handler/client";
import { broadcastChannelTransport } from "hermes-handler/transports/broadcast-channel";

const responderTransport = broadcastChannelTransport("hermes-example");
const hermes = new HermesHandler({ ping: () => "pong" });

// Elect one responder. Multiple peers replying to the same request can race.
const stopResponder = responderTransport.subscribe(async (message) => {
  if (!message || typeof message !== "object" || "ok" in message) return;
  const response = await hermes.dispatch(message);
  if (message.requestId !== undefined) responderTransport.send(response);
});

const clientTransport = broadcastChannelTransport("hermes-example");
const dispatch = createHermesClient(clientTransport);
console.log(await dispatch({ type: "ping" }));

dispatch.close();
stopResponder();
clientTransport.channel.close();
responderTransport.channel.close();
