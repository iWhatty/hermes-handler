# Examples

These examples use the published ESM entry points and keep application-specific policy visible.

- [Transport examples](transports/README.md) cover Workers, MessageChannel, Chrome runtime messaging, and BroadcastChannel peers.
- [TypeScript example](typescript/README.md) covers handler-map inference, typed router dispatch, response narrowing, and the current typed-client pattern.

Read the [architecture guide](../ARCHITECTURE.md) before extending the package, and follow [CONTRIBUTING.md](../CONTRIBUTING.md) for verification and compatibility expectations.

Examples are intentionally small. Production applications must supply their own authorization, origin/source validation, logging, data validation, and remote-cancellation protocol where needed.
