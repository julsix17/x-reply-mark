(() => {
  "use strict";
  const ARTICLE = 'article[data-testid="tweet"]';
  let settings = {}, account = "", scheduled = false;
  const tweets = new Map();
  const send = message => chrome.runtime.sendMessage(message).catch(() => null);
  function detectAccount() {
    const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    const name = link?.getAttribute("href")?.match(/^\/([a-z0-9_]+)\/?$/i)?.[1]?.toLowerCase();
    if (name && name !== account) {
      account = name; send({ type: "mark-account", account });
      window.postMessage({ source: "xr-passive-request" }, location.origin);
    }
    return account;
  }
  function author(article) {
    for (const link of article.querySelectorAll('[data-testid="User-Name"] a[href]')) {
      const name = new URL(link.href, location.origin).pathname.match(/^\/([a-z0-9_]+)\/?$/i)?.[1];
      if (name) return name.toLowerCase();
    }
    return "";
  }
  function renderBoundary(article) {
    if (article.parentElement?.closest(ARTICLE)) return;
    const ownName = article.querySelector('[data-testid="User-Name"]');
    const quotes = [...article.querySelectorAll('[role="link"]')].filter(card =>
      card.querySelector('[data-testid="User-Name"]') && !card.contains(ownName));
    const time = [...article.querySelectorAll('a[href*="/status/"] time')].find(node =>
      node.closest(ARTICLE) === article && !quotes.some(card => card.contains(node)));
    const id = time?.closest("a")?.getAttribute("href")?.match(/\/status\/(\d+)/)?.[1];
    const tweet = tweets.get(id);
    // Only captured parent metadata distinguishes a post from a reply, never DOM order.
    const kind = tweet?.parent ? "reply" : tweet?.parent === "" ? "post" : "unknown";
    const replyTo = /^[a-z0-9_]{1,30}$/i.test(tweet?.replyTo || "") ? tweet.replyTo : "";
    const text = kind === "post" ? "帖子" : kind === "reply" ? `评论${replyTo ? ` · 回复 @${replyTo}` : ""}` : "";
    let boundary = article.querySelector(":scope > .xr-post-boundary");
    if (!boundary) {
      boundary = document.createElement("div");
      boundary.className = "xr-post-boundary";
      boundary.setAttribute("role", "note");
      article.prepend(boundary);
    }
    if (boundary.dataset.kind !== kind) boundary.dataset.kind = kind;
    if (boundary.textContent !== text) boundary.textContent = text;
  }
  function render() {
    scheduled = false;
    detectAccount();
    for (const article of document.querySelectorAll(ARTICLE)) {
      renderBoundary(article);
      const name = author(article), avatar = article.querySelector('[data-testid="Tweet-User-Avatar"]');
      let box = article.querySelector(".xr-avatar-tags");
      if (box && (!avatar || box.previousElementSibling !== avatar)) { box.remove(); box = null; }
      const labels = name && name !== account && account === settings.account ? self.XRRelationships.labels(settings.relationships?.[name], settings) : [];
      const info = name && name !== account && account === settings.account && settings.returnTags !== false ? self.XRReturns.returnInfo(settings.returnData?.u?.[name], { minPosts: settings.returnMinPosts }) : null;
      if (info) labels.push({ kind: "returner", text: "爱回踩", title: info.title });
      if (!avatar || !labels.length) { if (box) box.remove(); continue; }
      const signature = JSON.stringify(labels);
      if (box?.dataset.signature === signature) continue;
      if (!box) { box = document.createElement("div"); box.className = "xr-avatar-tags"; avatar.after(box); }
      box.dataset.signature = signature;
      box.replaceChildren(...labels.map(label => {
        const span = document.createElement("span");
        span.className = `xr-tag xr-${label.kind}`;
        span.textContent = label.text;
        span.title = label.title || label.text;
        return span;
      }));
    }
  }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(render); } }
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "xr-passive") return;
    const d = event.data;
    if (!account && /^[a-z0-9_]{1,30}$/.test(d.account || "")) { account = d.account; send({ type: "mark-account", account }); }
    const captured = Array.isArray(d.tweets) ? d.tweets.slice(0, 5000) : [];
    for (const tweet of captured) if (/^\d{5,25}$/.test(tweet?.id)) tweets.set(tweet.id, tweet);
    while (tweets.size > 5000) tweets.delete(tweets.keys().next().value);
    if (account) send({ type: "mark-observe", account, users: Array.isArray(d.users) ? d.users.slice(0, 5000) : [], tweets: captured });
    schedule();
  });
  window.postMessage({ source: "xr-passive-request" }, location.origin);
  chrome.storage.local.get(null).then(value => { settings = value; detectAccount(); schedule(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [name, change] of Object.entries(changes)) settings[name] = change.newValue;
    schedule();
  });
  new MutationObserver(schedule).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
  setInterval(schedule, 60000);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function scrollPage(message) {
    const timing = window.__XR_MARK_TIMING || { first: 15000, poll: 500, wait: 2000 };
    const deadline = message.deadline;
    const budgetDeadline = Math.min(deadline, message.budgetDeadline || deadline);
    let scrolls = 0;
    const timelineIds = new Set();
    const count = () => document.querySelectorAll(`${ARTICLE}, [data-testid="UserCell"], [data-testid="notification"]`).length;
    const login = () => /^\/(login|i\/flow)/.test(location.pathname) || (!count() && !!document.querySelector('[data-testid="loginButton"]'));
    const confirmedEmpty = () => !count() && !document.querySelector('[role="progressbar"], [role="alert"], [data-testid="error-detail"]') && [...document.querySelectorAll('[data-testid="emptyState"]')].some(e => {
      const text = e.textContent;
      return /(?:没有|暂无|尚无|还没有|no\b|nothing\b|not.*yet|don't have|aren.t any)/i.test(text) &&
        /(?:通知|提及|关注|帖子|推文|notifications?|mentions?|following|followers?|posts?|tweets?|nothing to see|no results)/i.test(text) &&
        !/(?:error|retry|try again|connection|出错|错误|重试|连接)/i.test(text);
    });
    function visibleOwn() {
      return [...document.querySelectorAll(ARTICLE)].filter(a => author(a) === account && !a.querySelector('[data-testid="socialContext"]')).map(a => {
        const time = a.querySelector('a[href*="/status/"] time');
        const id = time?.closest("a")?.getAttribute("href")?.match(/\/status\/(\d+)/)?.[1];
        if (id) timelineIds.add(id);
        return id ? self.XRReturns.tweetTime(id) : Infinity;
      });
    }
    const posts = () => { visibleOwn(); return [...timelineIds].filter(id => self.XRReturns.tweetTime(id) >= (message.since || 0)); };
    const result = reason => ({ reason, posts: posts(), scrolls });
    for (const start = Date.now(); !count() && !login() && !confirmedEmpty() && Date.now() < budgetDeadline && Date.now() - start < timing.first;) await sleep(timing.poll);
    if (Date.now() >= deadline) return result("deadline");
    if (Date.now() >= budgetDeadline) return result("budget");
    if (login()) return result("login");
    if (confirmedEmpty()) return result("confirmed-empty");
    if (!count()) return result("empty");
    let idle = 0, previous = "";
    for (let i = 0; i < (message.maxScrolls || 80); i++) {
      if (Date.now() >= deadline) return result("deadline");
      if (Date.now() >= budgetDeadline) return result("budget");
      const own = visibleOwn();
      if (message.since && own.length && own.every(time => time < message.since)) return result("reached");
      // Text and links detect new virtualized rows even when height and row count are constant.
      const signature = [...document.querySelectorAll(`${ARTICLE}, [data-testid="UserCell"], [data-testid="notification"]`)].map(e => e.textContent + [...e.querySelectorAll('a[href*="/status/"]')].map(a => a.getAttribute("href")).join()).join("|");
      idle = signature === previous ? idle + 1 : 0;
      if (idle >= 4) return result("end");
      previous = signature;
      window.scrollBy({ top: Math.round((window.innerHeight || 800) * 0.85), behavior: "smooth" });
      scrolls++;
      await sleep(Math.min(timing.wait, Math.max(0, budgetDeadline - Date.now())));
      await send({ type: "mark-tick" });
    }
    return result("max");
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === "mark-identify") { respond({ account: detectAccount() }); return; }
    if (message.type !== "mark-scroll") return;
    scrollPage(message).then(respond, error => respond({ reason: "error", error: error.message }));
    return true;
  });
  schedule();
})();
