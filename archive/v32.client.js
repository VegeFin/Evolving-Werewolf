return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const disposers = []
    const cssDisposer = styles.insert('.ww-panel{display:flex;flex-direction:column;gap:0;border:1px solid rgba(128,128,128,0.4);border-radius:12px;padding:8px 10px;margin:4px 0;background:rgba(0,0,0,0.25);font-size:13px;color:inherit;height:560px;overflow:hidden;box-sizing:border-box}.ww-err{color:#ff8080;font-size:12px}.ww-body{flex:1;display:flex;gap:8px;min-height:0;overflow:hidden}.ww-left{flex:1.55;display:flex;flex-direction:column;gap:6px;min-width:0;overflow:hidden}.ww-right{flex:1;display:flex;flex-direction:column;border:1px solid rgba(128,128,128,0.3);border-radius:10px;overflow:hidden;min-width:0}.ww-tabs{display:flex;border-bottom:1px solid rgba(128,128,128,0.3);flex:none}.ww-tab{flex:1;text-align:center;padding:5px 2px;font-size:11px;font-weight:700;cursor:pointer;color:rgba(128,128,128,0.8);border-bottom:2px solid transparent}.ww-tab.on{color:inherit;border-bottom-color:#f0b429}.ww-rcontent{flex:1;overflow:auto;padding:6px;display:flex;flex-direction:column;gap:3px;min-height:0}.ww-rsec{font-size:10px;font-weight:800;color:#f0b429;padding:6px 2px 2px;border-bottom:1px dashed rgba(128,128,128,0.25);margin-top:4px;flex:none}.ww-rc{font-size:11px;padding:4px 6px;border-radius:6px;background:rgba(128,128,128,0.1);line-height:1.45;flex:none}.ww-rc .t{color:rgba(128,128,128,0.6);font-size:9px;margin-right:4px}.ww-vbar{display:flex;align-items:center;gap:5px;font-size:10px;padding:2px 0;flex:none}.ww-vbar .bk{flex:1;height:9px;background:rgba(128,128,128,0.2);border-radius:3px;overflow:hidden}.ww-vbar .bk i{display:block;height:100%;background:linear-gradient(90deg,#e05252,#f0b429)}.ww-phase{display:flex;align-items:stretch;gap:6px;flex:none}.ww-pcol{flex:1;border:1px dashed rgba(128,128,128,0.35);border-radius:8px;padding:4px;font-size:10px;color:rgba(128,128,128,0.8);min-height:52px;max-height:64px;overflow:auto}.ww-pcol .cap{font-weight:700;font-size:9px;margin-bottom:3px}.ww-pl{display:inline-flex;align-items:center;gap:3px;background:rgba(128,128,128,0.18);border-radius:6px;padding:1px 5px;margin:1px;font-weight:700;font-size:10px}.ww-pl.next{border:1px solid rgba(79,142,247,0.6)}.ww-pl.done{opacity:0.55}.ww-ptitle{flex:1.3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:rgba(128,128,128,0.12);border-radius:8px;min-height:52px}.ww-ptitle .t1{font-size:10px;color:rgba(128,128,128,0.7);font-weight:700}.ww-ptitle .t2{font-size:14px;font-weight:900;color:#f0b429}.ww-inbox{flex:none;border-radius:8px;background:rgba(79,142,247,0.1);border:1px solid rgba(79,142,247,0.35);padding:4px 8px;font-size:11px;color:rgba(232,234,240,0.9);line-height:1.5;max-height:56px;overflow:auto}.ww-inbox .cap{font-size:9px;color:#4f8ef7;font-weight:700;margin-bottom:2px}.ww-stage{flex:1;min-height:0;display:flex;align-items:stretch}.ww-focus{flex:1;display:flex;align-items:center;gap:10px;border-radius:10px;background:rgba(79,142,247,0.08);border:1px solid rgba(79,142,247,0.4);padding:8px 10px;min-height:0}.ww-focus.idle{border-color:rgba(128,128,128,0.4);background:rgba(128,128,128,0.06)}.ww-ava{flex:none;display:flex;flex-direction:column;align-items:center;gap:3px}.ww-ava .face{width:44px;height:44px;border-radius:50%;background:rgba(128,128,128,0.25);display:flex;align-items:center;justify-content:center;font-size:22px;border:2px solid rgba(79,142,247,0.6)}.ww-ava .no{font-size:10px;font-weight:800;background:rgba(79,142,247,0.25);padding:1px 8px;border-radius:10px}.ww-bub{flex:1;border-radius:10px;background:rgba(128,128,128,0.12);border:1px solid rgba(128,128,128,0.3);padding:8px 10px;font-size:12px;line-height:1.6;min-height:0;display:flex;flex-direction:column;justify-content:space-between;gap:4px;overflow:auto}.ww-bub .dots{display:inline-flex;gap:3px}.ww-bub .dots i{width:5px;height:5px;border-radius:50%;background:#4f8ef7;animation:wwbl 1.2s infinite}.ww-bub .dots i:nth-child(2){animation-delay:.2s}.ww-bub .dots i:nth-child(3){animation-delay:.4s}@keyframes wwbl{0%,100%{opacity:.2}50%{opacity:1}}.ww-next{align-self:flex-end;flex:none;font-size:10px;color:#4f8ef7;cursor:pointer;padding:2px 10px;border-radius:8px;border:1px solid rgba(79,142,247,0.5);background:rgba(79,142,247,0.12)}.ww-seats{display:grid;grid-template-columns:repeat(9,1fr);gap:3px;flex:none}.ww-seat{border:1px solid rgba(128,128,128,0.4);border-radius:8px;padding:3px 1px;text-align:center;font-size:9px;position:relative;cursor:default;background:rgba(128,128,128,0.1)}.ww-seat .n{font-weight:800;font-size:11px;display:block}.ww-seat .r{color:rgba(128,128,128,0.7);font-size:8px;display:block}.ww-seat.dead{opacity:0.3;background:rgba(0,0,0,0.3)}.ww-seat.turn{border-color:#f0b429;background:rgba(240,180,41,0.15)}.ww-seat.you{border-color:#4f8ef7}.ww-seat.sel{border-color:#3fb26a;background:rgba(63,178,106,0.25);cursor:pointer}.ww-seat .mk{position:absolute;top:-4px;right:-2px;font-size:10px}.ww-me{display:flex;align-items:center;gap:8px;border-radius:10px;background:rgba(128,128,128,0.12);border:1px solid rgba(128,128,128,0.3);padding:6px 10px;flex:none}.ww-me .role{font-weight:900;font-size:14px}.ww-me .seat{font-size:10px;color:rgba(128,128,128,0.7)}.ww-me .info{margin-left:auto;display:flex;gap:4px;flex-wrap:wrap}.ww-me .chip{font-size:9px;padding:1px 7px;border-radius:10px;background:rgba(79,142,247,0.2);border:1px solid rgba(79,142,247,0.4);color:#4f8ef7;font-weight:700}.ww-me .chip.gold{background:rgba(212,175,55,0.15);border-color:rgba(212,175,55,0.5);color:#d4af37}.ww-me .chip.red{background:rgba(224,82,82,0.15);border-color:rgba(224,82,82,0.5);color:#e05252}.ww-act{border-radius:10px;background:rgba(128,128,128,0.1);border:1px solid rgba(128,128,128,0.3);padding:8px;display:flex;flex-direction:column;gap:6px;flex:none}.ww-pick{display:flex;flex-wrap:wrap;gap:3px}.ww-pick .p{min-width:30px;padding:5px 0;border-radius:7px;border:1px solid rgba(128,128,128,0.5);background:rgba(128,128,128,0.12);font-weight:700;cursor:pointer;font-size:12px;color:inherit;text-align:center}.ww-pick .p.on{border-color:#3fb26a;background:rgba(63,178,106,0.3)}.ww-ta{width:100%;min-height:40px;box-sizing:border-box;border-radius:8px;border:1px solid rgba(128,128,128,0.5);background:rgba(0,0,0,0.25);color:inherit;padding:6px;font-size:12px;resize:vertical}.ww-go{width:100%;padding:9px;border-radius:9px;border:none;background:linear-gradient(135deg,#b8860b,#d4af37);color:#141000;font-weight:800;font-size:13px;cursor:pointer;text-align:center}.ww-go:disabled{opacity:0.5;cursor:default}.ww-status{font-size:11px;color:rgba(128,128,128,0.7);text-align:center;padding:4px;min-height:34px;display:flex;align-items:center;justify-content:center;flex:none}')
    disposers.push(cssDisposer)

    function WerewolfPanel() {
      const h = React.createElement
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [tab, setTab] = React.useState('speech')
      const [target, setTarget] = React.useState(0)
      const [text, setText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [showRole, setShowRole] = React.useState(true)
      const [stageIdx, setStageIdx] = React.useState(0)
      const [submitted, setSubmitted] = React.useState(false)
      const rightRef = React.useRef(null)

      const poll = React.useCallback(async () => {
        try {
          const r = await host.call('werewolf.uiState', {})
          if (r && r.ok) { setData(r); setErr('') } else { setData(null); if (r && r.error) setErr(r.error) }
        } catch (e) { setErr(String((e && e.message) || e)) }
      }, [])
      React.useEffect(() => {
        poll()
        const d = ctx.interval(poll, 2500)
        return () => d()
      }, [poll])

      React.useEffect(() => { setStageIdx(0) }, [data && data.phase + '|' + data.day])
      React.useEffect(() => {
        if (rightRef.current) rightRef.current.scrollTop = rightRef.current.scrollHeight
      }, [data && data.logs && data.logs.length, tab])
      React.useEffect(() => {
        if (data && data.human && data.human.waitingYou) setSubmitted(false)
      }, [data && data.human && data.human.waitingYou])

      if (!data) {
        return h('div', { className: 'ww-panel' },
          h('div', { className: 'ww-err' }, err || '加载中…'))
      }

      const hum = data.human
      const phase = data.phase
      const phaseName = data.phaseName || phase
      const isSheriffPass = phase === 'sheriff-pass'
      const sheriffPassMine = isSheriffPass && data.sheriffPassSeat === (hum && hum.yourSeat)
      const humAlive = !!(hum && hum.yourAlive)
      const waitingYou = !!(hum && hum.waitingYou)
      const dayNo = data.day === 0 ? 1 : data.day
      const isNight = phase.indexOf('night') === 0 || phase === 'sheriff-pass'
      const isConcurrent = ['day-sheriff-run', 'day-sheriff-quit', 'day-sheriff-vote', 'day-vote'].indexOf(phase) >= 0

      const actionButtons = () => {
        const p = phase
        if (!hum) return []
        if (p === 'sheriff-pass') {
          if (!sheriffPassMine) return []
          return [{ act: 'pass_sheriff', label: '👑 传警徽', extra: {} }, { act: 'pass_sheriff', label: '💔 撕警徽', extra: { zero: true } }]
        }
        if (!hum.yourAlive) return []
        const list = []
        const add = (act, label, extra) => list.push({ act, label, extra: extra || {} })
        if (p === 'day-speech') add('speech', '💬 发言')
        else if (p === 'day-sheriff-speech') add('speech', '💬 警上发言')
        else if (p === 'day-sheriff-run') { add('sheriff_run', '✅ 上警'); add('sheriff_not', '⛔ 不上警') }
        else if (p === 'day-sheriff-quit') { add('sheriff_stay', '✅ 不退水'); add('sheriff_quit', '🏳 退水') }
        else if (p === 'day-sheriff-vote') add('sheriff_vote', '🗳 投警长')
        else if (p === 'day-vote') add('vote', '🗳 投票')
        else if (p === 'day-direct') { add('direction', '⬅ 左', { dir: 'left' }); add('direction', '➡ 右', { dir: 'right' }) }
        else if (p === 'night-wolves') add('kill', '🔪 刀人')
        else if (p === 'night-seer') add('seer', '🔮 查验')
        else if (p === 'night-witch') { add('witch_save', '💊 解药'); add('witch_poison', '☠ 毒人'); add('witch_none', '⏭ 不行动') }
        else if (p === 'night-hunter' || p === 'day-hunter') { add('hunter', '🔫 开枪'); add('hunter', '⏭ 不开枪', { zero: true }) }
        else if (p === 'review') add('review', '📝 提交复盘')
        return list
      }
      const btns = actionButtons()
      const needSelect = ['vote', 'sheriff_vote', 'kill', 'seer', 'witch_poison', 'hunter', 'pass_sheriff'].includes((btns[0] || {}).act)
      const needText = ['speech', 'kill', 'review'].includes((btns[0] || {}).act)

      const submit = (act, payload) => {
        if (busy) return
        const p = payload || {}
        let t = text
        if (act === 'direction') t = p.dir || 'right'
        const tg = p.zero ? 0 : (Number(target) || 0)
        setBusy(true)
        host.call('werewolf.humanAct', { action: act, target: tg, text: t })
          .then((r) => {
            if (r && r.ok) {
              setTarget(0); setText('')
              setSubmitted(true)
            } else setErr((r && r.error) || '行动失败')
            return poll()
          })
          .catch((e) => setErr(String((e && e.message) || e)))
          .finally(() => setBusy(false))
      }

      const logs = (data.logs || []).map((l) => ({ day: l.day, seat: l.seat, text: l.text }))
      const plogs = (() => {
        if (phase === 'day-sheriff-speech') return logs.filter((l) => l.day === data.day && l.text.indexOf('[警上]') === 0)
        if (phase === 'day-speech') return logs.filter((l) => l.day === data.day && l.text.indexOf('[警上]') !== 0)
        return []
      })()
      const stageLog = plogs[stageIdx]

      const progress = data.progress || {}
      const pendingSeats = data.pendingSeats || []
      let pendingList = [], doneList = []
      if (phase === 'day-sheriff-speech') {
        const order = data.sheriffSpeechOrder || []
        const idx = data.sheriffSpeechIdx || 0
        order.forEach((s, i) => (i < idx ? doneList : pendingList).push(s))
      } else if (phase === 'day-speech') {
        const order = data.speechOrder || []
        const idx = data.speechIdx || 0
        order.forEach((s, i) => (i < idx ? doneList : pendingList).push(s))
      } else if (phase === 'day-sheriff-run') {
        const decided = progress.decided || []
        pendingList = (data.alive || []).filter((s) => !decided.includes(s))
        doneList = decided
      } else if (phase === 'day-sheriff-vote' || phase === 'day-vote') {
        const submittedL = progress.submitted || []
        const voters = phase === 'day-vote' ? (data.alive || []) : (data.alive || []).filter((s) => !(data.sheriffRan || []).includes(s))
        pendingList = voters.filter((s) => !submittedL.includes(s))
        doneList = voters.filter((s) => submittedL.includes(s))
      } else if (phase === 'day-sheriff-quit') {
        const decided = progress.decided || []
        pendingList = (data.sheriffCandidates || []).filter((s) => !decided.includes(s))
        doneList = (data.sheriffCandidates || []).filter((s) => decided.includes(s))
      } else if (phase === 'review') {
        const submittedL = progress.submitted || []
        pendingList = (data.players || []).map((p) => p.seat).filter((s) => !submittedL.includes(s))
        doneList = submittedL
      }

      const waitSeat = data.waitingSeat
      const seatNodes = (data.players || []).map((p) => {
        const cls = 'ww-seat' + (p.alive ? '' : ' ww-seat-dead') + (p.seat === waitSeat && p.alive ? ' ww-seat-turn' : '') + (p.human ? ' ww-seat-you' : '') + (needSelect && p.alive ? ' ww-seat-sel' : '')
        return h('div', {
          className: cls, key: 's' + p.seat,
          onClick: () => { if (needSelect && p.alive) setTarget(target === p.seat ? 0 : p.seat) },
          title: p.roleName + (p.alive ? '' : ' 已出局'),
        },
          p.seat === data.sheriff ? h('span', { className: 'mk' }, '👑') : null,
          h('span', { className: 'n' }, p.human ? p.seat + '你' : p.seat),
          showRole ? h('span', { className: 'r' }, p.roleName) : null,
        )
      })

      // 并发阶段（上警/退水/投票）直接给表单，不显示等待中
      const showForm = hum && (humAlive || sheriffPassMine) && (sheriffPassMine ? true : ((waitingYou || isConcurrent) && !submitted))
      const showDone = submitted && !waitingYou && !isSheriffPass
      let actArea = null
      if (showForm) {
        const targetPick = needSelect ? h('div', { className: 'ww-pick' },
          h('button', { className: 'ww-pick p' + (target === 0 ? ' on' : ''), onClick: () => setTarget(0) }, '弃'),
          (data.alive || []).slice().sort((a, b) => a - b).map((s) =>
            h('button', { className: 'ww-pick p' + (target === s ? ' on' : ''), key: 't' + s, onClick: () => setTarget(s) }, s))) : null
        const textInput = needText ? h('textarea', { className: 'ww-ta', value: text, placeholder: '输入内容…', onChange: (e) => setText(e.target.value) }) : null
        actArea = h('div', { className: 'ww-act' },
          targetPick,
          textInput,
          h('div', { className: 'ww-pick' },
            btns.map((b) => h('button', { className: 'ww-go', key: b.label, disabled: busy, onClick: () => submit(b.act, b.extra) }, b.label))))
      } else if (humAlive && waitingYou && btns.length && !needSelect && !needText) {
        actArea = h('div', { className: 'ww-act' }, h('div', { className: 'ww-pick' }, btns.map((b) => h('button', { className: 'ww-go', key: b.label, disabled: busy, onClick: () => submit(b.act, b.extra) }, b.label))))
      } else if (showDone && hum) {
        actArea = h('div', { className: 'ww-status' }, '✅ 已提交')
      } else if (hum) {
        actArea = h('div', { className: 'ww-status' }, !humAlive && !isSheriffPass ? '💀 你已出局，观战中' : '⏳ 等待中…')
      }

      // 右侧发言按阶段分组
      const groups = []
      let curKey = null
      for (const l of logs) {
        const isSheriff = l.text.indexOf('[警上]') === 0
        const key = 'd' + l.day + (isSheriff ? 's' : 'p')
        if (key !== curKey) {
          curKey = key
          groups.push({ title: '第' + l.day + '天 · ' + (isSheriff ? '警上发言' : '白天发言'), items: [] })
        }
        groups[groups.length - 1].items.push(l)
      }
      let rightContent = null
      if (tab === 'speech') {
        rightContent = groups.map((g, gi) => [
          h('div', { className: 'ww-rsec', key: 's' + gi }, g.title),
          g.items.map((l, li) => h('div', { className: 'ww-rc', key: 'm' + gi + '-' + li },
            h('span', { className: 't' }, '#' + l.seat), l.text)),
        ])
      } else if (tab === 'vote') {
        const votes = data.votes || []
        const counts = {}
        for (const v of votes) counts[v.target] = (counts[v.target] || 0) + 1
        const max = Math.max(1, ...Object.values(counts))
        const parts = [h('div', { className: 'ww-rc', key: 'h' }, '🗳 投票统计')]
        for (const k of Object.keys(counts)) {
          parts.push(h('div', { className: 'ww-vbar', key: 'c' + k },
            h('span', null, k === '0' ? '弃' : '#' + k),
            h('div', { className: 'bk' }, h('i', { style: { width: Math.round(counts[k] / max * 100) + '%' } })),
            h('span', null, String(counts[k]))))
        }
        parts.push(h('div', { className: 'ww-rc', key: 'd', style: { marginTop: 4 } }, '明细：'))
        for (let i = 0; i < votes.length && i < 30; i++) {
          const v = votes[votes.length - 1 - i]
          parts.push(h('div', { className: 'ww-rc', key: 'v' + i }, h('span', { className: 't' }, '第' + v.day + '天'), '#' + v.voter + ' → ' + (v.target === 0 ? '弃票' : '#' + v.target)))
        }
        rightContent = parts
      } else {
        const inboxMsgs = hum ? (hum.inbox || []) : []
        const myKind = hum ? (hum.yourRole === '狼人' ? 'wolf' : hum.yourRole === '预言家' ? 'seer' : hum.yourRole === '女巫' ? 'witch' : null) : null
        const parts = []
        if (hum && inboxMsgs.length) {
          const mine = inboxMsgs.filter((m) => !m.kind || (myKind ? m.kind === myKind : ['info', 'death', 'sheriff'].indexOf(m.kind) >= 0))
          if (mine.length) {
            parts.push(h('div', { className: 'ww-rsec', key: 'mi' }, '🔒 我的私密消息'))
            for (let i = mine.length - 1; i >= 0 && i >= mine.length - 8; i--) parts.push(h('div', { className: 'ww-rc', key: 'mi' + i }, mine[i].text))
          }
          const pub = inboxMsgs.filter((m) => m.kind && ['info', 'death', 'sheriff'].indexOf(m.kind) >= 0)
          if (pub.length) {
            parts.push(h('div', { className: 'ww-rsec', key: 'pi' }, '🔓 通用消息'))
            for (let i = pub.length - 1; i >= 0 && i >= pub.length - 6; i--) parts.push(h('div', { className: 'ww-rc', key: 'pi' + i }, pub[i].text))
          }
        }
        parts.push(h('div', { className: 'ww-rsec', key: 'pe' }, '📰 公开事件'))
        const evs = data.events || []
        for (let i = Math.max(0, evs.length - 30); i < evs.length; i++) parts.push(h('div', { className: 'ww-rc', key: 'e' + i }, '▸ ' + evs[i]))
        if (data.reviewReport) {
          parts.push(h('div', { className: 'ww-rsec', key: 'rr2' }, '📋 复盘报告'))
          parts.push(h('div', { className: 'ww-rc', key: 'rr', style: { whiteSpace: 'pre-wrap' } }, data.reviewReport))
        }
        rightContent = parts
      }

      // 舞台：逐条确认；生成中头像先显示
      let stageContent = null
      if (stageLog) {
        const sp = (data.players || []).find((p) => p.seat === stageLog.seat)
        stageContent = h('div', { className: 'ww-focus' },
          h('div', { className: 'ww-ava' }, h('div', { className: 'face' }, sp && sp.human ? '🧑' : '🤖'), h('div', { className: 'no' }, '#' + stageLog.seat)),
          h('div', { className: 'ww-bub' },
            h('span', null, stageLog.text),
            h('span', { className: 'ww-next', onClick: () => setStageIdx(stageIdx + 1) }, '✔ 确认，下一条 →'),
          ))
      } else if (['day-speech', 'day-sheriff-speech'].indexOf(phase) >= 0 && waitSeat) {
        const sp = (data.players || []).find((p) => p.seat === waitSeat)
        stageContent = h('div', { className: 'ww-focus idle' },
          h('div', { className: 'ww-ava' }, h('div', { className: 'face' }, sp && sp.human ? '🧑' : '🤖'), h('div', { className: 'no' }, '#' + waitSeat)),
          h('div', { className: 'ww-bub' }, h('span', { className: 'dots' }, h('i'), h('i'), h('i')), ' '))
      } else if (pendingSeats.length) {
        stageContent = h('div', { className: 'ww-focus idle' },
          h('div', { className: 'ww-bub' }, '⏳ 正在收集行动/投票…（待' + pendingSeats.join(',') + '）'))
      } else {
        stageContent = h('div', { className: 'ww-focus idle' }, h('div', { className: 'ww-bub' }, '⏳ 等待引擎推进…'))
      }

      let meCard = null
      if (hum) {
        const chips = []
        if (data.sheriff === hum.yourSeat) chips.push(h('span', { className: 'chip gold', key: 's' }, '👑 警长'))
        if (hum.yourRole === '狼人') chips.push(h('span', { className: 'chip red', key: 'w' }, '队友: ' + (data.players || []).filter((p) => p.role === 'wolf' && p.seat !== hum.yourSeat).map((p) => '#' + p.seat).join(' ')))
        if (hum.yourRole === '预言家' && data.seerResults && data.seerResults.length) chips.push(h('span', { className: 'chip', key: 'sr' }, '查验: ' + data.seerResults.map((r) => '#' + r.seat + (r.isWolf ? '狼' : '好')).join(' ')))
        if (hum.yourRole === '女巫' && data.witchLog && data.witchLog.length) chips.push(h('span', { className: 'chip', key: 'wl' }, data.witchLog.join('; ')))
        meCard = h('div', { className: 'ww-me' },
          h('div', null, h('div', { className: 'role' }, hum.yourRole), h('div', { className: 'seat' }, '座位 ' + hum.yourSeat)),
          h('div', { className: 'info' }, chips))
      }

      // 左侧私密消息条（按角色相关）
      const inboxMsgs = hum ? (hum.inbox || []) : []
      const myKind = hum ? (hum.yourRole === '狼人' ? 'wolf' : hum.yourRole === '预言家' ? 'seer' : hum.yourRole === '女巫' ? 'witch' : null) : null
      const mineMsgs = inboxMsgs.filter((m) => !m.kind || (myKind ? m.kind === myKind : ['info', 'death', 'sheriff'].indexOf(m.kind) >= 0))
      const inboxBar = hum && mineMsgs.length ? h('div', { className: 'ww-inbox' },
        h('div', { className: 'cap' }, '🔒 引擎消息'),
        mineMsgs.slice(-2).map((m, i) => h('div', { key: 'in' + i }, m.text))) : null

      const phaseTop = phase === 'day-sheriff-speech' ? '警上发言' : phase === 'day-speech' ? '自由发言' : phase === 'day-vote' ? '放逐投票' : phaseName.replace('白天·', '').replace('夜间·', '')

      return h('div', { className: 'ww-panel' },
        err ? h('div', { className: 'ww-err' }, '⚠ ' + err) : null,
        h('div', { className: 'ww-body' },
          h('div', { className: 'ww-left' },
            meCard,
            h('div', { className: 'ww-phase' },
              h('div', { className: 'ww-pcol' }, h('div', { className: 'cap' }, '⏳ 待'), pendingList.map((s) => h('span', { className: 'ww-pl' + (s === pendingList[0] ? ' next' : ''), key: 'p' + s }, '#' + s))),
              h('div', { className: 'ww-ptitle' }, h('div', { className: 't1' }, (isNight ? '夜间' : '白天') + ' · 第' + dayNo + '天'), h('div', { className: 't2' }, phaseTop)),
              h('div', { className: 'ww-pcol' }, h('div', { className: 'cap' }, '✅ 已'), doneList.map((s) => h('span', { className: 'ww-pl done', key: 'd' + s }, '#' + s))),
            ),
            inboxBar,
            h('div', { className: 'ww-stage' }, stageContent),
            h('div', { className: 'ww-seats' }, seatNodes),
            actArea,
          ),
          h('div', { className: 'ww-right' },
            h('div', { className: 'ww-tabs' },
              h('div', { className: 'ww-tab' + (tab === 'speech' ? ' on' : ''), onClick: () => setTab('speech') }, '📜 发言'),
              h('div', { className: 'ww-tab' + (tab === 'vote' ? ' on' : ''), onClick: () => setTab('vote') }, '🗳 投票'),
              h('div', { className: 'ww-tab' + (tab === 'info' ? ' on' : ''), onClick: () => setTab('info') }, '🔒 信息'),
            ),
            h('div', { className: 'ww-rcontent', ref: rightRef }, rightContent),
          ),
        ),
      )
    }

    const inj = slots.inject('conversation.composer.dock', () => slots.register(
      { name: 'conversation.composer.dock', id: 'werewolf-panel', order: 100, label: '狼人杀' },
      () => React.createElement(WerewolfPanel, null),
    ))
    disposers.push(inj)
    return () => {
      for (const d of disposers) d()
      console.log('[werewolf-ui] disposed')
    }
  },
}