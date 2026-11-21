import * as root from "hermes-handler";
import * as client from "hermes-handler/client";
import * as postmessage from "hermes-handler/transports/postmessage";
import * as chromeRuntime from "hermes-handler/transports/chrome-runtime";
import * as broadcastChannel from "hermes-handler/transports/broadcast-channel";

const contracts = [
    ["hermes-handler", root, [
        "HermesHandler",
        "createHermesClient",
        "getTransferList",
        "setTransferList",
    ]],
    ["hermes-handler/client", client, ["createHermesClient"]],
    ["hermes-handler/transports/postmessage", postmessage, [
        "postMessageTransport",
        "servePostMessage",
    ]],
    ["hermes-handler/transports/chrome-runtime", chromeRuntime, [
        "chromeRuntimeTransport",
    ]],
    ["hermes-handler/transports/broadcast-channel", broadcastChannel, [
        "broadcastChannelTransport",
    ]],
];

for (const [specifier, entry, required] of contracts) {
    for (const name of required) {
        if (typeof entry[name] !== "function") {
            throw new Error(`${specifier} must export ${name} as a function.`);
        }
    }
}

if (root.createHermesClient !== client.createHermesClient) {
    throw new Error("Root and client subpath must export the same createHermesClient.");
}
