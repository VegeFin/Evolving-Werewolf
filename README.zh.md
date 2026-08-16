[English](README.md) | 简体中文

# Evolving-Werewolf — 自进化狼人杀

> **AI 玩家会越打越强。**

**跨局知识积累与进化**：每一局结束后，引擎自动提炼复盘经验，按角色分区（狼人阵营 / 好人阵营 / 预言家 / 女巫 / 猎人策略等）写入知识库；下一局开局时，这些经验会以skill的形式注入到新一批玩家 agent 的 persona 中。**AI 玩家会从每一局的失败和胜利中学习——学会更隐蔽的刀法、更精准的验人逻辑、更合理的投票策略。** 局数越多，AI 越强。

### 它是如何进化的

```
第 1 局：AI 玩家凭规则和性格种子行事，可能犯初级错误
        ↓ 局末自动复盘 → 提炼经验条目写入 knowledge.json
第 2 局：新一批 AI 玩家携带上一局的经验开局，避免已知的坑
        ↓ 再次复盘 → 知识库累积
第 N 局：AI 玩家拥有数十局经验，发言逻辑更缜密、投票更精准、
         狼人刀法更隐蔽、好人推理更深入
```

人类玩家面对的不是固定策略的 AI，而是一个**随着对局积累不断进化的对手群体**。

### 其他特性

除了进化机制，这是一个完整的 9 人局狼人杀引擎（3 狼人 / 1 预言家 / 1 女巫 / 1 猎人 / 3 平民），运行在 **DeepSeek Harness (DSH)** 上：

- **引擎自动主持**：无 LLM 上帝，全部流程由状态机驱动，省 token、零信息失真。
- **完整角色技能**：狼人两轮讨论 + 多数决、预言家查验、女巫救/毒（首夜自救、同夜单药）、猎人出局开枪。
- **标准白天流程**：警长竞选 → 警上发言 → 退水声明 → 警下投票 → 警长指定发言方向 → 按序发言 → 全员记名投票（警长 1.5 票，平票重投）。
- **信息隔离**：刀口仅狼人与女巫可见；夜晚死亡不公开死因；各角色频道私密；增量投递只发"该玩家未见过的信息"。
- **防卡死机制**：60s 催办 + 180s 超时跳过 + running 感知（慢玩家不误杀）+ 推进互斥锁。
- **死亡冻结 + 快照复盘**：出局玩家信息冻结，局末输出因果纯净的决策轨迹复盘。
- **人类席位 + 浏览器面板**：`humanSeat` 随机分配人类座位，通过 HTTP 面板行动，与 agent 玩家完全同场竞技。
- **素材管线**：集成智谱 AI 读图（GLM-4V-Flash）+ 生图（CogView-3-Flash），免费额度即可为 UI 生成头像和角色贴图。
- **性格种子**：9 种性格随机分配，玩家风格多样化。

---

## 安装

### 前置条件

- [Node.js](https://nodejs.org/) >= 18
- [DSH (DeepSeek Harness)](https://www.npmjs.com/package/@deepseek-ai/dsh) — 全局安装：
  ```bash
  npm install -g @deepseek-ai/dsh
  ```

### 安装插件到 DSH

```bash
# 1. 克隆仓库
git clone https://github.com/VegeFin/Evolving-Werewolf.git
cd Evolving-Werewolf

# 2. 安装依赖（插件运行时依赖 @deepseek-ai/dsh-tools）
pnpm install   # 或 npm install

# 3. 安装到 DSH web profile
dsh plugin --profile web add ./

# 4. 重启 DSH
dsh web
```

重启后 `werewolf_*` 系列工具全局可用，插件随 profile 自动加载。

### 配置

#### image-config.json（素材管线 API Key）

```bash
cp image-config.example.json image-config.json
```

编辑 `image-config.json`，填入智谱 API Key（在 [open.bigmodel.cn](https://open.bigmodel.cn) 免费注册获取）：

```json
{
  "apiKey": "你的APIKey",
  "baseURL": "https://open.bigmodel.cn/api/paas/v4",
  "visionModel": "glm-4v-flash",
  "drawModel": "cogview-3-flash",
  "drawSize": "1024x1024",
  "assetDir": "ui/assets"
}
```

> 素材管线为可选功能。不配置只影响读图/生图工具，核心游戏功能不受影响。

#### knowledge.json（知识库种子）

```bash
cp knowledge.example.json knowledge.json
```

引擎每局结束后会自动提炼经验并写入 `knowledge.json`。`knowledge.example.json` 提供 8 条初始种子知识。

---

## 使用

### 主持人视角

在 DSH agent 会话中调用工具：

| 工具 | 用途 | 调用者 |
|---|---|---|
| `werewolf_start` | 开局：随机分配身份、生成 8 个玩家 agent、与人类玩家共同开始游戏。不传 `humanSeat` 则自动随机 1-9 分配人类座位。 'humanSeat'=0 时、生成 9 个玩家agent自迭代进化。 | 主持人 |
| `werewolf_act` | 玩家行动（18 种 action） | 玩家 |
| `werewolf_status` | 查看公开状态；主持人可看完整身份表与复盘报告 | 所有人 |
| `werewolf_ask_rule` | 查询规则/角色能力 | 所有人 |
| `werewolf_abort` | 主持人终止游戏 | 主持人 |
| `werewolf_look` | 用视觉模型分析图片 | 主持人 |
| `werewolf_draw` | 用文生图模型生成图片 | 主持人 |
| `werewolf_assets_status` | 查看素材管线状态 | 主持人 |

`werewolf_start` 返回值包含 `hostGuide`（主持人指引）和 `panelUrl`（人类玩家面板地址）。

### 玩家行动 (werewolf_act)

| action | 说明 | 阶段 |
|---|---|---|
| `speech` + `text` | 发言 | day-speech / day-sheriff-speech |
| `vote` + `target` | 放逐投票（0=弃票） | day-vote |
| `sheriff_vote` + `target` | 警下投票 | day-sheriff-vote |
| `sheriff_run` / `sheriff_not` | 上警 / 不上警 | day-sheriff-run |
| `sheriff_stay` / `sheriff_quit` | 不退水 / 退水 | day-sheriff-quit |
| `direction` + `text=left/right` | 警长指定发言方向 | day-direct |
| `pass_sheriff` + `target` | 警长出局处置警徽 | sheriff-pass |
| `kill` + `target` + `text` | 狼人刀人 | night-wolves |
| `seer` + `target` | 预言家查验 | night-seer |
| `witch_save` / `witch_poison`+`target` / `witch_none` | 女巫用药 | night-witch |
| `hunter` + `target` | 猎人开枪（0=不开枪） | night/day-hunter |
| `alive` | 在线确认 | 任意 |
| `review` + `text` | 提交复盘 | review |

### 人类玩家面板

开局后浏览器访问 `http://127.0.0.1:<port>/werewolf/panel`，面板提供：

- 身份卡（座位、角色）
- 事件流（按 kind 分类：wolf/seer/witch/death/sheriff/info）
- 发言舞台（逐条展示）
- 行动区（门禁驱动：只在轮到你时显示对应表单）

---

## 目录结构

```
Evolving-Werewolf/
├── lib/
│   └── index.js              # 固化版引擎主文件（v33，纯 host）
├── ui/
│   ├── panel.html            # 人类玩家面板（HTTP 路由提供）
│   ├── assets/               # 头像和角色贴图（PNG）
│   └── protos/               # UI 原型 HTML（开发参考）
├── archive/                  # 动态版源码存档（开发调试用，零重启迭代）
│   ├── dev/
│   │   ├── wwdev-engine.host.js    # 引擎动态版
│   │   ├── wwim6-assets.host.js    # 素材管线动态版
│   │   └── wwui10-panel.host.js    # 面板动态版
│   ├── v32.host.js           # v32 host 存档
│   ├── v32.client.js         # v32 client 存档
│   └── werewolf-v21.host.source.js  # v21 原始存档
├── cordis.patch.yml          # DSH bundle patch 配置
├── image-config.example.json # API Key 配置模板
├── knowledge.example.json    # 知识库种子模板
├── package.json
├── PROGRESS.md               # 版本历史与开发进度
└── .gitignore
```

### 公开 vs 私有

| 文件 | 状态 | 说明 |
|---|---|---|
| `lib/index.js` | 公开 | 引擎主代码 |
| `ui/` | 公开 | 面板、图片、原型 |
| `archive/` | 公开 | 动态版存档（开发参考） |
| `*.example.json` | 公开 | 配置模板 |
| `package.json` / `cordis.patch.yml` | 公开 | 包元数据 |
| `*.md` | 公开 | 文档 |
| `knowledge.json` | 公开 | 运行时知识库数据 |
| `image-config.json` | **gitignore** | 含真实 API Key |
| `last-review.json` | **gitignore** | 上一局复盘数据 |
| `review-processed.json` | **gitignore** | 复盘处理标记 |
| `node_modules/` | **gitignore** | 依赖 |
| `.ww-tmp/` | **gitignore** | 子进程临时文件 |

---

## 架构

### 平面划分

```
宿主平面（Host）
├── werewolf 引擎（本插件）
│   ├── 状态机（game 对象，内存）
│   ├── 工具注册（werewolf_*，全局可见）
│   ├── timer 心跳（30s 检查超时/催办）
│   ├── webServer 路由（/werewolf/panel + /werewolf/api/* + /werewolf-assets/*）
│   └── 消息投递（subagents.followup / Agent.steer 回退）
└── DSH 基础设施（subagents / agents / tools / webServer / timer / fs / subprocess）

Agent 平面
├── 主持人（当前会话）：werewolf_start / status / abort
└── 9 个玩家（continuable 子代理）
    ├── persona = 规则库 + 身份 + 性格种子 + 历史经验
    ├── toolFilter = 仅 werewolf_act / status / ask_rule
    └── 通过 werewolf_act 行动
```

### 状态机阶段

```
setup → night-wolves → night-seer → night-witch → night-settle
     → day-sheriff-run → day-sheriff-speech → day-sheriff-quit → day-sheriff-vote
     → day-direct → day-speech → day-vote → (night-*) 循环
     → gameover → review
```

### 关键服务依赖（inject 声明）

```js
inject: ['subagents', 'agents', 'tools', 'webServer']
```

Cordis 服务驱动激活：等这四个服务就绪后再执行 `apply()`，避免路由注册早退。

---

## 规则实现

- **身份**：3 狼 + 1 预 + 1 女 + 1 猎 + 3 民，`shuffle` 随机分配。
- **狼人**：随机顺序两轮讨论，多数决裁决（平票取首票）。
- **预言家**：每晚验 1 名存活玩家，结果私密。
- **女巫**：解药/毒药各 1 次；首夜可自救；解药用后不再被告知刀口。
- **猎人**：被狼刀/被投出局可开枪（被毒不开枪）。
- **警长**：竞选产生，1.5 票权重，指定发言方向，出局时处置警徽。
- **投票**：记名公开；平票进第二轮限平票人重投。
- **胜负**：狼全灭 → 好人胜；神全灭或民全灭 → 狼胜（屠边）。

---

## 开发

### 固化版 vs 动态版

| 模式 | 文件 | 特点 |
|---|---|---|
| 固化版（生产） | `lib/index.js` | 标准 Cordis 插件，`dsh web` 自动加载，重启生效 |
| 动态版（开发） | `archive/dev/*.host.js` | `cordis_define` 注入内存，改代码零重启，重启即失 |

开发迭代用动态版，改完固化到 `lib/index.js`。动态版用 `harness.defineTool`，固化版用 `defineTool` from `@deepseek-ai/dsh-tools`。

---

## 已知限制

- 一局约 15-40 分钟（9 玩家 × 每阶段 LLM 轮次）。
- 游戏状态存插件内存，重启清空当前局。
- 玩家 agent 会话为持久化冷存档，跨局累积（需手动清理或开局自动释放活跃层）。
- 复盘知识库为内存级（进程内跨局有效，重启清空；可落盘 `knowledge.json`）。

---

## License

MIT
