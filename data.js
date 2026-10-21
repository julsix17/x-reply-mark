(function (root) {
  "use strict";
  const VERSION = 2;
  const FORMAT = "x-interaction-backup";
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  function migrate(input) {
    const data = structuredClone(input);
    const version = data.dataVersion ?? 0;
    if (!Number.isInteger(version) || version < 0) throw new Error("数据版本格式错误");
    if (version > VERSION) throw new Error("数据版本较新，请先更新扩展");
    if (version < 1) {
      if (data.returnMinPosts == null || Number(data.returnMinPosts) === 2) data.returnMinPosts = 3;
      data.dataVersion = 1;
    }
    if (version < 2) {
      data.relationships ||= {};
      data.returnDays = 3;
      data.dataVersion = 2;
    }
    return data;
  }
  function snapshot(data) {
    const copy = structuredClone(data);
    delete copy.autoBackups;
    delete copy.returnInitLock;
    return copy;
  }
  function exportData(data, edition, now = Date.now()) {
    return { format: FORMAT, edition, version: VERSION, exportedAt: now, data: snapshot(data) };
  }
  function validate(value, depth = 0) {
    if (depth > 40) throw new Error("数据层级过深");
    if (Array.isArray(value)) { value.forEach(v => validate(v, depth + 1)); return; }
    if (!object(value)) return;
    for (const [name, child] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(name)) throw new Error("无效字段");
      validate(child, depth + 1);
    }
  }
  function parseImport(input, edition) {
    if (!object(input) || input.format !== FORMAT || input.edition !== edition || !Number.isInteger(input.version) || input.version < 1 || input.version > VERSION || !object(input.data)) throw new Error("备份格式、版本或扩展版本不匹配");
    validate(input.data);
    const data = migrate(snapshot(input.data));
    if (data.returnData !== undefined && (!object(data.returnData) || !object(data.returnData.u))) throw new Error("互动记录格式错误");
    for (const user of Object.values(data.returnData?.u || {})) {
      if (!object(user) || !object(user.m) || !object(user.t)) throw new Error("互动记录格式错误");
      if (Object.keys(user.m).concat(Object.keys(user.t)).some(id => !/^\d{5,25}$/.test(id))) throw new Error("互动编号格式错误");
      if (Object.values(user.t).some(id => !/^\d{5,25}$/.test(String(id)))) throw new Error("帖子编号格式错误");
    }
    if (!object(data.relationships)) throw new Error("关注记录格式错误");
    for (const record of Object.values(data.relationships)) {
      if (!object(record)) throw new Error("关注记录格式错误");
      for (const field of ["following", "followed_by"]) if (record[field] !== undefined && typeof record[field] !== "boolean") throw new Error("关注状态格式错误");
      for (const field of ["observedAt", "followedAt"]) if (record[field] !== undefined && (!Number.isFinite(record[field]) || record[field] < 0)) throw new Error("关注时间格式错误");
    }
    if (!Number.isInteger(data.returnMinPosts) || data.returnMinPosts < 1 || data.returnMinPosts > 50) throw new Error("阈值需为 1 到 50 的整数");
    for (const name of ["returnTags", "mutualTags", "waitingTags", "followTags", "followerTags"]) if (data[name] !== undefined && typeof data[name] !== "boolean") throw new Error("设置格式错误");
    if (data.account !== undefined && !/^[a-z0-9_]{1,30}$/.test(data.account)) throw new Error("账号格式错误");
    if (data.returnDays !== 3) throw new Error("互动窗口固定为 3 天");
    if (root.XRValidateExtraData) root.XRValidateExtraData(data);
    if (edition === "public") {
      const allowed = new Set(["dataVersion", "returnData", "relationships", "account", "returnTags", "mutualTags", "waitingTags", "followTags", "followerTags", "returnMinPosts", "returnDays", "returnInit"]);
      if (Object.keys(data).some(name => !allowed.has(name))) throw new Error("备份包含此版本不支持的数据");
    }
    return data;
  }
  function mergeObjects(current, incoming) {
    const result = { ...current };
    for (const [name, value] of Object.entries(incoming)) result[name] = object(value) && object(current?.[name]) ? mergeObjects(current[name], value) : structuredClone(value);
    return result;
  }
  function importData(current, input, edition) {
    const incoming = parseImport(input, edition);
    if (current.account && incoming.account && current.account !== incoming.account) throw new Error("备份账号与当前账号不一致");
    const merged = mergeObjects(migrate(current), incoming);
    // Runtime window identifiers belong to this installation, never to an imported backup.
    if (current.returnInit) merged.returnInit = structuredClone(current.returnInit);
    else if (merged.returnInit) merged.returnInit = { ...merged.returnInit, status: "stopped", windowId: null, deadline: 0 };
    // A relationship snapshot is atomic: do not retain stale dates from a previous follow.
    merged.relationships = { ...current.relationships, ...incoming.relationships };
    for (const [name, record] of Object.entries(incoming.relationships)) {
      const existing = current.relationships?.[name];
      if (record.following === true && existing?.following === true &&
          Number.isFinite(record.observedAt) && record.observedAt === existing.observedAt &&
          record.followedAt === undefined && Number.isFinite(existing.followedAt)) {
        merged.relationships[name] = { ...record, followedAt: existing.followedAt };
      }
    }
    if (root.XRMergeExtraData) root.XRMergeExtraData(merged, current, incoming);
    return merged;
  }
  function backup(data, edition, now = Date.now(), force = false) {
    const backups = data.autoBackups || [];
    if (!force && backups.length && now - backups[0].exportedAt < 86400000) return backups;
    return [exportData(data, edition, now), ...backups].slice(0, 3);
  }
  const api = { VERSION, migrate, snapshot, exportData, parseImport, importData, backup };
  root.XRData = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
