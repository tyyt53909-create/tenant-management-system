---
status: active
owner_tier: strong
applies_to:
  - frontend-admin/vite.config.ts
  - frontend-admin/src/main.ts
  - frontend-admin/src/App.vue
  - frontend-admin/src/components.d.ts
  - frontend-admin/package.json
  - docs/13-架构与现有代码优化计划.md
last_verified: 2026-10-17
verified_commit: caf2287
supersedes: null
superseded_by: null
version: 1.0
---

# 交接记录：T204-管理后台 Element Plus 按需引入

---
日期: 2026-10-17
任务: T204-管理后台 Element Plus 按需引入（OPT-19#3）
模型: Claude Opus 5
状态: completed（本地分支，未推送）
分支: feature/T204-admin-ondemand（自 T203 分支叠加）
基线: `caf2287`（T203 分段顶端）
---

## 一、背景：T203 的实测结论

T203 已用可复现方法（同一机器、同一 `node_modules`、临时 worktree 检出基线）实测过：元件拆分（T192）之后首屏 JS **没有**下降（1064.2 → 1065.1 KB）。原因不在拆分，而在 `frontend-admin/src/main.ts` 的 `app.use(ElementPlus)` —— 全量注册会把整个 Element Plus 打进首屏 chunk（entry 847 KB），路由虽然 18 处动态 import 全懒载入也挡不住。

## 二、做法

1. **新增依赖**：`unplugin-vue-components`（devDependency）。
2. **`vite.config.ts`**：加入 `Components({ resolvers: [ElementPlusResolver({ importStyle: false })], dts: false })`
   - 元件与指令（含 `v-loading`，全仓 26 处）由外挂按需自动引入；
   - `importStyle: false` 是**刻意**的：样式仍走 `main.ts` 里的 `element-plus/dist/index.css`，以保留「先默认样式 → 再 `styles/element-variables.css` 覆盖栖居主题」的既有顺序（本任务只针对 JS 体积，不动 CSS 链路，避免主题/变量顺序回归）。
   - `dts: false` 也是**刻意**的，原因见 §四第 3 条：开启后 vue-tsc 会首次拿到 Element Plus 的插槽类型，对 11 个视图里历史宽松写法报 79 处类型错误。修完那些插槽标注再开启（已作为独立任务登记）。
3. **`main.ts`**：移除 `import ElementPlus from 'element-plus'` 与 `app.use(ElementPlus, { locale: zhCn })`，并加注释说明元件/指令改由 resolver 按需引入。
4. **`App.vue`**：外层包 `<el-config-provider :locale="zhCn">`，中文语言包从原先的全局注册迁移到这里（否则分页等文案会退回英文 Total / per page）。
5. **ECharts 无需改动**：`src/components/common/EChart.vue` 早已按 `echarts/core` + `echarts.use([...])` 按需引入。
6. **`ElMessage` / `ElMessageBox` 无需改动**：代码中均为显式 `import { ... } from 'element-plus'`，本来就是可 tree-shake 的。

## 三、实测结果

测量方法：同一个 headless chromium（Playwright，已安装的 chromium-1248），加载 `/<route>` 后等 `networkidle` + 2.5s，取 `performance.getEntriesByType('resource')` 中的 JS 资源求和（`encodedBodySize`）。基线与现况用**同一脚本**跑，基线为临时 worktree 检出的 `caf2287` 构建产物（python http.server 另起端口伺服），测完已清理。

**登入页（真实首屏）**

| 口径 | 基线 `caf2287` | 现况 | 变化 |
| --- | --- | --- | --- |
| 首屏 JS（encodedBodySize） | 1069 KB（5 个档） | **125 KB**（8 个档） | **−88.3%** |
| 首屏 JS（传输量） | 1071 KB | 127 KB | −88.1% |
| entry chunk | `index-*.js` 848 KB | `index-*.js` **17 KB** | −98% |

现况首屏实际载入：`index 17KB + request 73KB + login 2KB + helper 18KB + form 9KB + message-box 4KB + overlay 1KB + card 1KB`——Element Plus 已按需分片（`form` / `card` / `overlay` / `message-box`）。

**其他口径**

| 口径 | 基线 | 现况 | 变化 |
| --- | --- | --- | --- |
| `dist/index.html` eager 引用（静态口径） | 1064.2 KB | 243.9 KB | −77.1% |
| `dist/assets/**/*.js` 合计 | 1909 KB | 1569 KB | −17.8% |

## 四、回归验证

| 检查 | 方法 | 结果 |
| --- | --- | --- |
| 元件/指令解析 | Playwright 逐路由加载 16 条路由（`/dashboard` `/rooms` `/cleaning` `/tenants` `/buildings` `/contracts` `/bills` `/prepay` `/maintenance` `/meters` `/checkout` `/notifications` `/audit` `/statistics` `/settings` `/viewing`），API 全部打桩，监听 console 的 `Failed to resolve component/directive`、`Unknown custom element` 与 `pageerror` | **16/16 无问题**；各页真实渲染出 `.el-table` / `.el-input` / `.el-select` / `.el-pagination` / `.el-card` / `.el-menu` 等 |
| 中文 locale | 载入 `/rooms` 读分页文案 | `共 0 条 20条/页 1 前往页` —— 中文，未回退英文 |
| 类型与构建 | `npm run build`（`vue-tsc -b && vite build`） | ✅ |
| 单测 / lint | `npm test` / `npm run lint` | 12 档 49 例全绿 / exit 0 |

### 过程中踩到的一个坑（已按最小改动处理）

按需外挂默认会生成 `src/components.d.ts`（把 Element Plus 组件声明进 `GlobalComponents`）。**生成后 `vue-tsc` 第一次真正对 Element Plus 的插槽做类型检查**，于是 11 个视图里既有的 `<el-table-column>` 插槽写作 `#default="{ row }"`（row 推断为 `DefaultRow`）并对期望具体类型的函数传参，共报 **79 处 TS2345**（`bills` 18、`rooms` 15、`checkout` 13、`meters/BatchReadingDialog` 9、`contracts` 6、`prepay` 5、`meters` 5、`tenants` 4、`cleaning` 2、`settings/InviteCodes` 1、`buildings` 1）。这些是历史宽松写法，不是本次改动引入的运行时缺陷，但会让 `npm run build`（`vue-tsc -b`）失败、CI 挂掉。

取舍：补 ~60 处插槽类型标注 + 提交生成的 dts 会改动 11 个与本任务无关的视图模板，与「本任务只做体积优化」的范围不符，因此本轮先 `dts: false` 并在 `vite.config.ts` 写明原因；插槽标注另开任务处理（已作为独立待办登记，修完后把 `dts` 打开即可）。

## 五、遗留与说明

1. **Playwright e2e（5 条流程）未在本机跑**：需要真实后端 + 已灌数据的库 + 登录态，本机没有可用后端（`3100` 无监听；docker 里的 `tenant-prod-*` 是生产编排，凭据未知）。CI 的 `admin-ui` job 会跑这套 e2e，建议以 CI 结果为准。
2. **CSS 未动**：`element-plus/dist/index.css`（全量样式）仍在，属刻意选择；若要继续压首屏体积，下一步可评估按需样式（需重新处理与 `element-variables.css` 的覆盖顺序，风险更高）。
3. **`.claude/launch.json` 未纳入提交**：为本次用 Browser 面板验证而临时创建，保持未跟踪状态；如需固化预览配置可另行提交。
4. 本任务未改任何业务逻辑与接口。

## 六、提交记录

- 分支：`feature/T204-admin-ondemand`（基于 `caf2287`）
- 验证基线：`caf2287`（T203 顶）
- **未推送、未合并**（T202 → T203 → T204 三级叠加，建议按序合并）
