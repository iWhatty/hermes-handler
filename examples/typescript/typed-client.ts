import {
    HermesHandler,
    createHermesClient,
    type ClientOf,
    type HermesClientTransport,
    type HermesResponse,
    type Routes,
} from "hermes-handler";

const handlers = {
    ping: (): "pong" => "pong",
    echo: (msg: { payload: { value: string } }): { value: string } => ({
        value: msg.payload.value,
    }),
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

async function useTypedClient(): Promise<void> {
    const response = await client({
        type: "echo",
        payload: { value: "hello" },
    });

    if (response.ok) {
        const value: string | undefined = response.result?.value;
        void value;
    } else {
        const error: string = response.error;
        void error;
    }

    // Payload presence remains permissive in the current public types.
    await client({ type: "echo" });
}

function narrowResponse(response: HermesResponse<string>): string {
    return response.ok ? (response.result ?? "") : response.error;
}

void useTypedClient;
void narrowResponse;
void hermes;
