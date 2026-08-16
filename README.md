English | [简体中文](README.zh.md)

# Evolving-Werewolf

> **AI players get stronger with every game.**

**Cross-game knowledge accumulation and evolution**: After each game, the engine automatically distills post-game review experience, writing it into a knowledge base partitioned by role (wolf faction / good faction / seer / witch / hunter strategy, etc.). At the start of the next game, these experiences are injected into the new batch of player agents' personas as skills. **AI players learn from every win and loss — developing stealthier kill strategies, more accurate seer checks, smarter voting patterns.** The more games played, the stronger the AI becomes.

### How It Evolves

```
Game 1: AI players act on rules and personality seeds, may make beginner mistakes
        ↓ Post-game auto-review → distill experience entries into knowledge.json
Game 2: New AI players carry previous game's experience, avoid known pitfalls
        ↓ Another review → knowledge base grows
Game N: AI players have dozens of games' experience, tighter speech logic,
        sharper voting, stealthier wolf plays, deeper good-faction reasoning
```

The knowledge base supports **partitioned storage and strategy retirement** — outdated strategies get marked as retired in new games, preventing unbounded growth. Human players don't face fixed-strategy AI, but an **opponent collective that continuously evolves with accumulated game experience**.

### Other Features

Beyond the evolution mechanism, this is a complete 9-player Werewolf engine (3 Wolves / 1 Seer / 1 Witch / 1 Hunter / 3 Villagers), running on **DeepSeek Harness (DSH)**:

- **Engine-hosted**: No LLM gamemaster — all flows driven by a state machine. Saves tokens, zero information distortion.
- **Full role abilities**: Wolf two-round discussion + majority vote, Seer verification, Witch save/poison (first-night self-save, one potion per night), Hunter's last shot.
- **Standard day flow**: Sheriff election → campaign speeches → withdrawal declarations → sheriff vote → sheriff sets speech direction → sequential speeches → recorded public vote (sheriff 1.5x vote weight, tie → revote).
- **Information isolation**: Kill target only visible to wolves and witch; night death cause not public; each role's channel is private; incremental delivery only sends "information the player hasn't seen yet".
- **Anti-stuck mechanism**: 60s nudge + 180s timeout skip + running-aware (slow players not killed prematurely) + advancement mutex lock.
- **Death freeze + snapshot review**: Eliminated players' info frozen, post-game outputs causally clean decision trajectory reviews.
- **Human seat + browser panel**: `humanSeat` randomly assigns a human seat, actions via HTTP panel, fully competing with AI agents.
- **Asset pipeline**: Integrated Zhipu AI vision (GLM-4V-Flash) + image generation (CogView-3-Flash), free tier is sufficient for UI avatars and character art.
- **Personality seeds**: 9 personality types randomly assigned, diverse player styles.

---

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [DSH (DeepSeek Harness)](https://www.npmjs.com/package/@deepseek-ai/dsh) — install globally:
  ```bash
  npm install -g @deepseek-ai/dsh
  ```

### Install Plugin to DSH

```bash
# 1. Clone the repo
git clone https://github.com/VegeFin/Evolving-Werewolf.git
cd Evolving-Werewolf

# 2. Install dependencies (runtime dep: @deepseek-ai/dsh-tools)
pnpm install   # or npm install

# 3. Add to DSH web profile
dsh plugin --profile web add ./

# 4. Restart DSH
dsh web
```

After restart, `werewolf_*` tools are globally available. The plugin auto-loads with the profile.

### Configuration

#### image-config.json (Asset Pipeline API Key)

```bash
cp image-config.example.json image-config.json
```

Edit `image-config.json`, fill in your Zhipu API Key (register free at [open.bigmodel.cn](https://open.bigmodel.cn)):

```json
{
  "apiKey": "your-api-key",
  "baseURL": "https://open.bigmodel.cn/api/paas/v4",
  "visionModel": "glm-4v-flash",
  "drawModel": "cogview-3-flash",
  "drawSize": "1024x1024",
  "assetDir": "ui/assets"
}
```

> The asset pipeline is optional. Without it, only the image analysis/generation tools are affected — core gameplay is fully functional.

#### knowledge.json (Knowledge Base Seed)

```bash
cp knowledge.example.json knowledge.json
```

The engine automatically distills experience and writes it to `knowledge.json` after each game. `knowledge.example.json` provides 8 initial seed entries.

---

## Usage

### Host Perspective

Call tools in a DSH agent session:

| Tool | Purpose | Caller |
|---|---|---|
| `werewolf_start` | Start game: random role assignment, spawn 8 player agents, begin with human player. Omit `humanSeat` for auto-random 1-9. Set `humanSeat=0` for 9-agent self-evolving game. | Host |
| `werewolf_act` | Player action (18 actions) | Player |
| `werewolf_status` | View public state; host sees full role table and review report | All |
| `werewolf_ask_rule` | Query rules/role abilities | All |
| `werewolf_abort` | Host aborts the game | Host |
| `werewolf_look` | Analyze image with vision model | Host |
| `werewolf_draw` | Generate image with text-to-image model | Host |
| `werewolf_assets_status` | Check asset pipeline status | Host |

`werewolf_start` return value includes `hostGuide` (host instructions) and `panelUrl` (human player panel URL).

### Player Actions (werewolf_act)

| action | Description | Phase |
|---|---|---|
| `speech` + `text` | Give a speech | day-speech / day-sheriff-speech |
| `vote` + `target` | Cast exile vote (0=abstain) | day-vote |
| `sheriff_vote` + `target` | Vote for sheriff | day-sheriff-vote |
| `sheriff_run` / `sheriff_not` | Run for sheriff / decline | day-sheriff-run |
| `sheriff_stay` / `sheriff_quit` | Stay in / withdraw | day-sheriff-quit |
| `direction` + `text=left/right` | Sheriff sets speech direction | day-direct |
| `pass_sheriff` + `target` | Sheriff passes badge on elimination | sheriff-pass |
| `kill` + `target` + `text` | Wolf kills target | night-wolves |
| `seer` + `target` | Seer verifies target | night-seer |
| `witch_save` / `witch_poison`+`target` / `witch_none` | Witch uses potion | night-witch |
| `hunter` + `target` | Hunter shoots (0=don't shoot) | night/day-hunter |
| `alive` | Online confirmation | any |
| `review` + `text` | Submit post-game review | review |

### Human Player Panel

After game start, visit `http://127.0.0.1:<port>/werewolf/panel` in your browser. The panel provides:

- Identity card (seat, role)
- Event stream (categorized by kind: wolf/seer/witch/death/sheriff/info)
- Speech stage (displayed sequentially)
- Action area (gate-driven: forms only shown when it's your turn)

---

## Directory Structure

```
Evolving-Werewolf/
├── lib/
│   └── index.js              # Static engine main file (v33, pure host)
├── ui/
│   ├── panel.html            # Human player panel (HTTP route)
│   ├── assets/               # Avatars and character art (PNG)
│   └── protos/               # UI prototype HTML (dev reference)
├── archive/                  # Dynamic version source archive (dev/debug, zero-restart)
│   ├── dev/
│   │   ├── wwdev-engine.host.js    # Engine dynamic version
│   │   ├── wwim6-assets.host.js    # Asset pipeline dynamic version
│   │   └── wwui10-panel.host.js    # Panel dynamic version
│   ├── v32.host.js           # v32 host archive
│   ├── v32.client.js         # v32 client archive
│   └── werewolf-v21.host.source.js  # v21 original archive
├── cordis.patch.yml          # DSH bundle patch config
├── image-config.example.json # API Key config template
├── knowledge.example.json    # Knowledge base seed template
├── package.json
├── PROGRESS.md               # Version history and progress
└── .gitignore
```

### Public vs Private

| File | Status | Notes |
|---|---|---|
| `lib/index.js` | Public | Engine main code |
| `ui/` | Public | Panel, images, prototypes |
| `archive/` | Public | Dynamic version archive (dev reference) |
| `*.example.json` | Public | Config templates |
| `package.json` / `cordis.patch.yml` | Public | Package metadata |
| `*.md` | Public | Documentation |
| `knowledge.json` | Public | Runtime knowledge base data |
| `image-config.json` | **gitignore** | Contains real API Key |
| `last-review.json` | **gitignore** | Last game review data |
| `review-processed.json` | **gitignore** | Review processing marker |
| `node_modules/` | **gitignore** | Dependencies |
| `.ww-tmp/` | **gitignore** | Subprocess temp files |

---

## Architecture

### Layer Division

```
Host Layer
├── Werewolf Engine (this plugin)
│   ├── State machine (game object, in-memory)
│   ├── Tool registration (werewolf_*, globally visible)
│   ├── timer heartbeat (30s timeout/nudge check)
│   ├── webServer routes (/werewolf/panel + /werewolf/api/* + /werewolf-assets/*)
│   └── Message delivery (subagents.followup / Agent.steer fallback)
└── DSH infrastructure (subagents / agents / tools / webServer / timer / fs / subprocess)

Agent Layer
├── Host (current session): werewolf_start / status / abort
└── 9 players (continuable subagents)
    ├── persona = rulebook + identity + personality seed + historical experience
    ├── toolFilter = only werewolf_act / status / ask_rule
    └── Actions via werewolf_act
```

### State Machine Phases

```
setup → night-wolves → night-seer → night-witch → night-settle
     → day-sheriff-run → day-sheriff-speech → day-sheriff-quit → day-sheriff-vote
     → day-direct → day-speech → day-vote → (night-*) loop
     → gameover → review
```

### Key Service Dependencies (inject declaration)

```js
inject: ['subagents', 'agents', 'tools', 'webServer']
```

Cordis service-driven activation: waits for all four services to be ready before executing `apply()`, preventing early route registration exit.

---

## Rule Implementation

- **Roles**: 3 Wolves + 1 Seer + 1 Witch + 1 Hunter + 3 Villagers, `shuffle` random assignment.
- **Wolves**: Random order two-round discussion, majority vote (tie → first voter breaks tie).
- **Seer**: Verify 1 alive player each night, result is private.
- **Witch**: One heal + one poison potion; first night can self-save; after heal used, no longer informed of kill target.
- **Hunter**: Can shoot when eliminated by wolf kill or vote (not when poisoned).
- **Sheriff**: Elected, 1.5x vote weight, sets speech direction, passes badge on elimination.
- **Voting**: Recorded public vote; tie → second round limited to tied players.
- **Win condition**: All wolves eliminated → good faction wins; all gods or all villagers eliminated → wolves win (faction annihilation).

---

## Development

### Static vs Dynamic Version

| Mode | File | Characteristics |
|---|---|---|
| Static (production) | `lib/index.js` | Standard Cordis plugin, auto-loaded by `dsh web`, restart to take effect |
| Dynamic (development) | `archive/dev/*.host.js` | `cordis_define` injected into memory, zero-restart code changes, lost on restart |

Use dynamic version for development iteration, then consolidate into `lib/index.js`. Dynamic version uses `harness.defineTool`, static version uses `defineTool` from `@deepseek-ai/dsh-tools`.

---

## Known Limitations

- One game takes ~15-40 minutes (9 players × LLM rounds per phase).
- Game state is in plugin memory, cleared on restart.
- Player agent sessions are persistent cold archives, accumulate across games (manual cleanup or auto-release active layer on game start).
- Review knowledge base is memory-level (valid cross-game within process, cleared on restart; can be persisted to `knowledge.json`).

---

## License

MIT
