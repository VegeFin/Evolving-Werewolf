// wwui-10 (werewolf-ui-standalone) Host half —— 独立面板页 + 演示 API
// 2026-08-16 由 cordis_define 定义，重启后丢失；此文件用于快速重建。
// 重建：cordis_define kind:new idPrefix:wwui, code.host = 本文件内容。
// 面板页本体在 D:/agentWorkSpace/werewolf-ui/panel.html（改文件+刷新即生效，无需重建插件）。
return {
  apply(ctx) {
    const disposers = []
    const ROOT = 'D:/agentWorkSpace'
    const PANEL_PATH = ROOT + '/werewolf-ui/panel.html'

    const MOCK_STATE = {
      ok: true,
      state: {
        phase: 'day-speech', phaseName: '白天·自由发言', day: 1,
        yourSeat: 2, yourRole: '狼人', yourAlive: true, sheriff: 2,
        players: [1,2,3,4,5,6,7,8,9].map(s => ({ seat: s, alive: s !== 4 })),
        speechOrder: [1,2,3,4,5,6,7,8,9], speechIdx: 2, waitingSeat: 3,
        wolfMates: [4, 9],
        logs: [
          { day: 1, seat: 1, text: '我跳预言家，昨晚验了 4 号是好人，要警徽带队。狼人刀口在 6 号，女巫先别交药……' },
          { day: 1, seat: 2, text: '[警上] 上警。' },
          { day: 1, seat: 3, text: '我平民，听 1 号不像预言家，先观察一轮。' },
        ],
        votes: [],
        inbox: [
          { kind: 'wolf', text: '狼队友确认：#4 #9 在线。' },
          { kind: 'info', text: '第一夜降临，狼人请睁眼。' },
        ],
        events: ['第一夜降临，狼人请睁眼。', '警长竞选开始。'],
      },
    }

    const json = (res, code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(obj))
    }

    const ws = ctx.get('webServer')
    if (ws) {
      try {
        disposers.push(ws.register({
          kind: 'exact',
          path: '/werewolf/panel',
          handler: async (req, res) => {
            try {
              const fs = ctx.get('fs')
              const t = await fs.resolve(PANEL_PATH, { cwd: ROOT })
              const html = await fs.readText(t)
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
              res.end(html)
            } catch (e) {
              res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
              res.end('panel load failed: ' + String(e && e.message || e))
            }
          },
        }))
      } catch (e) { console.log('[wwui] panel route failed: ' + String(e && e.message || e)) }

      try {
        disposers.push(ws.register({
          kind: 'exact',
          path: '/werewolf/api/state',
          handler: async (req, res) => json(res, 200, MOCK_STATE),
        }))
      } catch (e) { console.log('[wwui] state route failed: ' + String(e && e.message || e)) }

      try {
        disposers.push(ws.register({
          kind: 'exact',
          path: '/werewolf/api/act',
          handler: async (req, res) => {
            let body = ''
            for await (const chunk of req) body += chunk
            try { JSON.parse(body || '{}') } catch (e) { return json(res, 400, { ok: false, error: 'bad json' }) }
            json(res, 200, { ok: true, notice: '演示模式：行动已记录（引擎接入后生效）' })
          },
        }))
      } catch (e) { console.log('[wwui] act route failed: ' + String(e && e.message || e)) }
    }

    return () => { for (const d of disposers) d() }
  },
}
