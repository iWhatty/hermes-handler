import {
    HermesHandler,
    createHermesClient as createRootClient,
    getTransferList,
    setTransferList,
    type HermesResponse,
} from "hermes-handler";
import {
    createHermesClient,
    type CreateHermesClientOptions,
    type HermesClientResponse,
    type RoutesOf,
} from "hermes-handler/client";
import { classifySender, createGuard, defineBoundary } from "hermes-handler/guard";
import {
    postMessageTransport,
    servePostMessage,
    type PostMessageTransportOptions,
    type ServePostMessageOptions,
} from "hermes-handler/transports/postmessage";
import {
    chromeRuntimeTransport,
    type ChromeRuntimeTransportOptions,
} from "hermes-handler/transports/chrome-runtime";
import {
    broadcastChannelTransport,
    type BroadcastChannelTransportOptions,
} from "hermes-handler/transports/broadcast-channel";

const transport: CreateHermesClientOptions = {
    send: async () => {},
    subscribe: () => () => {},
};

const rootClient = createRootClient(transport);
const client = createHermesClient(transport);
const router = new HermesHandler({
    ping: () => "pong" as const,
    echo: (msg: { payload: { value: string } }) => msg.payload.value,
});
type AppRoutes = RoutesOf<typeof router>;
const typedRootClient = createRootClient<AppRoutes>(transport);
const typedClient = createHermesClient<AppRoutes>(transport);
const endpoint = /** @type {any} */ ({});
const boundary = defineBoundary("package-contract", ["ping"] as const);
const guardedRouter = new HermesHandler(boundary.pair({ ping: () => "pong" as const }));
guardedRouter.use(createGuard(boundary, (sender) => classifySender(sender, {
    origin: "chrome-extension://test/",
})).middleware);

const postOptions: PostMessageTransportOptions = {};
const serveOptions: ServePostMessageOptions = {};
const chromeOptions: ChromeRuntimeTransportOptions = {};
const broadcastOptions: BroadcastChannelTransportOptions = {};

postMessageTransport(endpoint, postOptions);
servePostMessage(router, endpoint, serveOptions);
chromeRuntimeTransport(chromeOptions);
broadcastChannelTransport("package-contract", broadcastOptions);

const response: HermesResponse<string> = { ok: true, result: "pong" };
const clientResponse: HermesClientResponse<string> = response;
getTransferList(response);
setTransferList(response, []);

void rootClient;
void client;
void clientResponse;

async function checkTypedClients() {
    const rootResponse = await typedRootClient({ type: "ping" });
    if (rootResponse.ok) {
        const result: "pong" | undefined = rootResponse.result;
        void result;
    }

    // Payload presence remains intentionally permissive for compatibility.
    const clientResponse = await typedClient({ type: "echo" });
    if (clientResponse.ok) {
        const result: string | undefined = clientResponse.result;
        void result;
    }
}
void checkTypedClients;
