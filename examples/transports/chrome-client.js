import { createHermesClient } from "hermes-handler/client";
import { chromeRuntimeTransport } from "hermes-handler/transports/chrome-runtime";

const dispatch = createHermesClient(chromeRuntimeTransport());
const response = await dispatch({
  type: "settings.read",
  timeoutMs: 5_000,
});

if (response.ok) console.log(response.result);
else console.error(response.error, response.info);

dispatch.close();
