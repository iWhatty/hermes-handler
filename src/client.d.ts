import type {
    CreateHermesClientOptions as GenericCreateHermesClientOptions,
    HermesClient as GenericHermesClient,
    HermesClientRequest as GenericHermesClientRequest,
    HermesResponse,
} from "./types.js";

export type { HermesClientTransport, RoutesOf } from "./types.js";

export type HermesClientRequest<R = unknown, K extends string = string> =
    GenericHermesClientRequest<R, K>;

export type HermesClientWireOut<P = unknown> = {
    type: string;
    payload?: P;
    requestId: string;
};

export type HermesClientResponse<T = unknown> = HermesResponse<T>;
export type CreateHermesClientOptions = GenericCreateHermesClientOptions;

export type HermesClient<
    R extends Record<string, { request: unknown; response: unknown }> =
        Record<string, { request: unknown; response: unknown }>,
> = GenericHermesClient<R>;

export function createHermesClient<
    R extends Record<string, { request: unknown; response: unknown }> =
        Record<string, { request: unknown; response: unknown }>,
>(opts: CreateHermesClientOptions): HermesClient<R>;
