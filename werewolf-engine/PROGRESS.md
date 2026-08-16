# 狼人杀引擎 · 当前进度快照（2026-08-16，晚）

> 本文件是压缩上下文后的继承入口。配套阅读 `README.md`（规则/架构/固化说明）。动态插件 `were-1` 定义在 DSH 进程内存（当前会话），重启/新会话需按 README 七·五从存档重建；**固化版已安装到 web profile**（见下）。

## 当前状态

- **固化完成（2026-08-16）**：`werewolf-engine` 已 `dsh plugin --profile web add` 装入 `%USERPROFILE%\.dsh\profiles\web`（dependencies + bundles 层），依赖 `@deepseek-ai/dsh-tools@0.1.0-rc.6` 已解析（profile + 插件自身 node_modules 双份），冒烟测试通过（import 成功、apply 存在、defineTool 可解析）。**重启 dsh web 后 werewolf_* 工具全局可用（host 半，纯 agent 局可跑）**。
- 动态插件 `were-1`：currentPackageId = pkg-35 = v32，用户已 stop；完整源码已落盘 `archive\v32.host.js` + `archive\v32.client.js`（2026-08-16 由 `cordis_inspect_self` 导出）。
- 引擎：9 人局狼人杀（3狼1预1女1猎3民），自动主持、人类席位（humanSeat）、双栏舞台式 UI（UI 为 client 半，仍走动态插件方式）。
- 工具：`werewolf_start`（humanSeat 参数）、`werewolf_act`（18 种 action）、`werewolf_status`（主持人全量+工具诊断）、`werewolf_ask_rule`、`werewolf_abort`。
- 已清理 281 个历史玩家冷存档（`.dsh\sessions\--D-agentWorkSpace--\` 下裸 UUID 目录已删，仅剩主会话 `<主会话UUID>`）。

## 版本历史（v1→v32 一句话）

| 版本 | 内容 |
|---|---|
| v1 | 首版完整引擎（状态机/spawn/工具/复盘） |
| v2-v8 | 投票隔离、猎人开枪、旧玩家释放、天数重置、狼队友分配、昼夜方向、上警校验、禁轮询 |
| v9-v13 | 信息隔离（刀口不公开）、1.5票、两轮投票、增量投递、强制工具提交、催办、警长末置位 |
| v14-v18 | timer 心跳、退水环节、running 感知超时、无连环跳过、平民 alive 确认 |
| v19-v20 | 发言顺序 undefined 修复、推进硬化、女巫刀口隐私、猎人 alive |
| v21 | 警长警徽流/撕警徽（sheriff-pass + pass_sheriff） |
| v22 | **人类席位 + 游玩/观战 UI**：humanSeat 开局、humanInbox、applyAction 双通道（agent 工具 + 人类 RPC）、uiState/humanAct/abort RPC、composer.dock 面板、信号回退 |
| v23 | UI 信息架构改版：座位条/事件/发言 Tab、条目化 |
| v24 | 行动区门禁（waitingYou 驱动，做完消失） |
| v25 | sheriff-pass 强制显示修复 + 行动区固定高度 |
| v26 | 并发竞选（上警/退水）、首夜死讯延迟（nightNews+flush）、人类不超时（pendingHasHuman） |
| v27 | 允许狼人自刀、狼人讨论 5 轮上限/第 3 轮起多数决 |
| v28 | 过程态数据层：progress（decided/submitted）、pendingSeats、狼刀口私密确认、方向公告、人类看复盘、abort 修复、人类免 alive、狼讨论轮次不公开 |
| v29 | 双栏舞台式 UI（proto7 落地）：身份卡/阶段标题/待已分区/发言舞台/座位行/右栏三Tab、点击继续 |
| v30 | 修 uiState undefined 字段 RPC 崩溃 |
| v31 | 批量修 10 项：舞台逐条确认、阶段过滤发言、警上随机环绕顺序、🔒引擎消息条、右侧🔒信息Tab、面板固定560px、去顶部状态行、发言分组+滚底、按钮居中、sheriff-pass仅死警长 |
| v32 | **引擎消息分类 + 真并发投递**：人类投递剥 ACTION_NOTE、inbox 按 kind 分类（wolf/seer/witch/death/sheriff/info）、UI 按角色分塞；上警/退水/投票 Promise.all 真并发；并发阶段直接出表单；舞台生成中头像先显示；按钮统一居中 |

## 关键机制（改代码前必读）

- **信号**：动态环境无 AbortController；`deliverTo` 用 exec.signal > game.lastSignal > FAKE_SIGNAL（恒不取消兜底）。
- **投递**：agent 走 `subagents.followup(parent, childId, text(content), {source, signal})`；人类走 `game.humanInbox`（带 kind 分类）。
- **防卡死**：60s 催办 + 180s 超时（checkTimeouts + timer 30s 心跳）；人类永不超时（pendingHasHuman / checkTimeouts human 重置）；`advancing` 互斥锁；投递 try/catch 不冒泡。
- **增量**：worldSeq（先 bump 后记 seq）+ 玩家 lastSeen 半开区间；`visibleInfoDelta`/`visibleInfoFull` 按角色隔离私密信息（狼频道 seat=0 为系统消息）。
- **并发阶段**：上警/退水/投票 = pending.seats 收齐结算（Promise.all 投递）；白天发言/警上发言 = 顺序（waitSeat 驱动）。
- **死讯延迟**：首夜 wolf/poison 死亡入 nightNews，竞选结束 flushNightNews 才公开。
- **UI 数据**：uiState 返回 phase/progress/pendingSeats/sheriffPassSeat/speechOrder/sheriffSpeechOrder/logs{day,seat,text}/human.inbox{kind} 等。
- **人类行动**：`humanAct` RPC → applyAction（与 werewolf_act 共用校验），UI 表单 = 座位按钮选目标 + 输入 + 提交；sheriff-pass 仅死警长本人显示（sheriffPassSeat 校验）。

## 待办清单（已记录未做 / 待验证）

1. **人类玩家标签泄露**：狼 agent 知道"人类玩家位置"（label/persona/消息带"人类玩家坐X号位"）——玩家视角不应知道人类席位，需隐藏（label 去掉人类标记、pushEvent 文案改"玩家X"）。
2. **debug/正常模式切换**：夜间不显示"轮到谁"高亮（避免暴露狼人身份），仅白天可显示；加模式开关。
3. **client 半固化**：正式插件的人类 UI 需 `ctx.remote`（Typert Remote）+ 打包 client 产物（window.__ModuleLoader__.load 格式），尚未做；人类局暂走动态插件。
4. **警徽流 UI**：v21 已实现引擎逻辑，但 UI 尚无警徽流展示（警长死亡传徽测试未完成——需人类当警长+死亡触发）。
5. **狼人平票第二轮讨论**：当前平票取首票。
6. **知识库 LLM 提纯**：当前模板级。
7. **冷存档自动清理**：需外部 pwsh（DSH 无删除 API）；已手动清理一次，开局 releasedOld 现在应≈0。
8. **观战 UI / 主持人每局汇总报告**。
9. **白天投票 UI 并发感**：v32 已改 Promise.all，待实测确认"操作区不再先等待中"。
10. **狼人自刀战术平衡**：agent 女巫常不救自刀狼（多次实测）。
11. **v21-v32 全量回归 + 固化实测**：v31/v32 大改后仅 v31 测过半局（狼自刀骗药+悍跳），v32 未实测；固化版（host 半）也未实机跑局——重启后重点验证工具注册生效、exec.agent 身份识别、timer 心跳。
12. **面板 bug·女巫刀口显示**（实测记录 2026-08-16）：女巫应看到"谁中刀了"，目前刀口信息只进 inbox（信息 Tab），聊天区不显示；需求：中刀信息显示在聊天/发言区（或显著位置）。
13. **面板 bug·舞台 undefined**（实测记录 2026-08-16）：等待阶段/并发阶段（如警长竞选上警时，waitingSeat=null、speechOrder 未设置）→ 舞台显示 "👤 #undefined ⏳ #undefined 正在组织发言…"，明显错误；应改为中性状态（如"⏳ 正在收集行动…"或"等待下一环节"），无等待座位时不要渲染假发言者。

## 固化说明

- 盘上资产：`werewolf-engine\README.md`（规则/架构/修复史 v1-v32/固化记录/继承指南）、`PROGRESS.md`（本文件）、`package.json`（dsh.bundle.patch）、`cordis.patch.yml`、`lib\index.js`（**v32 固化版 host 半**）、`archive\werewolf-v21.host.source.js` + `v32.host.js` + `v32.client.js`（动态版原样存档）。
- 固化 = 动态源码改 `harness.defineTool/registerTool` → `@deepseek-ai/dsh-tools` 的 `defineTool` + `ctx.tools.register`；移除依赖动态沙箱的 `harness.handle` RPC 段（人类 UI 相关）；`export default { apply(ctx) {...} }`。已装 profile（`dsh plugin --profile web add ./werewolf-engine`，自动进 bundles 层，无需手改 cordis.patch.yml）。
- pnpm 环境：本机无全局 pnpm，用 corepack（`COREPACK_HOME` 指工作区临时目录）+ `pnpm.cmd` shim 注入 PATH；profile 与插件包各自 `pnpm install`（link 包从真实路径解析依赖）。
- 完整 v32 动态源码获取：`cordis_inspect_self('were-1', 'pkg-35')`（仅当插件定义仍在当前进程/会话）；已落盘 archive。

## 素材管线（2026-08-16 续，读图/生图）

> 目标：读图 = 调研主流狼人杀视觉风格；生图 = 一次性生成 UI 贴图（头像/角色卡/背景）反复使用。

### 现状（已验证）

- **动态插件 `wwim-6`（werewolf-assets）**：host 半，本会话进程内存活，三个工具：
  - `werewolf_look`（读图）：本地图片路径 → base64 → 智谱 `glm-4v-flash`（免费）→ 返回内容/风格描述。**全链路实测通过**（fs 读字节 → btoa 二进制 base64 → subprocess 拉起 node -e → fetch → 解析；401 校验正确返回）。
  - `werewolf_draw`（生图）：prompt → 智谱 `cogview-3-flash`（免费）`/images/generations` → 下载 → 存 `werewolf-ui/assets/` → 返回 `/werewolf-assets/<name>.png`。
  - `werewolf_assets_status`：配置/服务/node 路径状态。
- **静态路由**：`/werewolf-assets/*` → `werewolf-ui/assets/*`（webServer prefix 路由，**实测 200 + 正确 MIME + 字节一致**）。
- **配置**：`werewolf-engine/image-config.json`（apiKey/baseURL/visionModel/drawModel/drawSize/assetDir），**每次调用实时读取，改配置不用重启**。apiKey 未填时工具返回友好提示。
- **关键机制（沙箱内做 HTTP）**：动态 Host 沙箱无 fetch/require/Buffer/URL，`ctx.web.fetch` 仅 html/text；`ctx.get('subprocess')` 可用 → 把 HTTP helper（约 700B node 脚本）`node -e` 拉起，参数走 `env.WW_ARGS`（JSON），结果写临时 json 文件后 `ctx.get('fs')` 读回（规避命名管道 EPERM 限制）。本机 pwsh/curl 的 Schannel TLS 有证书问题，但 **node fetch 正常**（已实测 401 校验）。

### 素材命名约定（proto8 已定义）

| 素材 | 路径 | 回退 |
|---|---|---|
| 玩家头像 | `/werewolf-assets/avatar-<seat>.png`（1-9） | emoji（🧑/🤖/角色 emoji） |
| 角色卡 | `/werewolf-assets/role-<role>.png`（wolf/seer/witch/hunter/villager） | 文字+emoji |
| 面板背景 | `/werewolf-assets/bg-panel.png` | 纯色 |

- 前端原型：`werewolf-ui/proto8-image-slots.html`（独立 HTML，演示图片位 + onerror 回退）。

### 待办

1. **用户拿智谱 key** → 填 `image-config.json` 的 apiKey → `werewolf_draw` 批量生成 avatar-1..9 / role-* / bg-panel → 面板自动显示（无需重启）。
2. **面板 UI 固化/集成**：v32 client（`archive/v32.client.js`）加图片位（头像/角色卡/背景 + onerror 回退），原型见 proto8。**注意**：动态插件与固化版引擎工具**同名冲突**（`werewolf_ask_rule` 实测注册失败）——要跑带人类席位 UI 的动态版，需在重启时从 profile 摘掉固化版 bundle（cordis.patch.yml disable）或改动态版工具名。
3. **读图用途**：拿到 key 后用 `werewolf_look` 分析用户提供的参考图 / 网络截图，沉淀风格结论进本文件。
4. 生图供应商可换：baseURL/model 均为配置项（OpenAI Images 兼容接口均可，参考 GitHub `dsh-image2-draw` 模式）。

## UI/美术技能（2026-08-16 续）

- **`ui-art-design` 技能已加载**（读图调研风格 → 生图 prompt 工程 → 贴图规范 → 界面设计原则，含狼人杀贴图工作流）：
  - 本会话实时可用（动态插件 uart-8 运行时注册，`source:'runtime'` 必填否则加载报 "source must be a string"）。
  - 持久化：本地预设 `%USERPROFILE%\.dsh\.agent-presets\ui-art\`（复制自 cordis 预设 + 新增 `skills\ui-art-design\SKILL.md`，preset.yml 改名"UI 美术模式"）。新会话在 agent preset 选择器里选它即带此技能。注意：写 `~/.dsh` 需 danger-full-access 权限。
  - 技能发现机制：`dsh-skill-filesystem` 只扫 preset 的 customSkillDirs（cordis 预设=自身 skills/ 目录），项目/用户根默认不扫；新技能要么进 preset 的 skills/ 目录，要么运行时 register。
- 技能调研（子代理）：superpowers-dsh（obra/superpowers 移植）含设计类技能（web-design/brand-guidelines/image-generation 等）可作参考来源；社区 UI 相关多为插件（dsh-ui-web、skin 包等）而非技能。

### UI/美术技能加载（2026-08-16 完成）

- **本会话实时可用**（动态插件 uarb-9 从预设目录读取 SKILL.md 解析 frontmatter 后运行时注册，`source:'runtime'` 必填；多行 `description: |` 块解析器已修）。**最终 12 个技能**：
  - 自研：`ui-art-design`（读图调研→生图→贴图→界面工作流）
  - 生图/prompt：`imagegen`、`enhance-prompt`、`taste-imagegen-frontend-web`
  - 配色：`color-expert`、`taste-brandkit`
  - 界面设计：`frontend-design`、`web-design-guidelines`、`ui-ux-pro-max`、`web-artifacts-builder`、`taste-taste-skill`
  - 品牌：`brand-guidelines`
- **持久化**：本地预设 `%USERPROFILE%\.dsh\.agent-presets\ui-art\`（"UI 美术模式"）skills/ 目录含全部 12 个 SKILL.md + taste-skill 其余子技能（15 个文件，未来会话直接可用）。新会话选该预设即自带整套技能。
- **抓取技巧**：raw.githubusercontent.com 超时，但 **api.github.com 的 contents API 可用**（node fetch 正常）——`/contents/<path>/SKILL.md` 返回 base64 内容，解码落盘即可；写 `~/.dsh` 需 danger-full-access。

### 社区读图插件调研结论（子代理终报，2026-08-16）

- 社区方案三类：Host 工具桥接 / Client 粘贴拦截 / 透明代理无感；免费档标配 = 智谱 `glm-4v-flash`（open.bigmodel.cn，OpenAI 兼容，base64 data URI）——**与我们的 `werewolf_look` 实现完全一致**。
- 最贴合狼人杀"人类上传截图→AI 读图"的是 [dsh-vision-tools](https://github.com/moon09300731/dsh-vision-tools)（Host 工具 + Client 粘贴/拖拽/按钮三入口）；极简备选 [dsh-tool-see-image](https://github.com/gugu123a/dsh-tool-see-image)。
- **补充发现（可选增强）**：[dsh-vision-router](https://github.com/ysr666/dsh-vision-router) 提供**免 key 本地像素工具**（OCR/裁剪/取色/像素 diff/截图）——适合"手牌数字、卡面文字"的确定性读取，可在视觉链之外作为补充（语义理解质量未验证）。待办：验证后考虑并入 werewolf_look 的"读数字/文字"模式。
- **加载器插件**：uarb-9 的 apply 读取 `C:/Users/Finlay/.dsh/.agent-presets/ui-art/skills/<name>/SKILL.md`，解析 YAML frontmatter（name/description/多行块）并 `skills.register`；重启后需重新 cordis_define/run（动态插件不持久），或直接用 ui-art 预设开新会话。

## 开发模式切换（2026-08-16，待重启生效）

- **决策**：流程 debug 需要频繁改引擎逻辑，固化版每次要重启 → 切换到**动态插件开发模式**：
  - `%USERPROFILE%\.dsh\profiles\web\cordis.patch.yml` 已加 `- id: werewolf-engine / disabled: true`（**重启后**固化版引擎不再加载，werewolf_* 工具消失）。
  - 重启后引擎逻辑由**动态插件**承载（v32 完整版含人类席位 + webServer API），改引擎 = cordis_define 新包 + update，**零重启**；改面板 = 改 `werewolf-ui/panel.html` + 浏览器刷新，**零重启**。
- **重启后重建清单**（动态插件不持久）：
  1. `archive/dev/wwim6-assets.host.js` → cordis_define 重建（读图/生图/`/werewolf-assets/` 路由）。
  2. `archive/dev/wwui10-panel.host.js` → 重建（`/werewolf/panel` 面板页 + 演示 API）。
  3. **新** `wwdev-engine`：把 `archive/v32.host.js` 作 host，**改造**——harness RPC 段（uiState/humanAct/abort）改为注册 webServer 路由 `/werewolf/api/state` + `/werewolf/api/act`（读自身 game 闭包）；工具名 werewolf_*（固化版已禁用，无冲突）。改造要点见 README 七·一 + v32.host.js 内的 uiState/humanAct 段。
  4. 面板 `panel.html` 的 `USE_MOCK` 翻 false 接真实 API。
- **存档**：`archive/dev/` 下 wwim6/wwui10 源码；`panel.html` 本体在工作区（刷新即生效）。
- **恢复生产**：删掉 cordis.patch.yml 里的 disable 两行，重启即回固化版。

## 独立面板页（2026-08-16）

- **`werewolf-ui/panel.html`**：独立页面（新窗口/标签打开，不挤聊天页），布局固定 1120px 不忽大忽小。
- 设计定稿：待发言(左,next 绿呼吸灯)/已发言(右)、身份条、点对话框切下一条、昼夜手动切换、座位自适应 6-12 人（≥10 人紧凑档 32px 头像）、右栏新消息在最下、操作栏两行 textarea。
- 数据层：`USE_MOCK` 常量切换演示/真实（`/werewolf/api/*`）；头像映射表 `AVATARS`（座位→assets 文件名）。
- 访问：http://127.0.0.1:3080/werewolf/panel（wwui-10 提供，重启后重建）。
