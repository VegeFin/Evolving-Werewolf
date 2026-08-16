// 狼人杀引擎 v21（were-1 / pkg-23）Host 端源码存档
// 来源：cordis_inspect_self('were-1','pkg-23') 自动导出，原样保留动态版（含 harness.defineTool/registerTool 沙箱 builtin）
// 用途：对照审查 / 回滚基准；固化版见 ../lib/index.js
return {
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
      '狼人：每晚与队友按顺序讨论并共同选择击杀一名玩家；狼人互相知道身份，刀口信息只有狼人和女巫知道。',
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
    const ACTION_NOTE = '\n\n【必须行动】请调用 werewolf_act 工具提交本轮行动（直接输出文本无效，不会被记录）。'
    const ALIVE_MSG = '[在线确认] 请立即用 werewolf_act 回复：action=alive（确认你在线并等待引擎指令）。你的发言/投票会在轮到你时另行通知。' + ACTION_NOTE

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

    function keepAliveQuiet(signal) {
      for (const p of alivePlayers()) {
        if ((p.role !== 'villager' && p.role !== 'hunter') || p.unreachable) continue
        deliverTo(p, ALIVE_MSG, signal).then(() => {}).catch(() => {})
      }
    }

    async function deliverTo(player, content, signal) {
      if (!player || !player.agentId) return false
      const parent = agents.get(game.hostSessionId)
      let useSignal = (signal && typeof signal.aborted === 'boolean' && !signal.aborted) ? signal : null
      if (!useSignal && game.lastSignal && typeof game.lastSignal.aborted === 'boolean' && !game.lastSignal.aborted) useSignal = game.lastSignal
      if (parent && useSignal) {
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
      console.error('[werewolf] deliver pending: no valid signal seat=' + player.seat + ' phase=' + game.phase)
      return false
    }

    function currentWaitSeat() {
      const g = game
      switch (g.phase) {
        case 'day-speech': return g.speechOrder && g.speechIdx < g.speechOrder.length ? g.speechOrder[g.speechIdx] : null
        case 'day-sheriff-speech': return g.sheriffCandidates ? g.sheriffCandidates[g.sheriffSpeechIdx] : null
        case 'day-sheriff-quit': return g.quitOrder ? g.quitOrder[g.quitIdx] : null
        case 'day-sheriff-run': return g.sheriffOrder ? g.sheriffOrder[g.sheriffIdx] : null
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
          for (const l of unseenWolf) lines.push('- 玩家' + l.seat + ': ' + l.text)
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
        for (const l of g.wolfChannel) lines.push('- 玩家' + l.seat + ': ' + l.text)
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
      for (const l of g.wolfChannel) lines.push('狼' + l.seat + '：' + l.text)
      const picks = Object.keys(g.wolfVotes).map((s) => '玩家' + s + '→' + '玩家' + g.wolfVotes[s]).join('，')
      return (lines.length ? lines.join('\n') : '（暂无发言）') + '\n当前意向：' + (picks || '（尚未有人选择）')
    }

    async function skipCurrent(signal) {
      const g = game
      if (!g) return
      if (g.advancing) return
      g.advancing = true
      try {
        const skipped = currentWaitSeat()
        console.log('[werewolf] skip current, phase=' + g.phase + (skipped ? ' seat=' + skipped : ''))
        if (skipped) pushEvent('玩家' + skipped + ' 长时间未行动，本轮按弃权处理。')
        switch (g.phase) {
          case 'day-speech': await nextSpeech(signal); break
          case 'day-direct': pushEvent('警长未指定方向，按随机顺序发言。'); await daySpeechTurn(signal); break
          case 'sheriff-pass': await resolveSheriffPass(g.sheriffPass.seat, 0, signal); break
          case 'night-wolves': await nextWolf(signal); break
          case 'night-seer': await witchTurn(signal); break
          case 'night-witch': await nightSettle(signal); break
          case 'night-hunter': g.hunterPending = null; pushEvent('猎人未回应，视为不开枪。'); await afterDeath(signal, 'day'); break
          case 'day-hunter': g.hunterPending = null; pushEvent('猎人未回应，视为不开枪。'); await afterDeath(signal, 'night'); break
          case 'day-sheriff-run': await nextSheriffRun(signal); break
          case 'day-sheriff-speech': await sheriffSpeechTurn(signal); break
          case 'day-sheriff-quit': await nextSheriffQuit(signal); break
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
      try {
        const ok = await deliverTo(sher, visibleInfoDelta(sher) + '\n\n[警长] 请指定今天的发言方向：回复：action=direction, text=left（从你左边的玩家开始）或 text=right（从你右边的玩家开始）。' + ACTION_NOTE, signal)
        if (!ok && sher.unreachable) await skipCurrent(signal)
      } catch (e) { console.error('[werewolf] dir error', e && e.message ? e.message : String(e)); await skipCurrent(signal) }
    }

    // 警长死亡后的警徽处置：传给存活玩家或撕掉
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

    // 出局后续：猎人开枪 or 清空 pending
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
        pushEvent('玩家' + seat + '出局。')
      } else {
        pushEvent('玩家' + seat + '出局（' + reasonText + '）。')
      }
      await deliverTo(p, '你出局了（' + reasonText + '）。信息冻结，你将不再收到游戏信息，请等待游戏结束后的复盘。', signal)
      // 警长死亡：先处置警徽
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
      markWait()
      await nextWolf(signal)
    }

    async function nextWolf(signal) {
      while (game.wolfIdx < game.wolfOrder.length && game.wolfVotes[game.wolfOrder[game.wolfIdx]] !== undefined) game.wolfIdx++
      if (game.wolfIdx < game.wolfOrder.length) {
        const p = playerBySeat(game.wolfOrder[game.wolfIdx])
        if (!p) { game.wolfIdx++; await nextWolf(signal); return }
        const roundText = game.wolfRound === 1
          ? '[夜间·狼人讨论] 轮到你发言并选择刀人目标。\n当前狼人讨论：\n' + wolfDiscussionText() + '\n回复：action=kill, target=座位号, text=发言。'
          : '[夜间·狼人确认] 第一轮意向未统一，轮到你确认或改票。\n当前狼人讨论：\n' + wolfDiscussionText() + '\n回复：action=kill, target=座位号, text=补充意见。'
        markWait()
        try {
          const ok = await deliverTo(p, visibleInfoDelta(p) + '\n\n' + roundText + ACTION_NOTE, signal)
          if (!ok && p.unreachable) await skipCurrent(signal)
        } catch (e) { console.error('[werewolf] nextWolf error', e && e.message ? e.message : String(e)); await skipCurrent(signal) }
        return
      }
      const votes = Object.values(game.wolfVotes).filter((t) => t > 0)
      const distinct = new Set(votes)
      if (game.wolfRound === 1 && distinct.size > 1 && game.wolfOrder.length > 1) {
        pushEvent('狼人第一轮意向未统一，进入第二轮确认。')
        game.wolfRound = 2
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
      await seerTurn(signal)
    }

    async function seerTurn(signal) {
      const seer = aliveByRole('seer')[0]
      if (!seer) { await witchTurn(signal); return }
      game.phase = 'night-seer'
      markWait()
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
        const ok = await deliverTo(witch, visibleInfoDelta(witch) + '\n\n' + msg + ACTION_NOTE, signal)
        if (!ok && witch.unreachable) await skipCurrent(signal)
      } catch (e) { console.error('[werewolf] witch error', e && e.message ? e.message : String(e)); await skipCurrent(signal) }
    }

    async function nightSettle(signal) {
      const deaths = []
      if (game.wolfTarget && !game.witch.savedThisNight) deaths.push(game.wolfTarget)
      if (game.poisonTarget) deaths.push(game.poisonTarget)
      const seen = {}
      const unique = []
      for (const d of deaths) if (!seen[d]) { seen[d] = true; unique.push(d) }
      if (unique.length === 0) {
        pushEvent('平安夜。')
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
      const sherAlive = game.sheriff && playerBySeat(game.sheriff) && playerBySeat(game.sheriff).alive
      if (game.day === 1 && !game.sheriffElected) {
        await sheriffRunTurn(signal)
      } else if (sherAlive) {
        await sheriffDirectionTurn(signal)
      } else {
        await daySpeechTurn(signal)
      }
    }

    async function sheriffRunTurn(signal) {
      game.phase = 'day-sheriff-run'
      game.sheriffOrder = randomOrder(alivePlayers().map((p) => p.seat))
      game.sheriffIdx = 0
      game.sheriffCandidates = []
      game.sheriffRan = []
      game.sheriffVoteRound = 1
      const p = playerBySeat(game.sheriffOrder[0])
      if (!p) { game.sheriffIdx++; await nextSheriffRun(signal); return }
      markWait()
      try {
        const ok = await deliverTo(p, visibleInfoDelta(p) + '\n\n[警长竞选] 是否上警竞选警长？回复：action=sheriff_run（上警）/ action=sheriff_not（不上警）。' + ACTION_NOTE, signal)
        if (!ok && p.unreachable) await skipCurrent(signal)
      } catch (e) { console.error('[werewolf] sheriffRun error', e && e.message ? e.message : String(e)); await skipCurrent(signal) }
    }

    async function nextSheriffRun(signal) {
      game.sheriffIdx++
      if (game.sheriffIdx < game.sheriffOrder.length) {
        const p = playerBySeat(game.sheriffOrder[game.sheriffIdx])
        if (!p) { game.sheriffIdx++; await nextSheriffRun(signal); return }
        markWait()
        try {
          const ok = await deliverTo(p, visibleInfoDelta(p) + '\n\n[警长竞选] 是否上警竞选警长？回复：action=sheriff_run / action=sheriff_not。' + ACTION_NOTE, signal)
          if (!ok && p.unreachable) await skipCurrent(signal)
        } catch (e) { console.error('[werewolf] nextSheriffRun error', e && e.message ? e.message : String(e)); await skipCurrent(signal) }
        return
      }
      if (game.sheriffCandidates.length === 0) {
        pushEvent('无人上警，本局没有警长。')
        game.sheriffElected = true
        await daySpeechTurn(signal)
        return
      }
      pushEvent('上警竞选者：' + game.sheriffCandidates.map((s) => '玩家' + s).join('、') + '。')
      game.sheriffSpeechIdx = 0
      await sheriffSpeechTurn(signal)
    }

    async function sheriffSpeechTurn(signal) {
      game.phase = 'day-sheriff-speech'
      if (game.sheriffSpeechIdx < game.sheriffCandidates.length) {
        const p = playerBySeat(game.sheriffCandidates[game.sheriffSpeechIdx])
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

    async function sheriffQuitTurn(signal) {
      game.phase = 'day-sheriff-quit'
      game.quitOrder = game.sheriffCandidates.slice()
      game.quitIdx = 0
      game.quitSet = new Set()
      const p = playerBySeat(game.quitOrder[0])
      if (!p) { game.quitIdx++; await nextSheriffQuit(signal); return }
      markWait()
      try {
        const ok = await deliverTo(p, visibleInfoDelta(p) + '\n\n[警上退水] 警上发言结束。是否继续竞选警长？回复：action=sheriff_stay（不退水，继续竞选，不投警下票）/ action=sheriff_quit（退水，放弃竞选且不能投警下票）。' + ACTION_NOTE, signal)
        if (!ok && p.unreachable) await skipCurrent(signal)
      } catch (e) { console.error('[werewolf] quit error', e && e.message ? e.message : String(e)); await skipCurrent(signal) }
    }

    async function nextSheriffQuit(signal) {
      game.quitIdx++
      if (game.quitIdx < game.quitOrder.length) {
        const p = playerBySeat(game.quitOrder[game.quitIdx])
        if (!p) { game.quitIdx++; await nextSheriffQuit(signal); return }
        markWait()
        try {
          const ok = await deliverTo(p, visibleInfoDelta(p) + '\n\n[警上退水] 是否继续竞选警长？回复：action=sheriff_stay（不退水）/ action=sheriff_quit（退水）。' + ACTION_NOTE, signal)
          if (!ok && p.unreachable) await skipCurrent(signal)
        } catch (e) { console.error('[werewolf] nextQuit error', e && e.message ? e.message : String(e)); await skipCurrent(signal) }
        return
      }
      const quitList = [...game.quitSet]
      const stayed = game.quitOrder.filter((s) => !game.quitSet.has(s))
      pushEvent('警上退水结果：' + (quitList.length ? '玩家' + quitList.join('、') + ' 退水；' : '无人退水；') + '继续竞选：' + (stayed.length ? '玩家' + stayed.join('、') : '（无人）') + '。')
      game.sheriffCandidates = stayed
      if (stayed.length === 0) {
        pushEvent('所有候选人退水，本局没有警长。')
        game.sheriffElected = true
        await daySpeechTurn(signal)
        return
      }
      await sheriffVoteTurn(signal)
    }

    async function sheriffVoteTurn(signal) {
      game.phase = 'day-sheriff-vote'
      game.pending = { kind: 'sheriff-vote', seats: new Set() }
      const voters = alivePlayers().filter((p) => !game.sheriffRan.includes(p.seat))
      for (const p of voters) game.pending.seats.add(p.seat)
      if (game.pending.seats.size === 0) {
        game.sheriff = game.sheriffCandidates[0]
        pushEvent('所有存活玩家都是候选人，玩家' + game.sheriff + '当选警长。')
        game.sheriffElected = true
        await sheriffDirectionTurn(signal)
        return
      }
      const candText = game.sheriffCandidates.map((c) => '玩家' + c).join('、')
      const voterText = '警下投票者：' + voters.map((p) => '玩家' + p.seat).join('、') + '。'
      markWait()
      for (const p of voters) {
        const voteText = (game.sheriffVoteRound === 2
          ? '\n\n[警下投票·第二轮] 第一轮平票。请只能在候选人 ' + candText + ' 中选择（或0弃票）：action=sheriff_vote, target=座位号。'
          : '\n\n[警下投票] 警长候选人是：' + candText + '。' + voterText + '请投票：action=sheriff_vote, target=候选人座位号（0=弃票）。')
        try {
          const ok = await deliverTo(p, visibleInfoDelta(p) + voteText + ACTION_NOTE, signal)
          if (!ok && p.unreachable && game.pending) game.pending.seats.delete(p.seat)
        } catch (e) { console.error('[werewolf] sheriffVote deliver error', e && e.message ? e.message : String(e)) }
      }
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
        daySpeechTurn(signal)
        return
      }
      game.sheriff = top
      pushEvent('玩家' + top + ' 当选警长。')
      game.sheriffElected = true
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

    async function dayVoteTurn(signal) {
      game.phase = 'day-vote'
      if (game.voteRound === 1) game.pending = { kind: 'day-vote', seats: new Set() }
      const voters = alivePlayers()
      for (const p of voters) game.pending.seats.add(p.seat)
      if (voters.length === 0) { await afterDeath(signal, 'night'); return }
      markWait()
      for (const p of voters) {
        let voteText
        if (game.voteRound === 2) {
          voteText = '\n\n[白天投票·第二轮] 第一轮平票，只能在玩家' + (game.tieCandidates || []).map((s) => s).join('、') + ' 中选择（或0弃票）：action=vote, target=座位号。'
        } else {
          voteText = '\n\n[白天投票] 请投票放逐一名玩家。回复：action=vote, target=座位号（0=弃票）。投票信息将公开，警长按1.5票计。'
        }
        try {
          const ok = await deliverTo(p, visibleInfoDelta(p) + voteText + ACTION_NOTE, signal)
          if (!ok && p.unreachable && game.pending) game.pending.seats.delete(p.seat)
        } catch (e) { console.error('[werewolf] dayVote deliver error', e && e.message ? e.message : String(e)) }
      }
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
    }

    const disposers = []
    function registerTool(def) {
      const tool = harness.defineTool(def)
      disposers.push(harness.registerTool(ctx, tool))
    }

    const OUTPUT = { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] }

    registerTool({
      name: 'werewolf_start',
      description: '（狼人杀）开始一局9人狼人杀：随机分配3狼1预1女1猎3民，生成9个玩家agent并进入第一夜。开局前自动释放上一局遗留的玩家agent。仅由主持人调用。',
      parameters: {},
      output: OUTPUT,
      timeoutMs: 600000,
      async execute(_args, exec) {
        if (game) return { ok: false, error: '已有游戏进行中，先调用 werewolf_abort 结束' }
        const hostAgent = exec.agent
        if (!hostAgent) return { ok: false, error: 'no host agent' }
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
          sheriffVoteRound: 1,
          sheriffTie: null,
          sheriffPass: null,
          quitOrder: [],
          quitIdx: 0,
          quitSet: null,
          speechDirection: 'right',
          speechOrder: [],
          speechIdx: 0,
          voteRound: 1,
          tieCandidates: null,
          pending: null,
          reviewCollected: {},
          reviewReport: null,
          reviewDone: false,
          win: null,
          waitStartedAt: 0,
          nudged: false,
          advancing: false,
          worldSeq: 0,
          queryCount: {},
          lastSignal: null,
          humanSeat: null,
        }
        try {
          const released = await cleanupOldPlayers(hostAgent, exec.signal)
          game.lastSignal = exec.signal
          for (let i = 0; i < roles.length; i++) {
            const r = roles[i]
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
          pushEvent('游戏开始。本局配置：3狼人、1预言家、1女巫、1猎人、3平民。' + (released ? '（已释放上一局 ' + released + ' 个玩家agent）' : ''))
          await startNight(exec.signal)
          return { ok: true, phase: game.phase, releasedOld: released, roles: game.players.map((p) => ({ seat: p.seat, role: p.role, childId: p.agentId })) }
        } catch (e) {
          console.error('[werewolf] start failed', e && e.stack ? e.stack : String(e))
          game = null
          return { ok: false, error: '开局失败: ' + (e && e.message ? e.message : String(e)) }
        }
      },
    })

    registerTool({
      name: 'werewolf_act',
      description: '（狼人杀）玩家行动。按当前阶段回复：白天发言 action=speech+text；投票 action=vote/sheriff_vote+target（投票只需座位号，无需text）；警长指定发言方向 action=direction+text=left/right；警长竞选 action=sheriff_run/sheriff_not；警上退水 action=sheriff_quit（退水）/sheriff_stay（不退水）；在线确认 action=alive（收到在线确认请求时回复）；警长出局处置警徽 action=pass_sheriff+target（传给某玩家/0=撕警徽）；狼人夜间 action=kill+target+text；预言家 action=seer+target；女巫 action=witch_save/witch_poison+target/witch_none；猎人 action=hunter+target(0不开枪)；复盘 action=review+text。',
      parameters: {
        action: { type: 'string', required: true, enum: ['speech', 'vote', 'kill', 'seer', 'witch_save', 'witch_poison', 'witch_none', 'hunter', 'sheriff_run', 'sheriff_not', 'sheriff_vote', 'sheriff_quit', 'sheriff_stay', 'direction', 'pass_sheriff', 'alive', 'review'], description: '行动类型' },
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
        const signal = exec.signal
        const act = args.action
        const target = typeof args.target === 'number' ? args.target : 0
        const t = typeof args.text === 'string' ? args.text : ''

        if (act === 'alive') {
          return { ok: true, notice: '在线确认已收到，等待引擎指令' }
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
          await daySpeechTurn(signal)
          return { ok: true, notice: '发言方向已指定：' + (t === 'left' ? '从你左边开始' : '从你右边开始') }
        }

        if (game.phase === 'night-wolves' && player.role === 'wolf') {
          if (act !== 'kill') return { ok: false, error: '请用 kill 选择刀人目标' }
          if (game.wolfVotes[player.seat] !== undefined) return { ok: false, error: '你已经提交过刀人目标，等待其他狼人' }
          if (!Number.isInteger(target) || target < 1 || target > 9) return { ok: false, error: 'target 必须是 1-9' }
          if (target === player.seat) return { ok: false, error: '不能刀自己' }
          const tp = playerBySeat(target)
          if (!tp.alive) return { ok: false, error: '目标已出局' }
          if (t.trim()) { bump(); game.wolfChannel.push({ day: game.day, seat: player.seat, text: t, seq: game.worldSeq }) }
          game.wolfVotes[player.seat] = target
          game.wolfIdx++
          if (game.wolfIdx < game.wolfOrder.length) {
            const n = playerBySeat(game.wolfOrder[game.wolfIdx])
            if (!n) { await nextWolf(signal); return { ok: true, notice: '狼人行动已记录' } }
            const roundText = game.wolfRound === 1
              ? '[夜间·狼人讨论] 轮到你发言并选择刀人目标。\n当前狼人讨论：\n' + wolfDiscussionText() + '\n回复：action=kill, target=座位号, text=发言。'
              : '[夜间·狼人确认] 第一轮意向未统一，轮到你确认或改票。\n当前狼人讨论：\n' + wolfDiscussionText() + '\n回复：action=kill, target=座位号, text=补充意见。'
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
          if (game.sheriffOrder[game.sheriffIdx] !== player.seat) return { ok: false, error: '现在不是你的上警轮次' }
          if (act === 'sheriff_run' || act === 'sheriff_not') {
            if (act === 'sheriff_run') { game.sheriffCandidates.push(player.seat); game.sheriffRan.push(player.seat) }
            await nextSheriffRun(signal)
            return { ok: true, notice: act === 'sheriff_run' ? '你已上警' : '你未上警' }
          }
          return { ok: false, error: '请用 sheriff_run / sheriff_not' }
        }
        if (game.phase === 'day-sheriff-speech') {
          if (game.sheriffCandidates[game.sheriffSpeechIdx] !== player.seat) return { ok: false, error: '现在不是你的发言轮次' }
          if (act !== 'speech' || !t.trim()) return { ok: false, error: '请用 speech + text 发言' }
          pushLog(player.seat, '[警上]' + t)
          game.sheriffSpeechIdx++
          await sheriffSpeechTurn(signal)
          return { ok: true, notice: '警上发言已记录' }
        }
        if (game.phase === 'day-sheriff-quit') {
          if (game.quitOrder[game.quitIdx] !== player.seat) return { ok: false, error: '现在不是你的退水轮次' }
          if (act === 'sheriff_quit') game.quitSet.add(player.seat)
          else if (act !== 'sheriff_stay') return { ok: false, error: '请用 sheriff_quit（退水）/ sheriff_stay（不退水）' }
          await nextSheriffQuit(signal)
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
        for (const p of g.players) {
          if (p.alive) await deliverTo(p, '游戏被主持人终止。', exec.signal)
        }
        return { ok: true, notice: '游戏已终止' }
      },
    })

    const timer = ctx.get('timer')
    if (timer) {
      timer.interval(() => { checkTimeouts(null).catch(() => {}) }, 30000)
      console.log('[werewolf] heartbeat timer active')
    } else {
      console.log('[werewolf] heartbeat timer unavailable')
    }
    console.log('[werewolf] plugin v21 active (sheriff pass/tear)')
    return () => {
      for (const d of disposers) d()
      console.log('[werewolf] plugin disposed')
    }
  },
}
