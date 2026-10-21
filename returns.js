(function (root) {
  "use strict";
  const WINDOW_DAYS = 3;
  const DAY = 86400000;
  function tweetTime(id) {
    try { return Number((BigInt(String(id)) >> 22n) + 1288834974657n); } catch { return 0; }
  }
  function mergeInteractions(store, items, me) {
    const data = store?.u ? store : { u: {} };
    me = String(me || "").toLowerCase();
    let changed = false;
    if (!me) return { data, changed };
    for (const item of items || []) {
      const author = String(item?.author || "").toLowerCase();
      const replyTo = String(item?.replyTo || "").toLowerCase();
      const id = String(item?.id || "");
      if (!/^\d{5,25}$/.test(id) || !author || !replyTo || author === replyTo) continue;
      let name, side, value;
      if (author === me) { name = replyTo; side = "m"; value = 1; }
      else if (replyTo === me) { name = author; side = "t"; value = /^\d{5,25}$/.test(String(item.parent || "")) ? String(item.parent) : id; }
      else continue;
      if (!/^[a-z0-9_]{1,30}$/.test(name)) continue;
      if (["__proto__", "constructor", "prototype"].includes(name)) continue;
      const user = data.u[name] || (data.u[name] = { m: {}, t: {} });
      user[side] ||= {};
      if (user[side][id] === undefined) { user[side][id] = value; changed = true; }
    }
    return { data, changed };
  }
  // Historical records are retained; only the calculation has a sliding window.
  function pruneReturns(store) { return store?.u ? store : { u: {} }; }
  function returnInfo(user, { minPosts = 3, now = Date.now() } = {}) {
    if (!user) return null;
    const recentId = id => tweetTime(id) >= now - WINDOW_DAYS * DAY && tweetTime(id) <= now;
    const mine = Object.keys(user.m || {}).filter(recentId);
    const recent = Object.entries(user.t || {}).filter(([id]) => recentId(id));
    const firstMine = mine.length ? Math.min(...mine.map(tweetTime)) : Infinity;
    const after = recent.filter(([id]) => tweetTime(id) > firstMine).length;
    const posts = new Set(recent.map(([, parent]) => String(parent))).size;
    const reasons = [];
    if (after > 0) reasons.push("互评回来");
    if (posts >= Math.max(1, Number(minPosts) || 3)) reasons.push("常来评论");
    if (!reasons.length) return null;
    let title = `近 3 天：你评论了他 ${mine.length} 次；他评论了你 ${recent.length} 次（分布在你 ${posts} 条不同的帖子下）`;
    if (after > 0 && after < recent.length) title += `；其中在你评论他之后 ${after} 次`;
    title += reasons.map(reason => ` · ${reason}`).join("");
    return { reasons, title, mine: mine.length, theirs: recent.length, posts, after };
  }
  const api = { WINDOW_DAYS, tweetTime, mergeInteractions, pruneReturns, returnInfo };
  root.XRReturns = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
