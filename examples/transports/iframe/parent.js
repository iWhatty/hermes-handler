import { createHermesClient } from "hermes-handler/client";

const CHILD_ORIGIN = "https://child.example";
const CHANNEL = "hermes-iframe-example";

function crossWindowClientTransport(localWindow, remoteWindow) {
  return {
    send(message) {
      remoteWindow.postMessage({ ...message, channel: CHANNEL }, CHILD_ORIGIN);
    },
    subscribe(handler) {
      const listener = (event) => {
        if (event.origin !== CHILD_ORIGIN || event.source !== remoteWindow) return;
        const data = event.data;
        if (!data || typeof data !== "object" || data.channel !== CHANNEL) return;

        const wire = { ...data };
        delete wire.channel;
        handler(wire);
      };

      localWindow.addEventListener("message", listener);
      return () => localWindow.removeEventListener("message", listener);
    },
  };
}

const iframe = document.querySelector("#tool-frame");
if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) {
  throw new Error("Expected a loaded #tool-frame iframe");
}

const dispatch = createHermesClient(
  crossWindowClientTransport(window, iframe.contentWindow),
);

const response = await dispatch({
  type: "profile.read",
  payload: { userId: "user-123" },
  timeoutMs: 5_000,
});

if (response.ok) console.log(response.result);
else console.error(response.error, response.info);

// close() removes the local message listener and settles pending requests.
window.addEventListener("pagehide", () => dispatch.close(), { once: true });
