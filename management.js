(() => {
  "use strict";
  const status = document.getElementById("dataStatus");
  const show = error => { status.textContent = error.message || String(error); };
  async function request(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || "后台没有响应");
    return result;
  }
  function download(backup, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  document.getElementById("dataExport").addEventListener("click", async () => {
    try { const { backup } = await request({ type: "mark-export" }); download(backup, "x-interaction-backup.json"); status.textContent = "已导出，请妥善保管备份"; } catch (error) { show(error); }
  });
  document.getElementById("dataImport").addEventListener("change", async event => {
    try {
      const file = event.target.files?.[0]; if (!file) return;
      if (file.size > 10 * 1024 * 1024) throw new Error("文件不能超过 10 MB");
      await request({ type: "mark-import", backup: JSON.parse(await file.text()) });
      status.textContent = "已合并导入，导入前的数据已备份；刷新设置页可查看最新设置";
    } catch (error) { show(error); } finally { event.target.value = ""; }
  });
  document.getElementById("dataBackups").addEventListener("click", async () => {
    try {
      const { backups } = await request({ type: "mark-backups" });
      const list = document.getElementById("backupList"); list.replaceChildren();
      for (const backup of backups) {
        const button = document.createElement("button"); button.type = "button";
        button.textContent = `下载 ${new Date(backup.exportedAt).toLocaleString("zh-CN")} 的备份`;
        button.addEventListener("click", () => download(backup, `x-backup-${backup.exportedAt}.json`));
        list.append(button);
      }
      status.textContent = `本机保留 ${backups.length} 份备份`;
    } catch (error) { show(error); }
  });
  async function load() {
    await request({ type: "mark-ready" });
    const settings = await chrome.storage.local.get(null);
    for (const name of ["mutualTags", "waitingTags", "followerTags"]) {
      const input = document.getElementById(name);
      if (!input) continue;
      input.checked = settings[name] !== false;
      input.addEventListener("change", () => chrome.storage.local.set({ [name]: input.checked }).catch(show));
    }
  }
  load().catch(show);
})();
