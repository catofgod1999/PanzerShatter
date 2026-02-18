import Phaser from 'phaser';
import type { MainScene } from '../MainScene';
import sfxManifest from 'virtual:sfx-manifest';
import { MIXER_TRACKS } from './AudioMixerTable';
import { AUDIO_LOADING_RULES, type AudioLoadingPriority } from './AudioLoadingConfig';

type SoundPlayOptions = {
  volume?: number;
  rate?: number;
  detune?: number;
  worldX?: number;
  worldY?: number;
  pan?: number;
  maxDistance?: number;
  cooldownMs?: number;
  trackPosition?: boolean;
};

type LoopOptions = {
  volume?: number;
  rate?: number;
  detune?: number;
  worldX?: number;
  worldY?: number;
  pan?: number;
  maxDistance?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  startAtRandomOffset?: boolean;
  trackPosition?: boolean;
};

type ManagedSound = Phaser.Sound.BaseSound & {
  volume: number;
  setVolume: (volume: number) => any;
  setPan?: (pan: number) => any;
  setRate?: (rate: number) => any;
  setDetune?: (detune: number) => any;
};

type MixerSettings = { volumeDb: number; lowpassHz: number; highpassHz: number; pitchCents: number; };
type LoopUnlockWait = { onUnlock: () => void; onPointer: () => void; onKey: () => void; };
type ShuffleBagState = { signature: string; all: string[]; remaining: string[]; lastPicked: string | null; };

export class SoundManager {
  private static sessionAudioPackReady = false;
  private static sessionAudioPackPromise: Promise<void> | null = null;
  private static sessionAudioPackTotal = 0;
  private static sessionAudioPackLoaded = 0;
  private static sessionAudioPackProgressListeners = new Set<(loaded: number, total: number) => void>();

  private scene: MainScene;
  private destroyed = false;
  private listenerX = 0;
  private listenerY = 0;
  private urlToKey = new Map<string, string>();
  private loaded = new Set<string>();
  private loading = new Map<string, Promise<string>>();
  private missingLogged = new Set<string>();
  private lastPlayedAt = new Map<string, number>();
  private shuffleBagByFolder = new Map<string, ShuffleBagState>();
  private loops = new Map<string, ManagedSound>();
  private loopStarting = new Map<string, Promise<Phaser.Sound.BaseSound | null>>();
  private loopStartToken = new Map<string, number>();
  private loopFolderById = new Map<string, string>();
  private loopTargetVolume = new Map<string, number>();
  private loopDesiredVolume = new Map<string, number>();
  private loopFadeTween = new Map<string, Phaser.Tweens.Tween>();
  private loopPendingPlayUnlock = new Map<string, LoopUnlockWait>();
  private exclusiveSounds = new Map<string, ManagedSound>();
  private exclusiveToken = new Map<string, number>();
  private activeOneShots = new Set<ManagedSound>();
  private folderLookupSource: Record<string, string[]> | null = null;
  private folderKeyLookupLower = new Map<string, string>();

  private mixerTracks = new Map<string, MixerSettings>();
  private mixerCache = new Map<string, MixerSettings>();

  private limiterNode: DynamicsCompressorNode | null = null;
  private limiterMaster: AudioNode | null = null;
  private limiterDest: AudioNode | null = null;
  private lastAudioState: string | null = null;

  // Side-chain compression (Ducking)
  // Master -> Limiter -> Destination
  // SFX (Weapon/Vehicle/Infantry) -> DuckingControl (Gain) -> Master
  // Ambient (Forest/Lake) -> DuckingTarget (Compressor) -> Master
  // When SFX is loud, DuckingTarget reduces Ambient volume.
  private duckingControl: GainNode | null = null;
  private duckingTarget: DynamicsCompressorNode | null = null;
  
  public currentAmbientDuckVolume = 1.0;
  public currentBgmDuckVolume = 1.0;
  private currentBgmLowpassHz = 30000;
  private currentCookoffFocusDuck = 1.0;
  private currentCookoffFocusLowpassHz = 30000;
  private reverbStartSerial = 0;
  private readonly reverbYieldDurationMs = 1500;
  private readonly reverbPanRecenterDelayMs = 500;
  private readonly reverbPanRecenterDurationMs = 1000;
  private readonly projectileExplosionAttenuationFloor = 0.12;
  private readonly projectileExplosionFarLowpassHz = 2200;
  private backgroundPrewarmQueue: string[] = [];
  private backgroundPrewarmInFlight = 0;
  private backgroundPrewarmTimer: Phaser.Time.TimerEvent | null = null;
  private readonly backgroundPrewarmTickMs = 80;
  private readonly backgroundPrewarmMaxConcurrent = 3;
  private readonly enableAudioKeyMappingLog = !!((import.meta as any)?.env?.DEV);

  private handleSceneWake() {
    if (this.destroyed) return;
    this.setupLimiter();
    this.ensureLimiterConnected();
    const ctx = this.getAudioContext();
    if (ctx && ctx.state !== 'running') {
      ctx.resume().catch(() => {});
    }
    for (const s of this.loops.values()) {
      try {
        (s as any).resume?.();
      } catch {}
    }
  }

  private tryResumeContext() {
    if (this.destroyed) return;
    const ctx = this.getAudioContext();
    if (ctx && ctx.state !== 'running') {
      ctx.resume().catch(() => {});
    }
    this.ensureLimiterConnected();
  }

  private syncListenerFromCamera(): Phaser.Geom.Rectangle | null {
    const cam = this.scene.cameras?.main;
    if (!cam) return null;
    const view = cam.worldView;

    const mid = (cam as any).midPoint as { x?: number; y?: number } | undefined;
    let x = typeof mid?.x === 'number' && Number.isFinite(mid.x) ? mid.x : NaN;
    let y = typeof mid?.y === 'number' && Number.isFinite(mid.y) ? mid.y : NaN;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const vx = (view as any)?.x;
      const vy = (view as any)?.y;
      const vw = (view as any)?.width;
      const vh = (view as any)?.height;
      if (typeof vx === 'number' && Number.isFinite(vx) && typeof vw === 'number' && Number.isFinite(vw)) x = vx + vw * 0.5;
      if (typeof vy === 'number' && Number.isFinite(vy) && typeof vh === 'number' && Number.isFinite(vh)) y = vy + vh * 0.5;
    }

    if (Number.isFinite(x)) this.listenerX = x;
    if (Number.isFinite(y)) this.listenerY = y;
    return view ?? null;
  }

  public static softResetSceneAudio(scene: Phaser.Scene) {
    const sound = (scene as any)?.sound;
    if (!sound) return;

    try { sound.stopAll?.(); } catch {}
    try { sound.removeAll?.(); } catch {}

    try {
      const ctx = sound.context as AudioContext | undefined;
      if (ctx && ctx.state !== 'running') {
        ctx.resume().catch(() => {});
      }
    } catch {}
  }

  constructor(scene: MainScene) {
    this.scene = scene;
    this.scene.events.on('update', this.update, this);
    this.scene.events.on(Phaser.Scenes.Events.WAKE, this.handleSceneWake, this);
    this.scene.events.on(Phaser.Scenes.Events.RESUME, this.handleSceneWake, this);
    this.scene.input?.on('pointerdown', this.tryResumeContext, this);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.mixerTracks = this.buildMixerTracks();
    this.setupLimiter();
  }

  private setupLimiter() {
    const soundManager = this.scene.sound as Phaser.Sound.WebAudioSoundManager;
    if (!soundManager || !soundManager.context) return;
    if (this.limiterNode) return;

    const ctx = soundManager.context;
    const master = soundManager.masterVolumeNode;
    const dest = ctx.destination;

    if (!master || !dest) return;

    try {
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -0.5;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.1;

      try {
        master.disconnect();
      } catch {}
      try {
        limiter.disconnect();
      } catch {}
      master.connect(limiter);
      limiter.connect(dest);

      this.limiterNode = limiter;
      this.limiterMaster = master;
      this.limiterDest = dest;

      // Setup Sidechain (Ducking)
      // duckingTarget: Compressor that attenuates ambient
      // duckingControl: Gain node that loud sounds (weapons) pass through to trigger the compressor
      const duckingTarget = ctx.createDynamicsCompressor();
      duckingTarget.threshold.value = -24; // Start compressing early
      duckingTarget.knee.value = 10;
      duckingTarget.ratio.value = 12; // Strong compression
      duckingTarget.attack.value = 0.05;
      duckingTarget.release.value = 0.4;
      
      const duckingControl = ctx.createGain();
      duckingControl.gain.value = 1.0; // Pass-through volume

      // Route: duckingControl -> duckingTarget.reduction (Not possible directly in WebAudio without AudioWorklet or Sidechain support in Compressor)
      // Standard WebAudio DynamicsCompressorNode doesn't support side-chain input.
      // So we use a simplified approach:
      // Ambient Sounds -> duckingTarget -> Master
      // Weapon Sounds -> Master
      // AND Weapon Sounds -> duckingControl -> (Analysed?) -> duckingTarget.threshold? No.
      
      // Actually, Phaser doesn't expose the raw nodes easily for all sounds.
      // We'll just stick to Limiter for now as WebAudio compressor sidechain is complex.
      // BUT, user asked for "Forest/Lake loop sidechain compression from vehicle/weapon/infantry".
      // Since we can't easily route specific Phaser sounds to a sidechain input (DynamicsCompressor doesn't have one),
      // we will rely on the Limiter on Master to squash everything if it gets too loud, 
      // OR we can manually duck ambient volume in update() if loud sounds are playing.
      //
      // Let's implement MANUAL ducking in update().
      
    } catch (e) {
      try {
        master.connect(dest);
      } catch {}
      console.warn('SoundManager: Failed to setup limiter', e);
    }
  }

  private ensureLimiterConnected() {
    const soundManager = this.scene.sound as Phaser.Sound.WebAudioSoundManager;
    const ctx = soundManager?.context;
    if (!soundManager || !ctx) return;
    const master = soundManager.masterVolumeNode;
    const dest = ctx.destination;
    if (!master || !dest) return;

    if (!this.limiterNode || this.limiterNode.context !== ctx) {
      this.limiterNode = null;
      this.limiterMaster = null;
      this.limiterDest = null;
      this.setupLimiter();
      return;
    }

    const state = ctx.state;
    if (this.lastAudioState !== state) {
      this.lastAudioState = state;
      if (state === 'running') {
        this.limiterMaster = null;
        this.limiterDest = null;
      }
    }

    if (this.limiterMaster !== master || this.limiterDest !== dest) {
      try {
        master.disconnect();
      } catch {}
      try {
        this.limiterNode.disconnect();
      } catch {}
      try {
        master.connect(this.limiterNode);
        this.limiterNode.connect(dest);
        this.limiterMaster = master;
        this.limiterDest = dest;
      } catch {
        try {
          master.connect(dest);
        } catch {}
        this.limiterMaster = master;
        this.limiterDest = dest;
      }
    }
  }

  private getAudioContext(): AudioContext | null {
    const ctx = (this.scene.sound as any)?.context as AudioContext | undefined;
    return ctx && typeof ctx.currentTime === 'number' ? ctx : null;
  }

  private clampLowpassHz(hz: number): number {
    const ctx = this.getAudioContext();
    const nyquist = ctx ? Math.max(10, ctx.sampleRate * 0.5) : 30000;
    const maxHz = Math.max(10, Math.min(30000, nyquist - 50));
    return Phaser.Math.Clamp(hz, 10, maxHz);
  }

  private clampHighpassHz(hz: number): number {
    const ctx = this.getAudioContext();
    const nyquist = ctx ? Math.max(10, ctx.sampleRate * 0.5) : 30000;
    const maxHz = Math.max(10, Math.min(30000, nyquist - 50));
    return Phaser.Math.Clamp(hz, 10, maxHz);
  }

  private isAudioUnlocked(): boolean {
    const ctx = this.getAudioContext();
    if (!ctx) return true;
    return ctx.state === 'running';
  }

  private clearLoopUnlockWait(id: string) {
    const wait = this.loopPendingPlayUnlock.get(id);
    if (!wait) return;
    this.scene.sound.off('unlocked', wait.onUnlock, this);
    this.scene.input?.off('pointerdown', wait.onPointer, this);
    this.scene.input?.keyboard?.off('keydown', wait.onKey, this);
    this.loopPendingPlayUnlock.delete(id);
  }

  private armLoopUnlockRetry(id: string, snd: ManagedSound, seek: number = 0) {
    this.clearLoopUnlockWait(id);
    const retry = () => {
      this.tryResumeContext();
      if (!this.isAudioUnlocked()) return;
      this.clearLoopUnlockWait(id);
      if (this.destroyed) return;
      if (this.loops.get(id) !== snd) return;
      if (snd.isPlaying) return;
      try {
        snd.play({ seek });
      } catch {}
    };
    const wait: LoopUnlockWait = {
      onUnlock: retry,
      onPointer: retry,
      onKey: retry,
    };
    this.loopPendingPlayUnlock.set(id, wait);
    this.scene.sound.once('unlocked', wait.onUnlock, this);
    this.scene.input?.on('pointerdown', wait.onPointer, this);
    this.scene.input?.keyboard?.on('keydown', wait.onKey, this);
  }

  private getFilterEndpoints(sound: Phaser.Sound.BaseSound) {
    const manager = (sound as any).manager as any;
    const dest = manager?.destination as AudioNode | undefined;
    if (!dest) return null;
    const pannerNode = (sound as any).pannerNode as AudioNode | null | undefined;
    const spatialNode = (sound as any).spatialNode as AudioNode | null | undefined;
    const volumeNode = (sound as any).volumeNode as AudioNode | null | undefined;
    const src = (pannerNode ?? spatialNode ?? volumeNode) as AudioNode | null | undefined;
    if (!src) return null;
    return { src, dest };
  }

  private reconnectFilters(sound: Phaser.Sound.BaseSound | null | undefined) {
    if (!sound) return;
    const src = (sound as any).__panzerFilterSrc as AudioNode | undefined;
    const dest = (sound as any).__panzerFilterDest as AudioNode | undefined;
    if (!src || !dest) return;
    const hp = (sound as any).__panzerHighpass as BiquadFilterNode | undefined;
    const lp = (sound as any).__panzerLowpass as BiquadFilterNode | undefined;
    try {
      src.disconnect();
    } catch {}
    try {
      hp?.disconnect();
    } catch {}
    try {
      lp?.disconnect();
    } catch {}
    try {
      if (hp && lp) {
        src.connect(hp);
        hp.connect(lp);
        lp.connect(dest);
      } else if (hp) {
        src.connect(hp);
        hp.connect(dest);
      } else if (lp) {
        src.connect(lp);
        lp.connect(dest);
      } else {
        src.connect(dest);
      }
    } catch {
      try {
        src.connect(dest);
      } catch {}
    }
  }

  private detachLowpass(sound: Phaser.Sound.BaseSound | null | undefined) {
    if (!sound) return;
    const lpTween = (sound as any).__panzerLowpassTween as Phaser.Tweens.Tween | undefined;
    if (lpTween) {
      try {
        lpTween.stop();
      } catch {}
      delete (sound as any).__panzerLowpassTween;
    }
    const detuneTween = (sound as any).__panzerDetuneTween as Phaser.Tweens.Tween | undefined;
    if (detuneTween) {
      try {
        detuneTween.stop();
      } catch {}
      delete (sound as any).__panzerDetuneTween;
    }
    const lp = (sound as any).__panzerLowpass as BiquadFilterNode | undefined;
    const hp = (sound as any).__panzerHighpass as BiquadFilterNode | undefined;
    if (lp) {
      try {
        lp.disconnect();
      } catch {}
    }
    if (hp) {
      try {
        hp.disconnect();
      } catch {}
    }
    delete (sound as any).__panzerLowpass;
    delete (sound as any).__panzerHighpass;
    this.reconnectFilters(sound);
  }

  public ensureLowpass(sound: Phaser.Sound.BaseSound | null | undefined, initialHz = 30000) {
    if (!sound) return null;
    const existing = (sound as any).__panzerLowpass as BiquadFilterNode | undefined;
    if (existing) return existing;
    const ctx = this.getAudioContext();
    const create = (ctx as any)?.createBiquadFilter as ((...args: any[]) => BiquadFilterNode) | undefined;
    if (!ctx || typeof create !== 'function') return null;
    const endpoints = this.getFilterEndpoints(sound);
    if (!endpoints) return null;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = this.clampLowpassHz(initialHz);

    (sound as any).__panzerLowpass = lp;
    (sound as any).__panzerFilterSrc = endpoints.src;
    (sound as any).__panzerFilterDest = endpoints.dest;
    this.reconnectFilters(sound);
    return lp;
  }

  public ensureHighpass(sound: Phaser.Sound.BaseSound | null | undefined, initialHz = 0) {
    if (!sound) return null;
    const existing = (sound as any).__panzerHighpass as BiquadFilterNode | undefined;
    if (existing) return existing;
    const ctx = this.getAudioContext();
    const create = (ctx as any)?.createBiquadFilter as ((...args: any[]) => BiquadFilterNode) | undefined;
    if (!ctx || typeof create !== 'function') return null;
    const endpoints = this.getFilterEndpoints(sound);
    if (!endpoints) return null;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = this.clampHighpassHz(Math.max(10, initialHz));

    (sound as any).__panzerHighpass = hp;
    (sound as any).__panzerFilterSrc = endpoints.src;
    (sound as any).__panzerFilterDest = endpoints.dest;
    this.reconnectFilters(sound);
    return hp;
  }

  public setLowpassFrequency(sound: Phaser.Sound.BaseSound | null | undefined, hz: number) {
    const lp = this.ensureLowpass(sound);
    if (!lp) return;
    const ctx = this.getAudioContext();
    const value = this.clampLowpassHz(hz);
    if (!ctx) {
      try {
        lp.frequency.value = value;
      } catch {}
      return;
    }
    const now = ctx.currentTime;
    try {
      lp.frequency.cancelScheduledValues(now);
      lp.frequency.setValueAtTime(value, now);
    } catch {}
  }

  public tweenLowpassFrequency(sound: Phaser.Sound.BaseSound | null | undefined, toHz: number, durationMs: number) {
    const lp = this.ensureLowpass(sound);
    if (!lp) return;
    const prev = (sound as any).__panzerLowpassTween as Phaser.Tweens.Tween | undefined;
    if (prev) {
      try {
        prev.stop();
      } catch {}
    }

    const fromHz = typeof lp.frequency?.value === 'number' ? lp.frequency.value : 30000;
    const obj = { v: fromHz };
    const t = this.scene.tweens.add({
      targets: obj,
      v: this.clampLowpassHz(toHz),
      duration: Math.max(1, durationMs | 0),
      ease: 'Linear',
      onUpdate: () => {
        this.setLowpassFrequency(sound, obj.v);
      },
      onComplete: () => {
        delete (sound as any).__panzerLowpassTween;
        this.setLowpassFrequency(sound, obj.v);
      }
    });
    (sound as any).__panzerLowpassTween = t;
  }

  public setHighpassFrequency(sound: Phaser.Sound.BaseSound | null | undefined, hz: number) {
    const hp = this.ensureHighpass(sound, hz);
    if (!hp) return;
    const ctx = this.getAudioContext();
    const value = this.clampHighpassHz(hz);
    if (!ctx) {
      try {
        hp.frequency.value = value;
      } catch {}
      return;
    }
    const now = ctx.currentTime;
    try {
      hp.frequency.cancelScheduledValues(now);
      hp.frequency.setValueAtTime(value, now);
    } catch {}
  }

  public tweenDetune(sound: Phaser.Sound.BaseSound | null | undefined, toCents: number, durationMs: number) {
    if (!sound) return;
    const s = sound as ManagedSound;
    if (typeof s.setDetune !== 'function') return;
    const prev = (sound as any).__panzerDetuneTween as Phaser.Tweens.Tween | undefined;
    if (prev) {
      try {
        prev.stop();
      } catch {}
    }
    let start = 0;
    const stored = (sound as any).__panzerDetuneValue as number | undefined;
    if (typeof stored === 'number' && Number.isFinite(stored)) {
      start = stored;
    } else {
      try {
        const from = (s as any).detune as number | undefined;
        if (typeof from === 'number' && Number.isFinite(from)) start = from;
      } catch {}
    }
    const obj = { v: start };
    const t = this.scene.tweens.add({
      targets: obj,
      v: Phaser.Math.Clamp(toCents, -2400, 2400),
      duration: Math.max(1, durationMs | 0),
      ease: 'Linear',
      onUpdate: () => {
        try {
          s.setDetune?.(obj.v);
          (sound as any).__panzerDetuneValue = obj.v;
        } catch {}
      },
      onComplete: () => {
        delete (sound as any).__panzerDetuneTween;
        try {
          s.setDetune?.(obj.v);
          (sound as any).__panzerDetuneValue = obj.v;
        } catch {}
      }
    });
    (sound as any).__panzerDetuneTween = t;
  }

  private normalizeSidechainFolderKey(folderKey: string | undefined): string {
    if (!folderKey) return '';
    return this.normalizeFolderKey(folderKey).replace(/^public\/sfx\//, '');
  }

  private folderHasSegment(folderKey: string, segment: string): boolean {
    return folderKey.includes(`/${segment}/`) || folderKey.endsWith(`/${segment}`);
  }

  private isBgmFolder(folderKey: string | undefined): boolean {
    const key = this.normalizeSidechainFolderKey(folderKey);
    return key.startsWith('bgm/');
  }

  private getBgmSidechainStrength(folderKey: string | undefined): number {
    const key = this.normalizeSidechainFolderKey(folderKey);
    if (!key) return 0;

    if (key.startsWith('weapon/')) {
      if (this.folderHasSegment(key, 'fire') || this.folderHasSegment(key, 'explosion')) return 1.0;
      if (this.folderHasSegment(key, 'hit_vehicle')) return 0.96;
      if (this.folderHasSegment(key, 'flight_loop')) return 0.92;
      if (this.folderHasSegment(key, 'reverb_forest_after_explosion')) return 0.84;
      return 0.8;
    }

    if (key.startsWith('vehicle/')) {
      if (this.folderHasSegment(key, 'fire')) return 0.95;
      if (this.folderHasSegment(key, 'cookoff') || this.folderHasSegment(key, 'explosion')) {
        if (key.startsWith('vehicle/enemy_')) return 0.18;
        return 0.3;
      }
      if (this.folderHasSegment(key, 'flight_loop')) return 0.88;
      if (this.folderHasSegment(key, 'idle_engine_loop')) return 0.74;
      if (this.folderHasSegment(key, 'cruise_loop')) return 0.78;
      return 0.82;
    }

    return 0;
  }

  private getBgmHighCutStrength(folderKey: string | undefined): number {
    const key = this.normalizeSidechainFolderKey(folderKey);
    if (!key) return 0;

    if (key.startsWith('weapon/')) {
      if (this.folderHasSegment(key, 'fire') || this.folderHasSegment(key, 'explosion')) return 1.0;
      if (this.folderHasSegment(key, 'flight_loop')) return 0.86;
      if (this.folderHasSegment(key, 'reverb_forest_after_explosion')) return 0.8;
      return 0.42;
    }

    if (key.startsWith('vehicle/')) {
      if (this.folderHasSegment(key, 'fire')) return 0.9;
      if (this.folderHasSegment(key, 'cookoff') || this.folderHasSegment(key, 'explosion')) {
        if (key.startsWith('vehicle/enemy_')) return 0.08;
        return 0.14;
      }
      return 0.28;
    }

    return 0;
  }

  private destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off('update', this.update, this);
    this.scene.events.off(Phaser.Scenes.Events.WAKE, this.handleSceneWake, this);
    this.scene.events.off(Phaser.Scenes.Events.RESUME, this.handleSceneWake, this);
    this.scene.input?.off('pointerdown', this.tryResumeContext, this);
    for (const id of this.loopPendingPlayUnlock.keys()) this.clearLoopUnlockWait(id);
    {
      const soundManager = this.scene.sound as Phaser.Sound.WebAudioSoundManager;
      const ctx = soundManager?.context;
      const master = soundManager?.masterVolumeNode;
      const dest = ctx?.destination;
      if (ctx && master && dest) {
        try {
          master.disconnect();
        } catch {}
        try {
          master.connect(dest);
        } catch {}
      }
      try {
        this.limiterNode?.disconnect();
      } catch {}
      this.limiterNode = null;
      this.limiterMaster = null;
      this.limiterDest = null;
    }
    for (const t of this.loopFadeTween.values()) t.stop();
    this.loopFadeTween.clear();
    for (const s of this.loops.values()) {
      try {
        this.detachLowpass(s);
        s.stop();
      } catch {}
      try {
        s.destroy();
      } catch {}
    }
    this.loops.clear();
    this.loopStarting.clear();
    this.loopStartToken.clear();
    this.loopFolderById.clear();
    this.loopTargetVolume.clear();
    this.loopDesiredVolume.clear();
    for (const s of this.exclusiveSounds.values()) {
      try {
        this.detachLowpass(s);
        s.stop();
      } catch {}
      try {
        s.destroy();
      } catch {}
    }
    this.exclusiveSounds.clear();
    this.exclusiveToken.clear();
    this.shuffleBagByFolder.clear();
    this.backgroundPrewarmQueue.length = 0;
    this.backgroundPrewarmInFlight = 0;
    if (this.backgroundPrewarmTimer) {
      try {
        this.backgroundPrewarmTimer.remove(false);
      } catch {}
      this.backgroundPrewarmTimer = null;
    }
    this.reverbStartSerial = 0;
  }

  private safeSetVolume(sound: ManagedSound, volume: number): boolean {
    try {
      sound.setVolume(volume);
      return true;
    } catch {
      return false;
    }
  }

  private pruneBrokenLoop(id: string, sound: ManagedSound) {
    try { this.detachLowpass(sound); } catch {}
    try { sound.stop?.(); } catch {}
    try { sound.destroy?.(); } catch {}
    this.loops.delete(id);
    this.loopStarting.delete(id);
    this.loopFadeTween.delete(id);
    this.loopStartToken.delete(id);
    this.loopFolderById.delete(id);
    this.loopTargetVolume.delete(id);
    this.loopDesiredVolume.delete(id);
    this.clearLoopUnlockWait(id);
  }

  private pruneBrokenOneShot(sound: ManagedSound) {
    this.activeOneShots.delete(sound);
    try { this.detachLowpass(sound); } catch {}
    try { sound.stop?.(); } catch {}
    try { sound.destroy?.(); } catch {}
  }

  private pruneBrokenExclusive(id: string, sound: ManagedSound) {
    this.exclusiveSounds.delete(id);
    this.exclusiveToken.delete(id);
    try { this.detachLowpass(sound); } catch {}
    try { sound.stop?.(); } catch {}
    try { sound.destroy?.(); } catch {}
  }

  private update() {
    if (this.destroyed) return;
    this.ensureLimiterConnected();
    const view = this.syncListenerFromCamera();
    if (!view) return;
    const now = this.scene.time.now;
    this.updateWeaponForestReverbPriority(now);

    let cookoffFocusActive = false;
    for (const snd of this.activeOneShots) {
      if (!snd?.isPlaying) continue;
      if (this.isVehicleCookoffFolder((snd as any).__panzerFolderKey as string | undefined)) {
        cookoffFocusActive = true;
        break;
      }
    }
    if (!cookoffFocusActive) {
      for (const snd of this.exclusiveSounds.values()) {
        if (!snd?.isPlaying) continue;
        if (this.isVehicleCookoffFolder((snd as any).__panzerFolderKey as string | undefined)) {
          cookoffFocusActive = true;
          break;
        }
      }
    }

    const cookoffTargetDuck = cookoffFocusActive ? 0.88 : 1.0;
    const cookoffTargetLowpassHz = cookoffFocusActive ? 14000 : 30000;
    const cookoffDuckSpeed = cookoffTargetDuck < this.currentCookoffFocusDuck ? 0.12 : 0.045;
    const cookoffLowpassSpeed = cookoffTargetLowpassHz < this.currentCookoffFocusLowpassHz ? 0.14 : 0.06;
    this.currentCookoffFocusDuck = Phaser.Math.Linear(this.currentCookoffFocusDuck, cookoffTargetDuck, cookoffDuckSpeed);
    this.currentCookoffFocusLowpassHz = Phaser.Math.Linear(this.currentCookoffFocusLowpassHz, cookoffTargetLowpassHz, cookoffLowpassSpeed);

    for (const [id, sound] of this.loops.entries()) {
      if (!sound) continue;
      const folderKey = this.loopFolderById.get(id);
      const baseVolume = this.loopTargetVolume.get(id) ?? 1;
      const worldX = (sound as any).__panzerWorldX as number | undefined;
      const worldY = (sound as any).__panzerWorldY as number | undefined;
      const maxDistance = (sound as any).__panzerMaxDistance as number | undefined;
      const panOverride = (sound as any).__panzerPan as number | undefined;
      const p = this.computePan(worldX, panOverride);
      const isShellFlightLoop =
        typeof folderKey === 'string' &&
        folderKey.startsWith('weapon/') &&
        folderKey.includes('/flight_loop/');
      const isBurningLoop = typeof folderKey === 'string' && folderKey.includes('/burning_loop/');

      const a0 = this.computeAttenuation(worldX, worldY, maxDistance);
      let a = a0;
      if (isShellFlightLoop && typeof worldX === 'number' && Number.isFinite(worldX)) {
        const dx = worldX - this.listenerX;
        const dy = typeof worldY === 'number' && Number.isFinite(worldY) ? (worldY - this.listenerY) : 0;
        
        // Universal Doppler/Attenuation based on distance from screen center
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Reference distance: approx 60% of screen max dimension
        // e.g. for 1920 width, ref is ~1150px.
        const screenRef = Math.max(view.width, view.height) * 0.6;
        const t = Phaser.Math.Clamp(dist / screenRef, 0, 1);

        // Volume: Center=1.0, Far=0.3 (Strong attenuation)
        const volMul = 1.0 - t * 0.7;
        a *= volMul;

        // Doppler: Center=1.0, Far=0.6 (Obvious pitch drop)
        const baseRate = (sound as any).__panzerBaseRate as number | undefined;
        const r0 = typeof baseRate === 'number' && Number.isFinite(baseRate) ? baseRate : 1;
        
        const doppler = 1.0 - t * 0.4;
        
        try {
          (sound as any).setRate?.(r0 * doppler);
        } catch {}
      }
      if (typeof sound.setPan === 'function') sound.setPan(p);
      
      // Ducking Logic for loops
      const duckVol = (sound as any).__panzerDuckVolume ?? 1.0;
      const bgmDuckVol = (sound as any).__panzerBgmDuckVolume ?? 1.0;
      const isVehicleFolder = typeof folderKey === 'string' && this.normalizeFolderKey(folderKey).replace(/^public\/sfx\//, '').startsWith('vehicle/');
      const isBgmFolder = this.isBgmFolder(folderKey);
      const cookoffFocusDuck = isVehicleFolder
        ? 1.0
        : (isBgmFolder ? Phaser.Math.Linear(1.0, this.currentCookoffFocusDuck, 0.25) : this.currentCookoffFocusDuck);
      const finalVol = baseVolume * a * duckVol * bgmDuckVol * cookoffFocusDuck;
      if (!this.safeSetVolume(sound, finalVol)) {
        this.pruneBrokenLoop(id, sound);
        continue;
      }

      if (isBurningLoop) {
        let mixerLowpassHz = (sound as any).__panzerMixerLowpassHz as number | undefined;
        if (typeof mixerLowpassHz !== 'number' || !Number.isFinite(mixerLowpassHz)) {
          const mix = this.getMixerSettingsForFolder(folderKey);
          mixerLowpassHz = mix.lowpassHz;
          (sound as any).__panzerMixerLowpassHz = mixerLowpassHz;
        }
        const nearHz = mixerLowpassHz > 0 ? mixerLowpassHz : 30000;
        const farHz = Math.min(nearHz, 900);
        const t = Phaser.Math.Clamp(Math.sqrt(Math.max(0, 1 - a0)), 0, 1);
        const hz = Phaser.Math.Linear(nearHz, farHz, t);
        const prevHz = (sound as any).__panzerDistanceLowpassHz as number | undefined;
        if (typeof prevHz !== 'number' || !Number.isFinite(prevHz) || Math.abs(prevHz - hz) > 2) {
          (sound as any).__panzerDistanceLowpassHz = hz;
          this.setLowpassFrequency(sound, hz);
        }
      }

      if (cookoffFocusActive && !isVehicleFolder && !isBgmFolder) {
        let mixerLowpassHz = (sound as any).__panzerMixerLowpassHz as number | undefined;
        if (typeof mixerLowpassHz !== 'number' || !Number.isFinite(mixerLowpassHz)) {
          const mix = this.getMixerSettingsForFolder(folderKey);
          mixerLowpassHz = mix.lowpassHz;
          (sound as any).__panzerMixerLowpassHz = mixerLowpassHz;
        }
        const baseHz = mixerLowpassHz > 0 ? mixerLowpassHz : 30000;
        const focusHz = Math.min(baseHz, this.currentCookoffFocusLowpassHz);
        const prevFocusHz = (sound as any).__panzerCookoffFocusLowpassHz as number | undefined;
        if (typeof prevFocusHz !== 'number' || !Number.isFinite(prevFocusHz) || Math.abs(prevFocusHz - focusHz) > 3) {
          (sound as any).__panzerCookoffFocusLowpassHz = focusHz;
          this.setLowpassFrequency(sound, focusHz);
        }
      }
      if (folderKey) this.lastPlayedAt.set(`__loop:${folderKey}`, now);
    }

    // Optional dynamic spatial tracking for long one-shots (e.g. collapse tails).
    for (const snd of this.activeOneShots) {
      if (!snd?.isPlaying) continue;
      const folderKey = (snd as any).__panzerFolderKey as string | undefined;
      const isWeaponForestReverb = this.isWeaponForestReverbFolder(folderKey);
      const trackPosition = (snd as any).__panzerTrackPosition === true;
      if (!trackPosition && !isWeaponForestReverb) continue;
      const worldX = (snd as any).__panzerWorldX as number | undefined;
      const worldY = (snd as any).__panzerWorldY as number | undefined;
      const maxDistance = (snd as any).__panzerMaxDistance as number | undefined;
      const panOverride = (snd as any).__panzerPan as number | undefined;
      const baseVolume = (snd as any).__panzerBaseVolume as number | undefined;

      if (typeof snd.setPan === 'function') {
        if (isWeaponForestReverb) {
          snd.setPan(this.computeWeaponForestReverbPan(snd, now));
        } else if (trackPosition) {
          snd.setPan(this.computePan(worldX, panOverride));
        }
      }

      const ignoreDistanceAttenuation =
        typeof folderKey === 'string' && this.shouldIgnoreDistanceAttenuation(folderKey);
      const attenuationFloor = this.getDistanceAttenuationFloor(folderKey);
      const staticAtt = (snd as any).__panzerBaseAttenuation as number | undefined;
      const att = trackPosition
        ? (ignoreDistanceAttenuation ? 1 : this.computeAttenuation(worldX, worldY, maxDistance, attenuationFloor))
        : (typeof staticAtt === 'number' && Number.isFinite(staticAtt)
          ? staticAtt
          : (ignoreDistanceAttenuation ? 1 : this.computeAttenuation(worldX, worldY, maxDistance, attenuationFloor)));
      const reverbMul = isWeaponForestReverb ? this.applyWeaponForestReverbDynamics(snd, folderKey, now) : 1;
      const normalizedFolder = typeof folderKey === 'string'
        ? this.normalizeFolderKey(folderKey).replace(/^public\/sfx\//, '')
        : '';
      const isVehicleFolder = normalizedFolder.startsWith('vehicle/');
      const cookoffFocusDuck = isVehicleFolder ? 1.0 : this.currentCookoffFocusDuck;
      const targetVolume = Phaser.Math.Clamp((typeof baseVolume === 'number' ? baseVolume : snd.volume) * att * reverbMul * cookoffFocusDuck, 0, 2);
      if (!this.safeSetVolume(snd, targetVolume)) {
        this.pruneBrokenOneShot(snd);
        continue;
      }

      if (cookoffFocusActive && !isVehicleFolder) {
        let mixerLowpassHz = (snd as any).__panzerMixerLowpassHz as number | undefined;
        if (typeof mixerLowpassHz !== 'number' || !Number.isFinite(mixerLowpassHz)) {
          mixerLowpassHz = this.getMixerSettingsForFolder(normalizedFolder).lowpassHz;
          (snd as any).__panzerMixerLowpassHz = mixerLowpassHz;
        }
        const baseHz = mixerLowpassHz > 0 ? mixerLowpassHz : 30000;
        const focusHz = Math.min(baseHz, this.currentCookoffFocusLowpassHz);
        const prevFocusHz = (snd as any).__panzerCookoffFocusLowpassHz as number | undefined;
        if (typeof prevFocusHz !== 'number' || !Number.isFinite(prevFocusHz) || Math.abs(prevFocusHz - focusHz) > 3) {
          (snd as any).__panzerCookoffFocusLowpassHz = focusHz;
          this.setLowpassFrequency(snd, focusHz);
        }
      }
    }

    // Optional dynamic spatial tracking for exclusive one-shots (vehicle explosion tails, etc.).
    for (const [exclusiveId, snd] of this.exclusiveSounds.entries()) {
      if (!snd?.isPlaying) continue;
      const folderKey = (snd as any).__panzerFolderKey as string | undefined;
      const isWeaponForestReverb = this.isWeaponForestReverbFolder(folderKey);
      const trackPosition = (snd as any).__panzerTrackPosition === true;
      if (!trackPosition && !isWeaponForestReverb) continue;
      const worldX = (snd as any).__panzerWorldX as number | undefined;
      const worldY = (snd as any).__panzerWorldY as number | undefined;
      const maxDistance = (snd as any).__panzerMaxDistance as number | undefined;
      const panOverride = (snd as any).__panzerPan as number | undefined;
      const baseVolume = (snd as any).__panzerBaseVolume as number | undefined;

      if (typeof snd.setPan === 'function') {
        if (isWeaponForestReverb) {
          snd.setPan(this.computeWeaponForestReverbPan(snd, now));
        } else if (trackPosition) {
          snd.setPan(this.computePan(worldX, panOverride));
        }
      }

      const ignoreDistanceAttenuation =
        typeof folderKey === 'string' && this.shouldIgnoreDistanceAttenuation(folderKey);
      const attenuationFloor = this.getDistanceAttenuationFloor(folderKey);
      const staticAtt = (snd as any).__panzerBaseAttenuation as number | undefined;
      const att = trackPosition
        ? (ignoreDistanceAttenuation ? 1 : this.computeAttenuation(worldX, worldY, maxDistance, attenuationFloor))
        : (typeof staticAtt === 'number' && Number.isFinite(staticAtt)
          ? staticAtt
          : (ignoreDistanceAttenuation ? 1 : this.computeAttenuation(worldX, worldY, maxDistance, attenuationFloor)));
      const reverbMul = isWeaponForestReverb ? this.applyWeaponForestReverbDynamics(snd, folderKey, now) : 1;
      const normalizedFolder = typeof folderKey === 'string'
        ? this.normalizeFolderKey(folderKey).replace(/^public\/sfx\//, '')
        : '';
      const isVehicleFolder = normalizedFolder.startsWith('vehicle/');
      const cookoffFocusDuck = isVehicleFolder ? 1.0 : this.currentCookoffFocusDuck;
      const targetVolume = Phaser.Math.Clamp((typeof baseVolume === 'number' ? baseVolume : snd.volume) * att * reverbMul * cookoffFocusDuck, 0, 2);
      if (!this.safeSetVolume(snd, targetVolume)) {
        this.pruneBrokenExclusive(exclusiveId, snd);
        continue;
      }

      if (cookoffFocusActive && !isVehicleFolder) {
        let mixerLowpassHz = (snd as any).__panzerMixerLowpassHz as number | undefined;
        if (typeof mixerLowpassHz !== 'number' || !Number.isFinite(mixerLowpassHz)) {
          mixerLowpassHz = this.getMixerSettingsForFolder(normalizedFolder).lowpassHz;
          (snd as any).__panzerMixerLowpassHz = mixerLowpassHz;
        }
        const baseHz = mixerLowpassHz > 0 ? mixerLowpassHz : 30000;
        const focusHz = Math.min(baseHz, this.currentCookoffFocusLowpassHz);
        const prevFocusHz = (snd as any).__panzerCookoffFocusLowpassHz as number | undefined;
        if (typeof prevFocusHz !== 'number' || !Number.isFinite(prevFocusHz) || Math.abs(prevFocusHz - focusHz) > 3) {
          (snd as any).__panzerCookoffFocusLowpassHz = focusHz;
          this.setLowpassFrequency(snd, focusHz);
        }
      }
    }

    // Manual sidechain + tonal ducking for BGM/ambient.
    let bgmSidechainStrength = 0;
    let bgmHighCutStrength = 0;
    let sidechainTriggerCount = 0;

    const inspectFolder = (folderKey: string | undefined) => {
      if (!folderKey) return;

      const sidechainStrength = this.getBgmSidechainStrength(folderKey);
      if (sidechainStrength > 0) {
        bgmSidechainStrength = Math.max(bgmSidechainStrength, sidechainStrength);
        sidechainTriggerCount++;
      }

      const highCutStrength = this.getBgmHighCutStrength(folderKey);
      if (highCutStrength > bgmHighCutStrength) bgmHighCutStrength = highCutStrength;
    };

    const reachedStrongestState = () =>
      bgmSidechainStrength >= 0.99 && bgmHighCutStrength >= 0.99 && sidechainTriggerCount >= 3;

    for (const snd of this.activeOneShots) {
      if (!snd.isPlaying) continue;
      inspectFolder((snd as any).__panzerFolderKey as string | undefined);
      if (reachedStrongestState()) break;
    }

    if (!reachedStrongestState()) {
      for (const snd of this.exclusiveSounds.values()) {
        if (!snd.isPlaying) continue;
        inspectFolder((snd as any).__panzerFolderKey as string | undefined);
        if (reachedStrongestState()) break;
      }
    }

    if (!reachedStrongestState()) {
      for (const snd of this.loops.values()) {
        if (!snd.isPlaying) continue;
        const folder = (snd as any).__panzerFolderKey as string | undefined;
        if (this.isBgmFolder(folder)) continue;
        inspectFolder(folder);
        if (reachedStrongestState()) break;
      }
    }

    const sidechainStackPerTrigger = cookoffFocusActive ? 0.015 : 0.04;
    const stackedStrength = Phaser.Math.Clamp(
      bgmSidechainStrength + Math.max(0, sidechainTriggerCount - 1) * sidechainStackPerTrigger,
      0,
      1
    );

    const ambientDuckVol = Phaser.Math.Linear(1.0, 0.1, stackedStrength);
    const bgmCompressionStrength = Phaser.Math.Clamp(stackedStrength * 0.25, 0, 1);
    const bgmHighCutApplied = Phaser.Math.Clamp(bgmHighCutStrength * 0.25, 0, 1);
    const bgmDuckVol = Phaser.Math.Linear(1.0, 0.55, bgmCompressionStrength);

    const bgmLowpassTarget = Phaser.Math.Linear(30000, 4600, bgmHighCutApplied);

    const ambientDuckSpeed = ambientDuckVol < this.currentAmbientDuckVolume ? 0.12 : 0.026;
    const bgmDuckSpeed = bgmDuckVol < this.currentBgmDuckVolume ? 0.16 : 0.05;
    const bgmLowpassSpeed = bgmLowpassTarget < this.currentBgmLowpassHz ? 0.24 : 0.065;

    this.currentAmbientDuckVolume = Phaser.Math.Linear(this.currentAmbientDuckVolume, ambientDuckVol, ambientDuckSpeed);
    this.currentBgmDuckVolume = Phaser.Math.Linear(this.currentBgmDuckVolume, bgmDuckVol, bgmDuckSpeed);
    this.currentBgmLowpassHz = Phaser.Math.Linear(this.currentBgmLowpassHz, bgmLowpassTarget, bgmLowpassSpeed);

    for (const snd of this.loops.values()) {
      const folder = (snd as any).__panzerFolderKey as string | undefined;
      if (!folder) continue;

      if (folder.includes('environment/forest/ambient_2d') && !folder.includes('wind_loop')) {
        (snd as any).__panzerDuckVolume = this.currentAmbientDuckVolume;
      }

      if (this.isBgmFolder(folder)) {
        (snd as any).__panzerBgmDuckVolume = this.currentBgmDuckVolume;

        let mixerLowpassHz = (snd as any).__panzerMixerLowpassHz as number | undefined;
        if (typeof mixerLowpassHz !== 'number' || !Number.isFinite(mixerLowpassHz)) {
          mixerLowpassHz = this.getMixerSettingsForFolder(folder).lowpassHz;
          (snd as any).__panzerMixerLowpassHz = mixerLowpassHz;
        }

        const baseBgmHz = mixerLowpassHz > 0 ? mixerLowpassHz : 30000;
        const dynamicLowpassHz = Math.min(baseBgmHz, this.currentBgmLowpassHz);
        const prevDynamic = (snd as any).__panzerDynamicBgmLowpassHz as number | undefined;
        if (typeof prevDynamic !== 'number' || !Number.isFinite(prevDynamic) || Math.abs(prevDynamic - dynamicLowpassHz) > 4) {
          (snd as any).__panzerDynamicBgmLowpassHz = dynamicLowpassHz;
          this.setLowpassFrequency(snd, dynamicLowpassHz);
        }
      }
    }
  }

  public getActiveSounds(): { key: string; url: string; volume: number; loop: boolean }[] {
    const list: { key: string; url: string; volume: number; loop: boolean }[] = [];

    // Loops
    for (const [id, snd] of this.loops.entries()) {
      if (snd.isPlaying) {
        list.push({
          key: this.loopFolderById.get(id) || 'unknown',
          url: (snd as any).__panzerUrl || '',
          volume: snd.volume,
          loop: true
        });
      }
    }

    // Exclusive sounds
    for (const [id, snd] of this.exclusiveSounds.entries()) {
      if (snd.isPlaying) {
        list.push({
          key: (snd as any).__panzerFolderKey || 'unknown',
          url: (snd as any).__panzerUrl || '',
          volume: snd.volume,
          loop: false
        });
      }
    }

    // One shots
    for (const snd of this.activeOneShots) {
      if (snd.isPlaying) {
        list.push({
          key: (snd as any).__panzerFolderKey || 'unknown',
          url: (snd as any).__panzerUrl || '',
          volume: snd.volume,
          loop: false
        });
      } else {
        // cleanup if somehow missed
        this.activeOneShots.delete(snd);
      }
    }

    return list;
  }

  public setListenerX(x: number) {
    this.listenerX = x;
  }

  private getFolders(): Record<string, string[]> {
    const anyManifest = sfxManifest as any;
    const folders = (anyManifest && typeof anyManifest === 'object' ? (anyManifest.folders ?? anyManifest) : null) as any;
    if (!folders || typeof folders !== 'object') return {};
    return folders as Record<string, string[]>;
  }

  private normalizeMixerPath(folderKey: string): string {
    return folderKey.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  }

  private normalizeFolderKey(folderKey: string): string {
    return folderKey.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  }

  private buildMixerTracks(): Map<string, MixerSettings> {
    const map = new Map<string, MixerSettings>();
    for (const track of MIXER_TRACKS) {
      const key = this.normalizeMixerPath(track.path);
      map.set(key, {
        volumeDb: track.volumeDb,
        lowpassHz: track.lowpassHz,
        highpassHz: track.highpassHz,
        pitchCents: track.pitchCents
      });
    }
    return map;
  }

  private getMixerSettingsForFolder(folderKey: string): MixerSettings {
    const normalized = this.normalizeFolderKey(folderKey);
    const key = this.normalizeMixerPath(`public/sfx/${normalized}`);
    
    const cached = this.mixerCache.get(key);
    if (cached) return cached;
    const parts = key.split('/').filter(Boolean);
    let volumeDb = 0;
    let lowpassHz = 0;
    let highpassHz = 0;
    let pitchCents = 0;
    for (let i = 1; i <= parts.length; i++) {
      const k = parts.slice(0, i).join('/');
      const track = this.mixerTracks.get(k);
      if (!track) continue;
      volumeDb += track.volumeDb;
      pitchCents += track.pitchCents;
      if (track.lowpassHz > 0) lowpassHz = lowpassHz > 0 ? Math.min(lowpassHz, track.lowpassHz) : track.lowpassHz;
      if (track.highpassHz > 0) highpassHz = Math.max(highpassHz, track.highpassHz);
    }
    const result = { volumeDb, lowpassHz, highpassHz, pitchCents };
    this.mixerCache.set(key, result);
    return result;
  }

  private dbToVolume(db: number): number {
    return Math.pow(10, db / 20);
  }

  private getUrlsForFolder(folderKey: string): { folder: string; urls: string[] } | null {
    const folders = this.getFolders();
    const key = this.normalizeFolderKey(folderKey);
    const direct = this.tryDirectFolderLookup(key, folders);
    if (direct) return direct;

    const dsFallback = this.tryDsSuffixFallback(key, folders);
    if (dsFallback) return dsFallback;

    const weaponAlt = this.tryWeaponStandardFallback(key, folders);
    if (weaponAlt) return weaponAlt;

    const parent = this.tryParentFallback(key, folders);
    if (parent) return parent;

    return null;
  }

  public hasFolderAudio(folderKey: string): boolean {
    const folders = this.getFolders();
    const key = this.normalizeFolderKey(folderKey);
    if (!key) return false;
    return this.tryDirectFolderLookup(key, folders) !== null;
  }

  public getFolderKeys(prefix?: string): string[] {
    const folders = this.getFolders();
    const keys = Object.keys(folders);
    if (!prefix) return keys.sort();
    const normalizedPrefix = this.normalizeFolderKey(prefix).toLowerCase();
    return keys
      .filter((k) => this.normalizeFolderKey(k).toLowerCase().startsWith(normalizedPrefix))
      .sort();
  }

  public getFolderUrls(folderKey: string): string[] {
    const resolved = this.getUrlsForFolder(folderKey);
    if (!resolved?.urls?.length) return [];
    return resolved.urls.slice();
  }

  private rebuildFolderLookup(folders: Record<string, string[]>) {
    if (this.folderLookupSource === folders) return;
    this.folderLookupSource = folders;
    this.folderKeyLookupLower.clear();
    for (const k of Object.keys(folders)) {
      const lower = this.normalizeFolderKey(k).toLowerCase();
      if (!this.folderKeyLookupLower.has(lower)) this.folderKeyLookupLower.set(lower, k);
    }
  }

  private tryDirectFolderLookup(key: string, folders: Record<string, string[]>): { folder: string; urls: string[] } | null {
    const direct = folders[key];
    if (Array.isArray(direct) && direct.length > 0) return { folder: key, urls: direct };

    this.rebuildFolderLookup(folders);
    const caseKey = this.folderKeyLookupLower.get(key.toLowerCase());
    if (!caseKey) return null;
    const urls = folders[caseKey];
    if (Array.isArray(urls) && urls.length > 0) return { folder: caseKey, urls };
    return null;
  }

  private tryDsSuffixFallback(key: string, folders: Record<string, string[]>): { folder: string; urls: string[] } | null {
    if (!key.includes('_DS')) return null;
    const altKey = key.replace(/_DS(?=\/|$)/g, '');
    if (altKey === key) return null;
    return this.tryDirectFolderLookup(altKey, folders);
  }

  private tryWeaponStandardFallback(key: string, folders: Record<string, string[]>): { folder: string; urls: string[] } | null {
    const m = key.match(/^weapon\/([^/]+)\/(.+)$/);
    if (!m) return null;
    const type = m[1];
    const rest = m[2];
    if (type === 'standard') return null;
    const altKey = `weapon/standard/${rest}`;
    return this.tryDirectFolderLookup(altKey, folders);
  }

  private tryParentFallback(key: string, folders: Record<string, string[]>): { folder: string; urls: string[] } | null {
    const parts = key.split('/').filter(Boolean);
    for (let i = parts.length - 1; i >= 1; i--) {
      const k = parts.slice(0, i).join('/');
      const hit = this.tryDirectFolderLookup(k, folders);
      if (hit) return hit;
    }
    return null;
  }

  private logMissingOnce(folderKey: string) {
    const key = this.normalizeFolderKey(folderKey);
    if (this.missingLogged.has(key)) return;
    this.missingLogged.add(key);
    try {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') console.warn(`[SFX missing] ${key}`);
    } catch {}
  }

  private shouldPlay(folderKey: string, cooldownMs: number | undefined): boolean {
    const cd = typeof cooldownMs === 'number' && Number.isFinite(cooldownMs) && cooldownMs > 0 ? cooldownMs : 0;
    const normalizedFolder = this.normalizeFolderKey(folderKey).replace(/^public\/sfx\//, '');

    // Keep shell/infantry kill one-shots from stacking into clipping.
    if (normalizedFolder.includes('killed_humans_and_animals_by_shell')) {
      const activeCount = Array.from(this.activeOneShots).filter(s => {
        const activeFolder = this.normalizeFolderKey(((s as any).__panzerFolderKey as string | undefined) ?? ((s as any).__panzerFolder as string | undefined) ?? '').replace(/^public\/sfx\//, '');
        return s.isPlaying && activeFolder.includes('killed_humans_and_animals_by_shell');
      }).length;
      if (activeCount >= 1) return false;
    }

    // Cap partial collapse random sample concurrency to protect mix headroom.
    if (normalizedFolder.includes('environment/forest/point_3d/static/buildings/default/partial_collapse/sfx')) {
      const activeCount = Array.from(this.activeOneShots).filter(s => {
        const activeFolder = this.normalizeFolderKey(((s as any).__panzerFolderKey as string | undefined) ?? ((s as any).__panzerFolder as string | undefined) ?? '').replace(/^public\/sfx\//, '');
        return s.isPlaying && activeFolder.includes('environment/forest/point_3d/static/buildings/default/partial_collapse/sfx');
      }).length;
      if (activeCount >= 2) return false;
    }

    if (cd <= 0) return true;
    const now = this.scene.time.now;
    const last = this.lastPlayedAt.get(folderKey) ?? 0;
    if (now < last + cd) return false;
    this.lastPlayedAt.set(folderKey, now);
    return true;
  }

  private makeShuffleSignature(urls: string[]): string {
    return urls.slice().sort().join('\u0001');
  }

  private shuffleUrls(urls: string[]): string[] {
    const arr = urls.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  private pickUrl(folderKey: string, urls: string[]): string {
    if (!Array.isArray(urls) || urls.length <= 0) return '';

    const uniqueUrls = Array.from(new Set(urls));
    if (uniqueUrls.length <= 1) return uniqueUrls[0] ?? '';

    const normalizedFolder = this.normalizeFolderKey(folderKey);
    const signature = this.makeShuffleSignature(uniqueUrls);
    const prevState = this.shuffleBagByFolder.get(normalizedFolder);

    const state: ShuffleBagState =
      prevState && prevState.signature === signature
        ? prevState
        : {
            signature,
            all: uniqueUrls,
            remaining: [],
            lastPicked:
              prevState && prevState.lastPicked && uniqueUrls.includes(prevState.lastPicked)
                ? prevState.lastPicked
                : null,
          };

    if (state.remaining.length <= 0) {
      state.remaining = this.shuffleUrls(state.all);
      if (state.lastPicked && state.remaining.length > 1 && state.remaining[0] === state.lastPicked) {
        const swapIdx = state.remaining.findIndex((u, idx) => idx > 0 && u !== state.lastPicked);
        if (swapIdx > 0) {
          const tmp = state.remaining[0];
          state.remaining[0] = state.remaining[swapIdx];
          state.remaining[swapIdx] = tmp;
        }
      }
    }

    const url = state.remaining.shift() ?? state.all[0] ?? '';
    state.lastPicked = url;
    this.shuffleBagByFolder.set(normalizedFolder, state);
    return url;
  }

  private computePan(worldX: number | undefined, panOverride: number | undefined): number {
    if (typeof panOverride === 'number' && Number.isFinite(panOverride)) return Phaser.Math.Clamp(panOverride, -1, 1);
    if (typeof worldX !== 'number' || !Number.isFinite(worldX)) return 0;
    const view = this.syncListenerFromCamera();
    const span = view ? Math.max(200, view.width * 0.6) : 900;
    return Phaser.Math.Clamp((worldX - this.listenerX) / span, -1, 1);
  }

  private shouldIgnoreDistanceAttenuation(folderKey: string): boolean {
    const key = this.normalizeFolderKey(folderKey);
    return key.includes('/hit_vehicle/');
  }

  private isWeaponForestReverbFolder(folderKey: string | undefined): boolean {
    if (!folderKey) return false;
    const key = this.normalizeFolderKey(folderKey).replace(/^public\/sfx\//, '');
    return key.startsWith('weapon/') && key.includes('/reverb_forest_after_explosion/');
  }

  private isPriorityWeaponForestReverb(folderKey: string | undefined): boolean {
    if (!folderKey) return false;
    const key = this.normalizeFolderKey(folderKey).replace(/^public\/sfx\//, '');
    return key.startsWith('weapon/nuke/reverb_forest_after_explosion/') || key.startsWith('weapon/mortar/reverb_forest_after_explosion/');
  }

  private isVehicleCookoffFolder(folderKey: string | undefined): boolean {
    if (!folderKey) return false;
    const key = this.normalizeFolderKey(folderKey).replace(/^public\/sfx\//, '');
    return key.startsWith('vehicle/') && key.includes('/cookoff/');
  }

  private isProjectileExplosionFolder(folderKey: string | undefined): boolean {
    if (!folderKey) return false;
    const key = this.normalizeFolderKey(folderKey).replace(/^public\/sfx\//, '');
    if (!key.startsWith('weapon/')) return false;
    return (
      this.folderHasSegment(key, 'explosion') ||
      this.folderHasSegment(key, 'ground_hit_forest') ||
      this.folderHasSegment(key, 'hit_vehicle') ||
      this.folderHasSegment(key, 'reverb_forest_after_explosion') ||
      this.folderHasSegment(key, 'reverb_after_explosion')
    );
  }

  private getDistanceAttenuationFloor(folderKey: string | undefined): number {
    if (!this.isProjectileExplosionFolder(folderKey)) return 0;
    return this.projectileExplosionAttenuationFloor;
  }

  private computeExplosionDistanceLowpassHz(
    folderKey: string | undefined,
    attenuation: number,
    mixerLowpassHz: number
  ): number | null {
    if (!this.isProjectileExplosionFolder(folderKey)) return null;
    const nearHz = mixerLowpassHz > 0 ? mixerLowpassHz : 30000;
    const farHz = Math.min(nearHz, this.projectileExplosionFarLowpassHz);
    const t = Phaser.Math.Clamp(1 - attenuation, 0, 1);
    return Phaser.Math.Linear(nearHz, farHz, t);
  }

  private getReverbYieldMultiplier(sound: Phaser.Sound.BaseSound, now: number): number {
    const yieldFrom = Number((sound as any).__panzerReverbYieldFromAt ?? 0);
    if (!Number.isFinite(yieldFrom) || yieldFrom <= 0) return 1;
    const elapsed = Math.max(0, now - yieldFrom);
    const t = Phaser.Math.Clamp(elapsed / this.reverbYieldDurationMs, 0, 1);
    return 1 - t;
  }

  private applyWeaponForestReverbDynamics(sound: ManagedSound, folderKey: string | undefined, now: number): number {
    const isReverb = this.isWeaponForestReverbFolder(folderKey);
    if (!isReverb) return 1;

    const lowpass = this.getReverbYieldMultiplier(sound, now);
    const lowpassHz = Phaser.Math.Linear(30000, 120, 1 - lowpass);
    this.setLowpassFrequency(sound, lowpassHz);

    return lowpass;
  }

  private computeWeaponForestReverbPan(sound: ManagedSound, now: number): number {
    const sourcePan = Number((sound as any).__panzerReverbSourcePan ?? 0);
    if (!Number.isFinite(sourcePan)) return 0;

    const startAt = Number((sound as any).__panzerReverbStartedAt ?? 0);
    if (!Number.isFinite(startAt) || startAt <= 0) return sourcePan;

    const elapsed = Math.max(0, now - startAt);
    if (elapsed <= this.reverbPanRecenterDelayMs) return sourcePan;

    const t = Phaser.Math.Clamp(
      (elapsed - this.reverbPanRecenterDelayMs) / this.reverbPanRecenterDurationMs,
      0,
      1
    );
    return Phaser.Math.Linear(sourcePan, 0, t);
  }

  private updateWeaponForestReverbPriority(now: number) {
    const all: ManagedSound[] = [];
    for (const snd of this.activeOneShots) {
      if (snd?.isPlaying) all.push(snd);
    }
    for (const snd of this.exclusiveSounds.values()) {
      if (snd?.isPlaying) all.push(snd);
    }

    const reverbs = all.filter(snd => this.isWeaponForestReverbFolder((snd as any).__panzerFolderKey as string | undefined));
    if (reverbs.length <= 0) return;

    const priority = reverbs.filter(snd => this.isPriorityWeaponForestReverb((snd as any).__panzerFolderKey as string | undefined));
    const normal = reverbs.filter(snd => !this.isPriorityWeaponForestReverb((snd as any).__panzerFolderKey as string | undefined));

    let orderedNormal: ManagedSound[] = normal;
    if (orderedNormal.length > 1) {
      orderedNormal = orderedNormal
        .slice()
        .sort((a, b) => (Number((a as any).__panzerReverbStartSerial ?? 0) - Number((b as any).__panzerReverbStartSerial ?? 0)));
    }

    for (const snd of orderedNormal) {
      (snd as any).__panzerReverbPriorityGroup = 'normal';
    }
    for (const snd of priority) {
      (snd as any).__panzerReverbPriorityGroup = 'priority';
    }

    if (priority.length > 0) {
      for (const snd of orderedNormal) {
        const existing = Number((snd as any).__panzerReverbYieldFromAt ?? 0);
        if (!Number.isFinite(existing) || existing <= 0) {
          (snd as any).__panzerReverbYieldFromAt = now;
        }
      }
      for (const snd of priority) {
        (snd as any).__panzerReverbYieldFromAt = 0;
      }
      return;
    }

    if (orderedNormal.length < 3) {
      for (const snd of orderedNormal) {
        (snd as any).__panzerReverbYieldFromAt = 0;
      }
      return;
    }

    const newest = orderedNormal[orderedNormal.length - 1];
    const secondNewest = orderedNormal[orderedNormal.length - 2];
    const oldest = orderedNormal[0];

    (newest as any).__panzerReverbYieldFromAt = 0;
    (secondNewest as any).__panzerReverbYieldFromAt = 0;

    const existing = Number((oldest as any).__panzerReverbYieldFromAt ?? 0);
    if (!Number.isFinite(existing) || existing <= 0) {
      (oldest as any).__panzerReverbYieldFromAt = now;
    }

    for (let i = 1; i < orderedNormal.length - 2; i++) {
      const snd = orderedNormal[i];
      const t = Number((snd as any).__panzerReverbYieldFromAt ?? 0);
      if (!Number.isFinite(t) || t <= 0) (snd as any).__panzerReverbYieldFromAt = now;
    }
  }

  private computeAttenuation(
    worldX: number | undefined,
    worldY: number | undefined,
    maxDistance: number | undefined,
    attenuationFloor: number = 0
  ): number {
    if (typeof worldX !== 'number' || !Number.isFinite(worldX)) return 1;
    this.syncListenerFromCamera();
    if (!Number.isFinite(this.listenerX) || !Number.isFinite(this.listenerY)) return 1;
    const md = typeof maxDistance === 'number' && Number.isFinite(maxDistance) && maxDistance > 0 ? maxDistance : 2200;
    const floor = Phaser.Math.Clamp(attenuationFloor, 0, 0.95);
    const dx = worldX - this.listenerX;
    const dy = typeof worldY === 'number' && Number.isFinite(worldY) ? (worldY - this.listenerY) : 0;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (!Number.isFinite(d)) return 1;
    if (d <= 0) return 1;
    if (d >= md) return floor;

    const k = d / md;
    const shaped = Phaser.Math.Clamp(Math.pow(1 - k, 0.75), 0, 1);
    return Phaser.Math.Clamp(floor + (1 - floor) * shaped, floor, 1);
  }

  private hashKeyForUrl(url: string): string {
    let h = 2166136261;
    for (let i = 0; i < url.length; i++) {
      h ^= url.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `sfx_${(h >>> 0).toString(16)}`;
  }

  private makeKeyForUrl(url: string, logMapping = true): string {
    const existing = this.urlToKey.get(url);
    if (existing) return existing;
    const key = this.hashKeyForUrl(url);
    if (logMapping && this.enableAudioKeyMappingLog) {
      // Log the mapping for debugging decode errors.
      console.log(`[SoundManager] Key Mapping: ${key} -> ${url}`);
    }
    this.urlToKey.set(url, key);
    return key;
  }

  private getEligibleBackgroundPrewarmUrlCandidates(maxTotalUrls = 320): string[] {
    const folders = this.getFolders();
    if (!folders || typeof folders !== 'object') return [];

    const allUrls: string[] = [];
    const seen = new Set<string>();

    const scoreForFolder = (folderKey: string): number => {
      if (!folderKey) return 0;
      let score = 0;
      if (folderKey.startsWith('weapon/')) score += 12;
      if (folderKey.includes('/fire/')) score += 8;
      if (folderKey.includes('/explosion/')) score += 10;
      if (folderKey.includes('/ground_hit_forest/')) score += 8;
      if (folderKey.includes('/hit_vehicle/')) score += 8;
      if (folderKey.includes('/reverb_forest_after_explosion/')) score += 10;
      if (folderKey.includes('/flight_loop/')) score += 6;
      if (folderKey.startsWith('vehicle/')) score += 6;
      if (folderKey.startsWith('environment/forest/ambient_2d/')) score += 4;
      if (folderKey.startsWith('bgm/')) score += 5;
      if (folderKey.includes('/menu/')) score += 2;
      return score;
    };

    const entries = Object.entries(folders)
      .filter(([, urls]) => Array.isArray(urls) && urls.length > 0)
      .map(([folderKey, urls]) => ({ folderKey, urls: urls as string[], score: scoreForFolder(folderKey) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.folderKey.localeCompare(b.folderKey);
      });

    for (const entry of entries) {
      if (allUrls.length >= maxTotalUrls) break;
      for (const url of entry.urls) {
        if (allUrls.length >= maxTotalUrls) break;
        if (!url || seen.has(url)) continue;
        seen.add(url);
        allUrls.push(url);
      }
    }

    return allUrls;
  }

  private getAllManifestUrls(priority?: AudioLoadingPriority): string[] {
    const folders = this.getFolders();
    if (!folders || typeof folders !== 'object') return [];
    
    const out: string[] = [];
    const seen = new Set<string>();
    
    for (const [folderKey, urls] of Object.entries(folders)) {
      if (!Array.isArray(urls) || urls.length === 0) continue;
      
      const rule = AUDIO_LOADING_RULES.find(r => {
        if (typeof r.pattern === 'string') return folderKey === r.pattern;
        return r.pattern.test(folderKey);
      });
      
      if (!rule) continue;
      if (priority && rule.priority !== priority) continue;
      
      const count = rule.samplesCount === 'all' ? urls.length : rule.samplesCount;
      
      for (let i = 0; i < Math.min(count, urls.length); i++) {
        const url = urls[i];
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push(url);
      }
    }
    
    return out;
  }

  private static emitSessionAudioPackProgress(loaded: number, total: number) {
    for (const listener of SoundManager.sessionAudioPackProgressListeners) {
      try {
        listener(loaded, total);
      } catch {}
    }
  }

  public static onSessionAudioPackProgress(listener: (loaded: number, total: number) => void): () => void {
    SoundManager.sessionAudioPackProgressListeners.add(listener);
    try {
      listener(SoundManager.sessionAudioPackLoaded, SoundManager.sessionAudioPackTotal);
    } catch {}
    return () => {
      SoundManager.sessionAudioPackProgressListeners.delete(listener);
    };
  }

  public static isSessionAudioPackReady(): boolean {
    return SoundManager.sessionAudioPackReady;
  }

  public ensureSessionAudioPack(options?: { priority?: AudioLoadingPriority; concurrency?: number; onProgress?: (loaded: number, total: number) => void }): Promise<void> {
    if (options?.priority) {
      const urls = this.getAllManifestUrls(options.priority);
      const total = urls.length;
      
      console.log(`[SoundManager] Priority ${options.priority} loading: ${total} files`);
      console.log(`[SoundManager] Sample URLs:`, urls.slice(0, 5));
      
      if (total <= 0) {
        console.warn(`[SoundManager] No files found for priority ${options.priority}`);
        options?.onProgress?.(0, 0);
        return Promise.resolve();
      }
      
      const concurrency = Phaser.Math.Clamp(Math.floor(options?.concurrency ?? 5), 1, 10);
      const queue = urls.slice();
      let loaded = 0;
      
      options?.onProgress?.(0, total);
      
      const runWorker = async () => {
        while (queue.length > 0 && !this.destroyed) {
          const url = queue.shift();
          if (!url) continue;
          try {
            await this.ensureLoaded(url);
          } catch (err) {
            console.error(`[SoundManager] Failed to load: ${url}`, err);
          }
          loaded += 1;
          options?.onProgress?.(loaded, total);
        }
      };
      
      const workers = Array.from({ length: Math.min(concurrency, total) }, () => runWorker());
      return Promise.all(workers).then(() => {
        console.log(`[SoundManager] Priority ${options.priority} loading completed: ${loaded}/${total}`);
      });
    }
    
    if (SoundManager.sessionAudioPackReady) {
      const total = Math.max(SoundManager.sessionAudioPackTotal, SoundManager.sessionAudioPackLoaded);
      options?.onProgress?.(total, total);
      return Promise.resolve();
    }

    const onProgress = options?.onProgress;
    let unsubscribe: (() => void) | null = null;
    if (onProgress) {
      unsubscribe = SoundManager.onSessionAudioPackProgress(onProgress);
    }

    if (!SoundManager.sessionAudioPackPromise) {
      const urls = this.getAllManifestUrls();
      const total = urls.length;
      SoundManager.sessionAudioPackTotal = total;
      SoundManager.sessionAudioPackLoaded = 0;
      SoundManager.emitSessionAudioPackProgress(0, total);

      const concurrency = Phaser.Math.Clamp(Math.floor(options?.concurrency ?? 5), 1, 10);
      const queue = urls.slice();

      const runWorker = async () => {
        while (queue.length > 0 && !this.destroyed) {
          const url = queue.shift();
          if (!url) continue;
          try {
            await this.ensureLoaded(url);
          } catch {}
          SoundManager.sessionAudioPackLoaded += 1;
          SoundManager.emitSessionAudioPackProgress(SoundManager.sessionAudioPackLoaded, total);
        }
      };

      SoundManager.sessionAudioPackPromise = (async () => {
        if (total <= 0) {
          SoundManager.sessionAudioPackReady = true;
          SoundManager.emitSessionAudioPackProgress(0, 0);
          return;
        }
        const workers = Array.from({ length: Math.min(concurrency, total) }, () => runWorker());
        await Promise.all(workers);
        SoundManager.sessionAudioPackReady = true;
        SoundManager.emitSessionAudioPackProgress(total, total);
      })();
    }

    return SoundManager.sessionAudioPackPromise.finally(() => {
      if (unsubscribe) unsubscribe();
    });
  }

  private scheduleBackgroundPrewarm(urls: string[]) {
    if (this.destroyed) return;
    if (!Array.isArray(urls) || urls.length <= 0) return;

    const queued = new Set(this.backgroundPrewarmQueue);
    for (const url of urls) {
      if (!url || queued.has(url)) continue;
      if (this.isUrlLoaded(url)) continue;
      queued.add(url);
      this.backgroundPrewarmQueue.push(url);
    }

    if (this.backgroundPrewarmTimer?.getProgress() !== undefined) return;

    this.backgroundPrewarmTimer = this.scene.time.addEvent({
      delay: this.backgroundPrewarmTickMs,
      loop: true,
      callback: () => {
        if (this.destroyed) {
          this.backgroundPrewarmTimer?.remove(false);
          this.backgroundPrewarmTimer = null;
          this.backgroundPrewarmQueue.length = 0;
          return;
        }

        while (
          this.backgroundPrewarmInFlight < this.backgroundPrewarmMaxConcurrent &&
          this.backgroundPrewarmQueue.length > 0
        ) {
          const url = this.backgroundPrewarmQueue.shift();
          if (!url || this.isUrlLoaded(url)) continue;

          this.backgroundPrewarmInFlight += 1;
          this.ensureLoaded(url)
            .catch(() => {})
            .finally(() => {
              this.backgroundPrewarmInFlight = Math.max(0, this.backgroundPrewarmInFlight - 1);
            });
        }

        if (this.backgroundPrewarmQueue.length <= 0 && this.backgroundPrewarmInFlight <= 0) {
          this.backgroundPrewarmTimer?.remove(false);
          this.backgroundPrewarmTimer = null;
        }
      }
    });
  }

  private isKeyLoaded(key: string): boolean {
    if (this.loaded.has(key)) return true;
    const audioCache: any = (this.scene.cache as any)?.audio;
    if (audioCache?.exists?.(key)) {
      this.loaded.add(key);
      return true;
    }
    return false;
  }

  private isUrlLoaded(url: string): boolean {
    const key = this.makeKeyForUrl(url, false);
    return this.isKeyLoaded(key);
  }

  private ensureLoaded(url: string): Promise<string> {
    const key = this.makeKeyForUrl(url, true);
    if (this.loaded.has(key)) return Promise.resolve(key);
    if (this.destroyed) return Promise.reject(new Error(`SoundManager destroyed before loading: ${url}`));

    const audioCache: any = (this.scene.cache as any)?.audio;
    if (audioCache?.exists?.(key)) {
      this.loaded.add(key);
      return Promise.resolve(key);
    }

    const pending = this.loading.get(key);
    if (pending) return pending;

    const p = new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        this.scene.load.off(`filecomplete-audio-${key}`, onComplete as any);
        this.scene.load.off('loaderror', onError as any);
      };

      const onComplete = (fileKey: string) => {
        if (fileKey !== key) return;
        cleanup();
        this.loaded.add(key);
        this.loading.delete(key);
        resolve(key);
      };

      const onError = (file: any) => {
        if (!file || file.key !== key) return;
        cleanup();
        this.loading.delete(key);
        console.error(`SoundManager: Failed to load audio file. URL: ${url} Key: ${key}`);
        reject(new Error(`Failed to load audio: ${url}`));
      };

      try {
        if (audioCache?.exists?.(key)) {
          this.loaded.add(key);
          this.loading.delete(key);
          resolve(key);
          return;
        }

        this.scene.load.on(`filecomplete-audio-${key}`, onComplete as any);
        this.scene.load.on('loaderror', onError as any);
        this.scene.load.audio(key, [url]);
        if (!this.scene.load.isLoading()) this.scene.load.start();
      } catch (err) {
        cleanup();
        this.loading.delete(key);
        if (audioCache?.exists?.(key)) {
          this.loaded.add(key);
          resolve(key);
          return;
        }
        reject(err instanceof Error ? err : new Error(`Failed to queue audio: ${url}`));
      }
    });

    this.loading.set(key, p);
    return p;
  }

  public prewarmFolders(folderKeys: string[], maxUrlsPerFolder = 2, maxTotalUrls = 24) {
    if (this.destroyed) return;
    if (!Array.isArray(folderKeys) || folderKeys.length === 0) return;

    const urlsToLoad: string[] = [];
    const seen = new Set<string>();

    for (const folderKey of folderKeys) {
      if (urlsToLoad.length >= maxTotalUrls) break;
      const resolved = this.getUrlsForFolder(folderKey);
      if (!resolved) continue;
      const take = Math.min(maxUrlsPerFolder, resolved.urls.length);
      for (let i = 0; i < take && urlsToLoad.length < maxTotalUrls; i++) {
        const url = resolved.urls[i];
        if (!url || seen.has(url)) continue;
        seen.add(url);
        urlsToLoad.push(url);
      }
    }

    for (const url of urlsToLoad) {
      this.ensureLoaded(url).catch(() => {});
    }
  }

  public prewarmCritical() {
    const folders: string[] = [
      'vehicle/player_soviet/idle_engine_loop/sfx',
      'vehicle/player_soviet/shutdown/sfx',
      'vehicle/player_soviet/cruise/mechanical_loop/sfx',
      'weapon/heavy_machine_gun/fire/tail/last_shot/sfx',
      'weapon/heavy_machine_gun/fire/loop/sfx',
      'weapon/standard/fire/sfx',
      'weapon/standard/flight_loop/sfx',
      'weapon/standard/explosion/sfx',
      'weapon/standard/hit_vehicle/sfx',
      'weapon/standard/reverb/sfx',
      'bgm/forest/non_combat/sfx',
      'bgm/forest/combat/sfx',
      'bgm/forest/pre_final_safe_zone/sfx',
      'bgm/forest/enemy_hunter_intro/sfx',
      'bgm/forest/end/sfx',
      'bgm/desert/sfx'
    ];

    if (this.scene.mapId === 'forest') {
      folders.push(
        'vehicle/player_soviet/cruise/tire_forest_loop/sfx',
        'weapon/standard/ground_hit_forest/sfx',
        'weapon/standard/reverb_forest_after_explosion/sfx',
        'environment/forest/ambient_2d/weather/forest_rain/sfx',
        'environment/forest/ambient_2d/weather/black_rain/sfx',
        'environment/forest/ambient_2d/lake_loop/sfx',
        'environment/forest/point_3d/creatures/birds_flock/scream/sfx',
        'environment/forest/point_3d/creatures/birds_flock/wing_flap/sfx'
      );
    }

    this.prewarmFolders(folders, 2, 40);

    // Background streaming preload for online hosting: keep startup snappy,
    // then gradually decode high-impact SFX variants to reduce first-hit latency.
    const progressiveUrls = this.getEligibleBackgroundPrewarmUrlCandidates(320);
    this.scheduleBackgroundPrewarm(progressiveUrls);
  }

  public async playFolder(folderKey: string, opts?: SoundPlayOptions): Promise<Phaser.Sound.BaseSound | null> {
    if (this.destroyed) return null;
    const resolved = this.getUrlsForFolder(folderKey);
    if (!resolved) {
      this.logMissingOnce(folderKey);
      return null;
    }
    if (!this.shouldPlay(resolved.folder, opts?.cooldownMs)) {
      // console.log(`SoundManager: playFolder skipped due to cooldown: ${folderKey}`);
      return null;
    }

    const url = this.pickUrl(resolved.folder, resolved.urls);
    try {
      const key = await this.ensureLoaded(url);
      const mix = this.getMixerSettingsForFolder(resolved.folder);
      const mixVol = this.dbToVolume(mix.volumeDb);
      const baseVol = (typeof opts?.volume === 'number' && Number.isFinite(opts.volume) ? opts.volume : 1) * mixVol;
      const worldX = typeof opts?.worldX === 'number' && Number.isFinite(opts.worldX) ? opts.worldX : undefined;
      const worldY = typeof opts?.worldY === 'number' && Number.isFinite(opts.worldY) ? opts.worldY : undefined;
      const pan = this.computePan(worldX, opts?.pan);
      const ignoreDistanceAttenuation = this.shouldIgnoreDistanceAttenuation(resolved.folder);
      const attenuationFloor = this.getDistanceAttenuationFloor(resolved.folder);
      const att = ignoreDistanceAttenuation ? 1 : this.computeAttenuation(worldX, worldY, opts?.maxDistance, attenuationFloor);
      const snd = this.scene.sound.add(key, { loop: false, volume: Phaser.Math.Clamp(baseVol * att, 0, 2) }) as ManagedSound;
      if (typeof snd.setPan === 'function') snd.setPan(pan);
      const rate = typeof opts?.rate === 'number' && Number.isFinite(opts.rate) ? opts.rate : 1;
      const detune = (typeof opts?.detune === 'number' && Number.isFinite(opts.detune) ? opts.detune : 0) + mix.pitchCents;
      try {
        snd.setRate?.(rate);
      } catch {}
      try {
        snd.setDetune?.(Phaser.Math.Clamp(detune, -2400, 2400));
      } catch {}
      if (mix.lowpassHz > 0) this.setLowpassFrequency(snd, mix.lowpassHz);
      if (mix.highpassHz > 0) this.setHighpassFrequency(snd, mix.highpassHz);
      const distanceLowpassHz = this.computeExplosionDistanceLowpassHz(resolved.folder, att, mix.lowpassHz);
      if (typeof distanceLowpassHz === 'number' && Number.isFinite(distanceLowpassHz)) {
        this.setLowpassFrequency(snd, distanceLowpassHz);
      }
      (snd as any).__panzerWorldX = worldX;
      (snd as any).__panzerWorldY = worldY;
      (snd as any).__panzerMaxDistance = opts?.maxDistance;
      (snd as any).__panzerPan = opts?.pan;
      (snd as any).__panzerFolderKey = resolved.folder;
      (snd as any).__panzerUrl = url;
      (snd as any).__panzerFolder = folderKey;
      (snd as any).__panzerBaseVolume = baseVol;
      (snd as any).__panzerBaseAttenuation = att;
      (snd as any).__panzerTrackPosition = opts?.trackPosition === true;
      if (this.isWeaponForestReverbFolder(resolved.folder)) {
        this.reverbStartSerial += 1;
        (snd as any).__panzerReverbStartSerial = this.reverbStartSerial;
        (snd as any).__panzerReverbYieldFromAt = 0;
        (snd as any).__panzerReverbStartedAt = this.scene.time.now;
        (snd as any).__panzerReverbSourcePan = pan;
      }

      this.activeOneShots.add(snd);
      snd.once('complete', () => {
        this.activeOneShots.delete(snd);
        try {
          this.detachLowpass(snd);
          snd.destroy();
        } catch {}
      });
      snd.play();
      return snd;
    } catch {
      this.logMissingOnce(folderKey);
      return null;
    }
  }

  public async playFolderExclusive(id: string, folderKey: string, opts?: SoundPlayOptions): Promise<Phaser.Sound.BaseSound | null> {
    if (this.destroyed) return null;
    const tok = (this.exclusiveToken.get(id) ?? 0) + 1;
    this.exclusiveToken.set(id, tok);

    const prev = this.exclusiveSounds.get(id);
    if (prev) {
      try {
        this.detachLowpass(prev);
        prev.stop();
      } catch {}
      try {
        prev.destroy();
      } catch {}
      this.exclusiveSounds.delete(id);
    }

    const resolved = this.getUrlsForFolder(folderKey);
    if (!resolved) {
      this.logMissingOnce(folderKey);
      return null;
    }
    if (!this.shouldPlay(resolved.folder, opts?.cooldownMs)) return null;

    const url = this.pickUrl(resolved.folder, resolved.urls);
    try {
      const key = await this.ensureLoaded(url);
      if (this.destroyed) return null;
      if ((this.exclusiveToken.get(id) ?? 0) !== tok) return null;

      const mix = this.getMixerSettingsForFolder(resolved.folder);
      const mixVol = this.dbToVolume(mix.volumeDb);
      const baseVol = (typeof opts?.volume === 'number' && Number.isFinite(opts.volume) ? opts.volume : 1) * mixVol;
      const worldX = typeof opts?.worldX === 'number' && Number.isFinite(opts.worldX) ? opts.worldX : undefined;
      const worldY = typeof opts?.worldY === 'number' && Number.isFinite(opts.worldY) ? opts.worldY : undefined;
      const pan = this.computePan(worldX, opts?.pan);
      const ignoreDistanceAttenuation = this.shouldIgnoreDistanceAttenuation(resolved.folder);
      const attenuationFloor = this.getDistanceAttenuationFloor(resolved.folder);
      const att = ignoreDistanceAttenuation ? 1 : this.computeAttenuation(worldX, worldY, opts?.maxDistance, attenuationFloor);
      const snd = this.scene.sound.add(key, { loop: false, volume: Phaser.Math.Clamp(baseVol * att, 0, 2) }) as ManagedSound;
      if (typeof snd.setPan === 'function') snd.setPan(pan);
      const rate = typeof opts?.rate === 'number' && Number.isFinite(opts.rate) ? opts.rate : 1;
      const detune = (typeof opts?.detune === 'number' && Number.isFinite(opts.detune) ? opts.detune : 0) + mix.pitchCents;
      try {
        snd.setRate?.(rate);
      } catch {}
      try {
        snd.setDetune?.(Phaser.Math.Clamp(detune, -2400, 2400));
      } catch {}
      if (mix.lowpassHz > 0) this.setLowpassFrequency(snd, mix.lowpassHz);
      if (mix.highpassHz > 0) this.setHighpassFrequency(snd, mix.highpassHz);
      const distanceLowpassHz = this.computeExplosionDistanceLowpassHz(resolved.folder, att, mix.lowpassHz);
      if (typeof distanceLowpassHz === 'number' && Number.isFinite(distanceLowpassHz)) {
        this.setLowpassFrequency(snd, distanceLowpassHz);
      }
      (snd as any).__panzerWorldX = worldX;
      (snd as any).__panzerWorldY = worldY;
      (snd as any).__panzerMaxDistance = opts?.maxDistance;
      (snd as any).__panzerPan = opts?.pan;
      (snd as any).__panzerFolderKey = resolved.folder;
      (snd as any).__panzerUrl = url;
      (snd as any).__panzerBaseVolume = baseVol;
      (snd as any).__panzerBaseAttenuation = att;
      (snd as any).__panzerTrackPosition = opts?.trackPosition === true;
      if (this.isWeaponForestReverbFolder(resolved.folder)) {
        this.reverbStartSerial += 1;
        (snd as any).__panzerReverbStartSerial = this.reverbStartSerial;
        (snd as any).__panzerReverbYieldFromAt = 0;
        (snd as any).__panzerReverbStartedAt = this.scene.time.now;
        (snd as any).__panzerReverbSourcePan = pan;
      }

      this.exclusiveSounds.set(id, snd);
      snd.once('complete', () => {
        try {
          this.detachLowpass(snd);
          snd.destroy();
        } catch {}
        if (this.exclusiveSounds.get(id) === snd) this.exclusiveSounds.delete(id);
      });
      snd.play();
      return snd;
    } catch {
      this.logMissingOnce(folderKey);
      return null;
    }
  }

  public async playFolderExclusiveCrossfade(
    id: string,
    folderKey: string,
    opts?: SoundPlayOptions,
    fadeOutMs: number = 500
  ): Promise<Phaser.Sound.BaseSound | null> {
    if (this.destroyed) return null;
    const tok = (this.exclusiveToken.get(id) ?? 0) + 1;
    this.exclusiveToken.set(id, tok);

    const prev = this.exclusiveSounds.get(id);
    if (prev) {
      const t = (prev as any).__panzerExclusiveFadeTween as Phaser.Tweens.Tween | undefined;
      if (t) {
        try {
          t.stop();
        } catch {}
        delete (prev as any).__panzerExclusiveFadeTween;
      }

      const ms = typeof fadeOutMs === 'number' && Number.isFinite(fadeOutMs) ? fadeOutMs : 0;
      if (ms > 0) {
        let from = 0;
        try {
          const v = (prev as any).volume as number | undefined;
          if (typeof v === 'number' && Number.isFinite(v)) from = v;
        } catch {}
        const obj = { v: from };
        const tween = this.scene.tweens.add({
          targets: obj,
          v: 0,
          duration: Math.max(1, ms | 0),
          ease: 'Linear',
          onUpdate: () => {
            try {
              prev.setVolume(obj.v);
            } catch {}
          },
          onComplete: () => {
            delete (prev as any).__panzerExclusiveFadeTween;
            try {
              this.detachLowpass(prev);
              prev.stop();
            } catch {}
            try {
              prev.destroy();
            } catch {}
          }
        });
        (prev as any).__panzerExclusiveFadeTween = tween;
      } else {
        try {
          this.detachLowpass(prev);
          prev.stop();
        } catch {}
        try {
          prev.destroy();
        } catch {}
      }

      this.exclusiveSounds.delete(id);
    }

    const resolved = this.getUrlsForFolder(folderKey);
    if (!resolved) {
      this.logMissingOnce(folderKey);
      return null;
    }
    if (!this.shouldPlay(resolved.folder, opts?.cooldownMs)) return null;

    const url = this.pickUrl(resolved.folder, resolved.urls);
    try {
      const key = await this.ensureLoaded(url);
      if (this.destroyed) return null;
      if ((this.exclusiveToken.get(id) ?? 0) !== tok) return null;

      const mix = this.getMixerSettingsForFolder(resolved.folder);
      const mixVol = this.dbToVolume(mix.volumeDb);
      const baseVol = (typeof opts?.volume === 'number' && Number.isFinite(opts.volume) ? opts.volume : 1) * mixVol;
      const worldX = typeof opts?.worldX === 'number' && Number.isFinite(opts.worldX) ? opts.worldX : undefined;
      const worldY = typeof opts?.worldY === 'number' && Number.isFinite(opts.worldY) ? opts.worldY : undefined;
      const pan = this.computePan(worldX, opts?.pan);
      const ignoreDistanceAttenuation = this.shouldIgnoreDistanceAttenuation(resolved.folder);
      const attenuationFloor = this.getDistanceAttenuationFloor(resolved.folder);
      const att = ignoreDistanceAttenuation ? 1 : this.computeAttenuation(worldX, worldY, opts?.maxDistance, attenuationFloor);
      const snd = this.scene.sound.add(key, { loop: false, volume: Phaser.Math.Clamp(baseVol * att, 0, 2) }) as ManagedSound;
      if (typeof snd.setPan === 'function') snd.setPan(pan);
      const rate = typeof opts?.rate === 'number' && Number.isFinite(opts.rate) ? opts.rate : 1;
      const detune = (typeof opts?.detune === 'number' && Number.isFinite(opts.detune) ? opts.detune : 0) + mix.pitchCents;
      try {
        snd.setRate?.(rate);
      } catch {}
      try {
        snd.setDetune?.(Phaser.Math.Clamp(detune, -2400, 2400));
      } catch {}
      if (mix.lowpassHz > 0) this.setLowpassFrequency(snd, mix.lowpassHz);
      if (mix.highpassHz > 0) this.setHighpassFrequency(snd, mix.highpassHz);
      const distanceLowpassHz = this.computeExplosionDistanceLowpassHz(resolved.folder, att, mix.lowpassHz);
      if (typeof distanceLowpassHz === 'number' && Number.isFinite(distanceLowpassHz)) {
        this.setLowpassFrequency(snd, distanceLowpassHz);
      }
      (snd as any).__panzerWorldX = worldX;
      (snd as any).__panzerWorldY = worldY;
      (snd as any).__panzerMaxDistance = opts?.maxDistance;
      (snd as any).__panzerPan = opts?.pan;
      (snd as any).__panzerFolderKey = resolved.folder;
      (snd as any).__panzerUrl = url;
      (snd as any).__panzerBaseVolume = baseVol;
      (snd as any).__panzerBaseAttenuation = att;
      (snd as any).__panzerTrackPosition = opts?.trackPosition === true;
      if (this.isWeaponForestReverbFolder(resolved.folder)) {
        this.reverbStartSerial += 1;
        (snd as any).__panzerReverbStartSerial = this.reverbStartSerial;
        (snd as any).__panzerReverbYieldFromAt = 0;
        (snd as any).__panzerReverbStartedAt = this.scene.time.now;
        (snd as any).__panzerReverbSourcePan = pan;
      }

      this.exclusiveSounds.set(id, snd);
      snd.once('complete', () => {
        try {
          this.detachLowpass(snd);
          snd.destroy();
        } catch {}
        if (this.exclusiveSounds.get(id) === snd) this.exclusiveSounds.delete(id);
      });
      snd.play();
      return snd;
    } catch {
      this.logMissingOnce(folderKey);
      return null;
    }
  }

  public stopExclusive(id: string, fadeOutMs?: number) {
    const snd = this.exclusiveSounds.get(id);
    this.exclusiveToken.set(id, (this.exclusiveToken.get(id) ?? 0) + 1);
    if (!snd) return;

    const fadeTween = (snd as any).__panzerExclusiveFadeTween as Phaser.Tweens.Tween | undefined;
    if (fadeTween) {
      try {
        fadeTween.stop();
      } catch {}
      delete (snd as any).__panzerExclusiveFadeTween;
    }

    this.exclusiveSounds.delete(id);

    const dispose = () => {
      try {
        this.detachLowpass(snd);
        snd.stop();
      } catch {}
      try {
        snd.destroy();
      } catch {}
    };

    const ms = typeof fadeOutMs === 'number' && Number.isFinite(fadeOutMs) ? Math.max(0, fadeOutMs | 0) : 0;
    if (ms <= 0 || !snd.isPlaying) {
      dispose();
      return;
    }

    let from = 0;
    try {
      const v = (snd as any).volume as number | undefined;
      if (typeof v === 'number' && Number.isFinite(v)) from = v;
    } catch {}

    const obj = { v: from };
    const tween = this.scene.tweens.add({
      targets: obj,
      v: 0,
      duration: ms,
      ease: 'Linear',
      onUpdate: () => {
        try {
          snd.setVolume(obj.v);
        } catch {}
      },
      onComplete: () => {
        delete (snd as any).__panzerExclusiveFadeTween;
        dispose();
      }
    });
    (snd as any).__panzerExclusiveFadeTween = tween;
  }

  public async startLoop(id: string, folderKey: string, opts?: LoopOptions): Promise<Phaser.Sound.BaseSound | null> {
    if (this.destroyed) return null;
    const existing = this.loops.get(id);
    if (existing) {
      const snd = existing as ManagedSound;

      const prevTween = this.loopFadeTween.get(id);
      if (prevTween) {
        try {
          prevTween.stop();
        } catch {}
        this.loopFadeTween.delete(id);
      }

      if (!snd.isPlaying) {
        if (this.isAudioUnlocked()) {
          try {
            snd.play();
          } catch {
            this.armLoopUnlockRetry(id, snd, 0);
          }
        } else {
          this.armLoopUnlockRetry(id, snd, 0);
        }
      }

      const worldX = typeof opts?.worldX === 'number' && Number.isFinite(opts.worldX) ? opts.worldX : undefined;
      const worldY = typeof opts?.worldY === 'number' && Number.isFinite(opts.worldY) ? opts.worldY : undefined;
      (snd as any).__panzerWorldX = worldX;
      (snd as any).__panzerWorldY = worldY;
      (snd as any).__panzerMaxDistance = opts?.maxDistance;
      (snd as any).__panzerPan = opts?.pan;
      const mixerFolder = this.loopFolderById.get(id) ?? folderKey;
      (snd as any).__panzerFolderKey = mixerFolder;

      const mix = this.getMixerSettingsForFolder(mixerFolder);
      const mixVol = this.dbToVolume(mix.volumeDb);
      const targetVolRaw = typeof opts?.volume === 'number' && Number.isFinite(opts.volume)
        ? opts.volume * mixVol
        : (this.loopTargetVolume.get(id) ?? snd.volume);
      const targetVol = Phaser.Math.Clamp(targetVolRaw, 0, 2);
      const fadeInMs = typeof opts?.fadeInMs === 'number' && Number.isFinite(opts.fadeInMs) ? opts.fadeInMs : 160;
      const lastDesired = this.loopDesiredVolume.get(id);
      if (typeof lastDesired !== 'number' || Math.abs(lastDesired - targetVol) > 0.001) {
        this.loopDesiredVolume.set(id, targetVol);
        if (fadeInMs > 0) this.fadeLoopTo(id, targetVol, fadeInMs);
        else this.loopTargetVolume.set(id, targetVol);
      }

      if (mix.lowpassHz > 0) this.setLowpassFrequency(snd, mix.lowpassHz);
      if (mix.highpassHz > 0) this.setHighpassFrequency(snd, mix.highpassHz);
      (snd as any).__panzerMixerLowpassHz = mix.lowpassHz;
      (snd as any).__panzerMixerHighpassHz = mix.highpassHz;
      const detune = (typeof opts?.detune === 'number' && Number.isFinite(opts.detune) ? opts.detune : 0) + mix.pitchCents;
      if (id === 'p_cruise_mech' || id === 'p_cruise_forest') {
        console.log(`[SoundManager] startLoop existing ${id}: pitchCents=${mix.pitchCents}, finalDetune=${detune}`);
      }
      try {
        if (typeof snd.setDetune === 'function') {
          snd.setDetune(Phaser.Math.Clamp(detune, -2400, 2400));
        } else {
           // Fallback: use rate for pitch change if detune not supported
           const rate = (snd as any).__panzerBaseRate ?? 1;
           const detuneMul = Math.pow(2, detune / 1200);
           if (typeof snd.setRate === 'function') snd.setRate(rate * detuneMul);
        }
      } catch {}

      return snd;
    }
    const pending = this.loopStarting.get(id);
    if (pending) return pending;

    const resolved = this.getUrlsForFolder(folderKey);
    if (!resolved) {
      this.logMissingOnce(folderKey);
      return null;
    }

    const tok = (this.loopStartToken.get(id) ?? 0) + 1;
    this.loopStartToken.set(id, tok);

    const p = (async () => {
      const url = this.pickUrl(resolved.folder, resolved.urls);
      try {
        const key = await this.ensureLoaded(url);
        if (this.destroyed) return null;
        if ((this.loopStartToken.get(id) ?? 0) !== tok) return null;
        if (this.loops.has(id)) return this.loops.get(id) ?? null;

        const mix = this.getMixerSettingsForFolder(resolved.folder);
        const mixVol = this.dbToVolume(mix.volumeDb);
        const targetVol = Phaser.Math.Clamp((typeof opts?.volume === 'number' && Number.isFinite(opts.volume) ? opts.volume : 1) * mixVol, 0, 2);
        const worldX = typeof opts?.worldX === 'number' && Number.isFinite(opts.worldX) ? opts.worldX : undefined;
        const worldY = typeof opts?.worldY === 'number' && Number.isFinite(opts.worldY) ? opts.worldY : undefined;
        const fadeInMs = typeof opts?.fadeInMs === 'number' && Number.isFinite(opts.fadeInMs) ? opts.fadeInMs : 160;
        const pan = this.computePan(worldX, opts?.pan);
        const ignoreDistanceAttenuation = this.shouldIgnoreDistanceAttenuation(resolved.folder);
        const att = ignoreDistanceAttenuation ? 1 : this.computeAttenuation(worldX, worldY, opts?.maxDistance);
        const initialBaseVol = fadeInMs > 0 ? 0 : targetVol;
        const snd = this.scene.sound.add(key, { loop: true, volume: Phaser.Math.Clamp(initialBaseVol * att, 0, 2) }) as ManagedSound;
        if (typeof snd.setPan === 'function') snd.setPan(pan);
        const rate = typeof opts?.rate === 'number' && Number.isFinite(opts.rate) ? opts.rate : 1;
        const detune = (typeof opts?.detune === 'number' && Number.isFinite(opts.detune) ? opts.detune : 0) + mix.pitchCents;
        if (id === 'p_cruise_mech' || id === 'p_cruise_forest') {
            console.log(`[SoundManager] startLoop new ${id}: pitchCents=${mix.pitchCents}, finalDetune=${detune}`);
        }
        try {
            // Apply rate first (base rate)
            snd.setRate?.(rate);
        } catch {}
        try {
            if (typeof snd.setDetune === 'function') {
                snd.setDetune(Phaser.Math.Clamp(detune, -2400, 2400));
            } else {
                 // Fallback: use rate for pitch change if detune not supported
                 const detuneMul = Math.pow(2, detune / 1200);
                 snd.setRate?.(rate * detuneMul);
            }
        } catch {}
        if (mix.lowpassHz > 0) this.setLowpassFrequency(snd, mix.lowpassHz);
        if (mix.highpassHz > 0) this.setHighpassFrequency(snd, mix.highpassHz);
        (snd as any).__panzerBaseRate = rate;
        (snd as any).__panzerMixerLowpassHz = mix.lowpassHz;
        (snd as any).__panzerMixerHighpassHz = mix.highpassHz;
        (snd as any).__panzerWorldX = worldX;
        (snd as any).__panzerWorldY = worldY;
        (snd as any).__panzerMaxDistance = opts?.maxDistance;
        (snd as any).__panzerPan = opts?.pan;
        (snd as any).__panzerFolderKey = resolved.folder;
        (snd as any).__panzerUrl = url;

        this.loops.set(id, snd);
        this.loopFolderById.set(id, resolved.folder);
        this.loopTargetVolume.set(id, initialBaseVol);
        this.loopDesiredVolume.set(id, targetVol);

        const isBurningLoop = folderKey.includes('/burning_loop/');
        const randomStart = opts?.startAtRandomOffset === true || isBurningLoop;
        const seek = (randomStart && snd.duration > 0) ? Math.random() * snd.duration : 0;

        if (this.isAudioUnlocked()) {
          try {
            snd.play({ seek });
          } catch {
            this.armLoopUnlockRetry(id, snd, seek);
          }
        } else {
          this.armLoopUnlockRetry(id, snd, seek);
        }

        if (fadeInMs > 0) {
          this.fadeLoopTo(id, targetVol, fadeInMs);
        }
        return snd;
      } catch {
        this.logMissingOnce(folderKey);
        return null;
      } finally {
        if (this.loopStarting.get(id) === p) this.loopStarting.delete(id);
      }
    })();

    this.loopStarting.set(id, p);
    return p;
  }

  public stopLoop(id: string, fadeOutMs?: number) {
    const snd = this.loops.get(id);
    this.clearLoopUnlockWait(id);
    this.loopStartToken.set(id, (this.loopStartToken.get(id) ?? 0) + 1);
    this.loopStarting.delete(id);
    if (!snd) return;

    const lpTween = (snd as any).__panzerLowpassTween as Phaser.Tweens.Tween | undefined;
    if (lpTween) {
      try {
        lpTween.stop();
      } catch {}
      delete (snd as any).__panzerLowpassTween;
    }
    const detuneTween = (snd as any).__panzerDetuneTween as Phaser.Tweens.Tween | undefined;
    if (detuneTween) {
      try {
        detuneTween.stop();
      } catch {}
      delete (snd as any).__panzerDetuneTween;
    }

    // Ensure any existing fade tween is stopped before we proceed
    const prevTween = this.loopFadeTween.get(id);
    if (prevTween) {
      try {
        prevTween.stop();
      } catch {}
      this.loopFadeTween.delete(id);
    }

    const ms = typeof fadeOutMs === 'number' && Number.isFinite(fadeOutMs) ? fadeOutMs : 180;
    if (ms > 0) {
      this.loopDesiredVolume.set(id, 0);
      this.fadeLoopTo(id, 0, ms, () => {
        try {
          this.detachLowpass(snd);
          snd.stop();
        } catch {}
        try {
          snd.destroy();
        } catch {}
        this.loops.delete(id);
        this.loopFolderById.delete(id);
        this.loopTargetVolume.delete(id);
        this.loopDesiredVolume.delete(id);
      });
    } else {
      try {
        this.detachLowpass(snd);
        snd.stop();
      } catch {}
      try {
        snd.destroy();
      } catch {}
      this.loops.delete(id);
      this.loopFolderById.delete(id);
      this.loopTargetVolume.delete(id);
      this.loopDesiredVolume.delete(id);
    }
  }

  public dispose() {
    this.destroy();
  }

  public fadeLoop(id: string, targetVolume: number, durationMs: number) {
    if (!this.loops.get(id)) return;
    const v = typeof targetVolume === 'number' && Number.isFinite(targetVolume) ? Phaser.Math.Clamp(targetVolume, 0, 2) : 0;
    const ms = typeof durationMs === 'number' && Number.isFinite(durationMs) ? Math.max(0, durationMs | 0) : 0;
    this.fadeLoopTo(id, v, Math.max(1, ms));
  }

  private fadeLoopTo(id: string, targetVolume: number, durationMs: number, onDone?: () => void) {
    const snd = this.loops.get(id);
    if (!snd) return;
    const prevTween = this.loopFadeTween.get(id);
    if (prevTween) {
      try {
        prevTween.stop();
      } catch {}
      this.loopFadeTween.delete(id);
    }

    let from = this.loopTargetVolume.get(id);
    if (typeof from !== 'number' || !Number.isFinite(from)) {
      from = 0;
      try {
        const v = (snd as any).volume as number | undefined;
        if (typeof v === 'number' && Number.isFinite(v)) from = v;
      } catch {}
    }
    const to = Phaser.Math.Clamp(targetVolume, 0, 2);
    const obj = { v: from };
    const t = this.scene.tweens.add({
      targets: obj,
      v: to,
      duration: Math.max(1, durationMs),
      ease: 'Linear',
      onUpdate: () => {
        if (!this.loops.has(id)) return;
        this.loopTargetVolume.set(id, obj.v);
      },
      onComplete: () => {
        this.loopFadeTween.delete(id);
        this.loopTargetVolume.set(id, to);
        if (onDone) onDone();
      }
    });
    this.loopFadeTween.set(id, t);
  }
}
