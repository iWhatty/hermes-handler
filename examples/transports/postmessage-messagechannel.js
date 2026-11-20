import { HermesHandler } from "hermes-handler";
import { createHermesClient } from "hermes-handler/client";
import {
  postMessageTransport,
  servePostMessage,
} from "hermes-handler/transports/postmessage";

const { port1: serverPort, port2: clientPort } = new MessageChannel();
const hermes = new HermesHandler({ ping: () => "pong" });
const stop = servePostMessage(hermes, serverPort);
const dispatch = createHermesClient(postMessageTransport(clientPort));

console.log(await dispatch({ type: "ping" }));

dispatch.close();
stop();
clientPort.close();
serverPort.close();
