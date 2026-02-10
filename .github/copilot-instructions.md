**Overview**
- **Purpose:** Help AI coding agents become productive quickly in this repo (React + Phaser game with Capacitor Android integration).
- **Quick start:** see `package.json` scripts and [README.md](README.md).

**Architecture (big picture)**
- Frontend UI: React app entry at [App.tsx](App.tsx) and [index.tsx](index.tsx). UI hosts the Phaser canvas in `#phaser-game`.
- Game core: Phaser code lives in the `game/` directory. Key pieces:
  - Game config: [game/config.ts](game/config.ts) (creates scenes and scale behavior).
  - Scenes: `MenuScene`, `MainScene`, `UIScene` (see [game/MainScene.ts](game/MainScene.ts)).
  - Entities: `game/entities/*` (Tank, Helicopter, Devourer, etc.).
  - Systems: `game/systems/*` (BuildingManager, SoundManager, Particles, InfantryManager).
- Data & assets: audio and sfx are under [public/sfx](public/sfx) and other media under `assets/`.

**Runtime & workflows**
- Local dev: `npm install` then `npm run dev` (Vite). See [README.md](README.md).
- Build: `npm run build` then `npm run preview` to locally preview production build.
- Mobile/Android: Capacitor files are under `android/`. Standard Capacitor flow applies (sync/open via `npx cap`); inspect `android/` for Gradle integration.

**Project-specific conventions & patterns**
- Phaser + React separation: React manages UI, mounts Phaser game with `new Phaser.Game(GameConfig)` in `App.tsx` — avoid reattaching multiple games; destroy `gameRef` when leaving.
- Device-specific handling: `App.tsx` contains Android detection and frame/scale adjustments (local storage keys: `panzer-default-zoom`, `panzer-ui-layout`, `panzer-ui-edit`). Prefer reading these files when modifying layout or input code.
- Event-driven UI↔Game communication: use browser `CustomEvent` on `window` with names like `panzer-testroom-command`, `panzer-testroom-settings`, `panzer-audio-debug`, `panzer-defeat`, `panzer-defeat-clear`, and `update-hud`. When adding new UI/game hooks, follow this pattern.
- Manager pattern: game managers are created with `new X(this)` inside `Scene.create()` (e.g., `new SoundManager(this)`, `new BuildingManager(this)`). Prefer passing the scene reference when implementing systems.
- Large single-file scenes: `MainScene.ts` is monolithic and contains many responsibilities—when making changes prefer extracting small helpers or managers rather than splitting scene class without clear migration plan.

**Integration & dependencies**
- Runtime deps: `phaser`, `react`, `react-dom`, Capacitor (`@capacitor/core`, `@capacitor/android`). See [package.json](package.json).
- Audio: `SoundManager` accesses files under `public/sfx/...` — maintain folder names and structure when adding new audio.
- Physics & groups: code heavily uses Phaser `Group`, `StaticGroup`, and Arcade physics. Match collider setup conventions in existing code when adding new physics objects.

**Debugging tips & common entrypoints**
- Open browser devtools console to trigger/test game events, e.g.:
  - `window.dispatchEvent(new CustomEvent('panzer-testroom-command', { detail: { command: 'ENEMY_MAUS' } }))`
  - `window.dispatchEvent(new CustomEvent('panzer-testroom-settings', { detail: { enemyAttack: true } }))`
- HUD updates: scenes emit `update-hud` events — inspect `App.tsx` listeners and emitted payload shape in `MainScene.create()`.
- Audio debug: listen to `panzer-audio-debug` events to inspect active sounds (UI shows them in `App.tsx`).

**When editing code**
- Prefer small, local changes that mirror existing patterns (create managers via `new X(this)`; emit/listen to custom events for UI/game interaction).
- Avoid changing global scaling or device detection logic without testing on Android device or emulator (see `App.tsx` + `game/config.ts`).
- Search `panzer-` custom event names to find cross-cutting integration points.

**Files to inspect for examples**
- UI bootstrap: [App.tsx](App.tsx), [index.tsx](index.tsx)
- Game entry/config: [game/config.ts](game/config.ts)
- Largest scene / gameplay: [game/MainScene.ts](game/MainScene.ts)
- Systems: `game/systems/` (e.g., `SoundManager`, `Particles`, `BuildingManager`)

If anything here is unclear or you want more detail (for example, a mapping of event names and payloads, or a short migration plan for refactoring `MainScene`), tell me which area to expand and I will iterate.
