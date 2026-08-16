// wwim-6 (werewolf-assets) Host half —— 素材管线（读图/生图/静态路由）
// 2026-08-16 由 cordis_define 定义，重启后丢失；此文件用于快速重建。
// 重建：cordis_define kind:new idPrefix:wwim, code.host = 本文件内容（return { apply(ctx){...} } 原样）。
return {
  apply(ctx) {
    const disposers = []
    const ROOT = 'D:/agentWorkSpace'
    const CFG_PATH = ROOT + '/werewolf-engine/image-config.json'
    const ASSET_DIR = ROOT + '/werewolf-ui/assets'
    const TMP_DIR = ROOT + '/.ww-tmp'

    const HELPER = "const fs=require('node:fs');const path=require('node:path');\nconst p=JSON.parse(process.env.WW_ARGS||'{}');\n(async()=>{const out={ok:false,status:0,error:''};\ntry{\nlet init={method:p.mode==='dl'?'GET':'POST',headers:p.headers||{}};\nlet body=p.body||null;\nif(p.mode==='vision'){const b64=fs.readFileSync(p.imagePath).toString('base64');\nbody={model:p.model,messages:[{role:'user',content:[{type:'text',text:p.question},{type:'image_url',image_url:{url:'data:'+p.mime+';base64,'+b64}}]}],temperature:0.2};}\nif(body)init.body=JSON.stringify(body);\nconst res=await fetch(p.url,init);out.status=res.status;\nconst buf=Buffer.from(await res.arrayBuffer());\nif(p.mode==='dl'){if(res.ok){fs.mkdirSync(path.dirname(p.outFile),{recursive:true});fs.writeFileSync(p.outFile,buf);}\nout.ok=res.ok;out.saved=res.ok?p.outFile:null;out.bytes=buf.length;}\nelse{out.ok=res.ok;out.text=buf.toString('utf8').slice(0,20000);}}\ncatch(e){out.error=String(e&&e.message||e);}\nfs.mkdirSync(path.dirname(p.resFile),{recursive:true});\nfs.writeFileSync(p.resFile,JSON.stringify(out));})();"

    async function loadConfig() {
      const fs = ctx.get('fs')
      if (!fs) return {}
      try {
        const t = await fs.resolve(CFG_PATH, { cwd: ROOT })
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
          cwd: ROOT,
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

    harness.registerTool(ctx, harness.defineTool({
      name: 'werewolf_look',
      description: '（狼人杀素材）读图：用视觉模型（默认智谱 GLM-4V-Flash，免费）分析一张本地图片，返回文字描述。用于调研主流形象/风格。需要 werewolf-engine/image-config.json 配置 apiKey。',
      parameters: { type: 'object', properties: {
        image: { type: 'string', description: '本地图片文件路径（绝对路径或相对 D:/agentWorkSpace 的路径）' },
        question: { type: 'string', description: '可选：针对图片的具体问题；缺省为详细描述内容与风格' },
      }, required: ['image'] },
      output: OUT,
      async execute(args) {
        const cfg = await loadConfig()
        if (!cfg.apiKey) return { ok: false, error: '未配置 apiKey：编辑 D:/agentWorkSpace/werewolf-engine/image-config.json 填入智谱 API Key（https://open.bigmodel.cn 注册）' }
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
    }))

    harness.registerTool(ctx, harness.defineTool({
      name: 'werewolf_draw',
      description: '（狼人杀素材）生图：用文生图模型（默认智谱 CogView-3-Flash，免费）生成图片，保存到 werewolf-ui/assets/ 并通过 /werewolf-assets/ 静态路由提供，可反复复用。需要 image-config.json 配置 apiKey。',
      parameters: { type: 'object', properties: {
        prompt: { type: 'string', description: '图片描述（中文即可，越具体越好：主体、风格、配色、构图、氛围）' },
        name: { type: 'string', description: '可选：文件名（不含扩展名）；缺省自动生成时间戳名；同名覆盖' },
        size: { type: 'string', description: '可选：尺寸 1024x1024 / 768x1344 / 1344x768' },
      }, required: ['prompt'] },
      output: OUT,
      async execute(args) {
        const cfg = await loadConfig()
        if (!cfg.apiKey) return { ok: false, error: '未配置 apiKey：编辑 D:/agentWorkSpace/werewolf-engine/image-config.json 填入智谱 API Key（https://open.bigmodel.cn 注册）' }
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
    }))

    harness.registerTool(ctx, harness.defineTool({
      name: 'werewolf_assets_status',
      description: '（狼人杀素材）查看图片能力状态：配置、服务可用性、node 子进程路径。',
      parameters: { type: 'object', properties: {} },
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
    }))

    const ws = ctx.get('webServer')
    if (ws) {
      try {
        disposers.push(ws.register({
          kind: 'prefix',
          path: '/werewolf-assets',
          handler: async (req, res) => {
            try {
              const raw = String(req.url || '').split('?')[0]
              const name = raw.replace(/^\/werewolf-assets\//, '')
              if (!name || name.indexOf('..') >= 0 || name.indexOf('\\') >= 0) { res.writeHead(400); res.end('bad request'); return }
              const fs = ctx.get('fs')
              const t = await fs.resolve(ASSET_DIR + '/' + name, { cwd: ROOT })
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

    return () => { for (const d of disposers) d() }
  },
}
