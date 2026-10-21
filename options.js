(() => {
  "use strict";
  const status = document.getElementById("settingsStatus");
  async function load() {
    const ready = await chrome.runtime.sendMessage({ type: "mark-ready" });
    if (!ready?.ok) throw new Error(ready?.error || "数据未就绪");
    const settings = await chrome.storage.local.get(null);
    for (const name of ["returnTags", "followTags"]) {
      const input = document.getElementById(name); input.checked = settings[name] !== false;
      input.addEventListener("change", () => chrome.storage.local.set({ [name]: input.checked }).catch(error => { status.textContent = error.message; }));
    }
    const threshold = document.getElementById("returnMinPosts"); threshold.value = settings.returnMinPosts ?? 3;
    threshold.addEventListener("change", async () => {
      const value = Number(threshold.value);
      if (!Number.isInteger(value) || value < 1 || value > 50) { status.textContent = "请输入 1 到 50 的整数"; return; }
      try { await chrome.storage.local.set({ returnMinPosts: value }); status.textContent = "已保存"; } catch (error) { status.textContent = error.message; }
    });
    document.getElementById("settingsFields").disabled = false;
  }
  async function progress() {
    const { returnInit: state } = await chrome.storage.local.get("returnInit");
    document.getElementById("initStatus").textContent = state ? `${state.label || ""}${state.error ? `：${state.error}` : ""}` : "尚未初始化";
  }
  for (const name of ["initialize", "resume"]) document.getElementById(name).addEventListener("click", async () => {
    const buttons = [document.getElementById("initialize"), document.getElementById("resume")]; buttons.forEach(b => { b.disabled = true; });
    try {
      document.getElementById("initStatus").textContent = "正在识别登录账号…";
      const result = await chrome.runtime.sendMessage({ type: "mark-init", fresh: name === "initialize" });
      if (!result?.ok) throw new Error(result?.error || "初始化失败");
      await progress();
    } catch (error) { document.getElementById("initStatus").textContent = error.message; }
    finally { buttons.forEach(b => { b.disabled = false; }); }
  });
  chrome.storage.onChanged.addListener(changes => { if (changes.returnInit) progress(); });
  load().catch(error => { status.textContent = error.message; });
  progress();
})();
