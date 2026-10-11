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
  overview: "概览",
  search: "搜片",
  subscriptions: "片单与订阅",
  tasks: "任务中心",
  library: "媒体库",
  connections: "连接与规则",
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
  token: sessionStorage.getItem("cinebridge-token") || "",
  page: "overview",
  connections: [],
  results: [],
  query: "",
  epoch: 0,
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
async function api(path, body, method) {
  const res = await fetch("/api" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      Authorization: "Bearer " + state.token,
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
    if (res.status === 401) showLogin();
    throw Error(
      typeof data.detail === "string" ? data.detail : "请检查填写内容",
    );
  }
  return data;
}
function showLogin() {
  state.token = "";
  sessionStorage.removeItem("cinebridge-token");
  $("#shell").hidden = true;
  $("#login").hidden = false;
}
function showApp() {
  $("#login").hidden = true;
  $("#shell").hidden = false;
  render();
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
  return (
    '<option value="">选择下载连接</option>' +
    state.connections
      .filter((c) => c.kind === "cd2" && c.enabled)
      .map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`)
      .join("")
  );
}
async function render() {
  state.page = pages[location.hash.slice(1)]
    ? location.hash.slice(1)
    : "overview";
  const epoch = ++state.epoch;
  $("#crumb").textContent = pages[state.page];
  $("#nav").innerHTML = Object.entries(pages)
    .map(
      ([id, name]) =>
        `<a href="#${id}" class="${id === state.page ? "active" : ""}">${icon(id)}${name}</a>`,
    )
    .join("");
  $("#content").innerHTML = '<div class="loading">正在载入工作台…</div>';
  try {
    state.connections = await api("/connections");
    if (epoch !== state.epoch) return;
    const html = await views[state.page]();
    if (epoch !== state.epoch) return;
    $("#content").innerHTML = html;
    bindPage();
  } catch (e) {
    if (epoch === state.epoch)
      $("#content").innerHTML =
        `<div class="notice">${esc(e.message)}</div><button class="button" data-action="refresh">重试</button>`;
  }
}
const views = {
  async overview() {
    const o = await api("/overview");
    const c = o.counts;
    const sources = state.connections.filter(
      (x) => x.kind !== "cd2" && x.enabled,
    ).length;
    const downloaders = state.connections.filter(
      (x) => x.kind === "cd2" && x.enabled,
    ).length;
    const active = [
      "queued",
      "submitted",
      "submitting",
      "downloading",
      "downloaded",
    ].reduce((n, k) => n + (c[k] || 0), 0);
    return (
      head("你的片库，从这里连接。", "片单、资源与下载，在同一个工作空间里。") +
      `<section class="hero"><div class="hero-text"><p class="eyebrow">LESS MANAGING. MORE WATCHING.</p><h2>每一个想看，<br>都有通往片库的路。</h2><p>连接自己的服务，让找片、下载和入库自然衔接。</p><div class="hero-actions"><button class="primary" data-nav="search">${icon("search")} 开始找片</button><button class="secondary" data-nav="connections">管理连接 ↗</button></div></div><div class="hero-art" aria-hidden="true"><div class="art-orbit"></div><div class="film">▷</div></div></section><section class="stats">${[
        [
          "已连接服务",
          state.connections.filter((x) => x.enabled).length,
          "由你配置，由你掌控",
          "connections",
        ],
        ["进行中任务", active, "提交与下载状态分开记录", "tasks"],
        [
          "已验证入库",
          c.completed || 0,
          "下载完成，并已找到媒体文件",
          "library",
        ],
        [
          "片单订阅",
          o.subscriptions,
          "每 10 分钟检查新增条目",
          "subscriptions",
        ],
      ]
        .map(
          ([label, n, note, i]) =>
            `<div class="stat"><div class="stat-label">${label}${icon(i)}</div><div class="stat-number">${n}<span></span></div><div class="stat-note">${note}</div></div>`,
        )
        .join(
          "",
        )}</section><div class="two-col"><section class="panel"><div class="panel-head"><h2>搭好你的观影工作流</h2><span class="small">${Number(sources > 0) + Number(downloaders > 0) + Number(o.subscriptions > 0)} / 3 已配置</span></div><div class="panel-body">${[
        [
          sources,
          "接入一个资源源",
          "连接自己的资源目录，或先导入种子试试。",
          "connections",
        ],
        [
          downloaders,
          "连接 CD2 与 115",
          "使用自己的账号，选择媒体保存目录。",
          "connections",
        ],
        [
          o.subscriptions,
          "订阅你的豆瓣片单",
          "新增想看自动找片，历史记录默认只建基线。",
          "subscriptions",
        ],
      ]
        .map(
          ([done, title, desc, page], i) =>
            `<div class="step"><div class="step-num ${done ? "done" : ""}">${done ? "✓" : String(i + 1).padStart(2, "0")}</div><div class="step-content"><strong>${title}</strong><p>${desc}</p></div><button class="arrow" data-nav="${page}" aria-label="${title}">↗</button></div>`,
        )
        .join(
          "",
        )}</div></section><section class="panel"><div class="panel-head"><h2>最近动态</h2><button class="text-button" data-nav="tasks">查看任务 →</button></div>${
        o.events.length
          ? `<div class="panel-body">${o.events
              .slice(0, 4)
              .map(
                (e) =>
                  `<div class="event">${esc(e.message)}<small>${when(e.created)}</small></div>`,
              )
              .join("")}</div>`
          : empty(
              "准备好，接住下一部好电影",
              "任务入库后，处理记录会出现在这里。",
              "",
              "tasks",
            )
      }</section></div>${o.worker.message ? `<div class="notice">${esc(o.worker.message)}</div>` : ""}`
    );
  },
  async search() {
    return (
      head("找一部，想看的。", "搜索自己的资源源，先看候选，再决定是否下载。") +
      `<form class="search-form" id="search-form">${icon("search")}<input id="query" aria-label="搜索片名" placeholder="输入电影、剧集名称…" value="${esc(state.query)}" required maxlength="100"><button class="primary" type="submit">搜索资源 →</button></form><div class="search-suggestions"><span>自己的资源源</span><span>种子与磁力</span><span>支持只搜索、不下载</span></div><div id="results">${state.results.length ? resultsHTML() : `<div class="panel">${empty("好电影的下一站，是你的片库", state.connections.some((c) => c.kind !== "cd2") ? "输入片名，搜索所有已启用的资源源。" : "还没有连接资源源。可以连接自己的目录，也可以导入磁力或种子。", '<button class="button" data-nav="connections">配置资源源</button><button class="text-button" data-action="import">导入种子或磁力 ↗</button>', "search")}</div>`}</div>`
    );
  },
  async tasks() {
    const tasks = await api("/tasks");
    return (
      head(
        "每一步，都看得见。",
        "从等待提交到文件验证，保留真实的处理状态。",
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
        "你的服务，由你连接。",
        "独立的账号与资源源，不依赖共享接口。",
        '<button class="primary" data-action="connection">＋ 添加连接</button>',
      ) +
      `<div class="connection-grid">${state.connections.map((c) => `<article class="connection"><div class="connection-head"><div class="service-icon">${c.kind === "cd2" ? "CD" : c.kind === "alist" ? "AL" : "{ }"}</div><div><h3>${esc(c.name)}</h3><small>${c.kind === "cd2" ? "CloudDrive2 · 115 下载" : c.kind === "alist" ? "AList 兼容资源源" : "JSON 资源目录"}</small></div></div><p class="connection-url">${esc(c.config.url)}<br>${esc(c.config.root || "")}${c.has_token ? " · 已保存访问令牌" : ""}</p><div class="connection-actions"><button class="button small-button" data-test="${c.id}">测试连接</button><button class="button small-button" data-edit="${c.id}">编辑</button><button class="text-button" data-delete="${c.id}">移除</button>${!c.enabled ? '<span class="badge warning">已停用</span>' : ""}</div></article>`).join("")}<button class="connection add-connection" data-action="connection"><h3>＋ 连接一个新服务</h3><p>资源源、CD2 和你的 115</p></button></div><div class="hint">115 在你自己的 CD2 中登录，片桥使用 CD2 的访问令牌。首次下载前，请在 CD2 中建好入库根目录，并授权目录读取、创建和离线下载权限。</div><section class="panel"><div class="panel-head"><h2>当前自动化规则</h2><span class="badge">稳妥优先</span></div><div class="panel-body"><div class="step"><div class="step-num">01</div><div class="step-content"><strong>片名与年份准确匹配</strong><p>优先可播放文件，再按清晰度选择；未匹配成功的影片保留等待。</p></div></div><div class="step"><div class="step-num">02</div><div class="step-content"><strong>每部影片独立目录</strong><p>按片名与资源标识创建文件夹，不改动已有媒体，不自动删除文件。</p></div></div><div class="step"><div class="step-num">03</div><div class="step-content"><strong>定时补找与防重复</strong><p>豆瓣每 10 分钟同步，待匹配条目每 6 小时补找；同一下载连接按资源哈希去重。</p></div></div></div></section>`
    );
  },
  async subscriptions() {
    const subs = await api("/subscriptions");
    const items = await api("/watchlist");
    return (
      head(
        "把「想看」，接到片库。",
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
    const items = await api("/library");
    return (
      head(
        "好电影，已经在这里。",
        "只展示远端下载完成、并已验证媒体文件的任务。",
      ) +
      (items.length
        ? `<div class="panel">${items.map((t) => `<article class="result"><div class="poster-mark">${icon("library")}</div><div class="result-main"><h3>${esc(t.title)}</h3><p>${esc(t.folder)}</p>${t.files.map((f) => `<div class="library-file">${esc(f.name)} <span class="tag">${size(f.size)}</span></div>`).join("")}</div>${badge("completed")}</article>`).join("")}</div>`
        : `<div class="panel">${empty("片库正在等待第一部电影", "完成下载后，片桥会验证目标目录里的媒体文件，再把它放到这里。", '<button class="primary" data-nav="search">发现下一部 →</button>', "library")}</div>`)
    );
  },
};
function resultsHTML() {
  return `<div class="result-toolbar"><p>找到 <strong>${state.results.length}</strong> 个候选资源</p><div><select id="downloader" aria-label="下载连接" class="inline-select">${downloaderOptions()}</select><button class="button" data-action="export">导出磁力 ↓</button></div></div><div class="panel">${state.results
    .map((r) => {
      const source = state.connections.find((c) => c.id === r.source_id);
      return `<article class="result"><div class="poster-mark">${icon("library")}</div><div class="result-main"><h3>${esc(r.title)} ${r.year ? `<span class="small">(${r.year})</span>` : ""}</h3><p>${esc(r.name || r.title)}</p><div class="tags">${r.resolution ? `<span class="tag">${r.resolution}p</span>` : ""}<span class="tag">${r.size ? size(r.size) : r.torrent_bytes ? "种子文件 " + size(r.torrent_bytes) : "媒体大小未知"}</span><span class="tag">${esc(source?.name || "本地导入")}</span><span class="tag">${esc(r.format)}</span></div></div><div class="result-actions"><button class="button small-button" data-copy="${r.id}">复制磁力</button><button class="primary small-button" data-download="${r.id}">下载 ↓</button></div></article>`;
    })
    .join("")}</div>`;
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
function connectionDialog(id) {
  const c = state.connections.find((x) => x.id === id);
  openDialog(
    c ? "编辑连接" : "连接你的服务",
    `<p>填写自己服务的地址和访问令牌，凭据仅保存在本机。</p><form id="modal-form"><div class="form-grid"><div><label for="conn-name">连接名称</label><input id="conn-name" name="name" required maxlength="100" placeholder="例如：我的资源目录" value="${esc(c?.name || "")}"></div><div><label for="conn-kind">服务类型</label><select id="conn-kind" name="kind">${[
      ["alist", "AList 兼容资源源"],
      ["json", "JSON 资源目录"],
      ["cd2", "CD2 · 115 下载连接"],
    ]
      .map(
        ([v, n]) =>
          `<option value="${v}" ${c?.kind === v ? "selected" : ""}>${n}</option>`,
      )
      .join(
        "",
      )}</select></div><div><label for="conn-url">服务地址</label><input id="conn-url" name="url" type="url" required placeholder="https://your-service.example" value="${esc(c?.config.url || "")}"><p class="form-note">CD2 填写 http(s)://主机:端口；JSON 源填写完整目录文件地址。</p></div><div><label for="conn-token">访问令牌</label><input id="conn-token" name="token" type="password" autocomplete="new-password" placeholder="${c?.has_token ? "已保存，留空保持不变" : "填写此服务的访问令牌"}"></div><div><label for="conn-root">目录路径</label><input id="conn-root" name="root" value="${esc(c?.config.root || "/")}" placeholder="/115/Movies"><p class="form-note">资源源：搜索根目录；CD2：已存在的入库根目录；JSON 源忽略。</p></div><label class="check"><input name="enabled" type="checkbox" ${c && !c.enabled ? "" : "checked"}>启用这个连接</label></div>${formEnd("保存连接")}`,
  );
  formHandler(async (f) => {
    await api("/connections", {
      ...(c ? { id: c.id } : {}),
      name: f.get("name"),
      kind: f.get("kind"),
      config: { url: f.get("url"), token: f.get("token"), root: f.get("root") },
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
    location.hash = "search";
    toast("资源已导入，尚未提交下载");
  });
}
async function subscriptionDialog(id) {
  const subs = id ? await api("/subscriptions") : [];
  const s = subs.find((x) => x.id === id);
  openDialog(
    s ? "编辑片单订阅" : "订阅豆瓣片单",
    `<p>使用豆瓣个人主页中的用户 ID，无需把豆瓣密码交给片桥。</p><form id="modal-form"><div class="form-grid"><div><label for="sub-name">订阅名称</label><input id="sub-name" name="name" required value="${esc(s?.name || "我的豆瓣片单")}"></div><div><label for="sub-user">豆瓣用户 ID</label><input id="sub-user" name="user_id" required pattern="[A-Za-z0-9_-]{1,80}" value="${esc(s?.user_id || "")}" ${s ? "readonly" : ""} placeholder="个人主页 people/ 后面的 ID"></div><div><label>监控的片单</label>${[
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
  const form = $("#search-form");
  if (form)
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      state.query = $("#query").value.trim();
      const button = $("button", form);
      button.disabled = true;
      $("#results").innerHTML =
        '<div class="loading">正在搜索你的资源源…</div>';
      try {
        const data = await api("/search?q=" + encodeURIComponent(state.query));
        state.results = data.items;
        $("#results").innerHTML =
          data.errors
            .map(
              (e) =>
                `<div class="notice">${esc(e.source)}：${esc(e.message)}</div>`,
            )
            .join("") +
          (data.items.length
            ? resultsHTML()
            : `<div class="panel">${empty("暂时没有匹配的资源", "试试其他片名或更短的关键词，也可以检查资源源是否建立索引。", "", "search")}</div>`);
      } catch (e) {
        $("#results").innerHTML = `<div class="notice">${esc(e.message)}</div>`;
      } finally {
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
    if (action === "refresh") await render();
    if (action === "connection") connectionDialog();
    if (action === "import") importDialog();
    if (action === "subscription") await subscriptionDialog();
    if (action === "export") {
      if (state.results.length > 100)
        throw Error("单次最多导出 100 条，请缩小搜索范围");
      const magnets = [];
      for (const r of state.results)
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
      await navigator.clipboard.writeText(r.magnet);
      toast("磁力链接已复制");
    }
    if (b.dataset.download) {
      const id = $("#downloader")?.value;
      if (!id) throw Error("请先选择一个 CD2 下载连接");
      const t = await api("/tasks", {
        resource_id: b.dataset.download,
        downloader_id: id,
      });
      toast("任务状态：" + (statuses[t.status] || t.status));
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
$("#logout").onclick = showLogin;
$("#login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  state.token = $("#access-key").value.trim();
  try {
    await api("/overview");
    sessionStorage.setItem("cinebridge-token", state.token);
    $("#access-key").value = "";
    showApp();
  } catch (e) {
    $("#login-error").textContent = e.message;
  }
});
window.addEventListener("hashchange", () => {
  if (state.token) render();
});
if (state.token) showApp();
else showLogin();
