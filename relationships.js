(function (root) {
  "use strict";
  const switches = ["mutualTags", "waitingTags", "followTags", "followerTags"];
  function merge(records, users, now = Date.now()) {
    const result = { ...records };
    for (const user of users || []) {
      const name = String(user?.screen_name || "").toLowerCase();
      if (!/^[a-z0-9_]{1,30}$/.test(name)) continue;
      if (["__proto__", "constructor", "prototype"].includes(name)) continue;
      const old = result[name] || {};
      const next = { ...old };
      if (typeof user.following === "boolean") {
        next.following = user.following;
        if (user.following) {
          if (!old.following || !old.observedAt) next.observedAt = now;
          if (user.exactFollow === true) next.followedAt = now;
        } else {
          delete next.followedAt;
          delete next.observedAt;
        }
      }
      if (typeof user.followed_by === "boolean") next.followed_by = user.followed_by;
      result[name] = next;
    }
    return result;
  }
  function labels(record, settings = {}, now = Date.now()) {
    if (!record) return [];
    const out = [];
    const add = (setting, kind, text) => { if (settings[setting] !== false) out.push({ kind, text }); };
    if (record.following === true && record.followed_by === true) add("mutualTags", "mutual", "已互关");
    if (record.following === true && record.followed_by === false) {
      const exact = Number.isFinite(record.followedAt);
      const start = exact ? record.followedAt : record.observedAt;
      if (Number.isFinite(start)) {
        const days = Math.max(0, Math.floor((now - start) / 86400000));
        add("waitingTags", "waiting", exact ? `${days} 天未回关` : `≥${days}天未回关`);
      }
    }
    if (record.following === false) add("followTags", "unfollowed", "未关注");
    if (record.followed_by === true && record.following !== true) add("followerTags", "follower", "关注了你");
    return out;
  }
  const api = { switches, merge, labels };
  root.XRRelationships = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
