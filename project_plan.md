# Game Land — Project Plan
### A 2-player online multiplayer world for Playdate

---

## 1. Project Overview

Game Land is a top-down overworld where two players connect online, walk around together, and enter buildings to play minigames. The world has five buildings, each housing a distinct game. The experience is built for couples or close friends — low-latency isn't critical, charm and personality are.

**Platform:** Playdate (Panic)
**Language:** Lua + Playdate SDK
**Players:** 2 (online, each on their own device)
**Target:** Fully playable end-to-end across all five buildings

---

## 2. Technical Architecture

### 2.1 Playdate Networking Reality

The Playdate SDK does not support WebSockets or raw TCP/UDP sockets. What it does have:

- `playdate.network.request()` — HTTP GET/POST to an external URL
- No persistent connections, no push — polling only

**Approach: HTTP polling to a lightweight sync server**

Each game state (positions, moves, actions) is a JSON object stored on the server. Both devices poll every 100–200ms. For turn-based games this is seamless. For the overworld (real-time movement) it introduces ~100–300ms of perceived lag — acceptable for a casual couples game, not for a competitive one.

The sync server is a simple Flask app deployed on Railway (same pattern as the Remi server). It stores room state in SQLite and handles:
- Player position updates
- Game state delta sync
- Turn ownership
- Lobby/ready signals

### 2.2 Scene Manager

```
main.lua
  └── SceneManager
        ├── Overworld
        ├── Library     (Chess)
        ├── Bar         (Pool)
        ├── Casino      (Card game selector)
        ├── Park        (Slingshot Soccer)
        └── Diner       (Arm Wrestling)
```

Each scene implements three methods: `init()`, `update()`, `draw()`. SceneManager calls the active one each frame and handles transitions (fade in/out).

### 2.3 Networking Layer (`lib/network.lua`)

Wraps `playdate.network.request()` into a simple message queue:

- `Network.push(event, data)` — POST state update to server
- `Network.poll()` — GET opponent's latest state (called every ~150ms on a timer)
- `Network.onReceive(callback)` — fires when new opponent data arrives
- All messages include `room_id`, `player_id`, `timestamp`

The server merges state per room, per player. Each player only ever sees their opponent's latest state — not a history.

### 2.4 Overworld Engine (`scenes/overworld.lua`)

- Tile-based map, 16×16 tiles, scrolling camera
- Two player sprites on screen simultaneously
- Collision detection: walls, building entrances
- Your player: d-pad to move, A to enter building
- Opponent player: rendered from polled position (lerped to reduce jitter)
- Buildings rendered with a glow/highlight when your player is adjacent
- Map size: ~800×480 (2× screen) — enough to feel like a world, small enough to always find each other

---

## 3. Phased Development Plan

### Phase 1 — Foundation (Weeks 1–2)
**Goal: Two players can move around the overworld and see each other**

- [ ] Tile map renderer + camera
- [ ] Local player movement (d-pad)
- [ ] Collision system
- [ ] Network layer: room creation, polling, position sync
- [ ] Opponent player rendering (lerped position)
- [ ] Building proximity detection + "Press A to enter" prompt

**Milestone:** Both players on same screen, able to walk around and approach buildings.

### Phase 2 — Scene Infrastructure (Week 3)
**Goal: Buildings are enterable, scenes load and return cleanly**

- [ ] SceneManager with fade transitions
- [ ] Building entry/exit flow (both players must approach, or just one triggers it)
- [ ] Stub scenes for all 5 buildings
- [ ] Shared "waiting for opponent" screen

**Milestone:** Can enter every building, see a placeholder, and return to overworld.

### Phase 3 — Chess / Library (Weeks 4–5)
**Goal: Fully playable chess**

- [ ] 8×8 board renderer (1-bit, fits on 400×240 with panel space)
- [ ] Piece movement: cursor navigation via d-pad, select with A
- [ ] Full rules: legal moves, check, checkmate, castling, en passant, promotion
- [ ] Turn sync via server (send move → opponent receives → applies)
- [ ] Crank: rotate to cycle through promotable piece options
- [ ] Win/lose/draw detection and screen

**Milestone:** Full online chess match, start to finish.

### Phase 4 — Pool / Bar (Weeks 6–7)
**Goal: Turn-based pool with physics**

- [ ] Table renderer, ball positions
- [ ] Aim line (d-pad rotates angle)
- [ ] Crank controls shot power (wind up = more power)
- [ ] Simple 2D circle physics (reflection, friction, pocket detection)
- [ ] Turn alternation: your shot → sync result → opponent's shot
- [ ] Win condition: pot all your balls + 8-ball

**Milestone:** Full game of 8-ball pool, playable online.

### Phase 5 — Casino (Weeks 8–9)
**Goal: All three card games playable**

- [ ] Card renderer (1-bit deck, readable at small size)
- [ ] Casino lobby: selector between 3 games
- [ ] Texas Hold'em Poker (see §4.3)
- [ ] Gin Rummy (see §4.3)
- [ ] Snap (see §4.3)

**Milestone:** All three casino games playable.

### Phase 6 — Slingshot Soccer / Park (Week 10)
**Goal: Physics-based soccer with slingshot mechanic**

- [ ] Field renderer, goal zones, ball
- [ ] Slingshot: hold A to grab, d-pad to aim, crank to increase tension, release A to fire
- [ ] Ball physics (velocity, bounce off walls)
- [ ] Player can reposition between shots (d-pad, limited range)
- [ ] Score tracking, round timer

**Milestone:** Full match of slingshot soccer.

### Phase 7 — Arm Wrestling / Diner (Week 11)
**Goal: Crank battle minigame**

- [ ] Arm wrestling animation (two arms, central pivot)
- [ ] Crank speed = force applied
- [ ] Server syncs both players' force values each tick
- [ ] Win when opponent's arm reaches the table
- [ ] Best of 3 rounds

**Milestone:** Full arm wrestling match.

### Phase 8 — Polish & Launch-Ready (Weeks 12–13)
- [ ] Sound effects for each game + overworld footsteps
- [ ] Menu / lobby screen (enter room code to connect)
- [ ] Player name entry
- [ ] Disconnect handling (opponent left gracefully)
- [ ] Card/catalog description for Playdate's Catalog submission

---

## 4. Per-Building Breakdown

### 4.1 Library → Chess

| | |
|---|---|
| **Controls** | D-pad: move cursor. A: select / confirm. B: deselect. |
| **Crank** | Cycles through promotion options (Q / R / B / N) when a pawn reaches the back rank |
| **Complexity** | Medium — chess rules are well-specified but verbose in Lua |
| **Notes** | The 400×240 display fits an 8×8 board at 24px per square (192px) with room for captured pieces and player names alongside. 1-bit is fine — light/dark squares via fill pattern. |

### 4.2 Bar → Pool (8-Ball)

| | |
|---|---|
| **Controls** | D-pad: rotate aim direction. A: start/confirm shot. B: cancel. |
| **Crank** | Controls shot power. Rotating clockwise increases power (shown as a bar). Release A fires. |
| **Complexity** | High — circle physics on Playdate in Lua. Keep it simple: no spin/english, just velocity + friction + reflection. Pocket detection = proximity threshold. |
| **Notes** | Render balls as filled circles (cue ball = white/outline, solids = filled, stripes = filled with gap). Table fits on screen at ~320×160 with gutters. |

### 4.3 Casino → 3 Card Games

**Recommended games and why:**

#### Game 1: Texas Hold'em Poker ⭐ (recommended flagship)
Turn-based, universally known, natural drama. Each player gets 2 hole cards, 5 community cards revealed across 3 rounds (flop/turn/river). Betting uses virtual chips.
- **Crank:** Adjust bet amount (rotate to increase/decrease wager)
- **Complexity:** Medium — hand evaluation is the hard part (write a rank comparator)

#### Game 2: Gin Rummy
Draw/discard card game. Players build sets and runs, knock when ready. Very natural on Playdate — hand of cards rendered as a horizontal row, cursor moves left/right.
- **Crank:** Fan cards in hand (crank rotates the spread), making it easier to read
- **Complexity:** Medium — meld detection logic

#### Game 3: Snap
Real-time reaction game. Cards are flipped to a central pile one at a time (alternating). When the top two cards match, first player to press A wins the pile. Most cards at end wins.
- **Crank:** Spin crank fast to "slap" — used instead of A button for the snap action. More physical, more fun.
- **Complexity:** Low — mostly timing and network latency handling (handle simultaneous snaps server-side)

### 4.4 Park → Slingshot Soccer

| | |
|---|---|
| **Controls** | D-pad: reposition your player (limited zone). Hold A to grab slingshot. D-pad while holding A: aim. Release A: fire. |
| **Crank** | Increases slingshot tension while held (more crank = harder kick). Visual: elastic stretches. |
| **Complexity** | Medium — simpler physics than pool. Ball is a single object, no ball–ball collisions. |
| **Notes** | Birds-eye view. Each player defends one goal, attacks the other. Turn-based: you fire, sync result, opponent fires. First to 5 goals wins. |

### 4.5 Diner → Arm Wrestling

**Pitches for this slot:**

1. **Arm Wrestling** *(recommended)* — Pure crank battle. Both players crank as fast as possible. Crank RPM maps to force. Server syncs net force each tick. Arm pivots toward whoever is winning. Best of 3 rounds. Perfect showcase of the crank. Implementation is 2 weeks max.

2. **Paper Toss** — Turn-based. Aim a crumpled paper ball at a bin using d-pad + crank for trajectory arc. Physics toss, wind variable. Charming and low complexity, but less interactive head-to-head.

3. **Staring Contest** — Hold A without blinking (pressing B). On-screen eye slowly closes. Random events tempt you to press B (fake sneeze, fly lands on nose). Last one to blink wins. Zero physics, all timing. Very low complexity, very high silliness.

**Recommendation: Arm Wrestling.** It's the purest possible use of the crank as a core mechanic in a 2-player context. Fast to implement, immediately fun, great tactile feedback on hardware.

| | |
|---|---|
| **Controls** | Crank only (both players) |
| **Crank** | Rotation speed = force applied to your side of the arm |
| **Complexity** | Low |

---

## 5. Multiplayer Networking: Open Questions

### How does a session start?
Simplest approach: **room codes**. Player 1 generates a 6-character room code on the menu screen, shares it with Player 2 (verbally or via text). Player 2 enters the code. Both devices connect to the same room on the server.

### Who goes first / who is Player 1?
Room creator is always Player 1. This determines starting positions in the overworld, which color in chess, who breaks in pool, etc.

### What happens when a player disconnects?
Server marks a player as inactive if no poll received in 10 seconds. The other player sees a "Waiting for [name]…" screen. If inactive for 60 seconds, session ends and both return to menu.

### Polling rate vs battery
Polling every 150ms burns more battery than idle. Consider:
- Overworld: poll every 150ms (real-time feel needed)
- Turn-based games: poll every 500ms (only need opponent's move, not position)
- Switch to event-driven mode inside games where possible (poll until you see a new move, then stop polling until you've taken yours)

---

## 6. Risk Factors

| Risk | Severity | Mitigation |
|------|----------|------------|
| Polling latency makes overworld feel laggy | Medium | Lerp opponent position client-side. Accept ~200ms as the floor. |
| Playdate Lua heap (1MB) exceeded by chess + map data | Medium | Lazy-load scenes, unload previous scene on transition |
| Pool physics too slow (Lua, 30fps) | Medium | Limit active balls, use fixed timestep, no sub-frame accuracy needed |
| Network request failures mid-game | Medium | Retry queue, optimistic local updates, server is source of truth |
| Simultaneous Snap presses — who wins? | Low | Server timestamps all presses, earliest wins, result broadcast to both |
| Playdate SDK `network.request()` blocking main thread | High | Use async callbacks — never block `update()`. All network calls are non-blocking in SDK 2.x. |
| Playdate Catalog requirements | Low | Plan for card/catalog text and screenshots in Phase 8 |

---

## 7. File / Module Structure

```
main.lua                    Entry point, game loop, SceneManager init

scenes/
  overworld.lua             Top-down world, movement, building detection
  library.lua               Chess
  bar.lua                   Pool
  casino.lua                Card game picker + hosts the 3 sub-games
  casino_poker.lua          Texas Hold'em
  casino_rummy.lua          Gin Rummy
  casino_snap.lua           Snap
  park.lua                  Slingshot Soccer
  diner.lua                 Arm Wrestling

lib/
  scene_manager.lua         Transition engine, active scene routing
  network.lua               HTTP poll wrapper, message queue, room management
  physics.lua               2D circle physics (used by pool + soccer)
  cards.lua                 Deck, hand, deal, shuffle, rank comparison
  chess_logic.lua           Board, legal moves, check/checkmate detection

assets/
  maps/
    overworld.png           Tile map image
    overworld_collisions    Collision table
  sprites/
    player1.png
    player2.png
    buildings.png
    pieces.png              Chess pieces (1-bit)
    cards.png               Card faces + backs (1-bit sprite sheet)
  sounds/
    footstep.wav
    card_flip.wav
    ...

server/
  server.py                 Sync server (Flask + SQLite, deploy to Railway)
  requirements.txt
```

---

## 8. Complexity Summary

| Building | Game | Complexity | Crank Use |
|----------|------|------------|-----------|
| Library | Chess | Medium | Promotion selector |
| Bar | Pool | High | Shot power |
| Casino | Poker | Medium | Bet sizing |
| Casino | Gin Rummy | Medium | Fan hand |
| Casino | Snap | Low | Slap mechanic |
| Park | Slingshot Soccer | Medium | Slingshot tension |
| Diner | Arm Wrestling | Low | Core mechanic (RPM = force) |
| — | Overworld | Medium | — |
| — | Networking layer | Medium | — |

**Total estimated build: 12–14 weeks for two developers working part time.**
Chess and Pool are the two hardest individual games. Build them in Phases 3 and 4 while the architecture is fresh. The casino games and arm wrestling are comparatively fast and can be used to build momentum near the end.


