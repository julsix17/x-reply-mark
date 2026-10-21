(function (root) {
  "use strict";
  let running = null;
  const labels = { replies: "读取最近 3 天的回复", details: "读取帖子详情", notifications: "读取通知", mentions: "读取提及", following: "记录关注观察起点", done: "初始化完成" };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function timed(promise, ms, error = new Error("已到时间上限，请重新初始化")) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(error), Math.max(0, ms)); })]); }
    finally { clearTimeout(timer); }
  }
  async function identify() {
    const tabs = await chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] });
    for (const tab of tabs.sort((a, b) => Number(b.active) - Number(a.active))) {
      try {
        const response = await timed(chrome.tabs.sendMessage(tab.id, { type: "mark-identify" }), 3000);
        if (/^[a-z0-9_]{1,30}$/.test(response?.account || "")) return response.account;
      } catch { /* Tab may have loaded before the extension. */ }
    }
    throw new Error("请先打开已登录的 X 页面并刷新，等待左侧个人资料入口出现");
  }
  async function close(state) {
    if (state?.windowId == null) return;
    try { await chrome.windows.remove(state.windowId); } catch { /* Already closed. */ }
  }
  async function expire() {
    const { returnInit } = await chrome.storage.local.get("returnInit");
    if (returnInit?.status !== "running" || returnInit.deadline > Date.now()) return;
    await close(returnInit);
    await chrome.storage.local.set({ returnInit: { ...returnInit, status: "stopped", error: "已到 10 分钟上限", windowId: null } });
  }
  async function execute(fresh) {
    const cfg = { totalMs: 600000, gap: [2000, 4000], poll: 500, ...(root.__XR_MARK_CRAWL_TEST || {}) };
    const account = await identify();
    await root.XRStore.setAccount(account);
    const { returnInit: previous = {} } = await chrome.storage.local.get("returnInit");
    if (previous.status === "running" && previous.deadline > Date.now()) return { ok: true, running: true };
    await close(previous);
    const resume = !fresh && previous.account === account && previous.status === "stopped";
    const state = { account, step: resume ? previous.step : "replies", posts: resume ? previous.posts || [] : [], postIndex: resume ? previous.postIndex || 0 : 0,
      status: "running", startedAt: Date.now(), deadline: Date.now() + Math.min(cfg.totalMs, 600000), windowId: null, error: "" };
    const stages = ["replies", "details", "notifications", "mentions", "following"];
    state.phaseResults = resume ? { ...(previous.phaseResults || {}) } : {};
    state.detailProgress = resume ? { ...(previous.detailProgress || {}) } : {};
    if (resume && !previous.detailProgress) for (const id of state.posts.slice(0, state.postIndex)) state.detailProgress[id] = { complete: true, scrolls: 0 };
    if (resume && !previous.phaseResults) for (const stage of stages.slice(0, stages.indexOf(state.step))) state.phaseResults[stage] = "complete";
    // An unfinished reply scan can discover more detail pages during a resumed run.
    if (state.phaseResults.replies !== "complete") state.phaseResults.details = "partial";
    const weights = { replies: 150, details: 210, notifications: 60, mentions: 60, following: 120 };
    const pending = stages.filter(stage => state.phaseResults[stage] !== "complete");
    const totalWeight = pending.reduce((sum, stage) => sum + weights[stage], 0);
    let cumulative = 0;
    const phaseEnds = Object.fromEntries(pending.map(stage => [stage, state.startedAt + (state.deadline - state.startedAt) * (cumulative += weights[stage]) / totalWeight]));
    const save = () => chrome.storage.local.set({ returnInit: { ...state, label: labels[state.step], at: Date.now() } });
    let tabId;
    try {
      await save();
      await chrome.alarms.create("mark-deadline", { when: state.deadline });
      const window = await chrome.windows.create({ url: "about:blank", focused: false, type: "normal", width: 1000, height: 900 });
      state.windowId = window.id;
      tabId = window.tabs[0].id;
      await save();
      const remaining = () => state.deadline - Date.now();
      let nextNavigationAt = 0;
      const visit = async (path, opts = {}) => {
        if (remaining() <= 0) throw new Error("已到 10 分钟上限");
        const budgetDeadline = phaseEnds[state.step];
        if (Date.now() >= budgetDeadline) return { reason: "budget", posts: [] };
        const budgetError = Object.assign(new Error("本阶段读取预算已用完"), { code: "phase-budget" });
        const limited = task => {
          const error = budgetDeadline < state.deadline ? budgetError : new Error("已到时间上限，请重新初始化");
          const left = Math.min(remaining(), budgetDeadline - Date.now());
          return left <= 0 ? Promise.reject(error) : timed(typeof task === "function" ? task() : task, left, error);
        };
        try {
          await limited(sleep(Math.max(0, nextNavigationAt - Date.now())));
          await limited(() => chrome.tabs.update(tabId, { url: `https://x.com${path}` }));
          nextNavigationAt = Date.now() + cfg.gap[0] + Math.random() * (cfg.gap[1] - cfg.gap[0]);
          const loadEnd = Math.min(state.deadline, Date.now() + 30000);
          while ((await limited(() => chrome.tabs.get(tabId))).status !== "complete") {
            if (Date.now() >= loadEnd) throw new Error("页面加载超时");
            await limited(sleep(cfg.poll));
          }
          await limited(sleep(Math.max(0, nextNavigationAt - Date.now())));
          let response;
          for (let tries = 0; tries < 5; tries++) {
            const softDeadline = budgetDeadline - Math.min(100, Math.max(0, (budgetDeadline - Date.now()) / 20));
            try { response = await limited(() => chrome.tabs.sendMessage(tabId, { type: "mark-scroll", deadline: state.deadline, budgetDeadline: softDeadline, ...opts })); break; }
            catch (error) { if (error.code === "phase-budget" || tries === 4 || remaining() <= 0) throw error; await limited(sleep(cfg.poll)); }
          }
          if (["deadline", "login", "error"].includes(response?.reason)) throw new Error(response.reason === "login" ? "请先登录 X" : response.error || "已到 10 分钟上限");
          if (!response) throw new Error("页面没有响应");
          return response;
        } catch (error) {
          if (error.code === "phase-budget" && remaining() > 0) return { reason: "budget", posts: [] };
          throw error;
        }
      };
      if (state.phaseResults.replies !== "complete") {
        state.step = "replies";
        const since = state.startedAt - 3 * 86400000;
        const response = await visit(`/${account}/with_replies`, { since });
        const previousCount = state.posts.length;
        const captured = (response.posts || []).filter(id => /^\d{5,25}$/.test(id) && root.XRReturns.tweetTime(id) >= since && root.XRReturns.tweetTime(id) <= Date.now());
        state.posts = [...new Set([...state.posts, ...captured])];
        if (state.posts.length > previousCount) state.phaseResults.details = "partial";
        state.phaseResults.replies = ["end", "reached", "confirmed-empty"].includes(response.reason) ? "complete" : "partial";
        state.step = "details";
        await save();
      }
      if (state.phaseResults.details !== "complete") {
        state.step = "details";
        for (let attempts = 0; attempts < state.posts.length; attempts++) {
          state.postIndex %= state.posts.length;
          const id = state.posts[state.postIndex];
          const progress = state.detailProgress[id] || { scrolls: 0 };
          if (progress.complete) { state.postIndex++; continue; }
          if (Date.now() >= phaseEnds.details) break;
          await save();
          // Reopen read-only and replay the observed prefix before extending it.
          const maxScrolls = progress.scrolls + 10;
          const response = await visit(`/${account}/status/${id}`, { maxScrolls });
          state.detailProgress[id] = { complete: ["end", "reached", "confirmed-empty"].includes(response.reason),
            scrolls: Math.max(progress.scrolls, Number(response.scrolls) || (response.reason === "max" ? maxScrolls : 0)) };
          state.postIndex++;
          await save();
          if (response.reason === "budget") break;
        }
        state.phaseResults.details = state.posts.every(id => state.detailProgress[id]?.complete) ? "complete" : "partial";
        if (state.phaseResults.details !== "complete" && state.posts.length) state.postIndex %= state.posts.length;
        state.step = "notifications"; await save();
      }
      for (const [step, path, next] of [["notifications", "/notifications", "mentions"], ["mentions", "/notifications/mentions", "following"], ["following", `/${account}/following`, "done"]]) {
        if (state.phaseResults[step] === "complete") continue;
        state.step = step;
        const response = await visit(path, { maxScrolls: step === "following" ? 80 : 8 });
        state.phaseResults[step] = ["end", "reached", "confirmed-empty"].includes(response.reason) ? "complete" : "partial";
        state.step = next; await save();
      }
      const incomplete = stages.find(stage => state.phaseResults[stage] !== "complete");
      if (incomplete) {
        state.status = "stopped"; state.step = incomplete; state.partial = true;
        state.error = `本轮读取已结束，仍有部分数据待续读（详情 ${state.posts.filter(id => state.detailProgress[id]?.complete).length}/${state.posts.length}）`;
        return { ok: true, partial: true };
      }
      state.status = "done"; state.doneAt = Date.now();
      return { ok: true, done: true };
    } catch (error) {
      state.status = "stopped";
      const message = String(error.message || error);
      state.error = /receiving end does not exist|could not establish connection|no tab with id|no window with id|tab was closed|message port closed/i.test(message)
        ? "读取窗口已关闭或页面连接中断，可继续上次读取" : message;
      return { ok: false, error: state.error };
    } finally {
      await close(state);
      state.windowId = null;
      await save();
      await chrome.alarms.clear("mark-deadline");
    }
  }
  function run(fresh = true) {
    if (running) return Promise.resolve({ ok: true, running: true });
    running = execute(fresh).catch(error => ({ ok: false, error: error.message })).finally(() => { running = null; });
    return running;
  }
  root.XRInitializer = { run, identify, expire };
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "mark-deadline") expire().catch(() => {}); });
})(self);
