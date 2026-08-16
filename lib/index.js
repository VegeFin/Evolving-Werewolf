// 狼人杀引擎 v33 固化版：最新动态版（archive/dev/wwdev-engine.host.js，含 JSON 知识库/复盘提炼/非阻塞知识窗口/面板路由/人类席位）
// 合并素材管线（archive/dev/wwim6-assets.host.js，读图/生图/静态路由）后固化为正式插件。
// 改造说明（对照「固化复盘与避坑指南.md」）：
//   改造点1：harness.defineTool/registerTool（动态沙箱 builtin）→ @deepseek-ai/dsh-tools 的 defineTool + ctx.tools.register
//   改造点2：Client RPC（harness.handle 的 werewolf.uiState/humanAct/abort）正式插件无此 builtin → 移除；
//            人类席位面板改由 webServer HTTP 路由提供（/werewolf/panel + /werewolf/api/state|act|abort），纯 host 可跑。
//   改造点3：声明 inject（服务驱动激活，避免 apply 早于服务提供方 fiber 激活而早退 → 工具永不注册）。
//   改造点4：合并素材管线工具（werewolf_look/werewolf_draw/werewolf_assets_status）与 /werewolf-assets 静态路由。
//   改造点5：timer.interval 的 disposer 纳入清理（停止插件时移除心跳）。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 插件根目录（lib/index.js 的上级目录），用于解析 ui/、image-config.json 等相对路径
const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

// ═══ 主持人系统指引（werewolf_start 返回值中带给主 agent，不进全局 systemPrompt 以免污染 9 个玩家 agent 的上下文） ═══
const HOST_GUIDE = `你是狼人杀主持人，不是玩家。本局有 1 个人类玩家，你的职责：
1. 开局：调用 werewolf_start（不指定 humanSeat，引擎自动随机 1-9）。
2. 开局后立即做两件事：
   a. 告诉人类打开面板 {PANEL_URL} （浏览器访问）；
   b. 私下告知他的座位和身份（开局结果里有），并说明"一切行动通过面板操作"。
3. 上传下达：游戏由引擎自动推进，人类通过面板行动；你在聊天里只做中转——
   人类问进展/问规则，你用 werewolf_status / werewolf_ask_rule 查了转达；引擎的公开事件你也可以同步。
4. 禁止事项：
   - 绝对不要替人类做决定、不要帮他脑补行动；
   - 不要在上下文中帮助玩家出谋划策，不要通过子agent的output去转述战况或阶段性总结战况（除游戏一方获得胜利外），玩家在UI界面，看不到你的输出，这样做会无谓消耗大量的token；
   - 不要调用 werewolf_act（那是玩家 agent 的工具，你是主持人，会被拒绝）。
5. 复盘知识记录：在游戏一方取得胜利，agent将复盘报告（至少7份，不得提前更新知识）提交至你后，你应当调用 werewolf_knowledge_note 工具更新knowledge，虽然此prompt较复盘间存在较大的上下文，但不能忘记更新knowledge。`

export default {
  // 固化（静态）插件必须声明 inject：Cordis loader 并行启动所有插件行，无 inject 的插件会立即 apply，
  // 早于服务提供方 fiber 激活 → ctx.get() 返回 undefined → 早退且工具/路由永不注册。
  // 声明 inject 后 Cordis 服务驱动激活，等所有服务可用（提供方 fiber active）再执行 apply。
  // webServer 必须声明：否则 apply 时 webServer 可能未激活 → ctx.get('webServer') 返回 undefined
  //   → if(_ws) 跳过 panel/api/assets 路由注册 → 浏览器访问 /werewolf/panel 返回 404。
  //   对比 DSH 官方插件（dsh-web-app / dsh-client-connection / dsh-client-hmr）均将 webServer 声明在 inject。
  inject: ['subagents', 'agents', 'tools', 'webServer'],
  apply(ctx) {
    const subagents = ctx.get('subagents')
    const agents = ctx.get('agents')
    const tools = ctx.get('tools')
    if (!subagents || !agents || !tools) {
      console.error('[werewolf] subagents/agents/tools services unavailable')
      return
    }

    const ROLE_NAMES = { wolf: '狼人', seer: '预言家', witch: '女巫', hunter: '猎人', villager: '平民' }
    const RULE_TEXT = [
      '【狼人杀9人局规则】',
      '阵营：3狼人 vs 6好人（3神：预言家/女巫/猎人；3民：平民）。',
      '狼人：每晚与队友按顺序讨论并共同选择击杀一名玩家；狼人互相知道身份，刀口信息只有狼人和女巫知道。狼人可以自刀（刀口选择自己，常见骗药战术）。',
      '预言家：每晚可查验一名存活玩家的阵营（狼人/好人），查验结果只有自己知道。',
      '女巫：拥有一瓶解药（救活当夜被袭击者）和一瓶毒药（毒杀一名玩家），各限一次；首夜可自救；同一夜不能同时使用两瓶药。',
      '猎人：出局时可以开枪带走一名玩家（被毒杀不能开枪；不能带自己）。',
      '平民：无特殊能力，白天发言与投票。',
      '猎人/平民：夜间无行动但需保持在线响应引擎确认。',
      '夜晚行动顺序：狼人→预言家→女巫→（猎人）。',
      '警长：出局时须处置警徽——可传给一名存活玩家（警徽流继承），或撕掉警徽（之后无警长，发言随机顺序）。警长投票按1.5票计（其他玩家1票）。',
      '白天流程：警长竞选（仅第一天：上警→警上发言→退水声明→警下投票，两轮平票则无警长）→ 警长指定发言方向（无警长则随机）→ 按序依次发言（警长末置位归票）→ 全员同时投票（记名公开，平票则第二轮在平票人间重投，仍平票无人出局）。',
      '退水规则：警上发言后候选人可声明退水——退水者放弃竞选资格，且不能参与警下投票；不退水者继续竞选（也不投警下票）。',
      '夜晚死亡原因保密：被狼刀或被毒杀的玩家，公开信息只宣布出局，不公布死因（死因仅死者本人与相关角色知道）。',
      '首夜死讯延迟：第一天警长竞选结束后才公布前一晚的死亡/平安夜信息。',
      '狼人讨论：最多5轮；第1、2轮意向未统一则进入下一轮确认，第3轮起收齐后按多数票裁决（少数服从多数）。',
      '胜负：狼人全灭→好人胜；神（预/女/猎）全灭或民全灭→狼人胜（屠边）。',
    ].join('\n')
    const PERSONALITIES = [
      '谨慎多疑，发言保守，倾向于观察后再表态',
      '激进直率，话多，喜欢带节奏和施压',
      '沉默观察者，话少但关键时一针见血',
      '幽默风趣，喜欢用玩笑缓和气氛，但逻辑清晰',
      '理性分析型，擅长推理和找漏洞',
      '情绪化，容易被带偏但直觉敏锐',
      '伪装高手，擅长隐藏真实意图',
      '老实诚恳，发言可信度高但容易被利用',
      '战术型，注重团队配合和局势判断',
    ]
    const PHASE_NAMES = {
      'night-wolves': '夜间·狼人行动', 'night-seer': '夜间·预言家查验', 'night-witch': '夜间·女巫行动',
      'night-hunter': '夜间·猎人开枪', 'day-hunter': '白天·猎人开枪',
      'day-direct': '白天·警长指定发言方向',
      'sheriff-pass': '警长警徽处置',
      'day-sheriff-run': '白天·警长竞选（上警）', 'day-sheriff-speech': '白天·警长竞选（警上发言）',
      'day-sheriff-quit': '白天·警长竞选（退水声明）', 'day-sheriff-vote': '白天·警长竞选（警下投票）',
      'day-speech': '白天·自由发言', 'day-vote': '白天·投票',
      'gameover': '游戏结束', 'review': '复盘',
    }
    const TIMEOUT_MS = 180000
    const NUDGE_MS = 60000
    const MAX_WOLF_ROUNDS = 5
    const ACTION_NOTE = '\n\n【必须行动】请调用 werewolf_act 工具提交本轮行动（直接输出文本无效，不会被记录）。'
    const ALIVE_MSG = '[在线确认] 请立即用 werewolf_act 回复：action=alive（确认你在线并等待引擎指令）。你的发言/投票会在轮到你时另行通知。' + ACTION_NOTE
    const FAKE_SIGNAL = { aborted: false, throwIfAborted() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } }

    let game = null
    let knowledge = []

    const text = (s) => [{ type: 'text', text: s }]
    function shuffle(arr) {
      const a = arr.slice()
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const t = a[i]; a[i] = a[j]; a[j] = t
      }
      return a
    }
    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0
        let t = Math.imul(a ^ a >>> 15, 1 | a)
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
        return ((t ^ t >>> 14) >>> 0) / 4294967296
      }
    }
    function ringOrderLast(seats, anchor, direction) {
      const sorted = seats.slice().sort((a, b) => a - b)
      const idx = sorted.indexOf(anchor)
      if (idx < 0) return randomOrder(seats)
      const step = direction === 'left' ? -1 : 1
      const order = []
      for (let i = 1; i <= sorted.length; i++) {
        const pos = ((idx + step * i) % sorted.length + sorted.length) % sorted.length
        order.push(sorted[pos])
      }
      return order
    }
    function randomOrder(seats) {
      const sorted = seats.slice().sort((a, b) => a - b)
      const rnd = mulberry32(Date.now())
      const startIdx = Math.floor(rnd() * sorted.length)
      const dir = rnd() < 0.5 ? 1 : -1
      const order = []
      for (let i = 0; i < sorted.length; i++) {
        const pos = ((startIdx + dir * i) % sorted.length + sorted.length) % sorted.length
        order.push(sorted[pos])
      }
      return order
    }
    const playerBySeat = (seat) => game.players.find((p) => p.seat === seat)
    const alivePlayers = () => game.players.filter((p) => p.alive)
    const aliveByRole = (role) => game.players.filter((p) => p.alive && p.role === role)
    const allByRole = (role) => game.players.filter((p) => p.role === role)

    const bump = () => { game.worldSeq++ }
    function pushEvent(t) { bump(); game.publicEvents.push({ day: game.day, text: t, seq: game.worldSeq }) }
    function pushLog(seat, t) { bump(); game.publicLog.push({ day: game.day, seat, text: t, seq: game.worldSeq }) }
    function pushVote(voter, target, kind) { bump(); game.voteRecord.push({ day: game.day, voterSeat: voter, targetSeat: target, kind, seq: game.worldSeq }) }
    const markWait = () => { game.waitStartedAt = Date.now(); game.nudged = false }
    const resetQuery = () => { game.queryCount = {} }
    function flushNightNews() {
      if (!game.nightNews || game.nightNews.length === 0) return
      for (const n of game.nightNews) pushEvent(n)
      game.nightNews = []
    }
    function pendingHasHuman() {
      if (!game.pending || !game.pending.seats) return false
      for (const s of game.pending.seats) {
        const pp = playerBySeat(s)
        if (pp && pp.human) return true
      }
      return false
    }

    // ═══ 知识库（长期记忆，knowledge.json；分区存储/上限/淘汰/窗口路由）═══
    const KNOWLEDGE_PATH = PLUGIN_DIR + '/knowledge.json'
    const K_CAPS = { wolf: 30, 'good-faction': 30, seer: 10, witch: 10, hunter: 10, villager: 10, general: 30 }
    let knowledgeStore = null
    async function loadKnowledge() {
      if (knowledgeStore) return knowledgeStore
      try {
        const fs = ctx.get('fs')
        const t = await fs.resolve(KNOWLEDGE_PATH, { cwd: PLUGIN_DIR })
        const text = await fs.readText(t)
        const j = JSON.parse(text)
        knowledgeStore = j && Array.isArray(j.entries) ? j : { entries: [] }
      } catch (e) { knowledgeStore = { entries: [] } }
      // 旧条目缺 title → 派生（下次保存时落盘）
      for (const e of knowledgeStore.entries) if (!e.title) e.title = deriveTitle(e)
      return knowledgeStore
    }
    async function writeFile(path, data) {
      // 动态沙箱 fs.writeText 不落盘，改用 subprocess-node 写文件（stdin 批量传数据）
      const sub = ctx.get('subprocess')
      if (!sub) return false
      try {
        const node = await sub.resolveExecutable('node')
        const script = "const fs=require('node:fs');let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{fs.writeFileSync(process.env.KPATH,s);console.log('ok')});"
        const h = sub.spawn({
          argv: [node, '-e', script],
          cwd: PLUGIN_DIR,
          env: { KPATH: path },
          stdio: { stdin: { data: data }, stdout: 'inherit', stderr: 'inherit' },
          graceMs: 30000,
        })
        await h.done
        return true
      } catch (e) {
        console.error('[werewolf] file write failed: ' + String(e && e.message || e))
        return false
      }
    }
    async function saveKnowledge() {
      return writeFile(KNOWLEDGE_PATH, JSON.stringify(knowledgeStore, null, 2))
    }
    // 玩家可用的分区：狼人=狼人+通用；好人=本职业+好人阵营+通用
    function knowledgePool(player) {
      return player.role === 'wolf' ? ['wolf', 'general'] : [player.role, 'good-faction', 'general']
    }
    function deriveTitle(e) {
      const t = String(e.text || '').replace(/\s+/g, ' ').trim()
      const m = /^[^。；;，,]+[。；;，]?/.exec(t)
      return (m ? m[0] : t).slice(0, 40) || t.slice(0, 40)
    }
    function knowledgeSummaries(player) {
      const pool = knowledgePool(player)
      return (knowledgeStore.entries || [])
        .filter((e) => pool.includes(e.partition))
        .sort((a, b) => ((b.uses || 0) - (a.uses || 0)) || ((b.lastUsed || 0) - (a.lastUsed || 0)))
        .map((e) => e.id + '[' + e.partition + '] ' + (e.title || deriveTitle(e)))
    }
    // ═══ 独立知识窗口回合 ═══
    // game.knowledge = { quota:{seat:2}, window:{}, waiting:{seat: 续接回调}, offered:{} }
    // maybeKnowledge(p, label, signal)：非阻塞知识窗口。若 p 该节点尚未被提供窗口且配额>0，
    //   单独投递窗口消息（可选操作，不带投票/行动信息，不推进 lastSeen，不阻塞流程），
    //   随后调用方照常投递正式行动消息（其 delta 上下文不受影响）。
    //   agent 可在窗口回合回复 knowledge/knowledge_skip 获取知识；不回复也不影响行动。
    async function maybeKnowledge(p, label, signal) {
      if (!p || p.human) return
      const k = game.knowledge || (game.knowledge = { quota: {}, window: {}, waiting: {}, offered: {} })
      const left = k.quota[p.seat] ?? 2
      // 每天复现的节点（白天投票/天亮）按天计数；一次性节点（首夜/警上投票）按整局计数
      const offerKey = (label === '白天投票' || label === '天亮') ? label + ':' + game.day + ':' + p.seat : label + ':' + p.seat
      if (!label || left <= 0 || k.offered[offerKey]) return
      k.offered[offerKey] = true
      k.window[p.seat] = label
      const prevSeen = p.lastSeen
      try {
        const sums = knowledgeSummaries(p).slice(0, 5).map((s) => '- ' + s).join('\n')
        await deliverTo(p, '【知识窗口·' + label + '】（可选，不影响本轮行动）你剩余 ' + left + ' 次知识详情查看机会，本次最多可取 2 条。以下是你可参考的历史经验摘要：\n' + (sums || '（暂无）') + '\n如需获取详情，请调用 werewolf_act 回复：action=knowledge, text=知识ID（如 k1,k3）；不需要则忽略本消息，直接等待行动指令。', signal)
      } catch (e) {
        console.error('[werewolf] knowledgeWindow deliver error', String(e && e.message || e))
      }
      // 窗口不推进可见性游标：正式行动消息的 delta 上下文必须完整保留
      p.lastSeen = prevSeen
    }

    function keepAliveQuiet(signal) {
      for (const p of alivePlayers()) {
        if ((p.role !== 'villager' && p.role !== 'hunter') || p.unreachable || p.human) continue
        deliverTo(p, ALIVE_MSG, signal).then(() => {}).catch(() => {})
      }
    }

    async function deliverTo(player, content, signal) {
      if (!player) return false
      if (player.human || !player.agentId) {
        if (player.human) {
          let c = String(content)
          const nidx = c.indexOf(ACTION_NOTE)
          if (nidx >= 0) c = c.slice(0, nidx)
          let kind = 'info'
          if (c.indexOf('【狼队】') >= 0 || c.indexOf('狼人讨论') >= 0 || c.indexOf('狼人频道') >= 0 || c.indexOf('狼人袭击') >= 0) kind = 'wolf'
          else if (c.indexOf('查验') >= 0) kind = 'seer'
          else if (c.indexOf('女巫') >= 0 || c.indexOf('解药') >= 0 || c.indexOf('毒药') >= 0 || c.indexOf('用药') >= 0) kind = 'witch'
          else if (c.indexOf('出局') >= 0) kind = 'death'
          else if (c.indexOf('警长') >= 0 || c.indexOf('警徽') >= 0 || c.indexOf('竞选') >= 0) kind = 'sheriff'
          bump()
          game.humanInbox.push({ seq: game.worldSeq, text: c, kind })
          player.lastSeen = game.worldSeq
          return true
        }
        return false
      }
      const parent = agents.get(game.hostSessionId)
      let useSignal = (signal && typeof signal.aborted === 'boolean' && !signal.aborted) ? signal : null
      if (!useSignal && game.lastSignal && typeof game.lastSignal.aborted === 'boolean' && !game.lastSignal.aborted) useSignal = game.lastSignal
      if (!useSignal) useSignal = FAKE_SIGNAL
      if (parent) {
        try {
          await subagents.followup(parent, player.agentId, text(content), {
            source: { kind: 'coordinator', form: 'relay', senderSessionId: game.hostSessionId },
            signal: useSignal,
          })
          player.lastSeen = game.worldSeq
          return true
        } catch (e) {
          console.error('[werewolf] deliver failed seat=' + player.seat, e && e.message ? e.message : String(e))
          player.unreachable = true
          return false
        }
      }
      console.error('[werewolf] deliver pending: no parent seat=' + player.seat + ' phase=' + game.phase)
      return false
    }

    function currentWaitSeat() {
      const g = game
      switch (g.phase) {
        case 'day-speech': return g.speechOrder && g.speechIdx < g.speechOrder.length ? g.speechOrder[g.speechIdx] : null
        case 'day-sheriff-speech': return g.sheriffSpeechOrder ? g.sheriffSpeechOrder[g.sheriffSpeechIdx] : null
        case 'night-wolves': return g.wolfOrder ? g.wolfOrder[g.wolfIdx] : null
        case 'night-seer': { const s = aliveByRole('seer')[0]; return s ? s.seat : null }
        case 'night-witch': { const w = aliveByRole('witch')[0]; return w ? w.seat : null }
        case 'night-hunter': case 'day-hunter': return g.hunterPending ? g.hunterPending.seat : null
        case 'day-direct': return g.sheriff
        case 'sheriff-pass': return g.sheriffPass ? g.sheriffPass.seat : null
        default: return null
      }
    }

    function visibleInfoDelta(p) {
      if (!p) return '【当前】第' + game.day + '天 ' + (PHASE_NAMES[game.phase] || game.phase)
      const g = game
      const lines = []
      lines.push('【当前】第' + g.day + '天 ' + (PHASE_NAMES[g.phase] || g.phase))
      const seen = p.lastSeen || 0
      const unseenEvents = g.publicEvents.filter((e) => e.seq > seen)
      if (unseenEvents.length) {
        lines.push('【新事件】')
        for (const e of unseenEvents) lines.push('- ' + e.text)
      }
      const unseenLogs = g.publicLog.filter((l) => l.seq > seen)
      if (unseenLogs.length) {
        lines.push('【新发言】')
        for (const l of unseenLogs) lines.push('- 第' + l.day + '天 玩家' + l.seat + ': ' + l.text)
      }
      const unseenVotes = g.voteRecord.filter((v) => v.seq > seen)
      if (unseenVotes.length) {
        lines.push('【新投票】')
        for (const v of unseenVotes) lines.push('- 第' + v.day + '天 ' + (v.kind === 'sheriff' ? '[警长]' : '[放逐]') + ' 玩家' + v.voterSeat + ' 投给了 ' + (v.targetSeat === 0 ? '弃票' : '玩家' + v.targetSeat))
      }
      if (p.role === 'wolf') {
        const unseenWolf = g.wolfChannel.filter((l) => l.seq > seen)
        if (unseenWolf.length) {
          lines.push('【狼人频道】')
          for (const l of unseenWolf) lines.push('- ' + (l.seat === 0 ? '' : '狼' + l.seat + '：') + l.text)
        }
      }
      if (p.role === 'seer' && g.seerResults.length) {
        lines.push('【你的查验记录】')
        for (const r of g.seerResults) lines.push('- 玩家' + r.seat + ': ' + (r.isWolf ? '狼人' : '好人'))
      }
      if (p.role === 'witch' && g.witchLog.length) {
        lines.push('【你的用药记录】')
        for (const l of g.witchLog) lines.push('- ' + l)
      }
      if (lines.length === 1) lines.push('（暂无新信息）')
      return lines.join('\n')
    }
    function visibleInfoFull(p) {
      const g = game
      const lines = []
      lines.push('【当前】第' + g.day + '天 ' + (PHASE_NAMES[g.phase] || g.phase))
      lines.push('【公开事件】')
      for (const e of g.publicEvents) lines.push('- ' + e.text)
      lines.push('【公开发言】')
      for (const l of g.publicLog) lines.push('- 第' + l.day + '天 玩家' + l.seat + ': ' + l.text)
      lines.push('【投票记录】')
      for (const v of g.voteRecord) lines.push('- 第' + v.day + '天 ' + (v.kind === 'sheriff' ? '[警长]' : '[放逐]') + ' 玩家' + v.voterSeat + ' 投给了 ' + (v.targetSeat === 0 ? '弃票' : '玩家' + v.targetSeat))
      if (p.role === 'wolf') {
        lines.push('【狼人频道】')
        for (const l of g.wolfChannel) lines.push('- ' + (l.seat === 0 ? '' : '狼' + l.seat + '：') + l.text)
      }
      if (p.role === 'seer' && g.seerResults.length) {
        lines.push('【你的查验记录】')
        for (const r of g.seerResults) lines.push('- 玩家' + r.seat + ': ' + (r.isWolf ? '狼人' : '好人'))
      }
      if (p.role === 'witch' && g.witchLog.length) {
        lines.push('【你的用药记录】')
        for (const l of g.witchLog) lines.push('- ' + l)
      }
      return lines.join('\n')
    }

    function buildPersona(p, wolfMatesText) {
      const lines = []
      lines.push('你正在参与一局 9 人狼人杀（多agent游戏），你的座位号是 ' + p.seat + '。')
      lines.push('你的性格设定：' + p.personality)
      lines.push('')
      lines.push(RULE_TEXT)
      lines.push('')
      lines.push('【你的身份】' + ROLE_NAMES[p.role])
      if (p.role === 'wolf' && wolfMatesText) lines.push('你的狼人队友是：' + wolfMatesText + '。夜间你们会按顺序讨论并统一刀人目标，最终由引擎根据大家的选择裁决。')
      if (p.role === 'seer') lines.push('你每晚可查验一名存活玩家的阵营。')
      if (p.role === 'witch') lines.push('你拥有解药与毒药各一次，首夜可自救，同一夜不能同时使用两瓶药。')
      if (p.role === 'hunter') lines.push('你出局时可以开枪带走一名玩家（被毒杀不能开枪，不能带自己）。')
      lines.push('')
      lines.push('【行动方式·必须用工具】你的所有行动必须通过调用 werewolf_act 工具提交：白天发言 action=speech+text；投票 action=vote/sheriff_vote+target（只需座位号）；警长指定方向 action=direction+text=left/right；警上退水 action=sheriff_quit（退水）/sheriff_stay（不退水）；在线确认 action=alive（收到引擎的在线确认请求时回复）；警长出局处置警徽 action=pass_sheriff+target（传给某玩家/0=撕警徽）；夜间按身份 kill/seer/witch_*/hunter 等。直接输出文本不会生效、不会推进流程，只会白白浪费你的回合——收到引擎消息后，先组织好你的选择，然后务必调用 werewolf_act 提交，最后简短结束回合等待下一条消息。如果 werewolf_act 返回工具错误，稍等后重试一次。')
      lines.push('使用 werewolf_ask_rule 可查询规则。')
      lines.push('【信息获取】引擎会在轮到你行动时投递消息，消息只包含你尚未见过的新信息（前置发言者的话会附在你的消息里）。不要主动轮询状态。')
      lines.push('【补全】如果发现自己上下文缺少关键旧信息（如早期发言可能被压缩丢失），可调用 werewolf_status 获取完整公开信息——每阶段最多1次，禁止连续查询。')
      lines.push('【过期消息】如果收到的引擎消息与当前局面明显不符，那是迟到的旧消息，请忽略，继续等待新消息。')
      lines.push('不要使用其他任何工具。严格按引擎投递的消息行动，不要擅自推进流程。')
      lines.push('你的发言与决策要符合你的身份和性格，像真实玩家一样思考、推理、伪装、说服。')
      if (knowledge.length) {
        lines.push('')
        lines.push('【历史经验（来自往局，供参考）】')
        for (const k of knowledge.slice(-5)) lines.push('- ' + k)
      }
      return lines.join('\n')
    }

    function checkWin() {
      if (aliveByRole('wolf').length === 0) return 'good'
      const gods = ['seer', 'witch', 'hunter'].map((r) => aliveByRole(r).length).reduce((a, b) => a + b, 0)
      const villagers = aliveByRole('villager').length
      if (gods === 0 || villagers === 0) return 'wolf'
      return null
    }

    function wolfDiscussionText() {
      const g = game
      const lines = []
      for (const l of g.wolfChannel) lines.push((l.seat === 0 ? '系统' : '狼' + l.seat) + '：' + l.text)
      const picks = Object.keys(g.wolfVotes).map((s) => '玩家' + s + '→' + '玩家' + g.wolfVotes[s]).join('，')
      return (lines.length ? lines.join('\n') : '（暂无发言）') + '\n当前意向：' + (picks || '（尚未有人选择）')
    }

    async function skipCurrent(signal) {
      const g = game
      if (!g) return
      if (g.advancing) return
      if (pendingHasHuman()) return
      g.advancing = true
      try {
        const skipped = currentWaitSeat()
        console.log('[werewolf] skip current, phase=' + g.phase + (skipped ? ' seat=' + skipped : ''))
        if (skipped) pushEvent('玩家' + skipped + ' 长时间未行动，本轮按弃权处理。')
        switch (g.phase) {
          case 'day-speech': await nextSpeech(signal); break
          case 'day-direct': pushEvent('警长未指定方向，按随机顺序发言。'); flushNightNews(); await daySpeechTurn(signal); break
          case 'sheriff-pass': await resolveSheriffPass(g.sheriffPass.seat, 0, signal); break
          case 'night-wolves': await nextWolf(signal); break
          case 'night-seer': await witchTurn(signal); break
          case 'night-witch': await nightSettle(signal); break
          case 'night-hunter': g.hunterPending = null; pushEvent('猎人未回应，视为不开枪。'); await afterDeath(signal, 'day'); break
          case 'day-hunter': g.hunterPending = null; pushEvent('猎人未回应，视为不开枪。'); await afterDeath(signal, 'night'); break
          case 'day-sheriff-run': {
            if (g.pending && g.pending.seats) g.pending.seats.clear()
            markWait()
            settleSheriffRun(signal)
            break
          }
          case 'day-sheriff-quit': {
            if (g.pending && g.pending.seats) g.pending.seats.clear()
            markWait()
            settleSheriffQuit(signal)
            break
          }
          case 'day-sheriff-speech': await sheriffSpeechTurn(signal); break
          case 'day-sheriff-vote': case 'day-vote': {
            if (g.pending && g.pending.seats) g.pending.seats.clear()
            markWait()
            if (g.phase === 'day-sheriff-vote') settleSheriffVote(signal)
            else settleDayVote(signal)
            break
          }
          case 'review': {
            if (g.pending && g.pending.seats) {
              for (const p of g.players) if (g.pending.seats.has(p.seat)) g.reviewCollected[p.seat] = '（未提交复盘）'
              g.pending.seats.clear()
            }
            await finishReview(); break
          }
          default: break
        }
      } catch (e) {
        console.error('[werewolf] skipCurrent error', e && e.message ? e.message : String(e))
      } finally {
        g.advancing = false
      }
    }

    async function checkTimeouts(signal) {
      if (!game || !game.waitStartedAt || game.advancing) return
      const waited = Date.now() - game.waitStartedAt
      const seat = currentWaitSeat()
      if (seat) {
        const p = playerBySeat(seat)
        if (p && p.agentId) {
          const live = agents.get(p.agentId)
          if (live && live.status === 'running') {
            markWait()
            return
          }
        }
        if (p && p.human) { markWait(); return }
      }
      if (waited >= TIMEOUT_MS) {
        console.log('[werewolf] timeout fired, phase=' + game.phase + ' waited=' + Math.round(waited / 1000) + 's')
        await skipCurrent(signal)
        return
      }
      if (waited >= NUDGE_MS && !game.nudged) {
        game.nudged = true
        if (seat) {
          const p = playerBySeat(seat)
          if (p) {
            console.log('[werewolf] nudge seat=' + seat + ' phase=' + game.phase)
            await deliverTo(p, '【行动提醒】轮到你行动了。请调用 werewolf_act 工具提交本轮行动（直接输出文本无效）。' + ACTION_NOTE, signal)
          }
        }
      }
    }

    async function cleanupOldPlayers(hostAgent, signal) {
      let children = []
      try {
        children = await subagents.listChildren(hostAgent.id, signal)
      } catch (e) {
        console.error('[werewolf] cleanup listChildren failed', e && e.message ? e.message : String(e))
        return 0
      }
      let released = 0
      for (const c of children) {
        if (!c || c.kind !== 'child' || c.mode !== 'continuable') continue
        const label = c.label || ''
        if (!label.startsWith('狼人杀-')) continue
        try {
          const handle = await agents.resume({
            resumeSessionId: c.id,
            agentOptions: { provider: hostAgent.options.provider, model: hostAgent.options.model, maxTokens: 8192 },
            signal,
          })
          await handle.dispose()
          released++
          console.log('[werewolf] released old player ' + c.id + ' (' + label + ')')
        } catch (e) {
          console.error('[werewolf] release failed ' + c.id + ': ' + (e && e.message ? e.message : String(e)))
        }
      }
      console.log('[werewolf] cleanup done, released=' + released)
      return released
    }

    async function sheriffDirectionTurn(signal) {
      game.phase = 'day-direct'
      const sher = playerBySeat(game.sheriff)
      markWait()
      // 天亮知识窗口（第二天起）：警长指定方向前非阻塞提供
      await maybeKnowledge(sher, game.day >= 2 ? '天亮' : null, signal)
      try {
        const ok = await deliverTo(sher, visibleInfoDelta(sher) + '\n\n[警长] 请指定今天的发言方向：回复：action=direction, text=left（从你左边的玩家开始）或 text=right（从你右边的玩家开始）。' + ACTION_NOTE, signal)
        if (!ok && sher.unreachable) await skipCurrent(signal)
      } catch (e) { console.error('[werewolf] dir error', e && e.message ? e.message : String(e)); await skipCurrent(signal) }
    }

    async function resolveSheriffPass(seat, target, signal) {
      const sp = game.sheriffPass
      if (!sp) return
      game.sheriffPass = null
      const p = playerBySeat(seat)
      if (target > 0) {
        const tp = playerBySeat(target)
        if (tp && tp.alive) {
          game.sheriff = target
          pushEvent('警长将警徽传给玩家' + target + '。')
        } else {
          game.sheriff = null
          pushEvent('警长移交警徽的目标无效，警徽被撕掉，本局没有警长。')
        }
      } else {
        game.sheriff = null
        pushEvent('警长选择撕掉警徽，本局没有警长。')
      }
      await afterKillDeath(seat, sp.reason, signal)
      if (!game.hunterPending) await afterDeath(signal, sp.next)
    }

    async function afterKillDeath(seat, reason, signal) {
      const p = playerBySeat(seat)
      if (p.role === 'hunter' && reason !== 'poison' && reason !== 'hunter') {
        game.hunterPending = { seat, reason }
        game.phase = reason === 'vote' ? 'day-hunter' : 'night-hunter'
        markWait()
        try {
          const ok = await deliverTo(p, '你是猎人，出局时可以开枪带走一名存活玩家。回复：action=hunter, target=座位号（0 表示不开枪）。' + ACTION_NOTE, signal)
          if (!ok && p.unreachable) await skipCurrent(signal)
        } catch (e) { console.error('[werewolf] hunter error', e && e.message ? e.message : String(e)); await skipCurrent(signal) }
        return
      }
      game.hunterPending = null
    }

    async function killPlayer(seat, reason, signal, next) {
      const p = playerBySeat(seat)
      if (!p || !p.alive) return
      p.alive = false
      p.deathReason = reason
      p.deathSnapshot = visibleInfoFull(p)
      const reasonText = reason === 'poison' ? '被毒杀' : reason === 'wolf' ? '被狼人袭击' : reason === 'vote' ? '被投票放逐' : '被猎人枪杀'
      if (reason === 'wolf' || reason === 'poison') {
        if (!game.nightNews) game.nightNews = []
        game.nightNews.push('玩家' + seat + '出局。')
      } else {
        pushEvent('玩家' + seat + '出局（' + reasonText + '）。')
      }
      await deliverTo(p, '你出局了（' + reasonText + '）。信息冻结，你将不再收到游戏信息，请等待游戏结束后的复盘。', signal)
      if (p.seat === game.sheriff && !game.sheriffPass) {
        game.sheriffPass = { seat, reason, next: next || 'day' }
        game.phase = 'sheriff-pass'
        markWait()
        try {
          const ok = await deliverTo(p, '你出局了（' + reasonText + '）。作为警长，请处置警徽：回复：action=pass_sheriff, target=传给某存活玩家的座位号；或 target=0（撕掉警徽）。' + ACTION_NOTE, signal)
          if (!ok && p.unreachable) await resolveSheriffPass(seat, 0, signal)
        } catch (e) { console.error('[werewolf] pass error', e && e.message ? e.message : String(e)); await resolveSheriffPass(seat, 0, signal) }
        return
      }
      await afterKillDeath(seat, reason, signal)
    }

    async function afterDeath(signal, next) {
      const win = checkWin()
      if (win) { await endGame(win, signal); return }
      if (next === 'day') {
        await startDay(signal)
      } else {
        await startNight(signal)
      }
    }

    async function startNight(signal) {
      resetQuery()
      keepAliveQuiet(signal)
      game.witch.savedThisNight = false
      pushEvent('天黑请闭眼。')
      game.phase = 'night-wolves'
      const wolfSeats = aliveByRole('wolf').map((p) => p.seat)
      if (game.humanSeat !== null && wolfSeats.includes(game.humanSeat)) {
        game.wolfOrder = shuffle(wolfSeats.filter((s) => s !== game.humanSeat)).concat([game.humanSeat])
      } else {
        game.wolfOrder = shuffle(wolfSeats)
      }
      game.wolfIdx = 0
      game.wolfVotes = {}
      game.wolfRound = 1
      // 首夜知识窗口：由各夜间行动者回合内独立提供（maybeKnowledge）
      markWait()
      await nextWolf(signal)
    }

    async function nextWolf(signal) {
      while (game.wolfIdx < game.wolfOrder.length && game.wolfVotes[game.wolfOrder[game.wolfIdx]] !== undefined) game.wolfIdx++
      if (game.wolfIdx < game.wolfOrder.length) {
        const p = playerBySeat(game.wolfOrder[game.wolfIdx])
        if (!p) { game.wolfIdx++; await nextWolf(signal); return }
        const roundText = game.wolfRound <= 2
          ? (game.wolfRound === 1
            ? '[夜间·狼人讨论] 轮到你发言并选择刀人目标。\n当前狼人讨论：\n' + wolfDiscussionText() + '\n回复：action=kill, target=座位号, text=发言。'
            : '[夜间·狼人确认] 第一轮意向未统一，轮到你确认或改票。\n当前狼人讨论：\n' + wolfDiscussionText() + '\n回复：action=kill, target=座位号, text=补充意见。')
          : '[夜间·狼人讨论·多数决] 轮到你投票，本轮收齐后按多数票裁决。\n当前狼人讨论：\n' + wolfDiscussionText() + '\n回复：action=kill, target=座位号, text=补充意见。'
        markWait()
        // 首夜知识窗口：非阻塞提供（仅首轮、每狼一次）
        await maybeKnowledge(p, '首夜', signal)
        try {
          const ok = await deliverTo(p, visibleInfoDelta(p) + '\n\n' + roundText + ACTION_NOTE, signal)
          if (!ok && p.unreachable) await skipCurrent(signal)
        } catch (e) { console.error('[werewolf] nextWolf error', e && e.message ? e.message : String(e)); await skipCurrent(signal) }
        return
      }
      const votes = Object.values(game.wolfVotes).filter((t) => t > 0)
      const distinct = new Set(votes)
      if (game.wolfRound < 3 && distinct.size > 1 && game.wolfOrder.length > 1 && game.wolfRound < MAX_WOLF_ROUNDS) {
        game.wolfRound++
        game.wolfVotes = {}
        game.wolfIdx = 0
        markWait()
        await nextWolf(signal)
        return
      }
      const counts = {}
      for (const seat of Object.keys(game.wolfVotes)) {
        const t2 = game.wolfVotes[seat]
        counts[t2] = (counts[t2] || 0) + 1
      }
      let top = 0, max = 0, tie = false
      for (const seat of Object.keys(counts)) {
        const n = counts[seat]
        if (n > max) { max = n; top = Number(seat); tie = false }
        else if (n === max) tie = true
      }
      if (top === 0 || max === 0 || tie) {
        if (game.wolfVotes[game.wolfOrder[0]]) top = game.wolfVotes[game.wolfOrder[0]]
        else {
          const candidates = alivePlayers().filter((p) => p.role !== 'wolf')
          top = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)].seat : 0
        }
      }
      game.wolfTarget = top
      if (!game.wolfChannel) game.wolfChannel = []
      bump()
      game.wolfChannel.push({ day: game.day, seat: 0, text: '【狼队】今晚刀口确认：玩家' + top + '。', seq: game.worldSeq })
      await seerTurn(signal)
    }

    async function seerTurn(signal) {
      const seer = aliveByRole('seer')[0]
      if (!seer) { await witchTurn(signal); return }
      game.phase = 'night-seer'
      markWait()
      await maybeKnowledge(seer, '首夜', signal)
      try {
        const ok = await deliverTo(seer, visibleInfoDelta(seer) + '\n\n[夜间·预言家] 请选择一名存活玩家查验阵营（不能查自己）。回复：action=seer, target=座位号。' + ACTION_NOTE, signal)
        if (!ok && seer.unreachable) await skipCurrent(signal)
      } catch (e) { console.error('[werewolf] seer error', e && e.message ? e.message : String(e)); await skipCurrent(signal) }
    }

    async function witchTurn(signal) {
      const witch = aliveByRole('witch')[0]
      if (!witch) { await nightSettle(signal); return }
      game.phase = 'night-witch'
      markWait()
      let msg
      if (game.witch.saveAvailable) {
        const killed = game.wolfTarget
        msg = '[夜间·女巫] 今晚狼人袭击了玩家' + killed + (killed === witch.seat ? '（是你！）' : '') + '。\n解药剩余：1；毒药剩余：' + (game.witch.poisonAvailable ? '1' : '0') + '。' + (game.witch.firstNight ? '（首夜，可以自救）' : '') + '\n回复：action=witch_save（使用解药救他）/ action=witch_poison, target=座位号（毒杀一名玩家）/ action=witch_none（不行动）。'
      } else {
        msg = '[夜间·女巫] 你的解药已用。毒药剩余：' + (game.witch.poisonAvailable ? '1' : '0') + '。\n回复：action=witch_poison, target=座位号（毒杀一名玩家）/ action=witch_none（不行动）。'
      }
      try {
        await maybeKnowledge(witch, '首夜', signal)
        try {
          const ok = await deliverTo(witch, visibleInfoDelta(witch) + '\n\n' + msg + ACTION_NOTE, signal)
          if (!ok && witch.unreachable) await skipCurrent(signal)
        } catch (e) { console.error('[werewolf] witch error', e && e.message ? e.message : String(e)); await skipCurrent(signal) }
      } catch (e) { console.error('[werewolf] witch window error', String(e && e.message || e)); await skipCurrent(signal) }
    }

    async function nightSettle(signal) {
      const deaths = []
      if (game.wolfTarget && !game.witch.savedThisNight) deaths.push(game.wolfTarget)
      if (game.poisonTarget) deaths.push(game.poisonTarget)
      const seen = {}
      const unique = []
      for (const d of deaths) if (!seen[d]) { seen[d] = true; unique.push(d) }
      if (unique.length === 0) {
        if (!game.nightNews) game.nightNews = []
        game.nightNews.push('平安夜。')
        await afterDeath(signal, 'day')
        return
      }
      for (const seat of unique) {
        await killPlayer(seat, seat === game.poisonTarget ? 'poison' : 'wolf', signal, 'day')
      }
      if (!game.hunterPending && !game.sheriffPass) await afterDeath(signal, 'day')
    }

    async function startDay(signal) {
      resetQuery()
      keepAliveQuiet(signal)
      game.day++
      pushEvent('天亮了。第' + game.day + '天白天。')
      // 知识窗口·天亮（第二天起）：随当天首个行动回合独立提供（sheriffDirectionTurn / nextSpeech 内 maybeKnowledge）
      const sherAlive = game.sheriff && playerBySeat(game.sheriff) && playerBySeat(game.sheriff).alive
      if (game.day === 1 && !game.sheriffElected) {
        await sheriffRunTurn(signal)
      } else if (sherAlive) {
        flushNightNews()
        await sheriffDirectionTurn(signal)
      } else {
        flushNightNews()
        await daySpeechTurn(signal)
      }
    }

    // 上警：真并发投递
    async function sheriffRunTurn(signal) {
      game.phase = 'day-sheriff-run'
      game.sheriffCandidates = []
      game.sheriffRan = []
      game.sheriffDecided = new Set()
      game.sheriffVoteRound = 1
      game.sheriffSpeechIdx = 0
      game.pending = { kind: 'sheriff-run', seats: new Set(alivePlayers().map((p) => p.seat)) }
      markWait()
      await Promise.all(alivePlayers().map((p) => (async () => {
        try {
          const ok = await deliverTo(p, visibleInfoDelta(p) + '\n\n[警长竞选] 是否上警竞选警长？回复：action=sheriff_run（上警）/ action=sheriff_not（不上警）。' + ACTION_NOTE, signal)
          if (!ok && p.unreachable && game.pending) game.pending.seats.delete(p.seat)
        } catch (e) { console.error('[werewolf] sheriffRun deliver error', e && e.message ? e.message : String(e)) }
      })()))
    }

    function settleSheriffRun(signal) {
      if (game.sheriffCandidates.length === 0) {
        pushEvent('无人上警，本局没有警长。')
        game.sheriffElected = true
        flushNightNews()
        daySpeechTurn(signal)
        return
      }
      pushEvent('上警竞选者：' + game.sheriffCandidates.map((s) => '玩家' + s).join('、') + '。')
      game.sheriffSpeechOrder = randomOrder(game.sheriffCandidates)
      game.sheriffSpeechIdx = 0
      sheriffSpeechTurn(signal)
    }

    async function sheriffSpeechTurn(signal) {
      game.phase = 'day-sheriff-speech'
      if (game.sheriffSpeechIdx < game.sheriffSpeechOrder.length) {
        const p = playerBySeat(game.sheriffSpeechOrder[game.sheriffSpeechIdx])
        if (!p) { game.sheriffSpeechIdx++; await sheriffSpeechTurn(signal); return }
        markWait()
        try {
          const ok = await deliverTo(p, visibleInfoDelta(p) + '\n\n[警上发言] 轮到你竞选发言，请说服大家选你。回复：action=speech, text=你的竞选发言。' + ACTION_NOTE, signal)
          if (!ok && p.unreachable) await skipCurrent(signal)
        } catch (e) { console.error('[werewolf] sheriffSpeech error', e && e.message ? e.message : String(e)); await skipCurrent(signal) }
        return
      }
      await sheriffQuitTurn(signal)
    }

    // 退水：真并发投递
    async function sheriffQuitTurn(signal) {
      game.phase = 'day-sheriff-quit'
      game.quitSet = new Set()
      game.quitDecided = new Set()
      game.pending = { kind: 'sheriff-quit', seats: new Set(game.sheriffCandidates) }
      markWait()
      await Promise.all(game.sheriffCandidates.map((seat) => (async () => {
        const p = playerBySeat(seat)
        if (!p) { if (game.pending) game.pending.seats.delete(seat); return }
        try {
          const ok = await deliverTo(p, visibleInfoDelta(p) + '\n\n[警上退水] 警上发言结束。是否继续竞选警长？回复：action=sheriff_stay（不退水）/ action=sheriff_quit（退水）。' + ACTION_NOTE, signal)
          if (!ok && p.unreachable && game.pending) game.pending.seats.delete(p.seat)
        } catch (e) { console.error('[werewolf] quit deliver error', e && e.message ? e.message : String(e)) }
      })()))
    }

    function settleSheriffQuit(signal) {
      const quitList = [...game.quitSet]
      const stayed = game.sheriffCandidates.filter((s) => !game.quitSet.has(s))
      pushEvent('警上退水结果：' + (quitList.length ? '玩家' + quitList.join('、') + ' 退水；' : '无人退水；') + '继续竞选：' + (stayed.length ? '玩家' + stayed.join('、') : '（无人）') + '。')
      game.sheriffCandidates = stayed
      if (stayed.length === 0) {
        pushEvent('所有候选人退水，本局没有警长。')
        game.sheriffElected = true
        flushNightNews()
        daySpeechTurn(signal)
        return
      }
      sheriffVoteTurn(signal)
    }

    // 警下投票：真并发投递
    async function sheriffVoteTurn(signal) {
      game.phase = 'day-sheriff-vote'
      game.pending = { kind: 'sheriff-vote', seats: new Set() }
      const voters = alivePlayers().filter((p) => !game.sheriffRan.includes(p.seat))
      for (const p of voters) game.pending.seats.add(p.seat)
      // 知识窗口·第一天警上投票前（只开窗口，询问随投票消息追加）
      if (game.pending.seats.size === 0) {
        game.sheriff = game.sheriffCandidates[0]
        pushEvent('所有存活玩家都是候选人，玩家' + game.sheriff + '当选警长。')
        game.sheriffElected = true
        flushNightNews()
        await sheriffDirectionTurn(signal)
        return
      }
      const candText = game.sheriffCandidates.map((c) => '玩家' + c).join('、')
      const voterText = '警下投票者：' + voters.map((p) => '玩家' + p.seat).join('、') + '。'
      markWait()
      await Promise.all(voters.map((p) => (async () => {
        const voteText = (game.sheriffVoteRound === 2
          ? '\n\n[警下投票·第二轮] 第一轮平票。请只能在候选人 ' + candText + ' 中选择（或0弃票）：action=sheriff_vote, target=座位号。'
          : '\n\n[警下投票] 警长候选人是：' + candText + '。' + voterText + '请投票：action=sheriff_vote, target=候选人座位号（0=弃票）。')
        // 知识窗口（第一天警上投票前）：非阻塞提供，随后照常投递投票消息
        await maybeKnowledge(p, '警上投票', signal)
        try {
          const ok = await deliverTo(p, visibleInfoDelta(p) + voteText + ACTION_NOTE, signal)
          if (!ok && p.unreachable && game.pending) game.pending.seats.delete(p.seat)
        } catch (e) { console.error('[werewolf] sheriffVote deliver error', e && e.message ? e.message : String(e)) }
      })()))
    }

    function settleSheriffVote(signal) {
      const counts = {}
      for (const v of game.voteRecord.filter((v) => v.day === game.day && v.kind === 'sheriff')) {
        if (game.sheriffCandidates.includes(v.targetSeat) && v.targetSeat > 0) counts[v.targetSeat] = (counts[v.targetSeat] || 0) + 1
      }
      let top = 0, max = 0, tie = false
      const ties = []
      for (const seat of Object.keys(counts)) {
        const n = counts[seat]
        if (n > max) { max = n; top = Number(seat); tie = false; ties.length = 0; ties.push(Number(seat)) }
        else if (n === max) { tie = true; ties.push(Number(seat)) }
      }
      if (top === 0 || tie) {
        if (game.sheriffVoteRound === 1 && top > 0) {
          pushEvent('警长竞选第一轮平票（' + ties.map((s) => '玩家' + s).join('、') + '），进入第二轮。')
          game.sheriffVoteRound = 2
          game.sheriffTie = ties
          sheriffVoteTurn(signal)
          return
        }
        pushEvent('警长竞选投票无结果（平票或无人得票），本局没有警长。')
        game.sheriffElected = true
        flushNightNews()
        daySpeechTurn(signal)
        return
      }
      game.sheriff = top
      pushEvent('玩家' + top + ' 当选警长。')
      game.sheriffElected = true
      flushNightNews()
      sheriffDirectionTurn(signal)
    }

    async function daySpeechTurn(signal) {
      game.phase = 'day-speech'
      const seats = alivePlayers().map((p) => p.seat)
      const sher = game.sheriff && playerBySeat(game.sheriff)
      if (sher && sher.alive) {
        game.speechOrder = ringOrderLast(seats, game.sheriff, game.speechDirection || 'right')
      } else {
        game.speechOrder = randomOrder(seats)
      }
      game.speechIdx = 0
      await nextSpeech(signal)
    }

    async function nextSpeech(signal) {
      if (game.speechIdx >= game.speechOrder.length) { await dayVoteTurn(signal); return }
      const seat = game.speechOrder[game.speechIdx]
      const p = playerBySeat(seat)
      if (!p) { game.speechIdx++; await nextSpeech(signal); return }
      const orderText = '本日发言顺序：' + game.speechOrder.map((s) => '玩家' + s).join('→') + '。你是第 ' + (game.speechIdx + 1) + ' 位发言者。'
      markWait()
      // 天亮知识窗口（第二天起）：每位发言者发言前非阻塞提供
      await maybeKnowledge(p, game.day >= 2 ? '天亮' : null, signal)
      try {
        const ok = await deliverTo(p, visibleInfoDelta(p) + '\n\n[白天发言] ' + orderText + '\n请发表你的观点、推理与指控。回复：action=speech, text=发言内容。' + ACTION_NOTE, signal)
        if (!ok && p.unreachable) {
          game.speechIdx++
          await nextSpeech(signal)
        }
      } catch (e) {
        console.error('[werewolf] nextSpeech error', e && e.message ? e.message : String(e))
        game.speechIdx++
        await nextSpeech(signal)
      }
    }

    // 白天投票：真并发投递
    async function dayVoteTurn(signal) {
      game.phase = 'day-vote'
      if (game.voteRound === 1) game.pending = { kind: 'day-vote', seats: new Set() }
      const voters = alivePlayers()
      for (const p of voters) game.pending.seats.add(p.seat)
      if (voters.length === 0) { await afterDeath(signal, 'night'); return }
      markWait()
      await Promise.all(voters.map((p) => (async () => {
        let voteText
        if (game.voteRound === 2) {
          voteText = '\n\n[白天投票·第二轮] 第一轮平票，只能在玩家' + (game.tieCandidates || []).map((s) => s).join('、') + ' 中选择（或0弃票）：action=vote, target=座位号。'
        } else {
          voteText = '\n\n[白天投票] 请投票放逐一名玩家。回复：action=vote, target=座位号（0=弃票）。投票信息将公开，警长按1.5票计。'
        }
        // 知识窗口（白天归票/投票前）：非阻塞提供，随后照常投递投票消息
        await maybeKnowledge(p, '白天投票', signal)
        try {
          const ok = await deliverTo(p, visibleInfoDelta(p) + voteText + ACTION_NOTE, signal)
          if (!ok && p.unreachable && game.pending) game.pending.seats.delete(p.seat)
        } catch (e) { console.error('[werewolf] dayVote deliver error', e && e.message ? e.message : String(e)) }
      })()))
    }

    function settleDayVote(signal) {
      const counts = {}
      for (const v of game.voteRecord.filter((v) => v.day === game.day && v.kind === 'day')) {
        if (v.targetSeat > 0) {
          const weight = v.voterSeat === game.sheriff ? 3 : 2
          counts[v.targetSeat] = (counts[v.targetSeat] || 0) + weight
        }
      }
      let top = 0, max = 0, tie = false
      const ties = []
      for (const seat of Object.keys(counts)) {
        const n = counts[seat]
        if (n > max) { max = n; top = Number(seat); tie = false; ties.length = 0; ties.push(Number(seat)) }
        else if (n === max) { tie = true; ties.push(Number(seat)) }
      }
      if (top === 0 || max === 0 || tie) {
        if (game.voteRound === 1 && top > 0) {
          pushEvent('第' + game.day + '天第一轮投票平票（玩家' + ties.join('、') + ' 各 ' + (max / 2) + ' 票），进入第二轮，只能在平票人间选择。')
          game.voteRound = 2
          game.tieCandidates = ties
          dayVoteTurn(signal)
          return
        }
        pushEvent('第' + game.day + '天投票结束：平票或无人得票，无人出局。')
        game.voteRound = 1
        afterDeath(signal, 'night')
        return
      }
      pushEvent('第' + game.day + '天投票结束：玩家' + top + ' 以 ' + (max / 2) + ' 票被放逐。')
      game.voteRound = 1
      killPlayer(top, 'vote', signal, 'night').then(() => {
        if (!game.hunterPending && !game.sheriffPass) afterDeath(signal, 'night')
      })
    }

    async function endGame(win, signal) {
      resetQuery()
      flushNightNews()
      game.phase = 'gameover'
      game.win = win
      pushEvent('游戏结束：' + (win === 'good' ? '好人阵营获胜！' : '狼人阵营获胜！'))
      pushEvent('身份揭示：' + game.players.map((p) => '玩家' + p.seat + '=' + ROLE_NAMES[p.role]).join('，'))
      game.phase = 'review'
      game.reviewDone = false
      game.pending = { kind: 'review', seats: new Set(game.players.map((p) => p.seat)) }
      markWait()
      for (const p of game.players) {
        const info = p.alive ? visibleInfoFull(p) : '（你出局时的信息快照，之后发生的事你不知道）\n' + (p.deathSnapshot || visibleInfoFull(p))
        try {
          const ok = await deliverTo(p, info + '\n\n[复盘] 游戏已结束。请基于你当时知道的信息，输出你的决策复盘：你的身份、关键决策与理由、你的失误、你学到的策略。回复：action=review, text=复盘内容。' + ACTION_NOTE, signal)
          if (!ok && p.unreachable) game.reviewCollected[p.seat] = '（未提交复盘）'
        } catch (e) { console.error('[werewolf] review deliver error', e && e.message ? e.message : String(e)) }
      }
    }

    async function finishReview() {
      const g = game
      const lines = []
      lines.push('# 狼人杀复盘报告')
      lines.push('胜利方：' + (g.win === 'good' ? '好人阵营' : '狼人阵营'))
      lines.push('')
      lines.push('## 身份')
      for (const p of g.players) {
        const st = p.alive ? '存活' : (p.deathReason ? '出局(' + p.deathReason + ')' : '出局')
        lines.push('- 玩家' + p.seat + '：' + ROLE_NAMES[p.role] + '（' + st + '）')
      }
      lines.push('')
      lines.push('## 关键事件')
      for (const e of g.publicEvents) lines.push('- ' + e.text)
      lines.push('')
      lines.push('## 玩家复盘')
      for (const p of g.players) {
        lines.push('### 玩家' + p.seat + '（' + ROLE_NAMES[p.role] + '）')
        lines.push(g.reviewCollected[p.seat] || '（未提交复盘）')
        lines.push('')
      }
      g.reviewReport = lines.join('\n')
      const items = []
      items.push(g.win === 'wolf' ? '狼人阵营获胜的一局：关键狼刀=' + (g.wolfTarget || '无') + '。' : '好人阵营获胜的一局。')
      const wolfKills = g.publicEvents.filter((e) => e.text.includes('被狼人袭击'))
      for (const e of wolfKills.slice(0, 3)) items.push('夜晚击杀：' + e.text)
      const wolfMistake = g.publicEvents.filter((e) => e.text.includes('被投票放逐'))
      for (const e of wolfMistake.slice(0, 2)) items.push('白天放逐：' + e.text)
      knowledge.push('第' + (knowledge.length + 1) + '局：' + items.join(' '))
      if (knowledge.length > 20) knowledge = knowledge.slice(-20)
      console.log('[werewolf] knowledge updated, total=' + knowledge.length)
      // 复盘完成标记：父 agent 据此自动提炼知识入库（纳入固定节奏）
      try {
        await writeFile(PLUGIN_DIR + '/last-review.json', JSON.stringify({
          finishedAt: Date.now(),
          win: g.win,
          day: g.day,
          reviewReport: g.reviewReport,
        }, null, 2))
        console.log('[werewolf] last-review.json written')
      } catch (e) {
        console.error('[werewolf] last-review.json write failed: ' + String(e && e.message || e))
      }
    }

    async function applyAction(player, act, target, t, signal) {
      if (act === 'alive') {
        return { ok: true, notice: '在线确认已收到，等待引擎指令' }
      }
      if (act === 'knowledge' || act === 'knowledge_skip') {
        // 非阻塞知识窗口：窗口已单独投递，回复仅用于获取知识，不续接/不阻塞阶段流程
        const k = game.knowledge || (game.knowledge = { quota: {}, window: {}, waiting: {}, offered: {} })
        delete k.waiting[player.seat]
        delete k.window[player.seat]
        if (act === 'knowledge') {
          const left = k.quota[player.seat] ?? 2
          if (left <= 0) return { ok: false, error: '本局知识获取次数已用完' }
          const ids = String(t || '').split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 2)
          if (!ids.length) return { ok: false, error: '请提供知识ID，如 k1,k3' }
          const pool = knowledgePool(player)
          const found = []
          for (const id of ids) {
            const e = (knowledgeStore.entries || []).find((x) => x.id === id && pool.includes(x.partition))
            if (e) { e.uses = (e.uses || 0) + 1; e.lastUsed = Date.now(); found.push(e) }
          }
          if (!found.length) return { ok: false, error: '知识ID无效或不属于你可用的分区' }
          k.quota[player.seat] = left - 1
          await saveKnowledge()
          return { ok: true, remaining: left - 1, knowledge: found.map((e) => ({ id: e.id, partition: e.partition, title: e.title || deriveTitle(e), text: e.text })) }
        }
        return { ok: true, notice: '已跳过本次知识获取（不占用次数）' }
      }
      if (act === 'review') {
        if (game.phase !== 'review') return { ok: false, error: '游戏尚未结束' }
        game.reviewCollected[player.seat] = t
        game.pending.seats.delete(player.seat)
        if (game.pending.seats.size === 0 && !game.reviewDone) {
          game.reviewDone = true
          await finishReview()
          pushEvent('复盘完成。主持人可用 werewolf_status 查看完整复盘报告。')
        }
        return { ok: true, notice: '复盘已提交' }
      }

      if (game.phase === 'sheriff-pass') {
        if (!game.sheriffPass || player.seat !== game.sheriffPass.seat) return { ok: false, error: '现在不是你的警徽处置轮次' }
        if (act !== 'pass_sheriff') return { ok: false, error: '请用 pass_sheriff 处置警徽' }
        if (!(target === 0 || (Number.isInteger(target) && target >= 1 && target <= 9))) return { ok: false, error: 'target 必须是 1-9 或 0' }
        await resolveSheriffPass(player.seat, target, signal)
        return { ok: true, notice: '警徽处置完成' }
      }

      if ((game.phase === 'night-hunter' || game.phase === 'day-hunter') && player.role === 'hunter') {
        if (act !== 'hunter') return { ok: false, error: '请用 hunter 选择是否开枪' }
        const hReason = game.hunterPending ? game.hunterPending.reason : 'wolf'
        if (target > 0) {
          if (!Number.isInteger(target) || target < 1 || target > 9 || target === player.seat) return { ok: false, error: 'target 必须是 1-9 且不能带自己' }
          const tp = playerBySeat(target)
          if (!tp.alive) return { ok: false, error: '目标已出局' }
          game.hunterPending = null
          pushEvent('猎人开枪带走了玩家' + target + '。')
          await killPlayer(target, 'hunter', signal, hReason === 'vote' ? 'night' : 'day')
          if (!game.sheriffPass) await afterDeath(signal, hReason === 'vote' ? 'night' : 'day')
        } else {
          game.hunterPending = null
          pushEvent('猎人选择不开枪。')
          if (!game.sheriffPass) await afterDeath(signal, hReason === 'vote' ? 'night' : 'day')
        }
        return { ok: true, notice: '猎人行动已记录' }
      }

      if (!player.alive) return { ok: false, error: '你已出局，信息冻结' }

      if (game.phase === 'day-direct') {
        if (player.seat !== game.sheriff) return { ok: false, error: '只有警长可以指定发言方向' }
        if (act !== 'direction' || (t !== 'left' && t !== 'right')) return { ok: false, error: '请用 action=direction, text=left 或 text=right' }
        game.speechDirection = t
        pushEvent('警长选择从' + (t === 'left' ? '左边' : '右边') + '开始发言。')
        await daySpeechTurn(signal)
        return { ok: true, notice: '发言方向已指定：' + (t === 'left' ? '从你左边开始' : '从你右边开始') }
      }

      if (game.phase === 'night-wolves' && player.role === 'wolf') {
        if (act !== 'kill') return { ok: false, error: '请用 kill 选择刀人目标' }
        if (game.wolfVotes[player.seat] !== undefined) return { ok: false, error: '你已经提交过刀人目标，等待其他狼人' }
        if (!Number.isInteger(target) || target < 1 || target > 9) return { ok: false, error: 'target 必须是 1-9' }
        const tp = playerBySeat(target)
        if (!tp.alive) return { ok: false, error: '目标已出局' }
        if (t.trim()) { bump(); game.wolfChannel.push({ day: game.day, seat: player.seat, text: t, seq: game.worldSeq }) }
        game.wolfVotes[player.seat] = target
        game.wolfIdx++
        if (game.wolfIdx < game.wolfOrder.length) {
          const n = playerBySeat(game.wolfOrder[game.wolfIdx])
          if (!n) { await nextWolf(signal); return { ok: true, notice: '狼人行动已记录' } }
          const roundText = game.wolfRound <= 2
            ? (game.wolfRound === 1
              ? '[夜间·狼人讨论] 轮到你发言并选择刀人目标。\n当前狼人讨论：\n' + wolfDiscussionText() + '\n回复：action=kill, target=座位号, text=发言。'
              : '[夜间·狼人确认] 第一轮意向未统一，轮到你确认或改票。\n当前狼人讨论：\n' + wolfDiscussionText() + '\n回复：action=kill, target=座位号, text=补充意见。')
            : '[夜间·狼人讨论·多数决] 轮到你投票，本轮收齐后按多数票裁决。\n当前狼人讨论：\n' + wolfDiscussionText() + '\n回复：action=kill, target=座位号, text=补充意见。'
          markWait()
          try {
            const ok = await deliverTo(n, visibleInfoDelta(n) + '\n\n' + roundText + ACTION_NOTE, signal)
            if (!ok && n.unreachable) await skipCurrent(signal)
          } catch (e) { console.error('[werewolf] wolf deliver error', e && e.message ? e.message : String(e)); await skipCurrent(signal) }
        } else {
          await nextWolf(signal)
        }
        return { ok: true, notice: '狼人行动已记录' }
      }

      if (game.phase === 'night-seer' && player.role === 'seer') {
        if (act !== 'seer') return { ok: false, error: '请用 seer 查验' }
        if (!Number.isInteger(target) || target < 1 || target > 9 || target === player.seat) return { ok: false, error: 'target 必须是 1-9 且不能是自己' }
        const tp = playerBySeat(target)
        if (!tp.alive) return { ok: false, error: '只能查验存活玩家' }
        const isWolf = tp.role === 'wolf'
        game.seerResults.push({ seat: target, isWolf })
        await deliverTo(player, visibleInfoDelta(player) + '\n\n[查验结果] 玩家' + target + ' 是 ' + (isWolf ? '狼人' : '好人') + '。', signal)
        await witchTurn(signal)
        return { ok: true, notice: '查验完成' }
      }

      if (game.phase === 'night-witch' && player.role === 'witch') {
        if (act === 'witch_save') {
          if (!game.witch.saveAvailable) return { ok: false, error: '解药已用完' }
          if (game.wolfTarget === player.seat && !game.witch.firstNight) return { ok: false, error: '非首夜不能自救' }
          game.witch.saveAvailable = false
          game.witch.savedThisNight = true
          game.witchLog.push('第' + game.day + '夜：使用解药救了玩家' + game.wolfTarget)
        } else if (act === 'witch_poison') {
          if (!game.witch.poisonAvailable) return { ok: false, error: '毒药已用完' }
          if (!Number.isInteger(target) || target < 1 || target > 9 || target === player.seat) return { ok: false, error: 'target 必须是 1-9 且不能毒自己' }
          game.witch.poisonAvailable = false
          game.poisonTarget = target
          game.witchLog.push('第' + game.day + '夜：使用毒药毒了玩家' + target)
        } else if (act === 'witch_none') {
          game.witchLog.push('第' + game.day + '夜：没有用药')
        } else {
          return { ok: false, error: '请用 witch_save / witch_poison / witch_none' }
        }
        game.witch.firstNight = false
        await nightSettle(signal)
        return { ok: true, notice: '女巫行动已记录' }
      }

      if (game.phase === 'day-sheriff-run') {
        if (!game.pending || !game.pending.seats.has(player.seat)) return { ok: false, error: '现在不是你的上警轮次' }
        if (act === 'sheriff_run' || act === 'sheriff_not') {
          if (act === 'sheriff_run') { game.sheriffCandidates.push(player.seat); game.sheriffRan.push(player.seat) }
          game.sheriffDecided.add(player.seat)
          game.pending.seats.delete(player.seat)
          if (game.pending.seats.size === 0) settleSheriffRun(signal)
          return { ok: true, notice: act === 'sheriff_run' ? '你已上警' : '你未上警' }
        }
        return { ok: false, error: '请用 sheriff_run / sheriff_not' }
      }
      if (game.phase === 'day-sheriff-speech') {
        if (game.sheriffSpeechOrder[game.sheriffSpeechIdx] !== player.seat) return { ok: false, error: '现在不是你的发言轮次' }
        if (act !== 'speech' || !t.trim()) return { ok: false, error: '请用 speech + text 发言' }
        pushLog(player.seat, '[警上]' + t)
        game.sheriffSpeechIdx++
        await sheriffSpeechTurn(signal)
        return { ok: true, notice: '警上发言已记录' }
      }
      if (game.phase === 'day-sheriff-quit') {
        if (!game.pending || !game.pending.seats.has(player.seat)) return { ok: false, error: '现在不是你的退水轮次' }
        if (act === 'sheriff_quit') game.quitSet.add(player.seat)
        else if (act !== 'sheriff_stay') return { ok: false, error: '请用 sheriff_quit（退水）/ sheriff_stay（不退水）' }
        game.quitDecided.add(player.seat)
        game.pending.seats.delete(player.seat)
        if (game.pending.seats.size === 0) settleSheriffQuit(signal)
        return { ok: true, notice: act === 'sheriff_quit' ? '你已退水' : '你继续竞选' }
      }
      if (game.phase === 'day-sheriff-vote') {
        if (act !== 'sheriff_vote') return { ok: false, error: '请用 sheriff_vote 投票' }
        if (!game.pending || !game.pending.seats.has(player.seat)) return { ok: false, error: '你不是警下投票者（上警或退水者无投票权）' }
        if (game.sheriffVoteRound === 2) {
          if (!(target === 0 || (Number.isInteger(target) && (game.sheriffTie || []).includes(target)))) return { ok: false, error: '第二轮只能在平票候选人中选择或弃票(0)' }
        } else {
          if (!(target === 0 || (Number.isInteger(target) && game.sheriffCandidates.includes(target)))) return { ok: false, error: 'target 必须是候选人座位或 0' }
        }
        pushVote(player.seat, target, 'sheriff')
        game.pending.seats.delete(player.seat)
        if (game.pending.seats.size === 0) settleSheriffVote(signal)
        return { ok: true, notice: '警下投票已记录' }
      }

      if (game.phase === 'day-speech') {
        if (game.speechOrder[game.speechIdx] !== player.seat) return { ok: false, error: '现在不是你的发言轮次' }
        if (act !== 'speech' || !t.trim()) return { ok: false, error: '请用 speech + text 发言' }
        pushLog(player.seat, t)
        game.speechIdx++
        try {
          await nextSpeech(signal)
        } catch (e) { console.error('[werewolf] speech advance error', e && e.message ? e.message : String(e)) }
        return { ok: true, notice: '发言已记录' }
      }

      if (game.phase === 'day-vote') {
        if (act !== 'vote') return { ok: false, error: '请用 vote 投票' }
        if (!game.pending || !game.pending.seats.has(player.seat)) return { ok: false, error: '你不是投票者' }
        if (game.voteRound === 2) {
          if (!(target === 0 || (Number.isInteger(target) && (game.tieCandidates || []).includes(target)))) return { ok: false, error: '第二轮只能在平票候选人中选择或弃票(0)' }
        } else if (!(target === 0 || (Number.isInteger(target) && target >= 1 && target <= 9))) {
          return { ok: false, error: 'target 必须是 1-9 或 0' }
        }
        if (target > 0 && !playerBySeat(target).alive) return { ok: false, error: '目标已出局' }
        pushVote(player.seat, target, 'day')
        game.pending.seats.delete(player.seat)
        if (game.pending.seats.size === 0) settleDayVote(signal)
        return { ok: true, notice: '投票已记录' }
      }

      return { ok: false, error: '当前阶段 ' + (PHASE_NAMES[game.phase] || game.phase) + ' 不接受该行动' }
    }

    const disposers = []
    function registerTool(def) {
      const tool = defineTool(def)
      disposers.push(ctx.tools.register(tool))
    }

    const OUTPUT = { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] }

    registerTool({
      name: 'werewolf_start',
      description: '（狼人杀）开始一局9人狼人杀：随机分配3狼1预1女1猎3民，生成9个玩家agent并进入第一夜。开局前自动释放上一局遗留的玩家agent。humanSeat 缺省=随机1-9（推荐）；指定0=纯agent局。你是主持人，不是玩家——开局后告诉人类打开面板、告知座位身份，游戏由引擎自动推进，你只做信息中转。详见返回值 hostGuide。仅由主持人调用。',
      parameters: {
        humanSeat: { type: 'number', description: '人类玩家座位号 1-9；缺省=随机1-9；0=纯agent局（无人类）' },
      },
      output: OUTPUT,
      timeoutMs: 600000,
      async execute(_args, exec) {
        if (game) return { ok: false, error: '已有游戏进行中，先调用 werewolf_abort 结束' }
        const hostAgent = exec.agent
        if (!hostAgent) return { ok: false, error: 'no host agent' }
        // humanSeat: 1-9=指定座位；0=纯agent局（无人类）；缺省=随机1-9
        let humanSeat = null
        if (typeof _args.humanSeat === 'number' && Number.isInteger(_args.humanSeat)) {
          if (_args.humanSeat >= 1 && _args.humanSeat <= 9) humanSeat = _args.humanSeat
          // 0 = pure agent game (humanSeat stays null)
        } else {
          humanSeat = 1 + Math.floor(Math.random() * 9) // default: random 1-9
        }
        console.log('[werewolf] humanSeat=' + humanSeat + (typeof _args.humanSeat === 'undefined' ? ' (auto-random)' : ''))
        const deck = ['wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager']
        const roles = shuffle(deck).map((role, i) => ({ seat: i + 1, role }))
        const personalities = shuffle(PERSONALITIES)
        const wolfMatesText = roles.filter((r) => r.role === 'wolf').map((r) => '玩家' + r.seat).join('、')
        game = {
          hostSessionId: hostAgent.id,
          day: 0,
          phase: 'setup',
          players: [],
          publicLog: [],
          publicEvents: [],
          voteRecord: [],
          wolfChannel: [],
          wolfOrder: [],
          wolfIdx: 0,
          wolfVotes: {},
          wolfRound: 1,
          wolfTarget: null,
          seerResults: [],
          witch: { saveAvailable: true, poisonAvailable: true, firstNight: true, savedThisNight: false },
          poisonTarget: null,
          witchLog: [],
          hunterPending: null,
          sheriff: null,
          sheriffElected: false,
          sheriffCandidates: [],
          sheriffRan: [],
          sheriffDecided: new Set(),
          sheriffVoteRound: 1,
          sheriffSpeechIdx: 0,
          sheriffSpeechOrder: [],
          sheriffTie: null,
          sheriffPass: null,
          quitSet: null,
          quitDecided: new Set(),
          speechDirection: 'right',
          speechOrder: [],
          speechIdx: 0,
          voteRound: 1,
          tieCandidates: null,
          pending: null,
          reviewCollected: {},
          reviewReport: null,
          reviewDone: false,
          knowledge: { quota: {}, window: {}, waiting: {}, offered: {} },
          win: null,
          waitStartedAt: 0,
          nudged: false,
          advancing: false,
          worldSeq: 0,
          queryCount: {},
          lastSignal: null,
          humanSeat,
          humanInbox: [],
          nightNews: [],
        }
        try {
          const released = await cleanupOldPlayers(hostAgent, exec.signal)
          game.lastSignal = exec.signal
          for (let i = 0; i < roles.length; i++) {
            const r = roles[i]
            if (humanSeat !== null && r.seat === humanSeat) {
              game.players.push({ seat: r.seat, role: r.role, agentId: null, human: true, alive: true, personality: '人类玩家', unreachable: false, deathReason: null, deathSnapshot: null, lastSeen: 0 })
              console.log('[werewolf] human seat=' + r.seat + ' role=' + r.role)
              continue
            }
            const persona = buildPersona({ seat: r.seat, role: r.role, personality: personalities[i] }, r.role === 'wolf' ? wolfMatesText : null)
            const start = await subagents.startContinuable({
              provider: 'spawn',
              label: '狼人杀-玩家' + r.seat + '-' + ROLE_NAMES[r.role],
              request: {
                prompt: text('你已加入一局9人狼人杀。游戏即将开始，请等待引擎指令。'),
                parent: hostAgent,
                persona,
                toolFilter: { allow: ['werewolf_act', 'werewolf_status', 'werewolf_ask_rule'] },
                agentOptions: { maxTokens: 8192 },
              },
              signal: exec.signal,
            })
            game.players.push({ seat: r.seat, role: r.role, agentId: start.childId, alive: true, personality: personalities[i], unreachable: false, deathReason: null, deathSnapshot: null, lastSeen: 0 })
            console.log('[werewolf] spawned seat=' + r.seat + ' role=' + r.role + ' child=' + start.childId)
          }
          const humanRole = humanSeat !== null ? roles.find((r) => r.seat === humanSeat).role : null
          // 面板 URL（从 webServer 端口动态构造，默认 3080）
          const _wsPort = ctx.get('webServer')?.port || 3080
          const panelUrl = 'http://127.0.0.1:' + _wsPort + '/werewolf/panel'
          // 公开事件不含人类席位信息（防泄露：狼 agent 不应知道人类位置）
          pushEvent('游戏开始。本局配置：3狼人、1预言家、1女巫、1猎人、3平民。' + (released ? '（已释放上一局 ' + released + ' 个玩家agent）' : ''))
          // 人类玩家指引只进自己的 inbox（deliverTo 对人类路由到 humanInbox，其他玩家不可见）
          if (humanSeat !== null) {
            const hp = game.players.find((p) => p.seat === humanSeat)
            if (hp) {
              try { await deliverTo(hp, '你坐在' + humanSeat + '号位，本局身份：' + ROLE_NAMES[humanRole] + '。请通过面板操作一切行动，面板地址：' + panelUrl + ' 。引擎会在轮到你时通知你。') } catch (e) {}
            }
          }
          // 开局知识摘要：给每个 AI 玩家投递其分区可参考的历史经验（全量一行摘要，agent 自选）
          await loadKnowledge()
          for (const p of game.players) {
            if (p.human) continue
            const sums = knowledgeSummaries(p)
            if (sums.length) {
              try {
                await deliverTo(p, '[知识库] 以下是你本局可参考的历史经验摘要（id[分区] 一句话）。你本局共有 2 次查看知识详情的权利，将在关键节点收到是否获取的询问。\n' + sums.join('\n'))
              } catch (e) { console.error('[werewolf] knowledge summary deliver error', String(e && e.message || e)) }
            }
          }
          await startNight(exec.signal)
          return { ok: true, phase: game.phase, releasedOld: released, humanSeat, roles: game.players.map((p) => ({ seat: p.seat, role: p.role, childId: p.agentId, human: !!p.human })), panelUrl, hostGuide: HOST_GUIDE.replace('{PANEL_URL}', panelUrl) }
        } catch (e) {
          console.error('[werewolf] start failed', e && e.stack ? e.stack : String(e))
          game = null
          return { ok: false, error: '开局失败: ' + (e && e.message ? e.message : String(e)) }
        }
      },
    })

    registerTool({
      name: 'werewolf_act',
      description: '（狼人杀）玩家行动。按当前阶段回复：白天发言 action=speech+text；投票 action=vote/sheriff_vote+target（投票只需座位号，无需text）；警长指定发言方向 action=direction+text=left/right；警长竞选 action=sheriff_run/sheriff_not；警上退水 action=sheriff_quit（退水）/sheriff_stay（不退水）；在线确认 action=alive（收到在线确认请求时回复）；警长出局处置警徽 action=pass_sheriff+target（传给某玩家/0=撕警徽）；狼人夜间 action=kill+target+text；预言家 action=seer+target；女巫 action=witch_save/witch_poison+target/witch_none；猎人 action=hunter+target(0不开枪)；复盘 action=review+text；知识详情 action=knowledge+text=知识ID列表（仅在收到【知识窗口】询问时可用，每局限2次每次最多2条）；跳过知识获取 action=knowledge_skip。',
      parameters: {
        action: { type: 'string', required: true, enum: ['speech', 'vote', 'kill', 'seer', 'witch_save', 'witch_poison', 'witch_none', 'hunter', 'sheriff_run', 'sheriff_not', 'sheriff_vote', 'sheriff_quit', 'sheriff_stay', 'direction', 'pass_sheriff', 'alive', 'review', 'knowledge', 'knowledge_skip'], description: '行动类型' },
        target: { type: 'number', description: '目标座位号 1-9；0 表示弃票/不开枪/撕警徽' },
        text: { type: 'string', description: '发言/狼人讨论/复盘文本；direction 填 left/right；投票与在线确认不需要 text' },
      },
      output: OUTPUT,
      timeoutMs: 120000,
      async execute(args, exec) {
        const agent = exec.agent
        if (!game) return { ok: false, error: '没有进行中的游戏' }
        game.lastSignal = exec.signal
        await checkTimeouts(exec.signal)
        if (!game) return { ok: false, error: '游戏状态已变更' }
        const player = game.players.find((p) => p.agentId === agent.id)
        if (!player) return { ok: false, error: '你不是本局玩家' }
        const act = args.action
        const target = typeof args.target === 'number' ? args.target : 0
        const t = typeof args.text === 'string' ? args.text : ''
        return await applyAction(player, act, target, t, exec.signal)
      },
    })

    registerTool({
      name: 'werewolf_status',
      description: '（狼人杀）查看当前游戏公开状态：阶段、存活玩家、公开记录；主持人可查看完整复盘报告。玩家补全上下文用（每阶段限1次）。',
      parameters: {},
      output: OUTPUT,
      async execute(_args, exec) {
        if (!game) return { ok: false, error: '没有进行中的游戏' }
        game.lastSignal = exec.signal
        await checkTimeouts(exec.signal)
        if (!game) return { ok: false, error: '游戏状态已变更' }
        const agent = exec.agent
        const player = game.players.find((p) => p.agentId === agent.id)
        const isHost = agent.id === game.hostSessionId
        const g = game
        if (player && !isHost) {
          const q = g.queryCount || {}
          if (q[player.seat]) return { ok: false, error: '本阶段你已查询过状态，请等待引擎消息' }
          q[player.seat] = 1
          return { ok: true, phase: g.phase, phaseName: PHASE_NAMES[g.phase] || g.phase, day: g.day, yourSeat: player.seat, info: visibleInfoFull(player) }
        }
        const out = {
          ok: true,
          phase: g.phase,
          phaseName: PHASE_NAMES[g.phase] || g.phase,
          day: g.day,
          alive: alivePlayers().map((p) => p.seat),
          publicEvents: g.publicEvents.slice(-20).map((e) => e.text),
          sheriff: g.sheriff,
          toolsRegistered: {
            werewolf_act: !!tools.get('werewolf_act'),
            werewolf_status: !!tools.get('werewolf_status'),
            werewolf_ask_rule: !!tools.get('werewolf_ask_rule'),
          },
        }
        if (player) out.yourSeat = player.seat
        if (isHost) {
          out.players = g.players.map((p) => ({ seat: p.seat, role: p.role, alive: p.alive }))
          out.reviewReport = g.reviewReport
        }
        return out
      },
    })

    registerTool({
      name: 'werewolf_ask_rule',
      description: '（狼人杀）查询游戏规则或指定角色的能力说明。',
      parameters: {
        role: { type: 'string', description: '可选：wolf/seer/witch/hunter/villager；缺省返回完整规则' },
      },
      output: OUTPUT,
      async execute(args) {
        const role = typeof args.role === 'string' ? args.role : ''
        if (role && ROLE_NAMES[role]) return { ok: true, role, text: '【' + ROLE_NAMES[role] + '】' + (RULE_TEXT.split('\n').find((l) => l.includes(ROLE_NAMES[role])) || RULE_TEXT) }
        return { ok: true, text: RULE_TEXT }
      },
    })

    registerTool({
      name: 'werewolf_abort',
      description: '（狼人杀）主持人终止当前游戏（调试/卡死恢复）。',
      parameters: {},
      output: OUTPUT,
      async execute(_args, exec) {
        if (!game) return { ok: false, error: '没有进行中的游戏' }
        const g = game
        game = null
        const inbox = g.humanInbox || []
        for (const p of g.players) {
          if (p.alive && !p.human) {
            try { await deliverTo(p, '游戏被主持人终止。', exec.signal) } catch (e) {}
          }
        }
        inbox.length = 0
        return { ok: true, notice: '游戏已终止' }
      },
    })

    // ── 知识库工具（父 agent/主持人用：提炼写回、查看、状态）──
    registerTool({
      name: 'werewolf_knowledge_list',
      description: '（狼人杀·知识库）主持人查看知识库条目（长期记忆）。按分区过滤：wolf/good-faction/seer/witch/hunter/villager/general；缺省全部。用于复盘提炼时做语义去重。',
      parameters: { partition: { type: 'string', description: '可选：分区名' } },
      output: OUTPUT,
      async execute(args) {
        await loadKnowledge()
        const part = typeof args.partition === 'string' ? args.partition : null
        const rows = (knowledgeStore.entries || []).filter((e) => !part || e.partition === part)
          .sort((a, b) => ((b.uses || 0) - (a.uses || 0)) || ((b.lastUsed || 0) - (a.lastUsed || 0)))
        return { ok: true, total: rows.length, caps: K_CAPS, entries: rows.map((e) => ({ id: e.id, partition: e.partition, title: e.title || deriveTitle(e), text: e.text, uses: e.uses || 0, lastUsed: e.lastUsed || 0 })) }
      },
    })

    registerTool({
      name: 'werewolf_knowledge_note',
      description: '（狼人杀·知识库）主持人写入/更新一条长期记忆知识。partition 必填（wolf/good-faction/seer/witch/hunter/villager/general）；title 为一行摘要（浏览用，缺省自动从 text 首句派生）；text 为提炼后的策略教训详情（简洁中文）。同分区同文本自动合并；超分区上限按 uses+新鲜度淘汰最旧条目。',
      parameters: {
        partition: { type: 'string', description: '分区：wolf/good-faction/seer/witch/hunter/villager/general' },
        title: { type: 'string', description: '可选：一行摘要（如"狼人悍跳必须有独立警徽流"）' },
        text: { type: 'string', description: '提炼后的策略教训详情（简洁、可执行）' },
      },
      output: OUTPUT,
      async execute(args) {
        await loadKnowledge()
        const part = typeof args.partition === 'string' ? args.partition : null
        const text = typeof args.text === 'string' ? args.text.trim() : ''
        if (!part || !K_CAPS[part]) return { ok: false, error: 'partition 无效' }
        if (!text) return { ok: false, error: 'text 不能为空' }
        const title = (typeof args.title === 'string' && args.title.trim()) || deriveTitle({ text })
        // 机械去重：同分区完全相等 → 合并（不动）
        const exact = (knowledgeStore.entries || []).find((e) => e.partition === part && e.text === text)
        if (exact) return { ok: true, id: exact.id, merged: true, total: knowledgeStore.entries.length }
        // 语义更新：父 agent 在 list 后若发现重叠，可传 text 为要覆盖的旧条目文本（省略即新增）
        const cap = K_CAPS[part]
        if (knowledgeStore.entries.length >= cap) {
          // 淘汰：uses 最少 + lastUsed 最旧
          knowledgeStore.entries.sort((a, b) => ((a.uses || 0) - (b.uses || 0)) || ((a.lastUsed || 0) - (b.lastUsed || 0)))
          const evicted = knowledgeStore.entries.shift()
          console.log('[werewolf] knowledge evicted: ' + evicted.id)
        }
        const id = 'k' + ((knowledgeStore.entries.reduce((m, e) => { const n = parseInt(String(e.id).replace(/\D/g, ''), 10); return Number.isFinite(n) && n > m ? n : m }, 0)) + 1)
        knowledgeStore.entries.push({ id, partition: part, title, text, uses: 0, lastUsed: Date.now(), createdAt: Date.now() })
        await saveKnowledge()
        return { ok: true, id, title, added: true, total: knowledgeStore.entries.length, cap }
      },
    })

    registerTool({
      name: 'werewolf_knowledge_status',
      description: '（狼人杀·知识库）查看知识库容量/条目数/当前局配额状态。',
      parameters: {},
      output: OUTPUT,
      async execute() {
        await loadKnowledge()
        const counts = {}
        for (const e of (knowledgeStore.entries || [])) counts[e.partition] = (counts[e.partition] || 0) + 1
        return {
          ok: true,
          caps: K_CAPS,
          counts,
          total: (knowledgeStore.entries || []).length,
          gameQuota: game && game.knowledge ? game.knowledge.quota : null,
        }
      },
    })

    // ── 独立面板 API（webServer 路由）：人类席位面板走纯 host HTTP，无需 client 插件 ──
    const rpcDisposers = []

    function buildUiState() {
      if (!game) return { ok: false, error: '没有进行中的游戏' }
      const g = game
      let progress = null
      if (g.phase === 'day-sheriff-run') {
        progress = { kind: 'run', decided: [...(g.sheriffDecided || [])] }
      } else if (g.phase === 'day-sheriff-quit') {
        progress = { kind: 'quit', decided: [...(g.quitDecided || [])], quit: [...(g.quitSet || [])] }
      } else if (g.phase === 'day-sheriff-vote' || g.phase === 'day-vote') {
        const vkind = g.phase === 'day-sheriff-vote' ? 'sheriff' : 'day'
        const submitted = new Set(g.voteRecord.filter((v) => v.day === g.day && v.kind === vkind).map((v) => v.voterSeat))
        progress = { kind: 'vote', submitted: [...submitted] }
      } else if (g.phase === 'review') {
        progress = { kind: 'review', submitted: Object.keys(g.reviewCollected || {}).map(Number) }
      }
      const out = {
        ok: true,
        phase: g.phase,
        phaseName: PHASE_NAMES[g.phase] || g.phase,
        day: g.day,
        alive: alivePlayers().map((p) => p.seat),
        sheriff: g.sheriff,
        humanSeat: g.humanSeat,
        waitingSeat: currentWaitSeat(),
        pendingSeats: g.pending && g.pending.seats ? [...g.pending.seats] : [],
        progress,
        wolfRound: g.wolfRound || 1,
        speechOrder: g.speechOrder || [],
        speechIdx: g.speechIdx || 0,
        sheriffCandidates: g.sheriffCandidates || [],
        sheriffSpeechOrder: g.sheriffSpeechOrder || [],
        sheriffSpeechIdx: g.sheriffSpeechIdx || 0,
        sheriffRan: g.sheriffRan || [],
        sheriffPassSeat: g.sheriffPass ? g.sheriffPass.seat : null,
        seerResults: g.seerResults || [],
        witchLog: g.witchLog || [],
        players: g.players.map((p) => ({ seat: p.seat, role: p.role, roleName: ROLE_NAMES[p.role], alive: p.alive, human: !!p.human, deathReason: p.deathReason })),
        events: g.publicEvents.map((e) => e.text),
        logs: g.publicLog.map((l) => ({ day: l.day, seat: l.seat, text: l.text })),
        votes: g.voteRecord.map((v) => ({ day: v.day, kind: v.kind, voter: v.voterSeat, target: v.targetSeat })),
        reviewReport: g.reviewReport,
      }
      if (g.humanSeat !== null && g.humanSeat !== undefined) {
        const hp = playerBySeat(g.humanSeat)
        if (hp) {
          const pendingVote = !!(g.pending && g.pending.seats && g.pending.seats.has(hp.seat))
          out.human = {
            yourSeat: hp.seat,
            yourRole: ROLE_NAMES[hp.role],
            yourAlive: hp.alive,
            yourDeathReason: hp.deathReason,
            info: visibleInfoFull(hp),
            inbox: g.humanInbox.map((m) => ({ seq: m.seq, text: m.text, kind: m.kind || 'info' })),
            waitingYou: currentWaitSeat() === hp.seat || pendingVote,
          }
          out.yourSeat = out.human.yourSeat
          out.yourRole = out.human.yourRole
          out.yourAlive = out.human.yourAlive
          out.inbox = out.human.inbox
          out.waitingYou = out.human.waitingYou
          if (hp.role === 'wolf') {
            out.wolfMates = g.players.filter((p) => p.role === 'wolf' && p.seat !== hp.seat).map((p) => p.seat)
          }
        }
      }
      return out
    }

    async function handleHumanAct(args) {
      if (!game) return { ok: false, error: '没有进行中的游戏' }
      if (game.humanSeat === null || game.humanSeat === undefined) return { ok: false, error: '本局没有人类席位' }
      const player = playerBySeat(game.humanSeat)
      if (!player || !player.human) return { ok: false, error: '人类席位无效' }
      await checkTimeouts(null)
      if (!game) return { ok: false, error: '游戏状态已变更' }
      const act = args && args.action
      const target = typeof args.target === 'number' ? args.target : 0
      const t = typeof args.text === 'string' ? args.text : ''
      return await applyAction(player, act, target, t, null)
    }

    async function handleAbort() {
      if (!game) return { ok: false, error: '没有进行中的游戏' }
      const g = game
      game = null
      const inbox = g.humanInbox || []
      for (const p of g.players) {
        if (p.alive && !p.human) {
          try { await deliverTo(p, '游戏被主持人终止。', null) } catch (e) {}
        }
      }
      inbox.length = 0
      return { ok: true, notice: '游戏已终止' }
    }

    // ── Client RPC（已移除：harness.handle 为动态沙箱 builtin，正式插件不可用）──
    // buildUiState / handleHumanAct / handleAbort 保留，供下方 webServer HTTP 路由（/werewolf/api/*）调用；
    // 人类席位面板 = /werewolf/panel（panel.html 走 /werewolf/api/*，纯 host HTTP，无需 client 插件）。

    const _ws = ctx.get('webServer')
    if (_ws) {
      const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }
      try {
        rpcDisposers.push(_ws.register({
          kind: 'exact',
          path: '/werewolf/api/state',
          handler: async (req, res) => json(res, 200, { ok: true, state: buildUiState() }),
        }))
      } catch (e) { console.log('[wwdev] state route failed: ' + String(e && e.message || e)) }
      try {
        rpcDisposers.push(_ws.register({
          kind: 'exact',
          path: '/werewolf/api/act',
          handler: async (req, res) => {
            let body = ''
            for await (const chunk of req) body += chunk
            let args = {}
            try { args = JSON.parse(body || '{}') } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }) }
            json(res, 200, await handleHumanAct(args))
          },
        }))
      } catch (e) { console.log('[wwdev] act route failed: ' + String(e && e.message || e)) }
      try {
        rpcDisposers.push(_ws.register({
          kind: 'exact',
          path: '/werewolf/api/abort',
          handler: async (req, res) => json(res, 200, await handleAbort()),
        }))
      } catch (e) { console.log('[wwdev] abort route failed: ' + String(e && e.message || e)) }
      try {
        rpcDisposers.push(_ws.register({
          kind: 'exact',
          path: '/werewolf/panel',
          handler: async (req, res) => {
            try {
              const fs = ctx.get('fs')
              const t = await fs.resolve(PLUGIN_DIR + '/ui/panel.html', { cwd: PLUGIN_DIR })
              const html = await fs.readText(t)
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
              res.end(html)
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
              res.end('panel load failed: ' + String(e && e.message || e))
            }
          },
        }))
      } catch (e) { console.log('[wwdev] panel route failed: ' + String(e && e.message || e)) }
    }

    // ═══ 素材管线（合并自 archive/dev/wwim6-assets.host.js）：读图/生图/状态 + /werewolf-assets 静态路由 ═══
    const CFG_PATH = PLUGIN_DIR + '/image-config.json'
    const ASSET_DIR = PLUGIN_DIR + '/ui/assets'
    const TMP_DIR = PLUGIN_DIR + '/.ww-tmp'

    const HELPER = "const fs=require('node:fs');const path=require('node:path');\nconst p=JSON.parse(process.env.WW_ARGS||'{}');\n(async()=>{const out={ok:false,status:0,error:''};\ntry{\nlet init={method:p.mode==='dl'?'GET':'POST',headers:p.headers||{}};\nlet body=p.body||null;\nif(p.mode==='vision'){const b64=fs.readFileSync(p.imagePath).toString('base64');\nbody={model:p.model,messages:[{role:'user',content:[{type:'text',text:p.question},{type:'image_url',image_url:{url:'data:'+p.mime+';base64,'+b64}}]}],temperature:0.2};}\nif(body)init.body=JSON.stringify(body);\nconst res=await fetch(p.url,init);out.status=res.status;\nconst buf=Buffer.from(await res.arrayBuffer());\nif(p.mode==='dl'){if(res.ok){fs.mkdirSync(path.dirname(p.outFile),{recursive:true});fs.writeFileSync(p.outFile,buf);}\nout.ok=res.ok;out.saved=res.ok?p.outFile:null;out.bytes=buf.length;}\nelse{out.ok=res.ok;out.text=buf.toString('utf8').slice(0,20000);}}\ncatch(e){out.error=String(e&&e.message||e);}\nfs.mkdirSync(path.dirname(p.resFile),{recursive:true});\nfs.writeFileSync(p.resFile,JSON.stringify(out));})();"

    async function loadConfig() {
      const fs = ctx.get('fs')
      if (!fs) return {}
      try {
        const t = await fs.resolve(CFG_PATH, { cwd: PLUGIN_DIR })
        const text = await fs.readText(t)
        return JSON.parse(text) || {}
      } catch (e) {
        return { _err: 'config read: ' + String(e && e.message || e) }
      }
    }

    async function nodeRun(op) {
      const sub = ctx.get('subprocess')
      const fs = ctx.get('fs')
      if (!sub || !fs) return { ok: false, error: 'subprocess/fs service unavailable' }
      const resFile = TMP_DIR + '/res_' + Date.now() + '_' + Math.floor(Math.random() * 1e6) + '.json'
      try {
        const node = await sub.resolveExecutable('node')
        const h = sub.spawn({
          argv: [node, '-e', HELPER],
          cwd: PLUGIN_DIR,
          env: { WW_ARGS: JSON.stringify(Object.assign({}, op, { resFile })) },
          stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
          graceMs: 120000,
        })
        await h.done
      } catch (e) {
        return { ok: false, error: 'spawn: ' + String(e && e.message || e) }
      }
      try {
        const t = await fs.resolve(resFile, { cwd: TMP_DIR })
        const text = await fs.readText(t)
        return JSON.parse(text)
      } catch (e) {
        return { ok: false, error: 'read res: ' + String(e && e.message || e) }
      }
    }

    const OUT = { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] }

    registerTool({
      name: 'werewolf_look',
      description: '（狼人杀素材）读图：用视觉模型（默认智谱 GLM-4V-Flash，免费）分析一张本地图片，返回文字描述。用于调研主流形象/风格。需要 werewolf-engine/image-config.json 配置 apiKey。',
      parameters: {
        image: { type: 'string', description: '本地图片文件路径（绝对路径）', required: true },
        question: { type: 'string', description: '可选：针对图片的具体问题；缺省为详细描述内容与风格' },
      },
      output: OUT,
      async execute(args) {
        const cfg = await loadConfig()
        if (!cfg.apiKey) return { ok: false, error: '未配置 apiKey：编辑 image-config.json（插件根目录下）填入智谱 API Key（https://open.bigmodel.cn 注册）' }
        try {
          const mime = /\.jpe?g$/i.test(args.image) ? 'image/jpeg' : /\.webp$/i.test(args.image) ? 'image/webp' : /\.gif$/i.test(args.image) ? 'image/gif' : 'image/png'
          const q = args.question || '请详细描述这张图片的内容和视觉风格（主体、配色、构图、美术风格、氛围），用中文回答。'
          const r = await nodeRun({
            mode: 'vision',
            imagePath: args.image,
            mime,
            question: q,
            model: cfg.visionModel || 'glm-4v-flash',
            url: cfg.baseURL.replace(/\/$/, '') + '/chat/completions',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
          })
          if (!r.ok) return { ok: false, error: '视觉模型调用失败: HTTP ' + r.status + ' ' + String(r.text || r.error).slice(0, 500) }
          try {
            const j = JSON.parse(r.text)
            const content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ''
            return { ok: true, image: args.image, description: content }
          } catch (e) {
            return { ok: false, error: '解析响应失败: ' + r.text.slice(0, 500) }
          }
        } catch (e) {
          return { ok: false, error: String(e && e.message || e) }
        }
      },
    })

    registerTool({
      name: 'werewolf_draw',
      description: '（狼人杀素材）生图：用文生图模型（默认智谱 CogView-3-Flash，免费）生成图片，保存到 ui/assets/ 并通过 /werewolf-assets/ 静态路由提供，可反复复用。需要 image-config.json 配置 apiKey。',
      parameters: {
        prompt: { type: 'string', description: '图片描述（中文即可，越具体越好：主体、风格、配色、构图、氛围）', required: true },
        name: { type: 'string', description: '可选：文件名（不含扩展名）；缺省自动生成时间戳名；同名覆盖' },
        size: { type: 'string', description: '可选：尺寸 1024x1024 / 768x1344 / 1344x768' },
      },
      output: OUT,
      async execute(args) {
        const cfg = await loadConfig()
        if (!cfg.apiKey) return { ok: false, error: '未配置 apiKey：编辑 image-config.json（插件根目录下）填入智谱 API Key（https://open.bigmodel.cn 注册）' }
        try {
          const base = cfg.baseURL.replace(/\/$/, '')
          const r = await nodeRun({
            mode: 'json',
            url: base + '/images/generations',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
            body: { model: cfg.drawModel || 'cogview-3-flash', prompt: args.prompt, size: args.size || cfg.drawSize || '1024x1024' },
          })
          if (!r.ok) return { ok: false, error: '生图失败: HTTP ' + r.status + ' ' + String(r.text || r.error).slice(0, 500) }
          const j = JSON.parse(r.text)
          const url = j.data && j.data[0] && (j.data[0].url || j.data[0].b64_json)
          if (!url) return { ok: false, error: '生图响应无图片: ' + r.text.slice(0, 500) }
          const name = (args.name || 'ww_' + Date.now()).replace(/[^\w\-.]/g, '_')
          const file = cfg.assetDir + '/' + name + '.png'
          const dl = await nodeRun({ mode: 'dl', url: String(url), headers: {}, outFile: file })
          if (!dl.ok) return { ok: false, error: '图片下载失败: HTTP ' + dl.status + ' ' + String(dl.error || '') }
          return { ok: true, file: file, url: '/werewolf-assets/' + name + '.png', prompt: args.prompt, bytes: dl.bytes }
        } catch (e) {
          return { ok: false, error: String(e && e.message || e) }
        }
      },
    })

    registerTool({
      name: 'werewolf_assets_status',
      description: '（狼人杀素材）查看图片能力状态：配置、服务可用性、node 子进程路径。',
      parameters: {},
      output: OUT,
      async execute() {
        const cfg = await loadConfig()
        const sub = ctx.get('subprocess')
        let nodePath = null, nodeErr = null
        if (sub) { try { nodePath = await sub.resolveExecutable('node') } catch (e) { nodeErr = String(e && e.message || e) } }
        return {
          ok: true,
          config: { apiKeySet: !!(cfg.apiKey), baseURL: cfg.baseURL, visionModel: cfg.visionModel, drawModel: cfg.drawModel, assetDir: cfg.assetDir, configError: cfg._err || null },
          services: { subprocess: !!ctx.get('subprocess'), fs: !!ctx.get('fs'), webServer: !!ctx.get('webServer') },
          node: nodePath || nodeErr,
        }
      },
    })

    const _wsAssets = ctx.get('webServer')
    if (_wsAssets) {
      try {
        rpcDisposers.push(_wsAssets.register({
          kind: 'prefix',
          path: '/werewolf-assets',
          handler: async (req, res) => {
            try {
              const raw = String(req.url || '').split('?')[0]
              const name = raw.replace(/^\/werewolf-assets\//, '')
              if (!name || name.indexOf('..') >= 0 || name.indexOf('\\') >= 0) { res.writeHead(400); res.end('bad request'); return }
              const fs = ctx.get('fs')
              const t = await fs.resolve(ASSET_DIR + '/' + name, { cwd: PLUGIN_DIR })
              const bytes = await fs.readBytes(t, undefined, 30 * 1024 * 1024)
              const ext = name.split('.').pop().toLowerCase()
              const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/png'
              res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' })
              res.end(bytes)
            } catch (e) {
              res.writeHead(404); res.end('not found')
            }
          },
        }))
      } catch (e) {
        console.log('[werewolf-assets] route register failed: ' + String(e && e.message || e))
      }
    }

    const timer = ctx.get('timer')
    let timerDisposer = null
    if (timer) {
      timerDisposer = timer.interval(() => { checkTimeouts(null).catch(() => {}) }, 30000)
      console.log('[werewolf] heartbeat timer active')
    } else {
      console.log('[werewolf] heartbeat timer unavailable')
    }
    console.log('[werewolf] plugin v33-solidified active (dev full + assets + panel)')
    return () => {
      for (const d of disposers) d()
      for (const d of rpcDisposers) d()
      if (timerDisposer) timerDisposer()
      console.log('[werewolf] plugin disposed')
    }
  },
}