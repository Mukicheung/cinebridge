# Watching Everything 设计规范（苹果官网版式）

版本：2026-10-22
适用范围：`cinebridge/static/style.css`、`app.js` 里的 HTML 结构、`index.html`
原则：只改外观和布局，现有功能、按钮、数据和交互全部保留。

一句话方向：白底和 #f5f5f7 浅灰底交替，大字号标题，加大留白，蓝色只用于可点击元素。不放图片，不用海报，不用绿色，不加动效。

---

## 0. 实测来源

以下数值都是 2026-10-22 在浏览器里对官方页面执行 `getComputedStyle` 读出来的，视口 1440×900（响应式另测了 1000 和 390 两个宽度）：

- A：https://www.apple.com/iphone-duo/ （产品页）
- B：https://www.apple.com/ （首页）
- C：https://www.apple.com.cn/ 与 https://www.apple.com.cn/iphone-duo/ （中文版，中文排版以这里为准）

表里标「设计取值」的是本规范根据实测值推导或补充的数值，没有对应的官方实测。

---

## 1. 设计 token

### 1.1 字体（C 实测，CSP 不允许外部字体，只能用系统字体）

官方中文站正文字体栈：`"SF Pro SC", "SF Pro Text", "SF Pro Icons", "PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif`。
标题字体栈：`"SF Pro SC", "SF Pro Display", "SF Pro Icons", "PingFang SC", ...`。

本地实现（只用系统字体）：

```
--font-text:    -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif;
--font-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif;
```

字距规则（C 实测）：中文站标题和正文的 `letter-spacing` 都是 `normal`，只有副标题类保留很小的正字距（0.196–0.231px）。英文站的负字距（例如 -0.374px、-1.2px）**不要用**，负字距会让中文挤在一起。现有代码里 `body { letter-spacing: -0.022em }` 要删掉。

### 1.2 字号阶梯

宽度档位：L ≥1069px，M 735–1068px，S ≤734px（断点见 1.6）。

| 用途 | L | M | S | 字重 | 字距 | 颜色 | 来源 |
|---|---|---|---|---|---|---|---|
| T1 首页大标题 | 80 / 87 | 64 / 70 | 48 / 53 | 600 | normal | #1d1d1f | C 实测 80/87；M、S 字号取自 A 的 64、48，行高按 1.09 换算 |
| T2 页面标题 | 48 / 52 | 40 / 44 | 32 / 36 | 600 | normal | #1d1d1f | A、C 实测 section header |
| T3 首页磁贴标题 | 40 / 44 | 40 / 44 | 32 / 36 | 600 | normal | 随底色 | B、C 实测双栏小磁贴 40/44 |
| T4 卡片标题 | 28 / 35 | 28 / 35 | 24 / 31 | 600 | 0.196px | #1d1d1f | C 实测 feature card 28/35 |
| T5 分区小标题 | 24 / 31 | 24 / 31 | 21 / 28 | 600 | 0.216px | #1d1d1f | C 实测 FAQ 标题 24/31 |
| T6 引导段落 | 21 / 28 | 21 / 28 | 19 / 26 | 400 | 0.231px | #6e6e73 | A 实测介绍段落 21px #6e6e73；C 实测 21/28 |
| T7 说明文字 | 19 / 26 | 19 / 26 | 17 / 25 | 400 | 0.228px | #6e6e73 | C 实测 tile callout 19/26 |
| 正文 | 17 / 25 | 17 / 25 | 17 / 25 | 400 | normal | #1d1d1f | A、C 实测 body |
| 小标签 | 17 / 23 | 同左 | 同左 | 600 | normal | #1d1d1f | C 实测 card label |
| 次要文字 | 14 / 19 | 同左 | 同左 | 400 | normal | #6e6e73 | C 实测 14/19 |
| 注释 | 12 / 16 | 同左 | 同左 | 400 | normal | #6e6e73 | A 实测 12/16 |

### 1.3 颜色（全部实测，除标注项外）

```
--bg:            #ffffff;               /* 页面主底 */
--bg-alt:        #f5f5f7;               /* 交替底、浅色卡片、页脚 (A section background-alt / B 磁贴 / 页脚) */
--bg-index:      #fafafc;               /* A 最底部索引区 */
--bg-dark:       #000000;               /* B 深色磁贴 */
--ink:           #1d1d1f;               /* 主文字 */
--ink-88:        rgba(0,0,0,.88);       /* A 卡片标题 */
--muted:         #6e6e73;               /* 次要文字 */
--on-dark:       #f5f5f7;               /* 深底上的文字 (B) */
--border-strong: #86868b;               /* 下拉框/输入框边框 (A form-dropdown) */
--divider:       #d2d2d7;               /* 列表分割线 (A accordion border-top) */
--control:       #e8e8ed;               /* 分段控件底 (A control-item-bg 为 rgba(232,232,237,.72)，这里用实色) */
--blue:          #0071e3;               /* 主按钮底 (A、B) */
--link:          #0066cc;               /* 文字链接、次按钮描边 (A、B) */
--link-on-dark:  #2997ff;               /* 深底上的链接、次按钮 (B) */
--footer-text:   rgba(0,0,0,.56);       /* 页脚文字 (A、B) */
--footer-link:   rgba(0,0,0,.72);       /* 页脚链接 */
--footer-line:   rgba(0,0,0,.16);       /* 页脚分割线 */
--nav-bg:        rgba(255,255,255,.8);  /* 导航 (B) */
--nav-link:      rgba(0,0,0,.8);        /* 导航文字 (B、C) */
```

状态色（设计取值，沿用现有代码，不是本次实测）：
```
--warning: #b64400;   /* 等待核对、等待资源、验证文件中 */
--danger:  #e30000;   /* 失败 */
```

禁用色：任何绿色（包括 #34c759、#30d158、#00a000 这一类）一律不用。「已入库」「已配置」也不用绿色，见 3.7。

### 1.4 圆角

- 按钮、下拉框、搜索框、分段控件：`980px`（胶囊，A、B 实测）
- 卡片、磁贴、面板、弹窗：`28px`（A 实测 card tile-rounded 28px）
- 画质标记小方框：`4px`（设计取值）
- 首页磁贴：`0`（B 实测首页磁贴 tile-wrapper 直角，靠 12px 白缝分隔）

### 1.5 间距与宽度

- 内容宽度：`width: 87.5%; max-width: 980px; margin: 0 auto;`
  - 依据：A 在 1440、1000、390 三个宽度下内容宽分别是 1260、875、341，都是视口的 87.5%。B 页脚和导航内容区是 980px（导航 1024 含左右各 22px 内边距）。本产品以列表为主，宽度上限取 980px。
- 区块上下内边距（A 实测 section padding）：
  - L：128px（大区块 144px）
  - M：120px
  - S：80px
- 区块标题到内容：48px（A 实测 section-header margin-bottom 48px）
- 首页磁贴：外边距 12px，磁贴之间 12px（B 实测，1440 宽下 12 + 702 + 12 + 702 + 12）
- 列表行内边距：上下 20px（设计取值；A 的 FAQ 行是上下 28px，列表行数据多，取 20px）

### 1.6 断点（A 样式表里出现的 media query）

- `max-width: 1068px`（M 档）
- `max-width: 734px`（S 档）
- `max-width: 480px`（极窄补充）

现有代码用的 834 / 680 统一改成 1068 / 734。

### 1.7 导航实测

- 高度 44px（S 档 48px，A 390 宽实测）
- 背景 `rgba(255,255,255,.8)`，`backdrop-filter: saturate(1.8) blur(20px)`，`position: fixed/sticky`
- 内容区 `max-width: 1024px; padding: 0 22px`
- 链接 12px / 400 / `rgba(0,0,0,.8)`，左右内边距 8px（中文站字距 normal）

### 1.8 按钮实测

| 类型 | 字号 | 内边距 | 高度 | 底色 | 文字 | 边框 | 来源 |
|---|---|---|---|---|---|---|---|
| 主按钮 | 17px | 11px 21px | 44px | #0071e3 | #fff | 1px 透明 | A、B、C |
| 主按钮·小 | 14px | 8px 15px | 36px | #0071e3 | #fff | 1px 透明 | B、C |
| 次按钮 | 17px | 11px 21px | 44px | 透明 | #0066cc | 1px #0066cc | B button-secondary |
| 次按钮·小 | 14px | 8px 15px | 36px | 透明 | #0066cc | 1px #0066cc | B |
| 深底次按钮 | 同上 | 同上 | 同上 | 透明 | #2997ff | 1px #2997ff | B |
| 下拉框 | 17px | 0 45px 0 24px | 44px | #fff | #1d1d1f | 1px #86868b | A form-dropdown |

文字链接：17px，`#0066cc`，无下划线（A 实测 `text-decoration: none`），后面跟一个 `›`。悬停时加下划线（设计取值）。

---

## 2. 全局框架

### 2.1 页面骨架（自上而下）

1. 导航（固定在顶部，44px）
2. `#content`（白底，各页内容）
3. 页脚（#f5f5f7）
4. 浮层：弹窗、toast、右下角下载浮标

### 2.2 内容区通用规则

- `#content` 下所有非通栏块：`width: 87.5%; max-width: 980px; margin: 0 auto;`。不要再用 `padding: 0 22px` 加 `max-width: calc(980px + 44px)` 的写法。
- 内页（下载、豆瓣片单、片库、设置、开始使用）的顶部：页面标题区上内边距 L 80px / M 64px / S 48px（设计取值；产品页的 128px 对工具页太空）。
- 内页底部：内容结束后留 L 128px / M 120px / S 80px，然后接页脚。
- 页面切换：只有 `#content` 做一次淡入，`opacity 0 → 1`，240ms，`ease-out`，没有位移。导航、页脚、浮标不参与动画。

### 2.3 页面标题区（内页通用，替换现有 `.page-head`）

- 布局：flex，左侧标题组，右侧操作按钮，底部对齐（`align-items: flex-end`）
- 标题：T2（48/52，600）
- 副标题：T6（21/28，#6e6e73），距标题 8px
- 右侧操作：小号按钮（36px 高），按钮之间 12px
- 标题区下方到第一块内容：48px
- S 档：改为上下排列，操作按钮放在副标题下方 20px，左对齐

---

## 3. 组件规范

### 3.1 导航 `.topbar`

- 高 44px（S 档 48px），`position: sticky; top: 0; z-index: 30`
- 背景 `rgba(255,255,255,.8)` + `backdrop-filter: saturate(1.8) blur(20px)`（加 `-webkit-` 前缀）
- 底部不画线
- 内容区 `max-width: 1024px; padding: 0 22px; display: flex; align-items: center`
- 左侧品牌：图标 18px 加 "Watching Everything" 文字，文字 14px / 600 / #1d1d1f，间距 8px；`margin-right: auto`
- 中间链接：找片 / 豆瓣片单 / 下载 / 片库，12px / 400 / `rgba(0,0,0,.8)`，`padding: 0 10px; line-height: 44px`
  - 悬停：#000
  - 当前页：#1d1d1f，字重保持 400，下方加一条 1px #1d1d1f 横线（宽度等于文字，贴着导航底边）。不要换成加粗，加粗会让文字宽度变化，导航会跳动。
- 右侧设置按钮：32×32 圆形，图标 16px `rgba(0,0,0,.8)`，悬停底色 `rgba(0,0,0,.06)`，当前页同样用这个底色
- S 档：品牌和设置按钮占第一行（48px），四个链接在第二行横排，13px，可横向滚动，第二行高 36px

### 3.2 按钮

| 类名 | 用途 | 规格 |
|---|---|---|
| `.primary` | 每块区域最重要的一个动作（搜索、存入 115、保存、添加订阅） | 主按钮 44px；`.small-button` 时用主按钮·小 36px |
| `.button` | 次要动作（刷新、导出磁力、取消、重试、编辑、立即同步、打开、测试连接、显示更多） | 次按钮：透明底 + 1px #0066cc + #0066cc 文字；小号 36px |
| `.text-button` | 链接式动作（复制磁力、复制路径、搜索资源、移除、导入种子、手动连接） | 文字链接 #0066cc，字号随上下文（列表里 14px，正文里 17px），需要跳转的结尾加 ` ›` |

- 所有按钮 `border-radius: 980px`，字重 400，`white-space: nowrap`
- 悬停：主按钮底色变 `#0077ed`；次按钮底色变 `rgba(0,102,204,.06)`；文字链接加下划线（均为设计取值）
- 按下：不缩放、不位移
- 禁用：`opacity: .42`
- 同一行最多一个主按钮
- 取消、移除这类动作不用红色按钮，用次按钮或文字链接

### 3.3 输入框

**首页搜索框 `.search-form`**
- 外框：`max-width: 640px; height: 56px; border-radius: 980px; border: 1px solid #86868b; background: #fff; padding: 0 6px 0 20px; display: flex; align-items: center; gap: 12px`
- 搜索图标 18px，#6e6e73
- 输入文字 17px / #1d1d1f，占位文字 #86868b，占位文案「搜电影、剧集，或粘贴磁力链接」不变
- 右侧「搜索」按钮：主按钮 44px 高（上下各留 6px）
- 聚焦：边框 #0071e3，外圈 `box-shadow: 0 0 0 4px rgba(0,113,227,.15)`（设计取值）
- 去掉毛玻璃、半透明底色（现在是黑底上的半透明框）

**弹窗表单输入框**
- `height: 44px; padding: 0 16px; border: 1px solid #86868b; border-radius: 12px; background: #fff; font-size: 17px`（圆角 12px 为设计取值，表单里胶囊形太长不好看）
- `textarea`：最小高 96px，内边距 12px 16px，圆角 12px
- 标签 `label`：14px / 600 / #1d1d1f，距输入框 8px
- 说明 `.form-note`：12/16 #6e6e73，距输入框 6px
- 聚焦同搜索框
- 复选框：18px，`accent-color: #0071e3`，文字 17px，间距 10px

**下拉框 `.inline-select`**
- 工具栏里：高 36px，14px，`padding: 0 36px 0 16px`，圆角 980px，1px #86868b，白底；右侧箭头保持现有的 CSS 渐变画法，颜色 #6e6e73
- 弹窗表单里：同输入框（44px、12px 圆角）

### 3.4 分段控件（画质筛选 `.quality-tabs`）

- 外框：`display: inline-flex; padding: 2px; gap: 2px; border-radius: 980px; background: #e8e8ed`
- 每个选项：`height: 32px; padding: 0 16px; border-radius: 980px; font-size: 14px; color: #1d1d1f; background: transparent; border: 0`
- 数量 `<small>`：12px，#6e6e73，左边距 6px
- 选中：`background: #fff; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.12)`
- 切换只改背景色，过渡 150ms，不加滑块动画
- S 档：外框 `max-width: 100%; overflow-x: auto`，不换行

### 3.5 列表 `.list` / `.result`

- `.list`：`border-top: 1px solid #d2d2d7`
- `.result`：`display: flex; align-items: center; gap: 24px; padding: 20px 0; border-bottom: 1px solid #d2d2d7`
- 左侧 `.result-main`（`flex: 1; min-width: 0`）：
  - 第一行 `h3`：17/23，600，#1d1d1f；年份等附加信息用内联 `<span class="small">`，14px #6e6e73，左边距 8px
  - 第二行 `p`：14/19，#6e6e73，距标题 4px；超长资源名最多 2 行，超出省略（`-webkit-line-clamp: 2`）
  - 第三行 `.meta`：12/16，#6e6e73，距上 4px
- 右侧 `.result-actions`：`display: flex; align-items: center; gap: 20px; flex-shrink: 0`
- 行没有悬停底色、没有阴影、没有缩略图
- 列表行不做逐行错峰进场动画（现有 `animateIn()` 删掉，见第 5 节）
- S 档：`.result` 改为纵向；`.result-actions` 占满整行，距上 12px，左对齐，`flex-wrap: wrap`

### 3.6 画质标记 `.q`

- `display: inline-block; padding: 0 5px; margin-right: 8px; border: 1px solid #86868b; border-radius: 4px; font-size: 11px; font-weight: 600; line-height: 15px; color: #1d1d1f`
- 不填色

### 3.7 状态标记 `.badge`

纯文字，前面一个 6px 圆点，14px，`white-space: nowrap`。

| 状态 | 文字 | 圆点颜色 | 文字颜色 |
|---|---|---|---|
| 等待提交、正在提交、已提交、下载中 | 原文 | #0071e3 | #1d1d1f |
| 已入库、已配置、历史基线 | 原文 | #86868b | #6e6e73 |
| 等待核对、等待资源、验证文件中、待连接、已停用 | 原文 | #b64400 | #b64400 |
| 失败 | 原文 | #e30000 | #e30000 |
| 已取消 | 原文 | 不显示 | #6e6e73 |

「已入库」不用绿色，用灰色，表示已经完成、不需要再处理。

### 3.8 进度条

- 用原生 `<progress>`（CSP 不允许内联 style，不能用 div 加 width）
- `.progress-track`：宽 160px（S 档改成 100% 宽）
- `progress`：`height: 4px; border-radius: 2px; background: #e8e8ed`；已完成部分 #0071e3；`accent-color: #0071e3`
- 进度条右边显示百分比：12px，#6e6e73，`font-variant-numeric: tabular-nums`，间距 8px。现在只有进度条，实现时在 `.progress-track` 里加一个 `<span>`，内容 `${progress}%`
- 进度变化不加过渡动画

### 3.9 卡片

**浅灰卡片 `.connection` `.sub-card` `.panel`**
- `background: #f5f5f7; border-radius: 28px; padding: 32px 36px`（S 档 `padding: 24px`）
- 卡片之间 12px
- 卡片标题：T5（24/31，600）
- 卡片说明：14/19 #6e6e73
- 没有阴影、没有边框
- `.service-icon`（CD / AL / 云 / { } 文字方块）：40×40，圆角 10px，白底，13px / 600 / #1d1d1f

**添加连接卡片 `.add-connection`**
- 白底，`border: 1px dashed #86868b`，圆角 28px，最小高 200px，内容居中
- 标题 17px / 600 / #0066cc，说明 14px #6e6e73

### 3.10 弹窗 `dialog`

- `width: min(560px, calc(100% - 32px)); max-height: 88vh; border-radius: 28px; background: #fff; border: 0; padding: 0`
- 阴影 `0 20px 60px rgba(0,0,0,.18)`（设计取值）
- 遮罩：`rgba(0,0,0,.4)`，不加模糊（模糊在低配机器上会卡）
- 出现：只做透明度 0 → 1，200ms，不缩放
- `.dialog-head`：`padding: 32px 36px 8px`，标题 28/35 600（T4）；关闭按钮 32×32 圆形，底色 #e8e8ed，图标 #6e6e73，悬停底色 #d2d2d7
- `.dialog-body`：`padding: 8px 36px 32px`；引导段 17/25 #6e6e73，距表单 24px
- `.form-grid`：字段之间 20px
- `.dialog-actions`：右对齐，距上 28px，按钮间 12px；左边「取消」次按钮，右边主按钮，均 44px 高
- `.error`：14px #e30000，距上 16px
- S 档：宽 `calc(100% - 24px)`，内边距左右 24px

### 3.11 Toast `#toast`

- 位置：底部居中，`bottom: 32px`
- `background: #1d1d1f; color: #f5f5f7; font-size: 14px; line-height: 19px; padding: 12px 20px; border-radius: 980px; max-width: calc(100% - 32px)`
- 无图标、无阴影、无毛玻璃
- 出现和消失：只做透明度过渡 200ms，不上滑

### 3.12 右下角下载浮标 `#download-dock`

- `position: fixed; right: 24px; bottom: 24px`
- 胶囊：`height: 44px; padding: 0 20px; border-radius: 980px; background: #1d1d1f; color: #f5f5f7; font-size: 14px; border: 0`
- 内容：圆点 6px #2997ff + 「3 部正在下载 · 查看进度」+ `›`（把现在的 `↗` 换成 `›`），间距 8px
- 阴影 `0 4px 16px rgba(0,0,0,.16)`（设计取值）
- 不闪烁、圆点不做呼吸动画
- 与 toast 同时出现时，toast 在中间，浮标在右侧，互不遮挡；S 档浮标改为 `right: 16px; bottom: 16px`，toast `bottom: 76px`

### 3.13 空状态 `.empty`

- `background: #f5f5f7; border-radius: 28px; padding: 80px 24px; text-align: center`
- 去掉 `.empty-symbol` 图标方块（只靠文字）
- 标题：T5（24/31，600）
- 说明：17/25 #6e6e73，距标题 8px
- 按钮：距说明 24px，主按钮 44px
- 放在列表里时距上 24px

### 3.14 提示 `.notice` 和 `.hint`

- `.notice`（错误/警告条）：`background: #fff; border: 1px solid #d2d2d7; border-radius: 12px; padding: 14px 20px; font-size: 14px; color: #b64400`，不用橙色底
- `.hint`（页底说明）：12/16 #6e6e73，距上 24px，`max-width: 640px`

### 3.15 面包屑 `.crumbs`

- 一行，14/19，间距 8px
- 可点击项：`.text-button` 14px #0066cc
- 分隔 `›`：#86868b
- 当前项 `strong`：#1d1d1f，600，超长省略
- 位置：页面标题区下方，距列表 16px（现有 `margin-top: -16px` 改为 0，标题区 48px 下边距里扣掉，标题区到面包屑 24px）

### 3.16 页脚 `footer`

- `background: #f5f5f7; font-size: 12px; line-height: 16px; color: rgba(0,0,0,.56)`
- 内容区 `width: 87.5%; max-width: 980px; margin: 0 auto; padding: 20px 0 24px`
- 顶部一条 1px `rgba(0,0,0,.16)` 分割线放在内容区内（不是通栏）——B 实测页脚分割线颜色
- 排列：左「Watching Everything」，右侧「开始使用」「导入种子 / 磁力」两个链接，12px，颜色 `rgba(0,0,0,.72)`，间距 20px，悬停下划线
- S 档：两行，链接在上，名称在下

---

## 4. 各页面版式

所有页面：白底主体，内容宽 `min(980px, 87.5%)`，居中。

### 4.1 首页（`#search`，未搜索时）

自上而下：

**① 导航**（见 3.1）

**② 主区块 `.hero`**
- 背景：#fff（从黑底改成白底）
- 文字居中
- 上内边距：L 128px / M 120px / S 80px；下内边距同值
- 标题「从这开始你的私人影音库」：T1（80/87，600，#1d1d1f），一行显示（L 档 11 个字约 880px 宽，放得下）；M、S 档允许自然折行，`text-wrap: balance`
- 副标题「搜索影片，一键存入自己的 115。」：T6（21/28，#6e6e73），距标题 16px
- 搜索框：距副标题 48px，规格见 3.3
- 搜索状态说明 `.search-under`：距搜索框 20px，一行居中，14/19 #6e6e73，各项用 ` · ` 连接：
  `已接入 2 个搜索服务 · 115 下载已配置 · 导入种子 ›`
  - 「导入种子 ›」是 `.text-button`，14px #0066cc
  - 去掉 `.ready-dot` 圆点；未连接时直接显示「尚未连接搜索服务」「尚未连接 115」，文字颜色 #b64400
- 删除 `.hero-art` 图片（`img/hero.jpg`），HTML 里不再输出

**③ 介绍磁贴 `.tiles`**（照 B 首页双栏磁贴）
- 通栏，`padding: 0 12px 12px`，`display: grid; grid-template-columns: 1fr 1fr; gap: 12px`
- 两块磁贴等高，`min-height: 480px`，内容垂直水平居中，`padding: 60px 40px`，直角
- 左块「豆瓣想看」：背景 #000
  - 小标签「豆瓣想看」：17/23 600 #f5f5f7
  - 标题「点击「想看」<br>全自动下载到影音库目录」：T3（40/44，600，#f5f5f7），距小标签 8px
  - 说明「连接豆瓣片单后，新标记想看的影片会自动搜索并下载。」：17/25 #86868b，距标题 16px，`max-width: 26em`
  - 按钮组：距说明 28px，横排间距 16px，居中：主按钮·小「查看片单」+ 深底次按钮·小「添加豆瓣账号」（#2997ff 描边和文字）
- 右块「片库」：背景 #f5f5f7
  - 小标签「片库」：17/23 600 #1d1d1f
  - 标题「115 里的影片<br>一目了然」：T3，#1d1d1f
  - 说明「直接浏览 115 里的影片目录。」：17/25 #6e6e73
  - 按钮：主按钮·小「打开片库」
- 删除磁贴里的图片（`img/library.jpg`）和所有海报叠放（`.tile-posters`）
- M 档仍双栏；S 档单栏，`padding: 0 0 12px`（通栏无左右缝），每块 `min-height: 420px; padding: 56px 24px`

**④ 页脚**

### 4.2 首页搜索后（`#search`，`search-active`）

- 主区块收起：上内边距 L 48px / S 32px，下内边距 0；隐藏标题和副标题；搜索框和状态说明保留在原位置（居中）
- 收起和展开不做高度动画，直接切换
- 结果区 `#results`：距状态说明 56px，宽 `min(980px, 87.5%)`
- 不显示介绍磁贴

**结果区自上而下：**
1. 工具栏 `.result-toolbar`：一行，两端对齐
   - 左：「找到 **194** 个资源」17/25 #6e6e73，数字 #1d1d1f 600
   - 右：「保存位置」下拉框（36px）+ 次按钮·小「导出磁力」，间距 12px
2. 画质分段控件：距工具栏 24px，规格见 3.4，左对齐
3. 列表：距分段控件 24px，每行：
   - 标题 + 年份（内联 14px 灰）
   - 原始资源名（14px 灰，最多 2 行）
   - meta：`[1080P]` 标记 + 「2.3 GB · 来源名 · 磁力」
   - 右侧：文字链接「复制磁力」（14px）+ 主按钮·小「存入 115」，间距 20px
4. 显示更多 `.load-more`：距列表 40px，居中；次按钮 44px「显示更多」；下面 12px 注释「已显示 24 / 194」，距按钮 12px
5. 加载中：`.loading` 文字「搜索中…」17px #6e6e73 居中；骨架屏 `.skeleton` 改为 3 条高 72px、圆角 12px、#f5f5f7 的静态色块，**去掉闪光动画**
6. 无结果：空状态（3.13）「没有找到匹配的资源 / 换个片名或更短的关键词试试。」
7. 搜索服务报错：`.notice` 条，放在工具栏上方

### 4.3 下载（`#tasks`）

1. 页面标题区：标题「下载」，副标题「全部下载任务与进度。」，右侧次按钮·小「刷新」
2. 列表（标题区下 48px）每行：
   - 左：任务名（17 600）/ 状态信息（14 灰）/ meta「10-22 14:30 · /115/Movies/xxx」（12 灰）
   - 右，从左到右：状态标记（3.7）→ 进度条 + 百分比（只在下载中显示，3.8）→ 操作按钮（等待提交时「取消」，失败/已取消时「重试」，等待核对时「核对后重试」，都是次按钮·小）
   - 右侧区域给固定最小宽 `min-width: 300px; justify-content: flex-end`，让各行进度条上下对齐
3. 无任务：空状态「暂无下载任务 / 搜索影片后点「存入 115」即可开始下载。」+ 主按钮「去搜索」
4. 页底 `.hint`：原文不变

### 4.4 豆瓣片单（`#subscriptions`）

1. 页面标题区：标题「豆瓣片单」，副标题「在豆瓣标记想看，自动搜索并下载。」，右侧主按钮·小「添加订阅」
2. 订阅卡片区（标题区下 48px）：每个订阅一张浅灰卡片（3.9），卡片间 12px
   - 卡片内左右布局，垂直居中
   - 左：订阅名 T5（24/31 600）；下一行 14/19 灰「用户 ID · 想看 · 自动下载」，距 6px；再下一行 12/16 灰「同步结果 · 时间」，距 4px
   - 右：次按钮·小「立即同步」「编辑」，间距 12px
   - S 档：上下排列，按钮在下，距 20px
3. 片单列表：
   - 分区标题行：距订阅卡片 80px；左「片单」T5（24/31 600），右「215 部」14px 灰，基线对齐；距列表 20px
   - 列表行比通用行紧凑：`padding: 14px 0`；左侧只有一行：片名（17 600）+ 年份（内联 14 灰，未知时「年份未知」）；右侧：状态标记 + 文字链接「搜索资源 ›」（14px），间距 20px
   - 215 条一次全部渲染，不分组、不做卡片、不放海报
4. 无订阅：空状态「还没有订阅片单 / 添加豆瓣用户 ID。首次同步只记录已有条目，之后新增的才会下载。」+ 主按钮「添加片单」
5. 页底 `.hint`：原文不变

### 4.5 片库（`#library`）

1. 页面标题区：
   - 根目录：标题「片库」，副标题「连接名 · 41 部」
   - 子目录：标题是当前文件夹解析后的片名，副标题「12 项」
   - 右侧：多个连接时显示下拉框（36px）+ 次按钮·小「刷新」
2. 面包屑（只在子目录显示）：`片库 › 上一层 › 当前名`，见 3.15
3. 列表每行：
   - 左：解析后片名（17 600）/「2024 · 1080p · 12.3 GB」或「文件夹」（14 灰）/ 原始文件名（12 灰）
   - 右：文件夹 → 次按钮·小「打开」；文件 → 文字链接「复制路径」（14px）
   - 不加文件夹图标、不加缩略图
4. 未连接：空状态「未连接 115 / 在设置里添加 CD2 连接后即可浏览。」+ 主按钮「去设置」
5. 空文件夹：空状态「文件夹为空」，无说明无按钮

### 4.6 设置（`#connections`）

1. 页面标题区：标题「设置」，副标题「管理检索服务和 115 下载连接。」，右侧主按钮·小「添加连接」（去掉全角「＋」，按钮文字只写「添加连接」）
2. 连接卡片网格（标题区下 48px）：`display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px`（S 档单栏）
   - 每张浅灰卡片（3.9），内部纵向，元素间距 16px：
     - 头部一行：`.service-icon` 40px + 名称（T5 24/31 600）和类型说明（12/16 灰），间距 14px
     - 地址和目录：14/19 灰，长地址 `overflow-wrap: anywhere`
     - 操作行（卡片底部，`margin-top: auto`）：次按钮·小「测试连接」「编辑」+ 文字链接「移除」（14px），间距 12px；停用时末尾加状态标记「已停用」
   - 最后一格「添加连接」虚线卡片（3.9），标题「添加连接」，说明「检索服务或 CD2」
3. `.hint`：原文，距网格 24px
4. 自动下载规则面板：距上 80px
   - 分区标题「自动下载规则」T5，放在面板外面上方，距面板 20px（不再放面板里）
   - 面板：浅灰卡片，内边距 8px 36px
   - 三条规则 `.step`：每条 `padding: 24px 0`，之间 1px #d2d2d7 分割线；左侧编号「01」14px 600 #86868b，宽 40px；右侧标题 17/23 600，说明 14/19 灰，距 4px

### 4.7 开始使用（`#setup`）

1. 页面标题区：标题「开始使用」，副标题「连接检索服务、115 和豆瓣片单，配好即可使用。」
2. 三步卡片：`grid-template-columns: repeat(3, 1fr); gap: 12px`（M 档 1 栏，S 档 1 栏）
   - 每张浅灰卡片，纵向：
     - 头部：编号方块（`.service-icon`，白底「1」「2」「3」）+ 标题（T5）+ 右侧状态标记（已配置 = 灰点灰字，待连接 = #b64400）
     - 说明 14/19 灰
     - 操作行在底部：第 1 步 主按钮·小「导入检索授权」+ 文字链接「手动连接」；第 2 步 主按钮·小「连接 CD2 / 115」；第 3 步 次按钮·小「添加豆瓣片单」
3. 检查连接（距上 80px）：
   - 分区标题「检查连接」T5，下面一行 14px 灰说明，距列表 20px
   - 列表（通用列表行）：左连接名，右次按钮·小「测试连接」
   - 列表下方 32px：主按钮「去搜索」+ 文字链接「导入种子」，间距 20px
   - 这一块不再用浅灰面板包，直接放白底上

### 4.8 弹窗表单（添加连接、导入种子、豆瓣订阅、复制兜底）

全部套用 3.10 + 3.3，字段顺序和文案不变。复选框组（想看 / 在看 / 看过）横排，间距 24px，S 档竖排。

---

## 5. 不要做

**图片和插画**
- 不放任何图片：删除 `img/hero.jpg`、`img/library.jpg` 的引用，不加新图
- 不用 AI 生成的背景、插画、配图、纹理、渐变光斑
- 不用渐变色块当装饰（现有 `.art` 的 `.hue-0`～`.hue-6` 渐变海报全部弃用）

**版式**
- 不做海报墙、海报横排货架（删除 `.shelf`、`.shelf-row`、`.poster-grid`、`.poster`、`.art`、`.tile-posters`、`.thumb` 的样式和输出）
- 不做满屏重复卡片网格；片单、片库、下载、搜索结果一律用分割线列表
- 不在列表行里加缩略图、图标方块、悬停浮起
- 页面不用黑色大背景（只有首页左侧一块磁贴是黑底）

**颜色**
- 不用任何绿色，包括「已完成」「已连接」「成功」
- 蓝色只给可点击的东西（按钮、链接、焦点框、进度条、进行中圆点），不用于装饰
- 不用橙色或红色背景块

**动画**
- 只保留 `#content` 切页时一次淡入（240ms，只改透明度）
- 删除：列表逐行错峰进场（`animateIn()` 整个函数改为空或删除调用）、骨架屏闪光、海报悬停浮起、弹窗缩放、toast 上滑、分段控件滑块、按钮按下缩放、搜索区收起的高度动画
- 后台静默刷新（下载页每 12 秒）只换内容，不触发任何动画、不闪烁、不回到顶部
- 导航、页脚、浮标在切页时不动

**文字**
- 文案只写功能，不写感受。不出现「好时光」「尽情」「轻松享受」「一键开启」「你的专属」这类词
- 不加 emoji，不用全角「＋」当按钮前缀，跳转链接统一用 `›`
- 现有功能文案不改；新增的只有进度百分比「42%」

**技术**
- 不写内联 `style` 属性（CSP 禁止），进度用原生 `<progress>`
- 不引外部字体、图标库、CDN
- 不用负字距排中文
- 不用阴影表现层级（卡片靠浅灰底区分，只有弹窗、分段控件选中项、浮标有阴影）
- 不加毛玻璃，导航除外

---

## 6. 实现清单（给执行者）

1. `style.css` 顶部 `:root` 换成第 1 节 token；删 `letter-spacing: -0.022em`
2. 断点改为 1068 / 734 / 480
3. `.hero` 改白底，删 `.hero-art`、`.art`、`.poster*`、`.shelf*`、`.tile-posters`、`.tile img`、`.thumb`、`.hue-*`
4. `app.js` 首页 HTML：去掉 `<img>`、`.ready-dot`；磁贴按钮里的「添加豆瓣账号 ›」从 `.text-button` 改为 `.button.small-button`
5. `app.js` 下载页：`.progress-track` 里加百分比 `<span>`
6. `app.js`：删 `animateIn()` 调用；`#content.page-enter` 动画改为 240ms 纯透明度
7. `index.html`：浮标 `↗` 改 `›`；`theme-color` 保持 `#ffffff`
8. 按第 4 节逐页核对间距；在 1440、1000、390 三个宽度各截一次图对照
