"use strict";
const $ = (q, root = document) => root.querySelector(q);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  subscriptions: "M5 3h14v18l-7-4-7 4zM9 8h6M9 11h6",
  tasks: "M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1",
  library: "M4 3h16v18H4zM4 8h16M8 3v5M16 3v5M9 12l6 3-6 3z",
  connections:
    "M9 8l-2-2a3 3 0 0 0-4 4l4 4a3 3 0 0 0 4 0M15 16l2 2a3 3 0 0 0 4-4l-4-4a3 3 0 0 0-4 0M8 16l8-8",
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.library}"/></svg>`;
const pages = {
  search: "找片",
  subscriptions: "豆瓣片单",
  tasks: "下载",
  library: "我的片库",
  connections: "设置",
  setup: "开始使用",
};
const statuses = {
  queued: "等待提交",
  submitting: "正在提交",
  submitted: "已提交",
  downloading: "下载中",
  downloaded: "验证文件中",
  completed: "已入库",
  needs_review: "等待核对",
  failed: "失败",
  cancelled: "已取消",
  waiting: "等待资源",
  baseline: "历史基线",
};
const state = {
  page: "search",
  connections: [],
  results: [],
  query: "",
  epoch: 0,
  searched: false,
  libraryPath: "",
  quality: "all",
  resultLimit: 24,
};
const size = (n) =>
  !n
    ? "大小未知"
    : n > 1024 ** 3
      ? (n / 1024 ** 3).toFixed(1) + " GB"
      : (n / 1024 ** 2).toFixed(1) + " MB";
const when = (t) =>
  t
    ? new Date(t * 1000).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "尚未同步";
const badge = (s) =>
  `<span class="badge ${["needs_review", "downloaded", "waiting"].includes(s) ? "warning" : s === "failed" ? "danger" : ""}">${esc(statuses[s] || s)}</span>`;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").hidden = true), 4500);
}
function copyText(value, success) {
  const previous = document.activeElement;
  const buffer = document.createElement("textarea");
  buffer.className = "copy-buffer";
  buffer.value = value;
  buffer.setAttribute("aria-label", "待复制内容");
  document.body.append(buffer);
  buffer.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    /* Offer selectable text below. */
  }
  buffer.remove();
  previous?.focus({ preventScroll: true });
  if (copied) toast(success);
  else {
    openDialog(
      "复制链接",
      `<p>浏览器未允许直接复制。内容已选中，按 ⌘ C / Ctrl C，或长按复制。</p><div class="form-grid"><textarea id="copy-value" readonly aria-label="待复制内容">${esc(value)}</textarea></div>`,
    );
    $("#copy-value").select();
  }
}
async function api(path, body, method) {
  const res = await fetch("/api" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw Error("服务暂时不可用，请检查本地服务");
  }
  if (!res.ok) {
    throw Error(
      typeof data.detail === "string" ? data.detail : "请检查填写内容",
    );
  }
  return data;
}
function head(title, desc, action = "") {
  return `<div class="page-head"><div><h1>${title}</h1><p>${desc}</p></div>${action}</div>`;
}
function empty(title, desc, action = "", which = "library") {
  return `<div class="empty"><div class="empty-symbol">${icon(which)}</div><h3>${title}</h3><p>${desc}</p>${action}</div>`;
}
function navTo(page) {
  location.hash = page;
  if (state.page === page) render();
}
function downloaderOptions() {
  const options = state.connections.filter(
    (c) => c.kind === "cd2" && c.enabled,
  );
  return (
    (options.length === 1 ? "" : '<option value="">选择保存位置</option>') +
    options
      .map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`)
      .join("")
  );
}
function animateIn(root = $("#content")) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root
    .querySelectorAll(".result,.connection,.journey-item")
    .forEach((el, i) => {
      if (i < 30)
        el.animate(
          [
            { opacity: 0, transform: "translateY(18px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          {
            duration: 550,
            delay: Math.min(i * 45, 320),
            easing: "cubic-bezier(.22,1,.36,1)",
            fill: "backwards",
          },
        );
    });
}
async function render() {
  const previousPage = state.page;
  state.page = pages[location.hash.slice(1)]
    ? location.hash.slice(1)
    : previousPage === "setup"
      ? "setup"
      : "search";
  const epoch = ++state.epoch;
  try {
    state.connections = await api("/connections");
    if (epoch !== state.epoch) return;
    if (!state.connections.length && !location.hash) state.page = "setup";
    const html = await views[state.page]();
    if (epoch !== state.epoch) return;
    const update = () => {
      $("#nav").innerHTML = ["search", "tasks", "library"]
        .map(
          (id) =>
            `<a href="#${id}" class="${id === state.page ? "active" : ""}" ${id === state.page ? 'aria-current="page"' : ""}>${pages[id]}</a>`,
        )
        .join("");
      $("#content").classList.toggle(
        "search-active",
        state.page === "search" && state.searched,
      );
      $("#content").innerHTML = html;
      bindPage();
      if (previousPage !== state.page)
        window.scrollTo({ top: 0, behavior: "instant" });
      animateIn();
    };
    if (
      document.startViewTransition &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches &&
      $("#content").children.length
    )
      document.startViewTransition(update);
    else update();
  } catch (e) {
    if (epoch === state.epoch)
      $("#content").innerHTML =
        `<div class="notice">${esc(e.message)}</div><button class="button" data-action="refresh">重试</button>`;
  }
}
const views = {
  async setup() {
    const sources = state.connections.filter(
      (c) => c.enabled && c.kind !== "cd2",
    );
    const drives = state.connections.filter(
      (c) => c.enabled && c.kind === "cd2",
    );
    const subs = await api("/subscriptions");
    const card = (n, title, text, action, done) =>
      `<article class="connection"><div class="connection-head"><div class="service-icon">${n}</div><h3>${title}</h3><span class="badge">${done ? "已配置" : "待连接"}</span></div><p>${text}</p><div class="connection-actions">${action}</div></article>`;
    return (
      head(
        "三步，开始你的片库",
        "先找片，再连接保存位置。豆瓣自动跟进可以随时开启。",
      ) +
      `<div class="connection-grid setup-grid">${card(1, "连接检索", "导入服务提供者给你的授权文件，或连接自己的资源目录。每位用户使用独立授权。", '<button class="primary" data-action="gateway-import">导入检索授权</button><button class="text-button" data-action="connection">手动连接</button>', sources.length)}${card(2, "连接自己的 115", "先在 CD2 中登录自己的 115，再填入 CD2 地址、令牌和保存目录。", '<button class="primary" data-action="setup-drive">连接 CD2 / 115</button>', drives.length)}${card(3, "订阅豆瓣想看", "填入豆瓣用户 ID。首次同步保留历史，从新增条目开始自动找片；不需要豆瓣密码。", '<button class="button" data-action="subscription">添加豆瓣片单</button>', subs.length)}</div>` +
      `<section class="panel setup-check"><h2>检查后开始使用</h2><p>“已配置”表示信息已保存。点击测试确认当前服务可以访问。</p>${state.connections.map((c) => `<div class="result"><div class="result-main"><h3>${esc(c.name)}</h3></div><button class="button" data-test="${esc(c.id)}">测试连接</button></div>`).join("")}<button class="primary" data-nav="search">去找片 →</button><button class="text-button" data-action="import">已有种子？直接导入</button></section>`
    );
  },
  async search() {
    const sources = state.connections.filter(
      (c) => c.kind !== "cd2" && c.enabled,
    ).length;
    const downloader = state.connections.some(
      (c) => c.kind === "cd2" && c.enabled,
    );
    return `<section class="search-stage"><p class="eyebrow">YOUR NEXT GREAT WATCH</p><h1>下一部，<em>想看什么？</em></h1><p class="intro">搜到心仪的电影，存进自己的 115。</p><form class="search-form" id="search-form">${icon("search")}<input id="query" aria-label="搜索片名" placeholder="搜电影、剧集，或粘贴磁力链接" value="${esc(state.query)}" required maxlength="16384" autocomplete="off"><button class="primary" type="submit">找一找 <span>↗</span></button></form><div class="search-under"><span><i class="ready-dot"></i>${sources ? "已接入 " + sources + " 个搜索服务" : "尚未连接搜索服务"}</span><span>${downloader ? "115 下载已配置" : "可先找片，稍后连接 115"}</span><button class="text-button" data-action="import">导入种子<span class="kbd">⌘ K 搜索</span></button></div></section><div id="results">${state.searched ? (state.results.length ? resultsHTML() : empty("没有找到匹配的资源", "换个片名或更短的关键词试试。", "", "search")) : ""}</div>${!state.searched ? `<section class="discovery"><article class="cinema"><img src="/static/scene.svg" alt="" aria-hidden="true"><div class="cinema-text"><p class="eyebrow">FROM YOUR WISHLIST, TO YOUR LIBRARY</p><h2>留下一个想看。<br>把其余交给幕间。</h2><p>连接豆瓣片单，自动寻找新增的电影和剧集。<br>从发现到下载，让期待有个着落。</p><button class="light-button" data-nav="subscriptions">连接我的豆瓣 <span>↗</span></button></div><span class="cinema-caption">A MOMENT BETWEEN STORIES</span></article><div class="journey"><div class="journey-item"><span>01</span><div><strong>找一部想看的</strong><p>输入片名，统一搜索你的资源。</p></div></div><div class="journey-item"><span>02</span><div><strong>选一个喜欢的版本</strong><p>看清画质，再下载或复制磁力。</p></div></div><div class="journey-item"><span>03</span><div><strong>回片库，慢慢看</strong><p>存入自己的 115，进度随时可见。</p></div></div></div></section>` : ""}`;
  },
  async tasks() {
    const tasks = await api("/tasks");
    return (
      head(
        "下载中的好时光。",
        "选好的电影和剧集，进度都在这里。",
        '<button class="button" data-action="refresh">刷新状态 ↻</button>',
      ) +
      (!tasks.length
        ? `<div class="panel">${empty("还没有下载任务", "从搜索结果选择一个资源，开始你的第一次入库。", '<button class="primary" data-nav="search">去找片 →</button>', "tasks")}</div>`
        : `<div class="panel">${tasks.map((t) => `<div class="result"><div class="poster-mark">${icon("tasks")}</div><div class="result-main"><h3>${esc(t.title)}</h3><p>${esc(t.message || "即将提交到你的下载服务")}</p><div class="tags"><span class="tag">${when(t.created)}</span><span class="tag">${esc(t.folder)}</span></div></div><div class="result-actions">${badge(t.status)}${t.status === "downloading" ? `<div class="progress-track"><progress max="100" value="${Number(t.progress) || 0}"></progress></div>` : ""}${t.status === "queued" ? `<button class="button small-button" data-cancel="${t.id}">取消</button>` : ["failed", "cancelled", "needs_review"].includes(t.status) ? `<button class="button small-button" data-retry="${t.id}" data-uncertain="${t.status === "needs_review"}">${t.status === "needs_review" ? "核对后重试" : "重试"}</button>` : ""}</div></div>`).join("")}</div><div class="hint">提交结果不确定时自动核对远端，不会重复提交。已提交的任务可在 CD2 中处理；这里的取消仅作用于本地待提交任务。</div>`)
    );
  },
  async connections() {
    return (
      head(
        "把常用的服务连起来。",
        "配置一次，以后直接找片、下载。",
        '<button class="primary" data-action="connection">＋ 添加连接</button>',
      ) +
      `<div class="connection-grid">${state.connections.map((c) => `<article class="connection"><div class="connection-head"><div class="service-icon">${c.kind === "cd2" ? "CD" : c.kind === "alist" ? "AL" : c.kind === "gateway" ? "云" : "{ }"}</div><div><h3>${esc(c.name)}</h3><small>${c.kind === "cd2" ? "CloudDrive2 · 115 下载" : c.kind === "alist" ? "AList 兼容资源源" : c.kind === "gateway" ? "云端检索 · 上游信息由服务端保管" : "JSON 资源目录"}</small></div></div><p class="connection-url">${esc(c.config.url)}<br>${esc(c.config.root || "")}${c.has_token ? " · 已保存访问令牌" : ""}</p><div class="connection-actions"><button class="button small-button" data-test="${c.id}">测试连接</button><button class="button small-button" data-edit="${c.id}">编辑</button><button class="text-button" data-delete="${c.id}">移除</button>${!c.enabled ? '<span class="badge warning">已停用</span>' : ""}</div></article>`).join("")}<button class="connection add-connection" data-action="connection"><h3>＋ 连接一个新服务</h3><p>资源源、CD2 和你的 115</p></button></div><div class="hint">115 在你自己的 CD2 中登录，幕间使用 CD2 的访问令牌。首次下载前，请在 CD2 中建好入库根目录，并授权目录读取、创建和离线下载权限。</div><section class="panel"><div class="panel-head"><h2>当前自动化规则</h2><span class="badge">稳妥优先</span></div><div class="panel-body"><div class="step"><div class="step-num">01</div><div class="step-content"><strong>片名与年份准确匹配</strong><p>优先可播放文件，再按清晰度选择；未匹配成功的影片保留等待。</p></div></div><div class="step"><div class="step-num">02</div><div class="step-content"><strong>每部影片独立目录</strong><p>按片名与资源标识创建文件夹，不改动已有媒体，不自动删除文件。</p></div></div><div class="step"><div class="step-num">03</div><div class="step-content"><strong>定时补找与防重复</strong><p>豆瓣每 10 分钟同步，待匹配条目每 6 小时补找；同一下载连接按资源哈希去重。</p></div></div></div></section>`
    );
  },
  async subscriptions() {
    const subs = await api("/subscriptions");
    const items = await api("/watchlist");
    return (
      head(
        "在豆瓣点想看，然后呢？",
        "监控公开豆瓣片单，持续寻找新增的电影与剧集。",
        '<button class="primary" data-action="subscription">＋ 添加订阅</button>',
      ) +
      (subs.length
        ? `<div class="connection-grid">${subs.map((s) => `<article class="connection"><div class="connection-head"><div class="service-icon">豆</div><div><h3>${esc(s.name)}</h3><small>${esc(s.user_id)} · ${s.statuses.map((x) => ({ wish: "想看", do: "在看", collect: "看过" })[x]).join(" / ")}</small></div></div><p class="connection-url">${esc(s.message || "等待首次同步，历史记录默认不下载")}<br>${when(s.last_poll)}</p><div class="connection-actions"><button class="button small-button" data-sync="${s.id}">立即同步</button><button class="button small-button" data-sub-edit="${s.id}">编辑</button><span class="badge ${!s.enabled ? "warning" : ""}">${!s.enabled ? "已暂停" : s.auto_download ? "自动下载" : "仅同步片单"}</span></div></article>`).join("")}</div>`
        : `<div class="panel">${empty("一个「想看」，就是起点", "添加豆瓣用户 ID，选择监控的片单。首次同步建立历史基线，从此只跟进新增。", '<button class="button" data-action="subscription">添加我的片单 →</button>', "subscriptions")}</div>`) +
      `<div class="hint">仅同步可公开访问的片单。出现验证码、分页不完整或无法访问时停止本轮同步，保留原有基线。</div>` +
      (items.length
        ? `<section class="panel"><div class="panel-head"><h2>片单记录</h2><span class="small">${items.length} 部</span></div>${items.map((i) => `<div class="result"><div class="poster-mark">${icon("subscriptions")}</div><div class="result-main"><h3>${esc(i.title)}</h3><p>${i.year || "年份未知"} · 豆瓣条目 ${esc(i.subject_id)}</p></div><div class="result-actions">${badge(i.status)}<button class="button small-button" data-search-title="${esc(i.title)}">找资源</button></div></div>`).join("")}</section>`
        : "")
    );
  },
  async library() {
    const drives = state.connections.filter(
      (c) => c.kind === "cd2" && c.enabled,
    );
    if (!drives.length)
      return (
        head("你的电影，都在这里。", "浏览自己 115 里的片库。") +
        empty(
          "先连接你的 115",
          "通过 CD2 连接后，就能直接浏览已有的电影和剧集。",
          '<button class="primary" data-nav="connections">连接 115 →</button>',
        )
      );
    const drive = drives.find((c) => c.id === state.libraryDrive) || drives[0];
    state.libraryDrive = drive.id;
    const data = await api(
      "/library/browse?connection_id=" +
        encodeURIComponent(drive.id) +
        "&path=" +
        encodeURIComponent(state.libraryPath),
    );
    const displayPath = data.path.slice(data.root.length) || "全部影片";
    return (
      head(
        "你的电影，都在这里。",
        "直接浏览 115 片库，已有的电影也在。",
        '<button class="button" data-action="refresh">刷新 ↻</button>',
      ) +
      (drives.length > 1
        ? `<div class="result-toolbar"><select id="library-drive" class="inline-select" aria-label="选择片库">${drives.map((c) => `<option value="${esc(c.id)}" ${c.id === drive.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>`
        : "") +
      `<section class="panel"><div class="library-navigation">${data.parent ? `<button class="button small-button" data-folder="${esc(data.parent)}">← 返回上层</button><button class="text-button" data-folder="">片库首页</button>` : `<span class="ready-dot"></span><span>${esc(drive.name)}</span>`}<span>${esc(displayPath)}</span><span class="small">${data.items.length} 项</span></div>${data.items.length ? data.items.map((f) => `<article class="result ${f.is_dir ? "folder-row" : ""}"><div class="poster-mark">${icon(f.is_dir ? "subscriptions" : "library")}</div><div class="result-main"><h3>${esc(f.name)}</h3><span class="small">${f.is_dir ? "文件夹" : size(f.size)}</span></div><div class="result-actions">${f.is_dir ? `<button class="button small-button" data-folder="${esc(f.path)}" aria-label="打开 ${esc(f.name)}">打开 →</button>` : `<button class="text-button" data-path="${esc(f.path)}">复制路径 ↗</button>`}</div></article>`).join("") : empty("这个文件夹还是空的", "去找一部喜欢的电影，添加到片库。", '<button class="button" data-nav="search">去找片 →</button>')}</section>`
    );
  },
};
function visibleResults() {
  return state.results
    .filter(
      (r) => state.quality === "all" || r.resolution === Number(state.quality),
    )
    .sort((a, b) => (b.resolution || 0) - (a.resolution || 0));
}
function resultsHTML() {
  const all = visibleResults();
  return `<div class="result-toolbar"><p>找到 <strong>${state.results.length}</strong> 个资源</p><div><select id="downloader" aria-label="保存位置" class="inline-select">${downloaderOptions()}</select><button class="button" data-action="export">导出磁力列表 ↓</button></div></div><div class="quality-tabs" role="group" aria-label="按画质筛选">${[
    ["all", "全部"],
    ["2160", "4K 超清"],
    ["1080", "1080p"],
    ["720", "720p"],
  ]
    .map(
      ([v, label]) =>
        `<button data-quality="${v}" class="${state.quality === v ? "selected" : ""}" aria-pressed="${state.quality === v}">${label}<small>${v === "all" ? state.results.length : state.results.filter((r) => r.resolution === Number(v)).length}</small></button>`,
    )
    .join("")}<span>清晰度从高到低</span></div><div class="panel">${
    all.length
      ? all
          .slice(0, state.resultLimit)
          .map((r) => {
            const source = state.connections.find((c) => c.id === r.source_id);
            return `<article class="result"><div class="poster-mark">${icon("library")}</div><div class="result-main"><h3>${esc(r.title)} ${r.year ? `<span class="small">(${r.year})</span>` : ""}</h3><p>${esc(r.name || r.title)}</p><div class="tags">${r.resolution ? `<span class="tag">${r.resolution === 2160 ? "4K" : r.resolution + "p"}</span>` : ""}${r.size ? `<span class="tag">${size(r.size)}</span>` : ""}<span class="tag">${esc(source?.name || "本地导入")}</span><span class="tag">${r.format === "torrent" ? "种子资源" : "磁力资源"}</span></div></div><div class="result-actions"><button class="button small-button" data-copy="${r.id}">复制磁力</button><button class="primary small-button" data-download="${r.id}">存入 115 ↓</button></div></article>`;
          })
          .join("")
      : empty(
          "这个画质暂时没有资源",
          "切换到全部，看看其他版本。",
          "",
          "search",
        )
  }</div>${all.length > state.resultLimit ? `<div class="load-more"><button class="button" data-action="more">再看 24 个版本 ↓</button><p>已显示 ${state.resultLimit} / ${all.length} 个资源</p></div>` : ""}`;
}
function openDialog(title, html) {
  $("#dialog-content").innerHTML =
    `<div class="dialog-head"><h2>${title}</h2><button class="text-button" data-close aria-label="关闭对话框">✕</button></div><div class="dialog-body">${html}</div>`;
  $("#dialog").showModal();
}
const formEnd = (label) =>
  `<div class="error" id="form-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button" data-close>取消</button><button type="submit" class="primary">${label}</button></div></form>`;
function formHandler(fn) {
  const form = $("#modal-form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const button = $("button[type=submit]", form);
    button.disabled = true;
    $("#form-error").textContent = "";
    try {
      await fn(new FormData(form));
      $("#dialog").close();
      render();
    } catch (e) {
      $("#form-error").textContent = e.message;
    } finally {
      button.disabled = false;
    }
  });
}
function connectionDialog(id, preset) {
  const c = state.connections.find((x) => x.id === id);
  openDialog(
    c ? "编辑连接" : "连接你的服务",
    `<p>填写自己服务的地址和访问令牌，凭据仅保存在本机。</p><form id="modal-form"><div class="form-grid"><div><label for="conn-name">连接名称</label><input id="conn-name" name="name" required maxlength="100" placeholder="例如：我的资源目录" value="${esc(c?.name || "")}"></div><div><label for="conn-kind">服务类型</label><select id="conn-kind" name="kind">${[
      ["gateway", "云端检索网关"],
      ["alist", "AList 兼容资源源"],
      ["json", "JSON 资源目录"],
      ["cd2", "CD2 · 115 下载连接"],
    ]
      .map(
        ([v, n]) =>
          `<option value="${v}" ${(c?.kind || preset) === v ? "selected" : ""}>${n}</option>`,
      )
      .join(
        "",
      )}</select></div><div><label for="conn-url">服务地址</label><input id="conn-url" name="url" type="url" required placeholder="https://your-service.example" value="${esc(c?.config.url || "")}"><p class="form-note">CD2 填写 http(s)://主机:端口；JSON 源填写完整目录文件地址。</p></div><div><label for="conn-token">访问令牌</label><input id="conn-token" name="token" type="password" autocomplete="new-password" placeholder="${c?.has_token ? "已保存，留空保持不变" : "填写此服务的访问令牌"}"></div><div><label for="conn-root">目录路径</label><input id="conn-root" name="root" value="${esc(c?.config.root || "/")}" placeholder="/115/Movies"><p class="form-note">资源源：搜索根目录；CD2：已存在的入库根目录；JSON 源和云端网关忽略。</p></div><label class="check"><input name="enabled" type="checkbox" ${c && !c.enabled ? "" : "checked"}>启用这个连接</label></div>${formEnd("保存连接")}`,
  );
  formHandler(async (f) => {
    await api("/connections", {
      ...(c ? { id: c.id } : {}),
      name: f.get("name"),
      kind: f.get("kind"),
      config: {
        url: f.get("url"),
        token: f.get("token"),
        ...(f.get("kind") === "gateway" ? {} : { root: f.get("root") }),
        ...(f.get("kind") !== "gateway" && c?.config.strip_prefix
          ? { strip_prefix: c.config.strip_prefix }
          : {}),
      },
      enabled: f.has("enabled"),
    });
    toast("连接已保存，可点击测试连接");
  });
}
function importDialog() {
  openDialog(
    "导入种子或磁力",
    `<p>资源留在自己的目录里。导入后可以列出、复制或提交下载。</p><form id="modal-form"><div class="form-grid"><div><label for="import-title">影片或资源名称</label><input id="import-title" name="title" required placeholder="例如：电影名称 2024 1080p" maxlength="200"></div><div><label for="import-magnet">磁力链接</label><textarea id="import-magnet" name="magnet" placeholder="magnet:?xt=urn:btih:…"></textarea></div><div><label for="import-file">或选择 .torrent 文件</label><input id="import-file" name="file" type="file" accept=".torrent"><p class="form-note">支持 BT v1 与混合种子，最大 8 MiB。</p></div></div>${formEnd("导入资源")}`,
  );
  formHandler(async (f) => {
    let torrent = "";
    const file = f.get("file");
    if (file?.size) {
      if (file.size > 8 * 1024 * 1024) throw Error("种子不能超过 8 MiB");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let raw = "";
      for (let i = 0; i < bytes.length; i += 8192)
        raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
      torrent = btoa(raw);
    }
    const r = await api("/import", {
      title: f.get("title"),
      magnet: f.get("magnet").trim(),
      torrent,
    });
    state.query = r.title;
    state.results = [r];
    state.searched = true;
    location.hash = "search";
    toast("资源已导入，尚未提交下载");
  });
}
async function subscriptionDialog(id) {
  const subs = id ? await api("/subscriptions") : [];
  const s = subs.find((x) => x.id === id);
  openDialog(
    s ? "编辑片单订阅" : "订阅豆瓣片单",
    `<p>使用豆瓣个人主页中的用户 ID，无需把豆瓣密码交给幕间。</p><form id="modal-form"><div class="form-grid"><div><label for="sub-name">订阅名称</label><input id="sub-name" name="name" required value="${esc(s?.name || "我的豆瓣片单")}"></div><div><label for="sub-user">豆瓣用户 ID</label><input id="sub-user" name="user_id" required pattern="[A-Za-z0-9_-]{1,80}" value="${esc(s?.user_id || "")}" ${s ? "readonly" : ""} placeholder="个人主页 people/ 后面的 ID"></div><div><label>监控的片单</label>${[
      ["wish", "想看"],
      ["do", "在看"],
      ["collect", "看过"],
    ]
      .map(
        ([v, n]) =>
          `<label class="check"><input type="checkbox" name="statuses" value="${v}" ${(s?.statuses || ["wish"]).includes(v) ? "checked" : ""} ${s ? "disabled" : ""}>${n}</label>`,
      )
      .join(
        "",
      )}</div><label class="check"><input type="checkbox" name="auto_download" ${s?.auto_download ? "checked" : ""}>为新增条目自动找片并下载</label><div><label for="sub-downloader">下载连接</label><select id="sub-downloader" name="downloader_id">${downloaderOptions()}</select></div>${!s ? '<label class="check"><input type="checkbox" name="import_history">首次同步也下载历史片单（默认关闭）</label>' : ""}<label class="check"><input type="checkbox" name="enabled" ${s && !s.enabled ? "" : "checked"}>启用定时同步</label></div>${formEnd("保存订阅")}`,
  );
  if (s) $("#sub-downloader").value = s.downloader_id;
  formHandler(async (f) => {
    const statuses = s ? s.statuses : f.getAll("statuses");
    if (!statuses.length) throw Error("至少选择一种片单");
    await api("/subscriptions", {
      ...(s ? { id: s.id } : {}),
      name: f.get("name"),
      user_id: f.get("user_id"),
      statuses,
      auto_download: f.has("auto_download"),
      downloader_id: f.get("downloader_id"),
      import_history: s ? s.import_history || false : f.has("import_history"),
      enabled: f.has("enabled"),
    });
    toast("订阅已保存，将在后台同步");
  });
}
function bindPage() {
  const drives = $("#library-drive");
  if (drives)
    drives.onchange = () => {
      state.libraryDrive = drives.value;
      state.libraryPath = "";
      render();
    };
  const form = $("#search-form");
  if (form)
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const query = $("#query").value.trim();
      if (!query) return;
      state.query = query;
      const epoch = state.epoch;
      const button = $("button", form);
      button.disabled = true;
      $("#content").classList.add("search-pending", "search-active");
      $(".discovery")?.remove();
      $("#results").innerHTML =
        '<div class="loading">正在为你寻找…</div><div class="skeleton"></div><div class="skeleton"></div>';
      try {
        let data;
        if (query.startsWith("magnet:?")) {
          const dn =
            new URLSearchParams(query.slice(8)).get("dn") || "导入的磁力资源";
          const item = await api("/import", {
            title: dn.slice(0, 200),
            magnet: query,
          });
          data = { items: [item], errors: [] };
        } else {
          if (query.length > 100) throw Error("片名请保持在 100 字以内");
          data = await api("/search?q=" + encodeURIComponent(query));
        }
        if (epoch !== state.epoch) return;
        state.results = data.items;
        state.quality = "all";
        state.resultLimit = 24;
        state.searched = true;
        $("#results").innerHTML =
          data.errors
            .map(
              (e) =>
                `<div class="notice">${esc(e.source)}：${esc(e.message)}</div>`,
            )
            .join("") +
          (data.items.length
            ? resultsHTML()
            : empty(
                "暂时没找到这部片",
                "换个片名或更短的关键词试试。",
                '<button class="text-button" data-nav="connections">检查搜索服务 →</button>',
                "search",
              ));
        animateIn($("#results"));
      } catch (e) {
        if (epoch === state.epoch)
          $("#results").innerHTML =
            `<div class="notice">${esc(e.message)}</div>`;
      } finally {
        if (epoch === state.epoch)
          $("#content").classList.remove("search-pending");
        button.disabled = false;
      }
    });
}
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.dataset.close !== undefined) {
    $("#dialog").close();
    return;
  }
  if (b.dataset.nav) {
    navTo(b.dataset.nav);
    return;
  }
  try {
    b.disabled = true;
    const action = b.dataset.action;
    if (b.dataset.quality !== undefined || action === "more") {
      const chosen = $("#downloader")?.value;
      if (b.dataset.quality !== undefined) {
        state.quality = b.dataset.quality;
        state.resultLimit = 24;
      } else state.resultLimit += 24;
      $("#results").innerHTML = resultsHTML();
      if (chosen && $("#downloader")) $("#downloader").value = chosen;
      animateIn($("#results"));
    }
    if (b.dataset.folder !== undefined) {
      state.libraryPath = b.dataset.folder;
      await render();
    }
    if (b.dataset.path) {
      copyText(b.dataset.path, "片库路径已复制");
    }
    if (action === "refresh") await render();
    if (action === "connection") connectionDialog();
    if (action === "setup-drive") connectionDialog(undefined, "cd2");
    if (action === "gateway-import") {
      openDialog(
        "导入检索授权",
        '<p>选择服务提供者发给你的 JSON 授权文件。授权仅保存在本机，请勿公开分享。</p><form id="modal-form"><input name="bundle" type="file" accept=".json,application/json" required aria-label="检索授权文件">' +
          formEnd("连接检索"),
      );
      formHandler(async (f) => {
        const file = f.get("bundle");
        if (!file || file.size > 16384) throw Error("请选择有效的授权文件");
        let bundle;
        try {
          bundle = JSON.parse(await file.text());
        } catch {
          throw Error("授权文件格式不正确");
        }
        if (
          typeof bundle.url !== "string" ||
          typeof bundle.token !== "string" ||
          !bundle.token
        )
          throw Error("授权文件缺少地址或令牌");
        await api("/connections", {
          name: "云端检索",
          kind: "gateway",
          config: { url: bundle.url, token: bundle.token },
          enabled: true,
        });
        toast("检索授权已保存，请测试连接");
      });
    }
    if (action === "import") importDialog();
    if (action === "subscription") await subscriptionDialog();
    if (action === "export") {
      const selected = visibleResults();
      if (selected.length > 100)
        throw Error("单次最多导出 100 条，请缩小搜索范围");
      const magnets = [];
      for (const r of selected)
        magnets.push((await api("/resources/" + r.id + "/resolve", {})).magnet);
      const url = URL.createObjectURL(
        new Blob([magnets.join("\n") + "\n"], { type: "text/plain" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "cinebridge-magnets.txt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("磁力列表已导出");
    }
    if (b.dataset.edit) connectionDialog(b.dataset.edit);
    if (b.dataset.test)
      toast(
        (await api("/connections/" + b.dataset.test + "/test", {})).message,
      );
    if (b.dataset.delete && confirm("移除此连接？已下载文件不会被删除。")) {
      await api("/connections/" + b.dataset.delete, undefined, "DELETE");
      render();
    }
    if (b.dataset.copy) {
      const r = await api("/resources/" + b.dataset.copy + "/resolve", {});
      copyText(r.magnet, "磁力链接已复制");
    }
    if (b.dataset.download) {
      const id = $("#downloader")?.value;
      if (!id) throw Error("请先选择一个 CD2 下载连接");
      const t = await api("/tasks", {
        resource_id: b.dataset.download,
        downloader_id: id,
      });
      toast(
        t.status === "queued"
          ? "已加入下载，幕间会继续帮你处理"
          : "下载状态：" + (statuses[t.status] || t.status),
      );
      b.textContent = "已加入 ✓";
      $("#download-dock").hidden = false;
      $("#dock-label").textContent = "已加入下载 · 查看进度";
    }
    if (b.dataset.cancel) {
      await api("/tasks/" + b.dataset.cancel + "/cancel", {});
      render();
    }
    if (
      b.dataset.retry &&
      confirm(
        b.dataset.uncertain === "true"
          ? "仅在你已打开 CD2 并确认没有这项任务时继续。重新提交可能产生重复下载，确定已核对？"
          : "请确认已处理 CD2 中的失败任务，再重新提交。",
      )
    ) {
      await api("/tasks/" + b.dataset.retry + "/retry", {
        confirm_not_submitted: b.dataset.uncertain === "true",
      });
      render();
    }
    if (b.dataset.sync) {
      toast("正在读取完整豆瓣片单，请稍候");
      await api("/subscriptions/" + b.dataset.sync + "/sync", {});
      render();
      toast("片单同步完成");
    }
    if (b.dataset.subEdit) await subscriptionDialog(b.dataset.subEdit);
    if (b.dataset.searchTitle) {
      state.query = b.dataset.searchTitle;
      state.results = [];
      navTo("search");
    }
  } catch (e) {
    toast(e.message);
  } finally {
    b.disabled = false;
  }
});
$("#quick-import").onclick = importDialog;
window.addEventListener("hashchange", render);
document.addEventListener("keydown", async (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") {
    ev.preventDefault();
    if (state.page !== "search") {
      location.hash = "search";
    } else $("#query")?.focus();
  }
});
$("#dialog").addEventListener("click", (ev) => {
  if (ev.target === $("#dialog")) {
    const r = ev.target.getBoundingClientRect();
    if (
      ev.clientX < r.left ||
      ev.clientX > r.right ||
      ev.clientY < r.top ||
      ev.clientY > r.bottom
    )
      ev.target.close();
  }
});
async function refreshDock() {
  try {
    const tasks = await api("/tasks");
    const active = tasks.filter((t) =>
      [
        "queued",
        "submitting",
        "submitted",
        "downloading",
        "downloaded",
      ].includes(t.status),
    );
    $("#download-dock").hidden = !active.length;
    $("#dock-label").textContent = `${active.length} 部正在下载 · 查看进度`;
    if (
      state.page === "tasks" &&
      !$("#dialog").open &&
      document.visibilityState === "visible"
    )
      await render();
  } catch {
    /* Manual refresh still provides visible errors. */
  }
}
render();
refreshDock();
setInterval(refreshDock, 12000);
