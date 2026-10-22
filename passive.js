(() => {
  "use strict";
  const users = new Map(), tweets = new Map();
  let account = "";
  const emit = data => window.postMessage({ source: "xr-passive", account, ...data }, location.origin);
  function viewerId() {
    try { return /(?:^|;\s*)twid=([^;]+)/.exec(document.cookie)?.[1] ? /u=(\d+)/.exec(decodeURIComponent(/(?:^|;\s*)twid=([^;]+)/.exec(document.cookie)[1]))?.[1] : ""; }
    catch { return ""; }
  }
  function inspect(json, exact, relationshipAt) {
    const seen = new Set(), pending = [json], changedUsers = new Map(), changedTweets = [];
    const viewer = viewerId();
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      const legacy = value.legacy || value;
      const name = legacy.screen_name || value.core?.screen_name;
      if (typeof name === "string" && /^[a-z0-9_]{1,30}$/i.test(name)) {
        const screen_name = name.toLowerCase();
        if (viewer && String(value.rest_id || legacy.id_str) === viewer) account = screen_name;
        const relation = value.relationship_perspectives || {};
        const user = { screen_name };
        const userId = String(value.rest_id || legacy.id_str || "");
        if (/^\d{1,25}$/.test(userId)) user.userId = userId;
        for (const field of ["following", "followed_by"]) {
          const v = typeof legacy[field] === "boolean" ? legacy[field] : relation[field];
          if (typeof v === "boolean") user[field] = v;
        }
        if (exact !== undefined && value === json) { user.following = exact; user.exactFollow = exact; }
        if (typeof user.following === "boolean" || typeof user.followed_by === "boolean") { user.relationshipAt = relationshipAt; user.fresh = true; }
        const cached = { ...users.get(screen_name), ...user };
        // A replay is an observation, not a second follow event.
        delete cached.exactFollow;
        delete cached.fresh;
        users.set(screen_name, cached);
        changedUsers.set(screen_name, { ...changedUsers.get(screen_name), ...user });
      }
      const authorResult = value.core?.user_results?.result;
      const author = authorResult?.legacy?.screen_name || authorResult?.core?.screen_name;
      const id = String(legacy.id_str || value.rest_id || "");
      if (author && /^\d{5,25}$/.test(id) && typeof legacy.full_text === "string") {
        const tweet = {
          id, author: author.toLowerCase(), text: value.note_tweet?.note_tweet_results?.result?.text || legacy.full_text,
          parent: legacy.in_reply_to_status_id_str || "", replyTo: (legacy.in_reply_to_screen_name || "").toLowerCase(),
          root: legacy.conversation_id_str || ""
        };
        tweets.set(id, tweet);
        changedTweets.push(tweet);
      }
      for (const child of Object.values(value)) if (child && typeof child === "object") pending.push(child);
    }
    while (tweets.size > 5000) tweets.delete(tweets.keys().next().value);
    while (users.size > 5000) users.delete(users.keys().next().value);
    if (changedUsers.size || changedTweets.length || account) emit({ users: [...changedUsers.values()], tweets: changedTweets });
  }
  function eligible(url) {
    try {
      const parsed = new URL(url, location.origin);
      if (!["x.com", "twitter.com", "api.x.com", "api.twitter.com"].includes(parsed.hostname)) return false;
      return /\/graphql\//.test(parsed.pathname) || /\/friendships\/(create|destroy)\.json$/.test(parsed.pathname) || /\/account\/verify_credentials\.json$/.test(parsed.pathname);
    } catch { return false; }
  }
  function receive(url, status, json, relationshipAt) {
    if (status < 200 || status >= 300 || !eligible(url) || json?.errors) return;
    const change = /\/friendships\/(create|destroy)\.json/.exec(url);
    inspect(json, change ? change[1] === "create" : undefined, relationshipAt);
  }
  window.addEventListener("message", event => {
    if (event.source === window && event.origin === location.origin && event.data?.source === "xr-passive-request") {
      emit({ users: [...users.values()], tweets: [...tweets.values()] });
    }
  });
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const relationshipAt = Date.now();
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || String(args[0]);
    if (eligible(url)) response.clone().json().then(json => receive(url, response.status, json, relationshipAt)).catch(() => {});
    return response;
  };
  const open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  const urls = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { urls.set(this, String(url)); return open.call(this, method, url, ...rest); };
  XMLHttpRequest.prototype.send = function (...args) {
    const relationshipAt = Date.now();
    this.addEventListener("load", () => {
      if (!eligible(urls.get(this))) return;
      try { receive(urls.get(this), this.status, this.responseType === "json" ? this.response : JSON.parse(this.responseText), relationshipAt); } catch { /* Non-JSON response. */ }
    }, { once: true });
    return send.apply(this, args);
  };
})();
