"use strict";
/* Watching Everything 前端。
 * 规则：不做切页/进场动画；不写内联 style 与内联事件（CSP）；后台刷新内容不变不动 DOM。 */

const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const enc = encodeURIComponent;

const PAGES = ["search", "subscriptions", "tasks", "library", "connections", "setup"];
const PAGE_TITLES = {
  search: "找片",
  subscriptions: "豆瓣片单",
  tasks: "下载",
  library: "片库",
  connections: "设置",
  setup: "开始使用",
};
const STATUS = {
  queued: "排队中",
  submitting: "正在提交",
  submitted: "已交给 CD2",
  downloading: "下载中",
  downloaded: "正在校验文件",
  completed: "已入库",
  needs_review: "需要核对",
  failed: "下载失败",
  cancelled: "已取消",
  waiting: "未找到资源",
  baseline: "订阅前已标记",
};
const STATUS_NOTE = {
  queued: "排队中，马上提交到 CD2",
  submitting: "正在提交到 CD2",
  submitted: "已交给 CD2，等待开始下载",
  downloading: "CD2 正在下载",
  downloaded: "下载完成，正在确认文件",
  completed: "已入库，文件已确认",
  needs_review: "没有收到 CD2 的明确回复，需要你在 CD2 里核对",
  failed: "CD2 下载失败",
  cancelled: "已取消，没有提交到 CD2",
};
const ACTIVE = ["queued", "submitting", "submitted", "downloading", "downloaded"];
const ATTENTION = ["failed", "needs_review"];
const KIND_NAME = { gateway: "云端检索", alist: "AList 资源源", json: "JSON 资源目录", cd2: "CD2 · 115" };
const KIND_ICON = { gateway: "云", alist: "AL", json: "{ }", cd2: "CD" };
const LIST_NAME = { wish: "想看", do: "在看", collect: "看过" };
const VIDEO_EXT = /\.(mkv|mp4|m2ts|ts|iso|avi|rmvb|wmv|mov|webm|flv|m4v|vob)$/i;

const state = {
  page: "",
  params: new URLSearchParams(),
  routeKey: null,
  epoch: 0,
  html: "",
  rendered: false,
  connections: [],
  tasks: null,
  // 找片
  query: "",
  queryYear: null,
  results: [],
  errors: [],
  searched: false,
  searching: false,
  searchError: "",
  searchStart: 0,
  searchCtl: null,
  searchEpoch: 0,
  film: "all",
  quality: "all",
  resultLimit: 24,
  added: new Map(),
  imported: [],
  downloader: "",
  exporting: "",
  focusSearch: false,
  note: "",
  // 片单
  subText: "",
  // 片库
  libText: "",
  crumbsOpen: false,
  libraryCount: null,
  libraryCountAt: 0,
  // 设置
  testResults: {},
};

const storage = {
  get(area, key) {
    try {
      return window[area].getItem(key);
    } catch {
      return null;
    }
  },
  set(area, key, value) {
    try {
      if (value === null) window[area].removeItem(key);
      else window[area].setItem(key, value);
    } catch {
      /* 存储不可用时按默认处理 */
    }
  },
};

/* ---------- 通用工具 ---------- */

const pad = (n) => String(n).padStart(2, "0");
function stamp(t, withDate = true) {
  if (!t) return "";
  const d = new Date(t * 1000);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withDate ? `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${hm}` : hm;
}
const size = (n) =>
  !n ? "" : n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(1) + " GB" : n >= 1024 ** 2 ? (n / 1024 ** 2).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
const short = (s, n = 40) => {
  const t = String(s || "");
  return t.length > n ? t.slice(0, n) : t;
};
const drives = () => state.connections.filter((c) => c.kind === "cd2" && c.enabled);
const sources = () => state.connections.filter((c) => c.kind !== "cd2" && c.enabled);

function badge(s, text) {
  const cls = ACTIVE.includes(s)
    ? "active"
    : s === "failed"
      ? "danger"
      : s === "needs_review"
        ? "warning"
        : s === "cancelled"
          ? "nodot"
          : s === "waiting"
            ? "waiting"
            : "muted";
  return `<span class="badge ${cls}">${esc(text || STATUS[s] || s)}</span>`;
}

class FieldError extends Error {
  constructor(message, field) {
    super(message);
    this.field = field;
  }
}

async function api(path, body, method, signal) {
  let res;
  try {
    res = await fetch("/api" + path, {
      method: method || (body === undefined ? "GET" : "POST"),
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw Error("连不上本地服务，请确认 Watching Everything 正在运行。");
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw Error("连不上本地服务，请确认 Watching Everything 正在运行。");
  }
  if (!res.ok) throw Error(typeof data.detail === "string" ? data.detail : "请检查填写的内容。");
  return data;
}

function announce(text) {
  const el = $("#announcer");
  el.textContent = "";
  setTimeout(() => (el.textContent = text), 50);
}

/* 按钮忙碌态：禁用 + 进行时文字，返回恢复函数 */
function busy(b, text) {
  const original = b.textContent;
  b.disabled = true;
  b.textContent = text;
  return () => {
    if (!b.isConnected) return;
    b.disabled = false;
    b.textContent = original;
  };
}

/* ---------- Toast ---------- */

function toast(message, { error = false, action = null } = {}) {
  const box = $("#toast");
  const act = $("#toast-action");
  $("#toast-text").textContent = message;
  box.setAttribute("role", error ? "alert" : "status");
  box.classList.toggle("error", error);
  act.hidden = !action;
  act.textContent = action ? action.label : "";
  toast.action = action ? action.run : null;
  $("#toast-close").hidden = !error;
  clearTimeout(hideToast.timer);
  box.hidden = false;
  requestAnimationFrame(() => box.classList.add("show"));
  clearTimeout(toast.timer);
  toast.timer = setTimeout(hideToast, error ? 8000 : 4000);
}
function hideToast() {
  const box = $("#toast");
  box.classList.remove("show");
  toast.action = null;
  clearTimeout(hideToast.timer);
  hideToast.timer = setTimeout(() => (box.hidden = true), motionOK() ? 260 : 0);
}
const toastError = (e) => toast(e.message || String(e), { error: true });

/* ---------- 复制 ---------- */

function copyFallback(value, success) {
  const buffer = document.createElement("textarea");
  buffer.className = "copy-buffer";
  buffer.value = value;
  buffer.setAttribute("aria-hidden", "true");
  document.body.append(buffer);
  buffer.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    /* 下面给可选中的文本 */
  }
  buffer.remove();
  if (copied) return toast(success);
  openDialog(
    "复制",
    `<p class="lead">浏览器没有允许直接复制，内容已选中，请按 ⌘C 复制。</p><textarea id="copy-value" class="copy-value" readonly aria-label="待复制内容">${esc(value)}</textarea>`,
    `<button type="button" class="button" data-close>关闭</button>`,
  );
  $("#copy-value").focus();
  $("#copy-value").select();
}
/* 点击当下就申请剪贴板写入（ClipboardItem 接受 Promise），避免等网络后失去用户手势 */
async function copyText(valueOrPromise, success) {
  const promise = Promise.resolve(valueOrPromise);
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      const item = new ClipboardItem({
        "text/plain": promise.then((t) => new Blob([t], { type: "text/plain" })),
      });
      await navigator.clipboard.write([item]);
      toast(success);
      return;
    } catch {
      /* 解析失败会在下面重新抛出；剪贴板被拒则走兜底 */
    }
  }
  const text = await promise;
  copyFallback(text, success);
}

/* ---------- 路由 ---------- */

function parseRoute() {
  const raw = location.hash.slice(1);
  const i = raw.indexOf("?");
  const page = i < 0 ? raw : raw.slice(0, i);
  return { page: PAGES.includes(page) ? page : "", params: new URLSearchParams(i < 0 ? "" : raw.slice(i + 1)), key: raw };
}
function go(hash) {
  if (location.hash.slice(1) === hash) render();
  else location.hash = hash;
}
function searchHash(q, extra = {}) {
  const p = new URLSearchParams({ q, ...extra });
  return "search?" + p.toString();
}
function libraryHash(path, driveId) {
  const p = new URLSearchParams();
  if (path) p.set("path", path);
  if (driveId && drives().length > 1) p.set("drive", driveId);
  const s = p.toString();
  return "library" + (s ? "?" + s : "");
}

/* ---------- 动效：只在进入页面时入场、滚动到才出现；后台刷新一律不动 ---------- */

const motionOK = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
function moveNavIndicator() {
  const nav = $("#nav");
  let ind = $(".nav-ind", nav);
  if (!ind) {
    ind = document.createElement("span");
    ind.className = "nav-ind";
    ind.setAttribute("aria-hidden", "true");
    nav.append(ind);
  }
  const a = $("#nav a.active");
  if (!a) return ind.classList.remove("on");
  ind.style.width = a.offsetWidth - 20 + "px";
  ind.style.transform = `translateX(${a.offsetLeft + 10}px)`;
  ind.classList.add("on");
  // 第一次定位不滑动，之后切换才滑
  if (!ind.dataset.ready) requestAnimationFrame(() => (ind.dataset.ready = "1"));
}
addEventListener("resize", moveNavIndicator);
document.fonts?.ready.then(moveNavIndicator);

let revealObserver;
function revealOnScroll(el, delay = 0) {
  el.classList.add("reveal");
  if (delay) el.style.transitionDelay = delay + "ms";
  if (!("IntersectionObserver" in window)) return el.classList.add("in");
  revealObserver ||= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        revealObserver.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  revealObserver.observe(el);
}
function settleRise(root) {
  $$(".rise, .rise-sm", root).forEach((el) => {
    el.classList.remove("rise", "rise-sm");
    el.style.animationDelay = "";
  });
}
function rise(el, delay, small = false) {
  el.style.animationDelay = delay + "ms";
  el.classList.add(small ? "rise-sm" : "rise");
}
// 换页后的入场：标题依次浮现，列表前几行错落进场，首屏以下的区块滚到才出现
function animateEnter(content) {
  clearTimeout(animateEnter.timer);
  if (!motionOK()) return;
  content.classList.add("entering");
  const fold = innerHeight * 0.92;
  let t = 240;
  for (const block of content.children) {
    if (block.matches(".page-head, .hero")) continue;
    const rows = block.matches(".list") ? [...block.children] : $$(".list > *", block);
    if (rows.length) {
      $$(".section-head, .segmented, .result-toolbar, .sub-card, .note", block).forEach((el) => rise(el, t, true));
      rows.slice(0, 14).forEach((row, i) => {
        if (row.getBoundingClientRect().top < fold) rise(row, t + 40 + i * 35, true);
      });
      t += 80;
      continue;
    }
    const parts = block.matches(".tiles") ? [...block.children] : [block];
    parts.forEach((el, i) => {
      if (el.getBoundingClientRect().top < fold) rise(el, t + i * 90);
      else revealOnScroll(el, i * 120);
    });
    t += 80;
  }
  animateEnter.timer = setTimeout(() => {
    content.classList.remove("entering");
    settleRise(content);
  }, 1800);
}

function syncNav() {
  $$("#nav a").forEach((a) => {
    const on = a.dataset.page === state.page;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  moveNavIndicator();
  const s = $(".settings-button");
  s.classList.toggle("active", state.page === "connections");
  if (state.page === "connections") s.setAttribute("aria-current", "page");
  else s.removeAttribute("aria-current");
}

/* 只替换有变化的节点，保留未变化节点（焦点、滚动、下拉框都不动） */
function morph(live, next) {
  const a = [...live.children];
  const b = [...next.children];
  const textOnly = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const same =
    a.length === b.length &&
    a.every((x, i) => x.tagName === b[i].tagName && (x.dataset.key || "") === (b[i].dataset.key || "")) &&
    !textOnly(live) &&
    !textOnly(next);
  if (!same) {
    live.replaceChildren(...next.childNodes);
    return;
  }
  a.forEach((x, i) => {
    const y = b[i];
    if (x.isEqualNode(y)) return;
    const attrsSame =
      x.attributes.length === y.attributes.length && [...x.attributes].every((at) => y.getAttribute(at.name) === at.value);
    if (attrsSame && x.children.length && !["SELECT", "TEXTAREA", "PROGRESS"].includes(x.tagName)) morph(x, y);
    else x.replaceWith(y);
  });
}
function patch(target, html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  morph(target, t.content);
}
const FOCUS_KEYS = ["test", "edit", "delete", "cancel", "retry", "undo", "download", "copy", "folder", "sync", "subEdit", "search", "action", "filter", "quality", "key"];
function focusKey(el) {
  if (!el || el === document.body || !$("#content").contains(el)) return null;
  if (el.id) return "#" + CSS.escape(el.id);
  for (const k of FOCUS_KEYS) {
    if (el.dataset[k] !== undefined) {
      const attr = "data-" + k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      return `[${attr}="${CSS.escape(el.dataset[k])}"]`;
    }
  }
  return null;
}
function restoreFocus(key) {
  if (!key || (document.activeElement && document.activeElement !== document.body)) return;
  const el = $(key, $("#content"));
  if (el) el.focus({ preventScroll: true });
}
function focusH1() {
  const h = $("#content h1");
  if (h) h.focus({ preventScroll: true });
}

async function render({ silent = false } = {}) {
  const r = parseRoute();
  const epoch = ++state.epoch;
  state.pendingKey = r.key;
  state.inflight = true;
  const routeChanged = r.key !== state.routeKey;
  const previousPage = state.page;
  state.page = r.page || "search";
  state.params = r.params;
  // 离开找片页后，上一条历史就不一定是片单了，「‹ 返回片单」改为直接跳回片单
  if (state.page !== "search") state.cameFromSubs = false;
  syncNav();
  updateDock();
  // 换页面或换文件夹都清空片库筛选，避免筛选条件带进看不到筛选框的子文件夹
  if (routeChanged) state.libText = "";
  state.renderSilent = silent;
  const content = $("#content");
  let loading;
  if (!silent && routeChanged) {
    loading = setTimeout(() => {
      if (epoch !== state.epoch) return;
      content.className = "";
      content.innerHTML = head(PAGE_TITLES[state.page]) + '<div class="wrap"><div class="placeholder"></div><div class="placeholder"></div><div class="placeholder"></div></div>';
      state.html = "";
    }, 300);
  }
  let html;
  try {
    // 后台静默刷新只发页面自己需要的请求，连接列表沿用已有的
    if (!silent || !state.connLoaded) {
      state.connections = await api("/connections");
      state.connLoaded = true;
    }
    if (epoch !== state.epoch) return;
    if (!r.page && !state.connections.length && !state.rendered) {
      history.replaceState(null, "", "#setup");
      state.page = "setup";
      syncNav();
    }
    html = await views[state.page]();
  } catch (e) {
    if (epoch !== state.epoch) return;
    html = pageError(state.page, e.message);
  }
  clearTimeout(loading);
  if (epoch !== state.epoch) return;
  state.inflight = false;
  if (silent && html === state.html) return;
  const keep = focusKey(document.activeElement);
  const enter = (routeChanged || !state.html) && !silent;
  content.className = "page-" + state.page;
  content.classList.toggle("search-active", state.page === "search" && searchActive());
  if (routeChanged || !state.html) content.innerHTML = html;
  else patch(content, html);
  state.html = html;
  state.routeKey = r.key;
  afterRender[state.page]?.(routeChanged);
  if (enter) animateEnter(content);
  if (routeChanged && !silent) {
    if (!afterRender.keepScroll) window.scrollTo(0, 0);
    afterRender.keepScroll = false;
    if (state.rendered && !state.focusSearch) focusH1();
  } else restoreFocus(keep);
  if (state.focusSearch && state.page === "search") {
    state.focusSearch = false;
    const q = $("#query");
    if (q) {
      q.focus({ preventScroll: true });
      q.select();
    }
  }
  state.rendered = true;
}

function head(title, desc = "", actions = "", extra = "") {
  return `<div class="page-head wrap"><div class="head-text"><h1 tabindex="-1">${title}</h1>${desc ? `<p class="subtitle">${desc}</p>` : ""}${extra}</div>${actions ? `<div class="head-actions">${actions}</div>` : ""}</div>`;
}
function empty(title, desc = "", action = "") {
  return `<div class="empty"><h3>${title}</h3>${desc ? `<p>${desc}</p>` : ""}${action ? `<div class="empty-action">${action}</div>` : ""}</div>`;
}
function pageError(page, message) {
  // 找片页出错时标题和搜索框照常保留
  if (page === "search") return heroHTML("", "") + `<div id="results" class="wrap results"><div class="notice">页面没有加载成功：${esc(message)}<button class="button small-button" data-action="refresh">重试</button></div></div>`;
  return head(PAGE_TITLES[page]) + `<div class="wrap"><div class="notice">页面没有加载成功：${esc(message)}<button class="button small-button" data-action="refresh">重试</button></div></div>`;
}

/* ---------- 片名解析 ---------- */

const AD_RE = /(www|\.com|\.net|\.org|\.cc|\.me|高清|首发|更多|访问|发布|下载|论坛|影视|字幕组|bt\d|电影天堂)/i;
const TAG_WORDS = /字幕|音轨|配音|中字|中文|中英|双语|简繁|繁简|国语|粤语|国粤|多音轨|杜比|视界|版本|特效|原盘|电影|左右|半宽|全\d+集|\d+(?:\.\d+)?\s*G[B]?|HDR|4K|DIY|3D|BT|MKV|MP4|\d{3,4}p/gi;
/* 方括号里去掉标签词后几乎没有汉字，就当作标签 */
const isTag = (b) => (String(b).replace(TAG_WORDS, "").match(/[一-鿿]/g) || []).length < 2;
function stripAds(raw) {
  return String(raw)
    .replace(/【([^】]*)】/g, (m, inner) => (AD_RE.test(inner) || isTag(inner) ? " " : ` ${inner} `))
    .replace(/\[([^\]]*)\]/g, (m, inner) => (AD_RE.test(inner) || /www|\.(com|net|org|cc|me)/i.test(inner) ? " " : m))
    .trim();
}
// "Death.on.the.Nile.2022.2160p.BluRay" -> { title: "Death on the Nile", year: 2022, quality: "4K" }
function parseRelease(raw) {
  let name = stripAds(String(raw).replace(VIDEO_EXT, "").replace(/\.(nfo|srt|ass|jpg|png|txt)$/i, ""));
  const cjk = [...name.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]).find((b) => /[一-鿿]/.test(b) && !isTag(b));
  name = name.replace(/\[[^\]]*\]/g, " ");
  const year = name.match(/(?:^|[ ._(\-])((?:19|20)\d{2})(?=$|[ ._)\-])/);
  const headPart = (year ? name.slice(0, year.index) : name.split(/[ ._](?:2160p|1080p|720p|4k|uhd|bluray|blu-ray|web|remux)/i)[0])
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tidy = (t) => t.replace(/[(（][^)）]*[)）]/g, "").replace(/[._]+/g, " ").trim();
  const zhHead = (headPart.match(/[一-鿿][一-鿿·：:！0-9]*(?: [一-鿿][一-鿿·：:！0-9]*)*/) || [""])[0].trim();
  const en = headPart.replace(/[一-鿿·：]+/g, " ").replace(/\s+/g, " ").trim();
  const zh = zhHead || (cjk ? tidy(cjk) : "");
  const quality = /2160p|4k|uhd/i.test(raw) ? "4K" : /1080p/i.test(raw) ? "1080p" : /720p/i.test(raw) ? "720p" : "";
  let title = zh && en && headPart.indexOf(en) < headPart.indexOf(zh) ? headPart : zh || en;
  title = title.replace(/^[\s\-_·]+|[\s\-_·]+$/g, "");
  // 兜底：解析结果仍带网址或广告字样，或解析不出，就显示原名
  if (!title || /www|\.com|\bcom\b/i.test(title)) title = String(raw);
  return { title, year: year ? +year[1] : null, quality };
}

/* 搜索结果的片名规整：去编号前缀、方括号标签、4K 后缀，全角半角统一 */
function normalizeTitle(t) {
  let s = stripAds(t)
    .replace(/\[([^\]]*)\]/g, (m, inner) => (/[一-鿿]/.test(inner) && !isTag(inner) ? ` ${inner} ` : " "))
    .replace(/[[\]【】]/g, " ")
    .replace(/^\s*\d{2,5}(?:[.、]\s*|\s+)/, "")
    .replace(/\s*4k\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return s || String(t || "").trim();
}
/* 分组用的片名：中文片名 + 紧跟的单个英文词（如「犯罪现场 Zero」），续集后缀统一成数字，
 * 「1」「I」「二部曲」「合集」「1+2」这类去掉，归到第一部 */
const SEQ_TAG = /^(?:3D|2D|4K|HDR|DV|DoVi|MKV|MP4|ISO|BD|WEB|DIY|UHD|REMUX|BluRay|HDTV|S\d+|E\d+|\d{3,4}p)$/i;
function filmTitle(t, loose = false) {
  const s = stripAds(t)
    .replace(/[[【]([^\]】]*)[\]】]/g, (m, inner) => (/[一-鿿]/.test(inner) && !isTag(inner) ? ` | ${inner} | ` : " | "))
    .replace(/[[\]【】]/g, " | ")
    .replace(/^[\s|]*\d{2,5}(?:[.、]\s*|\s+)/, "")
    .replace(/ⅠⅡ|Ⅰ\s*[+&]\s*Ⅱ|(?<![0-9])1\s*[+&-]\s*2(?![0-9])|\bI\s*[+&]\s*II\b/g, "合集")
    .normalize("NFKC");
  // 按方括号、加号、括号切段，取第一个能解析出中文片名的段
  const re = /([^|+(（/]*)([|+(（/]|$)/g;
  let m;
  while ((m = re.exec(s)) && m[0]) {
    const at = m[1].search(/[一-鿿]/);
    if (at < 0) continue;
    const seg = m[1].slice(at);
    let head = seg.match(/^[一-鿿][一-鿿·：:！0-9]*(?:(?:IV|I{1,3})(?![a-z])|\s(?:IV|I{1,3})(?=\s*$|\s+(?:\d|3D)))?/)[0];
    // 「沙丘4k」里的 4 是画质不是续集
    if (/\d$/.test(head) && /^[kKpP]/.test(seg.slice(head.length))) head = head.replace(/\d+$/, "");
    let title = head;
    // 片名里紧跟的单个英文词（如「犯罪现场 Zero[全10集]」），要后面紧接方括号才算，避免把英文译名算进来
    const word = seg.slice(head.length).match(/^[ .]([A-Za-z][A-Za-z0-9]+)\s*$/);
    if (word && (m[2] === "|" || (loose && !m[2])) && !SEQ_TAG.test(word[1]) && !/^(?:IV|I{1,3})$/.test(word[1])) title += " " + word[1];
    title = title
      .replace(/(?:合集|全集|系列|[二三四五]部曲|[二三四五]部合集|加长版|导演剪辑版|未删减版|完整版)+$/, "")
      .replace(/\s*IV$/, "4")
      .replace(/\s*III$/, "3")
      .replace(/\s*II$/, "2")
      .replace(/(?<=[一-鿿])\s*I$/, "")
      .replace(/(?<=[一-鿿])1$/, "")
      .replace(/[\s：:·！]+$/, "")
      .trim();
    if (title) return title;
  }
  const n = normalizeTitle(t);
  return n.split(/\s(?:2160p|1080p|720p|uhd|bluray|web)/i)[0].trim() || n;
}

/* ---------- 找片 ---------- */

function searchActive() {
  return !!(state.params.get("q") || state.searching || state.imported.length);
}
function dedupe(items) {
  const seen = new Set();
  return items.filter((r) => {
    const k = r.name || r.title;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
const rank = (r) => {
  const n = r.name || r.title || "";
  if (/remux|原盘|bdmv/i.test(n)) return 0;
  if (/blu-?ray|bdrip/i.test(n)) return 1;
  if (/web/i.test(n)) return 3;
  return 2;
};
let groupCache = { results: null, groups: [], keyOf: new Map() };
function filmGroups() {
  if (groupCache.results === state.results) return groupCache.groups;
  const map = new Map();
  const keyOf = new Map();
  for (const r of state.results) {
    const title = filmTitle(r.title || r.name);
    const key = title + "|" + (r.year || "");
    keyOf.set(r, key);
    if (!map.has(key)) map.set(key, { key, title, year: r.year || null, count: 0 });
    map.get(key).count++;
  }
  // 年份未知的资源：同名的有年份组只有一个就并进去；有多个时按原名里的英文词和关键词找最像的那组，
  // 只有一组明显更像才并，否则单独列为「年份未知」，宁可单列也不并错
  const words = (r) => new Set(String(r.name || r.title || "").toLowerCase().match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,}/g) || []);
  for (const g of [...map.values()]) {
    if (g.year) continue;
    const same = [...map.values()].filter((x) => x.title === g.title && x.year);
    if (!same.length) continue;
    const pools = same.map((x) => {
      const pool = new Set();
      for (const [r, k] of keyOf) if (k === x.key) for (const w of words(r)) pool.add(w);
      return pool;
    });
    for (const [r, k] of [...keyOf]) {
      if (k !== g.key) continue;
      let target = same.length === 1 ? same[0] : null;
      if (!target) {
        // 只看能区分各组的词：所有组都有的词（画质、编码、片名英文）不算
        const own = [...words(r)].filter((w) => !pools.every((p) => p.has(w)));
        const scores = pools.map((p) => own.filter((w) => p.has(w)).length);
        const best = Math.max(...scores);
        if (best > 0 && scores.filter((x) => x === best).length === 1) target = same[scores.indexOf(best)];
      }
      if (!target) continue;
      target.count++;
      g.count--;
      keyOf.set(r, target.key);
    }
    if (!g.count) map.delete(g.key);
  }
  const groups = [...map.values()].sort((a, b) => b.count - a.count);
  groupCache = { results: state.results, groups, keyOf };
  return groups;
}
function filmKey(r) {
  filmGroups();
  return groupCache.keyOf.get(r);
}
function filmFiltered() {
  return state.film === "all" ? state.results : state.results.filter((r) => filmKey(r) === state.film);
}
function visibleResults() {
  return filmFiltered()
    .filter((r) => state.quality === "all" || r.resolution === Number(state.quality))
    .sort((a, b) => (b.resolution || 0) - (a.resolution || 0) || rank(a) - rank(b));
}
const qLabel = (r) => (r.resolution === 2160 ? "4K" : r.resolution ? r.resolution + "p" : "");
function currentDownloader() {
  const list = drives();
  if (!list.length) return null;
  const pick = list.find((c) => c.id === state.downloader) || list.find((c) => c.id === storage.get("localStorage", "we.lastDownloader")) || list[0];
  state.downloader = pick.id;
  return pick;
}

// 结果没有 size 时从原名里解析，例如 1.61GB、700MB
function sizeFromName(name) {
  const m = String(name || "").match(/(\d+(?:\.\d+)?)\s?(GB|GiB|G|MB|MiB|M)(?![a-z])/i);
  if (!m) return 0;
  return Number(m[1]) * 1024 ** (/^g/i.test(m[2]) ? 3 : 2);
}
function resultRow(r) {
  const source = state.connections.find((c) => c.id === r.source_id);
  const name40 = short(r.name || r.title);
  const title = normalizeTitle(r.title || r.name);
  const added = state.added.get(r.id);
  let action;
  if (!drives().length) action = `<button class="text-button" data-action="setup-drive">连接 115 后可存入</button>`;
  else if (added) action = `<button class="primary small-button save-button" disabled>${esc(added)}</button>`;
  else action = `<button class="primary small-button save-button" data-download="${esc(r.id)}" aria-label="存入 115：${esc(name40)}">存入 115</button>`;
  // 只有一个搜索服务时不写来源；来源找不到时也不写
  const srcName = sources().length > 1 ? source?.name || "" : "";
  const meta = [qLabel(r) ? `<span class="q">${qLabel(r)}</span>` : "", [size(r.size || sizeFromName(r.name)), r.format === "torrent" ? "种子" : "磁力", srcName].filter(Boolean).map(esc).join(" · ")].join("");
  return `<article class="result" data-key="${esc(r.id)}"><div class="result-main"><h3 tabindex="-1">${esc(title)}${r.year ? `<span class="small">${r.year}</span>` : ""}</h3>${r.name && r.name !== r.title ? `<p class="raw">${esc(r.name)}</p>` : ""}<p class="meta">${meta}</p></div><div class="result-actions"><button class="text-button copy-button" data-copy="${esc(r.id)}" aria-label="复制磁力：${esc(name40)}">复制磁力</button>${action}</div></article>`;
}

function saveLine() {
  const list = drives();
  if (!list.length) return `<p class="save-line">还没连接 115。<button class="text-button" data-action="setup-drive">去连接</button></p>`;
  const d = currentDownloader();
  const name =
    list.length > 1
      ? `<select id="downloader" class="inline-select" aria-label="保存到哪个 115">${list.map((c) => `<option value="${esc(c.id)}"${c.id === d.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`
      : esc(d.name);
  return `<p class="save-line">保存到 ${name}<span class="save-root"> · ${esc(d.config.root || "/")}</span></p>`;
}

function importedHTML() {
  if (!state.imported.length) return "";
  return `<section class="imported"><div class="section-head"><h2>刚导入</h2><button class="text-button" data-action="clear-imported">清除</button></div><div class="list">${state.imported.map(resultRow).join("")}</div></section>`;
}

function searchingHTML() {
  return `<div class="searching"><p id="search-status">${esc(searchStatusText())}</p><button class="text-button" data-action="cancel-search">取消</button></div>`;
}
function searchStatusText() {
  const sec = Math.floor((Date.now() - state.searchStart) / 1000);
  if (sec < 5) return `正在搜索 ${sources().length || 1} 个搜索服务…`;
  return `正在搜索，已用 ${sec} 秒…` + (sec >= 20 ? " 资源多的影片通常要 30 秒左右。" : "");
}

function resultsHTML() {
  if (!state.searched) return "";
  const notices = state.errors.map((e) => `<div class="notice">${esc(e.source)}没有返回结果：${esc(e.message)}</div>`).join("");
  if (!state.results.length)
    return notices + empty("没有找到资源", "换个片名，或只输入片名的前几个字。", '<button class="primary" data-nav="connections">检查搜索服务</button>');
  const groups = filmGroups();
  const filmed = filmFiltered();
  const all = visibleResults();
  const shown = all.slice(0, state.resultLimit);
  let filmSelect = "";
  if (groups.length > 1) {
    const label = (g) => `${esc(g.title)} · ${g.year || "年份未知"} · ${g.count}`;
    filmSelect = `<select id="film" class="inline-select film-select" aria-label="按影片筛选"><option value="all">全部影片 ${state.results.length}</option>${groups
      .map((g) => `<option value="${esc(g.key)}"${g.key === state.film ? " selected" : ""}>${label(g)}</option>`)
      .join("")}</select>`;
  }
  const qCount = (v) => (v === "all" ? filmed.length : filmed.filter((r) => r.resolution === Number(v)).length);
  const tabs = `<div class="segmented" role="group" aria-label="按画质筛选">${[
    ["all", "全部"],
    ["2160", "4K"],
    ["1080", "1080p"],
    ["720", "720p"],
  ]
    .filter(([v]) => v === "all" || state.quality === v || qCount(v) > 0)
    .map(([v, l]) => `<button data-quality="${v}" class="${state.quality === v ? "selected" : ""}" aria-pressed="${state.quality === v}">${l}<small>${qCount(v)}</small></button>`)
    .join("")}</div>`;
  const list = all.length ? `<div class="list" id="result-list">${shown.map(resultRow).join("")}</div>` : empty("这个画质下没有资源", "切换到「全部」查看其他版本。");
  const more =
    all.length > state.resultLimit
      ? `<div class="load-more"><button class="button" data-action="more">显示更多</button><p>已显示 ${shown.length} / ${all.length}</p></div>`
      : "";
  const exportLine =
    all.length > 100
      ? `<p class="export-line"><button class="text-button" disabled>导出当前列表的磁力链接</button><span>先用影片或画质筛选到 100 条以内</span></p>`
      : all.length
        ? `<p class="export-line"><button class="text-button" data-action="export"${state.exporting ? " disabled" : ""}>${state.exporting || "导出当前列表的磁力链接"}</button></p>`
        : "";
  return `${notices}<div class="result-toolbar"><p class="count">找到 <strong>${state.results.length}</strong> 个资源</p><div class="filter-bar">${filmSelect}${tabs}</div></div>${saveLine()}${list}${more}${exportLine}`;
}

function resultsAreaHTML() {
  let body = "";
  if (state.searching) body = searchingHTML();
  else if (state.searchError) body = `<div class="notice">${esc(state.searchError)}</div>`;
  else if (state.params.get("q") || state.page !== "search") body = resultsHTML();
  return importedHTML() + body;
}

function paintResults({ animate = false, from = 0 } = {}) {
  const box = $("#results");
  if (!box) return;
  const keep = focusKey(document.activeElement);
  box.innerHTML = resultsAreaHTML();
  // 新结果、换筛选时行错落浮现；更新按钮状态之类的重绘不动
  if (animate && motionOK()) {
    $$(".result-toolbar, .segmented", box).forEach((el) => rise(el, 0, true));
    $$("#result-list > *", box)
      .slice(from, from + 14)
      .forEach((row, i) => rise(row, 60 + i * 35, true));
    clearTimeout(paintResults.timer);
    paintResults.timer = setTimeout(() => settleRise(box), 1400);
  }
  $("#content").classList.toggle("search-active", searchActive());
  const btn = $("#search-submit");
  if (btn) {
    btn.textContent = state.searching ? "搜索中…" : "搜索";
    btn.setAttribute("aria-disabled", String(state.searching));
  }
  restoreFocus(keep);
}

function searchNote(html) {
  const el = $("#search-note");
  if (!el) return;
  el.innerHTML = html;
  el.hidden = !html;
}

async function runSearch(query, year) {
  state.searchCtl?.abort();
  const ctl = new AbortController();
  state.searchCtl = ctl;
  const epoch = ++state.searchEpoch;
  const startHash = location.hash.slice(1);
  state.query = query;
  state.queryYear = year || null;
  state.searching = true;
  state.searchError = "";
  state.searchStart = Date.now();
  searchNote("");
  paintResults();
  clearInterval(runSearch.timer);
  runSearch.timer = setInterval(() => {
    const el = $("#search-status");
    if (el && state.searching) el.textContent = searchStatusText();
  }, 1000);
  try {
    const data = await api("/search?q=" + enc(query), undefined, "GET", ctl.signal);
    if (epoch !== state.searchEpoch) return;
    state.results = dedupe(data.items || []);
    state.errors = data.errors || [];
    state.searched = true;
    // 只有真正完成的搜索才记为「上一次搜索」，和当前结果一一对应
    state.lastSearch = { query, year: year || null, hash: startHash };
    state.quality = "all";
    state.resultLimit = 24;
    state.film = "all";
    if (year) {
      const want = filmTitle(query, true);
      const g = filmGroups().find((x) => x.year === Number(year) && (x.title === want || x.title.includes(want) || want.includes(x.title)));
      if (g) state.film = g.key;
    }
    announce(state.results.length ? `找到 ${state.results.length} 个资源` : "没有找到资源");
  } catch (e) {
    if (e.name === "AbortError") return;
    if (epoch !== state.searchEpoch) return;
    state.searched = false;
    state.searchError = e.message;
  } finally {
    if (epoch === state.searchEpoch) {
      clearInterval(runSearch.timer);
      state.searching = false;
      state.searchCtl = null;
      if (state.page === "search") paintResults({ animate: true });
    }
  }
}
function cancelSearch() {
  if (!state.searching) return;
  state.searchCtl?.abort();
  state.searchEpoch++;
  clearInterval(runSearch.timer);
  state.searching = false;
  state.searchCtl = null;
  // 回到搜索前：有旧结果就显示旧结果，没有就回首页
  if (state.searched && state.lastSearch) {
    state.query = state.lastSearch.query;
    state.queryYear = state.lastSearch.year;
    history.replaceState(null, "", "#" + state.lastSearch.hash);
    state.routeKey = state.pendingKey = location.hash.slice(1);
    state.params = parseRoute().params;
    // 恢复的上一次搜索不是从片单来的，就去掉「‹ 返回片单」那一行
    if (state.params.get("from") !== "subscriptions") $("#from-line")?.remove();
    const q = $("#query");
    if (q) q.value = state.query;
    paintResults();
    q?.focus();
  } else {
    history.replaceState(null, "", "#search");
    state.focusSearch = true;
    render();
  }
}

async function submitSearch(raw) {
  const query = raw.trim();
  if (!query) return;
  if (query.startsWith("magnet:?")) {
    const dn = new URLSearchParams(query.slice(8)).get("dn") || "导入的磁力资源";
    try {
      const item = await api("/import", { title: dn.slice(0, 200), magnet: query });
      addImported(item);
      $("#query").value = "";
    } catch (e) {
      toastError(e);
    }
    return;
  }
  if (!sources().length) {
    searchNote('还没有连接搜索服务。<a class="text-button" href="#setup">去连接</a>');
    return;
  }
  if (query.length > 100) {
    searchNote("关键词最多 100 个字。");
    return;
  }
  if (state.searching && state.query === query) return;
  const hash = searchHash(query);
  if (location.hash.slice(1) !== hash) history.pushState(null, "", "#" + hash);
  state.routeKey = hash;
  state.pendingKey = hash;
  state.params = parseRoute().params;
  state.cameFromSubs = false;
  $("#from-line")?.remove();
  await runSearch(query, null);
}

function addImported(item) {
  state.imported = [item, ...state.imported.filter((x) => x.id !== item.id)];
  toast("已导入，点「存入 115」开始下载");
  if (state.page === "search") paintResults();
  else go("search");
}

/* ---------- 页面 ---------- */

const NARROW = window.matchMedia("(max-width: 734px)");
const queryPlaceholder = () => (NARROW.matches ? "片名或磁力链接" : "输入片名，或粘贴磁力链接");
NARROW.addEventListener("change", () => {
  const q = $("#query");
  if (q) q.placeholder = queryPlaceholder();
});

/* 找片页标题区和搜索框，不依赖任何网络请求 */
function heroHTML(q) {
  const from = state.params.get("from") === "subscriptions";
  const src = sources().length;
  const drv = drives().length;
  const status = [
    src ? `已连接 ${src} 个搜索服务` : '<a class="warn-link" href="#setup">还没有连接搜索服务</a>',
    drv ? "已连接 115" : '<a class="warn-link" href="#setup">还没有连接 115</a>',
    '<button class="text-button" data-action="import">导入种子</button>',
  ].join('<span class="dot-sep"> · </span>');
  const fromLine = from && q ? `<p class="from-line" id="from-line"><button class="text-button" data-action="back-subs">‹ 返回片单</button><span>正在为豆瓣片单里的《${esc(q)}》找资源</span></p>` : "";
  const inputValue = q || (state.searching ? state.query : "");
  return `<section class="hero"><div class="hero-inner">${fromLine}<h1 tabindex="-1">从这开始你的私人影音库</h1><p class="intro">搜索影片，选一个版本存入你的 115。</p><form class="search-form" id="search-form" role="search"><svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0"/></svg><input id="query" type="text" aria-label="搜索片名" placeholder="${queryPlaceholder()}" value="${esc(inputValue)}" maxlength="16384" autocomplete="off" enterkeyhint="search"><button class="primary" id="search-submit" type="submit" aria-disabled="${state.searching}">${state.searching ? "搜索中…" : "搜索"}</button></form><p class="search-note" id="search-note"${state.note ? "" : " hidden"}>${state.note}</p><p class="search-under">${status}</p></div></section>`;
}

const views = {
  async search() {
    const q = state.params.get("q") || "";
    const drv = drives().length;
    const results = `<div id="results" class="wrap results">${q && state.query === q ? resultsAreaHTML() : importedHTML()}</div>`;
    return heroHTML(q) + results;
  },

  async tasks() {
    // 后台静默刷新时任务列表刚由 refreshTasks 取回，不再重复请求
    const tasks = state.renderSilent && state.tasks ? state.tasks : await api("/tasks");
    if (tasks !== state.tasks) applyTasks(tasks);
    const headHTML = head("下载", "存入 115 的任务和进度。", '<button class="button small-button refresh-button" data-action="refresh-tasks">刷新</button>');
    if (!tasks.length)
      return headHTML + `<div class="wrap">${empty("还没有下载任务", "在找片里点「存入 115」，任务会出现在这里。", '<a class="primary" href="#search">去找片</a>')}</div>`;
    const byTime = (a, b) => (b.created || 0) - (a.created || 0);
    const need = tasks.filter((t) => ATTENTION.includes(t.status)).sort(byTime);
    const running = tasks.filter((t) => ACTIVE.includes(t.status)).sort(byTime);
    const done = [...tasks.filter((t) => t.status === "completed").sort(byTime), ...tasks.filter((t) => t.status === "cancelled").sort(byTime)];
    const doneShown = state.showAllDone ? done : done.slice(0, 20);
    const group = (key, title, list, extra = "") =>
      list.length ? `<section class="group" data-key="${key}"><div class="section-head"><h2>${title} <span class="count-num">${list.length}</span></h2></div><div class="list">${list.map(taskRow).join("")}</div>${extra}</section>` : "";
    return (
      headHTML +
      `<div class="wrap">${group("need", "需要处理", need)}${group("running", "进行中", running)}${group(
        "done",
        "已完成",
        doneShown,
        done.length > 20 && !state.showAllDone ? `<div class="load-more"><button class="button" data-action="all-done">显示全部 ${done.length} 条</button></div>` : "",
      )}</div>`
    );
  },

  async subscriptions() {
    const [subs, items, tasks] = await Promise.all([api("/subscriptions"), api("/watchlist"), api("/tasks")]);
    applyTasks(tasks);
    state.watch = items;
    state.subs = subs;
    const headHTML = head("豆瓣片单", "在豆瓣标记想看，这里会自动找资源并存入 115。", '<button class="primary small-button" data-action="subscription">添加豆瓣片单</button>');
    if (!subs.length && !items.length)
      return headHTML + `<div class="wrap">${empty("还没有订阅豆瓣片单", "填入豆瓣用户 ID，之后在豆瓣标记想看的影片会自动找资源。", '<button class="primary" data-action="subscription">添加豆瓣片单</button>')}</div>`;
    const cards = subs.map(subCard).join("");
    const list = items.length
      ? `<section class="watch"><div class="section-head"><h2>片单</h2></div><div class="watch-tools"><div id="watch-tabs">${watchTabsHTML()}</div><div class="filter-box"><input id="watch-filter" type="search" placeholder="筛选片名" aria-label="筛选片名" value="${esc(state.subText)}" autocomplete="off"><button class="text-button" data-action="clear-watch"${state.subText ? "" : " hidden"}>清除</button></div></div><div id="watch-list">${watchListHTML()}</div></section>`
      : "";
    return headHTML + `<div class="wrap">${cards ? `<div class="cards">${cards}</div>` : ""}${list}<p class="hint">只读取公开片单。遇到验证码或页面读取不完整时，这一轮同步会停止，已有记录不变。</p></div>`;
  },

  async library() {
    const list = drives();
    if (!list.length)
      return head("片库") + `<div class="wrap">${empty("还没有连接 115", "连接 CD2 后可以在这里浏览 115 里的影片。", '<a class="primary" href="#setup">去连接</a>')}</div>`;
    const drive = list.find((c) => c.id === state.params.get("drive")) || list[0];
    const path = state.params.get("path") || "";
    const switcher =
      list.length > 1
        ? `<select id="library-drive" class="inline-select" aria-label="选择片库">${list.map((c) => `<option value="${esc(c.id)}"${c.id === drive.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`
        : "";
    const actions = switcher + '<button class="button small-button refresh-button" data-action="refresh">刷新</button>';
    let data;
    try {
      data = await api("/library/browse?connection_id=" + enc(drive.id) + "&path=" + enc(path));
    } catch {
      state.lib = null;
      return (
        head(path ? esc(parseRelease(path.split("/").filter(Boolean).pop() || "").title) : "片库", "", actions) +
        `<div class="wrap"><div class="notice">片库暂时无法读取，请检查 CD2 连接。<button class="button small-button" data-action="refresh">重试</button><a class="button small-button" href="#connections">去设置</a></div></div>`
      );
    }
    state.lib = { data, drive };
    const isRoot = !data.parent;
    if (isRoot) {
      state.libraryCount = data.items.length;
      state.libraryCountAt = Date.now();
    }
    const current = data.path.slice(data.root.length).split("/").filter(Boolean);
    const curName = current[current.length - 1] || "";
    const title = isRoot ? "片库" : esc(parseRelease(curName).title);
    const desc = isRoot ? `${esc(drive.name)} · ${data.items.length} 项` : `${data.items.length} 项`;
    let crumbs = "";
    if (!isRoot) {
      const parts = current.map((name, i) => ({ name, path: data.root.replace(/\/$/, "") + "/" + current.slice(0, i + 1).join("/") }));
      const nice = (name) => esc(parseRelease(name).title);
      const link = (p) => `<a class="text-button" href="#${esc(libraryHash(p.path, drive.id))}" title="${esc(p.name)}">${nice(p.name)}</a>`;
      const sep = '<span class="sep" aria-hidden="true">›</span>';
      let middle = parts.slice(0, -1).map(link);
      if (parts.length > 4 && !state.crumbsOpen) middle = [link(parts[0]), '<button class="text-button" data-action="open-crumbs" aria-label="显示完整路径">…</button>', ...parts.slice(-3, -1).map(link)];
      const rootLink = `<a class="text-button" href="#${esc(libraryHash("", drive.id))}">片库</a>`;
      const parentName = parts.length > 1 ? parts[parts.length - 2].name : "片库";
      const cur = `<strong title="${esc(curName)}">${nice(curName)}</strong>`;
      crumbs = `<nav class="crumbs wrap" aria-label="文件夹路径"><div class="crumbs-full">${[rootLink, ...middle, cur].join(sep)}</div><div class="crumbs-short"><a class="text-button" href="#${esc(libraryHash(data.parent === data.root ? "" : data.parent, drive.id))}">‹ ${parts.length > 1 ? nice(parentName) : "片库"}</a>${sep}${cur}</div></nav>`;
    }
    const filter = data.items.length > 20 ? `<div class="filter-box lib-filter"><input id="lib-filter" type="search" placeholder="筛选片名" aria-label="筛选片名" value="${esc(state.libText)}" autocomplete="off"></div>` : "";
    const body = data.items.length ? `${filter}<div id="lib-list">${libListHTML()}</div>` : empty("这个文件夹是空的");
    return head(title, desc, actions) + crumbs + `<div class="wrap">${body}</div>`;
  },

  async connections() {
    // 订阅只用于一行概况，读取失败时照常显示连接
    const subs = await api("/subscriptions").catch(() => null);
    if (subs) state.subs = subs;
    const cards = state.connections.map(connectionCard).join("");
    const sub = subs?.[0];
    const subLine = !subs ? "暂时读不到" : sub ? `${esc(sub.name)} · ${!sub.enabled ? "已暂停同步" : sub.auto_download ? "自动下载" : "不自动下载"}` : "还没有订阅";
    const douban = `<div class="douban-line"><span>豆瓣片单：${subLine}</span><a class="text-button" href="#subscriptions">管理 ›</a></div>`;
    const rules = [
      ["01", "片名和年份都对上才下载", "优先选可直接播放的文件，再按清晰度挑；对不上的影片留在片单里等待。"],
      ["02", "每部影片一个文件夹", "按片名和资源编号建文件夹，不动已有文件，不自动删除任何文件。"],
      ["03", "定时补找，不重复下载", "豆瓣每 10 分钟同步一次，没找到资源的影片每 6 小时再找一次；同一个资源不会重复存入同一个 115。"],
    ];
    return (
      head("设置", "管理搜索服务和 115 连接。", '<button class="primary small-button" data-action="connection">添加连接</button>') +
      `<div class="wrap">${cards ? `<div class="connection-grid">${cards}</div>` : ""}<p class="hint">115 在你自己的 CD2 里登录，这里只填 CD2 的地址和令牌。第一次下载前，请在 CD2 里建好入库目录，并允许读取、新建文件夹和离线下载。</p>${douban}<section class="rules"><h2>自动下载规则</h2><div class="panel">${rules
        .map(([n, t, d]) => `<div class="step"><span class="step-num">${n}</span><div><strong>${t}</strong><p>${d}</p></div></div>`)
        .join("")}</div></section></div>`
    );
  },

  async setup() {
    const subs = await api("/subscriptions").catch(() => null);
    if (subs) state.subs = subs;
    const src = sources();
    const drv = drives();
    const stateOf = (list) => {
      if (!list.length) return { text: "未连接", cls: "warning" };
      const r = state.testResults[list[0].id];
      if (!r) return { text: "已连接，未测试", cls: "muted" };
      return r.ok ? { text: "连接正常", cls: "muted" } : { text: "连接失败", cls: "danger" };
    };
    const testActions = (list) => {
      const c = list[0];
      const r = state.testResults[c.id];
      if (!r) return `<button class="button small-button test-button" data-test="${esc(c.id)}" aria-label="测试连接：${esc(c.name)}">测试连接</button>`;
      return `<p class="test-line ${r.ok ? "" : "fail"}">${r.ok ? "连接正常" : "连接失败"} · ${r.time}</p><button class="button small-button test-button" data-test="${esc(c.id)}" aria-label="重新测试：${esc(c.name)}">重新测试</button>${r.ok ? "" : `<button class="text-button" data-edit="${esc(c.id)}" aria-label="修改：${esc(c.name)}">修改</button>`}`;
    };
    const card = (n, title, desc, st, actions) =>
      `<article class="card setup-card"><div class="card-head"><span class="service-icon">${n}</span><h3>${title}</h3></div><p class="card-status">${badge(st.cls === "danger" ? "failed" : st.cls === "warning" ? "needs_review" : "completed", st.text)}</p><p class="card-desc">${desc}</p><div class="card-actions">${actions}</div></article>`;
    const s1 = stateOf(src);
    const s2 = stateOf(drv);
    const s3 = !subs ? { text: "暂时读不到", cls: "muted" } : subs.length ? { text: "已添加", cls: "muted" } : { text: "未连接", cls: "warning" };
    const allDone = src.length && drv.length && subs?.length;
    return (
      head("开始使用", "连好搜索服务和 115 就能找片和下载，豆瓣片单可以稍后再加。") +
      `<div class="wrap">${allDone ? `<div class="done-line"><span>设置完成，可以开始找片了。</span><a class="primary small-button" href="#search">去找片</a></div>` : ""}<div class="setup-grid">${card(
        1,
        "连接搜索服务",
        "导入服务提供者发给你的授权文件，或手动填写自己的资源目录。",
        s1,
        src.length ? testActions(src) + '<button class="text-button" data-action="gateway-import">导入检索授权</button>' : '<button class="primary small-button" data-action="gateway-import">导入检索授权</button><button class="text-button" data-action="connection">手动填写</button>',
      )}${card(2, "连接你的 115", "先在 CD2 里登录 115，再在这里填 CD2 的地址、令牌和入库目录。", s2, drv.length ? testActions(drv) : '<button class="primary small-button" data-action="setup-drive">连接 115</button>')}${card(
        3,
        "订阅豆瓣片单",
        "可选。填豆瓣用户 ID，之后在豆瓣标记想看的影片会自动找资源。不需要豆瓣密码。",
        s3,
        subs?.length ? `<span class="card-note">${esc(subs[0].name)}</span><a class="text-button" href="#subscriptions">管理 ›</a>` : subs ? '<button class="primary small-button" data-action="subscription">添加豆瓣片单</button>' : '<a class="text-button" href="#subscriptions">管理 ›</a>',
      )}</div>${allDone ? "" : '<div class="setup-foot"><a class="primary" href="#search">去找片</a><button class="text-button" data-action="import">导入种子</button></div>'}</div>`
    );
  },
};

const afterRender = {
  keepScroll: false,
  search() {
    const q = state.params.get("q");
    if (q) {
      const year = state.params.get("year");
      const yearNum = year ? Number(year) : null;
      if (!(state.query === q && state.queryYear === yearNum && (state.searched || state.searching))) {
        if (!sources().length) {
          state.searched = false;
          searchNote('还没有连接搜索服务。<a class="text-button" href="#setup">去连接</a>');
        } else
          runSearch(q, yearNum);
      }
    }
  },
  subscriptions(changed) {
    if (!changed) return;
    const y = storage.get("sessionStorage", "we.subsScroll");
    if (y !== null) {
      storage.set("sessionStorage", "we.subsScroll", null);
      afterRender.keepScroll = true;
      requestAnimationFrame(() => window.scrollTo(0, Number(y) || 0));
    }
  },
  library(changed) {
    if (!changed || !state.lib) return;
    const { data } = state.lib;
    if (data.parent) {
      const name = data.path.split("/").filter(Boolean).pop();
      announce(`已打开 ${parseRelease(name).title}，${data.items.length} 项`);
    }
  },
};

/* 片库数量缓存 10 分钟，回首页不每次都去读 115 目录；打开片库根目录时也会更新 */
const LIB_COUNT_TTL = 10 * 60 * 1000;
async function refreshLibraryCount() {
  const d = drives()[0];
  if (!d || refreshLibraryCount.busy) return;
  if (state.libraryCount !== null && Date.now() - state.libraryCountAt < LIB_COUNT_TTL) return;
  refreshLibraryCount.busy = true;
  try {
    const data = await api("/library/browse?connection_id=" + enc(d.id) + "&path=");
    state.libraryCount = data.items.length;
    state.libraryCountAt = Date.now();
    const el = $("#library-count");
    const text = `片库 ${data.items.length} 项`;
    if (el && el.textContent !== text) el.textContent = text;
  } catch {
    const el = $("#library-count");
    if (el && state.libraryCount === null) el.textContent = "打开片库";
  } finally {
    refreshLibraryCount.busy = false;
  }
}

/* ---------- 下载 ---------- */

function taskNote(t) {
  if (t.status === "failed" && /准备目录失败/.test(t.message || "")) return "没能在 115 里创建保存目录，请检查 CD2 连接和目录权限";
  return STATUS_NOTE[t.status] || t.message || "";
}
function taskRow(t) {
  const name = esc(normalizeTitle(t.title));
  let actions = "";
  if (t.status === "queued") actions = `<button class="button small-button" data-cancel="${esc(t.id)}" aria-label="取消：${name}">取消</button>`;
  else if (t.status === "failed") actions = `<button class="button small-button" data-retry="${esc(t.id)}" aria-label="重试：${name}">重试</button>`;
  else if (t.status === "needs_review") actions = `<button class="button small-button" data-retry="${esc(t.id)}" aria-label="核对后重试：${name}">核对后重试</button>`;
  else if (t.status === "cancelled") actions = `<button class="button small-button" data-undo="${esc(t.id)}" aria-label="重新加入：${name}">重新加入</button>`;
  else if (t.status === "completed" && t.folder)
    actions = `<a class="text-button" href="#${esc(libraryHash(t.folder, t.downloader_id))}" aria-label="在片库中查看：${name}">在片库中查看</a>`;
  const pct = Math.round(Number(t.progress) || 0);
  const progress =
    t.status === "downloading"
      ? `<span class="progress-track"><progress max="100" value="${pct}" aria-label="下载进度 ${pct}%"></progress><span class="pct">${pct}%</span></span>`
      : "";
  const handed = ["submitted", "downloading", "downloaded"].includes(t.status) ? `<p class="meta">已交给 CD2 处理，如需停止请在 CD2 中操作。</p>` : "";
  return `<article class="result task" data-key="${esc(t.id)}"><div class="result-main"><h3 title="${esc(t.title)}">${name}</h3>${["completed", "cancelled"].includes(t.status) ? "" : `<p class="note">${esc(taskNote(t))}</p>`}<p class="meta">${stamp(t.created)} 加入${t.folder ? ` · 保存在 ${esc(t.folder)}` : ""}</p>${handed}</div><div class="result-actions task-actions">${badge(t.status)}${progress}${actions}</div></article>`;
}

function applyTasks(tasks) {
  const prev = state.tasks;
  state.tasks = tasks;
  if (prev) {
    const old = new Map(prev.map((t) => [t.id, t.status]));
    for (const t of tasks) {
      const was = old.get(t.id);
      if (!was || was === t.status) continue;
      if (t.status === "completed") announce(`${t.title} 已入库`);
      else if (t.status === "failed") announce(`${t.title} 下载失败`);
    }
  }
  updateDock();
}
function updateDock() {
  const tasks = state.tasks || [];
  const need = tasks.filter((t) => ATTENTION.includes(t.status)).length;
  const active = tasks.filter((t) => ACTIVE.includes(t.status)).length;
  const count = $("#nav-count");
  const ct = need ? String(need) : "";
  if (count.textContent !== ct) count.textContent = ct;
  count.hidden = !need;
  const dock = $("#download-dock");
  const show = (need || active) && state.page !== "tasks";
  const label = need ? `${need} 部需要处理 · 查看` : `${active} 部正在下载 · 查看`;
  if ($("#dock-label").textContent !== label) $("#dock-label").textContent = label;
  dock.hidden = !show;
  document.body.classList.toggle("dock-on", !!show);
}
async function refreshTasks() {
  try {
    applyTasks(await api("/tasks"));
    if (state.page === "tasks" && !state.inflight && !$("#dialog").open && document.visibilityState === "visible") await render({ silent: true });
  } catch {
    /* 手动刷新会显示错误 */
  }
}

/* ---------- 片单 ---------- */

function subCard(s) {
  const lists = s.statuses.map((x) => LIST_NAME[x]).join(" / ");
  const mode = !s.enabled ? "已暂停同步" : s.auto_download ? `自动下载到 ${esc(state.connections.find((c) => c.id === s.downloader_id)?.name || "115")}` : "只同步片单，不自动下载";
  let sync = "还没有同步过";
  if (s.last_poll) {
    const snap = s.snapshot;
    const ok = /^已同步/.test(s.message || "");
    sync = (snap && ok ? `豆瓣显示 ${snap.declared ?? snap.visible} 条，可读取 ${snap.visible} 条` : esc(s.message || "已同步")) + ` · ${stamp(s.last_poll)} 同步`;
  }
  return `<article class="card sub-card" data-key="${esc(s.id)}"><div class="sub-text"><h3>${esc(s.name)}</h3><p class="card-desc">豆瓣 ID ${esc(s.user_id)} · ${lists} · ${mode}</p><p class="meta">${sync}</p></div><div class="card-actions"><button class="button small-button sync-button" data-sync="${esc(s.id)}" aria-label="立即同步：${esc(s.name)}">立即同步</button><button class="button small-button" data-sub-edit="${esc(s.id)}" aria-label="编辑：${esc(s.name)}">编辑</button></div></article>`;
}
const isWaiting = (i) => ["waiting", "needs_review"].includes(i.status) && !i.task_id;
const isDone = (i) => !!i.task_id;
function watchFilter() {
  const items = state.watch || [];
  const f = state.params.get("filter");
  if (["waiting", "done", "all"].includes(f)) return f;
  return items.some(isWaiting) ? "waiting" : "all";
}
function watchTabsHTML() {
  const items = state.watch || [];
  const f = watchFilter();
  const tabs = [
    ["waiting", "未找到资源", items.filter(isWaiting).length],
    ["done", "已下载", items.filter(isDone).length],
    ["all", "全部", items.length],
  ];
  return `<div class="segmented" role="group" aria-label="按状态筛选">${tabs.filter(([v, , n]) => n > 0 || v === f || v === "all").map(([v, l, n]) => `<button data-filter="${v}" class="${f === v ? "selected" : ""}" aria-pressed="${f === v}">${l}<small>${n}</small></button>`).join("")}</div>`;
}
function watchListHTML() {
  const f = watchFilter();
  const text = state.subText.trim().toLowerCase();
  const taskMap = new Map((state.tasks || []).map((t) => [t.id, t]));
  let items = state.watch || [];
  if (f === "waiting") items = items.filter(isWaiting);
  if (f === "done") items = items.filter(isDone);
  if (text) items = items.filter((i) => String(i.title).toLowerCase().includes(text));
  if (!items.length) {
    if (text) return `<p class="empty-line">没有匹配「${esc(state.subText.trim())}」的影片</p>`;
    if (f === "waiting") return `<p class="empty-line">片单里的影片都已找到资源</p>`;
    if (f === "done") return `<p class="empty-line">还没有已下载的影片</p>`;
    return `<p class="empty-line">这里还没有影片</p>`;
  }
  // 分段已经说明了状态：「未找到资源」里不再逐行写，「已下载」里只写还没入库的
  // 「全部」里不写「订阅前已标记」，只写需要留意的状态
  const showBadge = (st) => (f === "all" && st !== "baseline") || (f === "done" && st !== "completed");
  const lastSearch = f === "waiting" ? Math.max(0, ...items.map((i) => i.last_search || 0)) : 0;
  const note = lastSearch ? `<p class="watch-note">上次查找 ${stamp(lastSearch)}，每 6 小时自动再找一次</p>` : "";
  return `${note}<div class="list compact">${items
    .map((i) => {
      const t = i.task_id ? taskMap.get(i.task_id) : null;
      const status = t ? t.status : i.status;
      const st = showBadge(status) ? badge(status) : "";
      return `<article class="result" data-key="${esc(i.id)}"><div class="result-main"><h3>${esc(i.title)}<span class="small">${i.year || "年份未知"}</span></h3></div><div class="result-actions">${st}<button class="text-button" data-search="${esc(i.title)}" data-year="${esc(i.year || "")}" aria-label="搜索资源：${esc(i.title)}">搜索资源 ›</button></div></article>`;
    })
    .join("")}</div>`;
}

/* ---------- 片库 ---------- */

const SMALL_FILE = 50 * 1024 ** 2;
function libListHTML() {
  const { data, drive } = state.lib;
  // 只有显示了筛选框才按筛选文字过滤
  const text = data.items.length > 20 ? state.libText.trim().toLowerCase() : "";
  const kind = (f) => (f.is_dir ? 0 : VIDEO_EXT.test(f.name) && (f.size || 0) >= SMALL_FILE ? 1 : 2);
  const rows = data.items
    .map((f) => ({ f, r: parseRelease(f.name), k: kind(f) }))
    .filter(({ f, r }) => !text || r.title.toLowerCase().includes(text) || f.name.toLowerCase().includes(text))
    .sort((a, b) => a.k - b.k || a.r.title.localeCompare(b.r.title, "zh-Hans-CN"));
  if (!rows.length) return `<p class="empty-line">没有匹配「${esc(state.libText.trim())}」的项目</p>`;
  // 子文件夹里只有一个主视频、且解析出的是外文名时，用文件夹的中文片名
  const videos = rows.filter((x) => x.k === 1);
  if (data.parent && videos.length === 1) {
    const folder = parseRelease(data.path.split("/").filter(Boolean).pop() || "");
    const v = videos[0].r;
    const cjk = /[\u4e00-\u9fff]/;
    if (cjk.test(folder.title) && !cjk.test(v.title) && (!v.year || !folder.year || String(v.year) === String(folder.year))) videos[0].r = { ...v, title: folder.title };
  }
  const rowHTML = ({ f, r, k }) => {
    const collection = f.is_dir && /合集|共\s*\d+\s*部/.test(f.name) && !/合集/.test(r.title) ? '<span class="tag">合集</span>' : "";
    const info = f.is_dir ? [r.year, r.quality].filter(Boolean).join(" · ") : [r.year, r.quality, size(f.size)].filter(Boolean).join(" · ");
    const cls = ["folder", "video", "other"][k];
    const action = f.is_dir
      ? `<a class="text-button" href="#${esc(libraryHash(f.path, drive.id))}" data-folder="${esc(f.path)}" aria-label="打开 ${esc(r.title)}">打开 ›</a>`
      : `<button class="text-button" data-path="${esc(f.path)}" aria-label="复制路径：${esc(f.name)}">复制路径</button>`;
    return `<article class="result lib-row ${cls}" data-key="${esc(f.path)}"><div class="result-main"><h3 title="${esc(f.name)}">${esc(r.title)}${collection}</h3>${info ? `<p class="info">${esc(info)}</p>` : ""}</div><div class="result-actions">${action}</div></article>`;
  };
  // 小文件（多是广告、字幕、图片）折成一行，点开再看
  const main = rows.filter((x) => x.k !== 2);
  const small = rows.filter((x) => x.k === 2);
  if (!main.length || !small.length) return `<div class="list">${rows.map(rowHTML).join("")}</div>`;
  return `<div class="list">${main.map(rowHTML).join("")}</div><details class="lib-more"><summary>另有 ${small.length} 个小文件</summary><div class="list">${small.map(rowHTML).join("")}</div></details>`;
}

/* ---------- 设置 ---------- */

function connectionCard(c) {
  const r = state.testResults[c.id];
  const addr = [c.config.url, c.config.root, c.has_token ? "已保存令牌" : ""].filter(Boolean).map(esc).join(" · ");
  const result = r ? `<p class="test-line${r.ok ? "" : " fail"}">${r.ok ? `连接正常 · ${r.time}` : `连接失败 · ${r.time} · 请检查地址、令牌、权限和网络`}</p>` : "";
  return `<article class="card connection${c.enabled ? "" : " disabled"}" data-key="${esc(c.id)}"><div class="card-head"><span class="service-icon">${KIND_ICON[c.kind] || "{ }"}</span><div><h3>${esc(c.name)}${c.enabled ? "" : badge("needs_review", "已停用")}</h3>${c.name === KIND_NAME[c.kind] ? "" : `<p class="kind">${esc(KIND_NAME[c.kind] || c.kind)}</p>`}</div></div><p class="card-desc addr">${addr}</p>${result}<div class="card-actions"><button class="button small-button test-button" data-test="${esc(c.id)}" aria-label="测试连接：${esc(c.name)}">测试连接</button><button class="button small-button" data-edit="${esc(c.id)}" aria-label="编辑：${esc(c.name)}">编辑</button><button class="text-button" data-delete="${esc(c.id)}" aria-label="移除：${esc(c.name)}">移除</button></div></article>`;
}

async function testConnection(id, b) {
  const c = state.connections.find((x) => x.id === id);
  const restore = b ? busy(b, "正在测试…") : () => {};
  const time = stamp(Date.now() / 1000, false);
  try {
    const res = await api("/connections/" + id + "/test", {});
    state.testResults[id] = { ok: true, time };
    const n = (res.message || "").match(/共\s*(\d+)\s*个/);
    toast(c?.kind === "cd2" ? (n ? `连接正常，入库目录里有 ${n[1]} 项` : "连接正常") : "连接正常，搜索服务可以访问");
  } catch {
    state.testResults[id] = { ok: false, time };
    toast("连接失败，请检查地址、令牌、权限和网络", { error: true });
  }
  restore();
  if (["connections", "setup"].includes(state.page)) await render();
}

/* ---------- 弹窗 ---------- */

let dialogTrigger = null;
let dialogResolve = null;
function openDialog(title, bodyHTML, actionsHTML, { form = false, trigger } = {}) {
  dialogTrigger = trigger || dialogTrigger || document.activeElement;
  const tag = form ? "form" : "div";
  $("#dialog-content").innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button type="button" class="dialog-close" data-close aria-label="关闭">✕</button></div><${tag} class="dialog-main"${form ? ' id="modal-form" novalidate' : ""}><div class="dialog-body">${bodyHTML}</div><div class="dialog-foot">${form ? '<p class="error" id="form-error" role="alert"></p>' : ""}<div class="dialog-actions">${actionsHTML}</div></div></${tag}>`;
  const d = $("#dialog");
  if (!d.open) d.showModal();
  const first = $$("#dialog-content .dialog-body input:not([type=hidden]):not([disabled]), #dialog-content .dialog-body select:not([disabled]), #dialog-content .dialog-body textarea").find((el) => !el.closest("[hidden]"));
  (first || $("#dialog-content [data-close].button") || $("#dialog-content .dialog-actions button"))?.focus();
}
function closeDialog() {
  const d = $("#dialog");
  if (!d.open) return finishDialog();
  if (!motionOK()) {
    d.close();
    return finishDialog();
  }
  if (d.classList.contains("closing")) return;
  d.classList.add("closing");
  setTimeout(() => {
    d.classList.remove("closing");
    if (d.open) d.close();
    finishDialog();
  }, 180);
}
/* 关闭后的收尾：结束确认弹窗、清空内容、焦点回到触发按钮（不存在就给 h1）。可重复调用。 */
function finishDialog() {
  if ($("#dialog").open || !$("#dialog-content").innerHTML) return;
  $("#dialog-content").innerHTML = "";
  if (dialogResolve) {
    const r = dialogResolve;
    dialogResolve = null;
    r(false);
  }
  const t = dialogTrigger;
  dialogTrigger = null;
  if (t && t.isConnected && t !== document.body) t.focus({ preventScroll: true });
  else focusH1();
}
$("#dialog").addEventListener("close", finishDialog);
$("#dialog").addEventListener("cancel", (ev) => {
  ev.preventDefault();
  closeDialog();
});

function confirmDialog({ title, body, action, danger = false, trigger }) {
  return new Promise((resolve) => {
    openDialog(
      esc(title),
      `<p class="lead">${body}</p>`,
      `<button type="button" class="button" data-close>取消</button><button type="button" class="${danger ? "button danger" : "primary"}" data-confirm>${esc(action)}</button>`,
      { trigger },
    );
    dialogResolve = resolve;
    $("#dialog-content [data-close].button").focus();
  });
}

const formEnd = (label) => `<button type="button" class="button" data-close>取消</button><button type="submit" class="primary">${label}</button>`;

function formHandler(fn) {
  const form = $("#modal-form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const button = $("button[type=submit]", form);
    const err = $("#form-error");
    err.textContent = "";
    $$("[aria-invalid]", form).forEach((el) => el.removeAttribute("aria-invalid"));
    button.disabled = true;
    try {
      await fn(new FormData(form), form);
      closeDialog();
    } catch (e) {
      err.textContent = e.message;
      const field = e.field && $("#" + e.field);
      if (field) {
        field.setAttribute("aria-invalid", "true");
        field.focus();
      }
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
}

const KIND_FIELDS = {
  gateway: { url: "服务地址", urlPh: "https://", root: false },
  alist: { url: "服务地址", urlPh: "https://", root: "搜索根目录", rootPh: "/", rootNote: "" },
  json: { url: "目录文件地址", urlPh: "目录文件的完整地址", root: false },
  cd2: { url: "CD2 地址", urlPh: "http://192.168.1.10:19798", root: "入库根目录", rootPh: "/115/电影", rootNote: "CD2 里已经存在的文件夹，影片会存到这里" },
};
function applyKind(kind) {
  const k = KIND_FIELDS[kind] || KIND_FIELDS.gateway;
  $("#conn-url-label").textContent = k.url;
  $("#conn-url").placeholder = k.urlPh;
  $("#conn-root-field").hidden = !k.root;
  if (k.root) {
    $("#conn-root-label").textContent = k.root;
    $("#conn-root").placeholder = k.rootPh;
    $("#conn-root-note").textContent = k.rootNote;
    $("#conn-root-note").hidden = !k.rootNote;
  }
  $("#conn-cd2-note").hidden = kind !== "cd2";
}

function connectionDialog(id, preset, trigger) {
  const c = state.connections.find((x) => x.id === id);
  const kind = c?.kind || preset || "gateway";
  const lockedKind = !!c || preset === "cd2";
  const kindField = c
    ? `<div class="field"><span class="label">服务类型</span><p class="plain">${KIND_NAME[c.kind]}</p></div>`
    : preset === "cd2"
      ? ""
      : `<div class="field"><label for="conn-kind">服务类型</label><select id="conn-kind" name="kind">${Object.entries(KIND_NAME).map(([v, n]) => `<option value="${v}"${v === kind ? " selected" : ""}>${n}</option>`).join("")}</select></div>`;
  openDialog(
    c ? "编辑连接" : preset === "cd2" ? "连接 115" : "添加连接",
    `<p class="lead">地址和令牌只保存在这台电脑上。</p><div class="form-grid">${kindField}<div class="field"><label for="conn-name">名称</label><input id="conn-name" name="name" maxlength="100" placeholder="例如 我的 115" value="${esc(c?.name || "")}"></div><div class="field"><label for="conn-url" id="conn-url-label">服务地址</label><input id="conn-url" name="url" type="url" value="${esc(c?.config.url || "")}"></div><div class="field"><label for="conn-token">访问令牌</label><input id="conn-token" name="token" type="password" autocomplete="new-password" placeholder="${c?.has_token ? "已保存，不修改请留空" : "填写访问令牌"}"></div><div class="field" id="conn-root-field"><label for="conn-root" id="conn-root-label">入库根目录</label><input id="conn-root" name="root" value="${esc(c?.config.root || "")}"><p class="form-note" id="conn-root-note"></p></div><label class="check"><input name="enabled" type="checkbox"${c && !c.enabled ? "" : " checked"}>启用这个连接</label><p class="form-note" id="conn-cd2-note">115 在你自己的 CD2 里登录，这里只填 CD2 的地址和令牌。</p></div>`,
    formEnd("保存"),
    { form: true, trigger },
  );
  applyKind(kind);
  if (!lockedKind) $("#conn-kind").addEventListener("change", (e) => applyKind(e.target.value));
  formHandler(async (f) => {
    const k = c?.kind || preset || f.get("kind");
    const name = String(f.get("name") || "").trim();
    const url = String(f.get("url") || "").trim();
    const root = String(f.get("root") || "").trim();
    if (!name) throw new FieldError("请填写名称。", "conn-name");
    if (!/^https?:\/\/\S+$/i.test(url)) throw new FieldError("请填写以 http:// 或 https:// 开头的地址。", "conn-url");
    if (k === "cd2" && !root.startsWith("/")) throw new FieldError("请填写以 / 开头的完整路径，例如 /115/电影", "conn-root");
    const config = { url, token: f.get("token") || "" };
    if (k === "cd2" || k === "alist") config.root = root || "/";
    else if (k === "json" && c?.config.root) config.root = c.config.root;
    if (k !== "gateway" && c?.config.strip_prefix) config.strip_prefix = c.config.strip_prefix;
    const saved = await api("/connections", { ...(c ? { id: c.id } : {}), name, kind: k, config, enabled: f.has("enabled") });
    const sid = saved?.id || c?.id;
    toast("已保存连接", sid ? { action: { label: "测试", run: () => testConnection(sid) } } : {});
    render();
  });
}

/* 文件选择：隐藏原生控件，用和整站一致的胶囊按钮，旁边写文件名 */
function filePicker(id, name, accept, label) {
  return `<div class="file-pick"><input id="${id}" name="${name}" type="file" accept="${accept}" class="sr-only"><label class="button small-button" for="${id}">${label}</label><span class="file-name" id="${id}-name">未选择文件</span></div>`;
}

function gatewayDialog(trigger) {
  openDialog(
    "导入检索授权",
    `<p class="lead">选择服务提供者发给你的 .json 授权文件。授权只保存在这台电脑上，不要转发给别人。</p><div class="form-grid"><div class="field"><span class="label">授权文件</span>${filePicker("bundle", "bundle", ".json,application/json", "选择授权文件")}<p class="form-note" id="bundle-preview" hidden></p></div></div>`,
    formEnd("导入"),
    { form: true, trigger },
  );
  let parsed = null;
  const readBundle = async (file) => {
    if (!file || !file.size) throw new FieldError("请选择授权文件。", "bundle");
    if (file.size > 16384) throw new FieldError("授权文件格式不对。", "bundle");
    let b;
    try {
      b = JSON.parse(await file.text());
    } catch {
      throw new FieldError("授权文件格式不对。", "bundle");
    }
    if (typeof b?.url !== "string" || !b.url || typeof b.token !== "string" || !b.token) throw new FieldError("授权文件里缺少地址或令牌。", "bundle");
    return b;
  };
  $("#bundle").addEventListener("change", async (e) => {
    $("#bundle-name").textContent = e.target.files[0]?.name || "未选择文件";
    const p = $("#bundle-preview");
    try {
      parsed = await readBundle(e.target.files[0]);
      p.textContent = "地址：" + parsed.url;
    } catch (err) {
      parsed = null;
      p.textContent = err.message;
    }
    p.hidden = false;
  });
  formHandler(async (f) => {
    const bundle = parsed || (await readBundle(f.get("bundle")));
    const saved = await api("/connections", { name: "云端检索", kind: "gateway", config: { url: bundle.url, token: bundle.token }, enabled: true });
    toast("已导入检索授权", saved?.id ? { action: { label: "测试", run: () => testConnection(saved.id) } } : {});
    render();
  });
}

function importDialog(trigger) {
  openDialog(
    "导入种子或磁力",
    `<p class="lead">导入后会出现在找片结果最上方，再点「存入 115」开始下载。</p><div class="form-grid"><div class="field"><label for="import-magnet">磁力链接</label><textarea id="import-magnet" name="magnet" placeholder="magnet:?xt=urn:btih:…"></textarea></div><div class="field"><span class="label">或选择种子文件</span>${filePicker("import-file", "file", ".torrent", "选择种子文件")}<p class="form-note">.torrent 文件，最大 8 MB</p><p class="form-note" id="import-both" hidden>已选择种子文件，将忽略磁力链接。</p></div><div class="field"><label for="import-title">名称</label><input id="import-title" name="title" maxlength="200" placeholder="自动从磁力或文件名读取，也可以自己填"></div></div>`,
    formEnd("导入"),
    { form: true, trigger },
  );
  const magnet = $("#import-magnet");
  const file = $("#import-file");
  const title = $("#import-title");
  const both = () => ($("#import-both").hidden = !(file.files[0] && magnet.value.trim()));
  // 名称是自动填的就允许被后来的来源覆盖；用户自己改过就不动
  let autoTitle = true;
  const autoFill = (v) => {
    if (!v || (!autoTitle && title.value.trim())) return;
    title.value = v.slice(0, 200);
    autoTitle = true;
  };
  title.addEventListener("input", () => (autoTitle = !title.value.trim()));
  magnet.addEventListener("input", () => {
    const v = magnet.value.trim();
    // 已选了种子文件时以文件为准
    if (v.startsWith("magnet:?") && !file.files[0]) autoFill(new URLSearchParams(v.slice(8)).get("dn"));
    both();
  });
  file.addEventListener("change", () => {
    const f = file.files[0];
    $("#import-file-name").textContent = f ? f.name : "未选择文件";
    if (f) autoFill(f.name.replace(/\.torrent$/i, ""));
    both();
  });
  formHandler(async (f) => {
    const m = String(f.get("magnet") || "").trim();
    const fl = f.get("file");
    const hasFile = fl && fl.size;
    if (!m && !hasFile) throw new FieldError("请粘贴磁力链接或选择种子文件。", "import-magnet");
    if (!hasFile && !m.startsWith("magnet:?")) throw new FieldError("磁力链接应以 magnet:? 开头。", "import-magnet");
    if (hasFile && fl.size > 8 * 1024 * 1024) throw new FieldError("种子文件不能超过 8 MB。", "import-file");
    const name = String(f.get("title") || "").trim();
    if (!name) throw new FieldError("请填写名称。", "import-title");
    let torrent = "";
    if (hasFile) {
      const bytes = new Uint8Array(await fl.arrayBuffer());
      let raw = "";
      for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
      torrent = btoa(raw);
    }
    const r = await api("/import", { title: name, magnet: hasFile ? "" : m, torrent });
    closeDialog();
    addImported(r);
  });
}

async function subscriptionDialog(id, trigger) {
  const subs = id ? await api("/subscriptions") : [];
  const s = subs.find((x) => x.id === id);
  const list = drives();
  const auto = s ? s.auto_download : true;
  const idField = s
    ? `<div class="field"><span class="label">豆瓣用户 ID</span><p class="plain">${esc(s.user_id)}</p></div><div class="field"><span class="label">同步哪些片单</span><p class="plain">${s.statuses.map((x) => LIST_NAME[x]).join(" / ")}</p><p class="form-note">要换账号或片单范围，请新建订阅。</p></div>`
    : `<div class="field"><label for="sub-user">豆瓣用户 ID</label><input id="sub-user" name="user_id" placeholder="例如 123456789" autocomplete="off"></div><fieldset class="field"><legend class="label">同步哪些片单</legend><div class="checks">${Object.entries(LIST_NAME)
        .map(([v, n]) => `<label class="check"><input type="checkbox" name="statuses" value="${v}"${v === "wish" ? " checked" : ""}>${n}</label>`)
        .join("")}</div></fieldset>`;
  const downloader = list.length
    ? `<div class="field" id="sub-downloader-field"><label for="sub-downloader">下载位置</label><select id="sub-downloader" name="downloader_id">${list.map((c) => `<option value="${esc(c.id)}"${(s?.downloader_id || currentDownloader()?.id) === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>`
    : `<p class="form-note warn" id="sub-downloader-field">自动下载需要先连接 115。<button type="button" class="text-button" data-action="setup-drive">去连接</button></p>`;
  openDialog(
    s ? "编辑豆瓣片单" : "添加豆瓣片单",
    `${s ? "" : '<p class="lead">填豆瓣个人主页地址里 people/ 后面的 ID，不需要豆瓣密码。</p>'}<div class="form-grid"><div class="field"><label for="sub-name">订阅名称</label><input id="sub-name" name="name" maxlength="100" value="${esc(s?.name || "我的豆瓣想看")}"></div>${idField}<label class="check"><input type="checkbox" id="sub-auto" name="auto_download"${auto ? " checked" : ""}>新标记的影片自动找资源并下载</label>${downloader}${
      s ? "" : '<div class="field"><label class="check"><input type="checkbox" name="import_history">首次同步也下载以前标记的影片</label><p class="form-note">不勾选时，只下载订阅之后新标记的影片。</p></div>'
    }<label class="check"><input type="checkbox" name="enabled"${s && !s.enabled ? "" : " checked"}>定时同步（每 10 分钟）</label></div>`,
    formEnd("保存"),
    { form: true, trigger },
  );
  const toggle = () => ($("#sub-downloader-field").hidden = !$("#sub-auto").checked);
  toggle();
  $("#sub-auto").addEventListener("change", toggle);
  formHandler(async (f) => {
    const name = String(f.get("name") || "").trim();
    if (!name) throw new FieldError("请填写订阅名称。", "sub-name");
    const userId = s ? s.user_id : String(f.get("user_id") || "").trim();
    if (!s && !/^[A-Za-z0-9_-]{1,80}$/.test(userId)) throw new FieldError("请填写豆瓣用户 ID，只包含字母、数字、下划线或短横线。", "sub-user");
    const statuses = s ? s.statuses : f.getAll("statuses");
    if (!statuses.length) throw Error("至少选一个片单。");
    const autoDl = f.has("auto_download");
    if (autoDl && !list.length) throw Error("自动下载需要先连接 115。");
    await api("/subscriptions", {
      ...(s ? { id: s.id } : {}),
      name,
      user_id: userId,
      statuses,
      auto_download: autoDl,
      downloader_id: f.get("downloader_id") || s?.downloader_id || list[0]?.id || "",
      import_history: s ? s.import_history || false : f.has("import_history"),
      enabled: f.has("enabled"),
    });
    toast("已保存订阅");
    render();
  });
}

/* ---------- 动作 ---------- */

async function addToDrive(b) {
  const d = currentDownloader();
  if (!d) return connectionDialog(undefined, "cd2", b);
  const rid = b.dataset.download;
  const restore = busy(b, "正在存入…");
  const clicked = Date.now() / 1000;
  const known = new Set((state.tasks || []).map((t) => t.id));
  try {
    const t = await api("/tasks", { resource_id: rid, downloader_id: d.id });
    const existed = known.has(t.id) || (t.created && t.created < clicked - 5);
    const label = existed ? "已在下载列表" : "已加入下载";
    state.added.set(rid, label);
    b.textContent = label;
    b.removeAttribute("data-download");
    b.disabled = true;
    toast(existed ? `这个资源已经在下载列表里，状态：${STATUS[t.status] || t.status}` : `已加入下载：${t.title}`, { action: { label: "查看", run: () => go("tasks") } });
    state.tasks = [...(state.tasks || []).filter((x) => x.id !== t.id), t];
    updateDock();
    refreshTasks();
  } catch (e) {
    restore();
    toastError(e);
  }
}

async function exportMagnets(b) {
  const selected = visibleResults();
  if (selected.length > 100) return;
  if (selected.length > 24) {
    const ok = await confirmDialog({ title: `导出 ${selected.length} 个磁力链接？`, body: "将逐条解析，可能需要一分钟。", action: "导出", trigger: b });
    if (!ok) return;
  }
  const magnets = [];
  try {
    for (const [i, r] of selected.entries()) {
      state.exporting = `正在导出 ${i + 1} / ${selected.length}…`;
      const el = $('[data-action="export"]');
      if (el) {
        el.textContent = state.exporting;
        el.disabled = true;
      }
      magnets.push((await api("/resources/" + r.id + "/resolve", {})).magnet);
    }
    const url = URL.createObjectURL(new Blob([magnets.join("\n") + "\n"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "watching-everything-magnets.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`已导出 ${magnets.length} 个磁力链接`);
  } catch (e) {
    toastError(e);
  } finally {
    state.exporting = "";
    paintResults();
  }
}

async function taskAction(b) {
  const id = b.dataset.cancel || b.dataset.retry || b.dataset.undo;
  const t = (state.tasks || []).find((x) => x.id === id);
  const title = t?.title || "";
  if (b.dataset.cancel) {
    const restore = busy(b, "正在取消…");
    try {
      await api("/tasks/" + id + "/cancel", {});
      toast(`已取消：${title}`, {
        action: {
          label: "撤销",
          run: async () => {
            try {
              await api("/tasks/" + id + "/retry", {});
              await refreshTasks();
              if (state.page === "tasks") render();
            } catch (e) {
              toastError(e);
            }
          },
        },
      });
      await render();
    } catch (e) {
      restore();
      toastError(e);
    }
    return;
  }
  const uncertain = t?.status === "needs_review";
  if (b.dataset.retry) {
    const ok = await confirmDialog(
      uncertain
        ? {
            title: "先在 CD2 里核对",
            body: `提交时没有收到 CD2 的明确回复，这项任务可能已经在 CD2 里了。请打开 CD2 的离线下载列表确认没有《${esc(title)}》，再重新提交；否则会重复下载。`,
            action: "已核对，重新提交",
            trigger: b,
          }
        : { title: `重新提交《${title}》？`, body: "CD2 里这项任务失败了。请先在 CD2 中删除失败的任务，再重新提交，避免重复。", action: "重新提交", trigger: b },
    );
    if (!ok) return;
  }
  const restore = b.isConnected ? busy(b, "正在提交…") : () => {};
  try {
    await api("/tasks/" + id + "/retry", { confirm_not_submitted: uncertain });
    toast(`已重新提交：${title}`);
    await render();
  } catch (e) {
    restore();
    toastError(e);
  }
}

async function removeConnection(b) {
  const c = state.connections.find((x) => x.id === b.dataset.delete);
  if (!c) return;
  const using = (state.subs || []).filter((s) => s.downloader_id === c.id);
  const extra = using.length ? ` 豆瓣订阅「${esc(using.map((s) => s.name).join("」「"))}」在用这个连接，移除后需要在订阅里重新选择下载位置。` : "";
  const ok = await confirmDialog({ title: `移除「${c.name}」？`, body: "已经存到 115 的文件不受影响。" + extra, action: "移除", danger: true, trigger: b });
  if (!ok) return;
  try {
    await api("/connections/" + c.id, undefined, "DELETE");
    delete state.testResults[c.id];
    toast(`已移除连接：${c.name}`);
    render();
  } catch (e) {
    toastError(e);
  }
}

async function syncSubscription(b) {
  const id = b.dataset.sync;
  const restore = busy(b, "正在同步…");
  toast("正在读取豆瓣片单…");
  const count = () => (state.watch || []).filter((i) => i.subscription_id === id).length;
  const before = count();
  try {
    await api("/subscriptions/" + id + "/sync", {});
    await render();
    const added = count() - before;
    toast(added > 0 ? `片单已同步，新增 ${added} 部` : "片单已同步，没有新增");
  } catch (e) {
    restore();
    toastError(e);
  }
}

const ACTIONS = {
  refresh: () => render(),
  "refresh-tasks": async (b) => {
    const restore = busy(b, "正在刷新…");
    try {
      await render();
    } finally {
      restore();
    }
  },
  connection: (b) => connectionDialog(undefined, undefined, b),
  "setup-drive": (b) => connectionDialog(undefined, "cd2", b),
  "gateway-import": (b) => gatewayDialog(b),
  import: (b) => importDialog(b),
  subscription: (b) => subscriptionDialog(undefined, b),
  export: (b) => exportMagnets(b),
  more: () => {
    const before = state.resultLimit;
    state.resultLimit += 24;
    paintResults({ animate: true, from: before });
    const rows = $$("#result-list .result h3");
    rows[before]?.focus({ preventScroll: true });
  },
  "cancel-search": () => cancelSearch(),
  "clear-imported": () => {
    state.imported = [];
    paintResults();
    $("#query")?.focus();
  },
  "back-subs": () => {
    if (state.cameFromSubs) history.back();
    else go(state.subsHash || "subscriptions");
  },
  "all-done": () => {
    state.showAllDone = true;
    render();
  },
  "clear-watch": () => {
    state.subText = "";
    $("#watch-filter").value = "";
    paintWatch();
    $("#watch-filter").focus();
  },
  "open-crumbs": () => {
    state.crumbsOpen = true;
    render();
  },
};

function paintWatch() {
  const list = $("#watch-list");
  if (list) list.innerHTML = watchListHTML();
  const tabs = $("#watch-tabs");
  if (tabs) {
    const keep = focusKey(document.activeElement);
    tabs.innerHTML = watchTabsHTML();
    restoreFocus(keep);
  }
  const clear = $('[data-action="clear-watch"]');
  if (clear) clear.hidden = !state.subText;
}

document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button, a");
  // 片库整行可点（按钮和链接保持各自行为）
  if (!el) {
    const row = ev.target.closest(".lib-row.folder");
    if (row && !window.getSelection()?.toString()) $("a[data-folder]", row)?.click();
    return;
  }
  if (el.tagName === "A") {
    if (el.dataset.folder !== undefined) state.crumbsOpen = false;
    return;
  }
  const b = el;
  if (b.disabled) return;
  const d = b.dataset;
  if (b.id === "toast-action") {
    const run = toast.action;
    hideToast();
    run?.();
    return;
  }
  if (b.id === "toast-close") return hideToast();
  if (d.close !== undefined) return closeDialog();
  if (d.confirm !== undefined) {
    const r = dialogResolve;
    dialogResolve = null;
    closeDialog();
    return r?.(true);
  }
  if (d.nav) return go(d.nav);
  try {
    if (d.action && ACTIONS[d.action]) {
      if (b.closest("#dialog") && d.action === "setup-drive") closeDialog();
      return await ACTIONS[d.action](b);
    }
    if (d.quality !== undefined) {
      state.quality = d.quality;
      state.resultLimit = 24;
      return paintResults({ animate: true });
    }
    if (d.filter) {
      history.replaceState(null, "", "#subscriptions?filter=" + d.filter);
      state.routeKey = state.pendingKey = location.hash.slice(1);
      state.params = parseRoute().params;
      return paintWatch();
    }
    if (d.path) return copyText(d.path, "已复制路径");
    if (d.copy) {
      const restore = busy(b, "正在获取…");
      try {
        await copyText(
          api("/resources/" + d.copy + "/resolve", {}).then((r) => r.magnet),
          "已复制磁力链接",
        );
      } finally {
        restore();
      }
      return;
    }
    if (d.download) return addToDrive(b);
    if (d.test) return testConnection(d.test, b);
    if (d.edit) return connectionDialog(d.edit, undefined, b);
    if (d.delete) return removeConnection(b);
    if (d.cancel || d.retry || d.undo) return taskAction(b);
    if (d.sync) return syncSubscription(b);
    if (d.subEdit) return subscriptionDialog(d.subEdit, b);
    if (d.search) {
      storage.set("sessionStorage", "we.subsScroll", String(window.scrollY));
      state.cameFromSubs = true;
      state.subsHash = location.hash.slice(1);
      const extra = { from: "subscriptions" };
      if (d.year) extra.year = d.year;
      location.hash = searchHash(d.search, extra);
      return;
    }
  } catch (e) {
    toastError(e);
  }
});

document.addEventListener("submit", (ev) => {
  if (ev.target.id !== "search-form") return;
  ev.preventDefault();
  submitSearch($("#query").value);
});

document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.id === "watch-filter") {
    state.subText = t.value;
    paintWatch();
  } else if (t.id === "lib-filter") {
    state.libText = t.value;
    const list = $("#lib-list");
    if (list) list.innerHTML = libListHTML();
  } else if (t.id === "query") {
    searchNote("");
  }
});

document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.id === "downloader") {
    state.downloader = t.value;
    storage.set("localStorage", "we.lastDownloader", t.value);
    paintResults();
  } else if (t.id === "film") {
    state.film = t.value;
    state.quality = "all";
    state.resultLimit = 24;
    paintResults({ animate: true });
  } else if (t.id === "library-drive") {
    location.hash = "library?drive=" + enc(t.value);
  }
});

const typing = (el) => el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
document.addEventListener("keydown", (ev) => {
  const k = ev.key;
  if ((ev.metaKey || ev.ctrlKey) && k.toLowerCase() === "k") {
    ev.preventDefault();
    if ($("#dialog").open) return;
    focusSearchPage();
    return;
  }
  if (k === "/" && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !typing(document.activeElement) && !$("#dialog").open) {
    ev.preventDefault();
    focusSearchPage();
    return;
  }
  if (k === "Escape" && document.activeElement?.id === "query") {
    const q = document.activeElement;
    if (q.value) {
      ev.preventDefault();
      q.value = "";
    } else q.blur();
  }
});
function focusSearchPage() {
  if (state.page === "search" && $("#query")) {
    $("#query").focus();
    $("#query").select();
    return;
  }
  state.focusSearch = true;
  const hash = state.searched && state.lastSearch ? state.lastSearch.hash : "search";
  go(hash);
}

function onRoute() {
  const k = location.hash.slice(1);
  if (k === state.pendingKey) return;
  render();
}
window.addEventListener("hashchange", onRoute);
window.addEventListener("popstate", onRoute);

render();
refreshTasks();
setInterval(() => {
  if (document.visibilityState === "visible") refreshTasks();
}, 12000);
