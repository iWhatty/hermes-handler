import * as packageRoot from "hermes-handler";
import * as packageClient from "hermes-handler/client";
import * as packageGuard from "hermes-handler/guard";

if (packageRoot.createHermesClient !== packageClient.createHermesClient) {
    throw new Error("Package root must re-export createHermesClient from ./client.");
}

if (typeof packageRoot.HermesHandler !== "function") {
    throw new Error("Package root must export HermesHandler.");
}

for (const name of ["defineBoundary", "classifySender", "createGuard"]) {
    if (typeof packageGuard[name] !== "function") {
        throw new Error(`hermes-handler/guard must export ${name}.`);
    }
}
