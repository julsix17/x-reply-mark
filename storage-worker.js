(function (root) {
  "use strict";
  const edition = root.XR_EDITION;
  let queue = Promise.resolve();
  const serial = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  const initialize = () => serial(async () => {
    const old = await chrome.storage.local.get(null);
    const data = root.XRData.migrate(old);
    data.autoBackups = root.XRData.backup(old, edition, Date.now(), old.dataVersion !== data.dataVersion);
    await chrome.storage.local.set(data);
  });
  const ready = initialize();
  async function setAccount(account) {
    if (!/^[a-z0-9_]{1,30}$/.test(account || "")) throw new Error("未识别到登录账号");
    return serial(async () => {
      const data = await chrome.storage.local.get("account");
      if (data.account && data.account !== account) throw new Error("当前扩展已有另一账号的数据，请使用独立浏览器配置以免混合记录");
      await chrome.storage.local.set({ account });
    });
  }
  async function observe(message) {
    await setAccount(message.account);
    return serial(async () => {
      const data = await chrome.storage.local.get(null);
      const relationships = root.XRRelationships.merge(data.relationships || {}, message.users);
      const { data: returnData } = root.XRReturns.mergeInteractions(data.returnData, message.tweets, data.account);
      await chrome.storage.local.set({ relationships, returnData, autoBackups: root.XRData.backup(data, edition) });
      return { ok: true };
    });
  }
  const optionsSender = sender => sender.url === chrome.runtime.getURL("options.html");
  const xSender = sender => { try { const url = new URL(sender.url); return url.protocol === "https:" && ["x.com", "twitter.com"].includes(url.hostname); } catch { return false; } };
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message?.type?.startsWith("mark-")) return;
    const handlers = {
      "mark-ready": () => ({ ok: true }),
      "mark-account": () => setAccount(message.account).then(() => ({ ok: true })),
      "mark-observe": () => observe(message),
      "mark-tick": () => ({ ok: true }),
      "mark-init": () => root.XRInitializer.run(message.fresh !== false),
      "mark-export": () => serial(async () => ({ ok: true, backup: root.XRData.exportData(await chrome.storage.local.get(null), edition) })),
      "mark-import": () => serial(async () => {
        const current = await chrome.storage.local.get(null);
        const merged = root.XRData.importData(current, message.backup, edition);
        merged.autoBackups = root.XRData.backup(current, edition, Date.now(), true);
        await chrome.storage.local.set(merged);
        return { ok: true };
      }),
      "mark-backups": () => chrome.storage.local.get("autoBackups").then(data => ({ ok: true, backups: data.autoBackups || [] }))
    };
    const handler = handlers[message.type];
    if (!handler) return;
    const management = ["mark-init", "mark-export", "mark-import", "mark-backups"].includes(message.type);
    if (management ? !optionsSender(sender) : !(optionsSender(sender) || xSender(sender))) return;
    ready.then(handler).then(respond, error => respond({ ok: false, error: String(error.message || error) }));
    return true;
  });
  chrome.runtime.onInstalled.addListener(() => initialize().catch(() => {}));
  chrome.runtime.onStartup.addListener(() => initialize().catch(() => {}));
  root.XRStore = { ready, serial, setAccount };
})(self);
