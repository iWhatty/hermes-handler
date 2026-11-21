import { HermesHandler } from "hermes-handler";

const PARENT_ORIGIN = "https://parent.example";
const CHANNEL = "hermes-iframe-example";

const hermes = new HermesHandler({
  "profile.read": async (message) => ({
    id: message.payload.userId,
    displayName: "Example User",
  }),
});

const listener = async (event) => {
  if (event.origin !== PARENT_ORIGIN || event.source !== window.parent) return;
  const data = event.data;
  if (!data || typeof data !== "object" || data.channel !== CHANNEL) return;
  if ("ok" in data || typeof data.type !== "string") return;

  const request = { ...data };
  delete request.channel;
  const response = await hermes.dispatch(request, { event });

  // No requestId means the sender deliberately chose fire-and-forget.
  if (request.requestId === undefined) return;
  window.parent.postMessage({ ...response, channel: CHANNEL }, PARENT_ORIGIN);
};

window.addEventListener("message", listener);
window.addEventListener(
  "pagehide",
  () => window.removeEventListener("message", listener),
  { once: true },
);
