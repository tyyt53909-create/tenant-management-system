# 栖居 · 产品介绍页

零构建的静态落地页。双击 `index.html` 即可打开，也可以把整个 `landing/` 目录丢到任意静态托管
（OSS / Nginx / GitHub Pages）。生产环境由 `frontend-admin` 镜像里的 Nginx 托管在 `/landing/`。

设计语言与产品同源：色票、圆角与暖色阴影取自管理后台 `frontend-admin/src/styles/optimized-ui.css`
与小程序 `miniprogram/qiju.css`，所以页面上展示的真实界面与页面本身看起来是同一个产品。

## 文件

| 路径 | 说明 |
|------|------|
| `index.html` | 页面结构，含两处小程序手机 mockup 的内联标记 |
| `styles.css` | 设计令牌、版式、响应式、动效 |
| `main.js` | 视角切换、界面画廊、数字滚动、滚动揭示、指针光 |
| `assets/shots/*.jpg` | 真实后台截图（由 `tools/capture_shots.py` 生成） |
| `assets/mark.svg` | favicon（与管理后台 `public/favicon.svg` 同一枚橄榄色房屋标记） |
| `tools/` | 截图、演示数据与校验脚本，不参与页面运行 |

## 页面结构

| # | 区块 | id | 说明 |
|---|------|----|------|
| 1 | 首屏 | `#top` | 视角切换文案 + 真实工作台截图 / 公开看房页 + 手机 mockup + 四项指标 |
| 2 | 三种角色与能力索引 | `#roles` | 管理者 / 租客 / 保洁三张卡，下接按视角切换的九条能力清单 |
| 3 | 一次完整的经营闭环 | `#flow` | 深色区：签约 → 建账单 → 收款核销 → 抄表扣费 → 报修派单 → 退租结算 |
| 4 | 状态机与工单流转 | `#state` | 房东看房态四态，租客看报修六步；右侧分别是房源/报修截图与报修手机 mockup |
| 5 | 真实界面 | `#screens` | 九个模块的标签画廊（仅房东视角），含公开看房页 |
| 6 | 技术底座与工程实践 | `#stack` | 选型 / 安全与合规 / 工程与运维三栏 |
| 7 | 项目现状 | `#status` | 已跑通、已交付的工程能力、下一步，以及当前实测口径 |
| 8 | 常见问题 | `#faq` | 6 条，用原生 `<details>`，无脚本也能展开 |
| 9 | 终版 CTA | `#start` | 按视角给不同的收尾文案 |

## 两种视角

页面顶部的「房东 / 运营 ↔ 租客」开关会整体切换：文案、能力清单、经营闭环说明、状态机内容、
首屏展示的产品端（管理后台 ↔ 公开看房页）与配图说明。选择记在 `localStorage['qiju-persona']`。

- 无 JS 时：默认展示房东视角，内容完整可读（显隐由 `html[data-persona]` 属性驱动，不依赖脚本）。
- 键盘：开关可用 Tab 聚焦，← / → 切换；切换结果通过 `aria-live` 播报。
- 视角内容用 `data-p` / `data-cards` / `data-card` 标记，统一由 `styles.css` §3 一条规则控制显隐。

## 设计语言

令牌集中在 `styles.css` 的 `:root`：

| 组 | 值 |
|----|----|
| 纸感底 | `--paper #f7f6f2`、`--paper-tint #f1eee8`、`--surface #fffefa` |
| 主色（橄榄） | `--primary #515c43`、`--primary-light #7a8a6a`、`--primary-dark #394533` |
| 语义色 | success `#4e8266`、warning `#aa7841`、error `#b36659`、info `#5b7e91` |
| 墨字 | `--ink #30342d`、`--ink-2 #4d5148`、`--ink-3 #8d9087`、`--line #e9e6de` |
| 深色区 | `--deep #262a22`（深橄榄炭，不跳出家族） |

字体：拉丁与数字用 Archivo（Google Fonts），中文回落到系统字体栈，不为 CJK 加载 Web Font。
标题带产品同款的负字距（`-.045em`）。

## 渐进增强

页面在**没有任何脚本**的情况下依然可用，这是有意设计的：

- 视角显隐由 `html[data-persona]` 的初始属性驱动；`main.js` 只负责"切换"。
- 界面画廊的九张截图默认全部平铺；脚本接管后才收敛成标签切换（`hidden` 属性 + 漫游 tabindex + 方向键）。
- 常见问题用原生 `<details>`，不依赖脚本。
- 滚动揭示只在 `IntersectionObserver` 可用且未开启"减少动态效果"时启用，且由 JS 主动加初始隐藏类，
  因此**永远不会出现"内容被动画藏住"**的情况。

## 改文案 / 换品牌

- 品牌名与标语：`index.html` 的 `.brand__text`、`<title>`、`meta[name=description]`、`og:*`
  （title 与 description 由 `main.js` 的 `COPY` 按视角改写）。
- 强调色：`styles.css` §1 的 `--primary` 一系。
- 页面上的数字口径：28 张数据表（`grep -c '^model ' backend/prisma/schema.prisma`）、
  20 个后端模块（`backend/src/modules/` 目录数）、976 项自动化测试、121 条 OpenAPI 路由、2 端在线。
  改动前先核对 `STATUS.md`。
- 部署那一列的文字来自 `docs/12-部署与运维.md`，改之前请先改那份文档。

## 重建截图

截图取自**独立的演示库 `tenant_demo`**，不会碰开发库 `tenant_system`。

```bash
# 1. 重建演示库并灌数据（schema 变更后必须重建，否则页面会缺字段）
docker exec tenant-system-postgres-t140 psql -U tenant_user -d postgres -c "DROP DATABASE IF EXISTS tenant_demo;"
docker exec tenant-system-postgres-t140 psql -U tenant_user -d postgres -c "CREATE DATABASE tenant_demo;"
cd backend && DATABASE_URL="postgresql://tenant_user:tenant_password@localhost:5434/tenant_demo?schema=public" npx prisma migrate deploy
cd .. && DATABASE_URL="postgresql://tenant_user:tenant_password@localhost:5434/tenant_demo?schema=public" \
  node landing/tools/demo_seed.mjs

# 2. 起隔离后端 + 截图用前端
cd backend && DATABASE_URL="...同上..." PORT=3101 node dist/main.js &
cd ../frontend-admin && npx vite --config ../landing/tools/vite.screenshot.config.ts &

# 3. 截图（1440×900 起，实际 1680×1050 @2x，自动压到 1600px 宽的 JPEG）
cd .. && python3 landing/tools/capture_shots.py
```

`tools/vite.screenshot.config.ts` 用 `envDir` 隔离了 `frontend-admin/.env.local`
（那里直连真实后端），把 `/api` 代理到演示后端 :3101，并且**必须保留 Element Plus 的按需引入插件**
——T204 之后 `el-*` 组件不再全局注册，少了这组插件截出来的页面是空的。

只收已套用栖居设计语言的页面。统计报表、楼栋管理与审计日志仍是旧的 `el-card` 样式
（原生 Element 配色），拍出来与其余页面不像同一个产品，故不入镜。

## 校验

```bash
python3 -m http.server 5180 --bind 127.0.0.1 --directory landing
python3 landing/tools/verify_page.py   # 两种视角 / 移动端 / 控制台错误 / 破图 / 横向溢出
python3 landing/tools/audit.py         # WCAG AA 对比度 + 移动端留白
```

`verify_page.py` 在断言前会把整页滚一遍：截图是 `loading="lazy"` 的，不滚就不会发起请求，
会被 `!complete` 误判成破图。

## 视觉与动效

设计语言是「经营台账」：细线分栏、表头式短横线标签、编号式能力索引、橄榄墨绿强调色。
底色是暖白纸感，深色区（经营闭环、页脚）用深橄榄炭，各自带一处光源，避免整页平铺。

产品界面按真实设备呈现：**暖色镶边 + 内高光 + 品牌色外发光**的浏览器窗口（macOS 三色灯 +
地址胶囊），手机则有金属渐变边框、灵动岛与屏幕反光。

**动效清单**（都能在 `styles.css` §17 与 `main.js` 里找到，且全部有 `prefers-reduced-motion` 降级）：

| 位置 | 效果 |
|------|------|
| 首屏文案 | 逐项升起，错开 50–60ms |
| 首屏设备 | 缩放浮现 |
| 首屏指标 | 数字从 0 滚到目标值（easeOutQuart，1200ms，逐项错开 90ms） |
| 首屏 | 光标径向光跟随指针（仅 `hover: hover` + `fine pointer`，首次移动才淡入） |
| 数据卡 | 6.5s 上下浮动，三块相位错开 |
| 切换视角 | 新出现的内容淡入上浮；开关滑块 0.45s 缓动过去 |
| 界面画廊 | 指示块跟着当前标签走（窄屏折行时也不会撑满两行）；切换面板淡入 |
| 滚动揭示 | 同组元素按索引错开 55ms，而不是整齐划一地一起淡入 |
| 经营闭环 / 能力索引 | hover 时整块上浮、底色转为主色浅调 |
| 按钮 | hover 时上浮 + 掠过高光 |
| 常见问题 | 箭头旋转 135° |

字体：拉丁数字与标题用 Archivo，中文回落到系统字体（PingFang SC / 微软雅黑），
避免为 CJK 加载数 MB 的 Web Font。手机上截图按容器宽度等比缩放，不裁剪、不横向溢出。

导航始终是浅色玻璃条（`backdrop-filter`），所以停在深色区还是浅色区都读得清，
也不依赖脚本判断滚动位置。
