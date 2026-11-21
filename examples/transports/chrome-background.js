import { HermesHandler } from "hermes-handler";

const hermes = new HermesHandler({
  "settings.read": async () => chrome.storage.local.get(),
});

// The handler owner registers exactly one router listener. Chrome owns the
// sendResponse lifecycle; clients use chromeRuntimeTransport separately.
const listener = hermes.getListener();
chrome.runtime.onMessage.addListener(listener);

// On extension teardown/reload, Chrome removes listeners with the context.
// For a shorter-lived owner: chrome.runtime.onMessage.removeListener(listener).
