self.XR_EDITION = "public";
importScripts("returns.js", "relationships.js", "data.js", "storage-worker.js", "initializer.js");
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
