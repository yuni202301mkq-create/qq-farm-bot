# 项目目标

- 主工作区：`D:\github\qq-farm-2.3.x-rebuild`。
- 旧版参考项目：`D:\github\qq-farm-2.3.1`。查旧功能、接口行为、文案和流程时先对照它，但不要机械复刻旧 UI。
- 目标是把 QQ 农场自动化工具整理成前后端更易维护、容易排查、方便扩展的结构。
- 重构方向：统一目录和模块边界，减少冗余和历史代码味道，降低阅读/修改成本，逐步解耦架构与依赖。
- 非目标：不做无关大改，不一次性全站格式化，不把“复刻 2.3.1 UI”当成目标。

# 当前状态

- 抓包服务已改为**默认开启**：`store.js` 的 `DEFAULT_CAPTURE_CONFIG.enabled = true`，读取/保存归一化统一为 `!== false`（显式关才关，未设置或缺失即开）；`admin.js` 在注册完抓包路由后调用 `ensureEmbeddedCaptureService()`，嵌入模式随管理面板一起拉起（原来只有到设置页点保存才会启动，默认关闭时那行只打日志）。前端 `useAdminSystemConfig.ts` 的 `defaultCaptureConfig.enabled` 同步改为 true。实测：默认 true、显式关 false、不传字段 true。

- 服务器日志乱码修复：`services/logger.js` 的 Console transport 原来无条件 `colorize()`，nohup/systemd/docker logs 等非 TTY 输出里 ANSI 转义会变成 `[t'o`、`¶` 之类乱码，已改为仅 `process.stdout.isTTY` 且未设 `NO_COLOR` 时着色；新增 `warnIfConsoleLocaleNotUtf8`（TTY 下检测 Linux locale / Windows chcp 代码页，非 UTF-8 打出可操作提示）；Dockerfile runner 阶段加 `ENV LANG=C.UTF-8 LC_ALL=C.UTF-8`；README Docker 部署节补充乱码排查说明，并修正抓包服务「默认关闭」的过时描述。


- 登录页「更新日志 · V2.5.4」已接通弹窗：点击打开 `UpdateLogModal`（原本未接线、内容写死为空），内容来自公共接口 `GET /api/changelog`。**日志已改为本地优先**：优先读 `core/UPDATE_LOG.md`，其次 `data/UPDATE_LOG.md`（打包后可写目录），都为空才回退拉 Gitee 远端（`admin-public-info-routes.js` 的 `LOCAL_CHANGELOG_FILES` / `CHANGELOG_URL`）。改内容只需编辑本地文件，每次请求实时读取，不用重启、不用重新构建。登录页加载时静默预取日志，指纹为「版本号（首个含版本号的标题，如 V2.5.5）+ 内容 hash」，与 `localStorage['qq-farm-bot:changelog-seen']` 不一致时自动弹窗一次，关闭即记已读，版本或内容变化会再弹。页脚版本号动态显示日志最新版本（拉取失败回退 V2.5.4）。**Esc 关闭需弹窗确实打开过**：`UpdateLogModal` 常驻挂载，其 Esc 监听必须判断 `props.show`，`closeUpdateLog` 也要判断 `showUpdateLog`，否则登录页随手按 Esc 会把未读版本误记为已读、新版永久不再弹。
- 注册页「免费领取 7 天卡密」：公开接口 `POST /api/free-card`（`admin-auth-routes.js`）发放 7 天 / 2 额度试用卡并自动填入卡密框；领取记录持久化在 `data/free-card-claims.json`（`user-store` 的 `claimFreeCard` / `findFreeCardClaim` / `listFreeCardClaims` / `resetFreeCardClaims` / `normalizeClaimAddress`），**同一来源地址只能领一次**，来源取 `req.socket.remoteAddress`（不可用 `req.ip`，会被 XFF 伪造），`::ffff:` 前缀会归一化。超管可用 `GET /api/free-card-claims` 查看、`POST /api/free-card-claims/reset`（带 address 清单个，不带清全部）处理 NAT/共享出口被占用的情况。测试见 `core/test/free-card.test.js`（7 用例）。
- 登录页「忘记密码」已从纯提示升级为自助找回：`POST /api/forgot-password`（`admin-auth-routes.js`）用账号绑定过的卡密（注册卡存 `user.card`，续费卡看卡密库 `usedBy`）验证身份后重置密码，成功后 `invalidateAdminSessions` 踢掉该用户在线会话；同 IP+用户名 10 分钟内 5 次失败锁 10 分钟（**限流键用 `req.socket.remoteAddress` 而非 `req.ip`**：项目开了 `trust proxy`，`req.ip` 来自可伪造的 X-Forwarded-For，伪造即绕过；attempt 表每次失败都清理过期项并有 5000 条硬上限，防止撑爆内存），用户名/卡密错误统一返回「用户名或绑定卡密不匹配」。`AuthView.vue` 新增 `forgot` 模式（用户名→卡密→新密码→确认新密码，回车链式聚焦），超级管理员不可走此流程。测试见 `core/test/forgot-password.test.js`（6 用例）。
- `AuthView.vue` 修复了用户名/卡密输入框同时绑定 `v-model` 与 `v-model.lazy` 导致 `vue-tsc -b` 报 TS1117、生产构建被阻断的问题（保留单个 `v-model`）。

- TSDK/ACE 安全链路已升级到 QQ Mac 客户端 2026-08-20 10:32 包内的官方
  `v3.9.0.1787057219` WASM（161114 字节，SHA-256
  `98cc5301cff10f5b87a014d0a4af92630e4a6e91292cc7de5eb86422275f0070`）。
  同包 `game.js` 和 WASM 静态检查确认 22 个 imports、导出映射、
  `SdkInitEx(3167, 0)`、17 个 mergewasm 数据段及解密密钥均与现有 Node 宿主兼容；
  默认运行文件已切换为 `tsdk-v3.9.0.wasm`，保留 `tsdk-v3.8.6.wasm` 用于回退。
  语法检查、定向 ESLint 和 6/6 TSDK/网关测试通过；完整后端套件中 TSDK 项通过，
  总计 152/153 通过，既有 `capture-core` 代理启动用例在当前环境失败，未改动该模块。
  调用映射和内存所有权见 `core/docs/tsdk-ace-runtime.md`；受控在线 5/30 分钟好友
  操作仍需测试账号实测。
- WASM 后续更新已标准化：新增 `core/scripts/inspect-tsdk-update.js` 和
  `npm run inspect:tsdk`，可静态输出 SHA-256、imports、exports、active data
  segments、解密高频常量、`game.js` 版本/关键标记及基线兼容性；完整发现、快照、
  差异分级、更新、离线/在线验收和回退流程见
  `core/docs/tsdk-update-runbook.md`。
- 技术栈：后端 `core` 是 Node.js/CommonJS + Express + Socket.IO；前端 `web` 是 Vue 3 + Vite + TypeScript + Pinia + UnoCSS。
- 最新快速体检结果：`web/src` 全量 ESLint 通过，`web` 生产构建通过；`core/src/**/*.js` 全量 `node --check` 通过。源码扫描未发现真实替换字符类乱码、孤立 `undefined` 行或 `_v###` 反编译变量残留；`core` ESLint 因本地 `core/node_modules` 缺少 `@antfu/eslint-config` 未作为源码失败处理。
- UTF-8 源码扫描未发现 `core/src`、`web/src` 存在真实替换字符类乱码；PowerShell 仍可能把中文显示成乱码，不能据此改源码。
- 已完成第一批低风险前端规范清理：背包空态分支、主题读取空块、确认框无意义绑定、微信扫码调试输出、静态正则、`Friends.vue` 定义顺序、`Login.vue` 换行格式。
- 已完成前端全站 ESLint 清理：对 `web/src` 全量 `eslint --fix` 收敛缩进/换行/CSS 与 UnoCSS class 排序/import 顺序等自动可修项，并手工修复 4 处无法自动修复的问题（`AccountModal.vue` 的 `stopWxCheck` 定义顺序、`CharityFlowerActivityPanel.vue` 单行双语句、`StrategyTimingPanel.vue` 未使用的 `props`）；`web/src` 全量 ESLint 现为 0 error 0 warning，`web` 生产构建通过。
- `Renewal.vue` 已修复登录态入口与续费分支：`/renewal` 不再因有效 token 被路由守卫强制跳回 dashboard；已登录用户进入续费页会预填并锁定当前用户名，提交走 `/api/user/renew` 并同步本地用户信息；未登录用户仍走 `/api/public/renew`。旧版 `D:\github\qq-farm-2.3.1` 仅作为接口行为参考，未照搬产物。
- 登录页“账号续费”闭环已补齐：`Login.vue` 会把当前输入用户名带到 `/renewal`，`Renewal.vue` 公共续费成功后带用户名回 `/login`，登录页会在输入框为空时从 query 回填用户名；已登录用户续费仍走当前账号锁定流程。
- `Login.vue` 已开始结构瘦身：卡密领取结果弹窗、找回密码验证弹窗和设置新密码弹窗已抽到 `web/src/components/login/LoginModals.vue`，父页面保留登录/注册/找回密码请求与状态 wiring，行为不变。
- 登录密码强度逻辑已抽离：评分规则在 `web/src/composables/usePasswordStrength.ts`，展示条在 `web/src/components/login/PasswordStrengthMeter.vue`，登录注册表单和重置密码弹窗复用同一套规则与 UI。
- `Friends.vue` 的 QQ 好友自动同步设置块已抽到 `web/src/components/friends/FriendsSyncSettings.vue`；父页面保留设置保存/刷新/GID 弹窗状态，组件负责展示设置项、统计提示和入口按钮。
- `Friends.vue` 的好友列表卡片与分页已抽到 `web/src/components/friends/FriendsFriendList.vue`；父页面继续持有好友筛选、展开状态、操作确认、黑名单和头像错误状态。
- 后台连接堆积导致网站打不开的问题已做防护：`core/src/controllers/admin.js` 增加 HTTP request/header/keep-alive/idle socket 超时、连接 close 清理、JSON 请求体大小限制和 `/api/health`；`core/src/models/user-store.js` 将 IP 登录失败限制加硬为 1 分钟 6 次后锁 10 分钟，并在登录成功后清理当前 IP 失败计数。
- 页面切换短暂显示“未登录/账号未登录”的问题已修复：`status` store 新增当前账号状态就绪标记，`Dashboard.vue`、`Friends.vue`、`FarmPanel.vue`、`BagPanel.vue`、`TaskPanel.vue` 只在确认当前账号离线后显示离线空态，并避免组件首次挂载时清空已有账号状态。
- `Dashboard.vue` 已去掉顶部重复状态卡、日志说明条、动作说明条和中间重复摘要卡；保留账号资源卡、运行日志、筛选、倒计时和今日统计，仪表盘信息密度更低、干扰更少。
- `Shop.vue` 已把商城标题、账号资源、分区切换、排序和刷新收敛到一条稳定横栏；删除无引用的 `ShopOverviewPanel.vue`、`ShopInfoCard.vue`，去掉分区概览统计卡和各分区商品列表前的说明条，购买流程保持不变。
- `Illustrated.vue` 已把图鉴标题、解锁/未解锁/可购买/Lv 状态、图鉴类型切换、筛选、一键购买和刷新收敛到一条稳定横栏；去掉“当前查看建议、当前阻塞汇总、当前筛选下”等解释型摘要和重复统计卡，图鉴卡片和购买流程保持不变。
- 图鉴卡片已抽到 `web/src/components/illustrated/IllustratedItemCard.vue`，卡片密度、圆角、网格列数、图片区域、状态胶囊和底部按钮区已对齐商城商品卡；图鉴图片增加加载失败兜底。
- `Activity.vue` 已按商城/图鉴同款结构收紧：活动中心标题、荷露余额、今日剩余、奖池、兑换数量、当前账号、抽奖/兑换切换和刷新统一到顶部横栏；删除无引用的 `ActivityNavigation.vue`、`ActivityOverview.vue` 和旧活动卡类型，荷露抽奖/兑换流程保持不变；活动奖励图片增加加载失败兜底，避免显示破损图片。
- 活动中心已接入本期 4 个子活动入口：奇遇礼莲、荷露商店、荷风游记、节令小札；后端 `normalizeHeluGroup` 会从活动树中标准化子活动节点参数（id/title/status/time/payload），前端只展示这 4 个入口，不恢复已过期的粽香大比拼。奇遇礼莲/荷露商店继续绑定已验证抽奖/兑换操作，荷风游记/节令小札先展示活动节点参数，等确认协议操作字段后再补交互。
- `Friends.vue` 已去掉好友页顶部说明、好友总数/黑名单/最近访客/已知 GID 统计卡，以及“当前分区说明/当前局部结论”摘要组件；删除无引用的 `FriendsStatsGrid.vue`、`FriendsSummaryCards.vue`，保留搜索、tab、QQ 同步设置、好友列表、黑名单和访客功能。
- `Friends.vue` 已修复好友管理页后台刷新后自动回到顶部的问题：整页加载态只在首次无数据时显示，已有数据刷新不再卸载主体内容；账号 watcher 也收窄到账号 id/运行状态变化，避免普通账号对象更新触发列表重载。
- 布局账号入口已调整：新增 `TopAccountMenu.vue`，将账号切换、添加账号、管理账号和备注编辑入口从左侧栏搬到顶部栏右侧；`Sidebar.vue` 删除原账号选择块，左侧更专注于用户信息、导航和底部状态。
- 左侧导航菜单已简化为短标签：概览、个人、好友、活动、商城、图鉴、分析、设置、后台；后台仍保留管理员可见限制。
- 活动页荷露抽奖点完后疑似掉线的问题已做保守防护：`core/src/services/activity.js` 对活动 Operate 增加连接状态检查，免费多抽改为串行节流请求并延迟刷新活动状态；`web/src/views/Activity.vue` 防止抽奖请求重复提交。服务已重启，`/api/health` 返回 200。
- “雨落成诗”已接入活动页与后端接口：支持天气状态、天气采集瓶购买、好友雷雨采集、雷雨召唤瓶使用、气象研究解锁、气象任务展示和闪电变异类型 12 识别；活动有效期为 2026-08-26 10:00:00 至 2026-09-08 23:59:59（Asia/Shanghai）。已补齐 4002/4003 闪电感应、2159 雨落成诗头像框等活动物品名称/图标映射，避免气象研究后段奖励显示“未知物品”。账号设置 → 日常与活动已新增雨落成诗二级卡片，可配置自动买瓶、自动采集、自动召唤和自动研究；活动过期后后端会压关，前端二级卡片和活动入口会随时间窗隐藏。活动页雨落成诗面板已改为只读展示，手动操作入口不再显示。
- 萌宠日记（S3 比熊萌宠主题赛季，`2026090100`）已接入为只读活动状态展示：`activitypb.proto` 为 `ActivityNode` 字段 115 新增 `ActivityBodyPetDiary` 及比熊成长/寻宝/照片墙/锦囊子消息；`services/activity.js` 新增只读归一化与 `getPetDiaryActivity`，worker RPC/`data-provider`/`/api/activity/pet-diary` 路由与活动卡背景均已接通；前端 `Activity.vue` 接入 `PetDiaryActivityPanel.vue` 只读面板（比熊之家、爪印手记、拾物小铺、比熊赠礼），不提供投喂/寻宝/兑换/领取操作入口。协议字段来自 2026-09-10 官方 List/Operate 明文响应，子字段语义为推断（置信度见文档），证据与待确认项见 `core/docs/pet-diary-protocol-recovery.md`；`core/test/pet-diary-activity.test.js` 4/4 通过，后端 `node --check`/`require` 与前端构建通过。
- 蹲守与飞升/秒偷功能已完全去除：前端设置 tab、独立蹲守页、相关组件、setting store 字段、后端 `/api/instant-steal`/`/api/stakeout` 路由、worker RPC/自动启动、runtime provider/config snapshot、store 配置模型和对应 service 文件均已删除；源码残留扫描无匹配。
- `core/src/controllers/admin-bag-routes.js` 已从 `_v###`/逗号表达式风格清理为命名 helper + 清晰路由处理；接口路径、主要返回结构和旧版缺账号行为保持对齐。
- `core/src/controllers/admin-farm-resource-routes.js` 已清理为命名 helper + 清晰路由处理；`/api/status` 缺账号 200 返回、其它资源接口缺账号 400 的旧行为保持对齐。
- `core/src/controllers/admin-public-info-routes.js` 已清理为命名 helper + 清晰路由处理；公共信息、更新日志、鉴权校验和 scheduler fallback 的返回结构保持对齐。
- `core/src/controllers/admin.js` 已完成入口可读性清理：CORS、静态资源、鉴权门、SPA fallback、Socket.IO 订阅逻辑均已命名化；`core/src/controllers/admin*.js` 当前无 `_v###` 残留。
- 已完成的关键结构成果：`Activity.vue`、`Settings.vue`、`Shop.vue` 已拆成页面协调器 + 组件/composables；`Friends.vue` 已开始拆页面壳，标题/搜索、统计卡、摘要提示和 tab 条已抽到 `web/src/components/friends/`；后端 `admin.js` 已拆出大量领域路由，入口主要负责启动、注册、静态资源、鉴权和 Socket.IO。
- `AdminPanel.vue` 已继续结构拆分：登录日志面板已抽到 `web/src/components/admin/AdminLoginLogPanel.vue`，登录日志状态/格式化/清空逻辑已抽到 `web/src/composables/useAdminLoginLogs.ts`，清空确认弹窗已抽到 `web/src/components/admin/AdminLoginLogConfirmModal.vue`；卡密面板已抽到 `web/src/components/admin/AdminCardPanel.vue`，卡密状态、筛选、复制、创建、删除和领取开关逻辑已抽到 `web/src/composables/useAdminCards.ts`，卡密确认弹窗已抽到 `web/src/components/admin/AdminCardConfirmModals.vue`；用户面板已抽到 `web/src/components/admin/AdminUserPanel.vue`，用户状态、统计、续费、封禁、删除、清理到期和编辑逻辑已抽到 `web/src/composables/useAdminUsers.ts`，用户确认弹窗已抽到 `web/src/components/admin/AdminUserConfirmModals.vue`；系统配置面板已抽到 `web/src/components/admin/AdminSystemPanel.vue`，系统/微信配置状态、加载、保存、重置和确认框开关已抽到 `web/src/composables/useAdminSystemConfig.ts`，对应确认弹窗已抽到 `web/src/components/admin/AdminSystemConfigConfirmModals.vue`；后台通用提示弹窗已抽到 `web/src/components/admin/AdminAlertModal.vue`；顶部汇总和 tab 外壳已抽到 `web/src/components/admin/AdminPanelHeader.vue`、`web/src/components/admin/AdminPanelTabs.vue`，页面目前主要负责模块 wiring。
- 活动能力状态：Helu 活动可见；南瓜活动后端保留但前端隐藏，属于 dormant/hidden 能力。
- 当前只保留 `progress.md` 作为接力摘要；`maintenance.md` 已删除，后续维护信息写回本文件但保持短而有用。

# 当前优先级

1. 继续拆高风险大页面，优先 `Friends.vue` 或 `AdminPanel.vue`，其次 `Login.vue`、`Sidebar.vue`、`Dashboard.vue`、`Analytics.vue`。
2. 继续拆 `AdminPanel.vue`，优先按卡密、用户、系统配置拆成 focused components/composables。
3. 对照旧版 `D:\github\qq-farm-2.3.1` 补齐/核对功能时，只迁移必要行为，按当前项目结构重落地。
4. 目录结构统一要随着模块拆分逐步做，不要先做大规模移动造成引用噪音。

# 关键决策

- 大页面只做协调器；业务规则、状态组合、重复 UI 拆到 composables、stores 或 focused components。
- 后端入口只做 wiring；具体接口按领域放到 `admin-*-routes.js` 和领域 helper/service 中。
- 后端 admin 控制器目录的 `_v###` 债务已清空；后续不要重新引入逗号表达式/反编译式临时变量风格。
- 隐藏或内部能力必须在接力记录中说明；尤其南瓜活动不要重新暴露到导航或活动页，除非用户明确要求。
- 中文乱码判断以 UTF-8 真实内容为准；终端乱码先用 Node 读取文件确认。
- 前端全量 ESLint 当前可通过；继续优先对触碰文件跑 targeted lint，阶段性再跑全量 lint 和构建。
- `git status`/`git diff` 在当前 worktree 曾不可用或不可靠；继续工作以实际文件内容和命令检查为准，不依赖 git 状态判断。

# 未完成待办

- 前端结构治理：
  - `Friends.vue`：页面仍大；标题/搜索、统计卡、摘要提示和 tab 条已抽到 `web/src/components/friends/`。下一步适合继续拆 QQ 好友自动同步设置块、好友列表项/分页、访客列表或 GID 弹窗。
  - `AdminPanel.vue`：主要面板 UI、卡密/用户/日志/系统配置逻辑、全部后台弹窗模板、顶部汇总和 tab 外壳均已抽离；页面目前主要保留各模块 wiring，后续优先转向 `Friends.vue`、`Login.vue`、`Sidebar.vue` 等仍偏大的页面。
  - 快速排查显示剩余主要债务不是语法错误，而是大文件和类型边界：`Friends.vue`、`Login.vue`、`Sidebar.vue`、`Dashboard.vue`、`Analytics.vue`、`models/store.js`、`core/worker.js`、`models/user-store.js`、`services/activity.js` 等仍适合分批拆分；前端大量 `any` 应优先从 store/API 边界和高频页面逐步收窄。
  - 逐步减少 `any`，优先在 store/API 边界和高频页面中补类型，不做一次性全项目类型重写。
- 后端结构治理：
  - 已清理 `admin.js`、`admin-bag-routes.js`、`admin-farm-resource-routes.js`、`admin-public-info-routes.js`，这些文件应保持 0 个 `_v###`。
  - 大型服务/模型仍需逐步拆分：`models/store.js`、`core/worker.js`、`models/user-store.js`、`services/activity.js`、好友/农场/仓库相关服务。
- 功能面核对：
  - 新增或恢复功能时，确认它是可见、隐藏、内部还是休眠。
  - 检查是否还有后端存在但前端无入口、且未记录状态的能力。

# 接力约定

- 新对话先读本文件，再读相关源码；不要凭记忆改。
- 每次只选一个明确模块推进：先读当前实现，必要时对照 `D:\github\qq-farm-2.3.1`，再小步修改和验证。
- 手工编辑使用 `apply_patch`；不要回滚用户或其他过程留下的无关改动。
- 后端改动后至少跑 `node --check` 对触碰文件；拆/改路由时再跑 `node -e "require('./core/src/controllers/admin'); console.log('backend require ok')"`。
- 前端改动后至少跑 targeted `npx eslint ...`；影响页面/组件结构时跑 `cd web && npm run build`。
- `@vueuse/core` Rollup pure-comment warning 是已知非阻塞警告；UnoCSS 拉取 Google web fonts 超时也可能在网络不稳时出现。构建退出码为 0 即可记录为通过。
- 遇到中文显示异常，先用 `node -e "const fs=require('fs'); console.log(fs.readFileSync('path','utf8'))"` 确认真实内容。
- 不把全站 lint、全站格式化、全站类型改造作为默认目标；只有用户明确要求或分阶段收敛到位后再做。
- 要记得及时更新本文件

## 2026-07-06 TSDK / ACE 修复

- 已对官方 `game.js` 完成关键静态去混淆：官方调用为
  `SdkInitEx(3167, 0)`；`AnoUserLogin(0, openId)` 仅维护账号身份。
- 官方网关 Token 来自 `AceManager.randomStr()`，格式为 64～127 个字母数字字符
  加 `=`，不是 `_generate_token` 返回的 24 字符 hash；登录后还会优先消费一次
  `_get_encrypted_init_info`，对应抓包里首条 `AllLands` 的特殊长 Token。
- ACE 生命周期已按官方封装拆分：5 秒处理接收队列和轮询上报、25 秒 TSDK
  heartbeat、30 秒速度检测、150 秒状态上报、180 秒函数检查。
- 官方 20260706 抓包确认：登录和好友操作 Token 均符合随机格式；4 分钟后仍能
  Enter、PutWeeds、PutInsects、Farming，说明持续有效依赖 ACE 状态而非固定 Token。
- `core` 定向 ESLint 通过，6 个离线测试通过；仍需使用测试账号完成至少 5 分钟
  在线好友操作验证后才能确认服务端链路完全恢复。
- 活动中心已替换为“心许千灯星垂野”：接入主活动 `2026072700`、观星礼录
  `2026072701/cmd 21`、星砂商店打开 `2026072702/cmd 7`、兑换
  `2026072702/cmd 1`、千星游记和节令小札；可展示并领取二十八星宿奖励，星砂商店
  展示 18 项商品、协议映射名和星砂余额，并支持装扮及化肥兑换。
- 已将本轮活动更新沉淀为
  `core/docs/activity-update-runbook.md`，并新增
  `npm run inspect:activity-har -- <HAR>` 脱敏检查命令，后续活动按“完整抓包、协议表、
  官方资源、种子/植物/果实映射、分层接入、离线与在线验收”流程更新。


## 2026-09-12 移动端卡顿优化

问题定位（按影响排序）：

1. `FarmPanel.vue` 每秒 `lands.value = lands.value.map(...)` 重建整个数组，
   导致每一块地都拿到全新的 prop 对象，几十个 `LandCard` 每秒全量重渲染 —— 这是主因。
2. 每个 `LandCard` 各自起一个 `setInterval(..., 1000)`，几十块地 = 几十个定时器。
3. 每个 `LandCard` 都在 window 上常驻 `scroll`（捕获）/`resize` 监听，
   滚动一帧触发几十次回调，每次还 `await nextTick` + `getBoundingClientRect` 强制回流。
4. 地块变异特效（金色光环/闪光、冰晶、爱心、黑化烟雾、水滴、闪电、七夕羽毛）都是
   `animation: ... infinite`，几十块地叠起来上百个逐帧动画；再加 7 处 `-webkit-/backdrop-filter` 毛玻璃。

已做改动：

- 新增 `web/src/composables/useSharedClock.ts`：全局单例秒级时钟，引用计数启停，
  页面切后台自动停表、回前台立即校准。整页只有一个定时器。
- `LandCard.vue`：改用共享时钟；`scroll/resize` 监听改为仅在
  `isometric && selected` 时动态注册，并用 `requestAnimationFrame` 节流。
- `FarmPanel.vue`：倒计时改为原地修改 `matureInSec`（不再重建数组）；
  新增 `visibilitychange` 监听，回到前台立即拉一次真实数据校准倒计时。
- 新增 `web/src/composables/usePerformanceMode.ts` + `src/style.css` 的 `.perf-lite` 降级规则：
  关掉 `backdrop-filter` 与地块/天气/布局的装饰性无限动画（静态配色和滤镜保留，闪电帧固定第一帧）。
  自动判定：手机/平板、系统“减少动效”、省流量模式 → 开启；桌面默认关闭。
- 新增设置页「界面性能」页签 + `PerformanceModeCard.vue`（自动/始终开启/始终关闭，存 localStorage，即时生效）。
- `main.ts`：挂载前先应用流畅模式，避免首屏闪一下完整动效。

故意没做的：

- 没给 `.land-card` 加 `contain: layout/paint`。卡片内部靠 `.land-card > :not(.land-ground-layer) { z-index: 1 }`
  参与全局层叠来实现等距视图的前后遮挡，一旦每张卡自成层叠上下文，后排卡片的前景会被前排地面盖住，会破坏景深排序。

验证：`npm run build`（含 `vue-tsc -b`）退出码 0；改动文件定向 ESLint 0 error 0 warning；
产物 `index-*.css` 已确认包含 `.perf-lite` 规则。


## 2026-09-12 移动端登录输入不流畅

排查 `views/AuthView.vue`（1395 行）后的成因与修复：

1. **每次按键触发整个登录页重渲染**：`username/password/...` 都在 AuthView 的 render 依赖里，
   敲一个字就要重建品牌区 + 表单区的全部 vnode。
   → 品牌区 `aside.brand-side` 只依赖 `mode`，加 `v-memo="[mode]"` 跳过这棵子树。
   （没有用 `v-model.lazy`：回车提交走 `keydown`，此时 `change` 还没触发，会提交到旧值。）
2. **三层 `filter: blur(80px)` 背景光斑（520~600px）留在主绘制层**，输入框每次重绘都会连带重算大模糊。
   → scoped 里加 `transform: translate3d(0,0,0)` 提升为独立合成层；
   同时在 `style.css` 的 `.perf-lite` 下 `.bg-blob { display: none }`（移动端默认开启流畅模式，直接省掉）。
3. **`.form-side__input { transition: all 200ms ease }`** → 改为只过渡 border-color / box-shadow / background-color。
4. **全局 `html,body { text-rendering: optimizeLegibility }`** 会让输入框文本每敲一字都走字距/连字计算
   → 输入框上覆盖 `text-rendering: auto`。
5. **iOS 聚焦缩放**：`font-size: 14px` 的输入框会让 Safari 自动放大整页，聚焦瞬间跳动就是最典型的“卡顿”体感。
   → 860px 断点下统一提到 16px（原来只有 480px 断点做了）。
6. **键盘弹出后输入框被裁掉且滚不过去**：原来只有 `@media (max-width: 480px)` 给 `.auth-card` 加了滚动，
   且用的是 `100vh`（不随键盘收缩）。上移到 860px 断点并改用 `100dvh`，480px 档再覆盖成 `calc(100dvh - 32px)`
   以匹配该档 16px 的 padding。`.auth-shell` 同步补 `min-height: 100dvh`。

验证：`npm run build`（含 `vue-tsc -b`）退出码 0；AuthView / style.css 定向 ESLint 干净；
产物已确认包含 `.perf-lite .bg-blob`、`100dvh`、`font-size:16px`、`text-rendering:auto`。


## 2026-09-12 移动端登录页布局重做

`views/AuthView.vue` 的 Responsive 段整体重写（860px / 480px 两个断点）：

- **品牌区压成紧凑横幅**：原来的长描述 + 三条要点 + 状态条在移动端要吃掉近 200px 纵向空间，
  860px 以下全部 `display: none`；标题两行竖排改并排一行（`display: flex; flex-wrap: wrap` + 子项 `display: inline`），
  padding 从 44/40 收到 18/22，标题 34px → 20px（480px 档 18px）。
- **表单区收紧**：padding 44/48 → 20/22；head margin 24 → 16；mode-tag 与表单间距同步收。
- **触控目标放大**：输入框 min-height 48px、眼睛按钮 28px → 44px、提交按钮 46px → 50px。
- **模式切换链接改胶囊**：原来一行小字 + 点分隔，移动端改成 `min-height: 40px` 的圆角胶囊，
  去掉 `.form-side__sep`，当前模式用实心底色（`.is-active`，dark 下另给颜色）。
- **分割线 `.form-side__divider`** 在移动端隐藏（纯占空间）。
- **卡片高度修正**：860px 档的 `max-height` 原来是 `calc(100dvh - 32px)`，
  但该档 auth-shell 上下 padding 仍是 32px（合计 64px），会超出被裁；改成 `- 64px`，
  480px 档（padding 16px）保持 `- 32px`。

新增开发预览工具 `web/public/mobile-preview.html`：手机外框 + iframe 加载 `/login`，
支持 iPhone SE / iPhone 14 / Pro Max / Pixel 7 / 320 小屏 / 平板六档尺寸切换，
高度超出窗口时自动等比缩放。仅用于本地预览，会被一起打进 dist，不需要时可删。

验证：AuthView 定向 ESLint 干净；dev server（127.0.0.1:5173）下 `/login` 与 `/mobile-preview.html` 均 200。


## 2026-09-12 登录页「忘记密码」改两步式弹窗

把原来登录页里的 `forgot` 整页模式（用户名→卡密→新密码→确认）重做成**两步式弹窗**，对齐用户给的两张截图：步骤 1 输入卡密验证 → 步骤 2 显示绑定账号并设置新密码。

后端（`core/src/controllers/admin-auth-routes.js`，上轮已完成并通过测试）：
- 新增 `POST /api/forgot-password/verify`：卡密 → 反查绑定账号（`user.card` 或卡密库 `usedBy`）→ 返回 `{ username, resetToken, expiresInSec }`；`resetToken` 为 `crypto.randomBytes(32)` 内存态、5 分钟 TTL、一次性。
- 新增 `POST /api/forgot-password/reset`：凭 `resetToken` + 新密码设密码，`consumeForgotResetToken` 一次性消费；成功后 `invalidateAdminSessions` 踢该账号在线会话。
- 失败锁定键固定挂在来源地址（`req.socket.remoteAddress + '::@card-verify'`），防止换卡密/换 token 绕开锁定；XFF 伪造无效。旧单步 `/api/forgot-password` 保留兼容。
- 测试：`core/test/forgot-password-two-step.test.js`（8 用例）+ 旧回归（14 用例）全通过。

前端：
- 新增 `web/src/components/login/ResetPasswordModal.vue`：Teleport+Transition 弹窗，沿用登录页 emerald 设计语言（12px 圆角、16px 移动端字号、`text-rendering:auto`、`100dvh` 安全、Esc/点遮罩关闭）。
  - 步骤 1（验证卡密）：卡密输入 → 「验证卡密」→ 成功后进入步骤 2，并显示 5 分钟倒计时与「重新验证卡密」。
  - 步骤 2（设置新密码）：显示绑定账号、新密码/确认（带显隐切换）、「重置密码」；凭据倒计时归零自动退回步骤 1；后端报「重新验证卡密」也退回步骤 1。
  - 成功态展示勾选并「返回登录」，通过 `@success` 把账号回填到登录框。
  - 429 锁定按返回分钟数本地倒计时禁用按钮（到点再试，最终仍由服务端裁决）。
- `web/src/views/AuthView.vue`：删除 `forgot` 模式整段（PANEL 条目、表单项 `newPassword`/`confirmPassword`、相关 ref/函数、`submit` 分支、mode-tag/brand-sub 的 forgot 分支）；「忘记密码」链接改为 `openResetModal()` 弹出弹窗；`/login?mode=forgot` 在 `onMounted` 时直接唤起弹窗；`onResetSuccess` 回填用户名并切回登录。
- `web/public/mobile-preview.html`：预览页新增「页面」切换条，可一键加载 `/login` 或 `/login?mode=forgot` 直接看弹窗。

验证：`web/src` 改动文件定向 ESLint 0 error（`npm run build` 含 `vue-tsc -b` 退出码 0）；`BagSeedPriorityPanel.vue:324` 的 `style/max-statements-per-line` 为既有问题、不在本次改动范围未动。dev server（127.0.0.1:5173）`/mobile-preview.html` 与 `/login?mode=forgot` 均可访问。

移动端弹窗最终改为居中：用户反馈手机真机上弹窗出现在底部，要求改成居中。因此去掉 `@media (max-width: 640px)` 的底部抽屉逻辑，保留居中布局；仅保留移动端触控目标放大（输入框 16px、眼睛按钮 44px、提交按钮 50px）和适当收紧的 padding。同时移除 `mobile-preview.html` 里的 viewport 强写和 `.preview-mobile` 类注入。`web/src` 改动文件 ESLint 与 `npm run build` 仍为 0 错误。

`Personal.vue` 顶部 tab 栏移动端平齐优化：用户截图显示「我的农场/我的背包/我的任务」三个 tab 宽度/视觉重量不一致。把三个按钮改为 `flex-1` 等宽，内容 `justify-center` 居中；非激活态增加 `border border-gray-200`（dark 下 `dark:border-gray-700`）和 `bg-white`，使三个 tab 外形高度一致；字号降到 `text-sm`、内边距 `px-3 py-2.5`，避免小屏溢出；并用 `v-for` 循环生成 tab，减少重复结构。`src/views/Personal.vue` ESLint 与 `npm run build` 通过。

## 2026-09-12 修复「填充化肥」开启后不自动使用

用户反馈：开启「填充化肥 / 自动填充化肥」（`fertilizer_gift`）后，背包里的化肥礼包没有被自动开启。

根因：`openFertilizerGiftPacksSilently()` 此前只挂在两处——(1) 每日任务 `runDailyRoutines`（约每天一次）、(2) 启动时登录成功钩子（`worker.js` ~L1472）。它**没有**像「自动购买化肥」（`fertilizer_buy_*`）那样接入 `farm-scheduler` 的周期性检测定时器，也**没有**在开关由关变开时立即触发。因此：
- 会话中途打开开关，要等下次每日任务或重启 bot 才会生效；
- 开关开启时已存在的背包礼包不会立即被开启。

修复（完全对齐 `fertilizer_buy_*` 的既有模式）：
- `core/src/services/farm-scheduler.js`：新增 `fertilizerGiftScheduler`（`createScheduler('fertilizer_gift')`）与 `startFertilizerGiftCheckTimer()` / `stopFertilizerGiftCheckTimer()`，每 30 分钟调用一次 `openFertilizerGiftPacksSilently()`；开关关时直接 return、不挂定时器。
- `core/src/services/farming-orchestrator.js`：在 `startFarmCheckLoop` / `stopFarmCheckLoop` 中与购买定时器一起启停填充化肥定时器（同生命周期）。
- `core/src/core/worker.js` `applyRuntimeConfig`：新增「`fertilizer_gift` 由关变开 → 2 秒后 `openFertilizerGiftPacksSilently()` 立即开启一次」的逻辑，沿用其余自动化（star/mystery/daily/friend_bad/golden_bug）的「became-enabled 立即执行」写法。该路径由 web 保存自动化（`/api/automation` → `provider.setAutomation` → `broadcastConfigToWorkers` → worker `config_sync`）触发，覆盖「账号功能」页与「自动化」页两个开关。

说明：`autoOpenFertilizerGiftPacks` 内部仍有条件限制（背包需有 ID∈{100003..100012} 或 `interaction_type` 为 fertilizer/fertilizerpro 的道具、且容器未满 ≥990h 才处理），这些既有行为未改动；若背包无匹配道具或容器已满，会静默跳过，属正常。三处改动 `node --check` 通过。

## 2026-09-12 「背包种子优先顺序」卡片重排改用 vuedraggable

用户要求：把「背包种子优先顺序」面板的卡片移动形式换成标准拖拽库。

改动：`web/src/components/settings/BagSeedPriorityPanel.vue` 用 `vuedraggable`（v4.1.0，依赖 `sortablejs` 1.15.7，已加进 `web/package.json` 并安装）替换原先自研的「100ms 长按 + 几何命中检测 (`findDropTarget`) + ghost 占位」拖拽实现。

- 模板：用 `<draggable v-model="dragList" item-key="seedId" ...>` 包裹卡片，`#item` 插槽渲染；移除原 pointerdown/move/up/cancel 全套手势、`.bag-seed-ghost` 占位 div、`invisible`/`fixed` 浮动样式、「拖到这里」末尾提示。
- 交互：桌面直接拖动，移动端设 `:delay="120"` + `:delay-on-touch-only="true"` 保留滑动手感；`filter=".seed-act"` 让上移/下移/移出按钮不参与拖拽（`preventOnFilter=false` 使按钮点击仍生效）；`:disabled="saving"` 保存时禁拖；新增 scoped 样式定义 `.bag-seed-ghost`/`.bag-seed-chosen`/`.bag-seed-drag` 三种拖拽态外观。
- 数据：新增 `dragList` ref 与 `sortedBagSeeds` 双向同步（仅顺序变化时替换，避免回环）；`@end="onDragEnd"` 把拖拽后顺序写回 `localPriority` 并 `emitChange`。原 ↑/↓ 按钮、移出/放回/全部放回/重置顺序 逻辑全部保留。
- 清理：删除约 150 行自研拖拽代码（`DragState`、`findDropTarget`、`commitDrop`、`resetDragState`、pointercancel 全局监听等）。

验证：`web` 生产构建（`vue-tsc -b && vite build`）通过；该文件 ESLint 0 error（仅一处 `:filter="'.seed-act'"` 静态字符串绑定报错，已改为 `filter=".seed-act"`）。

## 2026-09-12 「填充化肥」改为事件驱动（背包有了就自动使用，不再轮询）

用户反馈：上一条加的 30 分钟轮询定时器不符合预期——要求「不用加时间，背包有了就自动使用」。改为完全事件驱动：背包收到化肥类道具的推送时立即开启礼包，去掉定时轮询。

- 回退轮询：`core/src/services/farm-scheduler.js` 删除 `fertilizerGiftScheduler` / `startFertilizerGiftCheckTimer` / `stopFertilizerGiftCheckTimer` / `checkFertilizerGiftOnce` 及 `openFertilizerGiftPacksSilently` 的导入；`core/src/services/farming-orchestrator.js` 在 `startFarmCheckLoop` / `stopFarmCheckLoop` 中移除对应的启停调用与导入。
- 导出判断函数：`warehouse.js` 在 `module.exports` 新增 `isFertilizerRelatedItemId`（原仅内部使用），供 network.js 在推送里识别化肥类道具（ID 100003–100012 或 interaction_type 为 fertilizer/fertilizerpro；容器 1011/1012 不在此列，不会误开启）。
- 推送入口：`core/src/utils/network.js` 的 `ItemNotify` 处理里新增分支——当 `delta > 0 || count > 0` 且 `isFertilizerRelatedItemId(id)` 为真，发 `networkEvents.emit('fertilizerItemReceived', { id, count, delta })`。warehouse 与 network 互相依赖，故用 `getWarehouseLazy()` 运行时惰性加载，规避循环依赖导致的加载期导出 undefined。
- 事件处理：`core/src/core/worker.js` 在登录就绪的监听注册块里挂 `fertilizerItemReceived`，若 `getAutomation().fertilizer_gift` 开启则用 `workerScheduler.setTimeoutTask('fertilizer_gift_on_item', 1500, ...)` 去抖（同 key 会重置，连续到达只触发一次），到时调用 `openFertilizerGiftPacksSilently()`；`stopBot` 里同步 off 并置空。保留此前「配置从关变开 → 2 秒后开启一次」的即时触发（非轮询，符合「不用加时间」）。
- 自动开启逻辑本身不变：`autoOpenFertilizerGiftPacks` 仍只收集背包内化肥类道具、按容器上限自适应用量、容器已满则静默返回。

验证：5 个改动文件 `node --check` 全部通过；全仓 grep 确认无 `start/stopFertilizerGiftCheckTimer`、`checkFertilizerGiftOnce`、`fertilizerGiftScheduler` 残留引用。

## 2026-09-12 图鉴页去除逐条「图鉴可购买检查」日志，避免刷新时刷屏

用户反馈：点图鉴/种子商城（橄榄/商城）时，控制台被「图鉴可购买检查」日志刷屏，每次浏览器刷新都会逐条打印所有未解锁作物的检查信息。

- 原因：`core/src/controllers/admin-illustrated-helpers.js` 的 `buildIllustratedItem` 里对每个 `!unlocked && seedId > 0` 的图鉴项都 `adminLogger.info('图鉴可购买检查', {...})`；图鉴总数 186 项，未解锁项很多，每次 `GET /api/illustrated` 都会输出大量重复日志。
- 改动：`buildIllustratedItem` 删除该逐条日志及不再使用的 `adminLogger` 参数；`core/src/controllers/admin-illustrated-routes.js` 的调用处同步去掉 `adminLogger` 传参。路由层仍保留「获取图鉴列表请求」「图鉴列表数据」「图鉴列表返回」等请求级 summary 日志，可购买数量在 `图鉴列表返回` 的 `canBuy` 字段中已有汇总。
- 验证：两个改动文件 `node --check` 通过；全仓 grep 确认无其他调用点依赖旧的 `buildIllustratedItem` 签名。

## 2026-09-12 图鉴页刷新不再刷日志：加短时缓存 + 诊断日志降为 debug

用户继续反馈：上一条删掉逐条「图鉴可购买检查」后，每次浏览器刷新仍会打印一批请求级日志（`图鉴API响应`/`图鉴解码成功`/`图鉴原始数据解析`/`获取图鉴列表请求`/`种子商店映射`/`图鉴列表数据`/`图鉴列表返回`）。

- 根因：前端 `Illustrated.vue` 在 `onMounted` 与 `watch([currentAccountId, illustratedType])` 都用 `refresh=false` 拉数据，整页刷新/切页都会重复走一遍 `GET /api/illustrated`；后端每次都重新取数据并逐条 info 打印。
- 加短时缓存：`core/src/controllers/admin-illustrated-routes.js` 新增模块级 `illustratedCache`（key=`accountId:illustratedType`，TTL 30s）。非 `refresh=true` 请求命中缓存直接返回，不再触发 RPC 与日志；`refresh=true` 绕过并刷新缓存。购买后经 `invalidateIllustratedCache` 失效（`/buy` 清该账号全部类型，`/buy-all` 清对应类型），`admin-illustrated-purchase-routes.js` 通过 `routeContext` 接收该函数。
- 降噪：把仅用于排查的中间步骤日志改为 `debug`（默认 level 为 info，不再出现在控制台）——
  - `core/src/services/illustrated.js`：`图鉴API响应`、`图鉴解码成功`、`图鉴原始数据解析` → debug（`图鉴解码失败`/`获取图鉴列表失败` 仍为 error）。
  - `core/src/controllers/admin-illustrated-helpers.js`：`种子商店映射` → debug。
  - `core/src/controllers/admin-illustrated-routes.js`：`获取图鉴列表请求`、`图鉴列表数据` → debug；`图鉴列表返回` 仅当 `refresh=true`（显式刷新/购买后）时用 info，被动加载（页面刷新 `refresh=false`）时降为 debug。
- 效果：页面刷新（`refresh=false`）无论是否命中缓存都不再产生 info 级图鉴日志；显式刷新/购买时每次最多一行 `图鉴列表返回`；购买等用户操作仍照常记录。
- 验证：4 个改动文件 `node --check` 通过；`node --test test/illustrated-order.test.js test/illustrated-fruit-config.test.js` 4/4 通过。

## 2026-09-12 移动端内部页面布局优化

用户需求：优化登录后「内部页面」在手机上的布局。先用只读审查通读了所有内部视图与相关组件（`views/` 除 AuthView 外 + 布局外壳 + FarmPanel/BagPanel/shop/friends/settings 等），按「会横向溢出 / 控件不可用」优先修复了一批问题。手机基准宽 ~375px（内部内容宽约 311px）。

高优先级（会溢出/被挤压）：
- `web/src/views/Analytics.vue`：标签栏（L331）加 `custom-scrollbar overflow-x-auto`，3 个按钮加 `shrink-0 whitespace-nowrap`；作物工具栏（L402）外层加 `flex-wrap`，搜索框容器 `w-full min-w-0 sm:w-auto`，两个排序下拉改 `min-w-[6rem]/[4.5rem] flex-1 sm:w-40/20 sm:flex-none`，解决 5 个控件挤在一行溢出。
- `web/src/views/Dashboard.vue`：资源卡从固定 `grid-cols-4` 改 `grid-cols-2 sm:grid-cols-4`；4 个数字 `text-2xl`→`text-xl sm:text-2xl`；首/末卡在手机上改居中（`text-center sm:text-left/right`，图标行 `justify-center sm:justify-start/end`），避免 4 列各 ~68px 放不下长数字。
- `web/src/components/FarmPanel.vue`：巡田摘要从固定 `grid-cols-4` 改 `grid-cols-2 ... sm:flex sm:flex-wrap`，胶囊不再被压到溢出。
- `web/src/components/friends/FriendsTabs.vue`：标签栏加 `overflow-x-auto`，按钮 `shrink-0 whitespace-nowrap`，手机 `px-3 sm:px-4`。

中优先级（触控尺寸/固定尺寸）：
- `web/src/components/settings/AccountSettingsTab.vue`：5 个图标按钮 `min-h-[36px] min-w-[36px]` → `min-h-11 min-w-11`（44px）。
- `web/src/components/ThemeToggle.vue`：主题面板 `w-80` 固定 → `w-[min(90vw,20rem)] max-h-[85dvh] overflow-y-auto`。
- `web/src/layouts/DefaultLayout.vue` 汉堡按钮 `h-9 w-9` → `h-10 w-10`；`web/src/components/Sidebar.vue` 关闭按钮 `h-8 w-8` → `h-10 w-10`、主题按钮 `h-7 w-7` → `h-9 w-9`。
- `web/src/App.vue`：根容器 `h-screen w-screen` → `h-[100dvh] w-full`，避免移动端地址栏导致底部裁切/横向溢出。
- `web/src/components/friends/FriendsFriendList.vue`：好友卡信息区加 `min-w-0`，昵称包 `truncate`，徽标 `shrink-0`，长昵称/GID 不再撑破行。
- `web/src/views/Settings.vue`：通知页头 `flex-wrap gap-3` + 文本块 `min-w-0`。

未改动（已评估）：`BaseButton` 的 sm/md 高度与全站 36px 控件基线一致，单独放大反而破坏一致性；`BaseSwitch` 由 `<label>` 包裹已可点，改高度会牵动大量设置行；`FarmScene/LandCard` 等距视图热区属固有取舍；`Activity` 里 `w-96/w-72` 的星活动 Hero 处于关闭开关后（当前不渲染）。View 侧 `Shop/Illustrated/Pet/Personal` 审查已移动端友好。

验证：`web` 生产构建（`vue-tsc -b && vite build`）通过（357 modules，`✓ built in 18.54s`）。

## 2026-09-13 深度审计后按优先级修复（第1批：误删/崩溃/停摆/泄漏/竞态/逻辑）

用户指定顺序：道具误删 → 进程崩溃 → 调度停摆 → 好友会话泄漏 → startBot 僵尸/sendMsg 竞态 → 商城/施肥/时区。全部已实施。

**1. 道具误删（warehouse.js）**
`FERTILIZER_RELATED_IDS` 原含 `100005-100012`（晨露/桑榆/桃源/天工种子包、图鉴限定礼包、友谊种子包、天工限定包、爱心宝箱），对照 `gameConfig/ItemInfo.json` 这些均非化肥，会被 `autoOpenFertilizerGiftPacks` 整叠 `batchUseItems` 消耗。
- 改为 `FERTILIZER_GIFT_PACK_IDS = {100003 化肥礼包, 100004 有机化肥礼包}`，`FERTILIZER_RELATED_IDS` 保留为其别名（兼容旧引用）。
- `getFertilizerItemTypeAndHours` 新增 `gift` 类型返回；`autoOpenFertilizerGiftPacks` 增加白名单校验：`type` 非 `normal/organic/gift` 一律 `continue`（纵深防御）。
- 因 `network.js:522` 也用 `isFertilizerRelatedItemId` 做事件驱动触发，收窄后收到种子包不再误触发。

**2. 进程崩溃（client.js + admin.js）**
- `core/client.js` 顶层新增 `process.on('unhandledRejection'|'uncaughtException')` 兜底：记录 error 日志后继续运行；仅 60s 内异常 >100 次才退出，避免错误风暴。
- `core/src/controllers/admin.js` 的 `registerRequestTimeoutGuard`：包装 `res.json/res.send`，一旦 `requestTimedOut && headersSent` 即忽略，避免 120s 超时后 handler 二次发送抛 `ERR_HTTP_HEADERS_SENT`。

**3. 调度停摆（worker.js）**
- `acquireTaskPermit()` 增加 30s 超时与 `PERMIT_TIMEOUT` 哨兵（区别于 `null`=无需许可），授权到达时清除定时器；迟到授权被忽略，无残留。
- `runUnifiedTick` 收到哨兵则跳过本轮（不在无并发控制下执行），下一 tick 自然重试；`releaseTaskPermit` 忽略哨兵。
- 覆盖主进程侧 `worker-manager.js` 三种丢包（worker 重启/队列丢弃/send 失败）。

**4. 好友会话泄漏（friend-land-analyzer.js）**
`getFriendLandsDetail` 用 `entered/left` 标志 + `finally` 保证「进入成功则必定 Leave」，修复 `getUserState()` 为空时 `:443` 抛错导致全局唯一访问会话被占用 2 分钟的问题；且不会在 enter 自身已清理 token 时重复释放。

**5. startBot 僵尸 / sendMsg 竞态**
- `worker.js`：`startBot` 拆为外层 try/catch + `startBotInner`，失败时复位 `isRunning/loginReady` 并上报，避免 `if (isRunning) return` 吞掉后续启动。
- `network.js` `sendMsg`：捕获当前 `socket`，在 `await encodeMsg` 后校验 `socket !== ws || readyState !== OPEN`，连接变化则取消发送并回调错误，杜绝「旧消息发到新连接」。

**6. 商城/施肥/时区/成熟判定**
- `mall.js`：两条购买循环新增 `maxRounds`——价格或点券余额未知且无目标数量时只买 1 轮（原可跑满 100 轮×10=1000 个），并打 `result:'limited'` 日志；有 `targetCount` 时仍由 limit 约束。
- `farm-fertilizer.js`：organic/both 分支仅在 `explicitIds` 为空时才回退全农场，修复多季补肥/种植后补肥被施到全农场。
- 新增 `utils.getServerDateKey()`（服务器时间 UTC+8）；`stats.js`/`warehouse.js`/`mall.js`/`worker.js`/`activity.js` 的本地日期键统一改为委托它（`task.js` 本就用 UTC+8，保持）。
- `capital-mode.js`：成熟判定与 `farm-land-analyzer` 对齐（粗状态 6 / 阶段记录 ID 19 于 `phase` 或 `phase_id`，否则取最后一个剩余阶段），修复部分作物（如“盛开”牵牛花）永不触发“成熟前部署狗”。

**验证**：`node --check` 全部改动文件通过；`node --test test/*.test.js` **390/390 通过**（两次，分别在 1–5 项后与 6 项后）；针对化肥 ID 与日期键的 16 项冒烟断言全通过。

## 2026-09-13 移动端优化：账号功能设置弹窗（AccountFeatureSettings）

用户给出 4 张手机截图（背包与收获 / 土地与补给 / 好友 / 日常与活动），反映该弹窗在移动端的问题。

根因（截图 1 标题被顶部裁掉、截图 3/4 页脚被底部浏览器栏遮住）：
- 遮罩用 `grid place-items-center` + `overflow-y-auto`。当内容高于可视区时，垂直居中会把内容同时向上下溢出，**溢出到滚动原点之上（顶部）的部分无法滚动到**，于是标题被裁掉。
- 弹窗用 `max-h-[94vh]`。移动端 `vh` 是「大视口」（含浏览器地址栏/底栏区域），比实际可视高度大，导致弹窗底部超出可视区，页脚被底栏遮挡。

改动：
- `AccountFeatureSettings.vue`
  - 遮罩：`grid place-items-center` → `grid justify-items-center items-start overflow-y-auto ... sm:items-center`，内边距 `p-3` → `p-4`（sm 仍 `p-6`）。
  - 弹窗：`max-h-[94vh]` → `max-h-[calc(100dvh-2rem)] ... sm:max-h-[94vh]`（dvh 跟随地址栏/键盘收缩）。
  - 页脚：加 `shrink-0`；`py-4` → `pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]`（避开 iPhone 底部安全区）；两个按钮加 `flex-1 sm:flex-none` 便于点按。
  - 头部：`px-4 py-3.5` + `gap-3`（sm 恢复 `px-6 py-4 gap-4`）；关闭按钮 `p-2` → `h-11 w-11`（44px）。
  - 内容区：`px-4 py-4 sm:px-6 sm:py-5`；模块卡片 `min-h-[184px]` → `min-h-[150px] sm:min-h-[184px]`。
- `StrategyTimingPanel.vue`：`grid grid-cols-2 md:grid-cols-2` → `grid-cols-1 sm:grid-cols-2`（截图 3 的「帮助巡查最小/最大(秒)」在手机上不再挤成两列）；静默时段时间输入 `w-20 px-2 py-1 text-xs` → `h-9 w-24 px-2 text-sm`。
- 同类反模式一并修复（同样的 `vh` 限高 / 无滚动兜底）：`AutomationSettingsTab.vue` 神秘商店设置弹窗、`AccountModal.vue`（加 `p-4`、`max-h-[calc(100dvh-2rem)]`、内容区 `calc(100dvh-6rem)`）、`Friends.vue` GID 列表弹窗。

验证：`npm run build`（`vue-tsc -b && vite build`）通过，357 modules，`✓ built in 16.43s`；并确认产物 CSS 中 `max-h-[calc(100dvh-2rem)]`、`pb-[calc(0.75rem+env(safe-area-inset-bottom))]`、`justify-items-center`、`items-start` 等 arbitrary utilities 均已生成（UnoCSS 会静默丢弃无法解析的类，故需实测产物）。
补充：构建里 `[unocss] failed to load icon "carbon-view-*"` 是既有误报（UnoCSS 把 `preview-label` 之类的属性名/标识符当成图标名），非真实缺图标——已核对 `i-carbon-view` / `i-carbon-close` / `i-carbon-checkmark` 等真实图标都在产物 CSS 中。

## 2026-09-13 移动端修复续：偷菜 / 神秘商人弹窗「显示在中间」

用户反馈：移动端账号设置里，**偷菜**与**神秘商人**点「配置」时弹窗「不是在上方而是在中间」。

### 定位过程（真组件复现）

这两个模块内容极短（偷菜只有一个说明段、神秘商人只有 3 个开关），是「居中」最显眼的两个。为排除臆测，搭了**真组件探针**：临时 `web/__probe__.html` + `web/src/__probe__.ts` 用项目自己的 Vite dev server 渲染真实 `AccountFeatureSettings.vue`（桩 props），再用 CDP + 无头 Edge 扫宽度测量。

实测（`panelTop` = 弹窗顶边距）：

| 视口宽 | align-items | panelTop | 结论 |
|---|---|---|---|
| 360 / 390 / 414 / 430 / 480 / 560 | flex-start | 16 | 贴顶 ✓ |
| **640 / 641 / 768** | **center** | **≈250** | **居中 ✗** |
| 1024 / 1440 | center | ≈256 | 居中（桌面预期）✓ |

结论：**手机上（<640px）本来就是贴顶的**；问题出在 `sm:` 断点——只要视口 ≥640px（平板、横屏手机、部分内嵌浏览器/桌面模式）就会切成居中。

### 根因

**用「宽度」断点决定弹窗的「垂直」对齐，本身就是错的设计轴**：横向够宽不代表纵向该居中。

### 改动

- `AccountFeatureSettings.vue`：`sm:items-center` → **`lg:items-center`**，`sm:max-h-[94vh]` → `lg:max-h-[94vh]`。
- 同源一致性（同类弹窗一并改 `lg:`）：`AutomationSettingsTab.vue` 神秘商店弹窗、`AccountModal.vue`（遮罩 + `max-h-[90vh]` + 内容区 `calc(90vh-80px)`）、`Friends.vue` GID 列表弹窗。
  → 结果：**≤1023px 一律贴顶**，仅桌面（≥1024px）居中。短确认类弹窗（`ConfirmModal` / `RemarkModal` / 批量新增 GID 等）保持居中，符合小对话框的常规预期，未动。
- `core/src/controllers/admin.js` `configureStaticAssets`：新增 `Cache-Control` 策略——`index.html` 与未哈希文件 `no-cache`（每次回源校验），`/assets/` 下带内容哈希的产物 `public, max-age=31536000, immutable`。SPA fallback 的 `sendFile(index.html)` 同样补 `no-cache`。
  → 避免「改了代码但用户手机还是老界面」这类排查噪音，同时让哈希产物真正长缓存。

### 验证

- 宽度扫描（真组件）：390 / 768 / 1023 → `flex-start, panelTop 16–24`；1024 / 1440 → `center, panelTop ≈256`。
- 缓存头用**真实源码**（从 `admin.js` 取出 `configureStaticAssets` 文本）+ 真实 express 起服务实测：`/index.html` → `no-cache`；`/assets/AccountModal-*.css` → `public, max-age=31536000, immutable`；`/icon.svg` → `no-cache`。
- `npm run build` 通过（`✓ built in 15.73s`）；产物回读确认新类已进 bundle、旧 `sm:` 组合已消失：`backdrop-blur-[2px] lg:items-center`、`bg-black/50 p-4 lg:items-center`、`lg:max-h-[90vh|80vh|94vh|calc(90vh-80px)]` 全 OK；`sm:` 版本全 gone。
- 探针文件已删除，产物无 `__probe__` 残留。

## 2026-09-13 更正：弹窗垂直位置要「能放下就居中」（上一轮方向搞反了）

用户指出：偷菜 / 神秘商人点「配置」时弹窗**在顶部**，而**要的是居中**。上一轮把 `sm:items-center` 改成 `lg:items-center`（≤1023px 一律贴顶）是把需求理解反了——用户那句「不是在上方而是在中间显示」是**诉求**，不是现象描述。

### 正确方案：`my-auto`（safe centering），不需要任何断点

遮罩保留 `overflow-y-auto`，弹窗加 **`my-auto`**：

- 有富余空间 → 上下 auto 外边距平分 → **居中**；
- 空间不够 → auto 外边距归零 → **贴顶且可滚动**，不会重蹈 `place-items-center` 把标题挤出屏幕顶部且滚不到的覆辙。

于是所有**垂直对齐类断点（`items-start` / `lg:items-center`）全部删除**，一个 `my-auto` 同时满足「短内容居中」与「长内容不裁」。

改动：

- `AccountFeatureSettings.vue`：遮罩去掉 `lg:items-center`（保留 `grid justify-items-center items-start overflow-y-auto`），弹窗加 `my-auto`，并把注释改成说明「为什么不用断点」。
- `AccountModal.vue`、`Friends.vue` GID 列表弹窗：同样处理。
- `AutomationSettingsTab.vue`（神秘商店设置弹窗）：同样处理，但**该组件在 `src` 中无任何 import，是孤儿文件**，其样式不会进入产物 —— 上一轮把它列为「已修」属**误报**，特此更正。

### 验证（真组件探针：390×844 与 1280×900）

| 视口 | 模块 | gapTop / gapBottom | 面板高 | 内部可滚 |
|---|---|---|---|---|
| 390×844 | 偷菜（短） | 250 / 250 | 344 | 否 |
| 390×844 | 神秘商人（短） | 234 / 234 | 376 | 否 |
| 390×844 | 种植与收获（长） | 16 / 16 | 812 | 是（670 → 706） |
| 390×844 | 好友（长） | 16 / 16 | 812 | 是 |
| 1280×900 | 偷菜 | 284 / 284 | 332 | 否 |
| 1280×900 | 种植与收获 | 129 / 129 | 642 | 否 |

全部 `centered: true`（gapTop == gapBottom），且 `headerFullyVisible` / `footerFullyVisible` 均为 true —— **居中且零裁切**。

`npm run build` 通过（16.33s）；产物回读确认 `my-auto max-h-[calc(100dvh-2rem)] max-w-{4xl,md,2xl}` 均已进包、`lg:items-center` 组合已清除。探针文件已删除，产物无 `__probe__` 残留。

## 2026-09-13 P1 修复补充：许可重入队 + 超时后二次响应守卫

对第 1 批修复的两处补漏：

**1. `worker-manager.js` `drainPermitQueue` 发送失败重新入队**
原实现 `proc.send` 抛错只删 `activePermits`、不重入队，请求被丢弃后 worker 侧要白等 30s 超时。改为 catch 中 `permitQueue.unshift(request)` + `break`（同一 proc 连续失败时不原地死循环，下个 drain 触发点立即重试）。

**2. 直发 500 的 catch 补超时守卫（防 `ERR_HTTP_HEADERS_SENT`）**
`admin.js` 的 `registerRequestTimeoutGuard` 已包装 `res.json/res.send`，但直接调用 `res.status(500).json()` 的 catch 不经过包装，120s 超时守卫先行返回 503 后仍会二次响应抛错（async handler 场景产生 unhandled rejection）。为两处重灾区补 `headersSent/writableEnded/destroyed/requestTimedOut` 守卫（行为不变、仅拦截二次发送）：
- `admin-account-routes.js`：6 处统一 catch（含账号增删改等）。
- `admin-settings-routes.js`：9 处 catch（`/api/settings/save`、`auto-code-refresh/run`、`offline-reminder/test` 等含慢外部 I/O 的 async handler）。

验证：6 个改动文件 `node --check` 通过；`node --test test/*.test.js` **390/390 通过**。

## 2026-09-13 B 组低风险小修（6 项）

1. **图鉴缓存收敛**（`core/src/controllers/admin-illustrated-routes.js`）：`illustrated_type` 用 `normalizeIllustratedType` 收敛到 1–4（实际只有 1 作物/2 变异），防止任意值生成无限缓存键；缓存加 `ILLUSTRATED_CACHE_MAX_ENTRIES=200` 上限，写入时先清过期再淘汰最旧；`invalidateIllustratedCache` 与写入侧共用同一归一化（否则非法类型删不到键）。
2. **状态串台**（`web/src/stores/status.ts` `handleRealtimeStatus`）：未选择账号时（`currentRealtimeAccountId` 为空）拒收所有 `status:update`——服务端此时以 'all' 广播所有账号，原守卫空串短路导致任一账号状态写进全局、Dashboard/侧边栏显示他人昵称与在线态。
3. **好友页每秒全量重渲染**（`web/src/views/Friends.vue`）：定时器从 `map + {...l}` 重建数组改为原地 `land.matureInSec -= 1`（friendLands 是深层响应式 ref，原地改字段只触发最小更新）。
4. **`web/index.html` 补 `viewport-fit=cover`**：否则 iOS 上 `env(safe-area-inset-*)` 恒为 0，DefaultLayout 与各弹窗的安全区 padding 全部失效。
5. **`custom-scrollbar` 提升为全局**（`web/src/style.css`）：之前在 `Analytics.vue`/`FriendsTabs.vue` 引用的类是 scoped-only 空类；现定义全局细滚动条（4px + Firefox `scrollbar-width: thin`，含 dark 变体），并注释说明必须放全局。
6. **`getWarehouseLazy` 失败不再永久负缓存**（`core/src/utils/network.js`）：require 失败原来缓存 `false` 后永不再试；改为失败返回 null、下次调用重试（加载顺序类失败是暂时的，成功后仍走模块缓存）。

验证：2 个后端文件 `node --check` 通过；`node --test test/*.test.js` **390/390 通过**；`npm run build`（vue-tsc + vite）通过（359 modules，18.83s），产物 CSS 确认 `.custom-scrollbar` 规则与 `viewport-fit=cover` 已进包。

## 2026-09-13 移动端优化：登录页更新日志弹窗（UpdateLogModal）

用户手机截图：标题「更新日志」被浏览器地址栏裁掉一半，底部「关闭」贴着 Home 指示条。根因与之前修的弹窗同源：移动端面板 `max-height: 90vh`（大视口，比 iOS 可视区高）+ 遮罩 `align-items: flex-end` 且无滚动 → 顶部溢出不可达。

改动（`web/src/components/login/UpdateLogModal.vue`）：
- 面板 `max-height: 90vh` → 双声明回退 `90vh; max-height: calc(100dvh - 1rem)`（dvh 跟随地址栏收缩）。
- 遮罩加 `overflow-y: auto` 兜底：即使面板再超高也从顶部可滚到，不会再出现「标题被裁且滚不到」。
- 页脚 `padding-bottom: calc(14px + env(safe-area-inset-bottom))`（配合 index.html 的 `viewport-fit=cover`）避开 Home 指示条。
- 关闭按钮 36px → 44px 触控标准（`margin: -6px -6px 0 0` 抵消头部增高）。
- 手机端收紧版本条目间距：h1 `margin: 14px 0 6px; font-size: 1.2rem`、h2 `margin: 16px 0 8px`，一屏多显示约一个版本。

验证：`npm run build` 通过；产物 `AuthView-*.css` 回读确认 `max-height:calc(100dvh - 1rem)`、`env(safe-area-inset-bottom)`、遮罩 `overflow-y:auto`、90vh 回退均已进包。
