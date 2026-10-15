# 租客管理系统 · 产品介绍页

零构建的静态落地页。双击 `index.html` 即可打开，也可以把整个 `landing/` 目录丢到任意静态托管
（OSS / Nginx / GitHub Pages）。

## 文件

| 路径 | 说明 |
|------|------|
| `index.html` | 页面结构，含两处小程序手机 mockup 的内联标记 |
| `styles.css` | 设计 Token、版式、响应式、动效 |
| `main.js` | 视角切换、界面画廊标签、滚动揭示、开关指示块定位 |
| `assets/shots/*.jpg` | 真实后台截图（由 `tools/capture_shots.py` 生成） |
| `assets/mark.svg` | favicon |
| `tools/` | 截图、演示数据与校验脚本，不参与页面运行 |

## 页面结构

| 区块 | id | 说明 |
|------|----|------|
| 首屏 | `#top` | 视角切换 + 后台窗口 / 手机互换 + 四项指标 |
| 三种角色 | `#roles` | 管理者 / 租客 / 保洁各自能做什么 |
| 能力索引 | `#capabilities` | 按视角切换的两套 9 条能力清单 |
| 产品界面 | `#screens` | 9 个模块的真实界面，标签切换（仅房东视角） |
| 资金闭环 | `#money` | 三条链路，深色区 |
| 房态 / 报修 | `#state` | 房东看房态状态机与保洁工作台；租客看报修全流程 |
| 公开看房页 | `#viewing` | 免登录看房 |
| 技术底座 | `#stack` | 选型 / 安全 / 部署与上线，深色区 |
| 项目现状 | `#status` | 已跑通、进行中、规划中 |
| 常见问题 | `#faq` | 6 条，用原生 `<details>`，无脚本也能展开 |
| 终版 CTA | `#start` | 按视角给不同的行动号召 |

## 两种视角

页面顶部的「房东 / 运营 ↔ 租客」开关会整体切换：文案、能力清单、资金闭环说明、
配图说明与强调色（房东朱砂红 / 租客靛蓝），首屏的后台窗口与手机会前后互换。
选择记在 `localStorage['tms-persona']`。

- 无 JS 时：默认展示房东视角，内容完整可读（显隐由 `html[data-persona]` 属性驱动，不依赖脚本）。
- 键盘：开关可用 Tab 聚焦，← / → 切换；切换结果通过 `aria-live` 播报。
- 视角内容用 `data-p` / `data-cards` / `data-card` 标记，统一由 `styles.css` §3 一条规则控制显隐。

## 渐进增强

页面在**没有任何脚本**的情况下依然可用，这是有意设计的：

- 视角显隐由 `html[data-persona]` 的初始属性驱动；`main.js` 只负责"切换"。
- 产品界面的 9 张截图默认全部平铺；脚本接管后才收敛成标签切换（`hidden` 属性 + 漫游 tabindex + 方向键）。
- 常见问题用原生 `<details>`，不依赖脚本。
- 滚动揭示只在 `IntersectionObserver` 可用且未开启"减少动态效果"时启用，且由 JS 主动加初始隐藏类，
  因此**永远不会出现"内容被动画藏住"**的情况。

## 改文案 / 换品牌

- 品牌名与标语：`index.html` 的 `.brand`、`<title>`、`meta[name=description]`、`og:*`
  （title 与 description 由 `main.js` 的 `COPY` 按视角改写）。当前用的是项目原名「租客管理系统」，
  换成别的名字只需改这几处。
- 强调色：`styles.css` §1 的 `--accent` / `--accent-deep` / `--accent-ink` / `--accent-soft`。
- 页面上的数字口径：25 张数据表（`backend/prisma/schema.prisma` 的 25 个 model）、
  3 条资金闭环、17 个后端模块（`backend/src/modules/`）、2 端在线。
- 部署那一列的文字来自 `docs/12-部署与运维.md`，改之前请先改那份文档。

## 没有采用的两张截图

`assets/shots/` 里有 `meters.jpg`（水电表管理）和 `checkout.jpg`（退租管理），
但**页面里没有引用**：这两个列表当前直接把内部 ID 渲染在「房间ID」「合同ID」「确认人」列上
（`cmpv6m1tdy...` 这种），对外展示会显得未完成。截图保留在目录里供内部查阅，
等列表接口把关联对象的名字带出来之后再决定要不要放上页面。

## 重新生成截图

截图取自**独立的演示库 `tenant_demo`**，不会碰开发库 `tenant_system`。

```bash
# 1. 建演示库并迁移
docker exec tenant-system-postgres-t140 psql -U tenant_user -d postgres -c "CREATE DATABASE tenant_demo;"
cd backend && DATABASE_URL="postgresql://tenant_user:tenant_password@localhost:5434/tenant_demo?schema=public" npx prisma migrate deploy

# 2. 灌演示数据（2 栋 / 72 间 / 320 张账单 / 793 条预付流水）
cd .. && DATABASE_URL="postgresql://tenant_user:tenant_password@localhost:5434/tenant_demo?schema=public" \
  node landing/tools/demo_seed.mjs

# 3. 起隔离后端 + 截图用前端
cd backend && DATABASE_URL="...同上..." PORT=3101 node dist/main.js &
cd ../frontend-admin && npx vite --config ../landing/tools/vite.screenshot.config.ts &

# 4. 截图（自动压缩到 1600px 宽的 JPEG）
cd .. && ADMIN_BASE=http://127.0.0.1:5174 python3 landing/tools/capture_shots.py
```

`tools/vite.screenshot.config.ts` 用 `envDir` 隔离了 `frontend-admin/.env.local`
（那里直连真实后端），把 `/api` 代理到演示后端 :3101。

## 校验

```bash
python3 -m http.server 5180 --bind 127.0.0.1 --directory landing
python3 landing/tools/verify_page.py   # 两种视角 / 移动端 / 控制台错误 / 横向溢出
python3 landing/tools/audit.py         # WCAG AA 对比度 + 移动端留白
```

当前的校验结果：两种视角的可见文本 **0 处对比度不达标**，控制台 0 报错，
桌面 1440 与移动 390 均无横向溢出，`file://` 直接打开同样可用。

## 视觉与动效

设计语言是「经营台账」：细线分栏、表头式短横线标签、编号式能力索引、朱砂强调色。
但底色不是白的——**首屏是一整块深墨蓝**，上面叠三层环境光（朱砂 / 靛紫 / 青绿）、
一层被遮罩渐隐的细网格，以及跟着指针走的径向光。浅色区承载内容，深色区（资金闭环、
技术底座、终版 CTA）各自带一处光源，避免整页平铺。

产品界面按真实设备呈现：**渐变镶边 + 内高光 + 品牌色外发光**的浏览器窗口
（macOS 三色灯、锁形图标 + 地址胶囊），手机则有金属渐变边框、灵动岛和屏幕反光。
首屏另有三块玻璃数据卡贴在设备边缘——数字都取自下方截图里可见的真实演示数据。

**动效清单**（都能在 `styles.css` §18 与 `main.js` 里找到，且全部有
`prefers-reduced-motion` 降级）：

| 位置 | 效果 |
|------|------|
| 首屏标题 | 逐行遮罩升起（`clip` + `translateY(105%)`） |
| 首屏 | 副文 / 按钮 / 指标依次入场，设备卡放大浮现 |
| 首屏指标 | 数字从 0 滚到目标值（easeOutQuart，1200ms，逐项错开 90ms） |
| 首屏 | 设备随滚动做 ±23px 视差（走独立的 `translate` 属性，不与 transform 动画打架） |
| 首屏 | 光标径向光跟随指针（仅 `hover: hover` + `fine pointer`） |
| 数据卡 | 6.5s 上下浮动，三块相位错开 |
| 切换视角 | 新出现的内容淡入上浮；`@property` 注册的品牌色在 0.55s 内**平滑插值**，整页强调色是滑过去而不是跳过去 |
| 滚动揭示 | 同组元素按索引错开 55ms，而不是整齐划一地一起淡入 |
| 能力索引 | hover 时顶部细线从左展开 + 整块上浮 |
| 资金闭环 | 顶部横线从左绘制，编号带同色辉光 |
| 界面画廊 | 指示条在标签间滑动；切换面板淡入 |
| 按钮 | hover 时上浮 + 掠过高光 |
| 常见问题 | 箭头旋转 135° |

字体：拉丁数字与标题用 Archivo，中文回落到系统字体（PingFang SC / 微软雅黑），
避免为 CJK 加载数 MB 的 Web Font。手机上宽表格截图不缩成一团，而是允许横向平移。

导航始终是深色玻璃条（`backdrop-filter`），所以无论停在深色首屏还是浅色区都读得清，
也不依赖脚本判断滚动位置。
