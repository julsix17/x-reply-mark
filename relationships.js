(function (root) {
  "use strict";
  const switches = ["mutualTags", "waitingTags", "followTags", "followerTags", "suspiciousFollowTags"];
  const HISTORY_WINDOW = 30 * 86400000;
  function updateHistory(old, next, user, at) {
    if (!user.userId || user.fresh !== true || typeof user.following !== "boolean" || typeof user.followed_by !== "boolean") return;
    const history = structuredClone(old.followHistory || { losses: [] });
    history.currentAt = at;
    history.losses = history.losses.filter(item => item.confirmedAt >= at - HISTORY_WINDOW);
    if (user.followed_by && old.followed_by === false) {
      const last = history.losses.at(-1);
      if (last && !last.refollowedAt) last.refollowedAt = at;
    }
    if (user.following && user.followed_by) {
      history.mutualAt ||= at;
      delete history.pendingLoss;
    } else if (!user.following) {
      delete history.mutualAt;
      delete history.pendingLoss;
    } else if (history.mutualAt) {
      if (!history.pendingLoss) history.pendingLoss = { mutualAt: history.mutualAt, firstSeenAt: at };
      else if (at - history.pendingLoss.firstSeenAt >= 300000) {
        history.losses.push({ ...history.pendingLoss, confirmedAt: at });
        delete history.pendingLoss;
        delete history.mutualAt;
      }
    }
    history.losses = history.losses.slice(-20);
    next.followHistory = history;
  }
  function merge(records, users, now = Date.now()) {
    const result = { ...records };
    for (const user of users || []) {
      const name = String(user?.screen_name || "").toLowerCase();
      if (!/^[a-z0-9_]{1,30}$/.test(name)) continue;
      if (["__proto__", "constructor", "prototype"].includes(name)) continue;
      const userId = /^\d{1,25}$/.test(user.userId || "") ? user.userId : "";
      const old = userId && result[name]?.userId && result[name].userId !== userId ? {} : result[name] || {};
      const at = Number.isFinite(user.relationshipAt) && user.relationshipAt > 0 && user.relationshipAt <= now ? user.relationshipAt : 0;
      if (old.relationshipAt && at <= old.relationshipAt) continue;
      const next = { ...old };
      if (userId) next.userId = userId;
      if (at) next.relationshipAt = at;
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
      if (next.followHistory && (user.following === false || user.followed_by === true)) {
        next.followHistory = structuredClone(next.followHistory);
        delete next.followHistory.pendingLoss;
        if (user.following === false) delete next.followHistory.mutualAt;
      }
      if (at) updateHistory(old.userId === userId ? old : {}, next, user, at);
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
    if (settings.suspiciousFollowTags !== false && record.following === false && record.followed_by === true && record.userId && record.followHistory?.currentAt === record.relationshipAt) {
      const losses = (record.followHistory?.losses || []).filter(item => item.confirmedAt >= now - HISTORY_WINDOW && item.confirmedAt <= now && item.refollowedAt <= now);
      if (losses.length) {
        const date = at => new Date(at).toLocaleString("zh-CN", { hour12: false });
        const last = losses.at(-1);
        const title = [
          `近 30 天确认 ${losses.length} 次互关后对方不再关注，之后又观察到对方再次关注你。`,
          `曾确认互关：${date(last.mutualAt)}`,
          `首次观察到对方不再关注：${date(last.firstSeenAt)}`,
          `再次确认：${date(last.confirmedAt)}（两次新数据间隔至少 5 分钟，期间你仍关注对方）`,
          `再次观察到对方关注你：${date(last.refollowedAt)}`,
          "你目前尚未回关。以上为观察记录，不是精确操作时间，也不代表已证实对方动机。"
        ].join("\n");
        out.push({ kind: "suspicious-follow", text: "疑似骗关注", title });
      }
    }
    return out;
  }
  const api = { switches, merge, labels };
  root.XRRelationships = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
