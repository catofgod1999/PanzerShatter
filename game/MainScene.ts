
import Phaser from 'phaser';
import { Tank, LandSubmarine } from './entities/Tank';
import { TankType, ShellType, weaponFolderForShellType } from './types/GameplayTypes';
import { BuildingManager } from './systems/BuildingManager';
import { ParticleSystems } from './systems/Particles';
import { InfantryManager } from './systems/InfantryManager';
import { SoundManager } from './systems/SoundManager';
import { Helicopter } from './entities/Helicopter';
import { Animal } from './entities/Animal';
import { analyzeDesertBgmBuffer, pickDesertSectionAtProgress, type DesertBgmAnalysis, type DesertBgmDesignSection } from './systems/DesertBgmAnalysis';

type MapId = 'forest' | 'desert';
type ForestBgmState = 'explore' | 'combat' | 'safezone' | 'hunter' | 'end';
type ForestBgmTransition = 'initial' | 'crossfade' | 'combat_in' | 'hunter_intro';

type PreFinalWreckAnchor = {
  x: number;
  sprite: Phaser.GameObjects.Image;
  burialDepth: number;
  baseRotation: number;
  slopeFollow: number;
  smokePhase: number;
  scorch?: Phaser.GameObjects.Image;
  smoke?: Phaser.GameObjects.Particles.ParticleEmitter;
};

export class MainScene extends Phaser.Scene {
  // Explicitly declare Phaser systems to satisfy strict type checking in specific environments
  public physics!: Phaser.Physics.Arcade.ArcadePhysics;
  public add!: Phaser.GameObjects.GameObjectFactory;
  public make!: Phaser.GameObjects.GameObjectCreator;
  public cameras!: Phaser.Cameras.Scene2D.CameraManager;
  public time!: Phaser.Time.Clock;
  public tweens!: Phaser.Tweens.TweenManager;
  public events!: Phaser.Events.EventEmitter;
  public input!: Phaser.Input.InputPlugin;
  public scale!: Phaser.Scale.ScaleManager;

  public player!: Tank;
  public buildings!: BuildingManager;
  public enemies: (Tank | Helicopter | LandSubmarine)[] = [];
  public allies!: InfantryManager;
  public enemyInfantry!: InfantryManager;
  
  public enemiesGroup!: Phaser.Physics.Arcade.Group;
  public bulletGroup!: Phaser.Physics.Arcade.Group;
  public mineGroup!: Phaser.Physics.Arcade.StaticGroup;
  public debrisGroup!: Phaser.Physics.Arcade.Group;
  public vegetationGroup!: Phaser.GameObjects.Group;
  public treeGroup!: Phaser.Physics.Arcade.Group; 
  public faunaGroup!: Phaser.GameObjects.Group;
  public animalGroup!: Phaser.Physics.Arcade.Group;
  public animals: Animal[] = [];
  private streams: { x0: number; x1: number; gfx: Phaser.GameObjects.Graphics }[] = [];
  private lakes: {
    x0: number;
    x1: number;
    gfx: Phaser.GameObjects.Graphics;
    surfaceGfx: Phaser.GameObjects.Graphics;
    bridgeContainer: Phaser.GameObjects.Container;
    bridgeBricksBySeg: Phaser.GameObjects.Sprite[][];
    waterY: number;
    bridgeY: number;
    segments: {
      rect: Phaser.GameObjects.Rectangle;
      health: number;
      maxHealth: number;
      playerCollider?: Phaser.Physics.Arcade.Collider | null;
      enemyCollider?: Phaser.Physics.Arcade.Collider | null;
    }[];
    waterZone: Phaser.GameObjects.Rectangle;
    playerWaterOverlap?: Phaser.Physics.Arcade.Collider | null;
    audioArea: { x0: number; x1: number; y0: number; y1: number; maxDistance: number };
    wavePhase: number;
    lastVisualT: number;
    lastBridgeBrickSyncT: number;
    loopId?: string;
  }[] = [];
  
  public terrainHeights: number[] = [];
  public terrainDamage: number[] = [];
  public baseHeights: number[] = [];
  private terrainBurn: number[] = [];
  private terrainGraphics!: Phaser.GameObjects.Graphics;
  private terrainFillSprite!: Phaser.GameObjects.TileSprite;
  private terrainMaskGraphics!: Phaser.GameObjects.Graphics;
  public groundDecals!: Phaser.GameObjects.Graphics;
  public terrainBodies: Phaser.GameObjects.Rectangle[] = [];
  private debrisTerrainCollider?: Phaser.Physics.Arcade.Collider;
  public score = 0;
  public scoreText?: Phaser.GameObjects.Text;
  private ammoCooldownText?: Phaser.GameObjects.Text;
  private shellNameText?: Phaser.GameObjects.Text;
  private shellNameFlashTween?: Phaser.Tweens.Tween;
  private shellNameFadeTween?: Phaser.Tweens.Tween;
  private lastShellPromptKey?: string;
  private lastAmmoHudUpdateT = 0;
  private lastPointerScreenX = 0;
  private lastPointerScreenY = 0;
  private lastAimUpdateT = 0;
  private bloodStains: Phaser.GameObjects.Arc[] = [];
  private isDefeat = false;
  private redeployQueued = false;
  private playerDebrisOverlap?: Phaser.Physics.Arcade.Collider;
  private playerTreeCollider?: Phaser.Physics.Arcade.Collider;
  private playerEnemiesCollider?: Phaser.Physics.Arcade.Collider;
  private onRedeployHandler?: EventListener;
  private onKillFeedHandler?: (ev: any) => void;
  private onUpdateHudHandler?: (data: any) => void;
  private onPlayerNukeHandler?: (data: any) => void;
  private onCombatDamageHandler?: () => void;
  private onCombatActivityHandler?: () => void;
  
  private WORLD_WIDTH = 50000; 
  private readonly TERRAIN_STEP = 20;
  private readonly VIEW_BUFFER = 2000;
  private generatedUntilX = 0;

  private activeExplosionsCount = 0;
  private MAX_ACTIVE_EXPLOSIONS = 60;
  private hitStopTimer = 0;
  public particles!: ParticleSystems;
  public audio!: SoundManager;
  private bedrockY = 4400;
  private bedrockBody?: Phaser.GameObjects.Rectangle;

  public tankKills = 0;
  public vehicleKills = 0;
  private lastAudioDebugTime = 0;
  public infantryKills = 0;
  public savedInCurrentRound = 0;
  private vehicleKillBreakdown: { label: string; points: number }[] = [];
  private recentVehicleKillSources = new Map<any, number>();
  private recentPlayerDamageUntil = new WeakMap<any, number>();
  private wasInSafeZone = false;
  private flags: { segments: Phaser.GameObjects.Image[]; points: Phaser.Math.Vector2[]; vels: Phaser.Math.Vector2[]; anchorX: number; anchorY: number; segW: number; phase: number; }[] = [];
  private windT = 0;
  private wind = 0;
  private lastForestRainT = 0;
  private rainUntilT = 0;
  private wasRainActive = false;
  private allowForestRainThisRun = true;
  private sandstormUntilT = 0;
  private sandstormDir: -1 | 1 = 1;
  private desertStormFrontX = -420;
  private desertStormSweepMargin = 110;
  private desertStormSpeedPxPerSec = 550;
  private desertStormLastSweepT = 0;
  private desertEscapeTriggered = false;
  private desertStormVisual: Phaser.GameObjects.Container | null = null;
  private desertStormBackdropFar: Phaser.GameObjects.Shape | null = null;
  private desertStormBackdropNear: Phaser.GameObjects.Shape | null = null;
  private desertStormEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private desertStormVisualLastUpdateT = 0;
  private desertStormVisualStrideMs = 34;
  private forestRainBlend = 0;
  private blackRainZones: { x: number; radius: number; until: number }[] = [];
  private readonly blackRainLoopId = 'amb_black_rain_weather';
  private lastForestRainLoopEnsureT = 0;
  private lastBlackRainLoopEnsureT = 0;
  private backgroundClouds: Phaser.GameObjects.Container[] = [];
  private killFeedItems: { id: number; text: Phaser.GameObjects.Text; sub?: Phaser.GameObjects.Text; createdAt: number; lifeMs: number; points: number; bonusPoints: number }[] = [];
  private nextKillFeedId = 1;
  private settledSafeZones = new Set<string>();
  public aimWorld = new Phaser.Math.Vector2(0, 0);
  public aimScreen = new Phaser.Math.Vector2(0, 0);
  public aimWorldOverrideActive = false;
  public defaultZoom = 0.8;
  public vLeft = false;
  public vRight = false;
  public vBoost = false;
  public vZoom = false;
  public vLift = false;
  public vFire = false;
  public vMg = false;
  public vMortar = false;
  public vNuke = false;
  public mouseMgHeld = false;
  private currentWindSound: Phaser.Sound.BaseSound | null = null;
  private forestLakeBridgeWantedThisRun = false;
  private forestLakeBridgeSpawnedThisRun = false;
  private forestLakeBridgePlan: { start: number; end: number } | null = null;
  private lastTerrainPhysicsT = 0;
  private lastVegetationSnapT = 0;
  private lastDistantHibernateT = 0;
  private lastDormantPruneT = 0;
  private lastFaunaUpdateT = 0;
  private lastVegetationInteractionT = 0;
  private lastWaterPlantUpdateT = 0;
  private vegetationNearTankCache: { x: number; y: number; isPlayer: boolean }[] = [];
  private faunaUpdateIntervalMs = 33;
  private vegetationInteractionIntervalMs = 30;
  private waterPlantUpdateIntervalMs = 45;
  public mapId: MapId = 'forest';
  public hunterBossTank: Tank | null = null;
  private forestExitZone: Phaser.GameObjects.Rectangle | null = null;
  private forestExitTriggered = false;
  public testRoomEnabled = false;
  public testRoomAllowEnemyAttack = true;
  public testRoomAllowEnemyMove = true;
  public testRoomNoCooldown = false;
  public testRoomUiBlocking = false;
  private onTestRoomCommand?: EventListener;
  private onTestRoomSettings?: EventListener;
  private onTestRoomClear?: EventListener;
  private onTestRoomUiBlock?: EventListener;
  private lastDesertGustT = 0;
  private lastLeavesSfxT = 0;
  private lastDesertAmbushT = 0;
  private lastForestFogT = 0;
  private onDefaultZoomHandler?: EventListener;
  private hunterSpawned = false;
  private hunterSpawnX = Number.POSITIVE_INFINITY;
  private lastHunterSpawnTryT = 0;
  private baseRepairStations: { poleX: number; lampY: number; lamp: Phaser.GameObjects.Container; rays: Phaser.GameObjects.Graphics; beamPhase: number; lastSparkAt: number; pole: Phaser.GameObjects.Rectangle; flag: any; collapsed: boolean; loopId: string; spotlightActive: boolean }[] = [];
  private readonly bgmLoopIds: [string, string] = ['bgm_forest_main_a', 'bgm_forest_main_b'];
  private readonly desertBgmLoopId = 'bgm_desert_main';
  private desertBgmFolderKey = 'bgm/desert/sfx';
  private desertBgmAnalysis: DesertBgmAnalysis | null = null;
  private desertBgmAnalysisCacheKey: string | null = null;
  private desertBgmAnalysisPromise: Promise<void> | null = null;
  private readonly bgmCombatExitMs = 3000;
  private readonly forestBgmBpm = 97;
  private readonly forestBgmBeatsPerBar = 4;
  private forestBgmBarAnchorAt = Number.NaN;
  private forestBgmQueuedState: ForestBgmState | null = null;
  private forestBgmQueuedTransition: ForestBgmTransition | null = null;
  private forestBgmQueuedTimer: Phaser.Time.TimerEvent | null = null;
  private forestBgmCurrent: ForestBgmState | null = null;
  private forestBgmActiveLoopId: string | null = null;
  private forestBgmCurrentFolder: string | null = null;
  private forestCombatActive = false;
  private forestLastCombatDamageAt = Number.NEGATIVE_INFINITY;
  private forestLastEnemyCombatActivityAt = Number.NEGATIVE_INFINITY;
  private forestLastThreatProbeAt = 0;
  private forestSafeZoneBgmLatched = false;
  private forestHunterBgmLatched = false;
  private forestEndBgmLatched = false;
  private forestPenultimateSafeZoneX0 = Number.POSITIVE_INFINITY;
  private lastTacticalMapEmitT = 0;
  private tacticalMapVisibleLast = false;
  private tacticalMapEmitIntervalMs = 120;
  private tacticalMapEmitBaseIntervalMs = 120;
  private perfPanelEnabled = false;
  private perfLastEmitT = 0;
  private perfSampleFrames = 0;
  private perfSampleFrameMs = 0;
  private perfSampleSections = new Map<string, number>();
  private lastPerfAdaptiveTuneT = 0;
  private enemyFarAiStride = 1;
  private enemyFarAiFrame = 0;
  private lastSquashCheckT = 0;
  private readonly safeZoneDefaultLength = 6000;
  private readonly penultimateSafeZoneLength = 12000;
  private preFinalSafeZoneWreckFieldSpawned = false;
  private preFinalSafeZoneWreckField?: Phaser.GameObjects.Container;
  private preFinalWreckAnchors: PreFinalWreckAnchor[] = [];
  private preFinalWreckLastUpdateT = 0;

  private tutorialMode = false;
  private tutorialStep = 0;
  private tutorialStepStartedAt = 0;
  private tutorialComplete = false;
  private tutorialMoveTargetX = 0;
  private tutorialLiftSatisfied = false;
  private tutorialMainShellShots = 0;
  private tutorialMortarShots = 0;
  private tutorialNukeShots = 0;
  private tutorialStepMainShotStart = 0;
  private tutorialStepMortarShotStart = 0;
  private tutorialStepNukeShotStart = 0;
  private tutorialCooldownBypass: 'none' | 'mortar' | 'nuke' = 'none';
  private tutorialLakeBounds: { x0: number; x1: number; waterY: number } | null = null;
  private tutorialDummyTarget: Tank | null = null;
  private tutorialExitZone: Phaser.GameObjects.Rectangle | null = null;
  private tutorialMoveMarkerArea?: Phaser.GameObjects.Rectangle;
  private tutorialMoveMarkerLabel?: Phaser.GameObjects.Text;
  private tutorialMoveMarkerArrow?: Phaser.GameObjects.Text;
  private tutorialUiPanel?: Phaser.GameObjects.Rectangle;
  private tutorialUiTitle?: Phaser.GameObjects.Text;
  private tutorialUiBody?: Phaser.GameObjects.Text;
  private tutorialUiStep?: Phaser.GameObjects.Text;
  private tutorialUiNextRefreshAt = 0;
  private tutorialPlayerShellHandler?: (ev: any) => void;
  private tutorialPlayerMortarHandler?: (ev: any) => void;
  private tutorialPlayerNukeHandler?: (ev: any) => void;
  private tutorialSwitchVisitedShells = new Set<ShellType>();
  private tutorialGateBlockedHintUntil = 0;
  private tutorialGateLastBlockAt = 0;
  private readonly tutorialTotalSteps = 8;

  private hunterIntro?: {
    tank: Tank;
    heliA: Helicopter;
    heliB: Helicopter;
    rope: Phaser.GameObjects.Graphics;
    phase: 'approach' | 'exit';
    ropeLen: number;
    fromRight: boolean;
    startT: number;
    approachDur: number;
    exitT?: number;
    exitDur?: number;
    midX: number;
    midY: number;
  };

  constructor() {
    super('MainScene');
  }

  init(data: any) {
    const next: MapId = data?.mapId === 'desert' ? 'desert' : 'forest';
    this.mapId = next;
    this.tutorialMode = data?.tutorial === true;
    this.testRoomEnabled = !this.tutorialMode && data?.testRoom === true;
    this.testRoomUiBlocking = false;

    if (this.tutorialMode) {
      this.WORLD_WIDTH = 14000;
      this.testRoomAllowEnemyAttack = false;
      this.testRoomAllowEnemyMove = false;
      this.testRoomNoCooldown = false;
    } else if (this.testRoomEnabled) {
      this.WORLD_WIDTH = 3600;
      const s = (data?.testRoomSettings ?? data ?? {}) as any;
      if (typeof s.enemyAttack === 'boolean') this.testRoomAllowEnemyAttack = s.enemyAttack;
      if (typeof s.enemyMove === 'boolean') this.testRoomAllowEnemyMove = s.enemyMove;
      if (typeof s.noCooldown === 'boolean') this.testRoomNoCooldown = s.noCooldown;
    } else {
      this.WORLD_WIDTH = 50000;
    }

    this.forestLakeBridgeWantedThisRun = !this.testRoomEnabled && !this.tutorialMode && next === 'forest';
  }

  private resetHydrologyState() {
    for (const s of this.streams) {
      if (s?.gfx?.active) s.gfx.destroy();
    }
    this.streams = [];

    for (const l of this.lakes) {
      if (l?.gfx?.active) l.gfx.destroy();
      if (l?.surfaceGfx?.active) l.surfaceGfx.destroy();
      if (l?.playerWaterOverlap) {
        try { l.playerWaterOverlap.destroy(); } catch {}
        l.playerWaterOverlap = null;
      }
      if (l?.waterZone?.active) l.waterZone.destroy();
      if (l?.loopId) this.audio?.stopLoop?.(l.loopId, 0);
      if (l?.bridgeContainer?.active) {
        l.bridgeContainer.removeAll(true);
        l.bridgeContainer.destroy();
      }
      for (const seg of l?.segments ?? []) {
        if (seg?.playerCollider) {
          try { seg.playerCollider.destroy(); } catch {}
          seg.playerCollider = null;
        }
        if (seg?.enemyCollider) {
          try { seg.enemyCollider.destroy(); } catch {}
          seg.enemyCollider = null;
        }
        if (seg?.rect?.active) seg.rect.destroy();
      }
    }
    this.lakes = [];
    this.audio?.stopLoop?.('amb_forest_lake_loop', 0);

    for (const b of this.baseRepairStations) {
      if (b?.loopId) this.audio?.stopLoop?.(b.loopId, 0);
      if (b?.rays?.active) b.rays.destroy();
      if (b?.lamp?.active) b.lamp.destroy(true);
    }
    this.baseRepairStations = [];
  }

  create() {
    this.resetHydrologyState();
    this.score = 0;
    this.tankKills = 0;
    this.vehicleKills = 0;
    this.infantryKills = 0;
    this.savedInCurrentRound = 0;
    this.vehicleKillBreakdown = [];
    this.recentVehicleKillSources.clear();
    this.recentPlayerDamageUntil = new WeakMap<any, number>();
    this.killFeedItems = [];
    this.nextKillFeedId = 1;
    this.blackRainZones = [];
    this.rainUntilT = 0;
    this.wasRainActive = false;
    this.forestRainBlend = 0;
    this.lastForestRainLoopEnsureT = 0;
    this.lastBlackRainLoopEnsureT = 0;
    this.audio?.stopLoop?.('p_nuke_aftermath', 0);
    this.audio?.stopLoop?.('amb_forest_rain', 0);
    this.audio?.stopLoop?.(this.blackRainLoopId, 0);
    if (this.forestExitZone?.active) this.forestExitZone.destroy();
    this.forestExitZone = null;
    this.forestExitTriggered = false;
    this.desertStormFrontX = -420;
    this.desertStormLastSweepT = 0;
    this.desertEscapeTriggered = false;
    this.desertStormVisualLastUpdateT = 0;
    this.clearDesertStormVisuals();
    this.desertBgmAnalysis = null;
    this.desertBgmAnalysisCacheKey = null;
    this.desertBgmAnalysisPromise = null;

    this.createAssets();
    Animal.createTextures(this);
    this.createAtmosphere(); 
    
    this.enemiesGroup = this.physics.add.group();
    this.bulletGroup = this.physics.add.group({ maxSize: 1400 });
    this.mineGroup = this.physics.add.staticGroup();
    this.vegetationGroup = this.add.group();
    this.faunaGroup = this.add.group();
    this.animalGroup = this.physics.add.group({
      collideWorldBounds: true
    });
    this.treeGroup = this.physics.add.group();
    this.debrisGroup = this.physics.add.group({
      bounceX: 0.1, bounceY: 0.05, dragX: 150,
      collideWorldBounds: true, maxSize: 1800 
    });

    this.physics.world.setBounds(0, -2500, this.WORLD_WIDTH, 7000);
    this.cameras.main.setBounds(0, -2500, this.WORLD_WIDTH, 7000);
    this.defaultZoom = this.readDefaultZoom();
    this.cameras.main.setZoom(this.defaultZoom);
    this.bedrockY = this.physics.world.bounds.bottom - 80;

    if (this.bedrockBody?.active) this.bedrockBody.destroy();
    const worldBottom = this.physics.world.bounds.bottom;
    const bedrockH = Math.max(80, (worldBottom - this.bedrockY) + 200);
    this.bedrockBody = this.add.rectangle(this.WORLD_WIDTH * 0.5, this.bedrockY + bedrockH * 0.5, this.WORLD_WIDTH, bedrockH, 0, 0);
    this.physics.add.existing(this.bedrockBody, true);
    
    this.particles = new ParticleSystems(this);
    this.audio = new SoundManager(this);
    this.time.delayedCall(0, () => this.audio.prewarmCritical());
    this.time.delayedCall(800, () => {
      this.audio?.ensureSessionAudioPack({ priority: 'P1', concurrency: 2 }).catch(() => {});
      this.time.delayedCall(10000, () => {
        this.audio?.ensureSessionAudioPack({ priority: 'P2', concurrency: 2 }).catch(() => {});
      });
    });
    this.forestBgmCurrent = null;
    this.forestBgmActiveLoopId = null;
    this.forestBgmCurrentFolder = null;
    this.forestCombatActive = false;
    this.forestLastCombatDamageAt = Number.NEGATIVE_INFINITY;
    this.forestLastEnemyCombatActivityAt = Number.NEGATIVE_INFINITY;
    this.forestLastThreatProbeAt = 0;
    this.forestSafeZoneBgmLatched = false;
    this.forestHunterBgmLatched = false;
    this.forestEndBgmLatched = false;
    this.forestPenultimateSafeZoneX0 = this.computePenultimateSafeZoneStartX();
    this.lastTacticalMapEmitT = 0;
    this.tacticalMapVisibleLast = false;
    this.lastSquashCheckT = 0;
    const androidDevice = this.sys.game.device.os.android;
    const mobileDevice = androidDevice || this.sys.game.device.os.iOS || this.sys.game.device.input.touch;
    this.desertStormVisualStrideMs = androidDevice ? 55 : (mobileDevice ? 45 : 34);
    this.tacticalMapEmitBaseIntervalMs = androidDevice ? 260 : (mobileDevice ? 180 : 120);
    this.tacticalMapEmitIntervalMs = this.tacticalMapEmitBaseIntervalMs;
    this.faunaUpdateIntervalMs = androidDevice ? 50 : (mobileDevice ? 40 : 33);
    this.vegetationInteractionIntervalMs = androidDevice ? 45 : (mobileDevice ? 36 : 30);
    this.waterPlantUpdateIntervalMs = androidDevice ? 70 : (mobileDevice ? 55 : 45);
    this.lastFaunaUpdateT = 0;
    this.lastVegetationInteractionT = 0;
    this.lastWaterPlantUpdateT = 0;
    this.lastTerrainPhysicsT = 0;
    this.lastVegetationSnapT = 0;
    this.lastDistantHibernateT = 0;
    this.lastDormantPruneT = 0;
    this.perfPanelEnabled = false;
    this.perfLastEmitT = 0;
    this.perfSampleFrames = 0;
    this.perfSampleFrameMs = 0;
    this.perfSampleSections.clear();
    this.lastPerfAdaptiveTuneT = 0;
    this.enemyFarAiStride = androidDevice ? 3 : (mobileDevice ? 2 : 1);
    this.enemyFarAiFrame = 0;
    if (typeof window !== 'undefined') {
      const q = window.location?.search ?? '';
      const enableViaQuery = q.includes('perf=1') || q.includes('debug_perf=1');
      const enableViaStorage = window.localStorage.getItem('panzer-dev-perf') === '1';
      this.perfPanelEnabled = !!(import.meta.env.DEV || enableViaQuery || enableViaStorage);
    }
    this.hunterSpawned = false;
    this.hunterSpawnX = Number.POSITIVE_INFINITY;
    this.lastHunterSpawnTryT = 0;
    this.hunterIntro = undefined;
    this.hunterBossTank = null;
    this.preFinalSafeZoneWreckFieldSpawned = false;
    this.clearPreFinalWreckFieldEffects();
    if (this.preFinalSafeZoneWreckField?.active) this.preFinalSafeZoneWreckField.destroy(true);
    this.preFinalSafeZoneWreckField = undefined;
    this.buildings = new BuildingManager(this);
    this.allies = new InfantryManager(this, true); 
    this.enemyInfantry = new InfantryManager(this, false); 
    
    this.terrainGraphics = this.add.graphics().setDepth(10);
    this.terrainMaskGraphics = this.make.graphics({ x: 0, y: 0 }, false);
    this.terrainFillSprite = this.add.tileSprite(0, 0, this.WORLD_WIDTH, 7000, 'terrain_fill_pattern')
        .setOrigin(0, 0)
        .setDepth(9);
    this.terrainFillSprite.setMask(new Phaser.Display.Masks.GeometryMask(this, this.terrainMaskGraphics));

    this.groundDecals = this.add.graphics().setDepth(22);
    if (this.mapId === 'desert') {
      this.desertBgmFolderKey = this.resolveDesertBgmFolderKey();
      const urls = this.audio.getFolderUrls(this.desertBgmFolderKey);
      if (urls.length > 0) {
        this.desertBgmAnalysisCacheKey = this.getDesertBgmAnalysisCacheKey(this.desertBgmFolderKey, urls);
        this.desertBgmAnalysis = this.loadCachedDesertBgmAnalysis(this.desertBgmAnalysisCacheKey);
      }
      this.beginDesertBgmAnalysis();
    }
    this.generateTerrain();
    
    if (this.testRoomEnabled) {
      this.generatedUntilX = this.WORLD_WIDTH;
      this.spawnTestRoomDecor();
    } else if (this.tutorialMode) {
      this.generatedUntilX = this.WORLD_WIDTH;
      this.forestLakeBridgeSpawnedThisRun = false;
      this.forestLakeBridgePlan = null;
      this.forestLakeBridgeWantedThisRun = false;
    } else {
      this.hunterBossTank = null;
      this.forestLakeBridgeSpawnedThisRun = false;
      this.forestLakeBridgePlan = null;
      this.forestLakeBridgeWantedThisRun = this.mapId === 'forest' && Math.random() < 0.6;
      if (this.forestLakeBridgeWantedThisRun) this.planForestLakeBridge();
      this.generatedUntilX = 4000;
      this.spawnContentInRange(0, this.generatedUntilX);
    }
    
    const startX = 600;
    const pScale = Tank.getScaleFor(TankType.PLAYER_SOVIET, true);
    this.player = new Tank(this, startX, this.getTerrainHeight(startX) - 100 * pScale, TankType.PLAYER_SOVIET, true);
    this.player.chassis.setData('tankRef', this.player);
    for (const lake of this.lakes) this.bindPlayerToLake(lake);
    this.aimWorld.set(this.player.chassis.x, this.player.chassis.y);
    this.events.emit('update-hud', { hp: 100, shell: ShellType[this.player.currentShell] ?? 'STANDARD', totalScore: 0 });
    {
      const names: Record<string, string> = { 'STANDARD': '标准弹', 'HE': '高爆弹', 'AP': '穿甲弹', 'INCENDIARY': '燃烧弹', 'MORTAR': '迫击炮', 'NUKE': '核弹' };
      const key = ShellType[this.player.currentShell] ?? 'STANDARD';
      const label = names[key] || key;
      this.shellNameText = this.add.text(this.player.chassis.x, this.player.chassis.y - 100 * pScale, label, {
        fontSize: '22px',
        color: '#ffffff',
        fontStyle: 'bold',
        stroke: '#000',
        strokeThickness: 6
      }).setOrigin(0.5, 1).setDepth(1000).setAlpha(0);
      this.lastShellPromptKey = key;
      this.triggerShellNamePrompt();
    }

    if (this.tutorialMode) {
      this.setupTutorialScenario();
      for (const loopId of this.bgmLoopIds) this.audio.stopLoop(loopId, 0);
      this.forestBgmCurrent = null;
      this.forestBgmActiveLoopId = null;
      this.forestBgmCurrentFolder = null;
    }

    if (!this.testRoomEnabled && !this.tutorialMode && this.mapId === 'forest') this.createForestExitBase();
    
    if (this.mapId === 'forest') {
      // Forest Loop - play immediately and keep looping
      this.audio.startLoop('amb_forest_loop', 'environment/forest/ambient_2d/forest_loop/sfx', { volume: 0.55, fadeInMs: 2000 }).catch(() => {});
      
      // Wind Loop (Intermittent)
      this.time.addEvent({
          delay: 15000, // Check every 15s
          loop: true,
          callback: () => {
              if (Math.random() < 0.4) return; // 60% chance
              if (this.currentWindSound && this.currentWindSound.isPlaying) return; // Prevent overlap
              const windDuration = 30000;
              this.audio.playFolder('environment/forest/ambient_2d/wind_loop/sfx', { 
                  volume: 0,
                  pan: -1,
              })?.then(snd => {
                  if (!snd) return;
                  this.currentWindSound = snd;
                  const anySnd = snd as any;
                  anySnd.loop = true;
                  const fadeInObj = { v: 0 };
                  const panObj = { p: -1 };
                  const fadeOutObj = { v: 0.6 };

                  const fadeInTween = this.tweens.add({
                      targets: fadeInObj,
                      v: 0.6,
                      duration: 3000,
                      ease: 'Linear',
                      onUpdate: () => {
                          if (!snd.isPlaying) {
                              fadeInTween.stop();
                              return;
                          }
                          try {
                              // const duck = this.audio.currentAmbientDuckVolume ?? 1.0; // Wind excluded from ducking
                              if (typeof anySnd.setVolume === 'function') anySnd.setVolume(fadeInObj.v);
                              else anySnd.volume = fadeInObj.v;
                          } catch {
                              fadeInTween.stop();
                          }
                      }
                  });

                  const panTween = this.tweens.add({
                      targets: panObj,
                      p: 1,
                      duration: Math.max(1, windDuration - 3000),
                      ease: 'Linear',
                      onUpdate: () => {
                          if (!snd.isPlaying) {
                              panTween.stop();
                              return;
                          }
                          try {
                              if (typeof anySnd.setPan === 'function') anySnd.setPan(panObj.p);
                              // Apply duck volume during pan update as well, in case fade tweens are not updating
                              // const duck = this.audio.currentAmbientDuckVolume ?? 1.0; // Wind excluded from ducking
                              const currentBase = fadeInTween.isPlaying() ? fadeInObj.v : (fadeOutTween.isPlaying() ? fadeOutObj.v : 0.6);
                              if (typeof anySnd.setVolume === 'function') anySnd.setVolume(currentBase);
                          } catch {
                              panTween.stop();
                          }
                      },
                      onComplete: () => {
                          try {
                              if (typeof anySnd.setPan === 'function') anySnd.setPan(1);
                          } catch {}
                      }
                  });

                  const fadeOutTween = this.tweens.add({
                      targets: fadeOutObj,
                      v: 0,
                      delay: windDuration - 3000,
                      duration: 3000,
                      ease: 'Linear',
                      onUpdate: () => {
                          if (!snd.isPlaying) {
                              fadeOutTween.stop();
                              return;
                          }
                          try {
                              // const duck = this.audio.currentAmbientDuckVolume ?? 1.0; // Wind excluded from ducking
                              if (typeof anySnd.setVolume === 'function') anySnd.setVolume(fadeOutObj.v);
                              else anySnd.volume = fadeOutObj.v;
                          } catch {
                              fadeOutTween.stop();
                          }
                      },
                      onComplete: () => {
                          try {
                              fadeInTween.stop();
                          } catch {}
                          try {
                              panTween.stop();
                          } catch {}
                          try {
                              snd.stop();
                          } catch {}
                          try {
                              snd.destroy();
                          } catch {}
                      }
                  });
              });
          }
      });
    }
    else if (this.mapId === 'desert') {
      const folder = this.desertBgmFolderKey || this.resolveDesertBgmFolderKey();
      if (this.audio.hasFolderAudio(folder)) {
        this.audio.startLoop(this.desertBgmLoopId, folder, {
          volume: 0.9,
          fadeInMs: 1200,
          startAtRandomOffset: false
        }).catch(() => {});
      }
    }

    this.setupInput();
    this.events.on('prerender', this.handlePreRender, this);

    this.cameras.main.startFollow(this.player.chassis, true, 0.1, 0.1);
    this.updateMobileCameraFocusOffset();
    this.input.setDefaultCursor('none');
    this.input.mouse?.disableContextMenu();
    this.scene.launch('UIScene');
    this.scene.bringToTop('UIScene');

    this.playerDebrisOverlap = this.physics.add.overlap(this.player.chassis, this.debrisGroup, (_: any, debris: any) => this.collectDebris(debris), undefined, this);
    if (this.bedrockBody) {
      this.physics.add.collider(this.player.chassis, this.bedrockBody);
      this.physics.add.collider(this.debrisGroup, this.bedrockBody);
      this.physics.add.collider(this.enemiesGroup, this.bedrockBody);
    }

    this.setupDebrisCollision();
    this.setupTreeCollisions();

    this.physics.add.overlap(this.mineGroup, this.enemiesGroup, (mineObj: any, enemyObj: any) => {
      this.handleMineTrigger(mineObj, enemyObj);
    });
    
    this.physics.add.collider(this.animalGroup, this.bedrockBody!);
    this.physics.add.collider(this.animalGroup, this.terrainBodies);

    this.scale.on('resize', this.handleResize, this);
    this.handleResize(this.scale.gameSize);

    if (!this.testRoomEnabled) {
      this.time.delayedCall(0, () => {
        const now = this.time.now;
        if (this.mapId === 'desert') {
          this.initializeDesertStormScenario(now);
        } else {
          if (this.mapId === 'forest') {
            const shouldRain = this.advanceForestRainCounterAndCheck();
            this.allowForestRainThisRun = shouldRain;
            if (shouldRain) {
              const dur = 60000;
              this.rainUntilT = now + dur;
              this.particles.createForestRain(dur);
              this.drawTerrain();
              this.ensureForestRainLoop(900);
              this.wasRainActive = true;
            } else {
              this.rainUntilT = 0;
              this.wasRainActive = false;
              this.forestRainBlend = 0;
            }
          } else {
            this.allowForestRainThisRun = true;
            const dur = 60000;
            this.rainUntilT = now + dur;
            this.particles.createForestRain(dur);
            this.drawTerrain();
            this.ensureForestRainLoop(900);
            this.wasRainActive = true;
          }
        }
      });
    }

    if (this.onKillFeedHandler) this.events.off('kill-feed', this.onKillFeedHandler);
    this.onKillFeedHandler = (ev: any) => {
      const kind = ev?.kind as string | undefined;
      const label = (ev?.label as string | undefined) ?? '';
      const points = Number(ev?.points ?? 0);
      const tag = (ev?.tag as string | undefined) ?? '';
      const bonus = Number(ev?.bonusPoints ?? 0);
      this.addKillFeedEntry(kind, label, points, tag, bonus);
    };
    this.events.on('kill-feed', this.onKillFeedHandler);

    if (this.onUpdateHudHandler) this.events.off('update-hud', this.onUpdateHudHandler);
    this.onUpdateHudHandler = (data: any) => {
      const hullEl = document.getElementById('hull-health');
      if (hullEl) hullEl.innerText = `车体状态: ${Math.ceil(data.hp)}%`;
      const ammoEl = document.getElementById('ammo-status');
      if (ammoEl) {
          if (data.isMortarCD) {
             ammoEl.innerText = `迫击炮冷却中...`;
          } else {
             const names: Record<string, string> = { 'STANDARD': '标准弹', 'HE': '高爆弹', 'AP': '穿甲弹', 'INCENDIARY': '燃烧弹', 'MORTAR': '迫击炮', 'NUKE': '核弹' };
             ammoEl.innerText = `弹药: ${names[data.shell] || data.shell}`;
          }
      }
      if (this.shellNameText?.active && typeof data.shell === 'string') {
        const names: Record<string, string> = { 'STANDARD': '标准弹', 'HE': '高爆弹', 'AP': '穿甲弹', 'INCENDIARY': '燃烧弹', 'MORTAR': '迫击炮', 'NUKE': '核弹' };
        this.shellNameText.setText(names[data.shell] || data.shell);
        if (data.shell !== this.lastShellPromptKey) {
          this.lastShellPromptKey = data.shell;
          this.triggerShellNamePrompt();
        }
      }
      if (typeof data.totalScore === 'number') {
        const scoreEl = document.getElementById('total-score');
        if (scoreEl) scoreEl.innerText = `总积分: ${Math.round(data.totalScore)}`;
      }
    };
    this.events.on('update-hud', this.onUpdateHudHandler);

    if (this.onPlayerNukeHandler) this.events.off('player-nuke', this.onPlayerNukeHandler);
    this.onPlayerNukeHandler = (data: any) => {
      const x = typeof data?.x === 'number' ? data.x : this.aimWorld.x;
      const y = typeof data?.y === 'number' ? data.y : this.aimWorld.y;
      const owner = data?.owner as Tank | undefined;
      const playDetonationSfx = data?.playDetonationSfx !== false;
      this.startNukeDrop(x, y, owner, playDetonationSfx);

      if (this.tutorialMode && owner?.isPlayer) {
        this.tutorialNukeShots += 1;
        if (this.tutorialCooldownBypass === 'nuke') {
          this.tutorialCooldownBypass = 'none';
          this.player?.setNoCooldown(false);
        }
      }
    };
    this.events.on('player-nuke', this.onPlayerNukeHandler);

    if (this.onCombatDamageHandler) this.events.off('combat-damage', this.onCombatDamageHandler);
    this.onCombatDamageHandler = () => {
      if (this.mapId !== 'forest') return;
      this.noteCombatDamage(this.time.now);
    };
    this.events.on('combat-damage', this.onCombatDamageHandler);

    if (this.onCombatActivityHandler) this.events.off('combat-activity', this.onCombatActivityHandler);
    this.onCombatActivityHandler = () => {
      if (this.mapId !== 'forest') return;
      this.noteEnemyCombatActivity(this.time.now);
    };
    this.events.on('combat-activity', this.onCombatActivityHandler);

    if (this.tutorialMode) {
      this.tutorialPlayerShellHandler = (ev: any) => {
        const st = Number(ev?.shellType);
        if (st === ShellType.MORTAR || st === ShellType.NUKE || st === ShellType.BULLET) return;
        this.tutorialMainShellShots += 1;
      };
      this.tutorialPlayerMortarHandler = () => {
        this.tutorialMortarShots += 1;
        if (this.tutorialCooldownBypass === 'mortar') {
          this.tutorialCooldownBypass = 'none';
          this.player?.setNoCooldown(false);
        }
      };
      this.tutorialPlayerNukeHandler = () => {
        if (this.tutorialCooldownBypass === 'nuke') {
          this.tutorialCooldownBypass = 'none';
          this.player?.setNoCooldown(false);
        }
      };

      this.events.on('player-fired-shell', this.tutorialPlayerShellHandler);
      this.events.on('player-fired-mortar', this.tutorialPlayerMortarHandler);
      this.events.on('player-fired-nuke', this.tutorialPlayerNukeHandler);
    }

    this.redeployQueued = false;
    this.onRedeployHandler = () => {
      if (this.redeployQueued) return;
      this.redeployQueued = true;
      if (this.onRedeployHandler) window.removeEventListener('panzer-redeploy', this.onRedeployHandler);
      this.isDefeat = false;
      window.dispatchEvent(new CustomEvent('panzer-defeat-clear'));
      this.softResetAudioForSceneTransition();
      this.scene.restart({
        mapId: this.mapId,
        ...(this.tutorialMode ? { tutorial: true } : {}),
        ...(this.testRoomEnabled ? { testRoom: true, testRoomSettings: { enemyAttack: this.testRoomAllowEnemyAttack, enemyMove: this.testRoomAllowEnemyMove, noCooldown: this.testRoomNoCooldown } } : {})
      });
    };
    window.addEventListener('panzer-redeploy', this.onRedeployHandler);
    this.onDefaultZoomHandler = (e: Event) => {
      const ce = e as CustomEvent;
      const raw = Number((ce as any)?.detail?.zoom);
      if (!Number.isFinite(raw)) return;
      const next = Math.round(Phaser.Math.Clamp(raw, 0.1, 1.5) * 10) / 10;
      this.defaultZoom = next;
      try { window.localStorage.setItem('panzer-default-zoom', next.toFixed(1)); } catch {}
      this.cameras.main.setZoom(next);
    };
    window.addEventListener('panzer-default-zoom', this.onDefaultZoomHandler);
    if (this.testRoomEnabled) this.setupTestRoomHooks();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.onKillFeedHandler) this.events.off('kill-feed', this.onKillFeedHandler);
      if (this.onUpdateHudHandler) this.events.off('update-hud', this.onUpdateHudHandler);
      if (this.onPlayerNukeHandler) this.events.off('player-nuke', this.onPlayerNukeHandler);
      if (this.onCombatDamageHandler) this.events.off('combat-damage', this.onCombatDamageHandler);
      if (this.onCombatActivityHandler) this.events.off('combat-activity', this.onCombatActivityHandler);
      this.onKillFeedHandler = undefined;
      this.onUpdateHudHandler = undefined;
      this.onPlayerNukeHandler = undefined;
      this.onCombatDamageHandler = undefined;
      this.onCombatActivityHandler = undefined;
      if (this.onRedeployHandler) window.removeEventListener('panzer-redeploy', this.onRedeployHandler);
      if (this.onDefaultZoomHandler) window.removeEventListener('panzer-default-zoom', this.onDefaultZoomHandler);
      if (this.onTestRoomCommand) window.removeEventListener('panzer-testroom-command', this.onTestRoomCommand);
      if (this.onTestRoomSettings) window.removeEventListener('panzer-testroom-settings', this.onTestRoomSettings);
      if (this.onTestRoomClear) window.removeEventListener('panzer-testroom-clear', this.onTestRoomClear);
      if (this.onTestRoomUiBlock) window.removeEventListener('panzer-testroom-ui-block', this.onTestRoomUiBlock);
      if (this.tutorialPlayerShellHandler) this.events.off('player-fired-shell', this.tutorialPlayerShellHandler);
      if (this.tutorialPlayerMortarHandler) this.events.off('player-fired-mortar', this.tutorialPlayerMortarHandler);
      if (this.tutorialPlayerNukeHandler) this.events.off('player-fired-nuke', this.tutorialPlayerNukeHandler);
      if (this.player?.active) this.player.setNoCooldown(false);
    this.destroyTutorialMoveMarker();
      if (this.testRoomEnabled) window.dispatchEvent(new CustomEvent('panzer-testroom-close'));
      this.emitTacticalMapData(true);
      this.scene.stop('UIScene');
    });

  }

  private advanceForestRainCounterAndCheck(): boolean {
    const key = 'panzer-forest-rain-count';
    let n = 0;
    try { n = Number.parseInt(window.localStorage.getItem(key) ?? '0', 10); } catch {}
    if (!Number.isFinite(n) || n < 0) n = 0;
    n += 1;
    try { window.localStorage.setItem(key, String(n)); } catch {}
    return (n % 20) === 0;
  }

  private ensureForestRainLoop(fadeInMs: number = 900) {
    if (this.mapId !== 'forest') return;
    const now = this.time.now;
    if (now < this.lastForestRainLoopEnsureT + 120) return;
    this.lastForestRainLoopEnsureT = now;
    this.audio.startLoop('amb_forest_rain', 'environment/forest/ambient_2d/weather/forest_rain/sfx', {
      volume: 0.8,
      fadeInMs
    }).catch(() => {});
  }

  private ensureBlackRainLoop(fadeInMs: number = 0) {
    if (this.mapId !== 'forest') return;
    const now = this.time.now;
    if (now < this.lastBlackRainLoopEnsureT + 120) return;
    this.lastBlackRainLoopEnsureT = now;
    this.audio.startLoop(this.blackRainLoopId, 'environment/forest/ambient_2d/weather/black_rain/sfx', {
      volume: 0.55,
      fadeInMs
    }).catch(() => {});
  }

  private triggerShellNamePrompt() {
    const t = this.shellNameText;
    if (!t?.active) return;
    if (this.shellNameFlashTween) this.shellNameFlashTween.stop();
    if (this.shellNameFadeTween) this.shellNameFadeTween.stop();
    t.setAlpha(0);
    t.setScale(0.88);
    this.shellNameFlashTween = this.tweens.add({
      targets: t,
      alpha: 0.95,
      scale: 1,
      duration: 140,
      ease: 'Sine.easeOut',
      onComplete: () => {
        if (!t.active) return;
        this.shellNameFadeTween = this.tweens.add({
          targets: t,
          delay: 900,
          alpha: 0,
          scale: 1.03,
          duration: 520,
          ease: 'Sine.easeIn',
          onComplete: () => { if (t.active) { t.setAlpha(0); t.setScale(1); } }
        });
      }
    });
  }

  private readDefaultZoom(): number {
    const key = 'panzer-default-zoom';
    let z = Number.parseFloat(window.localStorage.getItem(key) ?? '');
    if (!Number.isFinite(z)) z = this.sys.game.device.os.android ? 0.5 : 0.8;
    const min = this.sys.game.device.os.android ? 0.2 : 0.1;
    z = Phaser.Math.Clamp(z, min, 1.5);
    if (this.sys.game.device.os.android) {
      try { window.localStorage.setItem(key, z.toFixed(1)); } catch {}
    }
    return Math.round(z * 10) / 10;
  }

  public getEnemyAggroVisionScale(): number {
    const z = Number.isFinite(this.defaultZoom) ? this.defaultZoom : 1;
    return Phaser.Math.Clamp(2 - z, 0.5, 1.5);
  }

  private updateCooldownPanel(now: number) {
    const player = this.player;
    if (!player) return;

    const cd = player.getCooldownRemaining(now);
    const setBar = (barId: string, textId: string, remainingMs: number, totalMs: number) => {
      const barEl = document.getElementById(barId) as HTMLElement | null;
      const textEl = document.getElementById(textId);
      if (barEl) {
        const p = totalMs <= 0 ? 1 : Phaser.Math.Clamp(1 - remainingMs / totalMs, 0, 1);
        barEl.style.width = `${(p * 100).toFixed(1)}%`;
      }
      if (textEl) {
        textEl.innerText = remainingMs <= 0 ? '就绪' : `${(remainingMs / 1000).toFixed(1)}s`;
      }
    };

    setBar('cd-std-bar', 'cd-std-text', cd.shells[ShellType.STANDARD] ?? 0, 500);
    setBar('cd-he-bar', 'cd-he-text', cd.shells[ShellType.HE] ?? 0, 7000);
    setBar('cd-ap-bar', 'cd-ap-text', cd.shells[ShellType.AP] ?? 0, 5000);
    setBar('cd-inc-bar', 'cd-inc-text', cd.shells[ShellType.INCENDIARY] ?? 0, 1250);
    setBar('cd-mtr-bar', 'cd-mtr-text', cd.mortarMs, 20000);
    setBar('cd-nuk-bar', 'cd-nuk-text', (cd as any).nukeMs ?? 0, 60000);

    {
      const chainEl = document.getElementById('cd-mg-chain') as HTMLElement | null;
      const textEl = document.getElementById('cd-mg-text');
      const magSize = (player as any).getMachineGunMagSize?.() ?? 30;
      const ammo = (player as any).getMachineGunAmmo?.() ?? magSize;
      const reloadRemaining = (player as any).getMachineGunReloadRemaining?.(now) ?? 0;
      const reloadTotal = (player as any).getMachineGunReloadTotalMs?.() ?? 3000;

      if (textEl) textEl.innerText = reloadRemaining > 0 ? `${(reloadRemaining / 1000).toFixed(1)}s` : '';

      if (chainEl) {
        const bullets = Array.from(chainEl.children) as HTMLElement[];
        const size = Math.min(magSize, bullets.length);
        const pReload = reloadRemaining > 0 ? Phaser.Math.Clamp(1 - (reloadRemaining / Math.max(1, reloadTotal)), 0, 1) : 0;
        const preview = reloadRemaining > 0 && ammo <= 0 ? Phaser.Math.Clamp(Math.floor(pReload * magSize), 0, magSize) : 0;
        const previewFrac = reloadRemaining > 0 && ammo <= 0 ? Phaser.Math.Clamp(pReload * magSize - preview, 0, 1) : 0;

        for (let i = 0; i < size; i++) {
          const el = bullets[i];
          if (!el) continue;

          const filled = ammo > 0 ? i < ammo : (reloadRemaining > 0 ? (i < preview) : false);
          if (filled) {
            el.style.backgroundColor = '#10b981';
            el.style.opacity = '1';
            el.style.transform = 'scaleY(1)';
            continue;
          }

          if (reloadRemaining > 0 && ammo <= 0 && i === preview && previewFrac > 0) {
            const a = 0.25 + 0.75 * previewFrac;
            el.style.backgroundColor = '#10b981';
            el.style.opacity = `${a}`;
            el.style.transform = `scaleY(${0.75 + 0.25 * previewFrac})`;
            continue;
          }

          if (reloadRemaining > 0 && ammo <= 0 && i >= preview && i < preview + 3) {
            const wave = (Math.sin(now * 0.02 + i * 0.6) + 1) * 0.5;
            el.style.backgroundColor = '#10b981';
            el.style.opacity = `${0.08 + wave * 0.18}`;
            el.style.transform = 'scaleY(0.85)';
            continue;
          }

          el.style.backgroundColor = 'rgba(63, 63, 70, 0.7)';
          el.style.opacity = '1';
          el.style.transform = 'scaleY(0.85)';
        }
      }
    }

    const fuelBarEl = document.getElementById('lift-fuel-bar') as HTMLElement | null;
    const fuelTextEl = document.getElementById('lift-fuel-text');
    const fuel = Phaser.Math.Clamp(player.getLiftFuelFraction?.() ?? 1, 0, 1);
    if (fuelBarEl) fuelBarEl.style.width = `${(fuel * 100).toFixed(1)}%`;
    if (fuelTextEl) fuelTextEl.innerText = `${Math.round(fuel * 100)}%`;
  }

  private setupTreeCollisions() {
    this.physics.add.collider(this.enemiesGroup, this.treeGroup, (obj1: any, obj2: any) => this.handleTreeCollision(obj1 as Phaser.Physics.Arcade.Sprite, obj2 as Phaser.Physics.Arcade.Sprite));
    this.playerTreeCollider = this.physics.add.collider(this.player.chassis, this.treeGroup, (obj1: any, obj2: any) => this.handleTreeCollision(obj1 as Phaser.Physics.Arcade.Sprite, obj2 as Phaser.Physics.Arcade.Sprite));
  }

  private shouldCollidePlayerEnemy(_: any, enemyObj: any): boolean {
    if (!enemyObj?.active) return false;
    return true;
  }

  private handlePlayerEnemyCollision(playerObj: any, enemyObj: any) {
    const pb = playerObj?.body as Phaser.Physics.Arcade.Body | undefined;
    const eb = enemyObj?.body as Phaser.Physics.Arcade.Body | undefined;
    const now = this.time.now;

    const enemyRef =
      (typeof enemyObj?.getData === 'function' ? enemyObj.getData('tankRef') : undefined) ??
      (typeof enemyObj?.getData === 'function' ? enemyObj.getData('enemyRef') : undefined) ??
      enemyObj;

    const p = this.player as any;
    if (p?.tryRamHit) p.tryRamHit(enemyRef, now);

    if (!pb || !eb || eb.immovable) return;
    const pm = Math.max(1, (pb.width * pb.height) / 120);
    const em = Math.max(1, (eb.width * eb.height) / 120);
    const total = pm + em;
    if (!(total > 0)) return;
    const relVx = pb.velocity.x - eb.velocity.x;
    const scale = p?.isRamming?.(now) ? 1.9 : 1.0;
    const push = relVx * (pm / total) * 0.85 * scale;
    eb.setVelocityX(eb.velocity.x + push);
    pb.setVelocityX(pb.velocity.x - relVx * (em / total) * 0.25);

  }

  public handlePlayerDefeat() {
    if (this.isDefeat) return;
    this.isDefeat = true;
    this.cameras.main.stopFollow();
    this.playerDebrisOverlap?.destroy();
    this.playerDebrisOverlap = undefined;
    this.playerTreeCollider?.destroy();
    this.playerTreeCollider = undefined;
    this.playerEnemiesCollider?.destroy();
    this.playerEnemiesCollider = undefined;
    this.input.enabled = false;
    this.scene.stop('UIScene');

    const px = this.player?.chassis?.x ?? 0;
    const py = this.player?.chassis?.y ?? 0;
    window.dispatchEvent(new CustomEvent('panzer-defeat', { detail: { score: this.score, tankKills: this.vehicleKills, infantryKills: this.infantryKills, saved: this.savedInCurrentRound, x: px, y: py } }));
  }

  public handleTreeCollision(collider: any, tree: Phaser.Physics.Arcade.Sprite) {
    if (!tree.active || tree.getData('collapsed')) return;
    
    let shouldCollapse = false;
    let forceX = 0;

    if (collider instanceof Phaser.Physics.Arcade.Sprite) {
        const velX = Math.abs(collider.body.velocity.x);
        if (velX > 50) {
            shouldCollapse = true;
            forceX = collider.x < tree.x ? 1 : -1;
        }
    } else {
        shouldCollapse = true;
        forceX = Math.random() > 0.5 ? 1 : -1;
    }

    if (shouldCollapse) {
        tree.setData('collapsed', true);

        const treeBody = tree.body as Phaser.Physics.Arcade.Body;
        treeBody.setImmovable(false);
        treeBody.setAllowGravity(true);
        treeBody.setAngularVelocity(forceX * 100);
        treeBody.setVelocityX(forceX * 50);
        
        // Play Tree Fall/Collapse Sound
        const texKey = tree.texture?.key as string | undefined;
        if (texKey && (texKey.startsWith('veg_tree') || texKey === 'veg_pine')) {
             const folderKey = texKey.startsWith('veg_tree') ? 'veg_tree' : texKey;
             const path = `environment/forest/point_3d/static/plants/vegetation/${folderKey}/touch/sfx`;
             this.audio.playFolder(path, { worldX: tree.x, volume: 1.0, cooldownMs: 0 });
         }

        this.particles.createFleeingBirds(tree.x, tree.y - 100);
        this.particles.createConcreteDust(tree.x, tree.y, "impact");
        this.time.delayedCall(2000, () => {
            if (tree.active) {
                const b = tree.body as Phaser.Physics.Arcade.Body;
                if (b) b.enable = false;
                this.tweens.add({ targets: tree, alpha: 0, duration: 2000, onComplete: () => tree.destroy() });
            }
        });
    }
  }

  private setupDebrisCollision() {
    if (this.debrisTerrainCollider) return;
    this.physics.add.collider(this.debrisGroup, this.terrainBodies, (debris: any) => {
      const body = debris.body as Phaser.Physics.Arcade.Body;
      if (!body.enable) return;
      if (body.blocked.down || body.touching.down) {
          body.setAngularVelocity(body.angularVelocity * 0.1);
          body.setVelocityX(body.velocity.x * 0.75);
          
          if (Math.abs(body.angularVelocity) < 45 && Math.abs(body.velocity.x) < 18 && Math.abs(body.velocity.y) < 90) {
              body.setVelocity(0, 0);
              body.setAngularVelocity(0);
              body.setAllowRotation(false);
              body.setImmovable(true);
              body.setAllowGravity(false);
              debris.setData('sleeping', true);
          }
      }
    });

    this.physics.add.overlap(this.player.chassis, this.debrisGroup, (player, debris) => this.collectDebris(debris));
  }

  private wakeSleepingDebrisInRange(xMin: number, xMax: number) {
    const children = this.debrisGroup.getChildren() as any[];
    for (const d of children) {
      if (!d) continue;
      if (d.getData('hibernating')) {
        if (d.x >= xMin - 120 && d.x <= xMax + 120) {
          d.setData('hibernating', false);
          d.setActive(true).setVisible(true);
          const body = d.body as Phaser.Physics.Arcade.Body | undefined;
          body?.setEnable(true);
        } else {
          continue;
        }
      }
      if (!d.active) continue;
      if (!d.getData('sleeping')) continue;
      if (d.x < xMin - 120 || d.x > xMax + 120) continue;

      const terrainY = this.getTerrainHeight(d.x);
      if (d.y + 10 < terrainY - 6) {
        const body = d.body as Phaser.Physics.Arcade.Body;
        body.setImmovable(false);
        body.setAllowGravity(true);
        body.setAllowRotation(true);
        body.setVelocity(0, 0);
        d.setData('sleeping', false);
      }
    }
  }

  private hibernateSleepingDebrisOutOfRange(xMin: number, xMax: number) {
    const children = this.debrisGroup.getChildren() as any[];
    for (const d of children) {
      if (!d?.active) continue;
      if (!d.getData('sleeping')) continue;
      if (d.getData('hibernating')) continue;
      if (d.x >= xMin - 900 && d.x <= xMax + 900) continue;
      const body = d.body as Phaser.Physics.Arcade.Body | undefined;
      body?.setEnable(false);
      d.setActive(false).setVisible(false);
      d.setData('hibernating', true);
    }
  }

  private updateDistantObjects() {
    const cam = this.cameras.main;
    const viewW = cam.width / Math.max(0.0001, cam.zoom);
    const wakeLeft = cam.scrollX - this.VIEW_BUFFER;
    const wakeRight = cam.scrollX + viewW + this.VIEW_BUFFER;
    const sleepLeft = cam.scrollX - (this.VIEW_BUFFER + 1200);
    const sleepRight = cam.scrollX + viewW + (this.VIEW_BUFFER + 1200);

    const setSleepState = (obj: any, sleep: boolean) => {
      if (!obj) return;
      if (sleep) {
        if (obj.active) obj.setActive(false);
        if (obj.visible) obj.setVisible(false);
        const body = obj.body as Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | undefined;
        (body as any)?.setEnable?.(false);
      } else {
        if (!obj.active) obj.setActive(true);
        if (!obj.visible) obj.setVisible(true);
        const body = obj.body as Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody | undefined;
        (body as any)?.setEnable?.(true);
        (body as any)?.updateFromGameObject?.();
      }
    };

    const veg = this.vegetationGroup?.getChildren?.() as any[] | undefined;
    if (Array.isArray(veg)) {
      for (const v of veg) {
        if (!v) continue;
        const vx = v.x as number;
        const inWake = vx >= wakeLeft && vx <= wakeRight;
        const inSleep = vx >= sleepLeft && vx <= sleepRight;
        if (!inSleep) {
          setSleepState(v, true);
          continue;
        }
        if (inWake) {
          setSleepState(v, false);
          if (typeof v.getData === 'function' && v.getData('isWaterPlant')) continue;
          if (typeof v.getData === 'function' && v.getData('isFish')) continue;
          v.y = this.getTerrainHeight(vx);
        }
      }
    }

    const trees = this.treeGroup?.getChildren?.() as any[] | undefined;
    if (Array.isArray(trees)) {
      for (const t of trees) {
        if (!t) continue;
        if (typeof t.getData === 'function' && t.getData('collapsed')) continue;
        const tx = t.x as number;
        const inWake = tx >= wakeLeft && tx <= wakeRight;
        const inSleep = tx >= sleepLeft && tx <= sleepRight;
        if (!inSleep) {
          setSleepState(t, true);
          continue;
        }
        if (inWake) {
          setSleepState(t, false);
          t.y = this.getTerrainHeight(tx);
        }
      }
    }

    const fauna = this.faunaGroup?.getChildren?.() as any[] | undefined;
    if (Array.isArray(fauna)) {
      for (const f of fauna) {
        if (!f) continue;
        const fx = f.x as number;
        const inWake = fx >= wakeLeft && fx <= wakeRight;
        const inSleep = fx >= sleepLeft && fx <= sleepRight;
        if (!inSleep) setSleepState(f, true);
        else if (inWake) setSleepState(f, false);
      }
    }
  }

  private getDebrisScore(tex: string): number {
    if (tex.startsWith('brick_')) return 5;
    if (tex === 'brick_base' || tex === 'brick_metal') return 5;
    if (tex === 'meat_chunk') return 8;
    if (tex.startsWith('inf_')) return 6;
    if (tex.startsWith('hunter_debris_')) return 14;
    if (tex === 'heli_body') return 180;
    if (tex === 'armoredcar_body') return 150;
    if (tex.includes('armored')) return 150; // Fallback
    if (tex === 'shell_model') return 10;
    if (tex.endsWith('_hull')) return 120;
    if (tex.endsWith('_turret')) return 90;
    if (tex.includes('_barrel_') || tex.endsWith('_barrel_0')) return 60;
    if (tex.endsWith('_wheel')) return 30;
    if (tex.endsWith('_detail')) return 25;
    return 0;
  }

  private collectDebris(debris: any) {
    if (!debris?.active) return;
    if (debris.getData('collected')) return;
    const tex = debris.texture?.key as string | undefined;
    if (!tex) return;
    const isPenalty = !!debris.getData('friendlyPenaltyFragment');
    const pts = isPenalty ? -10 : this.getDebrisScore(tex);
    if (!isPenalty && pts <= 0) return;

    debris.setData('collected', true);
    this.score += pts;
    if (this.scoreText?.active) this.scoreText.setText(`积分: ${this.score}`);

    const popText = pts >= 0 ? `+${pts}` : `${pts}`;
    const popColor = pts >= 0 ? '#ffffaa' : '#ff6666';
    const pop = this.add.text(debris.x, debris.y - 18, popText, { fontSize: '16px', color: popColor, stroke: '#000', strokeThickness: 4 }).setDepth(220);
    this.tweens.add({ targets: pop, y: pop.y - 35, alpha: 0, duration: 650, onComplete: () => pop.destroy() });

    this.tweens.killTweensOf(debris);
    const body = debris.body as Phaser.Physics.Arcade.Body | undefined;
    if (body) body.setEnable(false);
    debris.destroy();
  }

  public addBloodStain(x: number, y: number) {
    // Bloodstain effect removed as per user request
  }
// removed legacy bloodstain code

  private createAssets() {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const drawTankPart = (prefix: string, bodyColor: number, darkColor: number, isBoxy: boolean = false) => {
        const toColor = (hex: number) => Phaser.Display.Color.IntegerToColor(hex);
        const shade = (hex: number, delta: number) => {
            const c = toColor(hex);
            return Phaser.Display.Color.GetColor(
                Phaser.Math.Clamp(c.red + delta, 0, 255),
                Phaser.Math.Clamp(c.green + delta, 0, 255),
                Phaser.Math.Clamp(c.blue + delta, 0, 255)
            );
        };

        g.clear();
        const hullW = 110;
        const hullH = 55;
        const trackTop = hullH - 15;
        const bodyHighlight = shade(bodyColor, 26);
        const bodyMid = shade(bodyColor, -16);
        const bodyShadow = shade(bodyColor, -48);
        const darkHighlight = shade(darkColor, 14);

        g.fillStyle(0x07090b, 1);
        g.fillRoundedRect(1, trackTop - 2, hullW - 2, 14, 4);
        g.fillStyle(0x171d24, 0.95);
        g.fillRoundedRect(3, trackTop, hullW - 6, 10, 4);
        for (let i = 5; i < hullW - 8; i += 6) {
            const treadTint = (i / 6) % 2 === 0 ? 0x2b323a : 0x1c2128;
            g.fillStyle(treadTint, 0.56);
            g.fillRect(i, trackTop + 1, 3, 8);
        }
        g.fillStyle(0x000000, 0.28);
        g.fillRect(6, trackTop + 8, hullW - 12, 2);

        if (isBoxy) {
            g.fillStyle(bodyShadow, 1);
            g.fillRoundedRect(4, 7, 102, 36, 4);
            g.fillStyle(bodyColor, 1);
            g.fillRoundedRect(8, 6, 94, 30, 4);
            g.fillStyle(bodyHighlight, 0.2);
            g.fillRect(10, 8, 86, 7);
            g.fillStyle(bodyMid, 0.44);
            g.fillRect(14, 24, 78, 10);
            g.fillStyle(darkColor, 0.62);
            g.fillTriangle(8, 6, 30, 6, 8, 23);
            g.fillStyle(darkHighlight, 0.55);
            g.fillRect(80, 11, 17, 18);
        } else {
            g.fillStyle(bodyShadow, 1);
            g.fillRoundedRect(1, 9, 108, 34, 13);
            g.fillStyle(bodyColor, 1);
            g.fillRoundedRect(3, 7, 104, 29, 11);
            g.fillStyle(bodyHighlight, 0.2);
            g.fillEllipse(53, 13, 84, 10);
            g.fillStyle(bodyMid, 0.38);
            g.fillEllipse(56, 29, 90, 13);
            g.fillStyle(darkColor, 0.4);
            g.fillTriangle(4, 36, 106, 36, 56, 8);
        }

        g.fillStyle(0x11151b, 0.66);
        for (let i = 0; i < 4; i++) {
            const sx = isBoxy ? 84 + i * 4 : 79 + i * 5;
            g.fillRect(sx, 10, 2, 13);
        }

        g.lineStyle(1, shade(bodyColor, -70), 0.52);
        g.beginPath();
        g.moveTo(14, 18);
        g.lineTo(92, 18);
        g.moveTo(18, 29);
        g.lineTo(88, 29);
        g.strokePath();

        g.fillStyle(0x0e1116, 0.72);
        g.fillRoundedRect(18, 16, 15, 7, 2);
        g.fillRoundedRect(38, 16, 18, 7, 2);
        g.fillRoundedRect(61, 16, 14, 7, 2);

        g.fillStyle(0x000000, 0.42);
        for (let i = 0; i < 8; i++) {
            const bx = 13 + i * 11;
            g.fillCircle(bx, 35, 1.2);
        }

        g.generateTexture(`${prefix}_hull`, hullW, hullH);

        g.clear();
        const wheelSize = 40;
        const r = wheelSize * 0.5;
        g.fillStyle(0x06080a, 1);
        g.fillCircle(r, r, r);
        g.fillStyle(0x1a2027, 1);
        g.fillCircle(r, r, r - 4);
        g.fillStyle(shade(darkColor, 4), 1);
        g.fillCircle(r, r, r - 8.2);
        g.fillStyle(shade(bodyColor, -4), 0.95);
        g.fillCircle(r, r, r - 11.8);
        g.fillStyle(bodyHighlight, 0.28);
        g.fillEllipse(r - 2, r - 3, 10, 7);
        g.fillStyle(0x0e1117, 1);
        g.fillCircle(r, r, 3.3);
        g.fillStyle(0x2a323b, 0.88);
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            g.fillCircle(r + Math.cos(a) * (r - 11), r + Math.sin(a) * (r - 11), 1.55);
        }
        g.generateTexture(`${prefix}_wheel`, wheelSize, wheelSize);

        g.clear();
        if (prefix === 'stug' || prefix === 'a7v') {
             g.generateTexture(`${prefix}_turret`, 1, 1);
        } else {
            const tW = 65;
            const tH = 36;
            if (isBoxy) {
                g.fillStyle(shade(bodyColor, -58), 1);
                g.fillRoundedRect(0, 4, tW, tH - 8, 4);
                g.fillStyle(bodyColor, 1);
                g.fillRoundedRect(4, 1, tW - 8, tH - 7, 4);
                g.fillStyle(bodyHighlight, 0.22);
                g.fillRect(7, 3, tW - 20, 6);
                g.fillStyle(shade(bodyColor, -30), 0.5);
                g.fillRect(11, 16, tW - 24, 8);
                g.fillStyle(shade(darkColor, -6), 1);
                g.fillRoundedRect(11, 0, 16, 6, 2);
                g.fillStyle(shade(darkColor, 20), 0.65);
                g.fillCircle(18, 3, 1.4);
            } else {
                g.fillStyle(shade(bodyColor, -50), 1);
                g.fillEllipse(tW * 0.5, tH * 0.58, tW, tH);
                g.fillStyle(bodyColor, 1);
                g.fillEllipse(tW * 0.5, tH * 0.48, tW * 0.9, tH * 0.84);
                g.fillStyle(bodyHighlight, 0.22);
                g.fillEllipse(tW * 0.47, 10, tW * 0.55, 8);
                g.fillStyle(shade(bodyColor, -24), 0.5);
                g.fillEllipse(tW * 0.57, 21, tW * 0.58, 11);
                g.fillStyle(shade(darkColor, -2), 1);
                g.fillEllipse(20, 6, 15, 8);
                g.fillStyle(shade(darkColor, 20), 0.62);
                g.fillCircle(23, 5, 1.4);
            }
            g.fillStyle(0x0f141b, 0.76);
            g.fillRoundedRect(36, 13, 12, 6, 2);
            g.generateTexture(`${prefix}_turret`, tW, tH);
        }

        [0, 1, 2, 3, 4].forEach(idx => {
            g.clear();
            const bL = 100;
            const bH = 50;
            const cy = bH * 0.5;
            const width = prefix === 'maus' ? 13.5 : 9.2;
            const sway = (idx - 2) * 0.26;

            g.fillStyle(shade(darkColor, -8), 1);
            g.fillCircle(10, cy, width * 1.18);
            g.fillStyle(shade(bodyColor, -26), 0.95);
            g.fillCircle(10, cy, width * 0.8);

            g.fillStyle(0x10151b, 1);
            g.fillRoundedRect(10, cy - width * 0.5 + sway, 80, width, 3);
            g.fillStyle(shade(bodyColor, -16), 0.58);
            g.fillRect(14, cy - width * 0.32 + sway, 70, width * 0.22);
            g.fillStyle(0x0a0d12, 0.9);
            g.fillRect(26, cy - width * 0.5 + sway, 2, width);
            g.fillRect(46, cy - width * 0.5 + sway, 2, width);
            g.fillRect(66, cy - width * 0.5 + sway, 2, width);

            g.fillStyle(0x0a0d11, 1);
            g.fillRoundedRect(87, cy - width * 0.8 + sway * 0.8, 10, width * 1.6, 2);
            g.fillStyle(shade(darkColor, 10), 0.72);
            g.fillRoundedRect(89, cy - width * 0.58 + sway * 0.8, 6, width * 1.16, 1);

            g.generateTexture(`${prefix}_barrel_${idx}`, bL, bH);
        });

        g.clear();
        g.lineStyle(2.2, 0x11161c, 0.95);
        g.beginPath();
        g.moveTo(9, 25);
        g.lineTo(91, 25);
        g.strokePath();
        g.lineStyle(1.4, shade(bodyColor, -60), 0.78);
        g.beginPath();
        g.moveTo(16, 15);
        g.lineTo(31, 17);
        g.lineTo(46, 15);
        g.lineTo(61, 18);
        g.lineTo(78, 16);
        g.strokePath();
        g.fillStyle(0x2a323b, 0.95);
        g.fillRoundedRect(18, 18, 13, 6, 2);
        g.fillRoundedRect(37, 17, 11, 7, 2);
        g.fillRoundedRect(55, 18, 13, 6, 2);
        g.fillStyle(0x0b0f15, 0.95);
        g.fillEllipse(88, 18, 10, 8);
        g.fillEllipse(88, 31, 10, 8);
        g.fillStyle(bodyHighlight, 0.28);
        g.fillCircle(91, 18, 1.3);
        g.fillCircle(91, 31, 1.3);
        g.generateTexture(`${prefix}_detail`, 100, 40);
    };
    const drawPlayerMuscleCarPart = (prefix: string, bodyColor: number, darkColor: number) => {
        g.clear();
        g.fillStyle(darkColor, 1);
        g.fillRoundedRect(2, 21, 106, 24, 12);
        g.fillStyle(bodyColor, 1);
        g.fillRoundedRect(6, 17, 98, 22, 12);
        g.fillStyle(bodyColor, 1);
        g.fillRoundedRect(6, 14, 52, 18, 10);
        g.fillStyle(0xffffff, 0.32);
        g.fillEllipse(30, 22, 44, 14);
        
        g.fillStyle(darkColor, 0.92);
        g.fillRoundedRect(48, 10, 30, 14, 6);
        g.fillStyle(0x0a0a0a, 0.55);
        g.fillRoundedRect(52, 12, 22, 10, 4);

        g.fillStyle(darkColor, 0.85);
        g.fillEllipse(26, 38, 28, 18);
        g.fillEllipse(86, 38, 28, 18);
        g.fillStyle(0x000000, 0.22);
        g.fillRect(12, 38, 88, 4);
        g.fillStyle(0xffffff, 0.18);
        g.fillRect(14, 29, 70, 3);

        g.fillStyle(darkColor, 0.98);
        g.fillRoundedRect(80, 16, 30, 24, 9);
        g.fillStyle(bodyColor, 0.92);
        g.fillRoundedRect(86, 20, 22, 16, 7);
        g.fillStyle(0xffffff, 0.35);
        g.fillCircle(107, 26, 3.0);
        g.fillCircle(107, 34, 3.0);

        g.fillStyle(0x0a0a0a, 0.95);
        for (let i = 0; i < 4; i++) {
          const tx = 86 + i * 6;
          g.fillTriangle(tx, 42, tx + 6, 44, tx, 46);
        }

        g.fillStyle(0x0a0a0a, 0.5);
        g.fillCircle(82, 26, 2.6);
        g.fillCircle(88, 26, 2.6);
        g.fillCircle(94, 26, 2.6);
        g.fillCircle(82, 32, 2.6);
        g.fillCircle(88, 32, 2.6);
        g.fillCircle(94, 32, 2.6);

        g.fillStyle(0x000000, 0.18);
        g.fillRoundedRect(70, 18, 18, 8, 3);
        g.fillRoundedRect(70, 28, 18, 8, 3);
        g.generateTexture(`${prefix}_hull`, 110, 55);

        g.clear();
        g.fillStyle(0x111111, 0.45);
        g.fillRoundedRect(18, 18, 18, 8, 3);
        g.fillRoundedRect(64, 18, 18, 8, 3);
        g.fillStyle(0xbfc3c7, 1);
        g.fillTriangle(28, 28, 50, 18, 72, 28);
        g.fillTriangle(28, 28, 50, 36, 72, 28);
        g.fillStyle(0x8a8f95, 1);
        g.fillRect(48, 18, 4, 20);
        g.fillStyle(0x202326, 1);
        g.fillCircle(50, 28, 2.2);
        g.fillCircle(38, 28, 1.6);
        g.fillCircle(62, 28, 1.6);
        g.generateTexture(`${prefix}_detail`, 100, 40);
    };
    const drawTumbleweedPart = (prefix: string, bodyColor: number, darkColor: number) => {
        g.clear();
        g.fillStyle(darkColor);
        g.fillCircle(55, 28, 26);
        g.fillStyle(bodyColor);
        g.fillCircle(55, 27, 22);
        g.fillStyle(0x000000, 0.12);
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2;
          const r0 = 12 + (i % 3) * 3;
          const r1 = 26;
          g.lineStyle(2, 0x000000, 0.18);
          g.beginPath();
          g.moveTo(55 + Math.cos(a) * r0, 27 + Math.sin(a) * r0);
          g.lineTo(55 + Math.cos(a) * r1, 27 + Math.sin(a) * r1);
          g.strokePath();
        }
        g.generateTexture(`${prefix}_hull`, 110, 55);

        g.clear();
        g.fillStyle(0x000000, 0.1);
        g.fillCircle(20, 20, 18);
        g.generateTexture(`${prefix}_wheel`, 40, 40);

        g.clear();
        g.generateTexture(`${prefix}_turret`, 1, 1);

        [0, 1, 2, 3, 4].forEach(idx => {
            g.clear();
            g.lineStyle(6, 0x1a120a, 1);
            g.beginPath();
            g.moveTo(4, 25);
            g.lineTo(70, 25);
            g.strokePath();
            g.lineStyle(2, 0x2a1a0f, 1);
            g.beginPath();
            g.moveTo(18 + idx * 2, 18);
            g.lineTo(26 + idx * 2, 25);
            g.lineTo(18 + idx * 2, 32);
            g.strokePath();
            g.generateTexture(`${prefix}_barrel_${idx}`, 100, 50);
        });

        g.clear();
        g.lineStyle(3, 0x000000, 0.18);
        for (let i = 0; i < 9; i++) {
          const x = 10 + i * 10;
          g.beginPath();
          g.moveTo(x, 8);
          g.lineTo(x + Phaser.Math.Between(-6, 6), 34);
          g.strokePath();
        }
        g.generateTexture(`${prefix}_detail`, 100, 40);
    };
    const drawHunterPart = (prefix: string, bodyColor: number, darkColor: number) => {
        // --- HULL: muscular blocky armor silhouette ---
        g.clear();
        const hullW = 124, hullH = 60;

        g.fillStyle(0x07090b, 1);
        g.fillRoundedRect(2, hullH - 16, hullW - 4, 14, 5);
        g.fillStyle(0x000000, 0.48);
        for (let i = 6; i < hullW - 8; i += 6) {
          g.fillRect(i, hullH - 16, 3, 14);
        }

        g.fillStyle(darkColor, 1);
        g.fillRoundedRect(5, 9, hullW - 18, 34, 12);
        g.fillStyle(bodyColor, 0.98);
        g.fillRoundedRect(10, 10, hullW - 28, 28, 10);

        g.fillStyle(0x222a34, 0.95);
        g.fillRoundedRect(16, 13, 24, 22, 7);
        g.fillRoundedRect(42, 11, 28, 24, 8);
        g.fillRoundedRect(72, 13, 28, 21, 7);
        g.fillRoundedRect(102, 15, 12, 19, 4);

        g.fillStyle(0x141a20, 0.92);
        g.fillRoundedRect(24, 19, 66, 9, 4);
        g.fillStyle(0x8b2a33, 0.55);
        g.fillRoundedRect(28, 21, 58, 3, 1);

        g.fillStyle(0x0d1116, 0.95);
        g.fillEllipse(12, 21, 12, 14);
        g.fillEllipse(12, 34, 14, 12);
        g.fillStyle(0x000000, 0.75);
        g.fillCircle(12, 21, 2.2);
        g.fillCircle(12, 34, 2.2);

        g.fillStyle(0x12171d, 1);
        g.fillRect(hullW - 31, 15, 3, 16);
        g.fillRect(hullW - 25, 13, 3, 18);
        g.fillRect(hullW - 19, 11, 3, 20);

        g.lineStyle(2, 0x2b3541, 0.82);
        g.beginPath();
        g.moveTo(20, 33);
        g.lineTo(38, 18);
        g.lineTo(58, 20);
        g.lineTo(78, 15);
        g.lineTo(102, 17);
        g.strokePath();

        g.generateTexture(`${prefix}_hull`, hullW, hullH);

        // --- WHEEL: heavy military metal, subtle red core ---
        g.clear();
        const wheelSize = 42;
        const r = wheelSize / 2;
        g.fillStyle(0x06080a, 1);
        g.fillCircle(r, r, r);
        g.fillStyle(0x1e242b, 1);
        g.fillCircle(r, r, r - 4);
        g.fillStyle(0x36404b, 1);
        g.fillCircle(r, r, r - 8);
        g.fillStyle(0x85262f, 0.72);
        g.fillEllipse(r + 0.4, r - 0.2, 12, 10);
        g.fillStyle(0x0f1318, 1);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          g.fillCircle(r + Math.cos(a) * (r - 11), r + Math.sin(a) * (r - 11), 1.8);
        }
        g.generateTexture(`${prefix}_wheel`, wheelSize, wheelSize);

        // --- TURRET: broad shoulders + centered threatening optic ---
        g.clear();
        const tW = 80, tH = 46;
        g.fillStyle(darkColor, 1);
        g.fillRoundedRect(6, 13, 68, 26, 10);
        g.fillStyle(bodyColor, 0.98);
        g.fillRoundedRect(10, 12, 60, 21, 8);
        g.fillStyle(0x202933, 0.96);
        g.fillRoundedRect(16, 14, 44, 12, 5);
        g.fillStyle(0x11161b, 0.95);
        g.fillRoundedRect(20, 16, 32, 8, 4);
        g.fillStyle(0x8d2b34, 0.88);
        g.fillCircle(46, 20, 2.7);
        g.fillStyle(0xffffff, 0.38);
        g.fillCircle(46.7, 19.2, 0.9);
        g.fillStyle(0x161d24, 0.92);
        g.fillEllipse(12, 21, 8, 6);
        g.fillEllipse(68, 21, 9, 6);
        g.generateTexture(`${prefix}_turret`, tW, tH);

        // --- BARREL: thick concentric cannon with muscle segments ---
        [0, 1, 2, 3, 4].forEach(idx => {
            g.clear();
            const bL = 112, bH = 56;
            const cy = bH / 2;
            const wobble = (idx - 2) * 0.24;

            g.fillStyle(0x2f3945, 1);
            g.fillCircle(16, cy, 13);
            g.fillStyle(0x46515d, 1);
            g.fillCircle(16, cy, 9.4);

            g.fillStyle(0x11161c, 1);
            g.fillRoundedRect(16, cy - 6.4 + wobble, 34, 12.8, 4);
            g.fillRoundedRect(49, cy - 6.0 + wobble * 0.85, 24, 12, 4);
            g.fillRoundedRect(72, cy - 5.6 + wobble * 0.7, 20, 11.2, 4);

            g.fillStyle(0x3b4550, 0.95);
            g.fillRect(22, cy - 4.8 + wobble, 22, 2.2);
            g.fillRect(52, cy - 4.2 + wobble * 0.85, 16, 2.0);

            g.fillStyle(0x0e1218, 1);
            g.fillRoundedRect(90, cy - 9 + wobble * 0.6, 14, 18, 3);
            g.fillStyle(0x28313b, 1);
            g.fillRoundedRect(92, cy - 7 + wobble * 0.6, 10, 14, 2);
            g.fillStyle(0x06090d, 1);
            g.fillRoundedRect(101, cy - 4 + wobble * 0.6, 8, 8, 2);

            g.generateTexture(`${prefix}_barrel_${idx}`, bL, bH);
        });

        // --- DETAIL layer: restrained accents and contour lines ---
        g.clear();
        g.lineStyle(2.4, 0x161d25, 0.95);
        g.beginPath();
        g.moveTo(8, 25);
        g.lineTo(92, 25);
        g.strokePath();

        g.lineStyle(1.5, 0x34404c, 0.78);
        g.beginPath();
        g.moveTo(14, 13);
        g.lineTo(30, 18);
        g.lineTo(44, 16);
        g.lineTo(58, 20);
        g.lineTo(72, 18);
        g.lineTo(84, 23);
        g.strokePath();

        g.fillStyle(0x242d38, 0.92);
        g.fillRoundedRect(20, 17, 16, 6, 2);
        g.fillRoundedRect(40, 16, 12, 7, 2);
        g.fillRoundedRect(58, 17, 16, 6, 2);

        g.fillStyle(0x8b2a33, 0.42);
        g.fillRoundedRect(22, 18, 12, 2, 1);
        g.fillRoundedRect(60, 18, 12, 2, 1);

        g.fillStyle(0x0b1015, 0.95);
        g.fillEllipse(90, 19, 12, 9);
        g.fillEllipse(90, 31, 12, 9);
        g.fillStyle(0x313b46, 0.84);
        g.fillCircle(94, 19, 1.5);
        g.fillCircle(94, 31, 1.5);
        g.generateTexture(`${prefix}_detail`, 100, 40);
    };
    drawTankPart('sov', 0x3d5a2d, 0x1a2b10);
    drawPlayerMuscleCarPart('sov_player', 0x3d5a2d, 0x1a2b10);
    drawHunterPart('hunter', 0x5e6774, 0x2b313a);
    drawTankPart('tiger', 0x6a6a5a, 0x3a3a2a);
    drawTankPart('pz', 0x5a5a6a, 0x2a2a3a);
    drawTankPart('stug', 0x7b7358, 0x4b4328);
    drawTankPart('a7v', 0x4a4538, 0x2a2518, true); 
    drawTankPart('maus', 0x2f353b, 0x1a1c1f); 
    drawTankPart('luchs', 0x8b8d7a, 0x4b4d3a); 
    drawTumbleweedPart('tumble', 0xb68b5e, 0x6b4b2b);

    // Desert variants
    drawTankPart('sov_desert', 0xccb280, 0x8c7b50);
    drawPlayerMuscleCarPart('sov_player_desert', 0xccb280, 0x8c7b50);
    drawHunterPart('hunter_desert', 0x7e735f, 0x3f3a31);
    drawTankPart('tiger_desert', 0xe5c07b, 0x9e8555);
    drawTankPart('pz_desert', 0xb8a278, 0x786a4e);
    drawTankPart('stug_desert', 0xd4c492, 0x8f8462);
    drawTankPart('a7v_desert', 0xe3d1b1, 0x9c8f79, true);
    drawTankPart('maus_desert', 0xa39275, 0x635947);
    drawTankPart('luchs_desert', 0xe6dcb3, 0x9e977a); 
    drawTumbleweedPart('tumble_desert', 0xd7b37e, 0x8b6a3d);

    g.clear();
    g.fillStyle(0x0f0f0f);
    g.fillRoundedRect(0, 9, 34, 10, 3);
    g.fillStyle(0x262626);
    g.fillRoundedRect(2, 3, 16, 14, 3);
    g.fillStyle(0x555555);
    g.fillRect(14, 10, 22, 4);
    g.fillStyle(0x888888);
    g.fillRect(33, 10, 7, 4);
    g.fillStyle(0x1a1a1a);
    g.fillCircle(10, 17, 3);
    g.generateTexture('hmg_base', 44, 24);

    g.clear(); g.fillStyle(0x8b5a2b); g.fillRect(0, 0, 16, 16); g.fillStyle(0xa06a3b); g.fillRect(2, 2, 12, 12);
    g.generateTexture('brick_base', 16, 16);
    
    g.clear(); g.fillStyle(0x222222); g.fillRoundedRect(0, 0, 40, 40, 4); g.fillStyle(0x000000); g.fillCircle(20, 10, 8);
    g.generateTexture('mortar_base', 40, 40);

    g.clear(); g.fillStyle(0x333333); g.fillRoundedRect(0, 10, 100, 40, 15);
    g.fillStyle(0x111111); g.fillRect(10, 0, 80, 5); g.fillRect(48, 5, 4, 10);
    g.fillStyle(0x00ffff, 0.5); g.fillRect(70, 15, 20, 15);
    g.generateTexture('heli_body', 100, 50);

    g.clear();
    g.fillStyle(0x2c2c2c);
    g.fillRoundedRect(0, 12, 120, 38, 10);
    g.fillStyle(0x111111);
    g.fillRect(15, 0, 90, 10);
    g.fillStyle(0x3a3a3a);
    g.fillRoundedRect(65, 6, 30, 16, 6);
    g.generateTexture('armoredcar_body', 120, 60);

    // --- TREES ---
    // Generate multiple tree variants
    const treeTypes = ['veg_tree_0', 'veg_tree_1', 'veg_tree_2'];
    treeTypes.forEach((key, idx) => {
        g.clear();
        const centerX = 40; // Shift center to avoid clipping left side
        
        // Trunk
        g.fillStyle(0x4a2c10); 
        // Slight variation in trunk shape
        if (idx === 0) g.fillRect(centerX - 3, 70, 6, 50); 
        else if (idx === 1) { g.fillTriangle(centerX, 60, centerX - 5, 120, centerX + 5, 120); }
        else { g.beginPath(); g.moveTo(centerX, 60); g.lineTo(centerX - 4, 120); g.lineTo(centerX + 6, 120); g.fillPath(); }

        // Branches
        g.fillStyle(0x3e240e);
        g.beginPath(); 
        g.moveTo(centerX, 80); 
        g.lineTo(centerX - 10, 60); 
        g.lineTo(centerX, 65); 
        g.lineTo(centerX + 10, 60); 
        g.closePath(); 
        g.fillPath();
        
        // Foliage
        const leafColors = [0x2d5a27, 0x3a7a32, 0x1f441b];
        const drawLeafBlob = (x: number, y: number, r: number, c: number) => {
            // Clamp canopy blobs so no variant gets clipped by texture top.
            const cy = Math.max(y, r + 2);
            g.fillStyle(c, 0.95);
            g.fillCircle(x + centerX, cy, r);
            g.fillStyle(0x000000, 0.15);
            g.fillCircle(x + centerX, cy + r * 0.5, r * 0.6); // Shadow
        };
        
        // Vary foliage clusters based on index
        if (idx === 0) {
            drawLeafBlob(0, 40, 25, leafColors[0]);
            drawLeafBlob(-15, 55, 18, leafColors[1]);
            drawLeafBlob(15, 55, 18, leafColors[1]);
            drawLeafBlob(-5, 20, 20, leafColors[2]);
            drawLeafBlob(5, 20, 20, leafColors[2]);
        } else if (idx === 1) {
            // Taller, poplar-like
            drawLeafBlob(0, 30, 22, leafColors[0]);
            drawLeafBlob(0, 55, 24, leafColors[1]);
            drawLeafBlob(0, 80, 26, leafColors[2]);
            drawLeafBlob(-12, 60, 16, leafColors[1]);
            drawLeafBlob(12, 60, 16, leafColors[1]);
        } else {
            // Wider, oak-like
            drawLeafBlob(0, 40, 28, leafColors[0]);
            drawLeafBlob(-20, 50, 22, leafColors[1]);
            drawLeafBlob(20, 50, 22, leafColors[1]);
            drawLeafBlob(-10, 25, 20, leafColors[2]);
            drawLeafBlob(10, 25, 20, leafColors[2]);
            drawLeafBlob(0, 10, 18, leafColors[0]);
        }
        
        g.generateTexture(key, 80, 120); // Increased width to 80 to fit centerX=40 +/- 30ish
        if (idx === 0) g.generateTexture('veg_tree', 80, 120);
    });
    // Fallback for existing code using 'veg_tree'

    g.clear(); 
    // Pine Trunk
    g.fillStyle(0x3a2c10); 
    g.fillRect(15, 75, 4, 15); // Center at 17
    // Pine Layers
    const pineColors = [0x1b3017, 0x223b1d, 0x2a4524];
    for(let i=0; i<3; i++) {
        g.fillStyle(pineColors[i]);
        const w = 24 - i * 4;
        const y = 75 - i * 22;
        g.beginPath();
        g.moveTo(17, y - 25);
        g.lineTo(17 - w, y);
        g.lineTo(17 + w, y);
        g.closePath();
        g.fillPath();
    }
    g.generateTexture('veg_pine', 34, 90); // Adjusted width

    g.clear(); 
    // Detailed Grass
    g.fillStyle(0x2d5a27); 
    for(let i=0; i<5; i++) {
        const h = 8 + Math.random() * 8;
        const x = i * 3;
        g.beginPath();
        g.moveTo(x, 15);
        g.lineTo(x + 2, 15);
        g.lineTo(x + 1 + (Math.random()-0.5)*4, 15 - h);
        g.closePath();
        g.fillPath();
    }
    g.generateTexture('veg_grass', 15, 15);
    
    g.clear(); 
    // Flower Y
    g.fillStyle(0x2d5a27); 
    g.fillRect(2, 6, 2, 9); // Stem
    g.fillStyle(0xffdd00); 
    g.fillCircle(3, 4, 3.5); // Petals
    g.fillStyle(0xffaa00);
    g.fillCircle(3, 4, 1.5); // Center
    g.generateTexture('veg_flower_y', 8, 15);
    
    g.clear(); 
    // Flower P
    g.fillStyle(0x2d5a27); 
    g.fillRect(2, 6, 2, 9); 
    g.fillStyle(0xff55aa); 
    g.fillCircle(3, 4, 3.5);
    g.fillStyle(0xcc2277);
    g.fillCircle(3, 4, 1.5);
    g.generateTexture('veg_flower_p', 8, 15);

    g.clear();
    g.fillStyle(0x4a6a2f); // Darker Cactus Green
    g.fillRoundedRect(12, 30, 16, 90, 8); // Main stem
    // Left arm
    g.fillRoundedRect(2, 50, 14, 12, 4);
    g.fillRoundedRect(2, 35, 12, 20, 4);
    // Right arm
    g.fillRoundedRect(24, 60, 14, 12, 4);
    g.fillRoundedRect(26, 45, 12, 20, 4);
    // Spines
    g.fillStyle(0x000000, 0.2);
    for(let i=0; i<10; i++) g.fillRect(14 + (i%2)*8, 35 + i*8, 2, 2);
    g.generateTexture('veg_cactus', 40, 120);

    g.clear(); g.fillStyle(0x2a5a1a); g.fillRect(0, 0, 4, 4); g.generateTexture('leaf_part', 4, 4);
    g.clear(); g.lineStyle(2, 0xffffff); g.beginPath(); g.moveTo(0,0); g.lineTo(4,4); g.lineTo(8,0); g.strokePath(); g.generateTexture('bird_part', 8, 5);

    const generateFish = (key: string, colorBody: number, colorTail: number, scaleFactor: number = 1) => {
        g.clear();
        g.fillStyle(colorBody);
        // Body
        g.fillEllipse(12, 7, 18 * scaleFactor, 9 * scaleFactor);
        // Tail
        g.fillStyle(colorTail);
        g.beginPath();
        g.moveTo(2, 7);
        g.lineTo(-2 * scaleFactor, 2);
        g.lineTo(-2 * scaleFactor, 12);
        g.closePath();
        g.fillPath();
        // Fins
        g.beginPath();
        g.moveTo(12, 3);
        g.lineTo(16 * scaleFactor, -1);
        g.lineTo(8 * scaleFactor, -1);
        g.closePath();
        g.fillPath();
        // Eye
        g.fillStyle(0xffffff, 0.9);
        g.fillCircle(16, 5, 2 * scaleFactor);
        g.fillStyle(0x000000, 1);
        g.fillCircle(17, 5, 1 * scaleFactor);
        g.generateTexture(key, 24, 16);
    };

    generateFish('lake_fish', 0x2a90d6, 0x1b6aa3);
    generateFish('lake_fish_orange', 0xff8800, 0xcc6600);
    generateFish('lake_fish_green', 0x4caf50, 0x2e7d32, 1.1);
    generateFish('lake_fish_red', 0xe53935, 0xb71c1c, 0.9);

    g.clear();
    g.fillStyle(0x2f7f3a, 0.9);
    g.fillEllipse(11, 9, 18, 12);
    g.fillStyle(0x2a6f33, 0.85);
    g.fillTriangle(11, 9, 2, 4, 2, 14);
    g.fillStyle(0xffffff, 0.35);
    g.fillCircle(14, 6, 2);
    g.generateTexture('water_lily', 22, 16);

    g.clear();
    g.fillStyle(0x2d6b33, 0.95);
    for (let i = 0; i < 5; i++) {
      const bx = 3 + i * 2;
      g.fillRect(bx, 6 + Phaser.Math.Between(-1, 2), 2, 18);
    }
    g.fillStyle(0x224b26, 0.9);
    g.fillRect(2, 22, 12, 5);
    g.generateTexture('water_reed', 16, 28);

    g.clear();
    g.fillStyle(0x1e5a3a, 0.9);
    for (let i = 0; i < 4; i++) {
      const x = 10 + i * 5 + Phaser.Math.Between(-1, 1);
      const h = 40 + Phaser.Math.Between(-6, 8);
      g.fillRect(x, 60 - h, 3, h);
      g.fillTriangle(x, 60 - h, x - 3, 60 - h + 8, x + 6, 60 - h + 10);
    }
    g.fillStyle(0x143d28, 0.9);
    g.fillRect(6, 58, 26, 6);
    g.generateTexture('water_seaweed', 40, 64);

    g.clear();
    // Underground pattern: Rocky/Dirt noise
    const ugW = 128, ugH = 128;
    g.fillStyle(0x3e2723); // Base dirt
    g.fillRect(0, 0, ugW, ugH);
    // Stones/Specks
    for (let i = 0; i < 60; i++) {
        const x = Phaser.Math.Between(0, ugW);
        const y = Phaser.Math.Between(0, ugH);
        const s = Phaser.Math.Between(2, 6);
        g.fillStyle(Math.random() > 0.5 ? 0x4e342e : 0x5d4037, 0.6);
        g.fillCircle(x, y, s);
    }
    // Cracks
    g.lineStyle(1, 0x281a16, 0.4);
    for (let i = 0; i < 12; i++) {
        const x = Phaser.Math.Between(0, ugW);
        const y = Phaser.Math.Between(0, ugH);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Phaser.Math.Between(-15, 15), y + Phaser.Math.Between(-15, 15));
        g.strokePath();
    }
    g.generateTexture('terrain_fill_pattern', ugW, ugH);

    const drawProj = (key: string, w: number, h: number, fn: (g: Phaser.GameObjects.Graphics) => void) => {
      g.clear();
      fn(g);
      g.generateTexture(key, w, h);
    };
    const bright2 = (c: number) => {
      const col = Phaser.Display.Color.ValueToColor(c);
      return Phaser.Display.Color.GetColor(
        Math.min(255, col.red * 2),
        Math.min(255, col.green * 2),
        Math.min(255, col.blue * 2)
      );
    };

    drawProj('shell_model', 16, 8, gg => {
      gg.fillStyle(bright2(0x10151c), 1);
      gg.fillRect(3, 2, 8, 4);
      gg.fillStyle(bright2(0x2f3a46), 0.88);
      gg.fillRect(4, 3, 5, 1);
      gg.fillStyle(bright2(0xd1b178), 1);
      gg.fillRect(3, 2, 1, 4);
      gg.fillStyle(bright2(0x0a0e13), 1);
      gg.fillTriangle(13, 4, 11, 2, 11, 6);
      gg.fillStyle(bright2(0xced7e2), 0.75);
      gg.fillRect(11, 3, 2, 1);
      gg.fillStyle(bright2(0x0e141c), 1);
      gg.fillRect(1, 3, 2, 2);
    });

    drawProj('proj_bullet', 16, 8, gg => {
      gg.fillStyle(bright2(0x11161b), 1);
      gg.fillRect(3, 3, 9, 2);
      gg.fillStyle(bright2(0xd0a869), 1);
      gg.fillRect(2, 3, 2, 2);
      gg.fillStyle(bright2(0xf7e3b0), 1);
      gg.fillTriangle(13, 4, 12, 3, 12, 5);
      gg.fillStyle(bright2(0x39414a), 0.9);
      gg.fillRect(6, 3, 4, 1);
      gg.fillStyle(bright2(0x0a0d12), 1);
      gg.fillRect(1, 3, 1, 2);
    });

    drawProj('proj_standard', 16, 8, gg => {
      gg.fillStyle(bright2(0x121920), 1);
      gg.fillRect(3, 2, 9, 4);
      gg.fillStyle(bright2(0x37404b), 0.85);
      gg.fillRect(5, 3, 5, 1);
      gg.fillStyle(bright2(0xc29a63), 1);
      gg.fillRect(4, 2, 1, 4);
      gg.fillStyle(bright2(0x0b1016), 1);
      gg.fillTriangle(13, 4, 11, 2, 11, 6);
      gg.fillStyle(bright2(0xcfd8e3), 0.7);
      gg.fillRect(11, 3, 1, 1);
      gg.fillStyle(bright2(0x0a0d12), 1);
      gg.fillRect(1, 3, 2, 2);
    });

    drawProj('proj_he', 16, 8, gg => {
      gg.fillStyle(bright2(0x172117), 1);
      gg.fillRect(3, 1, 9, 6);
      gg.fillStyle(bright2(0x263625), 0.88);
      gg.fillRect(5, 2, 5, 1);
      gg.fillStyle(bright2(0xf2d043), 1);
      gg.fillRect(8, 2, 1, 4);
      gg.fillStyle(bright2(0xff7a30), 0.9);
      gg.fillRect(9, 3, 1, 2);
      gg.fillStyle(bright2(0x0b120d), 1);
      gg.fillTriangle(13, 4, 11, 2, 11, 6);
      gg.fillStyle(bright2(0x0a0d12), 1);
      gg.fillRect(1, 2, 2, 4);
    });

    drawProj('proj_ap', 16, 8, gg => {
      gg.fillStyle(bright2(0x0f151b), 1);
      gg.fillRect(4, 2, 8, 4);
      gg.fillStyle(bright2(0x29566b), 0.95);
      gg.fillRect(5, 3, 6, 1);
      gg.fillStyle(bright2(0x9de9ff), 1);
      gg.fillRect(4, 3, 1, 2);
      gg.fillStyle(bright2(0x071117), 1);
      gg.fillTriangle(14, 4, 12, 2, 12, 6);
      gg.fillStyle(bright2(0x4f6576), 0.75);
      gg.fillRect(11, 2, 1, 4);
      gg.fillStyle(bright2(0x0a0d12), 1);
      gg.fillRect(1, 3, 3, 2);
    });

    drawProj('proj_incendiary', 16, 8, gg => {
      gg.fillStyle(bright2(0x20100a), 1);
      gg.fillRect(3, 2, 9, 4);
      gg.fillStyle(bright2(0x4c1f10), 0.9);
      gg.fillRect(5, 3, 5, 1);
      gg.fillStyle(bright2(0xff6a18), 1);
      gg.fillRect(8, 2, 1, 4);
      gg.fillStyle(bright2(0xffd157), 0.9);
      gg.fillRect(9, 3, 1, 2);
      gg.fillStyle(bright2(0x0f0906), 1);
      gg.fillTriangle(13, 4, 11, 2, 11, 6);
      gg.fillStyle(bright2(0x111111), 1);
      gg.fillRect(1, 3, 2, 2);
    });

    drawProj('proj_mortar', 16, 8, gg => {
      gg.fillStyle(bright2(0x10151a), 1);
      gg.fillEllipse(8, 4, 11, 6);
      gg.fillStyle(bright2(0x27303a), 0.9);
      gg.fillEllipse(7, 4, 8, 4);
      gg.fillStyle(bright2(0xced7e2), 0.65);
      gg.fillRect(8, 3, 2, 1);
      gg.fillStyle(bright2(0x0b0f14), 1);
      gg.fillRect(12, 2, 2, 4);
      gg.fillStyle(bright2(0x0a0d12), 1);
      gg.fillRect(2, 3, 2, 2);
    });

    drawProj('proj_nuke', 48, 24, gg => {
      gg.fillStyle(bright2(0x0f1115), 1);
      gg.fillEllipse(23, 12, 44, 18);
      gg.fillStyle(bright2(0x262f3a), 1);
      gg.fillEllipse(22, 12, 39, 14);
      gg.fillStyle(bright2(0x141b24), 1);
      gg.fillCircle(38, 12, 8);
      gg.fillStyle(bright2(0x3d4a57), 0.84);
      gg.fillCircle(36, 11, 5);

      gg.fillStyle(bright2(0x0a0d12), 1);
      gg.fillTriangle(5, 12, 15, 4, 15, 20);
      gg.fillRect(14, 8, 8, 8);
      gg.fillStyle(bright2(0x1c242d), 0.95);
      gg.fillTriangle(14, 6, 14, 10, 7, 8);
      gg.fillTriangle(14, 14, 14, 18, 7, 16);
      gg.fillTriangle(14, 12, 9, 10, 9, 14);

      gg.fillStyle(bright2(0xf0d05d), 1);
      gg.fillRect(23, 4, 3, 16);
      gg.fillStyle(bright2(0x0a0a0a), 0.62);
      gg.fillRect(28, 5, 2, 14);
      gg.fillStyle(bright2(0xf9fcff), 0.18);
      gg.fillRect(31, 7, 8, 2);
      gg.fillStyle(bright2(0xa2b3c4), 0.6);
      gg.fillRect(32, 13, 6, 1);
    });

    drawProj('proj_missile', 16, 8, gg => {
      gg.fillStyle(bright2(0x151a22), 1);
      gg.fillRect(3, 2, 9, 4);
      gg.fillStyle(bright2(0x2e3743), 0.9);
      gg.fillRect(5, 3, 5, 1);
      gg.fillStyle(bright2(0x0a0f15), 1);
      gg.fillTriangle(13, 4, 12, 2, 12, 6);
      gg.fillStyle(bright2(0xff4b1f), 1);
      gg.fillRect(2, 3, 1, 2);
      gg.fillStyle(bright2(0xffb057), 0.82);
      gg.fillRect(1, 3, 1, 2);
      gg.fillStyle(bright2(0x3b444f), 1);
      gg.fillRect(6, 1, 1, 1);
      gg.fillRect(6, 6, 1, 1);
    });

    drawProj('proj_rpg', 16, 8, gg => {
      gg.fillStyle(bright2(0x171b1e), 1);
      gg.fillRect(3, 2, 8, 4);
      gg.fillStyle(bright2(0x667150), 1);
      gg.fillRect(4, 3, 5, 2);
      gg.fillStyle(bright2(0xc9a35a), 1);
      gg.fillRect(9, 2, 1, 4);
      gg.fillStyle(bright2(0x0a0f14), 1);
      gg.fillTriangle(12, 4, 11, 2, 11, 6);
      gg.fillStyle(bright2(0x0b0f13), 1);
      gg.fillRect(1, 3, 2, 2);
      gg.fillStyle(bright2(0xcdd7e0), 0.65);
      gg.fillRect(10, 3, 1, 1);
    });

    drawProj('proj_torpedo', 16, 8, gg => {
      gg.fillStyle(bright2(0x0c1c2f), 1);
      gg.fillRect(3, 2, 9, 4);
      gg.fillStyle(bright2(0x1d2e42), 0.95);
      gg.fillRect(5, 3, 5, 1);
      gg.fillStyle(bright2(0x44d2ff), 1);
      gg.fillRect(7, 2, 1, 4);
      gg.fillStyle(bright2(0x08131f), 1);
      gg.fillTriangle(13, 4, 12, 2, 12, 6);
      gg.fillStyle(bright2(0x102233), 1);
      gg.fillRect(2, 3, 1, 2);
      gg.fillRect(11, 3, 1, 2);
    });

    drawProj('proj_canister', 16, 8, gg => {
      gg.fillStyle(bright2(0x241a11), 1);
      gg.fillRect(4, 2, 8, 4);
      gg.fillStyle(bright2(0xffcf78), 0.95);
      gg.fillRect(5, 3, 6, 2);
      gg.fillStyle(bright2(0x8a6538), 0.8);
      gg.fillRect(6, 2, 1, 4);
      gg.fillStyle(bright2(0x0b1015), 1);
      gg.fillRect(12, 2, 2, 4);
      gg.fillStyle(bright2(0x111111), 1);
      gg.fillRect(2, 3, 2, 2);
    });

    drawProj('proj_cluster', 16, 8, gg => {
      gg.fillStyle(bright2(0x22120a), 1);
      gg.fillRect(4, 2, 8, 4);
      gg.fillStyle(bright2(0x3f1d0d), 0.92);
      gg.fillRect(6, 3, 4, 1);
      gg.fillStyle(bright2(0xffb048), 1);
      gg.fillRect(8, 2, 1, 4);
      gg.fillStyle(bright2(0x0d0f12), 1);
      gg.fillTriangle(13, 4, 11, 2, 11, 6);
      gg.fillStyle(bright2(0x111111), 1);
      gg.fillRect(2, 3, 2, 2);
      gg.fillStyle(bright2(0xffde9d), 0.62);
      gg.fillRect(10, 3, 1, 1);
    });

    const makeHead = (key: string, faction: 'ally' | 'enemy' | 'neutral', emotion: "neutral" | "angry" | "scared" | "dead") => {
      g.clear();
      // Skin
      g.fillStyle(0xffdbac);
      g.fillCircle(4, 5, 3.5); // Face

      // Helmet
      if (faction === 'ally') {
          // US M1 Style: Round, olive drab
          g.fillStyle(0x4b5320); // Army Green
          g.beginPath();
          g.arc(4, 3.5, 4.2, Math.PI, 0, false);
          g.lineTo(8.2, 3.5);
          g.lineTo(9, 4.5); // Brim
          g.lineTo(-1, 4.5);
          g.lineTo(-0.2, 3.5);
          g.closePath();
          g.fillPath();
          // Netting detail
          g.lineStyle(1, 0x3a4019, 0.5);
          g.strokeCircle(4, 2, 3);
      } else if (faction === 'enemy') {
          // German Stahlhelm Style: Angular, grey
          g.fillStyle(0x4c4f56); // Field Grey
          g.beginPath();
          g.moveTo(0, 4);
          g.lineTo(0.5, 2);
          g.lineTo(2, 0); g.lineTo(6, 0); g.lineTo(7.5, 2); // Top curve approx
          g.lineTo(8, 4);
          g.lineTo(9, 5); // Flared skirt
          g.lineTo(-1, 5);
          g.closePath();
          g.fillPath();
          // Side lug
          g.fillStyle(0x2a2a2a);
          g.fillCircle(1.5, 3, 0.5);
      } else {
          // Neutral/Engineer cap
          g.fillStyle(0x556677);
          g.fillRect(0, 1, 8, 3);
          g.fillRect(0, 4, 9, 1); // Bill
      }

      // Eyes
      g.fillStyle(0x1a1a1a);
      if (emotion === "dead") {
        g.lineStyle(1, 0x1a1a1a);
        g.beginPath(); g.moveTo(2, 5); g.lineTo(3.5, 6.5); g.moveTo(3.5, 5); g.lineTo(2, 6.5); g.strokePath(); // X
        g.beginPath(); g.moveTo(5.5, 5); g.lineTo(7, 6.5); g.moveTo(7, 5); g.lineTo(5.5, 6.5); g.strokePath(); // X
      } else {
        let eyeY = 5.5;
        let eyeH = 1.2;
        if (emotion === "angry") {
            g.beginPath(); g.moveTo(2, 4.5); g.lineTo(3.5, 5.5); g.strokePath(); // Brow
            g.beginPath(); g.moveTo(7, 4.5); g.lineTo(5.5, 5.5); g.strokePath();
        } else if (emotion === "scared") {
            eyeH = 2.0;
            eyeY = 5.0;
        }
        g.fillCircle(2.8, eyeY, 0.7);
        g.fillCircle(6.2, eyeY, 0.7);
      }
      
      g.generateTexture(key, 10, 10); // Slightly larger canvas 8x8 -> 10x10
    };

    const emotions = ["neutral", "angry", "scared", "dead"] as const;
    emotions.forEach(e => makeHead(`inf_head_ally_${e}`, 'ally', e));
    emotions.forEach(e => makeHead(`inf_head_enemy_${e}`, 'enemy', e));
    emotions.forEach(e => makeHead(`inf_head_${e}`, 'neutral', e)); // Fallback

    const makeTorso = (key: string, faction: 'ally' | 'enemy' | 'eng') => {
      g.clear();
      const w = 14, h = 16;
      
      let baseColor = 0x000000;
      let strapColor = 0x000000;
      let beltColor = 0x000000;

      if (faction === 'ally') {
          baseColor = 0x556b2f; // Olive Drab
          strapColor = 0x4b5320; // Darker Green
          beltColor = 0x3e3e2e; // Canvas belt
      } else if (faction === 'enemy') {
          baseColor = 0x4c4f56; // Field Grey
          strapColor = 0x2a2a2a; // Leather Y-straps
          beltColor = 0x111111; // Black leather belt
      } else {
          baseColor = 0x5c6bc0; // Engineer Blue
          strapColor = 0x3949ab;
          beltColor = 0x283593;
      }

      // Body shape (Tapered)
      g.fillStyle(baseColor);
      g.beginPath();
      // Improved posture: Higher neck, broader shoulders, less hunch
      g.moveTo(4, 0);   // Neck L (narrower neck start)
      g.lineTo(10, 0);  // Neck R
      g.lineTo(14, 2);  // Shoulder R (higher)
      g.lineTo(13, 14); // Hip R
      g.lineTo(1, 14);  // Hip L
      g.lineTo(0, 2);   // Shoulder L (higher)
      g.closePath();
      g.fillPath();

      // Neck detail
      g.fillStyle(0xffdbac); // Skin
      g.fillRect(4, 0, 6, 2); // Visible neck area

      // Shading
      g.fillStyle(0x000000, 0.15);
      g.fillRect(0, 13, 14, 3); // Bottom shade

      // Webbing / Straps
      g.lineStyle(1.5, strapColor, 0.9);
      if (faction === 'enemy') {
          // Y-strap
          g.beginPath();
          g.moveTo(3, 0); g.lineTo(7, 8); // L to Center
          g.moveTo(11, 0); g.lineTo(7, 8); // R to Center
          g.moveTo(7, 8); g.lineTo(7, 14); // Center down
          g.strokePath();
      } else {
          // H-harness / Suspenders
          g.beginPath();
          g.moveTo(3, 0); g.lineTo(3, 14);
          g.moveTo(11, 0); g.lineTo(11, 14);
          g.moveTo(3, 6); g.lineTo(11, 6); // Cross
          g.strokePath();
      }

      // Belt
      g.fillStyle(beltColor);
      g.fillRect(1, 11, 12, 2.5);
      // Buckle
      if (faction === 'enemy') {
          g.fillStyle(0xcccccc); // Silver buckle
          g.fillRect(6, 11, 2, 2.5);
      } else {
          g.fillStyle(0x333333); // Dark buckle
          g.fillRect(6, 11, 2, 2.5);
      }
      
      // Pouches
      g.fillStyle(strapColor);
      g.fillRect(1, 12, 3, 3);
      g.fillRect(10, 12, 3, 3);

      g.generateTexture(key, 14, 16);
    };
    makeTorso('inf_torso_enemy', 'enemy');
    makeTorso('inf_torso_ally', 'ally');
    makeTorso('inf_torso_eng', 'eng');

    // Limbs
    const makeLimb = (key: string, type: 'arm' | 'leg', faction: 'ally' | 'enemy' | 'eng') => {
        g.clear();
        let color = 0x000000;
        if (faction === 'ally') color = 0x556b2f;
        else if (faction === 'enemy') color = 0x4c4f56;
        else color = 0x5c6bc0;

        if (type === 'arm') {
            // Sleeve
            g.fillStyle(color);
            g.fillRoundedRect(0, 0, 4, 9, 2);
            // Hand
            g.fillStyle(0xffdbac);
            g.fillCircle(2, 9, 1.8);
            g.generateTexture(key, 4, 11);
        } else {
            // Pant leg
            g.fillStyle(color);
            g.fillRoundedRect(0, 0, 5, 10, 1);
            // Boot
            g.fillStyle(0x111111);
            g.fillRect(0, 8, 5, 4);
            g.fillRect(2, 11, 4, 1); // Boot toe
            g.generateTexture(key, 6, 12);
        }
    };
    
    makeLimb('inf_limb_arm_ally', 'arm', 'ally');
    makeLimb('inf_limb_arm_enemy', 'arm', 'enemy');
    makeLimb('inf_limb_arm_eng', 'arm', 'eng');
    
    makeLimb('inf_limb_leg_ally', 'leg', 'ally');
    makeLimb('inf_limb_leg_enemy', 'leg', 'enemy');
    makeLimb('inf_limb_leg_eng', 'leg', 'eng');

    // Generic fallbacks for compatibility if needed
    makeLimb('inf_limb_arm', 'arm', 'ally'); 
    makeLimb('inf_limb_leg', 'leg', 'ally');

    g.clear(); g.fillStyle(0x4e342e); g.fillRect(0, 0, 20, 20); g.lineStyle(1, 0x3e2723); g.strokeRect(0,0,20,20); g.generateTexture('brick_wood', 20, 20);
    g.clear(); 
    g.fillStyle(0x546e7a); 
    g.fillRect(0, 0, 20, 20); 
    // Noise
    for(let i=0; i<8; i++) {
        g.fillStyle(Math.random() > 0.5 ? 0x607d8b : 0x455a64, 0.3);
        g.fillRect(Math.random()*20, Math.random()*20, 2, 2);
    }
    g.lineStyle(1, 0x37474f); 
    g.strokeRect(0,0,20,20); 
    g.generateTexture('brick_concrete', 20, 20);
    g.clear(); g.fillStyle(0x78909c); g.fillRect(0, 0, 20, 20); g.lineStyle(1, 0x455a64); g.strokeRect(4,4,12,12); g.generateTexture('brick_metal', 20, 20);
    g.clear(); g.fillStyle(0xd4a373); g.fillRect(0, 0, 20, 20); g.lineStyle(1, 0xa98467); g.strokeRect(0,0,20,20); g.generateTexture('brick_me', 20, 20);
    g.clear();
    g.fillStyle(0x5d4037); g.fillRect(0, 0, 20, 20);
    for (let i = 0; i < 8; i++) {
      g.fillStyle(Math.random() > 0.5 ? 0x6d4c41 : 0x4e342e, 0.38);
      g.fillRect(Math.random() * 20, Math.random() * 20, 2, 2);
    }
    g.lineStyle(1, 0x3e2723); g.strokeRect(0, 0, 20, 20);
    g.generateTexture('brick_mud', 20, 20);
    g.clear(); g.fillStyle(0xef233c); g.fillRect(0, 0, 20, 20); g.lineStyle(1, 0x8d0801); g.strokeRect(0,0,20,20); g.generateTexture('brick_red_wood', 20, 20);
    g.clear(); g.fillStyle(0x444444); g.fillRect(0, 0, 20, 20); g.lineStyle(2, 0x111111); g.strokeRect(0,0,20,20); g.generateTexture('brick_base', 20, 20);

    g.clear(); g.fillStyle(0xff0000); g.fillRect(0, 0, 80, 50); g.generateTexture('flag_red', 80, 50);

    if (this.textures.exists('smoke_puff')) this.textures.remove('smoke_puff');
    {
      const smokeSize = 32;
      const smokeTex = this.textures.createCanvas('smoke_puff', smokeSize, smokeSize);
      const smokeCtx = smokeTex.getContext();
      smokeCtx.clearRect(0, 0, smokeSize, smokeSize);

      const smokeRand = (() => {
        let t = 0x9e3779b9;
        return () => {
          t += 0x6d2b79f5;
          let x = t;
          x = Math.imul(x ^ (x >>> 15), x | 1);
          x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
          return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
        };
      })();

      const cx = smokeSize * 0.5;
      const cy = smokeSize * 0.5;
      for (let i = 0; i < 16; i++) {
        const alpha = 0.06 + smokeRand() * 0.12;
        const rx = 4 + smokeRand() * 8;
        const ry = 3 + smokeRand() * 7;
        const ox = (smokeRand() - 0.5) * 12;
        const oy = (smokeRand() - 0.5) * 10;
        smokeCtx.fillStyle = `rgba(255,255,255,${alpha.toFixed(4)})`;
        smokeCtx.beginPath();
        smokeCtx.ellipse(cx + ox, cy + oy, rx, ry, smokeRand() * Math.PI, 0, Math.PI * 2);
        smokeCtx.fill();
      }

      smokeCtx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 9; i++) {
        const eraseRadius = 2 + smokeRand() * 4;
        const eraseX = cx + (smokeRand() - 0.5) * 20;
        const eraseY = cy + (smokeRand() - 0.5) * 18;
        const eraseAlpha = 0.05 + smokeRand() * 0.16;
        smokeCtx.fillStyle = `rgba(0,0,0,${eraseAlpha.toFixed(4)})`;
        smokeCtx.beginPath();
        smokeCtx.arc(eraseX, eraseY, eraseRadius, 0, Math.PI * 2);
        smokeCtx.fill();
      }
      smokeCtx.globalCompositeOperation = 'source-over';
      smokeTex.refresh();
    }
    g.clear(); g.fillStyle(0x990000); g.fillCircle(3, 3, 3); g.generateTexture('meat_chunk', 6, 6);
    g.clear(); g.fillStyle(0x111111); g.fillRect(0, 0, 16, 3); g.generateTexture('inf_weapon', 16, 3);
    g.clear();
    g.fillStyle(0xcccccc);
    g.fillRect(2, 8, 14, 3);
    g.fillStyle(0x999999);
    g.fillRect(10, 2, 5, 12);
    g.fillStyle(0x666666);
    g.fillRect(0, 10, 4, 2);
    g.fillRect(14, 10, 4, 2);
    g.generateTexture('inf_wrench', 18, 16);
    g.clear(); g.fillStyle(0x222222); g.fillRect(0, 0, 4, 10); g.generateTexture('inf_limb_leg', 4, 10);
    g.clear(); g.fillStyle(0x222222); g.fillRect(0, 0, 3, 8); g.generateTexture('inf_limb_arm', 3, 8);
    g.clear(); g.fillStyle(0xffaa00); g.fillCircle(2, 2, 2); g.generateTexture('spark', 4, 4);
    g.clear(); g.fillStyle(0xffffff, 0.95); g.fillCircle(16, 16, 6); g.fillStyle(0xfff2cc, 0.55); g.fillCircle(16, 16, 11); g.fillStyle(0xffcc66, 0.25); g.fillCircle(16, 16, 15); g.generateTexture('spark_hd', 32, 32);
    if (!this.textures.exists('fx_soft_glow')) {
      g.clear();
      const glowSize = 96;
      const glowR = glowSize * 0.5;
      for (let i = 0; i < 26; i++) {
        const t = 1 - i / 25;
        const a = Math.pow(t, 2.0) * 0.15;
        g.fillStyle(0xffffff, a);
        g.fillCircle(glowR, glowR, glowR * t);
      }
      g.generateTexture('fx_soft_glow', glowSize, glowSize);
    }
    if (!this.textures.exists('fx_soft_ring')) {
      const ringSize = 128;
      const ringTexture = this.textures.createCanvas('fx_soft_ring', ringSize, ringSize);
      const ctx = ringTexture.getContext();
      const rr = ringSize * 0.5;
      ctx.clearRect(0, 0, ringSize, ringSize);
      for (let i = 0; i < 42; i++) {
        const t = i / 41;
        const radius = rr * (0.24 + t * 0.56);
        const width = 2.4 + (1 - t) * 7.8;
        const alpha = Math.pow(1 - t, 2.3) * 0.15;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(4)})`;
        ctx.lineWidth = width;
        ctx.arc(rr, rr, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ringTexture.refresh();
    }
    if (!this.textures.exists('fx_vignette_soft')) {
      const vgSize = 512;
      const vgTex = this.textures.createCanvas('fx_vignette_soft', vgSize, vgSize);
      const vgCtx = vgTex.getContext();
      const cx = vgSize * 0.5;
      const cy = vgSize * 0.5;
      const rInner = vgSize * 0.24;
      const rOuter = vgSize * 0.94;
      vgCtx.clearRect(0, 0, vgSize, vgSize);
      const grad = vgCtx.createRadialGradient(cx, cy, rInner, cx, cy, rOuter);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.54, 'rgba(0,0,0,0.08)');
      grad.addColorStop(0.78, 'rgba(0,0,0,0.22)');
      grad.addColorStop(1, 'rgba(0,0,0,0.30)');
      vgCtx.fillStyle = grad;
      vgCtx.fillRect(0, 0, vgSize, vgSize);
      vgTex.refresh();
    }
    g.clear(); g.fillStyle(0x00ff00); g.fillCircle(4, 4, 4); g.generateTexture('repair_spark', 8, 8);
    
    const makeRand = (seed: number) => {
      let t = seed >>> 0;
      return () => {
        t += 0x6d2b79f5;
        let x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      };
    };
    const softenTextureEdges = (key: string, blurPx: number) => {
      const texture: any = this.textures.get(key);
      const sourceImage: any = texture?.getSourceImage?.() ?? texture?.source?.[0]?.image;
      if (!sourceImage || !(sourceImage instanceof HTMLCanvasElement)) return;

      const canvas = sourceImage as HTMLCanvasElement;
      const w = canvas.width;
      const h = canvas.height;

      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d');
      const ctx = canvas.getContext('2d');
      if (!octx || !ctx) return;

      octx.filter = `blur(${blurPx}px)`;
      octx.drawImage(canvas, 0, 0);

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(off, 0, 0);

      ctx.globalCompositeOperation = 'destination-in';
      const gx = ctx.createLinearGradient(0, 0, w, 0);
      gx.addColorStop(0, 'rgba(255,255,255,0)');
      gx.addColorStop(0.18, 'rgba(255,255,255,1)');
      gx.addColorStop(0.82, 'rgba(255,255,255,1)');
      gx.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gx;
      ctx.fillRect(0, 0, w, h);

      const gy = ctx.createLinearGradient(0, 0, 0, h);
      gy.addColorStop(0, 'rgba(255,255,255,0)');
      gy.addColorStop(0.22, 'rgba(255,255,255,1)');
      gy.addColorStop(0.78, 'rgba(255,255,255,1)');
      gy.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gy;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';

      texture?.refresh?.();
    };
    softenTextureEdges('fx_soft_glow', 0.9);
    softenTextureEdges('fx_soft_ring', 0.7);
    softenTextureEdges('fx_vignette_soft', 0.45);
    for (let i = 0; i < 10; i++) {
      const r = makeRand(1337 + i * 97);
      const w = 90 + Math.floor(r() * 60);
      const h = 36 + Math.floor(r() * 28);
      g.clear();
      g.fillStyle(0xffffff, 0.62);
      g.fillEllipse(w * 0.5, h * 0.55, w * 0.78, h * 0.62);

      const blobs = 10 + Math.floor(r() * 8);
      for (let b = 0; b < blobs; b++) {
        const cx = Math.floor(r() * w);
        const cy = Math.floor(r() * (h * 0.55)) + Math.floor(h * 0.25);
        const ew = 30 + Math.floor(r() * 60);
        const eh = 14 + Math.floor(r() * 28);
        g.fillEllipse(cx, cy, ew, eh);
      }
      g.generateTexture(`cloud_${i}`, w, h);
      softenTextureEdges(`cloud_${i}`, 2);
    }

    g.clear();
    g.lineStyle(2, 0xffffff, 1);
    g.beginPath();
    g.moveTo(20, 0); g.lineTo(20, 12);
    g.moveTo(20, 28); g.lineTo(20, 40);
    g.moveTo(0, 20); g.lineTo(12, 20);
    g.moveTo(28, 20); g.lineTo(40, 20);
    g.strokePath();
    g.lineStyle(1, 0xffffff, 0.8);
    g.strokeCircle(20, 20, 9);
    g.generateTexture('crosshair', 40, 40);
  }

  private createAtmosphere() {
    this.backgroundClouds = [];
    const atmosphereOffsetY = -140;
    const skyGrad = this.add.graphics().setScrollFactor(0).setDepth(1);
    if (this.mapId === 'desert') {
        skyGrad.fillGradientStyle(0x4a90e2, 0x4a90e2, 0xffd591, 0xffb74d, 1);
    } else {
        skyGrad.fillGradientStyle(0x2980b9, 0x2980b9, 0xf1c40f, 0xe67e22, 1);
    }
    skyGrad.fillRect(-2000, -2000, 10000, 10000);
    if (!this.testRoomEnabled) {
    for (let i = 0; i < 16; i++) {
        const cx = Math.random() * 2000;
        const cy = 20 + Math.random() * 350 + atmosphereOffsetY;
        const scroll = 0.02 + Math.random() * 0.05;
        const base = 0.65 + Math.random() * 0.95;
        const scaleX = base * (0.85 + Math.random() * 0.35);
        const scaleY = base * (0.7 + Math.random() * 0.55);
        const flipX = Math.random() > 0.5;

        const cloud = this.add.container(cx, cy).setScrollFactor(scroll).setDepth(3).setAlpha(0.55);
        cloud.setScale(flipX ? -scaleX : scaleX, scaleY);

        const g = this.add.graphics();
        const seed = (i * 7919) ^ 0x9e3779b9;
        const r = (() => {
          let s = seed >>> 0;
          return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
        })();
        const paintLayer = (tint: number, alpha: number, count: number, spreadX: number, spreadY: number) => {
          g.fillStyle(tint, alpha);
          for (let k = 0; k < count; k++) {
            const px = (r() - 0.5) * spreadX;
            const py = (r() - 0.5) * spreadY;
            const rr = 26 + r() * 70;
            g.fillCircle(px, py, rr);
          }
        };
        
        if (this.mapId === 'desert') {
            paintLayer(0xfff8e1, 0.12, 22, 260, 120);
            paintLayer(0xffecb3, 0.10, 16, 220, 100);
            paintLayer(0xffe0b2, 0.09, 12, 180, 85);
        } else {
            paintLayer(0xf7f3ea, 0.12, 22, 260, 120);
            paintLayer(0xffffff, 0.10, 16, 220, 100);
            paintLayer(0xe9e2d2, 0.09, 12, 180, 85);
        }
        cloud.add(g);

        this.backgroundClouds.push(cloud);
        const driftTween = this.tweens.add({ targets: cloud, x: cx + 120 + Math.random() * 120, duration: 42000 + Math.random() * 26000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        cloud.setData('driftTween', driftTween);
        this.tweens.add({ targets: cloud, y: cy + (Math.random() * 26 - 13), duration: 12000 + Math.random() * 14000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.tweens.add({ targets: cloud, scaleX: cloud.scaleX * (0.90 + Math.random() * 0.20), scaleY: cloud.scaleY * (0.86 + Math.random() * 0.24), duration: 9000 + Math.random() * 12000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    }
    
    const sunY = 320 + atmosphereOffsetY;
    const sunX = 1000;
    const desert = this.mapId === 'desert';
    if (!desert) {
      const sunRay = this.add.graphics().setScrollFactor(0.002).setDepth(1.55);
      const rayCount = 18;
      const rayInner = 132;
      const rayOuter = 304;
      const rayColor = 0xff9f68;
      sunRay.fillStyle(rayColor, 0.1);
      for (let i = 0; i < rayCount; i++) {
        const a = (i / rayCount) * Math.PI * 2 + ((i % 2 === 0) ? 0.018 : -0.032);
        const spread = Math.PI / 22;
        const x0 = sunX + Math.cos(a - spread) * rayInner;
        const y0 = sunY + Math.sin(a - spread) * rayInner;
        const x1 = sunX + Math.cos(a + spread) * rayInner;
        const y1 = sunY + Math.sin(a + spread) * rayInner;
        const x2 = sunX + Math.cos(a) * rayOuter;
        const y2 = sunY + Math.sin(a) * rayOuter;
        sunRay.beginPath();
        sunRay.moveTo(x0, y0);
        sunRay.lineTo(x2, y2);
        sunRay.lineTo(x1, y1);
        sunRay.closePath();
        sunRay.fillPath();
      }
    }
    const sunGlow = this.add.graphics().setScrollFactor(0.002).setDepth(1.78);
    if (desert) {
      sunGlow.fillStyle(0xffd27e, 0.36);
      sunGlow.fillCircle(sunX, sunY, 286);
      sunGlow.fillStyle(0xffb74f, 0.22);
      sunGlow.fillCircle(sunX, sunY, 236);
      sunGlow.fillStyle(0xfff1bd, 0.12);
      sunGlow.fillEllipse(sunX - 18, sunY - 20, 220, 150);
    } else {
      sunGlow.fillStyle(0xffa86c, 0.34);
      sunGlow.fillCircle(sunX, sunY, 232);
      sunGlow.fillStyle(0xff8f58, 0.2);
      sunGlow.fillCircle(sunX, sunY, 318);
      sunGlow.fillStyle(0xfff2ca, 0.12);
      sunGlow.fillEllipse(sunX - 14, sunY - 16, 176, 132);
    }
    const sunCore = this.add.graphics().setScrollFactor(0.002).setDepth(2);
    if (desert) {
      sunCore.fillStyle(0xfff4be, 0.98);
      sunCore.fillCircle(sunX, sunY, 182);
      sunCore.fillStyle(0xffd873, 0.72);
      sunCore.fillCircle(sunX, sunY, 142);
      sunCore.fillStyle(0xfff9de, 0.32);
      sunCore.fillCircle(sunX - 22, sunY - 26, 72);
    } else {
      sunCore.fillStyle(0xffd2a1, 0.98);
      sunCore.fillCircle(sunX, sunY, 138);
      sunCore.fillStyle(0xff9e63, 0.78);
      sunCore.fillCircle(sunX, sunY, 108);
      sunCore.fillStyle(0xfff7e0, 0.3);
      sunCore.fillCircle(sunX - 18, sunY - 20, 56);
    }

    if (!desert) {
      const fogColor = 0xcce0ff;
      const makeRand = (seed: number) => {
        let t = seed >>> 0;
        return () => {
          t += 0x6d2b79f5;
          let x = t;
          x = Math.imul(x ^ (x >>> 15), x | 1);
          x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
          return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
        };
      };
      const paintFogLayer = (depth: number, scroll: number, alpha: number, y: number, h: number, seed: number) => {
        const fog = this.add.graphics().setScrollFactor(scroll).setDepth(depth).setAlpha(alpha);
        const span = Math.max(this.WORLD_WIDTH * 2.8, 36000);
        const left = -span * 0.65;
        const width = span * 1.3;
        fog.fillGradientStyle(0xffffff, 0xffffff, fogColor, fogColor, 0, 0, 0.72, 0.72);
        fog.fillRect(left, y, width, h);
        const rnd = makeRand(seed);
        for (let i = 0; i < 34; i++) {
          const ex = left + ((i + 0.5) / 34) * width + (rnd() - 0.5) * 420;
          const ey = y + h * (0.22 + rnd() * 0.7);
          const ew = 380 + rnd() * 920;
          const eh = 110 + rnd() * 260;
          fog.fillStyle(rnd() > 0.55 ? 0xffffff : fogColor, 0.06 + rnd() * 0.07);
          fog.fillEllipse(ex, ey, ew, eh);
        }
      };
      paintFogLayer(4, 0.08, 0.13, 140, 1500, 19681);
      paintFogLayer(18, 0.22, 0.09, 330, 1250, 28411);
    }
  }

  private generateTerrain() {
    if (this.testRoomEnabled) {
      if (this.mapId === 'desert') this.generateTestRoomDesertTerrain();
      else this.generateTestRoomForestTerrain();
      return;
    }
    if (this.mapId === 'desert') {
      this.generateDesertTerrain();
    } else {
      this.generateForestTerrain();
    }
  }

  private generateTestRoomForestTerrain() {
    this.terrainHeights = [];
    this.terrainDamage = [];
    this.baseHeights = [];
    this.terrainBurn = [];
    const centerH = 430;
    const minH = 340;
    const maxH = 520;
    for (let x = 0; x <= this.WORLD_WIDTH; x += this.TERRAIN_STEP) {
      const n1 = Math.sin(x * 0.0032) * 22;
      const n2 = Math.sin(x * 0.011) * 8;
      const val = Phaser.Math.Clamp(centerH + n1 + n2, minH, maxH);
      this.terrainHeights.push(val);
      this.baseHeights.push(val);
      this.terrainDamage.push(0);
      this.terrainBurn.push(0);
    }
    this.drawTerrain();
  }

  private generateTestRoomDesertTerrain() {
    this.terrainHeights = [];
    this.terrainDamage = [];
    this.baseHeights = [];
    this.terrainBurn = [];
    const centerH = 430;
    const minH = 360;
    const maxH = 540;
    for (let x = 0; x <= this.WORLD_WIDTH; x += this.TERRAIN_STEP) {
      const n1 = Math.sin(x * 0.0022) * 34;
      const n2 = Math.sin(x * 0.0068) * 16;
      const val = Phaser.Math.Clamp(centerH + n1 + n2, minH, maxH);
      this.terrainHeights.push(val);
      this.baseHeights.push(val);
      this.terrainDamage.push(0);
      this.terrainBurn.push(0);
    }
    this.drawTerrain();
  }

  private spawnTestRoomDecor() {
    const w = this.WORLD_WIDTH;
    for (let x = 160; x < w - 160; x += 60) {
      if (Math.random() > 0.55) continue;
      const y = this.getTerrainHeight(x);
      if (!Number.isFinite(y)) continue;

      if (this.mapId === 'desert') {
        const asset = Math.random() > 0.78 ? 'veg_cactus' : 'veg_grass';
        const veg = this.add.sprite(x, y, asset)
          .setOrigin(0.5, 1)
          .setDepth(14 + Math.random() * 0.08)
          .setTint(0xcccccc);
        if (asset === 'veg_grass') {
          veg.setTint(0xc2b280);
          veg.setScale(0.62 + Math.random() * 0.5);
          veg.setAlpha(0.85);
        } else {
          veg.setScale(0.85 + Math.random() * 0.6);
          veg.setAlpha(0.92);
        }
        this.vegetationGroup.add(veg);
        veg.setData('originalAngle', 0);
      } else {
        const r = Math.random();
        const asset =
          r < 0.12 ? (r < 0.06 ? 'veg_tree' : 'veg_pine') :
          (r < 0.52 ? 'veg_grass' :
          (r < 0.76 ? 'veg_flower_p' :
          (r < 0.94 ? 'veg_flower_y' : 'veg_grass')));
        const veg = this.add.sprite(x, y, asset)
          .setOrigin(0.5, 1)
          .setDepth(14 + Math.random() * 0.14)
          .setTint(0xf6f6f6);
        if (asset === 'veg_tree' || asset === 'veg_pine') {
          veg.setScale(0.86 + Math.random() * 0.42);
          veg.setAlpha(0.95);
        } else if (asset === 'veg_grass') {
          veg.setScale(0.75 + Math.random() * 0.55);
          veg.setAlpha(0.92);
        } else {
          veg.setScale(0.78 + Math.random() * 0.55);
          veg.setAlpha(0.98);
        }
        this.vegetationGroup.add(veg);
        veg.setData('originalAngle', 0);
      }
    }

    const count = this.mapId === 'desert' ? 3 : 5;
    for (let i = 0; i < count; i++) {
      const ax = Phaser.Math.Between(240, w - 240);
      const h = this.getGroundHeight(ax);
      const kind = this.mapId === 'desert'
        ? (Math.random() < 0.55 ? 'scorpion' : 'snake')
        : ((() => {
            const roll = Math.random();
            return roll < 0.36 ? 'rabbit' :
              roll < 0.58 ? 'fox' :
              roll < 0.76 ? 'boar' :
              roll < 0.9 ? 'elk' :
              'crow';
          })());
      const y = h - (kind === 'crow' ? 20 : 18);
      const a = new Animal(this, ax, y, kind as any);
      this.animalGroup.add(a);
      this.animals.push(a);
    }
  }

  private generateForestTerrain() {
    this.terrainHeights = []; this.baseHeights = []; this.terrainDamage = [];
    this.terrainBurn = [];
    const minH = 72; const maxH = 576; const centerH = 400; 
    for (let x = 0; x <= this.WORLD_WIDTH; x += this.TERRAIN_STEP) {
      const n1 = Math.sin(x * 0.0035) * 160; const n2 = Math.sin(x * 0.012) * 50; const n3 = Math.sin(x * 0.025) * 15;    
      let val = Phaser.Math.Clamp(centerH + n1 + n2 + n3, minH, maxH);
      this.terrainHeights.push(val); this.baseHeights.push(val); this.terrainDamage.push(0);
      this.terrainBurn.push(0);
    }
    for (let pass = 0; pass < 2; pass++) {
      const src = this.terrainHeights;
      const smoothed: number[] = src.slice();
      for (let i = 1; i < src.length - 1; i++) {
        const a = src[i - 1];
        const b = src[i];
        const c = src[i + 1];
        smoothed[i] = Phaser.Math.Clamp((a + b * 2 + c) * 0.25, minH, maxH);
      }
      this.terrainHeights = smoothed;
    }
    const maxDelta = 16;
    for (let i = 1; i < this.terrainHeights.length; i++) {
      const prev = this.terrainHeights[i - 1];
      const cur = this.terrainHeights[i];
      const d = cur - prev;
      if (d > maxDelta) this.terrainHeights[i] = Phaser.Math.Clamp(prev + maxDelta, minH, maxH);
      else if (d < -maxDelta) this.terrainHeights[i] = Phaser.Math.Clamp(prev - maxDelta, minH, maxH);
    }
    this.baseHeights = this.terrainHeights.slice();
    this.drawTerrain();
  }

  private getDesertSectionAtX(worldX: number): DesertBgmDesignSection | null {
    if (!this.desertBgmAnalysis) return null;
    const width = Math.max(1, this.WORLD_WIDTH);
    const progress = Phaser.Math.Clamp(worldX / width, 0, 0.999999);
    return pickDesertSectionAtProgress(this.desertBgmAnalysis, progress);
  }

  private generateDesertTerrain() {
    this.terrainHeights = []; this.baseHeights = []; this.terrainDamage = [];
    this.terrainBurn = [];
    const minH = 58; const maxH = 628; const centerH = 392;
    let prev = centerH;
    const secCount = Math.max(8, this.desertBgmAnalysis?.sections?.length ?? 12);
    const secSpan = Math.max(260, this.WORLD_WIDTH / secCount);
    for (let x = 0; x <= this.WORLD_WIDTH; x += this.TERRAIN_STEP) {
      const sec = this.getDesertSectionAtX(x);
      const terrainRelief = sec?.terrainRelief ?? 0.5;
      const terrainRhythm = sec?.terrainRhythm ?? 0.45;
      const enemyPressure = sec?.enemyPressure ?? 0.45;
      const synthDrive = sec?.synthDrive ?? 0.4;
      const stringLift = sec?.stringLift ?? 0.35;
      const sectionIndex = sec?.index ?? 0;
      const rhythmT = Phaser.Math.Clamp(terrainRhythm * 0.72 + synthDrive * 0.28, 0, 1);
      const dynamicT = Phaser.Math.Clamp(terrainRelief * 0.58 + enemyPressure * 0.42, 0, 1);
      const secPos = ((x / secSpan) + sectionIndex * 0.17) % 1;
      const secTri = 1 - Math.abs(secPos * 2 - 1);
      const secGate = Math.pow(secTri, Phaser.Math.Linear(3.6, 0.8, rhythmT));

      const n1Amp = Phaser.Math.Linear(190, 360, terrainRelief);
      const n2Amp = Phaser.Math.Linear(120, 220, rhythmT);
      const n3Amp = Phaser.Math.Linear(45, 145, enemyPressure);
      const ridgeAmp = Phaser.Math.Linear(40, 130, stringLift);
      const beatAmp = Phaser.Math.Linear(70, 220, rhythmT) * Phaser.Math.Linear(1.0, 1.35, dynamicT);
      const phraseAmp = Phaser.Math.Linear(40, 160, stringLift);
      const stepAmp = Phaser.Math.Linear(32, 132, rhythmT);
      const chopAmp = Phaser.Math.Linear(24, 96, enemyPressure);

      const n1Freq = Phaser.Math.Linear(0.0012, 0.0032, rhythmT);
      const n2Freq = Phaser.Math.Linear(0.0048, 0.0115, rhythmT);
      const n3Freq = Phaser.Math.Linear(0.014, 0.032, synthDrive);
      const ridgeFreq = Phaser.Math.Linear(0.00075, 0.0022, enemyPressure);
      const beatFreq = Phaser.Math.Linear(0.011, 0.026, terrainRhythm);
      const phraseFreq = Phaser.Math.Linear(0.0018, 0.0054, terrainRhythm);

      const n1 = Math.sin(x * n1Freq + terrainRelief * 3.1) * n1Amp;
      const n2 = Math.sin(x * n2Freq + terrainRhythm * 5.8) * n2Amp;
      const n3 = Math.sin(x * n3Freq + synthDrive * 7.2) * n3Amp;
      const ridges = Math.sin(x * ridgeFreq + sectionIndex) * ridgeAmp;

      const beatBase = Math.sin(x * beatFreq + sectionIndex * 0.92 + synthDrive * 4.4);
      const beatPulse = Math.sign(beatBase) * Math.pow(Math.abs(beatBase), Phaser.Math.Linear(1.8, 0.75, terrainRhythm));
      const beatAccent = Math.sin(x * beatFreq * 2.04 + sectionIndex * 1.73 + enemyPressure * 6.2);
      const beatContour = (beatPulse * 0.78 + beatAccent * 0.22) * beatAmp;

      const phraseBase = Math.sin(x * phraseFreq + sectionIndex * 1.26 + stringLift * 4.2);
      const phraseTri = Math.asin(phraseBase) / (Math.PI * 0.5);
      const phraseContour = phraseTri * phraseAmp;

      const stepContour = (secGate * 2 - 1) * stepAmp;
      const chopBase = Math.sin(x * beatFreq * 3.4 + sectionIndex * 2.1 + synthDrive * 8.8);
      const chopContour = Math.sign(chopBase) * Math.pow(Math.abs(chopBase), Phaser.Math.Linear(1.2, 0.55, rhythmT)) * chopAmp;
      const sectionSwing = Math.sin(sectionIndex * 1.37 + stringLift * 5.1) * Phaser.Math.Linear(22, 96, dynamicT);

      let val = centerH + n1 + n2 + n3 + ridges + beatContour + phraseContour + stepContour + chopContour + sectionSwing;
      const quantStep = Phaser.Math.Linear(6, 30, rhythmT);
      val = Math.round(val / quantStep) * quantStep;
      const maxDelta = Phaser.Math.Linear(48, 86, rhythmT);
      const d = val - prev;
      if (d > maxDelta) val = prev + maxDelta;
      else if (d < -maxDelta) val = prev - maxDelta;
      prev = Phaser.Math.Clamp(val, minH, maxH);
      val = prev;

      this.terrainHeights.push(val); this.baseHeights.push(val); this.terrainDamage.push(0);
      this.terrainBurn.push(0);
    }
    for (let pass = 0; pass < 1; pass++) {
      const src = this.terrainHeights;
      const smoothed = src.slice();
      for (let i = 1; i < src.length - 1; i++) {
        smoothed[i] = Phaser.Math.Clamp((src[i - 1] * 0.16 + src[i] * 0.68 + src[i + 1] * 0.16), minH, maxH);
      }
      this.terrainHeights = smoothed;
    }
    this.baseHeights = this.terrainHeights.slice();
    this.drawTerrain();
  }

  private resolveDesertBgmFolderKey(): string {
    const preferred = 'bgm/desert/sfx';
    if (this.audio?.hasFolderAudio(preferred)) return preferred;
    const keys = this.audio?.getFolderKeys('bgm/desert') ?? [];
    if (!keys.length) return preferred;
    const sfxKey = keys.find((k) => k.endsWith('/sfx'));
    return sfxKey ?? keys[0];
  }

  private getDesertBgmAnalysisCacheKey(folderKey: string, urls: string[]): string {
    const shortSig = urls.slice(0, 6).join('|');
    return `panzer-desert-bgm-analysis-v2:${folderKey}:${shortSig}`;
  }

  private loadCachedDesertBgmAnalysis(cacheKey: string): DesertBgmAnalysis | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as DesertBgmAnalysis;
      if (!parsed || !Array.isArray(parsed.sections) || !Array.isArray(parsed.timeline)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private buildDesertBgmReport(analysis: DesertBgmAnalysis) {
    const dynamicCurve = analysis.timeline.map((p) => ({
      timeSec: Number(p.timeSec.toFixed(2)),
      intensity: Number(p.intensity.toFixed(3))
    }));

    const drumDensityRanges = analysis.sections.map((section) => ({
      index: section.index,
      startSec: Number(section.startSec.toFixed(2)),
      endSec: Number(section.endSec.toFixed(2)),
      drumDensity: Number(section.drumDensity.toFixed(3))
    }));

    const synthBands = analysis.sections.map((section) => ({
      index: section.index,
      synthDrive: Number(section.synthDrive.toFixed(3)),
      terrainRhythm: Number(section.terrainRhythm.toFixed(3))
    }));

    const stringBursts = analysis.sections
      .filter((section) => section.stringLift >= 0.58)
      .map((section) => ({
        index: section.index,
        startSec: Number(section.startSec.toFixed(2)),
        endSec: Number(section.endSec.toFixed(2)),
        stringLift: Number(section.stringLift.toFixed(3)),
        label: section.label
      }));

    const levelDesignSections = analysis.sections.map((section) => ({
      index: section.index,
      startSec: Number(section.startSec.toFixed(2)),
      endSec: Number(section.endSec.toFixed(2)),
      terrainRelief: Number(section.terrainRelief.toFixed(3)),
      enemyPressure: Number(section.enemyPressure.toFixed(3)),
      lowHpBias: Number(section.lowHpBias.toFixed(3)),
      vegetationDensity: Number(section.vegetationDensity.toFixed(3)),
      label: section.label
    }));

    return {
      durationSec: Number(analysis.durationSec.toFixed(2)),
      dynamicCurve,
      drumDensityRanges,
      synthBands,
      stringBursts,
      levelDesignSections
    };
  }

  private emitDesertBgmAnalysisReport(folderKey: string, sourceUrl: string, fromCache: boolean) {
    if (typeof window === 'undefined' || !this.desertBgmAnalysis) return;
    const report = this.buildDesertBgmReport(this.desertBgmAnalysis);
    window.dispatchEvent(new CustomEvent('panzer-desert-bgm-analysis', {
      detail: {
        folderKey,
        sourceUrl,
        fromCache,
        report
      }
    }));
  }

  private async analyzeDesertBgmFromUrl(url: string): Promise<DesertBgmAnalysis | null> {
    const normalizedUrl = url.startsWith('/') ? url : `/${url.replace(/^\/+/, '')}`;
    const response = await fetch(normalizedUrl, { cache: 'no-store' });
    if (!response.ok) return null;
    const audioData = await response.arrayBuffer();

    let decodeContext = (this.sound as any)?.context as AudioContext | undefined;
    let ownedContext: AudioContext | null = null;
    if (!decodeContext && typeof window !== 'undefined') {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as (new () => AudioContext) | undefined;
      if (Ctx) {
        ownedContext = new Ctx();
        decodeContext = ownedContext;
      }
    }
    if (!decodeContext) return null;

    try {
      const decoded = await decodeContext.decodeAudioData(audioData.slice(0));
      return analyzeDesertBgmBuffer(decoded);
    } finally {
      if (ownedContext) {
        ownedContext.close().catch(() => {});
      }
    }
  }

  private beginDesertBgmAnalysis() {
    if (this.mapId !== 'desert' || this.testRoomEnabled || this.tutorialMode) return;
    if (!this.audio) return;
    if (this.desertBgmAnalysisPromise) return;

    this.desertBgmFolderKey = this.resolveDesertBgmFolderKey();
    const urls = this.audio.getFolderUrls(this.desertBgmFolderKey);
    if (!urls.length) return;

    const cacheKey = this.getDesertBgmAnalysisCacheKey(this.desertBgmFolderKey, urls);
    this.desertBgmAnalysisCacheKey = cacheKey;
    if (!this.desertBgmAnalysis) {
      this.desertBgmAnalysis = this.loadCachedDesertBgmAnalysis(cacheKey);
      if (this.desertBgmAnalysis) {
        this.emitDesertBgmAnalysisReport(this.desertBgmFolderKey, urls[0], true);
      }
    }

    const sourceUrl = urls[0];
    this.desertBgmAnalysisPromise = (async () => {
      try {
        const analysis = await this.analyzeDesertBgmFromUrl(sourceUrl);
        if (!analysis) return;
        this.desertBgmAnalysis = analysis;
        if (typeof window !== 'undefined' && this.desertBgmAnalysisCacheKey) {
          try { window.localStorage.setItem(this.desertBgmAnalysisCacheKey, JSON.stringify(analysis)); } catch {}
        }
        this.emitDesertBgmAnalysisReport(this.desertBgmFolderKey, sourceUrl, false);
      } catch {}
    })().finally(() => {
      this.desertBgmAnalysisPromise = null;
    });
  }

  private computeVehicleKillPointsByHp(basePoints: number, source?: any): number {
    const base = Number.isFinite(basePoints) && basePoints > 0 ? basePoints : 1000;
    const hpRaw = Number(source?.maxHp ?? source?.hp);
    if (!Number.isFinite(hpRaw) || hpRaw <= 0) return Math.round(base);

    const hpRatio = Phaser.Math.Clamp(Math.sqrt(hpRaw / 1200), 0.7, 2.4);
    const adjusted = Math.round((base * hpRatio) / 10) * 10;
    const minPoints = Math.round(base * 0.7);
    return Phaser.Math.Clamp(adjusted, minPoints, 3000);
  }

  public recordEnemyVehicleKill(label: string, points: number, source?: any, shellType?: ShellType) {
    // Only award points/feedback if the killer is the player
    const now = this.time?.now ?? 0;
    let isPlayerKill = false;
    if (source && this.player) {
        if (source === this.player) isPlayerKill = true;
        if (source === this.player.chassis) isPlayerKill = true;
        if (source.isPlayer) isPlayerKill = true;
        if (source.owner === this.player) isPlayerKill = true;
    }
    if (!isPlayerKill && source) {
      const until = this.recentPlayerDamageUntil.get(source);
      if (typeof until === 'number' && until > now) isPlayerKill = true;
    }
    if (!isPlayerKill) return;

    if (source) {
      const until = this.recentVehicleKillSources.get(source);
      if (typeof until === 'number' && until > now) return;
      this.recentVehicleKillSources.set(source, now + 6000);
      if (this.recentVehicleKillSources.size > 220) {
        for (const [k, u] of this.recentVehicleKillSources) {
          if (u <= now) this.recentVehicleKillSources.delete(k);
        }
        while (this.recentVehicleKillSources.size > 180) {
          const first = this.recentVehicleKillSources.keys().next().value;
          if (first === undefined) break;
          this.recentVehicleKillSources.delete(first);
        }
      }
    }
    const killPoints = this.computeVehicleKillPointsByHp(points, source);

    this.vehicleKills++;
    this.vehicleKillBreakdown.push({ label, points: killPoints });
    this.score += killPoints;
    this.events.emit('update-hud', { hp: (this.player?.hp && this.player?.maxHp ? (this.player.hp / this.player.maxHp) * 100 : 100), shell: this.player ? ShellType[this.player.currentShell] : 'STANDARD', totalScore: this.score });
    this.events.emit('kill-feed', { kind: 'vehicle', label, points: killPoints, t: this.time.now });
    if (shellType === ShellType.AP) {
      this.awardEventPoints('special', '颗秒！', 100, '穿甲弹击毁载具');
    }
  }

  public markPlayerDamage(target: any, durationMs: number = 1600) {
    if (!target) return;
    const now = this.time?.now ?? 0;
    this.recentPlayerDamageUntil.set(target, now + Math.max(1, durationMs));
  }

  private addScore(points: number) {
    if (!Number.isFinite(points) || points === 0) return;
    this.score += points;
    this.events.emit('update-hud', {
      hp: (this.player?.hp && this.player?.maxHp ? (this.player.hp / this.player.maxHp) * 100 : 100),
      shell: this.player ? ShellType[this.player.currentShell] : 'STANDARD',
      totalScore: this.score
    });
  }

  public awardEventPoints(kind: string, label: string, points: number, tag?: string) {
    this.addScore(points);
    this.events.emit('kill-feed', { kind, label, points, tag: tag ?? '', t: this.time.now });
  }

  private addKillFeedEntry(kind: string | undefined, label: string, points: number, tag: string, bonusPoints: number) {
    const cam = this.cameras.main;
    const w = cam.width;
    const h = cam.height;

    const isMobileHud = this.sys.game.device.os.android || this.sys.game.device.os.iOS || this.sys.game.device.input.touch;
    const baseY = h - (isMobileHud ? 86 : 118);
    const baseX = w * 0.5;
    const id = this.nextKillFeedId++;

    const fmtPts = (p: number) => (p >= 0 ? `+${Math.round(p)}` : `${Math.round(p)}`);
    const topLine = (() => {
      if (kind === 'intercept') return `拦截炮弹 ${fmtPts(points)}`;
      if (kind === 'special') return `${label} ${fmtPts(points)}`;
      if (kind === 'vehicle') return `击毁载具：${label} ${fmtPts(points)}`;
      return `${label} ${fmtPts(points)}`;
    })();

    const color = (() => {
      if (kind === 'special') return '#ffcc33';
      if (kind === 'intercept') return '#66d9ff';
      return '#ffffff';
    })();

    const txt = this.add.text(baseX, baseY, topLine, {
      fontSize: '22px',
      color,
      fontStyle: 'bold',
      align: 'center',
      stroke: '#000',
      strokeThickness: 6
    }).setOrigin(0.5).setDepth(1000).setScrollFactor(0).setAlpha(0);

    const subLine = (() => {
      if (bonusPoints !== 0) return `特殊加分 ${fmtPts(bonusPoints)}`;
      if (tag) return tag;
      return '';
    })();

    const sub = subLine
      ? this.add.text(baseX, baseY + 24, subLine, {
          fontSize: '14px',
          color: '#b8ffb8',
          fontStyle: 'bold',
          align: 'center',
          stroke: '#000',
          strokeThickness: 5
        }).setOrigin(0.5).setDepth(1000).setScrollFactor(0).setAlpha(0)
      : undefined;

    const entry = { id, text: txt, sub, createdAt: this.time.now, lifeMs: 2800, points, bonusPoints };
    this.killFeedItems.unshift(entry);

    const maxItems = 3;
    while (this.killFeedItems.length > maxItems) {
      const old = this.killFeedItems.pop();
      if (old?.text?.active) old.text.destroy();
      if (old?.sub?.active) old.sub.destroy();
    }

    const stackGap = 62;
    for (let i = 0; i < this.killFeedItems.length; i++) {
      const it = this.killFeedItems[i];
      const ty = baseY - i * stackGap;
      this.tweens.add({ targets: it.text, y: ty, duration: 240, ease: 'Sine.easeOut' });
      if (it.sub) this.tweens.add({ targets: it.sub, y: ty + 24, duration: 240, ease: 'Sine.easeOut' });
    }

    this.tweens.add({ targets: txt, alpha: 1, duration: 90, ease: 'Sine.easeOut' });
    if (sub) this.tweens.add({ targets: sub, alpha: 0.95, duration: 110, ease: 'Sine.easeOut' });

    this.time.delayedCall(entry.lifeMs, () => {
      const idx = this.killFeedItems.findIndex(i => i.id === id);
      if (idx >= 0) this.killFeedItems.splice(idx, 1);
      if (txt.active) this.tweens.add({ targets: txt, y: txt.y - 14, alpha: 0, duration: 520, onComplete: () => txt.destroy() });
      if (sub?.active) this.tweens.add({ targets: sub, y: sub.y - 14, alpha: 0, duration: 520, onComplete: () => sub.destroy() });
    });
  }

  private applyTerrainBurn(x: number, radius: number, amount: number) {
    const centerIdx = Math.round(x / this.TERRAIN_STEP);
    const radIdx = Math.ceil(radius / this.TERRAIN_STEP);
    for (let i = centerIdx - radIdx; i <= centerIdx + radIdx; i++) {
      if (i < 0 || i >= this.terrainBurn.length) continue;
      const distX = Math.abs(x - i * this.TERRAIN_STEP);
      if (distX > radius) continue;
      const t = Phaser.Math.Clamp(distX / radius, 0, 1);
      const profile = Math.pow(Math.cos(t * (Math.PI / 2)), 2);
      this.terrainBurn[i] = Phaser.Math.Clamp(this.terrainBurn[i] + amount * profile, 0, 1);
    }
  }

  private drawTerrain() {
    this.terrainGraphics.clear();
    this.terrainMaskGraphics.clear();
    this.groundDecals.clear();
    const rainBlend = this.mapId === 'forest' ? Phaser.Math.Clamp(this.forestRainBlend, 0, 1) : 0;
    const blendColor = (dry: number, wet: number): number => {
      if (rainBlend <= 0) return dry;
      if (rainBlend >= 1) return wet;
      const c0 = Phaser.Display.Color.ValueToColor(dry);
      const c1 = Phaser.Display.Color.ValueToColor(wet);
      const r = Math.round(Phaser.Math.Linear(c0.red, c1.red, rainBlend));
      const g = Math.round(Phaser.Math.Linear(c0.green, c1.green, rainBlend));
      const b = Math.round(Phaser.Math.Linear(c0.blue, c1.blue, rainBlend));
      return Phaser.Display.Color.GetColor(r, g, b);
    };

    // 1. Draw Pattern Mask (Deep Ground)
    this.terrainMaskGraphics.fillStyle(0xffffff);
    this.terrainMaskGraphics.beginPath();
    this.terrainMaskGraphics.moveTo(0, 7000);
    for (let i = 0; i < this.terrainHeights.length; i++) {
        // Dirt level rises as grass gets damaged
        const damage = this.terrainDamage[i] || 0;
        const grassThick = 32 * (1 - Phaser.Math.Clamp(damage, 0, 1));
        // Dirt starts where grass ends
        this.terrainMaskGraphics.lineTo(i * this.TERRAIN_STEP, this.terrainHeights[i] + grassThick);
    }
    this.terrainMaskGraphics.lineTo(this.WORLD_WIDTH, 7000);
    this.terrainMaskGraphics.closePath();
    this.terrainMaskGraphics.fillPath();

    // 2. Draw Surface Strip (Top Soil)
    let surfaceColor = 0xE0B181;
    if (this.mapId !== 'desert') {
        const lightDry = 0x3e8a3e;
        const lightWet = 0x2f6b45;
        surfaceColor = blendColor(lightDry, lightWet);
    }
    
    this.terrainGraphics.fillStyle(surfaceColor, 1);
    this.terrainGraphics.beginPath();
    
    // Draw quads for valid segments
    for (let i = 0; i < this.terrainHeights.length - 1; i++) {
        const dA = this.terrainDamage[i] || 0;
        const dB = this.terrainDamage[i + 1] || 0;
        
        // Skip if both fully damaged
        if (dA >= 0.95 && dB >= 0.95) continue;

        const x1 = i * this.TERRAIN_STEP;
        const x2 = (i + 1) * this.TERRAIN_STEP;
        const y1 = this.terrainHeights[i];
        const y2 = this.terrainHeights[i + 1];

        // Modulate thickness by damage
        // Grass is Top-Aligned (starts at surface y)
        // As damage increases, thickness decreases, and dirt rises to meet it.
        const thickA = 32 * (1 - Phaser.Math.Clamp(dA, 0, 1));
        const thickB = 32 * (1 - Phaser.Math.Clamp(dB, 0, 1));

        if (thickA < 0.5 && thickB < 0.5) continue;

        this.terrainGraphics.fillStyle(surfaceColor, 1);
        this.terrainGraphics.beginPath();
        // Top edge at surface
        this.terrainGraphics.moveTo(x1, y1);
        this.terrainGraphics.lineTo(x2, y2);
        // Bottom edge at thickness
        this.terrainGraphics.lineTo(x2, y2 + thickB);
        this.terrainGraphics.lineTo(x1, y1 + thickA);
        this.terrainGraphics.lineTo(x1, y1);
        this.terrainGraphics.closePath();
        this.terrainGraphics.fillPath();
    }
    // this.terrainGraphics.fillPath(); // Removed single fillPath
    
    this.terrainGraphics.lineStyle(6, this.mapId === 'desert' ? 0x8B4513 : 0x2f6b2f); 
    this.terrainGraphics.beginPath();
    let penDown = false;
    for (let i = 0; i < this.terrainHeights.length; i++) {
        const damaged = (this.terrainDamage[i] || 0) > 0.1;
        const x = i * this.TERRAIN_STEP;
        const y = this.terrainHeights[i];
        if (!damaged) {
            if (!penDown) {
                this.terrainGraphics.moveTo(x, y);
                penDown = true;
            } else {
                this.terrainGraphics.lineTo(x, y);
            }
        } else {
            penDown = false;
        }
    }
    this.terrainGraphics.strokePath();

    if (this.mapId === 'desert') {
        this.groundDecals.fillStyle(0xc29b6b, 0.4); 
         for (let i = 0; i < this.terrainHeights.length; i += 12) {
             const x = i * this.TERRAIN_STEP;
             const y = this.terrainHeights[i];
             if (Math.random() > 0.7) {
                 this.groundDecals.fillEllipse(x, y + 5, 10 + Math.random() * 20, 5 + Math.random() * 5);
             }
         }
    } else {
        const grass1Dry = 0x1f4b1f;
        const grass1Wet = 0x183a2a;
        const grass1Color = blendColor(grass1Dry, grass1Wet);
        const grass1Alpha = Phaser.Math.Linear(0.22, 0.30, rainBlend);
        this.groundDecals.fillStyle(grass1Color, grass1Alpha);
        for (let i = 0; i < this.terrainHeights.length; i += 3) {
          const b = this.terrainBurn[i] ?? 0;
          if (b > 0.35) continue;
          const x = i * this.TERRAIN_STEP;
          const y = this.terrainHeights[i];
          const n = Math.sin(i * 0.37) * 0.55 + Math.sin(i * 0.11 + 2.3) * 0.45;
          const h = 6 + Math.floor((n + 1) * 4);
          const w = (i % 9 === 0) ? 2 : 1;
          this.groundDecals.fillRect(x + ((i % 7) - 3), y - 2 - h, w, h);
        }
        const grass2Dry = 0x2b6a2b;
        const grass2Wet = 0x1a4a3a;
        const grass2Color = blendColor(grass2Dry, grass2Wet);
        const grass2Alpha = Phaser.Math.Linear(0.16, 0.22, rainBlend);
        this.groundDecals.fillStyle(grass2Color, grass2Alpha);
        for (let i = 0; i < this.terrainHeights.length; i += 8) {
          const b = this.terrainBurn[i] ?? 0;
          if (b > 0.25) continue;
          const x = i * this.TERRAIN_STEP;
          const y = this.terrainHeights[i];
          const r = 10 + ((i * 13) % 10);
          this.groundDecals.fillEllipse(x + ((i % 5) - 2) * 4, y - 4, r, r * 0.35);
        }
        if (rainBlend > 0) {
          const puddleAlpha = 0.22 * rainBlend;
          this.groundDecals.fillStyle(0x0a1a14, puddleAlpha);
          for (let i = 0; i < this.terrainHeights.length; i += 7) {
            if ((i % 11) !== 0) continue;
            const b = this.terrainBurn[i] ?? 0;
            if (b > 0.18) continue;
            const x = i * this.TERRAIN_STEP;
            const y = this.terrainHeights[i];
            const w = 26 + ((i * 17) % 20);
            this.groundDecals.fillEllipse(x, y + 4, w, w * 0.28);
          }
        }
    }

    const burnColor = 0x808080;
    for (let i = 0; i < this.terrainBurn.length; i += 1) {
      const b = this.terrainBurn[i];
      if (b <= 0.02) continue;
      const x = i * this.TERRAIN_STEP;
      const y = this.terrainHeights[i];
      const w = this.TERRAIN_STEP * (1.2 + b * 4.0);
      const r = (22 + b * 110);
      this.groundDecals.fillStyle(burnColor, Math.min(0.55, 0.18 + b * 0.35));
      this.groundDecals.fillEllipse(x, y - 4, r, r * 0.32);
      this.groundDecals.fillRect(x - w * 0.5, y - 14, w, 16);
    }

    const worldBottom = this.physics.world.bounds.bottom;
    this.terrainGraphics.fillStyle(0x070707, 1);
    this.terrainGraphics.fillRect(0, this.bedrockY, this.WORLD_WIDTH, (worldBottom - this.bedrockY) + 220);
  }

  private updateTerrainPhysics() {
    if (!this.sys?.isActive()) return;
    if (!this.physics?.world) return;
    if (!this.cameras?.main) return;
    if (!Array.isArray(this.terrainHeights) || this.terrainHeights.length < 2) return;
    const cam = this.cameras.main;
    const startIdx = Math.max(0, Math.floor((cam.scrollX - this.VIEW_BUFFER) / this.TERRAIN_STEP));
    const endIdx = Math.min(this.terrainHeights.length - 2, Math.ceil((cam.scrollX + (cam.width / cam.zoom) + this.VIEW_BUFFER) / this.TERRAIN_STEP));
    const desiredCount = Math.max(0, endIdx - startIdx + 1);

    while (this.terrainBodies.length > desiredCount) {
      const rect = this.terrainBodies.pop();
      rect?.destroy();
    }
    while (this.terrainBodies.length < desiredCount) {
      const rect = this.add.rectangle(0, 0, this.TERRAIN_STEP, 100, 0, 0)?.setOrigin(0.5, 0);
      if (!rect) break;
      this.physics.add.existing(rect, true);
      this.terrainBodies.push(rect);
    }

    for (let i = 0; i < desiredCount; i++) {
      const idx = startIdx + i;
      let rect = this.terrainBodies[i];
      const geom = (rect as any)?.geom;
      if (!rect || !rect.active || !geom || typeof (rect as any).setSize !== 'function' || typeof (rect as any).setPosition !== 'function') {
        rect?.destroy();
        rect = this.add.rectangle(0, 0, this.TERRAIN_STEP, 100, 0, 0)?.setOrigin(0.5, 0) as any;
        if (!rect) continue;
        this.physics.add.existing(rect, true);
        this.terrainBodies[i] = rect;
      }
      if (!(rect as any).geom) continue;
      const topY = this.terrainHeights[idx];
      const worldBottom = this.physics.world.bounds.bottom;
      const h = Math.max(240, (worldBottom - topY) + 600);
      rect.setPosition(idx * this.TERRAIN_STEP + this.TERRAIN_STEP * 0.5, topY);
      rect.setSize(this.TERRAIN_STEP, h);
      const body = rect.body as Phaser.Physics.Arcade.StaticBody | undefined;
      body?.updateFromGameObject();
    }

    this.wakeSleepingDebrisInRange(startIdx * this.TERRAIN_STEP, (endIdx + 1) * this.TERRAIN_STEP);
    this.hibernateSleepingDebrisOutOfRange(startIdx * this.TERRAIN_STEP, (endIdx + 1) * this.TERRAIN_STEP);
  }

  public getTerrainHeight(worldX: number): number {
    const idx = Math.floor(worldX / this.TERRAIN_STEP);
    if (idx < 0 || idx >= this.terrainHeights.length - 1) return 450;
    return Phaser.Math.Linear(this.terrainHeights[idx], this.terrainHeights[idx+1], (worldX % this.TERRAIN_STEP) / this.TERRAIN_STEP);
  }

  public getGroundHeight(x: number): number {
    let y = this.getTerrainHeight(x);
    for (const lake of this.lakes) {
        const segW = 140;
        const deckSurfaceY = lake.bridgeY - 72;
        const leftSeg = lake.segments[0];
        const rightSeg = lake.segments[lake.segments.length - 1];
        const leftAlive = !!leftSeg && leftSeg.health > 0 && leftSeg.rect.active && leftSeg.rect.visible;
        const rightAlive = !!rightSeg && rightSeg.health > 0 && rightSeg.rect.active && rightSeg.rect.visible;

        // Deck
        if (x >= lake.x0 && x <= lake.x1) {
             const segIdx = Phaser.Math.Clamp(Math.floor((x - lake.x0) / segW), 0, lake.segments.length - 1);
             const seg = lake.segments[segIdx];
             const alive = !!seg && seg.health > 0 && seg.rect.active && seg.rect.visible;
             if (alive && deckSurfaceY < y) y = deckSurfaceY;
        }
        
        // Ramps
        const rampW = 20;
        const rampCount = 12;
        const rampLen = rampW * rampCount;
        const surfaceY = deckSurfaceY;
        
        // Left Ramp
        if (leftAlive && x >= lake.x0 - rampLen && x < lake.x0) {
             const t = (lake.x0 - x) / rampLen;
             const h = Phaser.Math.Linear(surfaceY, this.getTerrainHeight(lake.x0), t);
             if (h < y) y = h;
        }
        
        // Right Ramp
        if (rightAlive && x > lake.x1 && x <= lake.x1 + rampLen) {
             const t = (x - lake.x1) / rampLen;
             const h = Phaser.Math.Linear(surfaceY, this.getTerrainHeight(lake.x1), t);
             if (h < y) y = h;
        }
    }
    return y;
  }

  public getTerrainNormal(worldX: number): number {
    return Math.atan2(this.getGroundHeight(worldX+15) - this.getGroundHeight(worldX-15), 30);
  }

  private isInSafeZone(x: number): boolean {
    if (this.testRoomEnabled || this.tutorialMode) return false;
    if (x < 3000) return x >= 0;
    const blockStart = Math.floor(x / 18000) * 18000;
    const bounds = this.getSafeZoneBoundsForBlock(blockStart);
    return x >= bounds.x0 && x < bounds.x1;
  }

  public isWaterAt(x: number): boolean {
    return this.getWaterSurfaceY(x) !== null;
  }

  public getWaterSurfaceY(x: number): number | null {
    for (const l of this.lakes) {
      if (x >= l.x0 && x <= l.x1) return l.waterY;
    }
    return null;
  }

  public isSwampAt(x: number): boolean {
    return this.getSwampSurfaceY(x) !== null;
  }

  public getSwampSurfaceY(x: number): number | null {
    for (const s of this.streams) {
      if (x >= s.x0 && x <= s.x1) return this.getTerrainHeight(x) + 4;
    }
    return null;
  }

  private redrawStream(stream: { x0: number; x1: number; gfx: Phaser.GameObjects.Graphics }) {
    const g = stream.gfx;
    if (!g.active) return;
    g.clear();

    const step = 40;
    const thickness = 30;
    const top: { x: number; y: number }[] = [];
    for (let x = stream.x0; x <= stream.x1; x += step) {
      top.push({ x, y: this.getTerrainHeight(x) + 4 });
    }
    if (top.length < 2) return;

    g.fillStyle(0x1a2a1f, 0.58);
    g.beginPath();
    g.moveTo(top[0].x, top[0].y);
    for (let i = 1; i < top.length; i++) g.lineTo(top[i].x, top[i].y);
    for (let i = top.length - 1; i >= 0; i--) g.lineTo(top[i].x, top[i].y + thickness);
    g.closePath();
    g.fillPath();

    g.fillStyle(0x0f1f19, 0.44);
    g.beginPath();
    g.moveTo(top[0].x, top[0].y + 6);
    for (let i = 1; i < top.length; i++) g.lineTo(top[i].x, top[i].y + 6);
    for (let i = top.length - 1; i >= 0; i--) g.lineTo(top[i].x, top[i].y + thickness - 4);
    g.closePath();
    g.fillPath();

    g.lineStyle(3, 0x060b07, 0.22);
    g.beginPath();
    g.moveTo(top[0].x, top[0].y + thickness - 2);
    for (let i = 1; i < top.length; i++) g.lineTo(top[i].x, top[i].y + thickness - 2);
    g.strokePath();

    g.lineStyle(2, 0x7fbf8f, 0.50);
    g.beginPath();
    g.moveTo(top[0].x, top[0].y + 2);
    for (let i = 1; i < top.length; i++) g.lineTo(top[i].x, top[i].y + 2);
    g.strokePath();

    for (let i = 0; i < 7; i++) {
      const px = Phaser.Math.Linear(stream.x0 + 90, stream.x1 - 90, (i + 0.35) / 7);
      const py = this.getTerrainHeight(px) + 10 + Math.sin((px + i * 120.3) * 0.01) * 2.2;
      const w = 60 + Math.sin((px + i * 9.7) * 0.02) * 28;
      const sheen = Phaser.Math.Clamp(0.08 + Math.sin((px + i * 77.7) * 0.013) * 0.025, 0.03, 0.11);
      g.fillStyle(0xc7e7bf, sheen);
      g.fillEllipse(px, py, w, 14);
    }
  }

  private createStream(x0: number, x1: number) {
    const pad = 120;
    const start = Math.max(0, x0 - pad);
    const end = Math.min(this.WORLD_WIDTH, x1 + pad);
    for (const s of this.streams) {
      if (Math.max(start, s.x0) <= Math.min(end, s.x1)) return;
    }

    const startIdx = Math.max(0, Math.floor(start / this.TERRAIN_STEP));
    const endIdx = Math.min(this.terrainHeights.length - 1, Math.ceil(end / this.TERRAIN_STEP));
    for (let i = startIdx; i <= endIdx; i++) {
      const x = i * this.TERRAIN_STEP;
      const t = Phaser.Math.Clamp(Math.abs((x - (start + end) * 0.5) / ((end - start) * 0.5)), 0, 1);
      const profile = 1 - Math.pow(t, 2);
      const depth = 90 + profile * 120;
      this.terrainHeights[i] = Math.min(this.terrainHeights[i] + depth, this.bedrockY);
    }
    this.drawTerrain();
    this.updateTerrainPhysics();
    this.snapVegetationToTerrainInRange(start, end);

    const gfx = this.add.graphics().setDepth(26).setAlpha(1);
    const stream = { x0: start, x1: end, gfx };
    this.streams.push(stream);
    this.redrawStream(stream);
  }

  private refreshStreamsAfterTerrainChange() {
    const maxExpand = 1600;
    for (const s of this.streams) {
      let startIdx = Math.floor(s.x0 / this.TERRAIN_STEP);
      let endIdx = Math.ceil(s.x1 / this.TERRAIN_STEP);
      const minIdx = Math.max(0, startIdx - Math.ceil(maxExpand / this.TERRAIN_STEP));
      const maxIdx = Math.min(this.terrainHeights.length - 1, endIdx + Math.ceil(maxExpand / this.TERRAIN_STEP));

      while (startIdx > minIdx) {
        const outside = this.terrainHeights[startIdx - 1];
        const inside = this.terrainHeights[startIdx];
        if (outside > inside - 35) startIdx--;
        else break;
      }
      while (endIdx < maxIdx) {
        const outside = this.terrainHeights[endIdx + 1];
        const inside = this.terrainHeights[endIdx];
        if (outside > inside - 35) endIdx++;
        else break;
      }

      const newX0 = startIdx * this.TERRAIN_STEP;
      const newX1 = endIdx * this.TERRAIN_STEP;
      if (newX0 !== s.x0 || newX1 !== s.x1) {
        s.x0 = newX0;
        s.x1 = newX1;
      }
      this.redrawStream(s);
    }
  }

  private redrawLake(lake: (typeof this.lakes)[number]) {
    const g = lake.gfx;
    if (!g.active) return;
    g.clear();

    const step = 40;
    const topY = lake.waterY;
    const bottom: { x: number; y: number }[] = [];
    for (let x = lake.x0; x <= lake.x1; x += step) {
      const by = Math.max(this.getTerrainHeight(x) + 8, topY + 10);
      bottom.push({ x, y: by });
    }
    if (bottom.length > 0 && bottom[bottom.length - 1].x < lake.x1) {
      const by = Math.max(this.getTerrainHeight(lake.x1) + 8, topY + 10);
      bottom.push({ x: lake.x1, y: by });
    }
    if (bottom.length < 2) return;

    const fillLayer = (color: number, alpha: number, maxDepth: number | null) => {
      g.fillStyle(color, alpha);
      g.beginPath();
      g.moveTo(bottom[0].x, topY);
      for (let i = 1; i < bottom.length; i++) g.lineTo(bottom[i].x, topY);
      for (let i = bottom.length - 1; i >= 0; i--) {
        const y = maxDepth === null ? bottom[i].y : Math.min(bottom[i].y, topY + maxDepth);
        g.lineTo(bottom[i].x, y);
      }
      g.closePath();
      g.fillPath();

      const rb = bottom[bottom.length - 1];
      const rby = maxDepth === null ? rb.y : Math.min(rb.y, topY + maxDepth);
      if (rby > topY) {
        g.fillRect(bottom[0].x - 8, topY, 16, rby - topY);
        g.fillRect(rb.x - 8, topY, 16, rby - topY);
      }
    };

    fillLayer(0x061c2f, 0.72, null);
    fillLayer(0x0b3356, 0.46, 220);
    fillLayer(0x1a6aa8, 0.14, 90);

    // Ecology: Seaweed at the bottom
    g.lineStyle(2, 0x143d28, 0.5);
    for (let i = 0; i < bottom.length; i += 2) {
      if (Math.random() > 0.3) continue;
      const pt = bottom[i];
      // Make seaweed taller - can reach near surface
      // Calculate max height based on water depth
      const depth = pt.y - topY;
      if (depth > 20) { 
         // Allow seaweed to grow up to 85% of depth, making it visible from bridge
         const h = 20 + Math.random() * (depth * 0.85);
         const sway = Math.sin(lake.wavePhase + i) * 15; // Increased sway
         const curve = new Phaser.Curves.QuadraticBezier(
             new Phaser.Math.Vector2(pt.x, pt.y),
             new Phaser.Math.Vector2(pt.x + sway * 0.5, pt.y - h * 0.5),
             new Phaser.Math.Vector2(pt.x + sway, pt.y - h)
         );
         curve.draw(g);
      }
    }

    g.lineStyle(3, 0x0a0f14, 0.18);
    g.lineBetween(lake.x0 + 10, topY - 2, lake.x1 - 10, topY - 2);

    g.lineStyle(2, 0xc8f6ff, 0.14);
    g.lineBetween(lake.x0 + 16, topY + 2, lake.x1 - 16, topY + 2);

    const bankW = 120;
    g.fillStyle(0xd6fbff, 0.06);
    g.fillRect(lake.x0 + 12, topY + 2, bankW, 10);
    g.fillRect(lake.x1 - 12 - bankW, topY + 2, bankW, 10);

    const rampW = 20;
    const rampCount = 12;
    const rampLen = rampW * rampCount;
    const deckSurfaceY = lake.bridgeY - 72;
    const drawRamp = (xA: number, xB: number, edgeX: number) => {
      g.fillStyle(0x3d3d3d, 0.92);
      g.beginPath();
      for (let x = xA; x <= xB; x += rampW) {
        const t = Phaser.Math.Clamp(Math.abs(edgeX - x) / rampLen, 0, 1);
        const top = Phaser.Math.Linear(deckSurfaceY, this.getTerrainHeight(edgeX), t);
        if (x === xA) g.moveTo(x, top);
        else g.lineTo(x, top);
      }
      for (let x = xB; x >= xA; x -= rampW) {
        const t = Phaser.Math.Clamp(Math.abs(edgeX - x) / rampLen, 0, 1);
        const top = Phaser.Math.Linear(deckSurfaceY, this.getTerrainHeight(edgeX), t);
        const bottom = Math.max(this.getTerrainHeight(x) + 10, top + 22);
        g.lineTo(x, bottom);
      }
      g.closePath();
      g.fillPath();

      g.lineStyle(2, 0x0b0b0b, 0.55);
      g.beginPath();
      for (let x = xA; x <= xB; x += rampW) {
        const t = Phaser.Math.Clamp(Math.abs(edgeX - x) / rampLen, 0, 1);
        const top = Phaser.Math.Linear(deckSurfaceY, this.getTerrainHeight(edgeX), t);
        if (x === xA) g.moveTo(x, top);
        else g.lineTo(x, top);
      }
      g.strokePath();
    };

    drawRamp(lake.x0 - rampLen, lake.x0, lake.x0);
    drawRamp(lake.x1, lake.x1 + rampLen, lake.x1);
  }

  private refreshLakesAfterTerrainChange() {
    for (const l of this.lakes) this.redrawLake(l);
  }

  private applyBridgeExplosionDamage(x: number, y: number, impactRadius: number, shellType: ShellType) {
    let base = 0;
    if (shellType === ShellType.MORTAR) base = 140;
    else if (shellType === ShellType.HE) base = 95;
    else if (shellType === ShellType.AP) base = 180;
    else if (shellType === ShellType.STANDARD) base = 60;
    else if (shellType === ShellType.INCENDIARY) base = 35;
    if (base <= 0) return;

    for (const l of this.lakes) {
      let touched = false;
      const underwater = y > l.waterY + 12;
      for (let i = 0; i < l.segments.length; i++) {
        const seg = l.segments[i];
        if (seg.health <= 0) continue;
        const d = Phaser.Math.Distance.Between(x, y, seg.rect.x, seg.rect.y);
        const r = impactRadius + seg.rect.width * 0.65;
        if (d > r) continue;
        const k = 1 - Phaser.Math.Clamp(d / r, 0, 1);
        const dmg = base * (0.35 + k * 0.85);
        seg.health -= dmg;
        touched = true;
        if (seg.health <= 0) {
          this.collapseBridgeSegment(l, i, x, y, dmg);
        } else {
          seg.rect.setAlpha(Phaser.Math.Clamp(0.35 + (seg.health / seg.maxHealth) * 0.65, 0.35, 1));
          seg.rect.setFillStyle(seg.health > seg.maxHealth * 0.4 ? 0x5a5a5a : 0x5a2a2a, 1);
        }
      }
      if (touched) {
        this.checkBridgeStability(l);
        this.syncBrickBridge(l, this.time.now);
      }
    }
  }

  private playBridgeCollapseSfxAt(x: number, y: number) {
    this.audio.playFolder('environment/forest/point_3d/static/buildings/default/partial_collapse/sfx', {
      worldX: x,
      worldY: y,
      volume: 0.88,
      cooldownMs: 0,
      trackPosition: true
    });
  }

  private collapseBridgeSegment(
    lake: (typeof this.lakes)[number],
    segIdx: number,
    srcX: number,
    srcY: number,
    strength: number
  ): boolean {
    const seg = lake.segments[segIdx];
    if (!seg || seg.health <= 0) return false;

    seg.health = 0;
    seg.rect.setVisible(false).setActive(false);

    if (seg.playerCollider) {
      try { seg.playerCollider.destroy(); } catch {}
      seg.playerCollider = null;
    }
    if (seg.enemyCollider) {
      try { seg.enemyCollider.destroy(); } catch {}
      seg.enemyCollider = null;
    }

    const body = seg.rect.body as Phaser.Physics.Arcade.StaticBody | undefined;
    if (body) {
      try {
        const anyBody = body as any;
        if (typeof anyBody.setEnable === 'function') anyBody.setEnable(false);
        else anyBody.enable = false;
        anyBody.checkCollision.none = true;
      } catch {}
      body.updateFromGameObject();
    }

    this.playBridgeCollapseSfxAt(seg.rect.x, seg.rect.y);
    this.detachBridgeBricks(lake, segIdx, srcX, srcY, strength);
    this.particles.createWaterSplash(seg.rect.x, lake.waterY + 2, 900);
    return true;
  }

  private checkBridgeStability(lake: (typeof this.lakes)[number]) {
    const count = lake.segments.length;
    if (count <= 0) return;

    const alive = lake.segments.map(seg => seg.health > 0 && seg.rect.active && seg.rect.visible);
    const supported = new Array<boolean>(count).fill(false);
    const queue: number[] = [];
    let qHead = 0;

    // A bridge segment is considered terrain-supported only if nearby ground is still close
    // to deck height. This prevents floating "internal lane" segments when abutments are destroyed.
    const supportLimitY = lake.bridgeY + 28;
    const hasTerrainSupport = (idx: number): boolean => {
      if (idx < 0 || idx >= count || !alive[idx]) return false;
      const seg = lake.segments[idx];
      const halfW = seg.rect.width * 0.5;
      const sampleL = this.getTerrainHeight(seg.rect.x - halfW * 0.9);
      const sampleC = this.getTerrainHeight(seg.rect.x);
      const sampleR = this.getTerrainHeight(seg.rect.x + halfW * 0.9);
      const nearestGround = Math.min(sampleL, sampleC, sampleR);
      return nearestGround <= supportLimitY;
    };

    const markRoot = (idx: number) => {
      if (idx < 0 || idx >= count) return;
      if (!alive[idx] || supported[idx]) return;
      supported[idx] = true;
      queue.push(idx);
    };

    // Root candidates are limited to edge-adjacent segments that still have real terrain support.
    const edgeDepth = Math.min(2, Math.max(0, count - 1));
    for (let i = 0; i <= edgeDepth; i++) {
      if (hasTerrainSupport(i)) markRoot(i);
      const ri = count - 1 - i;
      if (hasTerrainSupport(ri)) markRoot(ri);
    }

    while (qHead < queue.length) {
      const idx = queue[qHead++];
      const left = idx - 1;
      const right = idx + 1;
      if (left >= 0 && alive[left] && !supported[left]) {
        supported[left] = true;
        queue.push(left);
      }
      if (right < count && alive[right] && !supported[right]) {
        supported[right] = true;
        queue.push(right);
      }
    }

    let changed = false;
    for (let i = 0; i < count; i++) {
      if (!alive[i] || supported[i]) continue;
      const seg = lake.segments[i];
      if (this.collapseBridgeSegment(lake, i, seg.rect.x, seg.rect.y, 110)) changed = true;
    }

    if (changed) this.syncBrickBridge(lake, this.time.now);
  }

  private detachBridgeBricks(lake: (typeof this.lakes)[number], segIdx: number, srcX: number, srcY: number, strength: number) {
    const bricks = lake.bridgeBricksBySeg[segIdx];
    if (!bricks || bricks.length === 0) return;
    lake.bridgeBricksBySeg[segIdx] = [];

    const baseKick = Phaser.Math.Clamp(strength * 2.4, 140, 920);
    for (const b of bricks) {
      if (!b?.active) continue;
      lake.bridgeContainer.remove(b);

      if (!(b as any).body) this.physics.add.existing(b);
      const body = (b as any).body as Phaser.Physics.Arcade.Body | undefined;
      if (!body) continue;
      body.setEnable(true);
      body.setAllowGravity(true);
      body.setImmovable(false);
      body.setBounce(0.08, 0.03);
      body.setDrag(180, 0);

      const dx = b.x - srcX;
      const dy = b.y - srcY;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const nx = dx / dist;
      const ny = dy / dist;
      const kick = baseKick * (0.6 + Math.random() * 0.7);
      body.setVelocity(nx * kick + Phaser.Math.Between(-120, 120), ny * kick - Phaser.Math.Between(160, 520));
      body.setAngularVelocity(Phaser.Math.Between(-700, 700));

      b.setDepth(34).setVisible(true).setAlpha(0.95).setActive(true);
      this.debrisGroup.add(b);
      this.tweens.add({ targets: b, alpha: 0, delay: 60000, duration: 5000, onComplete: () => b.destroy() });
    }
  }

  public checkBridgeShellHit(bounds: Phaser.Geom.Rectangle, travelLine: Phaser.Geom.Line): boolean {
    for (const l of this.lakes) {
      for (const seg of l.segments) {
        if (!seg.rect.active || !seg.rect.visible) continue;
        const b = seg.rect.getBounds();
        if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, b) || Phaser.Geom.Intersects.LineToRectangle(travelLine, b)) return true;
      }
    }
    return false;
  }

  private updateLakeVisuals(time: number) {
    const camX = this.cameras.main.scrollX;
    const viewL = camX - 1000;
    const viewR = camX + 2500;
    for (const l of this.lakes) {
      const midX = (l.x0 + l.x1) * 0.5;
      if (l.loopId) {
        const hasLoop = (this.audio as any)['loops']?.has?.(l.loopId) === true;
        if (!hasLoop) l.loopId = undefined;
      }

      if (!l.loopId) {
        l.loopId = `lake_loop_${Math.round(midX)}_${Math.round(l.waterY)}`;
      }

      // Use a lake-area style ambience zone (Wwise-style area emitter):
      // nearest point on lake surface + distance attenuation by maxDistance.
      const listenerX = this.player?.chassis?.active ? this.player.chassis.x : (this.cameras.main.scrollX + this.cameras.main.width * 0.5);
      const listenerY = this.player?.chassis?.active ? this.player.chassis.y : (this.cameras.main.scrollY + this.cameras.main.height * 0.5);
      const areaX = Phaser.Math.Clamp(listenerX, l.audioArea.x0, l.audioArea.x1);
      const areaY = Phaser.Math.Clamp(listenerY, l.audioArea.y0, l.audioArea.y1);
      const nearX = Phaser.Math.Clamp(areaX, l.x0, l.x1);
      const nearY = l.waterY + 28;
      const dx = listenerX - nearX;
      const dy = listenerY - nearY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const audible = dist <= l.audioArea.maxDistance * 1.08;

      if (audible) {
        this.audio.startLoop(l.loopId, 'environment/forest/ambient_2d/lake_loop/sfx', {
          volume: 1.05,
          fadeInMs: 180,
          maxDistance: l.audioArea.maxDistance,
          worldX: nearX,
          worldY: nearY,
          trackPosition: true
        }).catch(() => {});
      } else if ((this.audio as any)['loops']?.has?.(l.loopId) === true) {
        this.audio.stopLoop(l.loopId, 260);
      }

      if (l.x1 < viewL || l.x0 > viewR) continue;

      if (time < l.lastVisualT + 80) continue;
      l.lastVisualT = time;
      this.evictEnemiesFromLake(l);
      this.checkBridgeStability(l);
      this.redrawLakeSurface(l, time);
      this.syncBrickBridge(l, time);
    }
  }

  private evictEnemiesFromLake(lake: (typeof this.lakes)[number]) {
    const mid = (lake.x0 + lake.x1) * 0.5;
    const pad = 80;
    for (const e of this.enemies) {
      if (!e?.active) continue;

      if (e instanceof Tank) {
        if (e.isDead) continue;
        if (e.isPlayer) continue;
        const ex = e.chassis.x;
        if (ex < lake.x0 + pad || ex > lake.x1 - pad) continue;
        if (e.chassis.y < lake.waterY + 8) continue;
        const killed = (e.chassis.getData('killedByWater') as boolean | undefined) ?? false;
        if (killed) continue;
        e.chassis.setData('killedByWater', true);
        e.takeDamage(e.maxHp * 2, ShellType.HE);
        continue;
      }

      if (e instanceof LandSubmarine) {
        if ((e.getData('lakeBound') as boolean | undefined) === true) continue;
        const ex = e.x;
        if (ex < lake.x0 + pad || ex > lake.x1 - pad) continue;
        if (e.y < lake.waterY + 8) continue;
        const dir = ex < mid ? -1 : 1;
        const tx = Phaser.Math.Clamp(dir < 0 ? (lake.x0 - 260) : (lake.x1 + 260), 200, this.WORLD_WIDTH - 200);
        e.setPosition(tx, this.getTerrainHeight(tx));
      }
    }
  }

  private redrawLakeSurface(lake: (typeof this.lakes)[number], time: number) {
    const g = lake.surfaceGfx;
    if (!g.active) return;
    g.clear();

    const topY = lake.waterY;
    const step = 70;
    const a = (time * 0.002) + lake.wavePhase;

    g.lineStyle(2, 0xa4e3ff, 0.22);
    g.beginPath();
    g.moveTo(lake.x0, topY + 2);
    for (let x = lake.x0; x <= lake.x1; x += step) {
      const w = Math.sin(x * 0.012 + a) * 2.6 + Math.sin(x * 0.028 + a * 1.7) * 1.3;
      g.lineTo(x, topY + 2 + w);
    }
    if ((lake.x1 - lake.x0) % step !== 0) {
      const x = lake.x1;
      const w = Math.sin(x * 0.012 + a) * 2.6 + Math.sin(x * 0.028 + a * 1.7) * 1.3;
      g.lineTo(x, topY + 2 + w);
    }
    g.strokePath();

    g.lineStyle(1, 0xd6f4ff, 0.18);
    g.beginPath();
    g.moveTo(lake.x0, topY + 9);
    for (let x = lake.x0; x <= lake.x1; x += step) {
      const w = Math.sin(x * 0.010 + a * 1.15) * 1.8 + Math.sin(x * 0.022 + a * 1.9) * 1.1;
      g.lineTo(x, topY + 9 + w);
    }
    if ((lake.x1 - lake.x0) % step !== 0) {
      const x = lake.x1;
      const w = Math.sin(x * 0.010 + a * 1.15) * 1.8 + Math.sin(x * 0.022 + a * 1.9) * 1.1;
      g.lineTo(x, topY + 9 + w);
    }
    g.strokePath();

    // Lily Pads (Floating vegetation)
    g.fillStyle(0x2f7f3a, 0.85);
    for (let x = lake.x0 + 20; x < lake.x1 - 20; x += 140) {
        if (Math.random() > 0.4) continue;
        const ly = topY + 2;
        const lx = x + Math.sin(time * 0.0005 + x) * 10;
        g.fillEllipse(lx, ly, 16, 6);
        // Small flower on lily pad
        if (Math.random() < 0.3) {
            g.fillStyle(Math.random() > 0.5 ? 0xffffff : 0xffcc00, 0.9);
            g.fillCircle(lx, ly - 2, 3);
        }
        g.fillStyle(0x2f7f3a, 0.85); // Reset color
    }

    // Bubbles
    g.fillStyle(0xffffff, 0.25);
    const bubbleSpacing = 120; // Increased spacing (less frequent)
    for (let bx = lake.x0 + 15; bx < lake.x1 - 15; bx += bubbleSpacing) {
       // Random offset to break grid
       const offset = (bx * 13.12) % 60;
       const actualBx = bx + offset;
       
       const rand = Math.sin(actualBx * 12.9898); 
       // Only spawn bubbles occasionally
       if (Math.abs(rand) < 0.3) continue;

       const speed = 0.03 + Math.abs(rand) * 0.04;
       const depth = 60 + Math.abs(rand) * 60;
       const rise = (time * speed) % depth; 
       const by = topY + depth - rise; 
       
       if (by > topY + 4) {
          const wobbly = Math.sin(time * 0.008 + actualBx) * 3;
          // Larger bubbles (2.5 - 5.5 radius)
          g.fillCircle(actualBx + wobbly, by, 2.5 + Math.abs(rand) * 3);
          // Highlight
          g.fillStyle(0xffffff, 0.4);
          g.fillCircle(actualBx + wobbly - 1, by - 1, 1);
          g.fillStyle(0xffffff, 0.25);
       }
    }

    g.lineStyle(4, 0x000000, 0.045);
    for (const seg of lake.segments) {
      if (!seg.rect.active || !seg.rect.visible || seg.health <= 0) continue;
      const w = seg.rect.width * 0.6;
      g.lineBetween(seg.rect.x - w, topY + 4, seg.rect.x + w, topY + 4);
    }

    const glintCount = 5;
    for (let i = 0; i < glintCount; i++) {
      const px = Phaser.Math.Linear(lake.x0 + 80, lake.x1 - 80, ((i * 0.27) + (a * 0.07)) % 1);
      const t = (Math.sin(a * 1.9 + i * 3.1) + 1) * 0.5;
      const len = 55 + t * 120;
      g.lineStyle(2, 0xe7fbff, 0.06 + t * 0.10);
      g.lineBetween(px - len * 0.5, topY + 6, px + len * 0.5, topY + 6);
    }
  }

  private buildBrickBridge(lake: (typeof this.lakes)[number]) {
    const container = lake.bridgeContainer;
    container.removeAll(true);
    lake.bridgeBricksBySeg = lake.segments.map(() => []);

    const brickKey = 'brick_concrete';
    const brickSize = 20;
    const span = Math.max(1, lake.x1 - lake.x0);
    const mid = (lake.x0 + lake.x1) * 0.5;
    const half = span * 0.5;

    const deckTopY = lake.bridgeY - 52;
    const base = 34;
    const maxBottom = Math.min(lake.waterY + 240, lake.bridgeY + 520);
    const archHeight = Phaser.Math.Clamp(maxBottom - (lake.bridgeY + base), 260, 460);
    const concreteTints = [0xe8e8e8, 0xdcdcdc, 0xd2d2d2, 0xc7c7c7, 0xbdbdbd, 0xb3b3b3];
    const shadowTints = [0xb0b0b0, 0xa6a6a6, 0x9a9a9a, 0x8f8f8f];
    const deckTints = [0xf2f2f2, 0xeaeaea, 0xe2e2e2, 0xdcdcdc, 0xd6d6d6];

    for (let x = lake.x0 + 10; x <= lake.x1 - 10; x += brickSize) {
      const segIdx = Phaser.Math.Clamp(Math.floor((x - lake.x0) / 140), 0, lake.segments.length - 1);
      const t = Phaser.Math.Clamp((x - mid) / Math.max(1, half), -0.999, 0.999);
      const underside = maxBottom - archHeight * Math.sqrt(1 - t * t);

      for (let y = deckTopY; y <= underside; y += brickSize) {
        const b = this.add.sprite(x, y, brickKey);
        b.setScale(1);
        const nearUnderside = y > underside - brickSize * 2.2;
        const pal = nearUnderside ? shadowTints : concreteTints;
        b.setTint(pal[Phaser.Math.Between(0, pal.length - 1)]);
        b.setAlpha(0.96);
        container.add(b);
        lake.bridgeBricksBySeg[segIdx].push(b);
      }
    }

    for (let x = lake.x0 + 10; x <= lake.x1 - 10; x += brickSize) {
      const segIdx = Phaser.Math.Clamp(Math.floor((x - lake.x0) / 140), 0, lake.segments.length - 1);
      const b = this.add.sprite(x, deckTopY - 20, brickKey);
      b.setScale(1);
      b.setTint(deckTints[Phaser.Math.Between(0, deckTints.length - 1)]);
      b.setAlpha(0.98);
      container.add(b);
      lake.bridgeBricksBySeg[segIdx].push(b);
    }
  }

  private syncBrickBridge(lake: (typeof this.lakes)[number], time: number) {
    if (time < lake.lastBridgeBrickSyncT + 140) return;
    lake.lastBridgeBrickSyncT = time;
    for (let i = 0; i < lake.segments.length; i++) {
      const seg = lake.segments[i];
      const alive = seg.rect.active && seg.rect.visible && seg.health > 0;
      const r = Phaser.Math.Clamp(seg.health / seg.maxHealth, 0, 1);
      const a = 0.45 + r * 0.55;
      for (const b of lake.bridgeBricksBySeg[i] ?? []) {
        if (!b.active) continue;
        b.setVisible(alive);
        if (alive) b.setAlpha(a);
      }
    }
  }

  private ensureBridgeTerrainRamps(startX: number, endX: number, bridgeY: number) {
    const topY = bridgeY - 16;
    const rampLen = 980;
    const rampIntoLake = 260;

    const step = this.TERRAIN_STEP;
    const maxIdx = this.terrainHeights.length - 1;

    const left0 = Phaser.Math.Clamp(Math.floor((startX - rampLen) / step), 0, maxIdx);
    const left1 = Phaser.Math.Clamp(Math.ceil((startX + rampIntoLake) / step), 0, maxIdx);
    const leftSpan = Math.max(1, left1 - left0);
    const leftY0 = this.terrainHeights[left0] ?? topY;
    for (let i = left0; i <= left1; i++) {
      const t = (i - left0) / leftSpan;
      this.terrainHeights[i] = Phaser.Math.Linear(leftY0, topY, t);
    }

    const right0 = Phaser.Math.Clamp(Math.floor((endX - rampIntoLake) / step), 0, maxIdx);
    const right1 = Phaser.Math.Clamp(Math.ceil((endX + rampLen) / step), 0, maxIdx);
    const rightSpan = Math.max(1, right1 - right0);
    const rightY1 = this.terrainHeights[right1] ?? topY;
    for (let i = right0; i <= right1; i++) {
      const t = (i - right0) / rightSpan;
      this.terrainHeights[i] = Phaser.Math.Linear(topY, rightY1, t);
    }
  }

  private createLakeWithBridge(x0: number, x1: number, force: boolean = false) {
    const start = Phaser.Math.Clamp(Math.min(x0, x1), 500, this.WORLD_WIDTH - 500);
    const end = Phaser.Math.Clamp(Math.max(x0, x1), 500, this.WORLD_WIDTH - 500);
    if (end - start < 900) return;

    if (!force) {
      const safePad = 900;
      const safeL = Math.max(0, start - safePad);
      const safeR = Math.min(this.WORLD_WIDTH, end + safePad);
      for (let x = safeL; x <= safeR; x += 240) {
        if (this.isInSafeZone(x)) return;
      }
    }

    const pad = 600;
    for (const s of this.streams) {
      if (Math.max(start - pad, s.x0) <= Math.min(end + pad, s.x1)) return;
    }
    for (const l of this.lakes) {
      if (Math.max(start - pad, l.x0) <= Math.min(end + pad, l.x1)) return;
    }

    const startIdx = Math.max(0, Math.floor(start / this.TERRAIN_STEP));
    const endIdx = Math.min(this.terrainHeights.length - 1, Math.ceil(end / this.TERRAIN_STEP));
    const span = Math.max(1, endIdx - startIdx);
    const leftEdge = this.baseHeights[startIdx] ?? this.terrainHeights[startIdx];
    const rightEdge = this.baseHeights[endIdx] ?? this.terrainHeights[endIdx];
    const rimY = Math.min(leftEdge, rightEdge);
    const waterY = Math.min(rimY + 55, this.bedrockY - 320);
    for (let i = startIdx; i <= endIdx; i++) {
      const t = Math.abs(((i - startIdx) / span) - 0.5) * 2;
      const profile = 1 - Math.pow(t, 2);
      const floor = waterY + 240 + profile * 520;
      this.terrainHeights[i] = Math.min(Math.max(this.terrainHeights[i], floor), this.bedrockY);
    }

    const gfx = this.add.graphics().setDepth(26).setAlpha(1);
    const surfaceGfx = this.add.graphics().setDepth(27).setAlpha(1);
    const bridgeContainer = this.add.container(0, 0).setDepth(28).setAlpha(1);

    const bridgeY = Math.min(waterY - 70, rimY - 18);
    this.ensureBridgeTerrainRamps(start, end, bridgeY);
    this.drawTerrain();
    this.updateTerrainPhysics();
    this.refreshStreamsAfterTerrainChange();
    this.snapVegetationToTerrainInRange(start - 200, end + 200);

    const segments: {
      rect: Phaser.GameObjects.Rectangle;
      health: number;
      maxHealth: number;
      playerCollider?: Phaser.Physics.Arcade.Collider | null;
      enemyCollider?: Phaser.Physics.Arcade.Collider | null;
    }[] = [];
    const segW = 140;
    const segH = 32;
    for (let x = start; x < end; x += segW) {
      const w = Math.min(segW, end - x);
      const cx = x + (Math.min(segW, end - x)) * 0.5;
      const rect = this.add.rectangle(cx, bridgeY, w, segH, 0x000000, 0).setDepth(27).setAlpha(0);
      this.physics.add.existing(rect, true);
      const enemyCollider = this.physics.add.collider(this.enemiesGroup, rect);
      segments.push({ rect, health: 50, maxHealth: 50, playerCollider: null, enemyCollider });
    }

    const worldBottom = this.physics.world.bounds.bottom;
    const zoneH = Math.max(900, (worldBottom - waterY) + 900);
    const waterZone = this.add.rectangle((start + end) * 0.5, waterY + zoneH * 0.5, end - start, zoneH, 0, 0).setVisible(false);
    this.physics.add.existing(waterZone, true);
    this.physics.add.overlap(this.enemiesGroup, waterZone, (obj: any) => {
      const ref = obj?.getData?.('tankRef');
      if (ref?.active && !ref.isDead && typeof ref.takeDamage === 'function') {
        if ((ref as any).chassis?.y < waterY + 12) return;
        const ch = (ref as any).chassis as Phaser.Physics.Arcade.Sprite | undefined;
        if (ref instanceof Tank && !ref.isPlayer) {
          const killed = (ch?.getData('killedByWater') as boolean | undefined) ?? false;
          if (!killed && ch) {
            ch.setData('killedByWater', true);
            ref.takeDamage(ref.maxHp * 2, ShellType.HE);
          }
          return;
        }
        return;
      }
      if (obj?.active && typeof obj.takeDamage === 'function' && typeof obj.getData === 'function' && typeof obj.setData === 'function') {
        if (typeof obj.y === 'number' && obj.y < waterY + 12) return;
        const now = this.time.now;
        const last = (obj.getData('lastLakeDamageT') as number | undefined) ?? 0;
        if (now > last + 250) {
          obj.setData('lastLakeDamageT', now);
          obj.takeDamage((obj.maxHp ?? 200) * 0.0075, ShellType.HE);
        }
        return;
      }
      if (obj?.active && typeof obj.destroy === 'function') obj.destroy();
    });

    const audioArea = {
      x0: start - 880,
      x1: end + 880,
      y0: waterY - 520,
      y1: waterY + 720,
      maxDistance: Phaser.Math.Clamp((end - start) * 0.42 + 900, 1400, 3000)
    };

    const lake = {
      x0: start,
      x1: end,
      gfx,
      surfaceGfx,
      bridgeContainer,
      bridgeBricksBySeg: [] as Phaser.GameObjects.Sprite[][],
      waterY,
      bridgeY,
      segments,
      waterZone,
      playerWaterOverlap: null,
      audioArea,
      wavePhase: Math.random() * 1000,
      lastVisualT: 0,
      lastBridgeBrickSyncT: 0
    };
    this.lakes.push(lake);
    this.bindPlayerToLake(lake);
    this.redrawLake(lake);
    this.redrawLakeSurface(lake, this.time.now);
    this.buildBrickBridge(lake);
    this.syncBrickBridge(lake, this.time.now);

    const bridgeSpawnX = Phaser.Math.Between(lake.x0 + 240, lake.x1 - 240);
    const enemyTypes = [TankType.ENEMY_TIGER, TankType.ENEMY_PANZER, TankType.ENEMY_STUG, TankType.ENEMY_A7V, TankType.ENEMY_LUCHS, TankType.ENEMY_MAUS];
    const bridgeEnemyType = enemyTypes[Math.floor(Math.random() * enemyTypes.length)];
    const bridgeEnemyScale = Tank.getScaleFor(bridgeEnemyType, false);
    const bridgeEnemyY = this.getGroundHeight(bridgeSpawnX) - 150 * bridgeEnemyScale;
    const bridgeEnemy = new Tank(this, bridgeSpawnX, bridgeEnemyY, bridgeEnemyType);
    bridgeEnemy.chassis.setData('tankRef', bridgeEnemy);
    this.enemies.push(bridgeEnemy);
    this.enemiesGroup.add(bridgeEnemy.chassis);

    this.spawnLakeLife(lake);

    const subX = Phaser.Math.Between(lake.x0 + 260, lake.x1 - 260);
    const sub = new LandSubmarine(this, subX, lake.waterY + 260, { mode: 'LAKE', lake: { x0: lake.x0, x1: lake.x1, waterY: lake.waterY } });
    this.enemies.push(sub);
    this.physics.add.overlap(this.mineGroup, sub, (mineObj: any, enemyObj: any) => this.handleMineTrigger(mineObj, enemyObj));
  }

  private bindPlayerToLake(lake: (typeof this.lakes)[number]) {
    const playerChassis = this.player?.chassis;
    if (!playerChassis?.active || !lake?.waterZone?.active) return;

    for (const seg of lake.segments) {
      if (!seg?.rect?.active) continue;
      if (seg.playerCollider) continue;
      seg.playerCollider = this.physics.add.collider(playerChassis, seg.rect);
    }

    if (!lake.playerWaterOverlap) {
      lake.playerWaterOverlap = this.physics.add.overlap(playerChassis, lake.waterZone, () => {
        if (!this.player?.active || this.player.isDead || !this.player.chassis?.active) return;
        if (this.player.chassis.y < lake.waterY + 12) return;
        const now = this.time.now;
        const last = (this.player.chassis.getData('lastLakeDamageT') as number | undefined) ?? 0;
        if (now > last + 250) {
          this.player.chassis.setData('lastLakeDamageT', now);
          this.player.takeDamage(this.player.maxHp * 0.0075, ShellType.HE);
        }
      });
    }
  }

  private pruneVeryDistantDormantObjects() {
    const px = this.player?.chassis?.active ? this.player.chassis.x : Number.NaN;
    if (!Number.isFinite(px)) return;

    // Keep a wide safety band. Only prune objects that are already dormant.
    const keepLeft = Math.max(0, px - 14000);
    const keepRight = Math.min(this.WORLD_WIDTH, px + 10000);

    const pruneDormantGroup = (group: Phaser.GameObjects.Group | Phaser.Physics.Arcade.Group | Phaser.Physics.Arcade.StaticGroup | undefined) => {
      const children = group?.getChildren?.() as any[] | undefined;
      if (!Array.isArray(children) || children.length <= 0) return;
      for (let i = children.length - 1; i >= 0; i--) {
        const o = children[i];
        if (!o || o.active) continue;
        const x = typeof o.x === 'number' ? o.x : Number.NaN;
        if (!Number.isFinite(x)) continue;
        if (x >= keepLeft && x <= keepRight) continue;
        try { o.destroy(); } catch {}
      }
    };

    pruneDormantGroup(this.vegetationGroup as any);
    pruneDormantGroup(this.treeGroup as any);
    pruneDormantGroup(this.faunaGroup as any);

    const debris = this.debrisGroup?.getChildren?.() as any[] | undefined;
    if (Array.isArray(debris) && debris.length > 0) {
      for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i];
        if (!d || d.active) continue;
        const x = typeof d.x === 'number' ? d.x : Number.NaN;
        if (!Number.isFinite(x) || (x >= keepLeft && x <= keepRight)) continue;
        const hibernating = d.getData?.('hibernating') === true || d.getData?.('sleeping') === true;
        if (!hibernating) continue;
        try { d.destroy(); } catch {}
      }
    }

    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      if (!a || !a.active) this.animals.splice(i, 1);
    }
  }

  private spawnLakeLife(lake: (typeof this.lakes)[number]) {
    const span = lake.x1 - lake.x0;
    if (span < 600) return;

    const fishCount = Phaser.Math.Clamp(Math.floor(span / 260) * 3, 18, 54);
    const fishKeys = ['lake_fish', 'lake_fish_orange', 'lake_fish_green', 'lake_fish_red'];
    for (let i = 0; i < fishCount; i++) {
      const x = Phaser.Math.Between(lake.x0 + 130, lake.x1 - 130);
      const y = lake.waterY + Phaser.Math.Between(52, 220);
      const dir = Math.random() > 0.5 ? 1 : -1;
      const key = fishKeys[Phaser.Math.Between(0, fishKeys.length - 1)];
      const fish = this.add.sprite(x, y, key).setDepth(26.6).setAlpha(0.72);
      fish.setScale(0.9 + Math.random() * 0.7);
      fish.setFlipX(dir < 0);
      fish.setData('isFish', true);
      fish.setData('lakeX0', lake.x0);
      fish.setData('lakeX1', lake.x1);
      fish.setData('waterY', lake.waterY);
      fish.setData('dir', dir);
      fish.setData('speed', 14 + Math.random() * 26);
      fish.setData('baseY', y);
      fish.setData('phase', Math.random() * Math.PI * 2);
      this.faunaGroup.add(fish);
    }

    const lilyCount = Phaser.Math.Clamp(Math.floor(span / 240), 8, 26);
    for (let i = 0; i < lilyCount; i++) {
      const edgeBias = Math.random() > 0.55 ? 0 : 1;
      const x = edgeBias === 0
        ? Phaser.Math.Between(lake.x0 + 60, lake.x0 + Math.min(420, span * 0.32))
        : Phaser.Math.Between(lake.x1 - Math.min(420, span * 0.32), lake.x1 - 60);
      const y = lake.waterY + Phaser.Math.Between(6, 20);
      const lily = this.add.sprite(x, y, 'water_lily').setDepth(26.92).setAlpha(0.72);
      lily.setScale(0.75 + Math.random() * 0.75);
      lily.setAngle(Phaser.Math.Between(-18, 18));
      lily.setData('isWaterPlant', true);
      lily.setData('baseY', y);
      lily.setData('phase', Math.random() * Math.PI * 2);
      this.vegetationGroup.add(lily);
    }

    const reedCount = Phaser.Math.Clamp(Math.floor(span / 520), 2, 8);
    for (let i = 0; i < reedCount; i++) {
      const x = Math.random() > 0.5 ? Phaser.Math.Between(lake.x0 + 35, lake.x0 + 110) : Phaser.Math.Between(lake.x1 - 110, lake.x1 - 35);
      const y = lake.waterY + Phaser.Math.Between(14, 36);
      const reed = this.add.sprite(x, y, 'water_reed').setDepth(26.88).setAlpha(0.62);
      reed.setScale(0.85 + Math.random() * 0.6);
      reed.setData('isWaterPlant', true);
      reed.setData('baseY', y);
      reed.setData('phase', Math.random() * Math.PI * 2);
      this.vegetationGroup.add(reed);
    }

    const seaweedCount = Phaser.Math.Clamp(Math.floor(span / 210), 10, 40);
    for (let i = 0; i < seaweedCount; i++) {
      const x = Phaser.Math.Between(lake.x0 + 90, lake.x1 - 90);
      const floorY = this.getTerrainHeight(x);
      const y = floorY + Phaser.Math.Between(-10, 12);
      if (y <= lake.waterY + 80) continue;
      const weed = this.add.sprite(x, y, 'water_seaweed').setDepth(26.25).setAlpha(0.45);
      weed.setOrigin(0.5, 1);
      weed.setScale(0.65 + Math.random() * 0.9);
      weed.setFlipX(Math.random() > 0.5);
      weed.setData('isWaterPlant', true);
      weed.setData('baseY', y);
      weed.setData('phase', Math.random() * Math.PI * 2);
      this.vegetationGroup.add(weed);
    }
  }

  private planForestLakeBridge() {
    if (this.mapId !== 'forest' || this.testRoomEnabled) {
      this.forestLakeBridgePlan = null;
      return;
    }

    const maxEnd = Math.min(this.WORLD_WIDTH - 900, 11800);
    for (let i = 0; i < 18; i++) {
      const start = Phaser.Math.Between(3800, 9500);
      const end = Phaser.Math.Clamp(start + Phaser.Math.Between(2000, 3400), start + 900, maxEnd);
      if (end - start < 900) continue;
      if (this.isInSafeZone(start) || this.isInSafeZone(end)) continue;
      this.forestLakeBridgePlan = { start, end };
      return;
    }

    this.forestLakeBridgeWantedThisRun = false;
    this.forestLakeBridgePlan = null;
  }

  private pickWeightedTankType(entries: { type: TankType; weight: number }[], fallback: TankType = TankType.ENEMY_PANZER): TankType {
    let total = 0;
    for (let i = 0; i < entries.length; i++) total += Math.max(0, entries[i].weight);
    if (!(total > 0)) return fallback;
    let roll = Math.random() * total;
    for (let i = 0; i < entries.length; i++) {
      roll -= Math.max(0, entries[i].weight);
      if (roll <= 0) return entries[i].type;
    }
    return entries[entries.length - 1]?.type ?? fallback;
  }

  private pickDesertTankTypeForX(worldX: number): TankType {
    const sec = this.getDesertSectionAtX(worldX);
    const pressure = sec ? Phaser.Math.Clamp(sec.enemyPressure, 0, 1) : 0.55;
    const lowHpBias = sec ? Phaser.Math.Clamp(sec.lowHpBias, 0, 1) : 0.72;
    const synth = sec ? Phaser.Math.Clamp(sec.synthDrive, 0, 1) : 0.45;
    const weights = [
      { type: TankType.ENEMY_LUCHS, weight: 3.4 + lowHpBias * 3.2 + pressure * 0.8 },
      { type: TankType.ENEMY_PANZER, weight: 3.1 + lowHpBias * 2.9 + pressure * 0.9 },
      { type: TankType.ENEMY_STUG, weight: 1.6 + lowHpBias * 1.4 + pressure * 0.6 },
      { type: TankType.ENEMY_TUMBLEWEED, weight: 1.2 + lowHpBias * 0.7 + synth * 1.1 },
      { type: TankType.ENEMY_TIGER, weight: 0.5 + pressure * 0.9 },
      { type: TankType.ENEMY_A7V, weight: 0.34 + pressure * 0.5 },
      { type: TankType.ENEMY_MAUS, weight: 0.08 + pressure * 0.2 }
    ];
    return this.pickWeightedTankType(weights, TankType.ENEMY_PANZER);
  }

  private spawnContentInRange(fromX: number, toX: number) {
    const baseTankTypes = [TankType.ENEMY_TIGER, TankType.ENEMY_PANZER, TankType.ENEMY_STUG, TankType.ENEMY_A7V, TankType.ENEMY_LUCHS, TankType.ENEMY_MAUS];

    if (this.mapId === 'forest' && this.forestLakeBridgeWantedThisRun && !this.forestLakeBridgeSpawnedThisRun && this.forestLakeBridgePlan) {
      const { start, end } = this.forestLakeBridgePlan;
      const shouldTry = start >= fromX && start < toX;
      if (shouldTry) {
        const before = this.lakes.length;
        this.createLakeWithBridge(start, end, false);
        if (this.lakes.length > before) {
          this.forestLakeBridgeSpawnedThisRun = true;
          this.forestLakeBridgePlan = null;
        }
      }
    }

    if (this.mapId === 'forest' && !this.preFinalSafeZoneWreckFieldSpawned) {
      const penultimate = this.getPenultimateSafeZoneBounds();
      if (penultimate.x0 < toX && penultimate.x1 > fromX) {
        this.createPreFinalSafeZoneWreckField();
      }
    }

    const isNearBridge = (x: number): boolean => {
      const pad = 1250;
      for (const l of this.lakes) {
        if (x >= l.x0 - pad && x <= l.x1 + pad) return true;
      }
      return false;
    };
    const findDryX = (x: number, preferDir: number): number | null => {
      const step = 180;
      for (let i = 0; i <= 22; i++) {
        const a = x + preferDir * i * step;
        if (!this.isWaterAt(a) && !this.isSwampAt(a)) return a;
        const b = x - preferDir * i * step;
        if (!this.isWaterAt(b) && !this.isSwampAt(b)) return b;
      }
      return null;
    };

    for (let x = fromX; x < toX; x += 30) {
      const h = this.getTerrainHeight(x);
      const rand = Math.random();
      const safe = this.isInSafeZone(x);
      const forestBand = (Math.sin(x * 0.00115) + Math.sin(x * 0.00043 + 12.34)) * 0.5;
      const isForest = this.mapId !== 'desert' && forestBand > 0.35;
      const desertSection = this.mapId === 'desert' ? this.getDesertSectionAtX(x) : null;
      const desertEnemyPressure = desertSection ? Phaser.Math.Clamp(desertSection.enemyPressure, 0, 1) : 0.55;
      const desertVegetation = desertSection ? Phaser.Math.Clamp(desertSection.vegetationDensity, 0, 1) : 0.5;
      const desertSynthDrive = desertSection ? Phaser.Math.Clamp(desertSection.synthDrive, 0, 1) : 0.45;

      if (safe) {
          if (x % 2000 < 30) {
              const poleX = x + 100;
              const groundY = this.getTerrainHeight(poleX);
              const embed = 520;
              const above = 520;
              const pole = this.add.rectangle(poleX, groundY + embed, 5, embed + above, 0x333333).setOrigin(0.5, 1).setDepth(24);
              const topY = pole.y - (embed + above);
              const flag = this.createClothFlag(pole.x, topY + 42);
              this.createBaseRepairStation(pole, flag);
          }
          continue;
      }

    if (this.mapId === 'desert') {
        const lakeGate = Phaser.Math.Linear(0.30, 0.18, desertEnemyPressure);
        if (x % 5500 < 30 && x > 8000 && !safe && Math.random() > lakeGate) {
          const start = x + Phaser.Math.Between(800, 1400);
          const end = start + Phaser.Math.Between(2000, 3400);
          this.createLakeWithBridge(start, end);
        }
      }

      if (this.mapId === 'desert') {
          // Desert Vegetation
           const vegChance = Phaser.Math.Clamp(Phaser.Math.Linear(0.11, 0.28, desertVegetation), 0.08, 0.32);
           if (!this.isWaterAt(x) && rand < vegChance && x > 400 && !safe) {
              const makeOne = (sx: number) => {
                if (this.isWaterAt(sx)) return;
                const sh = this.getTerrainHeight(sx);
                const cactusChance = Phaser.Math.Linear(0.14, 0.5, desertSynthDrive);
                const asset = Math.random() < cactusChance ? 'veg_cactus' : 'veg_grass';
                const veg = this.add.sprite(sx, sh, asset)
                  .setOrigin(0.5, 1)
                  .setDepth(14 + Math.random() * 0.08)
                  .setTint(0xcccccc);
                if (asset === 'veg_grass') {
                  veg.setTint(0xc2b280);
                  veg.setScale(0.62 + Math.random() * 0.50);
                  veg.setAlpha(0.85);
                } else {
                  veg.setScale(0.85 + Math.random() * 0.60);
                  veg.setAlpha(0.92);
                }
                this.vegetationGroup.add(veg);
                veg.setData('originalAngle', 0);
                if (asset === 'veg_cactus' && Math.random() < 0.25) veg.setData('birdTrigger', true);
              };

              makeOne(x);
              const clusterChanceA = Phaser.Math.Linear(0.03, 0.18, desertVegetation);
              const clusterChanceB = Phaser.Math.Linear(0.01, 0.08, desertVegetation);
              if (rand < clusterChanceA) makeOne(x + Phaser.Math.Between(-22, 22));
              if (rand < clusterChanceB) makeOne(x + Phaser.Math.Between(-34, 34));
           }
      } else {
          // Forest Vegetation
          const burnIdx = Math.floor(x / this.TERRAIN_STEP);
          const burn = this.terrainBurn[burnIdx] ?? 0;
          const baseChance = isForest ? 0.75 : 0.45; // Increased from 0.46/0.34
          if (!this.isWaterAt(x) && burn < 0.30 && rand < baseChance) {
              const makeOne = (sx: number, forceLow: boolean) => {
                if (this.isWaterAt(sx)) return;
                const sh = this.getTerrainHeight(sx);
                const r = Math.random();
                const treeish = isForest && !forceLow && r < 0.18; 
                
                let asset = 'veg_grass';
                if (treeish) {
                    if (r < 0.09) {
                        // Randomize tree variant
                        const vars = ['veg_tree_0', 'veg_tree_1', 'veg_tree_2'];
                        asset = vars[Math.floor(Math.random() * vars.length)];
                    } else {
                        asset = 'veg_pine';
                    }
                } else {
                    asset = (r < 0.44 ? 'veg_grass' :
                      (r < 0.72 ? 'veg_flower_p' :
                      (r < 0.94 ? 'veg_flower_y' : 'veg_grass')));
                }
                
                const veg = this.add.sprite(sx, sh, asset)
                  .setOrigin(0.5, 1)
                  .setDepth(14 + Math.random() * 0.14)
                  .setTint(0xf6f6f6);
                if (asset.startsWith('veg_tree') || asset === 'veg_pine') {
                  veg.setScale(0.86 + Math.random() * 0.42);
                  veg.setAlpha(0.95);
                } else if (asset === 'veg_grass') {
                  veg.setScale(0.75 + Math.random() * 0.55);
                  veg.setAlpha(0.92);
                } else {
                  veg.setScale(0.78 + Math.random() * 0.55);
                  veg.setAlpha(0.98);
                }
                this.vegetationGroup.add(veg);
                veg.setData('originalAngle', 0);
                if ((asset.startsWith('veg_tree') || asset === 'veg_pine') && Math.random() < 0.25) veg.setData('birdTrigger', true);
              };

              makeOne(x, false);
              if (rand < 0.45) makeOne(x + Phaser.Math.Between(-20, 20), true); // Increased from 0.18
              if (rand < 0.25) makeOne(x + Phaser.Math.Between(-34, 34), true); // Increased from 0.08
          }
      }
      
      // Animals
      if (this.mapId !== 'desert') {
          if (Math.random() < 0.0135 && !safe && isForest) {
            const roll = Math.random();
            const type =
              roll < 0.36 ? 'rabbit' :
              roll < 0.58 ? 'fox' :
              roll < 0.76 ? 'boar' :
              roll < 0.9 ? 'elk' :
              'crow';
            const animal = new Animal(this, x, h - 20, type);
            this.animalGroup.add(animal);
            this.animals.push(animal);
          }
      } else {
          const faunaChance = Phaser.Math.Clamp(Phaser.Math.Linear(0.0105, 0.0035, desertEnemyPressure), 0.003, 0.011);
          if (!safe && x > 800 && !this.isWaterAt(x) && !this.isSwampAt(x) && Math.random() < faunaChance) {
            const roll = Math.random();
            const type = roll < 0.45 ? 'scorpion' : 'snake';
            const animal = new Animal(this, x, h - 18, type);
            this.animalGroup.add(animal);
            this.animals.push(animal);
          }
      }

      if (x % 1500 < 30 && !safe && x > 3000) { 
          const blockVehiclesAfterHunterSpawn = this.hunterSpawned && Number.isFinite(this.hunterSpawnX) && x > this.hunterSpawnX;
          const mobile = this.sys.game.device.os.android || this.sys.game.device.os.iOS || this.sys.game.device.input.touch;
          const desertVehicleCap = this.mapId === 'desert' ? (mobile ? 28 : 46) : Number.POSITIVE_INFINITY;
          const desertInfantryCap = this.mapId === 'desert' ? (mobile ? 44 : 68) : Number.POSITIVE_INFINITY;
          const activeVehicleCount = this.mapId === 'desert'
            ? this.enemies.reduce((sum, e) => sum + (e?.active ? 1 : 0), 0)
            : 0;
          const activeEnemyInfantryCount = this.mapId === 'desert'
            ? this.enemyInfantry.soldiers.reduce((sum, s) => sum + (s?.active ? 1 : 0), 0)
            : 0;
          const allowDesertVehicleSpawn = this.mapId !== 'desert' || activeVehicleCount < desertVehicleCap;
          const allowDesertInfantrySpawn = this.mapId !== 'desert' || activeEnemyInfantryCount < desertInfantryCap;
          const buildGate = this.mapId === 'desert'
            ? Phaser.Math.Linear(0.62, 0.2, desertSynthDrive)
            : 0.4;
          if (Math.random() > buildGate) {
            let style = 0;
            if (this.mapId === 'desert') {
                 style = 3; // MIDDLE_EAST
            } else {
                const styleRoll = Math.random();
                if (styleRoll > 0.7) style = 1; 
                else if (styleRoll > 0.4) style = 2; 
                else if (styleRoll > 0.2) style = 3; 
            }
            const bx = findDryX(x, 1);
            if (bx !== null) this.buildings.createBuilding(bx, this.getTerrainHeight(bx), style);
          }
          const vehicleGate = this.mapId === 'desert'
            ? Phaser.Math.Linear(0.68, 0.12, desertEnemyPressure)
            : 0.325;
          if (!blockVehiclesAfterHunterSpawn && allowDesertVehicleSpawn && Math.random() > vehicleGate) {
              const wantX = x + 800;
              const tx = findDryX(wantX, Math.random() > 0.5 ? 1 : -1);
              if (tx === null) {
                if (allowDesertInfantrySpawn) this.enemyInfantry.spawn(x + 500, h);
                continue;
              }
              const tankType = this.mapId === 'desert'
                ? this.pickDesertTankTypeForX(tx)
                : baseTankTypes[Math.floor(Math.random() * baseTankTypes.length)];
              const scale = Tank.getScaleFor(tankType, false);
              const enemy = new Tank(this, tx, this.getGroundHeight(tx) - 150 * scale, tankType);
              enemy.chassis.setData('tankRef', enemy);
              this.enemies.push(enemy);
              this.enemiesGroup.add(enemy.chassis);
          }
          const subGate = this.mapId === 'desert'
            ? Phaser.Math.Linear(0.42, 0.12, desertEnemyPressure)
            : 0.2;
          if (!blockVehiclesAfterHunterSpawn && allowDesertVehicleSpawn && Math.random() > subGate) {
              const wantX = x + 520;
              const cx = findDryX(wantX, Math.random() > 0.5 ? 1 : -1);
              if (cx !== null) {
                const sub = new LandSubmarine(this, cx, this.getTerrainHeight(cx));
                this.enemies.push(sub);
                this.enemiesGroup.add(sub);
                this.physics.add.overlap(this.mineGroup, sub, (mineObj: any, enemyObj: any) => this.handleMineTrigger(mineObj, enemyObj));
              }
          }
          if (!blockVehiclesAfterHunterSpawn && allowDesertVehicleSpawn && x % 6000 < 30 && (this.mapId !== 'desert' || Math.random() < Phaser.Math.Linear(0.16, 0.32, desertEnemyPressure))) {
              const heli = new Helicopter(this, x + 2000, -600);
              this.enemies.push(heli);
              this.physics.add.overlap(this.mineGroup, heli, (mineObj: any, enemyObj: any) => this.handleMineTrigger(mineObj, enemyObj));
          }
          if (allowDesertInfantrySpawn) {
            const ix = findDryX(x + 500, 1);
            if (ix !== null) this.enemyInfantry.spawn(ix, this.getGroundHeight(ix));
            else this.enemyInfantry.spawn(x + 500, h);
          }
      }
    }
  }

  private findDryX(x: number, preferDir: number): number | null {
    const step = 180;
    for (let i = 0; i <= 22; i++) {
      const a = x + preferDir * i * step;
      if (!this.isWaterAt(a) && !this.isSwampAt(a)) return a;
      const b = x - preferDir * i * step;
      if (!this.isWaterAt(b) && !this.isSwampAt(b)) return b;
    }
    return null;
  }

  private countNearbyEnemyVehicles(x: number, y: number, radius: number): number {
    let count = 0;
    for (const e of this.enemies) {
      if (!e?.active) continue;
      const isDead = (e as any).isDead === true;
      if (isDead) continue;
      const ex = e instanceof Tank ? e.chassis.x : (e as any).x;
      const ey = e instanceof Tank ? e.chassis.y : (e as any).y;
      if (typeof ex !== 'number' || typeof ey !== 'number') continue;
      if (Phaser.Math.Distance.Between(x, y, ex, ey) <= radius) count++;
    }
    return count;
  }

  private trySpawnHunterNearPlayer(now: number) {
    if (this.hunterSpawned) return;
    if (!this.player?.active || this.player.isDead) return;
    if (this.mapId !== 'forest') return;
    const lastBlockStart = Math.floor((this.WORLD_WIDTH - 1) / 18000) * 18000;
    const lastSafeX0 = lastBlockStart + 12000;
    const prevSafeX1 = lastBlockStart;
    const roadX0 = prevSafeX1;
    const roadX1 = lastSafeX0;
    if (!(roadX1 > roadX0)) return;
    const px = this.player.chassis.x;
    if (px < roadX0 || px > roadX1) return;
    if (this.isInSafeZone(px)) return;
    if (now < this.lastHunterSpawnTryT + 300) return;
    this.lastHunterSpawnTryT = now;

    const view = this.cameras.main.worldView;
    const offsets = [650, 900, 1200, 1450, -650, -900, -1200];
    Phaser.Utils.Array.Shuffle(offsets);

    for (const off of offsets) {
      const wantX = this.player.chassis.x + off + Phaser.Math.Between(-90, 90);
      if (this.isInSafeZone(wantX)) continue;
      const preferDir = off >= 0 ? 1 : -1;
      const tx = this.findDryX(wantX, preferDir);
      if (tx === null) continue;
      if (tx < view.x - 250 || tx > view.right + 250) continue;

      const scale = Tank.getScaleFor(TankType.ENEMY_HUNTER, false);
      const ty = this.getGroundHeight(tx) - 150 * scale;
      const nearby = this.countNearbyEnemyVehicles(tx, ty, 1700);
      if (nearby > 1) continue;

      this.beginHunterIntro(tx, ty);
      this.hunterSpawned = true;
      this.hunterSpawnX = tx;
      return;
    }
  }

  private beginHunterIntro(dropX: number, dropY: number) {
    if (!this.player?.active) return;

    if (this.mapId === 'forest') {
      this.forestHunterBgmLatched = true;
      this.applyForestBgmState('hunter', this.time.now, { transition: 'hunter_intro', forceRestart: true });
    }

    const view = this.cameras.main.worldView;
    const ropeLen = 240;
    const fromRight = dropX >= this.player.chassis.x;
    const startX = fromRight ? (view.right - 90) : (view.x + 90);
    const startY = view.y + 90;

    const heliA = new Helicopter(this, startX - 140, startY, { cinematic: true, invulnerable: true, hideHealthBar: true });
    const heliB = new Helicopter(this, startX + 140, startY, { cinematic: true, invulnerable: true, hideHealthBar: true });
    heliA.setDepth(90);
    heliB.setDepth(90);

    const tank = new Tank(this, startX, startY + ropeLen, TankType.ENEMY_HUNTER);
    tank.chassis.setData('tankRef', tank);
    tank.chassis.setData('introDropping', true);
    tank.setCinematicSuspended(true);
    tank.setWorldPosition(startX, startY + ropeLen);
    this.enemies.push(tank);
    this.enemiesGroup.add(tank.chassis);
    this.hunterBossTank = tank;

    this.particles?.createBlackRain?.(dropX, 900, 4200);

    const rope = this.add.graphics().setDepth(89);

    const dur = 1800;
    this.hunterIntro = {
      tank,
      heliA,
      heliB,
      rope,
      phase: 'approach',
      ropeLen,
      fromRight,
      startT: this.time.now,
      approachDur: dur,
      midX: startX,
      midY: startY
    };
  }

  private startHunterIntroDrop() {
    const intro = this.hunterIntro;
    if (!intro) return;
    if (intro.phase !== 'approach') return;
    if (!intro.tank?.active) { this.cleanupHunterIntro(); return; }
    if (!this.player?.active) { this.cleanupHunterIntro(); return; }

    intro.phase = 'exit';
    intro.rope.clear();
    intro.exitT = this.time.now;
    intro.exitDur = 1400;

    intro.tank.setCinematicSuspended(false);
    intro.tank.chassis.setData('introDropping', true);
  }

  private cleanupHunterIntro() {
    const intro = this.hunterIntro;
    if (!intro) return;
    intro.rope.destroy();
    intro.heliA.destroy();
    intro.heliB.destroy();
    this.hunterIntro = undefined;
  }

  private updateHunterIntro(time: number, delta: number) {
    const intro = this.hunterIntro;
    if (!intro) return;
    if (!intro.tank?.active) { this.cleanupHunterIntro(); return; }
    if (!this.player?.active) { this.cleanupHunterIntro(); return; }

    const view = this.cameras.main.worldView;

    if (intro.phase === 'exit') {
      const exitT = intro.exitT ?? time;
      const exitDur = intro.exitDur ?? 1400;
      const p = Phaser.Math.Clamp((time - exitT) / exitDur, 0, 1);
      const y = view.y - 900;

      const exitX1 = intro.heliA.x < this.player.chassis.x ? (view.x - 1400) : (view.right + 1400);
      const exitX2 = intro.heliB.x < this.player.chassis.x ? (view.x - 1400) : (view.right + 1400);
      intro.heliA.setFlipX(exitX1 < intro.heliA.x);
      intro.heliB.setFlipX(exitX2 < intro.heliB.x);

      intro.heliA.setPosition(Phaser.Math.Linear(intro.heliA.x, exitX1, 0.05 + 0.22 * p), Phaser.Math.Linear(intro.heliA.y, y, 0.05 + 0.22 * p));
      intro.heliB.setPosition(Phaser.Math.Linear(intro.heliB.x, exitX2, 0.05 + 0.22 * p), Phaser.Math.Linear(intro.heliB.y, y, 0.05 + 0.22 * p));

      intro.heliA.update(time, delta, this.player);
      intro.heliB.update(time, delta, this.player);

      if (p >= 1) this.cleanupHunterIntro();
      return;
    }

    const elapsed = time - intro.startT;
    const p = Phaser.Math.Clamp(elapsed / intro.approachDur, 0, 1);
    const follow = 0.05 + 0.15 * Phaser.Math.Easing.Sine.InOut(p);

    const wantMidY = view.y + 140;
    const signedAhead = intro.fromRight ? 550 : -550;
    const wantMidX = Phaser.Math.Clamp(this.player.chassis.x + signedAhead, view.x + 420, view.right - 420);

    intro.midX = Phaser.Math.Linear(intro.midX, wantMidX, follow);
    intro.midY = Phaser.Math.Linear(intro.midY, wantMidY, follow);

    const sep = 280;
    intro.heliA.setPosition(intro.midX - sep * 0.5, intro.midY);
    intro.heliB.setPosition(intro.midX + sep * 0.5, intro.midY);

    intro.heliA.update(time, delta, this.player);
    intro.heliB.update(time, delta, this.player);

    intro.tank.setWorldPosition(intro.midX, intro.midY + intro.ropeLen);

    const b = intro.tank.getBounds();
    const ax = b.left + (b.width * 0.28);
    const bx = b.right - (b.width * 0.28);
    const ay = b.top + 8;

    intro.rope.clear();
    intro.rope.lineStyle(3, 0x101010, 0.95);
    intro.rope.lineBetween(intro.heliA.x, intro.heliA.y + 18, ax, ay);
    intro.rope.lineBetween(intro.heliB.x, intro.heliB.y + 18, bx, ay);

    if (p >= 1) this.startHunterIntroDrop();
  }

  public getWindAt(y: number): number {
    const heightFactor = Phaser.Math.Clamp(1 - (y / 900), 0.25, 1);
    return this.wind * heightFactor;
  }

  private getSafeZoneBounds(x: number): { x0: number; x1: number } {
    if (x < 3000) return { x0: 0, x1: 3000 };
    const blockStart = Math.floor(x / 18000) * 18000;
    return this.getSafeZoneBoundsForBlock(blockStart);
  }

  private getSafeZoneBoundsForBlock(blockStart: number): { x0: number; x1: number } {
    const defaultX0 = blockStart + 12000;
    const defaultX1 = blockStart + 18000;
    if (defaultX0 === this.forestPenultimateSafeZoneX0) {
      return { x0: blockStart + 6000, x1: defaultX1 };
    }
    return { x0: defaultX0, x1: defaultX1 };
  }

  private getPenultimateSafeZoneBounds(): { x0: number; x1: number } {
    const anchor = this.forestPenultimateSafeZoneX0;
    return {
      x0: Math.max(0, anchor - this.safeZoneDefaultLength),
      x1: anchor + this.safeZoneDefaultLength
    };
  }

  private clearPreFinalWreckFieldEffects() {
    for (const anchor of this.preFinalWreckAnchors) {
      if (anchor.smoke) {
        try {
          anchor.smoke.stop();
        } catch {}
        anchor.smoke.destroy();
      }
      if (anchor.scorch?.active) anchor.scorch.destroy();
    }
    this.preFinalWreckAnchors.length = 0;
    this.preFinalWreckLastUpdateT = 0;
  }

  private updatePreFinalSafeZoneWreckField(now: number) {
    if (!this.preFinalSafeZoneWreckFieldSpawned || this.preFinalWreckAnchors.length === 0) return;
    if (now < this.preFinalWreckLastUpdateT + 33) return;
    this.preFinalWreckLastUpdateT = now;

    const view = this.cameras.main.worldView;
    const left = view.x - 1600;
    const right = view.right + 1600;

    for (const anchor of this.preFinalWreckAnchors) {
      if (!anchor.sprite?.active) continue;
      if (anchor.x < left || anchor.x > right) continue;

      const groundY = this.getTerrainHeight(anchor.x);
      const slope = Phaser.Math.Clamp(this.getTerrainNormal(anchor.x), -0.5, 0.5);
      const targetY = groundY - anchor.burialDepth;

      anchor.sprite.y = Phaser.Math.Linear(anchor.sprite.y, targetY, 0.45);
      anchor.sprite.rotation = anchor.baseRotation + slope * anchor.slopeFollow;

      if (anchor.scorch?.active) {
        anchor.scorch.setPosition(anchor.x, groundY + 4);
        anchor.scorch.rotation = slope * 0.22;
      }

      if (anchor.smoke?.active) {
        const sway = Math.sin(now * 0.0012 + anchor.smokePhase) * 6;
        anchor.smoke.setPosition(anchor.x + sway, targetY - 16);
      }
    }
  }

  private createPreFinalSafeZoneWreckField() {
    if (this.mapId !== 'forest' || this.testRoomEnabled) return;
    if (this.preFinalSafeZoneWreckFieldSpawned) return;

    this.clearPreFinalWreckFieldEffects();

    const bounds = this.getPenultimateSafeZoneBounds();
    const field = this.add.container(0, 0).setDepth(23);
    const textures = ['sov_player_hull', 'sov_player_detail', 'sov_turret', 'sov_wheel'];
    let spawned = 0;
    let smokeCount = 0;

    const spawnPiece = (x: number, tex: string, scale: number, rot: number, tint: number, alpha: number, burialDepth: number) => {
      if (!this.textures.exists(tex)) return;
      const groundY = this.getTerrainHeight(x);
      const y = groundY - burialDepth;
      const img = this.add.image(x, y, tex)
        .setOrigin(0.5, Phaser.Math.FloatBetween(0.56, 0.72))
        .setScale(scale)
        .setRotation(rot)
        .setTint(tint)
        .setAlpha(alpha)
        .setDepth(23 + Math.random() * 2.5);
      img.setData('isPreFinalWreck', true);
      field.add(img);

      const anchor: PreFinalWreckAnchor = {
        x,
        sprite: img,
        burialDepth,
        baseRotation: rot,
        slopeFollow: Phaser.Math.FloatBetween(0.2, 0.62),
        smokePhase: Math.random() * Math.PI * 2
      };

      if (Math.random() < 0.62) {
        const scorch = this.add.image(x, groundY + 4, 'smoke_puff')
          .setTint(Math.random() < 0.55 ? 0x18120f : 0x221815)
          .setAlpha(Phaser.Math.FloatBetween(0.18, 0.3))
          .setScale(Phaser.Math.FloatBetween(1.1, 1.95), Phaser.Math.FloatBetween(0.24, 0.44))
          .setDepth(22.35)
          .setRotation(Phaser.Math.FloatBetween(-0.45, 0.45));
        anchor.scorch = scorch;
      }

      if (smokeCount < 22 && Math.random() < 0.22) {
        const smoke = this.add.particles(x, y - 14, 'smoke_puff', {
          lifespan: { min: 1200, max: 2600 },
          speedX: { min: -16, max: 16 },
          speedY: { min: -54, max: -18 },
          scale: { start: 0.16, end: 0.92 },
          alpha: { start: 0.2, end: 0 },
          tint: [0x2a2a2a, 0x343434, 0x464646],
          frequency: 420,
          quantity: 1
        }).setDepth(24.1);
        anchor.smoke = smoke;
        smokeCount++;
      }

      this.preFinalWreckAnchors.push(anchor);
      spawned++;
    };

    const spacing = 210;
    for (let x = bounds.x0 + 120; x < bounds.x1 - 120; x += spacing) {
      if (this.isWaterAt(x) || this.isSwampAt(x)) continue;

      const clusterCount = Phaser.Math.Between(3, 5);
      for (let i = 0; i < clusterCount; i++) {
        const cx = x + Phaser.Math.Between(-86, 86);
        if (this.isWaterAt(cx) || this.isSwampAt(cx)) continue;

        const tex = textures[Phaser.Math.Between(0, textures.length - 1)];
        const tint = Phaser.Math.Between(0, 1) === 0 ? 0x626262 : 0x545b62;
        const scale = tex === 'sov_wheel'
          ? Phaser.Math.FloatBetween(1.2, 1.95)
          : Phaser.Math.FloatBetween(0.72, 1.3);
        const burialDepth = tex === 'sov_wheel'
          ? Phaser.Math.FloatBetween(5, 16)
          : Phaser.Math.FloatBetween(9, 30);
        spawnPiece(
          cx,
          tex,
          scale,
          Phaser.Math.FloatBetween(-1.95, 1.95),
          tint,
          Phaser.Math.FloatBetween(0.68, 0.93),
          burialDepth
        );

        if (Phaser.Math.Between(0, 2) === 0) {
          const barrelTex = `sov_barrel_${Phaser.Math.Between(0, 4)}`;
          spawnPiece(
            cx + Phaser.Math.Between(-18, 18),
            barrelTex,
            Phaser.Math.FloatBetween(0.72, 1.2),
            Phaser.Math.FloatBetween(-2.15, 2.15),
            0x4a4a4a,
            Phaser.Math.FloatBetween(0.66, 0.9),
            Phaser.Math.FloatBetween(7, 20)
          );
        }
      }
    }

    if (spawned <= 0) {
      field.destroy(true);
      this.clearPreFinalWreckFieldEffects();
      return;
    }

    this.preFinalSafeZoneWreckField = field;
    this.preFinalSafeZoneWreckFieldSpawned = true;
    this.preFinalWreckLastUpdateT = this.time.now;
  }

  private computePenultimateSafeZoneStartX(): number {
    const safeStarts: number[] = [0];
    if (this.WORLD_WIDTH > 3000) {
      for (let blockStart = 0; blockStart < this.WORLD_WIDTH + 18000; blockStart += 18000) {
        const x0 = blockStart + 12000;
        if (x0 >= this.WORLD_WIDTH) break;
        safeStarts.push(x0);
      }
    }
    safeStarts.sort((a, b) => a - b);
    return safeStarts.length >= 2 ? safeStarts[safeStarts.length - 2] : safeStarts[0];
  }

  private clearQueuedForestBgmTransition() {
    if (this.forestBgmQueuedTimer) {
      this.forestBgmQueuedTimer.destroy();
      this.forestBgmQueuedTimer = null;
    }
    this.forestBgmQueuedState = null;
    this.forestBgmQueuedTransition = null;
  }

  private getForestBgmBarDurationMs(): number {
    return (60000 / this.forestBgmBpm) * this.forestBgmBeatsPerBar;
  }

  private getForestBgmNextBarDelayMs(now: number): number {
    const anchor = this.forestBgmBarAnchorAt;
    if (!Number.isFinite(anchor)) return 0;

    const barMs = this.getForestBgmBarDurationMs();
    if (!Number.isFinite(barMs) || barMs <= 1) return 0;

    const elapsed = Math.max(0, now - anchor);
    const remain = barMs - (elapsed % barMs);
    if (remain < 8 || barMs - remain < 8) return 0;
    return remain;
  }

  private getForestBgmFolder(state: ForestBgmState): string {
    switch (state) {
      case 'combat': return 'bgm/forest/combat/sfx';
      case 'safezone': return 'bgm/forest/pre_final_safe_zone/sfx';
      case 'hunter': return 'bgm/forest/enemy_hunter_intro/sfx';
      case 'end': return 'bgm/forest/End/sfx';
      default: return 'bgm/forest/non_combat/sfx';
    }
  }

  private getNextForestBgmLoopId(): string {
    const [loopA, loopB] = this.bgmLoopIds;
    if (this.forestBgmActiveLoopId === loopA) return loopB;
    return loopA;
  }

  private applyForestBgmState(
    state: ForestBgmState,
    now: number,
    opts?: { transition?: ForestBgmTransition; forceRestart?: boolean }
  ) {
    if (this.tutorialMode) return;
    const folder = this.getForestBgmFolder(state);
    const transition = opts?.transition ?? (this.forestBgmCurrent === null ? 'initial' : 'crossfade');
    this.clearQueuedForestBgmTransition();
    const forceRestart = opts?.forceRestart === true;
    if (!forceRestart && this.forestBgmCurrent === state && this.forestBgmCurrentFolder === folder) return;

    let fadeInMs = 220;
    let fadeOutMs = 220;
    switch (transition) {
      case 'initial':
        fadeInMs = 340;
        fadeOutMs = 0;
        break;
      case 'combat_in':
        // Entering combat: crossfade, but ramp combat BGM faster to full volume.
        fadeInMs = 110;
        fadeOutMs = 320;
        break;
      case 'hunter_intro':
        // Hunter intro starts immediately while previous BGM tails out.
        fadeInMs = 0;
        fadeOutMs = 320;
        break;
      case 'crossfade':
      default:
        fadeInMs = 320;
        fadeOutMs = 320;
        break;
    }

    // Safe-zone BGM rule:
    // - No fade-in on target track.
    // - Only previous track fades out for 1s.
    if (state === 'safezone') {
      fadeInMs = 0;
      fadeOutMs = 1000;
    }

    const prevLoopId = this.forestBgmActiveLoopId;
    const nextLoopId = this.getNextForestBgmLoopId();
    this.audio.startLoop(nextLoopId, folder, {
      volume: 0.58,
      fadeInMs,
      startAtRandomOffset: false
    }).catch(() => {});
    if (prevLoopId && prevLoopId !== nextLoopId) {
      this.audio.stopLoop(prevLoopId, fadeOutMs);
    }

    this.forestBgmActiveLoopId = nextLoopId;
    this.forestBgmCurrentFolder = folder;
    this.forestBgmCurrent = state;
    this.forestBgmBarAnchorAt = now;
  }

  private queueForestBgmState(
    state: ForestBgmState,
    now: number,
    transition: ForestBgmTransition = 'crossfade'
  ) {
    if (this.forestBgmCurrent === state && transition !== 'hunter_intro') return;

    if (this.forestBgmQueuedState === state && this.forestBgmQueuedTransition === transition) return;

    // Wwise-style Next Bar rules:
    // Only explore keeps next-bar scheduling.
    // Safe-zone switches immediately (no next-bar wait).
    const useNextBar = state === 'explore' && this.forestBgmCurrent !== null;
    if (useNextBar) {
      const delayMs = this.getForestBgmNextBarDelayMs(now);
      if (delayMs > 0) {
        this.clearQueuedForestBgmTransition();
        this.forestBgmQueuedState = state;
        this.forestBgmQueuedTransition = transition;
        this.forestBgmQueuedTimer = this.time.delayedCall(delayMs, () => {
          const queuedState = this.forestBgmQueuedState;
          const queuedTransition = this.forestBgmQueuedTransition ?? 'crossfade';
          this.clearQueuedForestBgmTransition();
          if (!queuedState) return;
          this.applyForestBgmState(queuedState, this.time.now, { transition: queuedTransition });
        });
        return;
      }
    }

    this.clearQueuedForestBgmTransition();
    this.applyForestBgmState(state, now, { transition });
  }

  private noteEnemyCombatActivity(now: number) {
    this.forestLastEnemyCombatActivityAt = now;
  }

  private hasEnemyThreatNearPlayer(): boolean {
    const player = this.player;
    if (!player?.chassis?.active || player.isDead) return false;

    const px = player.chassis.x;
    const py = player.chassis.y;
    const threatRadius = 2600;
    const radiusSq = threatRadius * threatRadius;

    for (const e of this.enemies) {
      if (!e?.active) continue;
      if ((e as any).isDead === true) continue;
      const ex = e instanceof Tank ? e.chassis?.x : (e as any).x;
      const ey = e instanceof Tank ? e.chassis?.y : (e as any).y;
      if (typeof ex !== 'number' || typeof ey !== 'number') continue;
      const dx = ex - px;
      const dy = ey - py;
      if ((dx * dx + dy * dy) <= radiusSq) return true;
    }

    for (const s of this.enemyInfantry?.soldiers ?? []) {
      if (!s?.active) continue;
      const dx = s.x - px;
      const dy = s.y - py;
      if ((dx * dx + dy * dy) <= 1800 * 1800) return true;
    }

    return false;
  }

  private noteCombatDamage(now: number) {
    this.forestLastCombatDamageAt = now;
    this.forestCombatActive = true;
    this.noteEnemyCombatActivity(now);
    if (this.mapId !== 'forest' || this.testRoomEnabled || this.tutorialMode) return;
    if (this.forestHunterBgmLatched || this.forestSafeZoneBgmLatched || this.forestEndBgmLatched) return;
    if (this.forestBgmCurrent !== 'combat') this.applyForestBgmState('combat', now, { transition: 'combat_in' });
  }

  private updateForestBgm(now: number) {
    if (this.mapId !== 'forest' || this.testRoomEnabled || this.tutorialMode || !this.player?.chassis?.active) return;

    if (now > this.forestLastThreatProbeAt + 200) {
      this.forestLastThreatProbeAt = now;
      if (this.hasEnemyThreatNearPlayer()) this.noteEnemyCombatActivity(now);
    }

    if (!this.forestHunterBgmLatched && this.hunterIntro) {
      this.forestHunterBgmLatched = true;
      this.applyForestBgmState('hunter', now, { transition: 'hunter_intro', forceRestart: true });
      return;
    }

    if (!this.forestSafeZoneBgmLatched && !this.forestHunterBgmLatched) {
      const px = this.player.chassis.x;
      const penultimate = this.getPenultimateSafeZoneBounds();
      if (px >= penultimate.x0 && px <= penultimate.x1 && this.isInSafeZone(px)) {
        this.forestSafeZoneBgmLatched = true;
        this.queueForestBgmState('safezone', now, 'crossfade');
        return;
      }
    }

    const lastThreatAt = Math.max(this.forestLastCombatDamageAt, this.forestLastEnemyCombatActivityAt);
    if (this.forestCombatActive && now > lastThreatAt + this.bgmCombatExitMs) {
      this.forestCombatActive = false;
    }

    const desired: ForestBgmState = this.forestEndBgmLatched
      ? 'end'
      : (this.forestHunterBgmLatched
        ? 'hunter'
        : (this.forestSafeZoneBgmLatched ? 'safezone' : (this.forestCombatActive ? 'combat' : 'explore')));

    if (this.forestBgmCurrent === null) {
      this.applyForestBgmState(desired, now, { transition: 'initial' });
      return;
    }

    if (this.forestBgmCurrent !== desired) {
      const transition = desired === 'combat' ? 'combat_in' : 'crossfade';
      this.queueForestBgmState(desired, now, transition);
    }
  }

  private emitTacticalMapData(forceHidden: boolean = false) {
    if (typeof window === 'undefined') return;

    const player = this.player;
    const visible = !forceHidden && !!player?.chassis?.active && !player.isDead && !this.isDefeat;
    if (!visible) {
      if (this.tacticalMapVisibleLast || forceHidden) {
        window.dispatchEvent(new CustomEvent('panzer-tactical-map-data', { detail: { visible: false } }));
      }
      this.tacticalMapVisibleLast = false;
      return;
    }

    const cam = this.cameras.main;
    const minZoom = this.sys.game.device.os.android ? 0.2 : 0.1;
    const maxViewW = cam.width / Math.max(0.05, minZoom);
    const maxViewH = cam.height / Math.max(0.05, minZoom);
    const halfW = maxViewW * 0.5;
    const halfH = maxViewH * 0.5;
    const cx = player.chassis.x;
    const cy = player.chassis.y;

    const viewX = Phaser.Math.Clamp(cx - halfW, 0, Math.max(0, this.WORLD_WIDTH - maxViewW));
    const viewY = cy - halfH;

    const isAndroid = this.sys.game.device.os.android;
    const isMobile = isAndroid || this.sys.game.device.os.iOS || this.sys.game.device.input.touch;
    let sampleCount = isAndroid ? 30 : (isMobile ? 44 : 56);
    if (this.tacticalMapEmitIntervalMs > this.tacticalMapEmitBaseIntervalMs + 110) {
      sampleCount = Math.max(isAndroid ? 20 : 30, Math.round(sampleCount * 0.72));
    } else if (this.tacticalMapEmitIntervalMs > this.tacticalMapEmitBaseIntervalMs + 60) {
      sampleCount = Math.max(isAndroid ? 24 : 36, Math.round(sampleCount * 0.86));
    }
    const terrain: { x: number; y: number }[] = [];
    for (let i = 0; i < sampleCount; i++) {
      const tx = viewX + (i / (sampleCount - 1)) * maxViewW;
      terrain.push({ x: tx, y: this.getTerrainHeight(tx) });
    }

    const enemyVehicleCap = isAndroid ? 88 : 120;
    const enemyInfantryCap = isAndroid ? 72 : 100;
    const allyInfantryCap = isAndroid ? 64 : 90;
    const enemiesCap = isAndroid ? 140 : 180;
    const buildingCap = isAndroid ? 80 : 120;

    const enemyVehicles: { x: number; y: number }[] = [];
    for (let i = 0; i < this.enemies.length && enemyVehicles.length < enemyVehicleCap; i++) {
      const e = this.enemies[i] as any;
      if (!e?.active || e?.isDead === true) continue;
      const xRaw = e instanceof Tank ? e.chassis?.x : e.x;
      const yRaw = e instanceof Tank ? e.chassis?.y : e.y;
      const x = Number(xRaw);
      const y = Number(yRaw);
      if (Number.isFinite(x) && Number.isFinite(y)) enemyVehicles.push({ x, y });
    }

    const enemyInfantry: { x: number; y: number }[] = [];
    const enemySoldiers = this.enemyInfantry?.soldiers ?? [];
    for (let i = 0; i < enemySoldiers.length && enemyInfantry.length < enemyInfantryCap; i++) {
      const s = enemySoldiers[i] as any;
      if (!s?.active) continue;
      const x = Number(s.x);
      const y = Number(s.y);
      if (Number.isFinite(x) && Number.isFinite(y)) enemyInfantry.push({ x, y });
    }

    const allyInfantry: { x: number; y: number }[] = [];
    const allySoldiers = this.allies?.soldiers ?? [];
    for (let i = 0; i < allySoldiers.length && allyInfantry.length < allyInfantryCap; i++) {
      const s = allySoldiers[i] as any;
      if (!s?.active) continue;
      const x = Number(s.x);
      const y = Number(s.y);
      if (Number.isFinite(x) && Number.isFinite(y)) allyInfantry.push({ x, y });
    }

    const enemies: { x: number; y: number }[] = [];
    for (let i = 0; i < enemyVehicles.length && enemies.length < enemiesCap; i++) enemies.push(enemyVehicles[i]);
    for (let i = 0; i < enemyInfantry.length && enemies.length < enemiesCap; i++) enemies.push(enemyInfantry[i]);
    const allies = allyInfantry;
    const buildings = this.buildings?.getTacticalMarkers?.(buildingCap) ?? [];

    const lakes = this.lakes.map(l => ({ x0: l.x0, x1: l.x1, waterY: l.waterY }));

    window.dispatchEvent(new CustomEvent('panzer-tactical-map-data', {
      detail: {
        visible: true,
        mapId: this.mapId,
        viewRect: { x: viewX, y: viewY, w: maxViewW, h: maxViewH },
        worldWidth: this.WORLD_WIDTH,
        player: { x: cx, y: cy },
        enemies,
        allies,
        enemyVehicles,
        enemyInfantry,
        allyInfantry,
        buildings,
        lakes,
        terrain,
        preFinalSafeX: Number.isFinite(this.forestPenultimateSafeZoneX0) ? this.getPenultimateSafeZoneBounds().x0 : null
      }
    }));

    this.tacticalMapVisibleLast = true;
  }

  private createClothFlag(anchorX: number, anchorY: number) {
    const flagW = 80;
    const flagH = 50;
    const segCount = 8;
    const segW = flagW / segCount;

    const segments: Phaser.GameObjects.Image[] = [];
    const points: Phaser.Math.Vector2[] = [];
    const vels: Phaser.Math.Vector2[] = [];

    for (let i = 0; i < segCount; i++) {
      const img = this.add.image(anchorX + i * segW, anchorY, 'flag_red').setOrigin(0, 0.5).setDepth(24);
      img.setCrop(i * segW, 0, segW, flagH);
      segments.push(img);
      points.push(new Phaser.Math.Vector2(anchorX + i * segW, anchorY + i * 2));
      vels.push(new Phaser.Math.Vector2(0, 0));
    }

    const flag = { segments, points, vels, anchorX, anchorY, segW, phase: Math.random() * Math.PI * 2, collapsed: false };
    this.flags.push(flag);
    return flag;
  }

  private softResetAudioForSceneTransition() {
    try { this.audio?.dispose?.(); } catch {}
    SoundManager.softResetSceneAudio(this);
    this.emitTacticalMapData(true);
  }

  private getTutorialStepContent(step: number) {
    const mobile = this.sys.game.device.os.android || this.sys.game.device.os.iOS;
    const pcTexts = [
      '按 A / D 移动战车，向右前进到标记区域。',
      '长按鼠标左键瞄准，松开左键后发射1次主炮。',
      '击毁前方静止靶车，体验弹道高低差。',
      '前方是无桥湖泊，按 Space 升空越湖。',
      '长按 Z 键瞄准迫击炮，松开后发射1次（本步免除一次CD）。',
      '按住 X 键瞄准核弹，松开后发射1次（本步免除一次CD）。',
      '前往撤离基地，按 Shift 可以加速冲刺。'
    ];
    const touchTexts = [
      '按住左侧移动摇杆，向右前进到标记区域。',
      '长按右侧瞄准区，松开后发射1次主炮。',
      '击毁前方静止靶车，体验弹道高低差。',
      '前方是无桥湖泊，按住“升空”按键越湖。',
      '长按“迫击”按键瞄准，松开后发射1次（本步免除一次CD）。',
      '长按“核弹”按键瞄准，松开后发射1次（本步免除一次CD）。',
      '前往撤离基地，按住“加速”可快速抵达。'
    ];
    const txt = (mobile ? touchTexts : pcTexts)[Phaser.Math.Clamp(step, 0, 6)] ?? '';
    return {
      title: `教程 ${step + 1}/7`,
      body: txt,
      stepLine: `当前阶段 ${step + 1}/7`
    };
  }

  private getTutorialStepProgressLine(step: number): string {
    switch (step) {
      case 1: {
        const fired = Math.max(0, this.tutorialMainShellShots - this.tutorialStepMainShotStart);
        return `主炮发射 ${Math.min(1, fired)}/1`;
      }
      case 2:
        return (!this.tutorialDummyTarget?.active || this.tutorialDummyTarget.isDead)
          ? '靶车状态：已摧毁'
          : '靶车状态：待摧毁';
      case 3: {
        if (this.tutorialLiftSatisfied) return '越湖状态：已满足';
        const lake = this.tutorialLakeBounds;
        const playerX = this.player?.chassis?.active ? this.player.chassis.x : Number.NaN;
        if (!lake || !Number.isFinite(playerX)) return '越湖状态：等待进入湖区';
        if (playerX < lake.x0 - 80) return '越湖状态：前往湖区并按住升空';
        if (playerX > lake.x1 + 120) return '越湖状态：已通过湖区';
        return '越湖状态：保持升空通过湖面';
      }
      case 4: {
        const fired = Math.max(0, this.tutorialMortarShots - this.tutorialStepMortarShotStart);
        return `迫击炮发射 ${Math.min(1, fired)}/1`;
      }
      case 5: {
        const fired = Math.max(0, this.tutorialNukeShots - this.tutorialStepNukeShotStart);
        return `核弹发射 ${Math.min(1, fired)}/1`;
      }
      case 6: {
        const zone = this.tutorialExitZone;
        if (zone?.active && this.player?.chassis?.active) {
          const dist = Math.max(0, Math.round(Math.abs(zone.x - this.player.chassis.x)));
          return `距撤离区约 ${dist}`;
        }
        return '目标：进入撤离基地';
      }
      default:
        return '';
    }
  }

  private hasTutorialShellSwitchCompleted(): boolean {
    return this.tutorialSwitchVisitedShells.has(ShellType.HE)
      || this.tutorialSwitchVisitedShells.has(ShellType.AP)
      || this.tutorialSwitchVisitedShells.has(ShellType.INCENDIARY);
  }

  private getTutorialStepContentRich(step: number) {
    const mobile = this.sys.game.device.os.android || this.sys.game.device.os.iOS || this.sys.game.device.input.touch;
    const pcTexts = [
      '按 A / D 向右移动到前方黄色标记区域。',
      '学习切换炮弹：按 1/2/3/4 切换标准/高爆/穿甲/燃烧，至少切到一种非标准炮弹。',
      '长按鼠标左键瞄准，松开发射 1 发主炮。',
      '摧毁前方靶车，熟悉弹道落点。',
      '前方是无桥湖区，按住 Space 升空越湖。',
      '长按 Z 瞄准迫击炮，松开发射 1 发（本步免除一次冷却）。',
      '长按 X 瞄准核弹，松开发射 1 发（本步免除一次冷却）。',
      '前往撤离基地，按 Shift 可加速冲刺。'
    ];
    const touchTexts = [
      '按住左侧移动摇杆，向右移动到前方黄色标记区域。',
      '学习切换炮弹：点击“炮弹”按钮可循环切换，长按可弹出扇形选择，至少切到一种非标准炮弹。',
      '按住右侧瞄准区，松开发射 1 发主炮。',
      '摧毁前方靶车，熟悉弹道落点。',
      '前方是无桥湖区，按住“升空”按钮越湖。',
      '长按“迫击”进入迫击炮瞄准，松开发射 1 发（本步免除一次冷却）。',
      '长按“核弹”进入核弹瞄准，松开发射 1 发（本步免除一次冷却）。',
      '前往撤离基地，按住“加速”可快速抵达。'
    ];
    const steps = mobile ? touchTexts : pcTexts;
    const idx = Phaser.Math.Clamp(step, 0, steps.length - 1);
    return {
      title: `教程 ${idx + 1}/${steps.length}`,
      body: steps[idx] ?? '',
      stepLine: `当前阶段 ${idx + 1}/${steps.length}`
    };
  }

  private getTutorialStepProgressLineRich(step: number): string {
    switch (step) {
      case 1:
        return this.hasTutorialShellSwitchCompleted()
          ? '炮弹切换：已完成'
          : '炮弹切换：请切到高爆/穿甲/燃烧任意一种';
      case 2: {
        const fired = Math.max(0, this.tutorialMainShellShots - this.tutorialStepMainShotStart);
        return `主炮发射 ${Math.min(1, fired)}/1`;
      }
      case 3:
        return (!this.tutorialDummyTarget?.active || this.tutorialDummyTarget.isDead)
          ? '靶车状态：已摧毁'
          : '靶车状态：待摧毁';
      case 4: {
        if (this.tutorialLiftSatisfied) return '越湖状态：已满足';
        const lake = this.tutorialLakeBounds;
        const playerX = this.player?.chassis?.active ? this.player.chassis.x : Number.NaN;
        if (!lake || !Number.isFinite(playerX)) return '越湖状态：等待进入湖区';
        if (playerX < lake.x0 - 80) return '越湖状态：前往湖区并按住升空';
        if (playerX > lake.x1 + 120) return '越湖状态：已通过湖区';
        return '越湖状态：保持升空通过湖面';
      }
      case 5: {
        const fired = Math.max(0, this.tutorialMortarShots - this.tutorialStepMortarShotStart);
        return `迫击炮发射 ${Math.min(1, fired)}/1`;
      }
      case 6: {
        const fired = Math.max(0, this.tutorialNukeShots - this.tutorialStepNukeShotStart);
        return `核弹发射 ${Math.min(1, fired)}/1`;
      }
      case 7: {
        const zone = this.tutorialExitZone;
        if (zone?.active && this.player?.chassis?.active) {
          const dist = Math.max(0, Math.round(Math.abs(zone.x - this.player.chassis.x)));
          return `距撤离区约 ${dist}`;
        }
        return '目标：进入撤离基地';
      }
      default:
        return '目标：抵达前方标记区域';
    }
  }

  private ensureTutorialUi() {
    if (!this.tutorialMode) return;
    const w = this.scale.width;
    const isMobile = this.sys.game.device.os.android || this.sys.game.device.os.iOS || this.sys.game.device.input.touch;
    const top = isMobile ? 110 : 96;
    const panelW = Phaser.Math.Clamp(Math.round(w * 0.82), 560, 980);
    const panelH = isMobile ? 212 : 188;

    if (!this.tutorialUiPanel?.active) {
      this.tutorialUiPanel = this.add.rectangle(w * 0.5, top, panelW, panelH, 0x000000, 0.56)
        .setDepth(1400)
        .setScrollFactor(0)
        .setStrokeStyle(3, 0xffd35a, 0.78);
      this.tutorialUiTitle = this.add.text(w * 0.5, top - panelH * 0.38, '', {
        fontSize: isMobile ? '40px' : '34px',
        color: '#ffe7a4',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 6
      }).setOrigin(0.5).setDepth(1401).setScrollFactor(0);
      this.tutorialUiBody = this.add.text(w * 0.5, top - panelH * 0.07, '', {
        fontSize: isMobile ? '30px' : '24px',
        color: '#f2f4f8',
        align: 'center',
        stroke: '#000000',
        strokeThickness: 5,
        lineSpacing: 8,
        wordWrap: { width: panelW - 56, useAdvancedWrap: true }
      }).setOrigin(0.5, 0).setDepth(1401).setScrollFactor(0);
      this.tutorialUiStep = this.add.text(w * 0.5, top + panelH * 0.36, '', {
        fontSize: isMobile ? '24px' : '20px',
        color: '#ffd780',
        stroke: '#000000',
        strokeThickness: 5
      }).setOrigin(0.5).setDepth(1401).setScrollFactor(0);
    }

    this.tutorialUiPanel?.setPosition(w * 0.5, top).setSize(panelW, panelH);
    this.tutorialUiTitle?.setPosition(w * 0.5, top - panelH * 0.38);
    this.tutorialUiBody?.setPosition(w * 0.5, top - panelH * 0.07);
    this.tutorialUiBody?.setWordWrapWidth(panelW - 56, true);
    this.tutorialUiStep?.setPosition(w * 0.5, top + panelH * 0.36);
  }

  private refreshTutorialUi() {
    if (!this.tutorialMode) return;
    this.ensureTutorialUi();
    const info = this.getTutorialStepContentRich(this.tutorialStep);
    const progressLine = this.getTutorialStepProgressLineRich(this.tutorialStep);
    const stepText = progressLine ? `${info.stepLine} · ${progressLine}` : info.stepLine;
    const blockedHint = this.time.now < this.tutorialGateBlockedHintUntil ? ' ｜前方锁定：先完成当前教学' : '';
    const stepTextOut = `${stepText}${this.time.now < this.tutorialGateBlockedHintUntil ? ' | \u524d\u65b9\u9501\u5b9a\uff1a\u5148\u5b8c\u6210\u5f53\u524d\u6559\u5b66' : ''}`;
    if (this.tutorialUiTitle?.active) this.tutorialUiTitle.setText(info.title);
    if (this.tutorialUiBody?.active) this.tutorialUiBody.setText(info.body);
    if (this.tutorialUiStep?.active) this.tutorialUiStep.setText(stepTextOut);
  }

  private spawnTutorialDummyTarget(x: number, type: TankType = TankType.ENEMY_PANZER): Tank {
    let spawnX = this.findDryX(x, 1) ?? x;
    // Keep the tutorial target on a reasonably flat segment so it never drops into pits.
    for (let i = 0; i < 10; i++) {
      const slope = Math.abs(this.getTerrainHeight(spawnX + 50) - this.getTerrainHeight(spawnX - 50));
      const depth = this.getTerrainHeight(spawnX) - (this.getWaterSurfaceY(spawnX) ?? (this.getTerrainHeight(spawnX) - 240));
      if (slope <= 75 && depth >= 80 && !this.isWaterAt(spawnX) && !this.isSwampAt(spawnX)) break;
      const dir = i % 2 === 0 ? 1 : -1;
      spawnX = Phaser.Math.Clamp(spawnX + dir * 120, 360, this.WORLD_WIDTH - 360);
    }

    const scale = Tank.getScaleFor(type, false);
    // Spawn directly on terrain support height so the dummy won't float.
    const y = this.getTerrainHeight(spawnX) - 22 * scale;
    const t = new Tank(this, spawnX, y, type);
    t.chassis.setData('tankRef', t);

    // Freeze AI without cinematic suspension (cinematic suspension blocks damage).
    (t as any).stunTimer = 3_600_000;
    const body = t.chassis.body as Phaser.Physics.Arcade.Body | undefined;
    if (body) {
      body.setEnable(true);
      body.setImmovable(true);
      body.setAllowGravity(false);
      body.moves = false;
      body.setVelocity(0, 0);
      body.setAngularVelocity(0);
    }
    t.chassis.setPosition(spawnX, y);
    t.chassis.setRotation(this.getTerrainNormal(spawnX));
    this.enemies.push(t);
    this.enemiesGroup.add(t.chassis);
    return t;
  }

  private createTutorialLakeNoBridge(x0: number, x1: number) {
    const before = this.enemies.length;
    this.createLakeWithBridge(x0, x1, true);
    const lake = this.lakes[this.lakes.length - 1];
    if (!lake) return;

    this.tutorialLakeBounds = { x0: lake.x0, x1: lake.x1, waterY: lake.waterY };

    for (const seg of lake.segments) {
      if (seg.playerCollider) {
        try { seg.playerCollider.destroy(); } catch {}
        seg.playerCollider = null;
      }
      if (seg.enemyCollider) {
        try { seg.enemyCollider.destroy(); } catch {}
        seg.enemyCollider = null;
      }
      if (seg.rect?.active) {
        const body = seg.rect.body as any;
        if (body) {
          if (typeof body.setEnable === 'function') body.setEnable(false);
          else body.enable = false;
          if (body.checkCollision) body.checkCollision.none = true;
        }
        seg.rect.destroy();
      }
    }
    lake.segments.length = 0;
    lake.bridgeBricksBySeg.length = 0;
    if (lake.bridgeContainer?.active) {
      lake.bridgeContainer.removeAll(true);
      lake.bridgeContainer.setVisible(false);
      lake.bridgeContainer.setAlpha(0);
    }

    while (this.enemies.length > before) {
      const e = this.enemies.pop();
      if (!e) break;
      if (e instanceof Tank) {
        try { this.enemiesGroup.remove(e.chassis, false, false); } catch {}
        e.destroy();
      } else {
        (e as any).destroy?.();
      }
    }
  }

  private createTutorialExitBase(baseX: number) {
    if (this.tutorialExitZone?.active) this.tutorialExitZone.destroy();
    const zoneW = 980;
    const zoneH = 680;
    const gy = this.getTerrainHeight(baseX);
    const zone = this.add.rectangle(baseX, gy - 230, zoneW, zoneH, 0, 0).setVisible(false);
    this.physics.add.existing(zone, true);
    this.tutorialExitZone = zone;

    const embed = 440;
    const above = 460;
    const offsets = [-300, -180, -60, 60, 180, 300];
    for (const off of offsets) {
      const poleX = baseX + off;
      const groundY = this.getTerrainHeight(poleX);
      const pole = this.add.rectangle(poleX, groundY + embed, 5, embed + above, 0x333333).setOrigin(0.5, 1).setDepth(24);
      const topY = pole.y - (embed + above);
      this.createClothFlag(pole.x, topY + 42);
    }
  }

  private destroyTutorialMoveMarker() {
    this.tutorialMoveMarkerArea?.destroy();
    this.tutorialMoveMarkerLabel?.destroy();
    this.tutorialMoveMarkerArrow?.destroy();
    this.tutorialMoveMarkerArea = undefined;
    this.tutorialMoveMarkerLabel = undefined;
    this.tutorialMoveMarkerArrow = undefined;
  }

  private createTutorialMoveMarker() {
    this.destroyTutorialMoveMarker();
    const x = this.tutorialMoveTargetX;
    const y = this.getTerrainHeight(x);
    this.tutorialMoveMarkerArea = this.add.rectangle(x, y - 92, 330, 170, 0xffd35a, 0.12)
      .setDepth(66)
      .setStrokeStyle(2, 0xffd35a, 0.85);
    this.tutorialMoveMarkerLabel = this.add.text(x, y - 206, '\u524d\u8fdb\u76ee\u6807\u533a\u57df', {
      fontFamily: 'Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif',
      fontSize: '24px',
      color: '#ffe08f',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 5
    }).setOrigin(0.5).setDepth(67);
    this.tutorialMoveMarkerArrow = this.add.text(x, y - 164, '\u2193', {
      fontSize: '34px',
      color: '#ffd35a',
      stroke: '#000000',
      strokeThickness: 5
    }).setOrigin(0.5).setDepth(67);
  }

  private updateTutorialMoveMarker(time: number) {
    const area = this.tutorialMoveMarkerArea;
    const label = this.tutorialMoveMarkerLabel;
    const arrow = this.tutorialMoveMarkerArrow;
    if (!area?.active || !label?.active || !arrow?.active) return;

    const active = this.tutorialMode && !this.tutorialComplete && this.tutorialStep === 0;
    area.setVisible(active);
    label.setVisible(active);
    arrow.setVisible(active);
    if (!active) return;

    const x = this.tutorialMoveTargetX;
    const y = this.getTerrainHeight(x);
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.006);
    area.setPosition(x, y - 92);
    area.setAlpha(0.08 + pulse * 0.12);
    label.setPosition(x, y - 206);
    label.setAlpha(0.72 + pulse * 0.28);
    arrow.setPosition(x, y - 164 + Math.sin(time * 0.008) * 6);
    arrow.setAlpha(0.78 + pulse * 0.22);
  }

  private setupTutorialScenario() {
    if (!this.tutorialMode || !this.player?.chassis?.active) return;

    this.tutorialStep = 0;
    this.tutorialStepStartedAt = this.time.now;
    this.tutorialComplete = false;
    this.tutorialLiftSatisfied = false;
    this.tutorialMainShellShots = 0;
    this.tutorialMortarShots = 0;
    this.tutorialNukeShots = 0;
    this.tutorialStepMainShotStart = 0;
    this.tutorialStepMortarShotStart = 0;
    this.tutorialStepNukeShotStart = 0;
    this.tutorialCooldownBypass = 'none';
    this.tutorialSwitchVisitedShells.clear();
    this.tutorialGateBlockedHintUntil = 0;
    this.tutorialGateLastBlockAt = 0;
    this.tutorialLakeBounds = null;
    this.tutorialDummyTarget = null;
    this.tutorialUiNextRefreshAt = 0;

    const startX = this.player.chassis.x;
    this.tutorialMoveTargetX = startX + 420;
    this.createTutorialMoveMarker();

    this.createTutorialLakeNoBridge(startX + 1800, startX + 2860);

    const targetX = startX + 1180;
    this.tutorialDummyTarget = this.spawnTutorialDummyTarget(targetX, TankType.ENEMY_PANZER);

    const exitX = (this.tutorialLakeBounds?.x1 ?? (startX + 2860)) + 4200;
    this.createTutorialExitBase(exitX);

    this.ensureTutorialUi();
    this.setTutorialStep(0, true);
  }

  private setTutorialStep(step: number, force: boolean = false) {
    if (!this.tutorialMode) return;
    const clamped = Phaser.Math.Clamp(step, 0, this.tutorialTotalSteps - 1);
    if (!force && clamped === this.tutorialStep) return;

    if (this.tutorialCooldownBypass !== 'none' && this.player?.active) {
      this.player.setNoCooldown(false);
      this.tutorialCooldownBypass = 'none';
    }

    this.tutorialStep = clamped;
    this.tutorialStepStartedAt = this.time.now;
    this.tutorialUiNextRefreshAt = 0;

    if (clamped === 1) {
      this.tutorialSwitchVisitedShells.clear();
      this.tutorialSwitchVisitedShells.add(ShellType.STANDARD);
    }
    if (clamped === 2) {
      this.tutorialStepMainShotStart = this.tutorialMainShellShots;
    }
    if (clamped === 5) {
      this.tutorialStepMortarShotStart = this.tutorialMortarShots;
    }
    if (clamped === 6) {
      this.tutorialStepNukeShotStart = this.tutorialNukeShots;
    }

    if (this.player?.active) {
      if (clamped === 1) this.player.setShell(ShellType.STANDARD);
      if (clamped === 2) this.player.setShell(ShellType.STANDARD);
      if (clamped === 5) {
        this.player.setShell(ShellType.MORTAR);
        this.player.grantOneTimeCooldownWaiver(ShellType.MORTAR);
        this.player.setNoCooldown(true);
        this.tutorialCooldownBypass = 'mortar';
      }
      if (clamped === 6) {
        this.player.setShell(ShellType.NUKE);
        this.player.grantOneTimeCooldownWaiver(ShellType.NUKE);
        this.player.setNoCooldown(true);
        this.tutorialCooldownBypass = 'nuke';
      }
    }

    this.refreshTutorialUi();
    this.updateTutorialMoveMarker(this.time.now);
  }

  private completeTutorial() {
    if (!this.tutorialMode || this.tutorialComplete) return;
    this.tutorialComplete = true;
    if (this.player?.active) this.player.setNoCooldown(false);

    if (this.tutorialUiTitle?.active) this.tutorialUiTitle.setText('教程完成');
    if (this.tutorialUiBody?.active) this.tutorialUiBody.setText('已到达撤离基地，正在返回主菜单...');
    if (this.tutorialUiStep?.active) this.tutorialUiStep.setText('任务已完成');

    this.cameras.main.fade(850, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.softResetAudioForSceneTransition();
      this.scene.start('MenuScene');
    });
  }

  private getTutorialForwardLimitX(): number {
    if (!this.player?.chassis?.active) return Number.POSITIVE_INFINITY;
    const dummyX = this.tutorialDummyTarget?.chassis?.active
      ? this.tutorialDummyTarget.chassis.x
      : (this.tutorialMoveTargetX + 760);
    const lakeX1 = this.tutorialLakeBounds?.x1 ?? (dummyX + 1700);
    switch (this.tutorialStep) {
      case 0:
        return this.tutorialMoveTargetX + 60;
      case 1:
        return dummyX - 260;
      case 2:
        return dummyX - 180;
      case 3:
        return dummyX + 220;
      case 4:
        return lakeX1 + 240;
      case 5:
      case 6:
        return lakeX1 + 620;
      default:
        return Number.POSITIVE_INFINITY;
    }
  }

  private enforceTutorialProgressGate(time: number) {
    if (!this.tutorialMode || this.tutorialComplete || !this.player?.chassis?.active) return;
    const limitX = this.getTutorialForwardLimitX();
    if (!Number.isFinite(limitX)) return;

    const chassis = this.player.chassis;
    if (chassis.x <= limitX) return;
    const overflow = chassis.x - limitX;
    const body = chassis.body as Phaser.Physics.Arcade.Body | undefined;

    chassis.x = limitX;
    if (body) {
      body.x = chassis.x - body.halfWidth;
      body.setVelocityX(Math.min(0, body.velocity.x - Math.min(220, 110 + overflow * 2.1)));
    }

    if (time >= this.tutorialGateLastBlockAt + 240) {
      this.tutorialGateLastBlockAt = time;
      this.tutorialGateBlockedHintUntil = time + 1100;
      this.refreshTutorialUi();
    }
  }

  private updateTutorialMode(time: number) {
    if (!this.tutorialMode || this.tutorialComplete || !this.player?.chassis?.active) return;

    this.ensureTutorialUi();
    this.updateTutorialMoveMarker(time);
    if (time >= this.tutorialUiNextRefreshAt) {
      this.refreshTutorialUi();
      this.tutorialUiNextRefreshAt = time + 200;
    }

    const stepElapsed = Math.max(0, time - this.tutorialStepStartedAt);
    this.enforceTutorialProgressGate(time);
    const px = this.player.chassis.x;
    const py = this.player.chassis.y;

    if (this.tutorialLakeBounds) {
      const l = this.tutorialLakeBounds;
      if (px >= l.x0 && px <= l.x1 && py < l.waterY + 6) {
        this.tutorialLiftSatisfied = true;
      }
    }

    if (this.tutorialStep === 1) {
      this.tutorialSwitchVisitedShells.add(this.player.currentShell);
    }

    switch (this.tutorialStep) {
      case 0:
        if (px >= this.tutorialMoveTargetX) this.setTutorialStep(1);
        break;
      case 1:
        if (this.hasTutorialShellSwitchCompleted()) this.setTutorialStep(2);
        break;
      case 2:
        if (this.tutorialMainShellShots > this.tutorialStepMainShotStart) {
          this.setTutorialStep(3);
          break;
        }
        if (stepElapsed > 9000 && this.player.currentShell !== ShellType.STANDARD) {
          this.player.setShell(ShellType.STANDARD);
        }
        break;
      case 3:
        if (!this.tutorialDummyTarget?.active || this.tutorialDummyTarget.isDead) {
          this.setTutorialStep(4);
          break;
        }
        if (stepElapsed > 30000) {
          const dummyX = this.tutorialDummyTarget?.chassis?.active ? this.tutorialDummyTarget.chassis.x : (this.tutorialMoveTargetX + 720);
          if (px > dummyX + 420) this.setTutorialStep(4);
        }
        break;
      case 4:
        if (this.tutorialLakeBounds && px > this.tutorialLakeBounds.x1 + 120) {
          this.tutorialLiftSatisfied = true;
          this.setTutorialStep(5);
        }
        break;
      case 5:
        if (this.player.currentShell !== ShellType.MORTAR && stepElapsed > 500) {
          this.player.setShell(ShellType.MORTAR);
        }
        if (this.tutorialMortarShots > this.tutorialStepMortarShotStart) this.setTutorialStep(6);
        break;
      case 6:
        if (this.player.currentShell !== ShellType.NUKE && stepElapsed > 500) {
          this.player.setShell(ShellType.NUKE);
        }
        if (this.tutorialNukeShots > this.tutorialStepNukeShotStart) this.setTutorialStep(7);
        break;
      case 7: {
        const zone = this.tutorialExitZone;
        if (zone?.active) {
          const bounds = zone.getBounds();
          const nearX = Math.abs(px - zone.x) <= bounds.width * 0.55;
          if (Phaser.Geom.Rectangle.Contains(bounds, px, py) || nearX) this.completeTutorial();
        }
        break;
      }
      default:
        break;
    }

    if (this.tutorialUiPanel?.active) {
      const k = 0.46 + 0.05 * Math.sin(time * 0.0035);
      this.tutorialUiPanel.setFillStyle(0x000000, k);
    }
  }

  private createForestExitBase() {
    const baseX = this.WORLD_WIDTH - 1400;
    const zoneW = 1200;
    const zoneH = 720;
    const gy = this.getTerrainHeight(baseX);
    const zone = this.add.rectangle(baseX, gy - 240, zoneW, zoneH, 0, 0).setVisible(false);
    this.physics.add.existing(zone, true);
    this.forestExitZone = zone;

    if (this.player?.chassis?.active) {
      this.physics.add.overlap(this.player.chassis, zone, () => this.triggerForestExit(), undefined, this);
    }

    const embed = 520;
    const above = 520;
    const offsets = [-450, -330, -210, -90, 90, 210, 330, 450];
    for (const off of offsets) {
      const poleX = baseX + off;
      const groundY = this.getTerrainHeight(poleX);
      const pole = this.add.rectangle(poleX, groundY + embed, 5, embed + above, 0x333333).setOrigin(0.5, 1).setDepth(24);
      const topY = pole.y - (embed + above);
      this.createClothFlag(pole.x, topY + 42);
    }
  }

  private triggerForestExit() {
    if (this.forestExitTriggered) return;
    if (this.testRoomEnabled) return;
    if (this.mapId !== 'forest') return;
    this.forestExitTriggered = true;
    this.cameras.main.fade(900, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.showForestUnderDevelopmentScreen();
    });
  }

  private showForestUnderDevelopmentScreen() {
    this.softResetAudioForSceneTransition();
    this.physics.world.isPaused = true;
    this.cameras.main.stopFollow();
    this.cameras.main.resetFX();
    try { this.scene.stop('UIScene'); } catch {}

    const w = this.scale.width;
    const h = this.scale.height;
    const blocker = this.add
      .rectangle(w * 0.5, h * 0.5, w, h, 0x000000, 1)
      .setScrollFactor(0)
      .setDepth(100000);
    blocker.setInteractive({ useHandCursor: false });

    const title = this.add.text(w * 0.5, h * 0.5 - 8, '游戏开发中……', {
      fontFamily: 'Arial Black',
      fontSize: `${Math.round(Phaser.Math.Clamp(w * 0.08, 52, 112))}px`,
      color: '#f3f6ff',
      stroke: '#000000',
      strokeThickness: 8
    })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100001);

    const hint = this.add.text(w * 0.5, h * 0.5 + Math.round(Phaser.Math.Clamp(h * 0.11, 72, 140)), '点击任意位置返回主菜单', {
      fontFamily: 'Arial Black',
      fontSize: `${Math.round(Phaser.Math.Clamp(w * 0.027, 20, 38))}px`,
      color: '#9aa8bf',
      stroke: '#000000',
      strokeThickness: 6
    })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100001);

    let leaving = false;
    const goMenu = () => {
      if (leaving) return;
      leaving = true;
      try { this.input.off('pointerdown', goMenu, this); } catch {}
      try { blocker.off('pointerdown', goMenu); } catch {}
      this.softResetAudioForSceneTransition();
      this.scene.start('MenuScene');
    };

    this.input.on('pointerdown', goMenu, this);
    blocker.on('pointerdown', goMenu);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      try { this.input.off('pointerdown', goMenu, this); } catch {}
      try { blocker.off('pointerdown', goMenu); } catch {}
      try { blocker.destroy(); } catch {}
      try { title.destroy(); } catch {}
      try { hint.destroy(); } catch {}
    });
  }

  private createBaseRepairStation(pole: Phaser.GameObjects.Rectangle, flag: any) {
    const poleX = pole.x;
    const flagAnchorY = flag.anchorY;
    const lampY = flagAnchorY - 62;
    const loopId = `base_repair_spotlight_${Math.round(poleX)}_${Math.round(lampY)}`;
    const lamp = this.add.container(poleX, lampY).setDepth(25);
    const housing = this.add.rectangle(0, 0, 22, 10, 0x2b2b2b, 0.92).setStrokeStyle(2, 0x000000, 0.6);
    const lens = this.add.circle(9, 0, 4, 0xfff4a8, 0.9).setStrokeStyle(1, 0xffffff, 0.4);
    lamp.add([housing, lens]);

    const rays = this.add.graphics().setDepth(23);
    rays.setBlendMode(Phaser.BlendModes.ADD);

    this.baseRepairStations.push({
        poleX,
        lampY,
        lamp,
        rays,
        beamPhase: Math.random() * Math.PI * 2,
        lastSparkAt: 0,
        pole,
        flag,
        collapsed: false,
        loopId,
        spotlightActive: false
    });
  }

  private setRepairSpotlightLoop(station: (typeof this.baseRepairStations)[number], active: boolean) {
    if (active) {
      if (station.spotlightActive) return;
      station.spotlightActive = true;
      // Force a fresh start so each activation begins from a random loop offset.
      this.audio.stopLoop(station.loopId, 0);
      this.audio.startLoop(station.loopId, 'environment/forest/point_3d/static/flag/repair_spotlight_loop/sfx', {
        volume: 0.42,
        fadeInMs: 260,
        worldX: station.poleX,
        worldY: station.lampY,
        maxDistance: 1800,
        startAtRandomOffset: true
      }).catch(() => {});
      return;
    }

    if (!station.spotlightActive) return;
    station.spotlightActive = false;
    this.audio.stopLoop(station.loopId, 320);
  }

  public placeMine(x: number) {
    const y = this.getGroundHeight(x) - 6;
    const mine = this.mineGroup.get(x, y, 'shell_model') as Phaser.Physics.Arcade.Sprite | null;
    if (!mine) return;
    const prevGlow = mine.getData('mineGlow') as any;
    prevGlow?.destroy?.();
    const prevTween = mine.getData('mineTween') as any;
    prevTween?.stop?.();
    const prevSelfDestruct = mine.getData('mineSelfDestructEvent') as any;
    prevSelfDestruct?.remove?.();
    prevSelfDestruct?.destroy?.();

    mine.setActive(true).setVisible(true);
    mine.setDepth(33).setScale(1.55).setTint(0xfff04d);
    mine.setAlpha(1);
    (mine as any).setBlendMode?.(Phaser.BlendModes.NORMAL);
    mine.setData('isMine', true);
    mine.setData('armed', true);

    const glow = this.add.container(mine.x, mine.y).setDepth(32);
    const outer = this.add.ellipse(0, 0, 64, 28, 0xffb84d, 0).setBlendMode(Phaser.BlendModes.ADD);
    const mid = this.add.ellipse(0, 0, 36, 16, 0xfff2a8, 0).setBlendMode(Phaser.BlendModes.ADD);
    const core = this.add.ellipse(0, 0, 14, 7, 0xffffff, 0).setBlendMode(Phaser.BlendModes.ADD);
    glow.add([outer, mid, core]);
    mine.setData('mineGlow', glow);
    mine.once('destroy', () => { if (glow.active) glow.destroy(); });

    this.tweens.add({
      targets: outer,
      alpha: { from: 0.10, to: 0.60 },
      scale: { from: 0.85, to: 1.65 },
      duration: 920,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    this.tweens.add({
      targets: mid,
      alpha: { from: 0.15, to: 0.75 },
      scale: { from: 0.95, to: 1.35 },
      duration: 760,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    this.tweens.add({
      targets: core,
      alpha: { from: 0.18, to: 0.95 },
      scale: { from: 1.0, to: 1.15 },
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    const mineTween = this.tweens.add({
      targets: mine,
      scaleX: { from: 1.50, to: 1.58 },
      scaleY: { from: 1.50, to: 1.58 },
      angle: { from: -3.5, to: 3.5 },
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });
    mine.setData('mineTween', mineTween);
    const body = mine.body as Phaser.Physics.Arcade.StaticBody | undefined;
    body?.setSize(56, 44, true);
    mine.refreshBody();

    const selfDestructEvent = this.time.delayedCall(15000, () => {
      if (!mine.active) return;
      if (mine.getData('isMine') !== true) return;
      if (mine.getData('armed') !== true) return;
      this.explodeMine(mine);
    });
    mine.setData('mineSelfDestructEvent', selfDestructEvent);
  }

  private explodeMine(mineObj: any) {
    if (!mineObj?.active) return;
    if (mineObj.getData?.('isMine') !== true) return;
    if (mineObj.getData?.('armed') !== true) return;

    mineObj.setData('armed', false);
    const x = mineObj.x;
    const y = mineObj.y;

    const glow = mineObj.getData?.('mineGlow') as any;
    glow?.destroy?.();
    const tween = mineObj.getData?.('mineTween') as any;
    tween?.stop?.();
    const evt = mineObj.getData?.('mineSelfDestructEvent') as any;
    evt?.remove?.();
    evt?.destroy?.();

    mineObj.destroy?.();

    const radius = 500;
    const damage = 1500 * 0.8;
    this.triggerExplosion(x, y, radius, damage, true, ShellType.HE, this.player);
  }

  private handleMineTrigger(mineObj: any, enemyObj: any) {
    if (!mineObj?.active) return;
    if (mineObj.getData?.('isMine') !== true) return;
    if (mineObj.getData?.('armed') !== true) return;

    const tankRef = enemyObj?.getData?.('tankRef');
    if (tankRef && typeof tankRef.isDead === 'boolean' && tankRef.isDead) return;
    if (enemyObj && typeof enemyObj.isDead === 'boolean' && enemyObj.isDead) return;
    this.explodeMine(mineObj);
  }

  private setupInput() {
    const isTouch = this.sys.game.device.input.touch;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (isTouch) return;
      if (p.rightButtonDown()) {
        this.mouseMgHeld = true;
        const evt = p.event as MouseEvent | PointerEvent | undefined;
        evt?.preventDefault?.();
      }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (isTouch) return;
      const evt = p.event as MouseEvent | PointerEvent | undefined;
      if (evt?.button === 2) this.mouseMgHeld = false;
    });
    this.input.on('wheel', (pointer: any, gameObjects: any, dx: number, dy: number) => {
      const cam = this.cameras.main;
      cam.zoom = Phaser.Math.Clamp(cam.zoom + (dy > 0 ? -0.05 : 0.05), 0.1, 1.5);
    });
  }

  private handleResize(gameSize: Phaser.Structs.Size) {
    const cam = this.cameras.main;
    const w = gameSize.width;
    const h = gameSize.height;
    const isMobileViewport = this.sys.game.device.os.android || this.sys.game.device.os.iOS || this.sys.game.device.input.touch;
    if (isMobileViewport) {
      cam.setViewport(0, 0, w, h);
      this.updateMobileCameraFocusOffset();
      return;
    }

    const target = 16 / 9;
    const screenAspect = w / Math.max(1, h);
    if (screenAspect > target) {
      const vw = Math.floor(h * target);
      const vx = Math.floor((w - vw) * 0.5);
      cam.setViewport(vx, 0, vw, h);
    } else {
      const vh = Math.floor(w / target);
      const vy = Math.floor((h - vh) * 0.5);
      cam.setViewport(0, vy, w, vh);
    }
  }

  private updateMobileCameraFocusOffset() {
    const cam = this.cameras.main;
    if (!cam) return;

    if (!this.sys.game.device.os.android) {
      cam.setFollowOffset(0, 0);
      return;
    }

    const zoom = Math.max(0.05, cam.zoom || 1);
    const leftBiasPx = cam.width * 0.22;
    cam.setFollowOffset(-(leftBiasPx / zoom), 0);
  }

  public requestHitStop(durationMs: number) { this.hitStopTimer = durationMs; }

  public triggerRecoil(chassis: Phaser.Physics.Arcade.Sprite, angle: number) {
    chassis.x -= Math.cos(angle) * 22; chassis.y -= Math.sin(angle) * 22;
  }

  public checkLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
      // 1. Check Buildings
      if (this.buildings.checkLineOfSight(x1, y1, x2, y2)) return false;

      // 2. Check Terrain
      // Sample points along the line to see if any are below ground level
      const dist = Phaser.Math.Distance.Between(x1, y1, x2, y2);
      const steps = Math.ceil(dist / 40); // Check every 40 pixels
      
      for (let i = 1; i < steps; i++) {
          const t = i / steps;
          const px = x1 + (x2 - x1) * t;
          const py = y1 + (y2 - y1) * t;
          
          const groundH = this.getTerrainHeight(px);
          // If the point is significantly below the ground surface, it's blocked.
          // We allow a small tolerance (e.g. 10px) to avoid blocking shots that graze the ground.
          if (py > groundH + 10) {
              return false; // Blocked by terrain
          }
      }

      return true; // Clear line of sight
  }

  public getTracerLength(x: number, y: number, angle: number, maxLength: number, owner?: Tank): number {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    let best = maxLength;
    const considerRect = (rect: Phaser.Geom.Rectangle | undefined) => {
      if (!rect) return;
      const t = this.rayRectDistance(x, y, dx, dy, rect);
      if (t !== null && t >= 0 && t < best) best = t;
    };

    if (this.player?.active && this.player !== owner && !this.player.isDead) considerRect(this.player.getBounds?.());
    for (const e of this.enemies) {
      if (!e?.active || e === owner) continue;
      if (e.isDead) continue;
      considerRect(e.getBounds?.());
    }

    for (const s of this.enemyInfantry.soldiers) {
      if (!s?.active || !s.torso?.active) continue;
      considerRect(s.torso.getBounds());
    }
    for (const s of this.allies.soldiers) {
      if (!s?.active || !s.torso?.active) continue;
      considerRect(s.torso.getBounds());
    }

    const coarseStep = 80;
    const fineStep = 20;
    const limit = Math.min(best, maxLength);

    for (let dist = 0; dist <= limit; dist += coarseStep) {
      const px = x + dx * dist;
      const py = y + dy * dist;
      const terrainHit = py > this.getTerrainHeight(px) + 6;
      const buildingHit = !terrainHit && this.buildings.isPointBlocked(px, py);
      if (!terrainHit && !buildingHit) continue;

      const start = Math.max(0, dist - coarseStep);
      for (let d = start; d <= dist; d += fineStep) {
        const fx = x + dx * d;
        const fy = y + dy * d;
        if (fy > this.getTerrainHeight(fx) + 6) return Math.min(d, best);
        if (this.buildings.isPointBlocked(fx, fy)) return Math.min(d, best);
      }
      return Math.min(dist, best);
    }

    return best;
  }

  public getProjectileTexture(type: ShellType): string {
    switch (type) {
      case ShellType.BULLET: return 'proj_bullet';
      case ShellType.STANDARD: return 'proj_standard';
      case ShellType.HE: return 'proj_he';
      case ShellType.AP: return 'proj_ap';
      case ShellType.INCENDIARY: return 'proj_incendiary';
      case ShellType.MORTAR: return 'proj_mortar';
      case ShellType.NUKE: return 'proj_nuke';
      default: return 'shell_model';
    }
  }

  private rayRectDistance(x: number, y: number, dx: number, dy: number, rect: Phaser.Geom.Rectangle): number | null {
    const left = rect.left;
    const right = rect.right;
    const top = rect.top;
    const bottom = rect.bottom;

    let tmin = -Infinity;
    let tmax = Infinity;

    if (Math.abs(dx) < 1e-6) {
      if (x < left || x > right) return null;
    } else {
      const tx1 = (left - x) / dx;
      const tx2 = (right - x) / dx;
      tmin = Math.max(tmin, Math.min(tx1, tx2));
      tmax = Math.min(tmax, Math.max(tx1, tx2));
    }

    if (Math.abs(dy) < 1e-6) {
      if (y < top || y > bottom) return null;
    } else {
      const ty1 = (top - y) / dy;
      const ty2 = (bottom - y) / dy;
      tmin = Math.max(tmin, Math.min(ty1, ty2));
      tmax = Math.min(tmax, Math.max(ty1, ty2));
    }

    if (tmax < 0) return null;
    if (tmin > tmax) return null;
    return tmin >= 0 ? tmin : tmax;
  }

  public triggerExplosion(
    x: number,
    y: number,
    radius: number,
    damage: number,
    isDirectTankHit: boolean = false,
    shellType: ShellType = ShellType.HE,
    owner?: any,
    visual: 'shell' | 'vehicle' = 'shell',
    impactAngle: number = 0,
    impactMaterial: 'auto' | 'mud' | 'flesh' | 'metal' = 'auto'
  ) {
    if (this.activeExplosionsCount >= this.MAX_ACTIVE_EXPLOSIONS) return;
    this.activeExplosionsCount++;
    const visualScale = (shellType === ShellType.HE || shellType === ShellType.INCENDIARY || shellType === ShellType.MORTAR || shellType === ShellType.STANDARD) ? 0.2 : 1.0;
    const scaledVisualRadius = radius * visualScale;
    const baseShake = shellType === ShellType.MORTAR ? 0.15 : (shellType === ShellType.HE ? 0.05 : (shellType === ShellType.STANDARD ? 0.035 : (shellType === ShellType.INCENDIARY ? 0.03 : (isDirectTankHit ? 0.015 : 0.008))));
    const shakeIntensity = baseShake * 0.62;

    this.cameras.main.shake(500, shakeIntensity);
    const effectRadius = scaledVisualRadius * 0.5;

    const ownerIsEnemy = !!owner && owner !== this.player;
    const ownerIsPlayer =
      !!owner &&
      (owner === this.player ||
        owner === (this.player as any)?.chassis ||
        (owner as any)?.isPlayer === true ||
        (owner as any)?.owner === this.player);

    const weaponFolder = weaponFolderForShellType(shellType);

    if (shellType !== ShellType.BULLET) {
      const db3 = 1.4125375446227544;
      const db1 = 1.1220184543019633;
      const boostExplosionAndHit = shellType !== ShellType.AP && shellType !== ShellType.NUKE && shellType !== ShellType.MORTAR;
      const baseVol =
        shellType === ShellType.NUKE ? 1.0 :
        shellType === ShellType.MORTAR ? 0.9 :
        shellType === ShellType.HE ? 0.85 :
        shellType === ShellType.AP ? 0.8 :
        shellType === ShellType.INCENDIARY ? 0.75 :
        0.75;

      const explosionVol = Math.min(1.0, baseVol * (boostExplosionAndHit ? db3 : 1));
      this.audio.playFolderExclusiveCrossfade(`shell_explosion_${weaponFolder}`, `weapon/${weaponFolder}/explosion/sfx`, { worldX: x, worldY: y, volume: explosionVol, cooldownMs: 0, trackPosition: visual === 'vehicle' }, 500);

      if (isDirectTankHit) {
        const hitVehicleBaseVol = Math.min(1.0, baseVol + 0.1);
        const hitVehicleVol = Math.min(1.0, hitVehicleBaseVol * (boostExplosionAndHit ? db3 : 1));
        this.audio.playFolderExclusiveCrossfade(`shell_hit_vehicle_${weaponFolder}`, `weapon/${weaponFolder}/hit_vehicle/sfx`, { worldX: x, worldY: y, volume: hitVehicleVol, cooldownMs: 0, trackPosition: true }, 500);
      } else if (this.mapId === 'forest') {
        this.audio.playFolder(`weapon/${weaponFolder}/ground_hit_forest/sfx`, { worldX: x, volume: baseVol * 0.85, cooldownMs: 40 });
      }

      const reverbBaseVol = shellType === ShellType.NUKE ? 0.95 : (shellType === ShellType.MORTAR ? 0.8 : 0.7);
      const reverbFolder = this.mapId === 'forest'
        ? `weapon/${weaponFolder}/reverb_forest_after_explosion/sfx`
        : `weapon/${weaponFolder}/reverb/sfx`;
      const reverbVol = Math.min(1.0, reverbBaseVol * (this.mapId === 'forest' ? db1 : 1));
      if (this.mapId === 'forest') {
        const view = this.cameras.main.worldView;
        const lx = view.x + view.width * 0.5;
        const ly = view.y + view.height * 0.5;
        const minX = Math.min(x, lx);
        const maxX = Math.max(x, lx);
        let ridgeX = x;
        let ridgeY = this.getTerrainHeight(x);
        if (maxX - minX > 120) {
          const steps = 9;
          for (let i = 1; i < steps; i++) {
            const sx = minX + ((maxX - minX) * i) / steps;
            const ty = this.getTerrainHeight(sx);
            if (ty < ridgeY) {
              ridgeY = ty;
              ridgeX = sx;
            }
          }
        }
        const d0 = Phaser.Math.Distance.Between(x, y, lx, ly);
        const d1 = Phaser.Math.Distance.Between(x, y, ridgeX, ridgeY);
        const d2 = Phaser.Math.Distance.Between(ridgeX, ridgeY, lx, ly);
        const extra = Math.max(0, d1 + d2 - d0);
        const delayMs = Phaser.Math.Clamp(extra / 3.2, 80, 520);
        const detune = Phaser.Math.Between(-40, 40);
        const vol = Math.min(1.0, reverbVol * Phaser.Math.Clamp(1.0 - (d0 / 6000) * 0.3, 0.55, 1.0));
        this.time.delayedCall(delayMs, () => {
          this.audio.playFolderExclusiveCrossfade(
            `shell_reverb_${weaponFolder}`,
            reverbFolder,
            { worldX: ridgeX, worldY: ridgeY, volume: vol, detune, maxDistance: 5200, cooldownMs: 0, trackPosition: visual === 'vehicle' },
            500
          );
        });
      } else {
        this.audio.playFolderExclusiveCrossfade(`shell_reverb_${weaponFolder}`, reverbFolder, { worldX: x, worldY: y, volume: reverbVol, cooldownMs: 0, trackPosition: visual === 'vehicle' }, 500);
      }
    }

    if (shellType === ShellType.MORTAR) {
        this.particles.createMortarExplosion(x, y, radius * visualScale);
    } else if (shellType === ShellType.AP) {
        if (isDirectTankHit || visual === 'vehicle') this.particles.createAPImpactHeavy(x, y, impactAngle);
        else this.particles.createAPImpact(x, y, impactAngle);
    } else if (shellType === ShellType.INCENDIARY) {
        this.particles.createIncendiaryExplosion(x, y, effectRadius * 5.0);
        this.applyTerrainBurn(x, Math.max(240, scaledVisualRadius * 1.6), 0.7);
        this.drawTerrain();
        const burnDurationMs = 6000;
        const burnDotPct = 0.04;
        const burnLoopId = `p_burning_${Phaser.Utils.String.UUID()}`;
        const burnY = Math.min(y, this.getTerrainHeight(x));
        this.audio.startLoop(burnLoopId, `weapon/${weaponFolder}/burning_loop/sfx`, { volume: 0.55, fadeInMs: 120, worldX: x, worldY: burnY, maxDistance: 5200 })
          .catch(() => {});
        this.time.delayedCall(burnDurationMs, () => this.audio.stopLoop(burnLoopId, 1200));

        let directVictim: any | null = null;
        if (isDirectTankHit) {
            const candidates = ownerIsEnemy ? [this.player] : [...this.enemies];
            let best = Infinity;
            for (const t of candidates) {
                if (!t?.active) continue;
                if (t === owner) continue;
                if (ownerIsEnemy && t !== this.player) continue;
                let targetX = (t as any).x;
                let targetY = (t as any).y;
                if (t instanceof LandSubmarine) {
                    const b = t.getBounds();
                    targetX = b.centerX;
                    targetY = b.centerY;
                }
                const d = Phaser.Math.Distance.Between(x, y, targetX, targetY);
                if (d < best) {
                    best = d;
                    directVictim = t;
                }
            }

            if (directVictim && best < 260 && typeof (directVictim as any).takeDamage === 'function') {
                const burnStartT = this.time.now;
                if (typeof (directVictim as any).markBurningVisual === 'function') {
                    (directVictim as any).markBurningVisual(burnStartT, burnDurationMs);
                }

                this.time.addEvent({
                    delay: 1000,
                    repeat: 5,
                    callback: () => {
                        if (!directVictim?.active || (directVictim as any).isDead) return;
                        (directVictim as any).takeDamage((directVictim as any).maxHp * burnDotPct, ShellType.INCENDIARY);
                    }
                });
            }
        }

        this.time.addEvent({
            delay: 1000, repeat: 5, 
            callback: () => {
                const bx = x + Phaser.Math.Between(-scaledVisualRadius * 0.6, scaledVisualRadius * 0.6);
                this.particles.createWPBurn(bx, y, scaledVisualRadius * 2.0);
                const burnRad = Math.max(180, scaledVisualRadius * 1.2);
                this.applyTerrainBurn(bx, burnRad, 0.18);
                this.drawTerrain();
                const targets = [this.player, ...this.enemies];
                targets.forEach(t => {
                    if (t === owner || !t.active) return;
                    if (ownerIsEnemy && t !== this.player) return;
                    if (directVictim && t === directVictim) return;
                    let targetX = (t as any).x;
                    let targetY = (t as any).y;
                    if (t instanceof LandSubmarine) {
                      const b = t.getBounds();
                      targetX = b.centerX;
                      targetY = b.centerY;
                    }
                    if (Phaser.Math.Distance.Between(bx, y, targetX, targetY) < burnRad) {
                      if (ownerIsPlayer) this.markPlayerDamage(t, 2200);
                      t.takeDamage(t.maxHp * burnDotPct, ShellType.INCENDIARY);
                    }
                });
                if (!ownerIsEnemy) this.enemyInfantry.applyDamage(bx, y, burnRad * 0.75, 0, ShellType.INCENDIARY);
                this.allies.applyDamage(bx, y, burnRad * 0.75, 0, ShellType.INCENDIARY);
            }
        });
    } else {
        if (visual === 'vehicle') this.particles.createVehicleExplosion(x, y, effectRadius * 2.5);
        else this.particles.createExplosion(x, y, effectRadius * 2.5, shellType === ShellType.HE, shellType === ShellType.HE || shellType === ShellType.STANDARD);
    }

    const waterY = this.getWaterSurfaceY(x);
    const isWaterImpact = waterY !== null && y >= waterY - 12;
    const impactGroundY = this.getTerrainHeight(x);
    const verticalGapToGround = Math.max(0, impactGroundY - y);
    const groundCoupleRange =
      shellType === ShellType.MORTAR ? Math.max(240, scaledVisualRadius * 20) :
      shellType === ShellType.HE ? Math.max(210, scaledVisualRadius * 16) :
      shellType === ShellType.STANDARD ? Math.max(170, scaledVisualRadius * 12) :
      shellType === ShellType.INCENDIARY ? Math.max(150, scaledVisualRadius * 10) :
      Math.max(130, scaledVisualRadius * 9);
    const groundCouplingLinear = Phaser.Math.Clamp(1 - verticalGapToGround / groundCoupleRange, 0, 1);
    const groundCoupling = groundCouplingLinear * groundCouplingLinear;

    let resolvedImpactMaterial: 'mud' | 'flesh' | 'metal';
    if (impactMaterial !== 'auto') {
      resolvedImpactMaterial = impactMaterial;
    } else if (visual === 'vehicle' || isDirectTankHit) {
      resolvedImpactMaterial = 'metal';
    } else {
      resolvedImpactMaterial = 'mud';
    }

    const hasSolidImpactMaterial = resolvedImpactMaterial === 'metal' || resolvedImpactMaterial === 'flesh';
    const mudImpactStrongEnough = groundCoupling > 0.08;
    if (!isWaterImpact && shellType !== ShellType.BULLET && (hasSolidImpactMaterial || mudImpactStrongEnough)) {
      const fragRadiusBase = Math.max(120, scaledVisualRadius * (resolvedImpactMaterial === 'metal' ? 1.7 : 1.35));
      const fragCoupling = resolvedImpactMaterial === 'mud' ? Phaser.Math.Linear(0.25, 1.0, groundCoupling) : 1.0;
      const fragRadius = fragRadiusBase * fragCoupling;
      const fragY = resolvedImpactMaterial === 'mud' ? impactGroundY : y;
      const armorPiercingMetalHit =
        resolvedImpactMaterial === 'metal' &&
        shellType === ShellType.AP &&
        (isDirectTankHit || visual === 'vehicle');
      this.particles.createImpactMaterialFragments(x, fragY, fragRadius, resolvedImpactMaterial, {
        armorPiercing: armorPiercingMetalHit
      });

      if (resolvedImpactMaterial === 'metal' && (isDirectTankHit || visual === 'vehicle')) {
        this.particles.createVehicleHitAccent(x, y, shellType, impactAngle);
      }
    }

    if (waterY !== null) {
        if (y >= waterY - 12) {
            const depth = Math.max(0, y - waterY);
            const strength = Phaser.Math.Clamp(scaledVisualRadius * 3.0 + depth * 2.5, 120, 2200);
            this.particles.createWaterSplash(x, waterY + 2, strength);
        }
    }

    this.applyBridgeExplosionDamage(x, y, scaledVisualRadius, shellType);
    
    const trees = this.treeGroup.getChildren() as any[];
    for (let i = 0; i < trees.length; i++) {
        const t = trees[i];
        const d = Phaser.Math.Distance.Between(x, y, t.x, t.y - 100);
        if (d < radius * 2.5 * visualScale && !t.getData('collapsed')) {
            this.handleTreeCollision(null, t);
        }
    }

    const vegetation = this.vegetationGroup.getChildren() as any[];
    const vegetationHitRadius = radius * (shellType === ShellType.HE ? 5.0 : 2.5) * visualScale;
    for (let i = 0; i < vegetation.length; i++) {
        const v = vegetation[i];
        const d = Phaser.Math.Distance.Between(x, y, v.x, v.y);
        // Wider destruction radius for vegetation to prevent floating artifacts
        if (d < vegetationHitRadius) {
            const texKey = v.texture?.key as string | undefined;
            if (texKey === 'veg_tree' || texKey === 'veg_tree_0' || texKey === 'veg_tree_1' || texKey === 'veg_tree_2' || texKey === 'veg_pine' || texKey === 'veg_cactus') {
              const folderKey = texKey?.startsWith('veg_tree') ? 'veg_tree' : texKey;
              this.audio.playFolder(`environment/forest/point_3d/static/plants/vegetation/${folderKey}/hit_by_explosion/sfx`, { worldX: v.x, volume: 0.85, cooldownMs: 120 });
            }
            this.particles.createExhaust(v.x, v.y);
            v.destroy();
        }
    }

    // Damage animals
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      if (!a.active) {
        this.animals.splice(i, 1);
        continue;
      }
      const dist = Phaser.Math.Distance.Between(x, y, a.x, a.y);
      if (dist < radius * 1.5 * visualScale) {
        a.takeDamage(damage * (1 - dist / (radius * 1.5 * visualScale)), 'shell');
      }
    }

    let buildingDamageRadiusMult = 1.0;
    if (shellType === ShellType.AP) buildingDamageRadiusMult = 0.4;
    else if (shellType === ShellType.INCENDIARY) buildingDamageRadiusMult = 0.3;
    else if (shellType === ShellType.HE) buildingDamageRadiusMult = 1.8;
    else if (shellType === ShellType.STANDARD) buildingDamageRadiusMult = 1.0;
    else if (shellType === ShellType.MORTAR) buildingDamageRadiusMult = 2.5;

    this.buildings.applyExplosion(x, y, radius * buildingDamageRadiusMult * visualScale);
    
    const terrainCoupling = groundCoupling;
    if (terrainCoupling > 0.04) {
        const craterRadiusBase = (isDirectTankHit ? radius * 0.45 : radius * 0.25) * visualScale;
        const craterRadius = craterRadiusBase * Phaser.Math.Linear(0.25, 1.0, terrainCoupling);
        const centerIdx = Math.round(x / this.TERRAIN_STEP);
        const hStretchBase = (shellType === ShellType.HE || shellType === ShellType.MORTAR) ? 14.4 : (shellType === ShellType.STANDARD ? 8.0 : (shellType === ShellType.INCENDIARY ? 10.0 : 1.0));
        const hStretch = hStretchBase * Phaser.Math.Linear(0.58, 1.0, terrainCoupling);
        const radIdx = Math.ceil((craterRadius * hStretch) / this.TERRAIN_STEP);
        let terrainChanged = false;

        for (let i = centerIdx - radIdx; i <= centerIdx + radIdx; i++) {
          if (i >= 0 && i < this.terrainHeights.length) {
            const distX = Math.abs(x - i * this.TERRAIN_STEP);
            if (distX < craterRadius * hStretch) {
              const depthFactor = shellType === ShellType.AP ? 1.5 : (shellType === ShellType.STANDARD ? 1.15 : 1.3);
              const maxDepthBase = isDirectTankHit ? 45 : (shellType === ShellType.AP ? 30 : (shellType === ShellType.MORTAR ? 150 : (shellType === ShellType.STANDARD ? 40 : (shellType === ShellType.INCENDIARY ? 26 : 80))));
              const maxDepth = maxDepthBase * terrainCoupling;
              if (maxDepth <= 0.2) continue;
              const normDist = distX / (craterRadius * hStretch);
              const profile = Math.pow(Math.cos(normDist * (Math.PI / 2)), 2);
              const depth = maxDepth * profile * depthFactor;
              if (depth > 0.3) {
                this.terrainHeights[i] = Math.min(this.terrainHeights[i] + depth, this.bedrockY);
                if (depth > 0.5) this.terrainDamage[i] = 1.0;
                terrainChanged = true;
              }
            }
          }
        }

        if (terrainChanged) {
          // Smooth terrain damage to avoid sharp visual cutoffs
          this.smoothTerrainDamage(centerIdx - radIdx - 5, centerIdx + radIdx + 5);

          this.drawTerrain(); this.updateTerrainPhysics(); this.refreshStreamsAfterTerrainChange(); this.refreshLakesAfterTerrainChange();
          this.snapVegetationToTerrainInRange(x - (craterRadius * hStretch + 300), x + (craterRadius * hStretch + 300));

          // Wake up debris in the area AFTER physics update so they fall into the crater
          const debrisWakeRange = radius * 6.0 * visualScale * Phaser.Math.Linear(0.35, 1.0, terrainCoupling);
          const debrisChildren = this.debrisGroup.getChildren() as any[];
          for (let i = 0; i < debrisChildren.length; i++) {
              const d = debrisChildren[i];
              if (!d?.active) continue;
              if (Phaser.Math.Distance.Between(x, impactGroundY, d.x, d.y) >= debrisWakeRange) continue;
              const body = d.body as Phaser.Physics.Arcade.Body;
              if (!body) continue;
              body.setEnable(true);
              body.setAllowGravity(true);
              d.setData('sleeping', false);
              if (Math.abs(body.velocity.y) < 20) body.setVelocityY(20);
          }

          const terrainIntensity = Phaser.Math.Clamp(
            terrainCoupling * (shellType === ShellType.MORTAR ? 1.25 : (shellType === ShellType.HE ? 1.12 : 1.0)),
            0.2,
            1.5
          );
          const debrisRadius = craterRadius * (shellType === ShellType.HE ? 4 : (shellType === ShellType.MORTAR ? 10 : (shellType === ShellType.STANDARD ? 2 : 1))) * terrainIntensity;
          this.particles.createCraterDebris(x, impactGroundY, debrisRadius, resolvedImpactMaterial, terrainIntensity);
        }
    }
    const infRMult = shellType === ShellType.HE ? 2.5 : (shellType === ShellType.STANDARD ? 1.6 : 1.0);
    if (!ownerIsEnemy) this.enemyInfantry.applyDamage(x, y, radius * infRMult * visualScale, damage, shellType);
    this.allies.applyDamage(x, y, radius * infRMult * visualScale, damage, shellType);
    
    const rMult = (shellType === ShellType.HE || shellType === ShellType.MORTAR) ? 3.0 : (shellType === ShellType.STANDARD ? 2.0 : 1.0);
    const blastRange = (radius + 120) * rMult * visualScale;
    const applyExplosionToTarget = (t: any) => {
      if (t === owner || !t?.active) return;
      if (ownerIsEnemy && t !== this.player) return;

      let targetX = t.x as number;
      let targetY = t.y as number;
      if (t instanceof LandSubmarine) {
        const b = t.getBounds();
        targetX = b.centerX;
        targetY = b.centerY;
      }

      const d = Phaser.Math.Distance.Between(x, y, targetX, targetY);
      if (d >= blastRange) return;

      if (ownerIsPlayer) this.markPlayerDamage(t, 2200);

      const dealt = damage * (1 - d / blastRange);
      const onExplosionHit = (t as any).onExplosionHit as ((ex: number, ey: number, st: ShellType, dealt: number, owner?: any) => void) | undefined;
      if (typeof onExplosionHit === 'function') onExplosionHit.call(t, x, y, shellType, dealt, owner);
      t.takeDamage(dealt, shellType);
      if (shellType === ShellType.HE && t instanceof Tank) {
          t.applyStun(3000);
      }
    };

    applyExplosionToTarget(this.player);
    for (let i = 0; i < this.enemies.length; i++) {
      applyExplosionToTarget(this.enemies[i]);
    }
    this.time.delayedCall(300, () => this.activeExplosionsCount--);
  }

  private startNukeDrop(x: number, y: number, owner?: Tank, playDetonationSfx: boolean = true) {
    const groundY = this.getTerrainHeight(x);
    const detY = groundY;
    const cam = this.cameras.main;
    const view = cam.worldView;
    const startY = Math.min(detY - 2600, view.y - 900);
    const tex = this.getProjectileTexture(ShellType.NUKE);

    const nuke = this.add.image(x, startY, tex).setDepth(220);
    nuke.setScale(1.0);
    const baseRot = Math.PI / 2;
    nuke.setRotation(baseRot);

    const wobble = this.tweens.add({
      targets: nuke,
      rotation: { from: baseRot - 0.09, to: baseRot + 0.09 },
      duration: 360,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    this.tweens.add({
      targets: nuke,
      y: detY,
      scale: 14.0 / 3,
      duration: Phaser.Math.Clamp(Math.sqrt(Math.max(0, detY - startY)) * 24, 650, 2200),
      ease: 'Cubic.in',
      onComplete: () => {
        wobble.stop();
        nuke.destroy();
        this.triggerNuke(x, detY, owner, playDetonationSfx);
        this.time.delayedCall(10000, () => this.disperseBackgroundClouds(x));
      }
    });
  }

  private disperseBackgroundClouds(epicenterX: number) {
    const cam = this.cameras.main;
    const viewW = cam.width / Math.max(0.0001, cam.zoom);
    const pushDist = viewW * 0.9 + 2400;
    const epicScreenX = epicenterX - cam.scrollX;
    for (const cloud of this.backgroundClouds) {
      if (!cloud?.active) continue;
      const driftTween = cloud.getData('driftTween') as Phaser.Tweens.Tween | undefined;
      driftTween?.stop();
      cloud.setData('driftTween', undefined);

      const sf = (cloud as any).scrollFactorX ?? 1;
      const cloudScreenX = cloud.x - cam.scrollX * sf;
      const dx = cloudScreenX - epicScreenX;
      const dir = dx === 0 ? (Math.random() < 0.5 ? -1 : 1) : (dx < 0 ? -1 : 1);
      const distK = 0.75 + Math.random() * 0.55;
      const sideScatter = (Math.random() - 0.5) * viewW * 0.18;
      const yScatter = (Math.random() - 0.5) * 90;
      this.tweens.add({
        targets: cloud,
        x: cloud.x + dir * pushDist * distK + sideScatter,
        y: cloud.y + yScatter,
        duration: 8500 + Math.random() * 2200,
        ease: 'Sine.easeInOut'
      });
    }
  }

  private triggerNuke(x: number, y: number, owner?: Tank, playDetonationSfx: boolean = true) {
    const groundY = this.getTerrainHeight(x);
    const detY = Math.min(y, groundY);
    const cam = this.cameras.main;
    const screenWorldW = cam.width / Math.max(0.0001, cam.zoom);
    const craterDiameter = screenWorldW * 0.5;
    const craterRadius = craterDiameter * 0.5;
    const blastRadius = Math.max(5200, craterDiameter * 3.2);
    const ownerIsPlayer = !!owner && (owner === this.player || (owner as any)?.isPlayer === true);
    const now = this.time.now;

    const preferredNukeReverbFolder = this.mapId === 'forest'
      ? 'weapon/nuke/reverb_forest_after_explosion/sfx'
      : 'weapon/nuke/reverb/sfx';
    const nukeReverbFolder = this.audio.hasFolderAudio(preferredNukeReverbFolder)
      ? preferredNukeReverbFolder
      : 'weapon/nuke/reverb/sfx';

    if (playDetonationSfx) {
      const db1 = 1.1220184543019633;
      this.audio.playFolderExclusiveCrossfade('shell_explosion_nuke', 'weapon/nuke/explosion/sfx', {
        worldX: x,
        worldY: detY,
        maxDistance: 12000,
        volume: 1.0,
        cooldownMs: 0
      }, 500);
      const reverbVol = Math.min(1.0, 0.95 * (this.mapId === 'forest' ? db1 : 1));
      this.audio.playFolderExclusiveCrossfade('shell_reverb_nuke', nukeReverbFolder, {
        worldX: x,
        worldY: detY,
        maxDistance: 14000,
        volume: reverbVol,
        cooldownMs: 0
      }, 500);
    }

    this.audio.stopLoop('p_nuke_aftermath', 600);
    const nukeAftermathFolder = 'weapon/nuke/aftermath_debris_whirlwind_loop/sfx';
    if (this.audio.hasFolderAudio(nukeAftermathFolder)) {
      this.audio.startLoop('p_nuke_aftermath', nukeAftermathFolder, {
        volume: 0.55,
        fadeInMs: 2000,
        worldX: x,
        worldY: detY,
        maxDistance: 9000
      });
      this.time.delayedCall(45000, () => this.audio.stopLoop('p_nuke_aftermath', 3500));
    } else if (this.audio.hasFolderAudio(nukeReverbFolder)) {
      // Fallback tail: keeps aftermath ambience without missing-folder spam.
      this.audio.startLoop('p_nuke_aftermath', nukeReverbFolder, {
        volume: 0.42,
        fadeInMs: 1200,
        worldX: x,
        worldY: detY,
        maxDistance: 9000
      });
      this.time.delayedCall(12000, () => this.audio.stopLoop('p_nuke_aftermath', 2500));
    }

    this.cameras.main.shake(1400, 0.135);
    this.particles.createNukeExplosion(x, detY, craterRadius);

    const centerIdx = Math.round(x / this.TERRAIN_STEP);
    const radIdx = Math.ceil(craterRadius / this.TERRAIN_STEP);
    for (let i = centerIdx - radIdx; i <= centerIdx + radIdx; i++) {
      if (i < 0 || i >= this.terrainHeights.length) continue;
      const distX = Math.abs(x - i * this.TERRAIN_STEP);
      if (distX > craterRadius) continue;
      const t = Phaser.Math.Clamp(distX / craterRadius, 0, 1);
      const profile = Math.pow(Math.cos(t * (Math.PI / 2)), 2);
      const depth = 980 * profile;
      this.terrainHeights[i] = Math.min(this.terrainHeights[i] + depth, this.bedrockY);
    }
    this.drawTerrain();
    this.updateTerrainPhysics();
    this.refreshStreamsAfterTerrainChange();
    this.refreshLakesAfterTerrainChange();
    this.snapVegetationToTerrainInRange(x - (craterRadius + 700), x + (craterRadius + 700));
    this.particles.createCraterDebris(x, detY, craterRadius * 2.4);

    this.buildings.applyExplosion(x, detY, blastRadius * 0.9);

    this.treeGroup.getChildren().forEach((t: any) => {
        const d = Phaser.Math.Distance.Between(x, detY, t.x, t.y - 100);
        if (d < blastRadius && !t.getData('collapsed')) {
            const texKey = t.texture?.key as string | undefined;
            if (texKey && (texKey.startsWith('veg_tree') || texKey === 'veg_pine')) {
                 const folderKey = texKey.startsWith('veg_tree') ? 'veg_tree' : texKey;
                 const path = `environment/forest/point_3d/static/plants/vegetation/${folderKey}/hit_by_explosion/sfx`;
                 this.audio.playFolder(path, { worldX: t.x, volume: 1.0, cooldownMs: 0 });
             }
            this.handleTreeCollision(null, t);
        }
    });
    this.vegetationGroup.getChildren().forEach((v: any) => {
      if (Phaser.Math.Distance.Between(x, detY, v.x, v.y) < blastRadius * 0.9) {
        this.particles.createExhaust(v.x, v.y);
        v.destroy();
      }
    });

    this.enemyInfantry.applyDamage(x, detY, blastRadius, 999999, ShellType.HE);

    this.enemies.forEach(t => {
      if (!t?.active) return;
      if (t === owner) return;
      let tx = (t as any).x;
      let ty = (t as any).y;
      if (t instanceof LandSubmarine) {
        const b = t.getBounds();
        tx = b.centerX;
        ty = b.centerY;
      }
      const d = Phaser.Math.Distance.Between(x, detY, tx, ty);
      if (d > blastRadius) return;
      if (ownerIsPlayer) this.markPlayerDamage(t, 4000);
      if (t instanceof Tank) t.takeDamage(t.maxHp * 10, ShellType.HE);
      else t.takeDamage(999999, ShellType.HE);
    });

    const rainRadius = craterRadius * 2.2;
    const rainDuration = 45000;
    this.blackRainZones.push({ x, radius: rainRadius, until: now + rainDuration });
    if (this.mapId === 'forest') {
      this.ensureBlackRainLoop(0);
    }
    this.particles.createBlackRain(x, rainRadius, rainDuration);
  }

  private handleSafeZoneEntry() {
    const bounds = this.getSafeZoneBounds(this.player?.chassis?.x ?? 0);
    const zoneKey = `${bounds.x0}|${bounds.x1}`;
    const alreadySettled = this.settledSafeZones.has(zoneKey);

    const rescued = this.allies.soldiers.filter(s => s.active && !s.getData('retired')).length;
    this.savedInCurrentRound += rescued;
    this.allies.soldiers.forEach(s => { if (s.active) s.setData('retired', true); });

    if (alreadySettled) return;
    this.settledSafeZones.add(zoneKey);

    const rescuedPts = rescued * 500;
    const infantryPts = this.infantryKills * 100;
    const vehicleItems = this.vehicleKillBreakdown.slice();
    const vehiclePts = vehicleItems.reduce((sum, it) => sum + (Number(it.points) || 0), 0);
    const settleTotalPts = rescuedPts + infantryPts + vehiclePts;
    const steps: { kind: string; label: string; points: number; tag: string; award?: boolean }[] = [];
    steps.push({ kind: 'special', label: '安全区到达！', points: 0, tag: '' });
    steps.push({ kind: 'special', label: `救下战友: ${rescued}`, points: rescuedPts, tag: '护送回安全区' });
    for (const it of vehicleItems) steps.push({ kind: 'vehicle', label: it.label, points: it.points, tag: '', award: false });
    steps.push({ kind: 'special', label: `歼敌人数: ${this.infantryKills}`, points: infantryPts, tag: '安全区结算' });
    steps.push({ kind: 'special', label: '结算完成', points: settleTotalPts, tag: `救下 ${rescued} | 歼敌 ${this.infantryKills} | 载具 ${this.vehicleKills}`, award: false });

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      this.time.delayedCall(i * 260, () => {
        if (s.award !== false && s.points !== 0) this.addScore(s.points);
        this.events.emit('kill-feed', { kind: s.kind, label: s.label, points: s.points, tag: s.tag, t: this.time.now });
      });
    }

    this.time.delayedCall(260 * steps.length + 100, () => {
      this.tankKills = 0;
      this.vehicleKills = 0;
      this.vehicleKillBreakdown = [];
      this.infantryKills = 0;
    });
  }

  private handlePreRender() {
    if (!this.sys.isActive() || !this.player || !this.player.active) return;
    
    if (!this.aimWorldOverrideActive) {
      const cam = this.cameras.main;
      const shakeX = Number((cam as any)?.shakeEffect?._offsetX ?? 0);
      const shakeY = Number((cam as any)?.shakeEffect?._offsetY ?? 0);
      const worldPoint = cam.getWorldPoint(this.aimScreen.x - cam.x - shakeX, this.aimScreen.y - cam.y - shakeY);
      this.aimWorld.set(worldPoint.x, worldPoint.y);
    }
    
    // Force Tank visual update (turret rotation & trajectory) to match new aimWorld
    if (typeof this.player.updateAiming === 'function') {
        this.player.updateAiming();
    }
  }

  private clearDesertStormVisuals() {
    for (let i = 0; i < this.desertStormEmitters.length; i++) {
      const emitter = this.desertStormEmitters[i];
      if (!emitter?.active) continue;
      try { emitter.stop?.(); } catch {}
      try { emitter.destroy(); } catch {}
    }
    this.desertStormEmitters = [];

    if (this.desertStormVisual?.active) this.desertStormVisual.destroy(true);
    this.desertStormVisual = null;

    if (this.desertStormBackdropFar?.active) this.desertStormBackdropFar.destroy();
    this.desertStormBackdropFar = null;
    if (this.desertStormBackdropNear?.active) this.desertStormBackdropNear.destroy();
    this.desertStormBackdropNear = null;
  }

  private initializeDesertStormScenario(now: number) {
    if (this.mapId !== 'desert') return;
    const estimatedPlayerShiftBoostSpeed = 180 * 2 * 1.8;
    this.desertStormSpeedPxPerSec = estimatedPlayerShiftBoostSpeed * 0.85;
    this.sandstormDir = 1;
    this.sandstormUntilT = Number.POSITIVE_INFINITY;
    this.desertStormFrontX = -420;
    this.desertStormLastSweepT = now;
    this.desertStormVisualLastUpdateT = 0;
    this.desertEscapeTriggered = false;
    this.wind = Math.max(240, Math.abs(this.wind));
    this.ensureDesertStormVisual();
  }

  private ensureDesertStormVisual() {
    if (this.desertStormVisual?.active) return;
    const worldTop = this.physics.world.bounds.top;
    const worldHeight = this.physics.world.bounds.height;
    const yCenter = worldTop + worldHeight * 0.5;
    const android = this.sys.game.device.os.android;
    const mobile = android || this.sys.game.device.os.iOS || this.sys.game.device.input.touch;
    const wall = this.add.container(this.desertStormFrontX, yCenter).setDepth(94);

    const shadow = this.add.rectangle(-760, 0, 1960, worldHeight + 1220, 0x1b1008, 0.44).setOrigin(0.5);
    const coreA = this.add.rectangle(-360, 0, 1560, worldHeight + 1060, 0x5e3415, 0.42).setOrigin(0.5);
    const coreB = this.add.rectangle(-60, 0, 1240, worldHeight + 980, 0x8b4e1f, 0.40).setOrigin(0.5);
    const dustA = this.add.rectangle(200, 0, 920, worldHeight + 920, 0xaf652b, 0.36).setOrigin(0.5);
    const dustB = this.add.rectangle(360, 0, 620, worldHeight + 860, 0xcf8340, 0.34).setOrigin(0.5);
    const edge = this.add.ellipse(450, 0, 420, worldHeight + 760, 0xf0b575, 0.42).setOrigin(0.5);
    const frontDense = this.add.ellipse(500, 0, 260, worldHeight + 700, 0xffddb1, 0.52).setOrigin(0.5);
    const swirlA = this.add.ellipse(140, -230, 840, 460, 0xc8752e, 0.22).setOrigin(0.5).setAngle(-14);
    const swirlB = this.add.ellipse(10, 240, 880, 500, 0xaa6127, 0.2).setOrigin(0.5).setAngle(12);

    const clumps: Phaser.GameObjects.Shape[] = [];
    const clumpCount = mobile ? 10 : 14;
    for (let i = 0; i < clumpCount; i++) {
      const cx = 70 + i * 38 + Phaser.Math.Between(-45, 45);
      const cy = Phaser.Math.Between(-520, 520);
      const w = Phaser.Math.Between(150, 360);
      const h = Phaser.Math.Between(120, 280);
      const a = Phaser.Math.FloatBetween(0.12, 0.26);
      const c = i % 2 === 0 ? 0xca7d35 : 0xb9692d;
      const clump = this.add.ellipse(cx, cy, w, h, c, a).setOrigin(0.5);
      clump.setData('baseX', cx);
      clump.setData('ampX', Phaser.Math.FloatBetween(8, 24));
      clump.setData('phase', Phaser.Math.FloatBetween(0, Math.PI * 2));
      clumps.push(clump);
    }

    wall.add([shadow, coreA, coreB, dustA, dustB, swirlA, swirlB, edge, frontDense, ...clumps]);
    wall.setData('shadow', shadow);
    wall.setData('coreA', coreA);
    wall.setData('coreB', coreB);
    wall.setData('dustA', dustA);
    wall.setData('dustB', dustB);
    wall.setData('edge', edge);
    wall.setData('frontDense', frontDense);
    wall.setData('swirlA', swirlA);
    wall.setData('swirlB', swirlB);
    wall.setData('clumps', clumps);
    this.desertStormVisual = wall;

    this.desertStormBackdropFar = null;
    this.desertStormBackdropNear = null;

    const smokeKey = this.textures.exists('smoke_puff')
      ? 'smoke_puff'
      : (this.textures.exists('cloud_0') ? 'cloud_0' : this.textures.getTextureKeys()[0]);
    const grainKey = this.textures.exists('fx_sand_grain') ? 'fx_sand_grain' : smokeKey;
    const ashFrequency = mobile ? 42 : 30;
    const ashQuantity = mobile ? 2 : 3;
    const grainFrequency = mobile ? 28 : 18;
    const grainQuantity = mobile ? 2 : 3;
    const chunkFrequency = mobile ? 68 : 46;
    const chunkQuantity = mobile ? 1 : 2;
    const streakFrequency = mobile ? 30 : 20;
    const streakQuantity = mobile ? 1 : 2;
    const densityScale = mobile ? 0.88 : 1.0;

    const ashLayer = this.add.particles(this.desertStormFrontX - 200, yCenter, smokeKey, {
      x: { min: -260, max: 180 },
      y: { min: -1060, max: 1060 },
      lifespan: { min: 2200, max: 4800 },
      frequency: ashFrequency,
      quantity: ashQuantity,
      maxParticles: mobile ? 92 : 150,
      scale: { start: 2.8 * densityScale, end: 8.8 * densityScale },
      alpha: { start: 0.56, end: 0 },
      tint: [0xe0bd86, 0xc6823d, 0x8e4d20],
      speedX: { min: 220, max: 540 },
      speedY: { min: -160, max: 160 }
    }).setDepth(96);

    const grainLayer = this.add.particles(this.desertStormFrontX - 40, yCenter, grainKey, {
      x: { min: -200, max: 160 },
      y: { min: -960, max: 960 },
      lifespan: { min: 900, max: 1900 },
      frequency: grainFrequency,
      quantity: grainQuantity,
      maxParticles: mobile ? 120 : 210,
      scale: { start: 1.2 * densityScale, end: 0.25 * densityScale },
      alpha: { start: 0.9, end: 0 },
      tint: [0xffefc4, 0xeec688, 0xc57b38],
      speedX: { min: 300, max: 760 },
      speedY: { min: -240, max: 240 },
      rotate: { min: 0, max: 360 }
    }).setDepth(97);

    const chunkLayer = this.add.particles(this.desertStormFrontX + 120, yCenter, smokeKey, {
      x: { min: -120, max: 100 },
      y: { min: -900, max: 900 },
      lifespan: { min: 1300, max: 2600 },
      frequency: chunkFrequency,
      quantity: chunkQuantity,
      maxParticles: mobile ? 52 : 84,
      scale: { start: 1.5 * densityScale, end: 4.2 * densityScale },
      alpha: { start: 0.32, end: 0 },
      tint: [0xf2bf80, 0xd48843, 0xa95e26],
      speedX: { min: 260, max: 620 },
      speedY: { min: -180, max: 180 }
    }).setDepth(98);
    const streakKey = this.textures.exists('fx_sand_streak_0')
      ? `fx_sand_streak_${Phaser.Math.Between(0, 2)}`
      : grainKey;
    const streakLayer = this.add.particles(this.desertStormFrontX + 160, yCenter, streakKey, {
      x: { min: -180, max: 140 },
      y: { min: -980, max: 980 },
      lifespan: { min: 540, max: 1250 },
      frequency: streakFrequency,
      quantity: streakQuantity,
      maxParticles: mobile ? 78 : 130,
      scale: { start: 0.95 * densityScale, end: 0.2 * densityScale },
      alpha: { start: 0.72, end: 0 },
      tint: [0xffebc2, 0xefc688, 0xcd7d35],
      speedX: { min: 420, max: 920 },
      speedY: { min: -260, max: 260 },
      rotate: { min: -30, max: 30 }
    }).setDepth(99);

    this.desertStormEmitters = [ashLayer, grainLayer, chunkLayer, streakLayer];
  }

  private updateDesertStormScenario(time: number, deltaMs: number) {
    if (this.mapId !== 'desert' || this.testRoomEnabled || this.tutorialMode) return;
    const dt = Math.max(0, Math.min(80, deltaMs)) / 1000;
    if (dt <= 0) return;

    const section = this.getDesertSectionAtX(this.desertStormFrontX + 600);
    const paceMul = section ? Phaser.Math.Linear(0.92, 1.15, section.drumDensity) : 1;
    const speed = this.desertStormSpeedPxPerSec * paceMul;
    this.desertStormFrontX += speed * dt;
    if (time >= this.desertStormVisualLastUpdateT + this.desertStormVisualStrideMs) {
      this.desertStormVisualLastUpdateT = time;
      this.updateDesertStormVisual(time);
    }

    if (time > this.desertStormLastSweepT + 120) {
      this.desertStormLastSweepT = time;
      this.sweepDesertStormEntities(time);
    }

    if (this.player?.chassis?.active && !this.isDefeat) {
      if (this.player.chassis.x <= this.desertStormFrontX + 180) {
        this.player.takeDamage(this.player.maxHp * 10, ShellType.STANDARD);
      } else if (!this.desertEscapeTriggered && this.player.chassis.x >= this.WORLD_WIDTH - 680) {
        this.triggerDesertEscapeComplete();
      }
    }
  }

  private updateDesertStormVisual(time: number) {
    if (!this.desertStormVisual?.active) return;
    const cam = this.cameras.main;
    const view = cam.worldView;
    const threatDist = (this.player?.chassis?.x ?? this.desertStormFrontX + 2200) - this.desertStormFrontX;
    const threatT = Phaser.Math.Clamp(1 - (threatDist - 450) / 2800, 0, 1);
    const phase = time * 0.0032;

    this.desertStormVisual.x = this.desertStormFrontX;
    this.desertStormVisual.y = view.centerY + Math.sin(phase * 0.55) * 14;

    const shadow = this.desertStormVisual.getData('shadow') as Phaser.GameObjects.Shape | undefined;
    const coreA = this.desertStormVisual.getData('coreA') as Phaser.GameObjects.Shape | undefined;
    const coreB = this.desertStormVisual.getData('coreB') as Phaser.GameObjects.Shape | undefined;
    const dustA = this.desertStormVisual.getData('dustA') as Phaser.GameObjects.Shape | undefined;
    const dustB = this.desertStormVisual.getData('dustB') as Phaser.GameObjects.Shape | undefined;
    const edge = this.desertStormVisual.getData('edge') as Phaser.GameObjects.Shape | undefined;
    const frontDense = this.desertStormVisual.getData('frontDense') as Phaser.GameObjects.Shape | undefined;
    const swirlA = this.desertStormVisual.getData('swirlA') as Phaser.GameObjects.Shape | undefined;
    const swirlB = this.desertStormVisual.getData('swirlB') as Phaser.GameObjects.Shape | undefined;
    const clumps = this.desertStormVisual.getData('clumps') as Phaser.GameObjects.Shape[] | undefined;

    if (shadow) shadow.setAlpha(Phaser.Math.Linear(0.44, 0.68, threatT) + Math.sin(phase * 0.9) * 0.04);
    if (coreA) {
      coreA.setAlpha(Phaser.Math.Linear(0.42, 0.72, threatT) + Math.sin(phase * 1.05) * 0.06);
      coreA.x = -360 + Math.sin(phase * 0.92 + 0.4) * 30;
    }
    if (coreB) {
      coreB.setAlpha(Phaser.Math.Linear(0.38, 0.66, threatT) + Math.sin(phase * 0.95 + 0.6) * 0.05);
      coreB.x = -60 + Math.sin(phase * 0.86 + 1.1) * 24;
    }
    if (dustA) {
      dustA.setAlpha(Phaser.Math.Linear(0.34, 0.62, threatT) + Math.sin(phase * 1.05 + 1.2) * 0.05);
      dustA.x = 200 + Math.sin(phase * 0.8) * 28;
    }
    if (dustB) {
      dustB.setAlpha(Phaser.Math.Linear(0.3, 0.56, threatT) + Math.sin(phase * 1.15 + 2.1) * 0.05);
      dustB.x = 360 + Math.sin(phase * 0.9 + 0.5) * 24;
    }
    if (edge) {
      edge.setAlpha(Phaser.Math.Linear(0.4, 0.8, threatT) + Math.sin(phase * 1.45 + 0.7) * 0.08);
      edge.x = 450 + Math.sin(phase * 1.2) * 20;
    }
    if (frontDense) frontDense.setAlpha(Phaser.Math.Linear(0.5, 0.92, threatT) + Math.sin(phase * 1.9 + 0.9) * 0.08);
    if (swirlA) {
      swirlA.setAlpha(Phaser.Math.Linear(0.22, 0.42, threatT) + Math.sin(phase * 1.3) * 0.04);
      swirlA.angle = -14 + Math.sin(phase * 1.2) * 8;
    }
    if (swirlB) {
      swirlB.setAlpha(Phaser.Math.Linear(0.2, 0.4, threatT) + Math.sin(phase * 1.42 + 0.7) * 0.04);
      swirlB.angle = 12 + Math.sin(phase * 1.3 + 1.1) * 8;
    }
    if (Array.isArray(clumps)) {
      for (let i = 0; i < clumps.length; i++) {
        const c = clumps[i];
        if (!c?.active) continue;
        const baseX = Number(c.getData('baseX') ?? c.x);
        const ampX = Number(c.getData('ampX') ?? 12);
        const phaseOffset = Number(c.getData('phase') ?? 0);
        c.alpha = Phaser.Math.Linear(0.18, 0.42, threatT) + Math.sin(phase * (1.2 + i * 0.08) + phaseOffset) * 0.05;
        c.x = baseX + Math.sin(phase * (0.92 + i * 0.07) + phaseOffset) * ampX;
      }
    }

    if (this.desertStormEmitters.length > 0) {
      const yMid = view.centerY;
      const jitter = Math.sin(phase * 2.2) * 26;
      const nearGain = Phaser.Math.Linear(1.1, 2.2, threatT);
      const e0 = this.desertStormEmitters[0];
      const e1 = this.desertStormEmitters[1];
      const e2 = this.desertStormEmitters[2];
      const e3 = this.desertStormEmitters[3];
      if (e0?.active) {
        e0.setPosition(this.desertStormFrontX - 270, yMid + jitter);
        e0.setScale(Phaser.Math.Linear(1.0, 1.75, threatT));
        e0.setAlpha(Phaser.Math.Linear(0.82, 1, threatT));
      }
      if (e1?.active) {
        e1.setPosition(this.desertStormFrontX - 40, yMid - jitter * 0.4);
        e1.setScale(nearGain * 1.06);
        e1.setAlpha(Phaser.Math.Linear(0.9, 1, threatT));
      }
      if (e2?.active) {
        e2.setPosition(this.desertStormFrontX + 140, yMid + jitter * 0.5);
        e2.setScale(nearGain * 1.24);
        e2.setAlpha(Phaser.Math.Linear(0.86, 1, threatT));
      }
      if (e3?.active) {
        e3.setPosition(this.desertStormFrontX + 180, yMid - jitter * 0.2);
        e3.setScale(Phaser.Math.Linear(1.0, 1.95, threatT));
        e3.setAlpha(Phaser.Math.Linear(0.72, 1, threatT));
      }
    }
  }

  private sweepDesertStormEntities(time: number) {
    const cutX = this.desertStormFrontX + this.desertStormSweepMargin;

    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      if (!a?.active) {
        this.animals.splice(i, 1);
        continue;
      }
      if (a.x <= cutX) a.takeDamage(999999, 'shell');
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e?.active) continue;
      const ex = e instanceof Tank ? e.chassis.x : ((e as any).x as number);
      if (!Number.isFinite(ex) || ex > cutX) continue;
      if (e instanceof Tank) {
        if (!e.isDead) e.takeDamage(e.maxHp * 12, ShellType.STANDARD);
      } else if (e instanceof LandSubmarine) {
        e.takeDamage(999999, ShellType.STANDARD);
      }
    }

    this.enemyInfantry.applyDamage(cutX - 30, this.getTerrainHeight(cutX), 260, 999999, ShellType.HE);
    this.allies.applyDamage(cutX - 30, this.getTerrainHeight(cutX), 260, 999999, ShellType.HE);

    const vegChildren = this.vegetationGroup.getChildren();
    for (let i = 0; i < vegChildren.length; i++) {
      const v: any = vegChildren[i];
      if (!v?.active) continue;
      if ((v.x as number) <= cutX) v.destroy();
    }

    const treeChildren = this.treeGroup.getChildren();
    for (let i = 0; i < treeChildren.length; i++) {
      const t: any = treeChildren[i];
      if (!t?.active) continue;
      if ((t.x as number) <= cutX) t.destroy();
    }

    this.buildings.applySandstormFront(cutX - 40, cutX + 60, time, 0.5);
  }

  private triggerDesertEscapeComplete() {
    if (this.desertEscapeTriggered) return;
    this.desertEscapeTriggered = true;
    this.cameras.main.fade(850, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.softResetAudioForSceneTransition();
      this.scene.start('MenuScene');
    });
  }

  private perfNowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
    return this.time.now;
  }

  private perfRecord(section: string, startMs: number) {
    if (!this.perfPanelEnabled) return;
    const cost = Math.max(0, this.perfNowMs() - startMs);
    this.perfSampleSections.set(section, (this.perfSampleSections.get(section) ?? 0) + cost);
  }

  private emitPerfPanel(now: number, frameMs: number) {
    if (!this.perfPanelEnabled || typeof window === 'undefined') return;

    this.perfSampleFrames += 1;
    this.perfSampleFrameMs += frameMs;
    if (now < this.perfLastEmitT + 500) return;

    const frames = Math.max(1, this.perfSampleFrames);
    const avgFrameMs = this.perfSampleFrameMs / frames;
    const fps = avgFrameMs > 0.0001 ? (1000 / avgFrameMs) : 0;
    const sections = Array.from(this.perfSampleSections.entries())
      .map(([id, total]) => ({ id, ms: total / frames }))
      .sort((a, b) => b.ms - a.ms);

    window.dispatchEvent(new CustomEvent('panzer-perf-stats', {
      detail: {
        visible: true,
        fps: Number(fps.toFixed(1)),
        frameMs: Number(avgFrameMs.toFixed(2)),
        sections: sections.slice(0, 8).map(s => ({ id: s.id, ms: Number(s.ms.toFixed(2)) })),
        top3: sections.slice(0, 3).map(s => ({ id: s.id, ms: Number(s.ms.toFixed(2)) }))
      }
    }));

    this.perfLastEmitT = now;
    this.perfSampleFrames = 0;
    this.perfSampleFrameMs = 0;
    this.perfSampleSections.clear();
  }

  private tuneAdaptivePerf(now: number) {
    if (now < this.lastPerfAdaptiveTuneT + 700) return;
    this.lastPerfAdaptiveTuneT = now;

    const fpsRaw = Number((this.game.loop as any)?.actualFps ?? (this.game.loop as any)?.fps ?? 60);
    const fps = Number.isFinite(fpsRaw) ? fpsRaw : 60;
    let extra = 0;
    if (fps < 46) extra = 220;
    else if (fps < 52) extra = 150;
    else if (fps < 56) extra = 90;
    else if (fps < 59) extra = 45;

    const target = this.tacticalMapEmitBaseIntervalMs + extra;
    const alpha = target > this.tacticalMapEmitIntervalMs ? 0.36 : 0.18;
    this.tacticalMapEmitIntervalMs = Math.round(Phaser.Math.Linear(this.tacticalMapEmitIntervalMs, target, alpha));

    const mobileDevice = this.sys.game.device.os.android || this.sys.game.device.os.iOS || this.sys.game.device.input.touch;
    let strideTarget = mobileDevice ? 2 : 1;
    if (fps < 42) strideTarget = mobileDevice ? 6 : 3;
    else if (fps < 48) strideTarget = mobileDevice ? 5 : 3;
    else if (fps < 54) strideTarget = mobileDevice ? 4 : 2;
    else if (fps < 58) strideTarget = mobileDevice ? 3 : 2;
    this.enemyFarAiStride = Phaser.Math.Clamp(
      Math.round(Phaser.Math.Linear(this.enemyFarAiStride, strideTarget, 0.35)),
      1,
      6
    );

    const android = this.sys.game.device.os.android;
    const mobile = android || this.sys.game.device.os.iOS || this.sys.game.device.input.touch;
    const baseStormStride = android ? 55 : (mobile ? 45 : 34);
    let stormExtra = 0;
    if (fps < 42) stormExtra = mobile ? 72 : 46;
    else if (fps < 48) stormExtra = mobile ? 54 : 34;
    else if (fps < 54) stormExtra = mobile ? 36 : 22;
    else if (fps < 58) stormExtra = mobile ? 18 : 12;
    const stormTarget = baseStormStride + stormExtra;
    this.desertStormVisualStrideMs = Math.round(
      Phaser.Math.Linear(this.desertStormVisualStrideMs, stormTarget, 0.4)
    );
  }

  update(time: number, delta: number) {
    if (this.isDefeat) {
      this.physics.world.isPaused = true;
      return;
    }

    if (this.hunterBossTank && (!this.hunterBossTank.active || this.hunterBossTank.isDead)) {
      this.hunterBossTank = null;
      if (this.mapId === 'forest' && !this.forestEndBgmLatched) {
        this.forestEndBgmLatched = true;
        this.applyForestBgmState('end', time, { transition: 'hunter_intro', forceRestart: true });
      }
    }

    if (this.testRoomEnabled && time > this.lastAudioDebugTime + 250) {
      this.lastAudioDebugTime = time;
      const active = this.audio.getActiveSounds();
      window.dispatchEvent(new CustomEvent('panzer-audio-debug', { detail: { sounds: active } }));
    }

    const perfFrameStart = this.perfPanelEnabled ? this.perfNowMs() : 0;
    const clampedDelta = Math.min(50, delta);

    this.tuneAdaptivePerf(time);

    let perfSectionStart = this.perfPanelEnabled ? this.perfNowMs() : 0;
    this.updateMobileCameraFocusOffset();
    this.updateForestBgm(time);
    this.updatePreFinalSafeZoneWreckField(time);
    if (time > this.lastTacticalMapEmitT + this.tacticalMapEmitIntervalMs) {
      this.lastTacticalMapEmitT = time;
      this.emitTacticalMapData(false);
    }
    this.perfRecord('camera_bgm_map', perfSectionStart);
    if (this.shellNameText?.active && this.player?.chassis?.active) {
      const s = this.player.chassis.scaleX || 1;
      const targetX = this.player.chassis.x;
      const targetY = this.player.chassis.y - 100 * s;
      this.shellNameText.x = Phaser.Math.Linear(this.shellNameText.x, targetX, 0.25);
      this.shellNameText.y = Phaser.Math.Linear(this.shellNameText.y, targetY, 0.25);
    }

    // Fauna logic
    const cam = this.cameras.main;
    const camX = cam.scrollX;
    const viewW = cam.width / Math.max(0.0001, cam.zoom);
    const viewL = camX - 800;
    const viewR = camX + viewW + 800;

    perfSectionStart = this.perfPanelEnabled ? this.perfNowMs() : 0;
    if (this.player?.chassis?.active && this.baseRepairStations.length > 0) {
      const px = this.player.chassis.x;
      const py = this.player.chassis.y;
      const body = this.player.chassis.body as Phaser.Physics.Arcade.Body | undefined;
      const vx = body?.velocity?.x ?? 0;
      const vy = body?.velocity?.y ?? 0;
      const dt = clampedDelta / 1000;

      for (const b of this.baseRepairStations) {
        if (b.collapsed) {
           this.setRepairSpotlightLoop(b, false);
           b.lamp.setVisible(false);
           b.rays.clear();
           continue;
        }

        const groundY = this.getTerrainHeight(b.poleX);
         // Collapses if ground drops more than 20px below the pole's bottom
         // pole.y is bottom-center (origin 0.5, 1).
         if (groundY > b.pole.y + 20) {
            b.collapsed = true;
            b.pole.setRotation(Math.PI / 2);
            if (b.flag) {
                // Move flag anchor to the new tip position (lying on ground to the right)
                // Pole height is ~1040. Origin is bottom.
                // Rotated 90 deg: tip is at (x + height, y)
                b.flag.anchorX = b.pole.x + b.pole.height; 
                b.flag.anchorY = b.pole.y;
                b.flag.collapsed = true;
            }
            this.setRepairSpotlightLoop(b, false);
            b.lamp.setVisible(false);
            b.rays.clear();
            continue;
         }

        const inView = b.poleX >= viewL && b.poleX <= viewR;
        b.lamp.setVisible(inView);
        b.rays.setVisible(inView);
        if (!inView) {
          this.setRepairSpotlightLoop(b, false);
          continue;
        }

        const under = Math.abs(px - b.poleX) < 150 && this.isInSafeZone(px) && Math.abs(vx) < 90 && Math.abs(vy) < 120;
        const needRepair = this.player.hp < this.player.maxHp;
        if (!under || !needRepair) {
          this.setRepairSpotlightLoop(b, false);
          b.rays.clear();
          continue;
        }

        this.setRepairSpotlightLoop(b, true);

        const prevHp = this.player.hp;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.05 * dt);
        if (this.player.hp !== prevHp) {
          this.events.emit('update-hud', { hp: (this.player.hp / this.player.maxHp) * 100, shell: ShellType[this.player.currentShell] });
          if (time > b.lastSparkAt + 120) {
            b.lastSparkAt = time;
            this.particles.createRepairEffect(
              px + Phaser.Math.Between(-18, 18),
              py - 34 + Phaser.Math.Between(-14, 14),
              [0xffffff, 0xbb66ff, 0x6c00ff]
            );
          }
        }

        const sx = b.poleX + 9;
        const sy = b.lampY;
        b.rays.clear();
        const a = time * 0.006 + b.beamPhase + b.poleX * 0.001;
        const tx = px + Math.sin(a) * 18;
        const ty = (py - 38) + Math.cos(a * 1.07) * 14;

        const dx = tx - sx;
        const dy = ty - sy;
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const nx = -dy / len;
        const ny = dx / len;

        const wide0 = 18 + Math.sin(a * 1.4) * 2.0;
        const wide1 = 10 + Math.cos(a * 1.1) * 2.0;
        const coreAlpha = 0.62 + Math.sin(a * 1.9) * 0.08;

        b.rays.fillStyle(0xbb66ff, 0.10);
        b.rays.fillCircle(sx, sy, 22);

        b.rays.fillStyle(0x6c00ff, 0.06);
        b.rays.beginPath();
        b.rays.moveTo(sx + nx * wide0, sy + ny * wide0);
        b.rays.lineTo(tx + nx * wide1, ty + ny * wide1);
        b.rays.lineTo(tx - nx * wide1, ty - ny * wide1);
        b.rays.lineTo(sx - nx * wide0, sy - ny * wide0);
        b.rays.closePath();
        b.rays.fillPath();

        b.rays.lineStyle(12, 0x6c00ff, 0.10);
        b.rays.lineBetween(sx, sy, tx, ty);
        b.rays.lineStyle(5, 0xbb66ff, 0.28);
        b.rays.lineBetween(sx, sy, tx, ty);
        b.rays.lineStyle(2.2, 0xffffff, coreAlpha);
        b.rays.lineBetween(sx, sy, tx, ty);

        for (let i = 0; i < 3; i++) {
          const off = (i - 1) * 3.0 + Math.sin(a * 2.2 + i) * 2.0;
          b.rays.lineStyle(1.2, 0xffe6ff, 0.22);
          b.rays.lineBetween(sx + nx * off, sy + ny * off, tx + nx * off * 0.4, ty + ny * off * 0.4);
        }

        const pulseCount = 5;
        for (let i = 0; i < pulseCount; i++) {
          const t = (time * 0.0022 + b.beamPhase * 0.15 + i / pulseCount) % 1;
          const wob = Math.sin(time * 0.018 + i * 2.1 + b.beamPhase) * 4;
          const px2 = sx + dx * t + nx * wob;
          const py2 = sy + dy * t + ny * wob;
          const r = 2.2 + (1 - t) * 3.2;
          b.rays.fillStyle(0xffffff, 0.22);
          b.rays.fillCircle(px2, py2, r);
        }

        b.rays.fillStyle(0xffffff, 0.10);
        b.rays.fillCircle(tx, ty, 16);
        b.rays.fillStyle(0xbb66ff, 0.12);
        b.rays.fillCircle(tx, ty, 24);
      }
    } else if (this.baseRepairStations.length > 0) {
      for (const b of this.baseRepairStations) {
        this.setRepairSpotlightLoop(b, false);
        b.rays.clear();
      }
    }
    this.perfRecord('base_repair', perfSectionStart);

    perfSectionStart = this.perfPanelEnabled ? this.perfNowMs() : 0;
    const faunaChildren = this.faunaGroup?.getChildren?.() as any[] | undefined;
    const vegetationChildren = this.vegetationGroup?.getChildren?.() as any[] | undefined;

    if (Array.isArray(faunaChildren) && time > this.lastFaunaUpdateT + this.faunaUpdateIntervalMs) {
      const faunaElapsedMs = this.lastFaunaUpdateT > 0 ? Math.max(clampedDelta, time - this.lastFaunaUpdateT) : clampedDelta;
      this.lastFaunaUpdateT = time;
      const dtFauna = Math.min(0.08, faunaElapsedMs / 1000);
      const faunaLeft = camX - 1000;
      const faunaRight = camX + 2000;
      const playerChassis = this.player?.chassis;

      for (let i = 0; i < faunaChildren.length; i++) {
        const f = faunaChildren[i];
        if (!f?.active) continue;
        if (f.x < faunaLeft || f.x > faunaRight) continue;
        if (f.getData('isFish')) {
          const x0 = (f.getData('lakeX0') as number | undefined) ?? (f.x - 400);
          const x1 = (f.getData('lakeX1') as number | undefined) ?? (f.x + 400);
          const waterY = (f.getData('waterY') as number | undefined) ?? (f.y - 80);
          const dir = (f.getData('dir') as number | undefined) ?? 1;
          const speed = (f.getData('speed') as number | undefined) ?? 18;
          const baseY = (f.getData('baseY') as number | undefined) ?? f.y;
          const phase = (f.getData('phase') as number | undefined) ?? 0;
          let nextDir = dir;
          let nextSpeed = speed;
          const nextTurnAt = (f.getData('nextTurnAt') as number | undefined) ?? (time + Phaser.Math.Between(900, 2600));
          if (time >= nextTurnAt) {
            f.setData('nextTurnAt', time + Phaser.Math.Between(900, 2600));
            if (Math.random() < 0.45) nextDir = -nextDir;
            nextSpeed = Phaser.Math.Clamp(nextSpeed + Phaser.Math.Between(-6, 6), 10, 42);
          } else {
            f.setData('nextTurnAt', nextTurnAt);
          }

          f.x += nextDir * nextSpeed * dtFauna;
          f.y = baseY + Math.sin(time * 0.0022 + phase) * 4.5;

          const fishScale = Number((f as any).scaleX) || 1;
          const margin = 118 + fishScale * 14;
          const leftBound = x0 + margin;
          const rightBound = x1 - margin;
          const minDepth = 74;
          const minY = waterY + 26;

          if (f.x <= leftBound) {
            f.x = leftBound;
            nextDir = 1;
            nextSpeed = Phaser.Math.Clamp(nextSpeed + Phaser.Math.Between(-4, 8), 10, 42);
          } else if (f.x >= rightBound) {
            f.x = rightBound;
            nextDir = -1;
            nextSpeed = Phaser.Math.Clamp(nextSpeed + Phaser.Math.Between(-4, 8), 10, 42);
          }

          // Keep fish away from shallow side walls so they never appear to swim out of water.
          let terrainY = this.getTerrainHeight(f.x);
          let depthAtX = terrainY - waterY;
          if (depthAtX < minDepth) {
            nextDir = f.x < ((x0 + x1) * 0.5) ? 1 : -1;
            let probeX = f.x;
            for (let k = 0; k < 28; k++) {
              probeX = Phaser.Math.Clamp(probeX + nextDir * 20, leftBound, rightBound);
              terrainY = this.getTerrainHeight(probeX);
              depthAtX = terrainY - waterY;
              if (depthAtX >= minDepth) break;
              if (probeX <= leftBound + 1 || probeX >= rightBound - 1) break;
            }
            f.x = probeX;
            terrainY = this.getTerrainHeight(f.x);
          }

          const maxY = Math.max(minY + 12, terrainY - 18);
          f.y = Phaser.Math.Clamp(f.y, minY, maxY);

          f.setFlipX(nextDir < 0);
          f.setData('dir', nextDir);
          f.setData('speed', nextSpeed);
          continue;
        }

        if (f.getData('isBird') && playerChassis?.active) {
          const d = Phaser.Math.Distance.Between(f.x, f.y, playerChassis.x, playerChassis.y);
          if (d < 350) {
            this.particles.createFleeingBirds(f.x, f.y);
            f.destroy();
          }
        }
      }
    }

    // Vegetation interaction (bending)
    if (Array.isArray(vegetationChildren) && time > this.lastVegetationInteractionT + this.vegetationInteractionIntervalMs) {
      const vegetationElapsedMs = this.lastVegetationInteractionT > 0 ? Math.max(clampedDelta, time - this.lastVegetationInteractionT) : clampedDelta;
      this.lastVegetationInteractionT = time;
      const interactionLerp = Phaser.Math.Clamp(0.16 + (vegetationElapsedMs / 1000) * 0.4, 0.14, 0.28);
      const relaxLerp = Phaser.Math.Clamp(0.08 + (vegetationElapsedMs / 1000) * 0.3, 0.08, 0.2);

      const nearTankXs = this.vegetationNearTankCache;
      nearTankXs.length = 0;
      if (this.player?.active && this.player.chassis?.active) {
        nearTankXs.push({ x: this.player.chassis.x, y: this.player.chassis.y, isPlayer: true });
      }
      for (let i = 0; i < this.enemies.length; i++) {
        const t = this.enemies[i] as any;
        const ch = t?.chassis as Phaser.Physics.Arcade.Sprite | undefined;
        if (!t?.active || !ch?.active) continue;
        nearTankXs.push({ x: ch.x, y: ch.y, isPlayer: false });
      }

      for (let i = 0; i < vegetationChildren.length; i++) {
        const v = vegetationChildren[i];
        if (!v?.active) continue;
        if (v.x < camX - 600 || v.x > camX + 1800) continue;
        if (v.getData('isWaterPlant')) continue;

        let bent = false;
        for (let j = 0; j < nearTankXs.length; j++) {
          const t = nearTankXs[j];
          if (Math.abs(t.x - v.x) >= 60) continue;

          const targetAngle = t.x > v.x ? -45 : 45;
          v.angle = Phaser.Math.Linear(v.angle, targetAngle, interactionLerp);

          // Trigger sound while player brushes through vegetation.
          if (t.isPlayer) {
            const texKey = v.texture?.key as string | undefined;
            if (texKey && (texKey.startsWith('veg_tree') || texKey === 'veg_pine' || texKey === 'veg_cactus')) {
              const until = (v.getData('touchSfxUntil') as number | undefined) ?? 0;
              if (time > until) {
                v.setData('touchSfxUntil', time + 2500);
                const folderKey = texKey.startsWith('veg_tree') ? 'veg_tree' : texKey;
                const path = `environment/forest/point_3d/static/plants/vegetation/${folderKey}/touch/sfx`;
                this.audio.playFolder(path, { worldX: v.x, volume: 0.75, cooldownMs: 0 });
              }
            } else if ((texKey === 'veg_grass' || texKey === 'veg_flower_y' || texKey === 'veg_flower_p') && this.mapId === 'forest') {
              const until = (v.getData('touchSfxUntil') as number | undefined) ?? 0;
              if (time > until && time > this.lastLeavesSfxT + 25000) {
                v.setData('touchSfxUntil', time + 25000);
                this.lastLeavesSfxT = time;
                this.audio.playFolder('environment/forest/ambient_2d/leaves_loop/sfx', { worldX: v.x, volume: 0.45, cooldownMs: 0 })
                  ?.then(snd => {
                    if (snd) {
                      this.time.delayedCall(5000, () => {
                        if (snd.isPlaying) {
                          this.tweens.add({
                            targets: snd,
                            volume: 0,
                            duration: 1000,
                            onComplete: () => {
                              snd.stop();
                              snd.destroy();
                            }
                          });
                        }
                      });
                    }
                  });
              }
            }

            if (v.getData('birdTrigger') && !v.getData('birdTriggered')) {
              if (Math.abs(t.x - v.x) < 55 && Math.abs(t.y - v.y) < 160) {
                const texKey = v.texture?.key as string | undefined;
                const offY = texKey === 'veg_cactus' ? 80 : 100;
                this.particles.createFleeingBirds(v.x, v.y - offY);
                v.setData('birdTriggered', true);
              }
            }
          }

          bent = true;
          break;
        }

        if (!bent) {
          v.angle = Phaser.Math.Linear(v.angle, 0, relaxLerp);
        }
      }
    }

    if (Array.isArray(vegetationChildren) && time > this.lastWaterPlantUpdateT + this.waterPlantUpdateIntervalMs) {
      const waterPlantElapsedMs = this.lastWaterPlantUpdateT > 0 ? Math.max(clampedDelta, time - this.lastWaterPlantUpdateT) : clampedDelta;
      this.lastWaterPlantUpdateT = time;
      const dtPlants = Math.min(0.08, waterPlantElapsedMs / 1000);
      for (let i = 0; i < vegetationChildren.length; i++) {
        const v = vegetationChildren[i];
        if (!v?.active) continue;
        if (v.x < camX - 800 || v.x > camX + 2200) continue;
        if (!v.getData('isWaterPlant')) continue;
        const baseY = (v.getData('baseY') as number | undefined) ?? v.y;
        const phase = (v.getData('phase') as number | undefined) ?? 0;
        v.y = baseY + Math.sin(time * 0.0016 + phase) * 1.9;
        v.angle = Phaser.Math.Linear(v.angle, Math.sin(time * 0.0013 + phase) * 6, 0.06 + dtPlants * 0.12);
      }
    }
    this.perfRecord('fauna_vegetation', perfSectionStart);

    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= delta;
      this.physics.world.isPaused = true;
      if (this.perfPanelEnabled) this.emitPerfPanel(time, Math.max(0, this.perfNowMs() - perfFrameStart));
      return;
    }
    this.physics.world.isPaused = false;

    perfSectionStart = this.perfPanelEnabled ? this.perfNowMs() : 0;
    
    // AIM WORLD UPDATE REMOVED FROM HERE
    // Aim World is now exclusively updated by UIScene based on Screen Pointer
    // This ensures Crosshair (Screen) and AimWorld (World) are always 1:1 via Camera transform
    
    this.windT += delta;
    this.wind = Math.sin(this.windT * 0.00035) * 140 + Math.sin(this.windT * 0.0011) * 60;
    if (this.mapId === 'desert') {
      const mag = Math.max(240, Math.abs(this.wind));
      this.sandstormDir = 1;
      this.wind = mag;
      this.updateDesertStormScenario(time, clampedDelta);
    } else {
      if (this.allowForestRainThisRun && time > this.lastForestRainT + 2400) {
        this.lastForestRainT = time;
        if (time > this.rainUntilT && Math.random() < 0.06) {
          const dur = 20000;
          this.rainUntilT = time + dur;
          this.particles.createForestRain(dur);
          this.wasRainActive = true;
          this.ensureForestRainLoop(900);
        }
      }
    }
    const dt = Math.min(33, delta) / 1000;
    if (this.mapId === 'forest') {
      const rainActive = time < this.rainUntilT && (this.particles as any)?.isRainActive?.() === true;
      const targetBlend = rainActive ? 1 : 0;
      const prevBlend = this.forestRainBlend;
      const step = Phaser.Math.Clamp(dt * 0.9, 0, 1);
      this.forestRainBlend = Phaser.Math.Linear(prevBlend, targetBlend, step);
      if (Math.abs(this.forestRainBlend - prevBlend) > 0.01) this.drawTerrain();
      if (rainActive) {
        if (!this.wasRainActive) this.wasRainActive = true;
        if (time > this.lastForestRainLoopEnsureT + 1400) this.ensureForestRainLoop(280);
      } else if (this.wasRainActive) {
         this.wasRainActive = false;
         this.audio.stopLoop('amb_forest_rain', 2000);
      }
    }

    if (this.blackRainZones.length > 0) {
      const now = time;
      for (let i = this.blackRainZones.length - 1; i >= 0; i--) {
        if (this.blackRainZones[i].until <= now) {
          this.blackRainZones.splice(i, 1);
        }
      }
      if (this.blackRainZones.length > 0) {
        if (this.mapId === 'forest' && now > this.lastBlackRainLoopEnsureT + 1200) this.ensureBlackRainLoop(120);
        const zones = this.blackRainZones;
        const inZone = (px: number): boolean => {
          for (let i = 0; i < zones.length; i++) {
            const z = zones[i];
            if (now > z.until) continue;
            if (Math.abs(px - z.x) <= z.radius) return true;
          }
          return false;
        };

        const applyBlackRainDamageToSoldiers = (soldiers: any[], mgr: InfantryManager) => {
          for (let i = 0; i < soldiers.length; i++) {
            const s = soldiers[i];
            if (!s?.active) continue;
            if (!inZone(s.x)) continue;
            const last = (s.getData('blackRainLastDmgT') as number | undefined) ?? 0;
            if (now <= last + 600) continue;
            s.setData('blackRainLastDmgT', now);
            s.takeDamage(999999, mgr, ShellType.HE, s.x, s.y);
          }
        };
        applyBlackRainDamageToSoldiers(this.enemyInfantry.soldiers, this.enemyInfantry);
        applyBlackRainDamageToSoldiers(this.allies.soldiers, this.allies);

        for (let i = this.animals.length - 1; i >= 0; i--) {
          const a = this.animals[i];
          if (!a.active) {
            this.animals.splice(i, 1);
            continue;
          }
          if (!inZone(a.x)) continue;
          const last = (a.getData('blackRainLastDmgT') as number | undefined) ?? 0;
          if (now <= last + 600) continue;
          a.setData('blackRainLastDmgT', now);
          a.takeDamage(999999, 'other');
        }
      } else if (this.mapId === 'forest') {
        this.audio.stopLoop(this.blackRainLoopId, 1200);
      }
    }
    for (const f of this.flags) {
      const segCount = f.points.length;
      if (segCount === 0) continue;

      const inView = f.anchorX >= viewL - 420 && f.anchorX <= viewR + 420;
      if (!inView) {
        for (let i = 0; i < segCount; i++) {
          const img = f.segments[i];
          if (img?.visible) img.setVisible(false);
        }
        continue;
      }
      
      // If collapsed, use simple physics or just static lying down
      if ((f as any).collapsed) {
         const settleWaveT = time * 0.0015 + f.phase * 0.7;
         for (let i = 0; i < segCount; i++) {
             const img = f.segments[i];
             const px = f.anchorX + i * f.segW;
             const py = f.anchorY + Math.sin(settleWaveT + i * 0.9) * 0.7;
             f.points[i].set(px, py);
             if (!img.visible) img.setVisible(true);
             img.setPosition(px, py);
             img.setRotation(Math.sin(settleWaveT * 0.8 + i * 0.45) * 0.035);
         }
         continue;
      }

      f.points[0].set(f.anchorX, f.anchorY);
      f.vels[0].set(0, 0);

      const wind = this.getWindAt(f.anchorY);
      for (let i = 1; i < segCount; i++) {
        const v = f.vels[i];
        const pnt = f.points[i];
        v.x += wind * (0.75 + i * 0.12) * dt;
        v.y += 1600 * dt;
        v.scale(0.86);
        pnt.x += v.x * dt;
        pnt.y += v.y * dt;

        const prev = f.points[i - 1];
        const dx = pnt.x - prev.x;
        const dy = pnt.y - prev.y;
        const dist = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
        const want = f.segW;
        const pull = (want - dist) / dist;
        pnt.x += dx * pull;
        pnt.y += dy * pull;
      }

      for (let i = 0; i < segCount; i++) {
        const img = f.segments[i];
        if (!img.active) continue;
        if (!img.visible) img.setVisible(true);
        const pnt = f.points[i];
        img.setPosition(pnt.x, pnt.y);
        if (i > 0) {
          const prev = f.points[i - 1];
          const a = Math.atan2(pnt.y - prev.y, pnt.x - prev.x);
          const flutter = Math.sin(time * 0.012 + f.phase + i * 0.8) * 0.18 * Phaser.Math.Clamp(Math.abs(wind) / 200, 0, 1);
          img.setRotation(a + flutter);
        } else {
          img.setRotation(Math.sin(time * 0.006 + f.phase) * 0.08);
        }
      }
    }
    this.perfRecord('weather_flags', perfSectionStart);

    perfSectionStart = this.perfPanelEnabled ? this.perfNowMs() : 0;
    if (this.player) {
        this.player.setVirtualInputState({ left: this.vLeft, right: this.vRight, boost: this.vBoost, zoom: this.vZoom, lift: this.vLift, fire: this.vFire, mg: (this.vMg || this.mouseMgHeld), mortar: this.vMortar, nuke: this.vNuke });
        this.player.setNoCooldown(this.testRoomEnabled && this.testRoomNoCooldown);
        this.player.update(time, clampedDelta);
        if (time > this.lastAmmoHudUpdateT + 90) {
          this.lastAmmoHudUpdateT = time;
          this.updateCooldownPanel(time);
        }
        const inSafe = this.isInSafeZone(this.player.chassis.x);
        if (inSafe && !this.wasInSafeZone) this.handleSafeZoneEntry();
        this.wasInSafeZone = inSafe;
        if (this.tutorialMode) this.updateTutorialMode(time);
        if (!this.testRoomEnabled && !this.tutorialMode) {
          if (this.player.chassis.x > this.generatedUntilX - 3000) {
              this.spawnContentInRange(this.generatedUntilX, this.generatedUntilX + 4000);
              this.generatedUntilX += 4000;
          }
          this.trySpawnHunterNearPlayer(time);
          this.updateHunterIntro(time, clampedDelta);
        }
    }
    this.enemyFarAiFrame = (this.enemyFarAiFrame + 1) % 4096;
    const enemyActiveL = camX - 1500;
    const enemyActiveR = camX + 3000;
    const enemyNearL = camX - 550;
    const enemyNearR = camX + 2150;
    const farStride = Math.max(1, this.enemyFarAiStride | 0);
    const strideFrame = this.enemyFarAiFrame;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (!e || !(e as any).active) { this.enemies.splice(i, 1); continue; }
        const ex = e instanceof Tank ? e.chassis.x : ((e as any).x as number);
        const inRange = ex > enemyActiveL && ex < enemyActiveR;
        const inNearRange = ex > enemyNearL && ex < enemyNearR;
        const shouldTick = inNearRange || farStride <= 1 || (((i + strideFrame) % farStride) === 0);
        if (e instanceof Tank) {
          e.setHibernating(!inRange);
          if (inRange && shouldTick) e.update(time, clampedDelta, this.player);
        } else {
          const anyE = e as any;
          if (typeof anyE.setHibernating === 'function') anyE.setHibernating(!inRange);
          else {
            const body = anyE.body as Phaser.Physics.Arcade.Body | undefined;
            body?.setEnable?.(inRange);
            if (typeof anyE.setVisible === 'function') anyE.setVisible(inRange);
          }
          if (inRange && shouldTick) anyE.update?.(time, clampedDelta, this.player);
        }
    }
    if (time > this.lastSquashCheckT + 55) {
      this.lastSquashCheckT = time;
      if (this.player?.active && this.player.chassis?.active) {
        this.enemyInfantry.checkSquash(this.player.chassis, false);
        this.allies.checkSquash(this.player.chassis, false);
      }
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        if (!(e instanceof Tank) || !e.active || e.isDead || !e.chassis?.active) continue;
        const ex = e.chassis.x;
        if (ex <= enemyNearL - 240 || ex >= enemyNearR + 240) continue;
        this.enemyInfantry.checkSquash(e.chassis, true);
        this.allies.checkSquash(e.chassis, true);
      }
    }
    this.perfRecord('player_enemy', perfSectionStart);
    
    // Disable tank-animal collisions (requested by user)
    // for (const tank of allTanks) {
    //   const ch = (tank as any).chassis as Phaser.Physics.Arcade.Sprite;
    //   const body = ch?.body as Phaser.Physics.Arcade.Body | undefined;
    //   const v = body ? Math.hypot(body.velocity.x, body.velocity.y) : 0;
    //   if (v < 120) continue;
    //   const tb = ch.getBounds();
    //   for (let i = this.animals.length - 1; i >= 0; i--) {
    //     const a = this.animals[i];
    //     if (!a?.active) { this.animals.splice(i, 1); continue; }
    //     if (Phaser.Geom.Intersects.RectangleToRectangle(tb, a.getBounds())) {
    //       a.takeDamage(999999, 'collision');
    //     }
    //   }
    // }
    perfSectionStart = this.perfPanelEnabled ? this.perfNowMs() : 0;
    this.buildings.update(); 

    this.enemyInfantry.update(this.player, clampedDelta);
    this.allies.update(this.player, clampedDelta); 
    this.perfRecord('buildings_infantry', perfSectionStart);

    perfSectionStart = this.perfPanelEnabled ? this.perfNowMs() : 0;
    // Optimized: Only update terrain physics periodically
    if (time > this.lastTerrainPhysicsT + 500) {
      this.lastTerrainPhysicsT = time;
      this.updateTerrainPhysics();
    }
    if (time > this.lastVegetationSnapT + 650) {
      this.lastVegetationSnapT = time;
      this.updateVegetationHeights();
    }
    if (time > this.lastDistantHibernateT + 700) {
      this.lastDistantHibernateT = time;
      this.updateDistantObjects();
    }
    if (time > this.lastDormantPruneT + 2600) {
      this.lastDormantPruneT = time;
      this.pruneVeryDistantDormantObjects();
    }
    this.perfRecord('terrain_maintenance', perfSectionStart);
    
    perfSectionStart = this.perfPanelEnabled ? this.perfNowMs() : 0;
    this.updateLakeVisuals(time);
    this.perfRecord('lake_visuals', perfSectionStart);

    if (this.perfPanelEnabled) this.emitPerfPanel(time, Math.max(0, this.perfNowMs() - perfFrameStart));
  }

  private smoothTerrainDamage(startIdx: number, endIdx: number) {
    const start = Math.max(1, startIdx);
    const end = Math.min(this.terrainDamage.length - 2, endIdx);
    
    // Simple box blur for damage array
    for (let pass = 0; pass < 3; pass++) {
        for (let i = start; i <= end; i++) {
            const prev = this.terrainDamage[i - 1] || 0;
            const curr = this.terrainDamage[i] || 0;
            const next = this.terrainDamage[i + 1] || 0;
            this.terrainDamage[i] = (prev + curr + next) / 3;
        }
    }
  }

  private snapVegetationToTerrainInRange(x0: number, x1: number) {
    const left = Phaser.Math.Clamp(Math.min(x0, x1), 0, this.WORLD_WIDTH);
    const right = Phaser.Math.Clamp(Math.max(x0, x1), 0, this.WORLD_WIDTH);

    const veg = this.vegetationGroup?.getChildren?.() as any[] | undefined;
    if (Array.isArray(veg)) {
      for (const v of veg) {
        if (!v?.active) continue;
        const vx = v.x as number;
        if (vx < left || vx > right) continue;
        
        // Destroy vegetation if terrain is damaged OR too steep
        const idx = Math.floor(vx / this.TERRAIN_STEP);
        const dmg = this.terrainDamage[idx] || 0;
        
        // Calculate local slope (steepness)
        const h1 = this.terrainHeights[Math.max(0, idx - 1)] || 450;
        const h2 = this.terrainHeights[Math.min(this.terrainHeights.length - 1, idx + 1)] || 450;
        const slope = Math.abs(h2 - h1);

        // Thresholds: damage > 0.05 (was 0.15) OR slope > 25 (steep drop)
        if (dmg > 0.05 || slope > 25) {
            v.destroy();
            continue;
        }

        const getData = typeof v.getData === 'function' ? v.getData.bind(v) : undefined;
        if (getData?.('isWaterPlant')) continue;
        if (getData?.('isFish')) continue;
        v.y = this.getTerrainHeight(vx);
      }
    }

    const trees = this.treeGroup?.getChildren?.() as any[] | undefined;
    if (Array.isArray(trees)) {
      for (const t of trees) {
        if (!t?.active) continue;
        const tx = t.x as number;
        if (tx < left || tx > right) continue;
        
        // Check for terrain damage under tree
        const idx = Math.floor(tx / this.TERRAIN_STEP);
        const dmg = this.terrainDamage[idx] || 0;
        
        // Calculate local slope
        const h1 = this.terrainHeights[Math.max(0, idx - 1)] || 450;
        const h2 = this.terrainHeights[Math.min(this.terrainHeights.length - 1, idx + 1)] || 450;
        const slope = Math.abs(h2 - h1);

        // Collapse tree if ground is destroyed or too steep
        if ((dmg > 0.2 || slope > 35) && !t.getData('collapsed')) {
             this.handleTreeCollision(null, t);
             continue;
        }

        if (typeof t.getData === 'function' && t.getData('collapsed')) continue;
        t.y = this.getTerrainHeight(tx);
        const body = t.body as Phaser.Physics.Arcade.Body | undefined;
        body?.updateFromGameObject?.();
      }
    }
  }

  private updateVegetationHeights() {
      const scanBuffer = 2000;
      const camX = this.cameras.main.scrollX;
      this.vegetationGroup.getChildren().forEach((v: any) => {
          if (!v?.active) return;
          if (v.x <= camX - scanBuffer || v.x >= camX + 1280 + scanBuffer) return;
          if (typeof v.getData === 'function' && v.getData('isWaterPlant')) return;
          if (typeof v.getData === 'function' && v.getData('isFish')) return;
          v.y = this.getTerrainHeight(v.x);
      });
      this.treeGroup.getChildren().forEach((t: any) => {
          if (!t?.active) return;
          if (t.getData?.('collapsed')) return;
          if (t.x <= camX - scanBuffer || t.x >= camX + 1280 + scanBuffer) return;
          t.y = this.getTerrainHeight(t.x);
          const body = t.body as Phaser.Physics.Arcade.Body | undefined;
          body?.updateFromGameObject?.();
      });
  }

  private setupTestRoomHooks() {
    window.dispatchEvent(new CustomEvent('panzer-testroom-open', { detail: { 
      enemyAttack: this.testRoomAllowEnemyAttack, 
      enemyMove: this.testRoomAllowEnemyMove, 
      noCooldown: this.testRoomNoCooldown
    } }));

    this.onTestRoomCommand = (e: Event) => {
      const ce = e as CustomEvent;
      const cmd = String((ce as any)?.detail?.command ?? '').trim();
      if (!cmd) return;
      this.handleTestRoomCommand(cmd);
    };
    window.addEventListener('panzer-testroom-command', this.onTestRoomCommand);

    this.onTestRoomSettings = (e: Event) => {
      const ce = e as CustomEvent;
      const d = (ce as any)?.detail ?? {};
      if (typeof d.enemyAttack === 'boolean') this.testRoomAllowEnemyAttack = d.enemyAttack;
      if (typeof d.enemyMove === 'boolean') this.testRoomAllowEnemyMove = d.enemyMove;
      if (typeof d.noCooldown === 'boolean') this.testRoomNoCooldown = d.noCooldown;
    };
    window.addEventListener('panzer-testroom-settings', this.onTestRoomSettings);

    this.onTestRoomClear = () => {
      this.softResetAudioForSceneTransition();
      this.scene.restart({
        mapId: this.mapId,
        testRoom: true,
        testRoomSettings: { enemyAttack: this.testRoomAllowEnemyAttack, enemyMove: this.testRoomAllowEnemyMove, noCooldown: this.testRoomNoCooldown }
      });
    };
    window.addEventListener('panzer-testroom-clear', this.onTestRoomClear);

    this.onTestRoomUiBlock = (e: Event) => {
      const ce = e as CustomEvent;
      const blocked = !!(ce as any)?.detail?.blocked;
      this.testRoomUiBlocking = blocked;
    };
    window.addEventListener('panzer-testroom-ui-block', this.onTestRoomUiBlock);
  }

  private handleTestRoomCommand(raw: string) {
    if (!this.player?.active) return;
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return;

    const parts = trimmed.split(/\s+/g);
    let keyRaw = (parts[0] ?? '').trim();
    let count = 1;

    const suffix = keyRaw.match(/^(.+?)[x\*](\d+)$/i);
    if (suffix) {
      keyRaw = suffix[1];
      const n = Number.parseInt(suffix[2], 10);
      if (Number.isFinite(n)) count = n;
    } else if (parts.length >= 2) {
      const n = Number.parseInt(parts[1], 10);
      if (Number.isFinite(n)) count = n;
    }

    count = Phaser.Math.Clamp(count, 1, 30);

    const key = keyRaw.trim().toUpperCase();
    if (!key) return;

    const px = this.player.chassis.x;
    const spawnAt = (i: number, baseOff = 700) => {
      const step = 220;
      const dir = (i % 2 === 0) ? 1 : -1;
      const off = baseOff + Math.floor(i / 2) * step;
      const wantX = Phaser.Math.Clamp(px + dir * off, 140, this.WORLD_WIDTH - 140);
      const dry = this.findDryX(wantX, dir) ?? wantX;
      return Phaser.Math.Clamp(dry, 140, this.WORLD_WIDTH - 140);
    };

    const spawnTank = (type: TankType) => {
      for (let i = 0; i < count; i++) {
        const spawnX = spawnAt(i, 750);
        const scale = Tank.getScaleFor(type, false);
        const spawnY = this.getGroundHeight(spawnX) - 150 * scale;
        const t = new Tank(this, spawnX, spawnY, type, false);
        t.chassis.setData('tankRef', t);
        this.enemies.push(t);
        this.enemiesGroup.add(t.chassis);
      }
    };

    const spawnInfantry = (team: 'ally' | 'enemy', isEngineer: boolean) => {
      for (let i = 0; i < count; i++) {
        const spawnX = spawnAt(i, 520);
        const spawnY = this.getGroundHeight(spawnX);
        if (team === 'ally') this.allies.spawn(spawnX, spawnY, isEngineer);
        else this.enemyInfantry.spawn(spawnX, spawnY, isEngineer);
      }
    };

    type TestRoomAnimalKind = 'rabbit' | 'fox' | 'boar' | 'elk' | 'crow' | 'scorpion' | 'snake';
    const isTestRoomAnimalKind = (k: string): k is TestRoomAnimalKind => (
      k === 'rabbit' || k === 'fox' || k === 'boar' || k === 'elk' || k === 'crow' || k === 'scorpion' || k === 'snake'
    );

    const spawnAnimal = (kind: TestRoomAnimalKind) => {
      for (let i = 0; i < count; i++) {
        const spawnX = spawnAt(i, 520);
        const h = this.getGroundHeight(spawnX);
        const yOff = (kind === 'crow') ? 20 : 18;
        const a = new Animal(this, spawnX, h - yOff, kind);
        this.animalGroup.add(a);
        this.animals.push(a);
      }
    };

    const spawnBuilding = (style: number) => {
      for (let i = 0; i < count; i++) {
        const spawnX = spawnAt(i, 900);
        const y = this.getTerrainHeight(spawnX);
        this.buildings.createBuilding(spawnX, y, style, false);
      }
    };

    const spawnHelicopter = () => {
      for (let i = 0; i < count; i++) {
        const spawnX = spawnAt(i, 1200);
        const heli = new Helicopter(this, spawnX, -600);
        this.enemies.push(heli);
        this.physics.add.overlap(this.mineGroup, heli, (mineObj: any, enemyObj: any) => this.handleMineTrigger(mineObj, enemyObj));
      }
    };

    const spawnSubmarine = () => {
      for (let i = 0; i < count; i++) {
        const spawnX = spawnAt(i, 900);
        const sub = new LandSubmarine(this, spawnX, this.getTerrainHeight(spawnX));
        this.enemies.push(sub);
        this.enemiesGroup.add(sub);
        this.physics.add.overlap(this.mineGroup, sub, (mineObj: any, enemyObj: any) => this.handleMineTrigger(mineObj, enemyObj));
      }
    };

    const tankType = (TankType as any)[key] as TankType | undefined;
    if (typeof tankType === 'number') { spawnTank(tankType); return; }

    const animalKey = key.toLowerCase();
    if (isTestRoomAnimalKind(animalKey)) { spawnAnimal(animalKey); return; }

    if (key === 'HELICOPTER' || key === 'HELI') { spawnHelicopter(); return; }
    if (key === 'LAND_SUBMARINE' || key === 'SUBMARINE' || key === 'SUB') { spawnSubmarine(); return; }

    if (key === 'ALLY' || key === 'ALLY_SOLDIER' || key === 'SOLDIER_ALLY') { spawnInfantry('ally', false); return; }
    if (key === 'ALLY_ENGINEER' || key === 'ENGINEER_ALLY') { spawnInfantry('ally', true); return; }
    if (key === 'ENEMY' || key === 'ENEMY_SOLDIER' || key === 'SOLDIER_ENEMY') { spawnInfantry('enemy', false); return; }
    if (key === 'ENEMY_ENGINEER' || key === 'ENGINEER_ENEMY') { spawnInfantry('enemy', true); return; }

    if (key === 'BUILDING' || key === 'BUILDING_DEFAULT') { spawnBuilding(0); return; }
    if (key === 'BUILDING_AMERICAN_CABIN' || key === 'CABIN') { spawnBuilding(1); return; }
    if (key === 'BUILDING_HAKKA' || key === 'HAKKA') { spawnBuilding(2); return; }
    if (key === 'BUILDING_MIDDLE_EAST' || key === 'MIDDLE_EAST' || key === 'ME') { spawnBuilding(3); return; }
    if (key === 'BUILDING_MILITARY_BASE' || key === 'MILITARY_BASE' || key === 'BASE') { spawnBuilding(4); return; }
  }
}
