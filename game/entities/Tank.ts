
import Phaser from 'phaser';
import type { MainScene } from '../MainScene';
import { Helicopter } from './Helicopter';
import { TankType, ShellType, weaponFolderForShellType } from '../types/GameplayTypes';

interface TankSpecs {
  hp: number; speed: number; fireRate: number; damage: number;
  assets: { hull: string; wheel: string; turret: string; barrel: string; detail: string; };
  turretOffset: { x: number, y: number };
  traverseSpeed: number;
  barrelLength: number; 
  bodyColor: number;
}

const SPECS: Record<TankType, TankSpecs> = {
  [TankType.PLAYER_SOVIET]: { 
    hp: 20000, speed: 180, fireRate: 1000, damage: 165, 
    assets: { hull: 'sov_player_hull', wheel: 'sov_wheel', turret: 'sov_turret', barrel: 'sov_barrel', detail: 'sov_player_detail' },
    turretOffset: { x: 5, y: -18 }, traverseSpeed: 0.35, barrelLength: 75, bodyColor: 0x3ad6ff
  },
  [TankType.ENEMY_HUNTER]: {
    hp: 13500, speed: 90, fireRate: 1000, damage: 165,
    assets: { hull: 'hunter_hull', wheel: 'hunter_wheel', turret: 'hunter_turret', barrel: 'hunter_barrel', detail: 'hunter_detail' },
    turretOffset: { x: 5, y: -18 }, traverseSpeed: 0.35, barrelLength: 75, bodyColor: 0x59626f
  },
  [TankType.ENEMY_TIGER]: { 
    hp: 1200, speed: 75, fireRate: 3500, damage: 320, 
    assets: { hull: 'tiger_hull', wheel: 'tiger_wheel', turret: 'tiger_turret', barrel: 'tiger_barrel', detail: 'tiger_detail' },
    turretOffset: { x: 0, y: -22 }, traverseSpeed: 0.02, barrelLength: 85, bodyColor: 0xe3c47a
  },
  [TankType.ENEMY_PANZER]: { 
    hp: 500, speed: 210, fireRate: 1800, damage: 75, 
    assets: { hull: 'pz_hull', wheel: 'pz_wheel', turret: 'pz_turret', barrel: 'pz_barrel', detail: 'pz_detail' },
    turretOffset: { x: 0, y: -15 }, traverseSpeed: 0.11, barrelLength: 60, bodyColor: 0x4b7ed5
  },
  [TankType.ENEMY_STUG]: { 
    hp: 700, speed: 150, fireRate: 1500, damage: 115, 
    assets: { hull: 'stug_hull', wheel: 'sov_wheel', turret: '', barrel: 'stug_barrel', detail: 'stug_detail' },
    turretOffset: { x: 0, y: 0 }, traverseSpeed: 0.04, barrelLength: 65, bodyColor: 0x6f8b3e
  },
  [TankType.ENEMY_A7V]: { 
    hp: 2200, speed: 50, fireRate: 4000, damage: 280, 
    assets: { hull: 'a7v_hull', wheel: 'a7v_wheel', turret: '', barrel: 'a7v_barrel', detail: 'a7v_detail' },
    turretOffset: { x: 0, y: 0 }, traverseSpeed: 0.01, barrelLength: 50, bodyColor: 0x9b542c
  },
  [TankType.ENEMY_LUCHS]: { 
    hp: 300, speed: 280, fireRate: 600, damage: 35, 
    assets: { hull: 'luchs_hull', wheel: 'luchs_wheel', turret: 'luchs_turret', barrel: 'luchs_barrel', detail: 'luchs_detail' },
    turretOffset: { x: 0, y: -10 }, traverseSpeed: 0.15, barrelLength: 45, bodyColor: 0xa8ea3a
  },
  [TankType.ENEMY_MAUS]: { 
    hp: 4500, speed: 40, fireRate: 5000, damage: 1800, 
    assets: { hull: 'maus_hull', wheel: 'maus_wheel', turret: 'maus_turret', barrel: 'maus_barrel', detail: 'maus_detail' },
    turretOffset: { x: 0, y: -30 }, traverseSpeed: 0.015, barrelLength: 100, bodyColor: 0x7b8aa6
  },
  [TankType.ENEMY_TUMBLEWEED]: {
    hp: 850, speed: 320, fireRate: 2200, damage: 200,
    assets: { hull: 'tumble_hull', wheel: 'tumble_wheel', turret: '', barrel: 'tumble_barrel', detail: 'tumble_detail' },
    turretOffset: { x: 0, y: -10 }, traverseSpeed: 0.11, barrelLength: 52, bodyColor: 0xd9b36c
  },
};

export class Tank {
  public static getScaleFor(type: TankType, isPlayer: boolean): number {
    const playerScale = 2.0 * (2 / 3);
    if (isPlayer) return playerScale;

    const overrides: Partial<Record<TankType, number>> = {
      [TankType.ENEMY_LUCHS]: 0.95,
      [TankType.ENEMY_PANZER]: 1.1,
      [TankType.ENEMY_STUG]: 1.25,
      [TankType.ENEMY_TUMBLEWEED]: 1.35,
      [TankType.ENEMY_TIGER]: 1.55,
      [TankType.ENEMY_HUNTER]: 1.7,
      [TankType.ENEMY_A7V]: 1.9,
      [TankType.ENEMY_MAUS]: 2.25
    };
    return overrides[type] ?? playerScale;
  }

  public static getMaxEnemyHp(): number {
    let maxHp = 0;
    for (const [k, v] of Object.entries(SPECS) as any) {
      const type = Number(k) as TankType;
      if (type === TankType.PLAYER_SOVIET) continue;
      maxHp = Math.max(maxHp, (v as TankSpecs).hp);
    }
    return maxHp;
  }

  public static getAggroRangeFor(type: TankType): number {
    if (type === TankType.ENEMY_MAUS) return 3600;
    if (type === TankType.ENEMY_HUNTER) return 3800;
    return 1800;
  }

  private static ensureHunterDebrisTextures(scene: MainScene) {
    const mk = (key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics, w: number, h: number) => void) => {
      if (scene.textures.exists(key)) return;
      const g = scene.add.graphics({ x: 0, y: 0 });
      g.setVisible(false);
      draw(g, w, h);
      g.generateTexture(key, w, h);
      g.destroy();
    };

    const makePlate = (key: string, w: number, h: number, seed: number, cutout: boolean) => {
      mk(key, w, h, (g) => {
        const base = 0x707884;
        const deep = 0x505964;
        const dark = 0x2a2f37;
        const edge = 0x12151a;
        g.fillStyle(base, 1);
        g.fillRoundedRect(2, 2, w - 4, h - 4, Math.max(2, Math.floor(Math.min(w, h) * 0.12)));
        g.fillStyle(deep, 0.95);
        g.fillRoundedRect(5, 5, w - 10, h - 10, Math.max(2, Math.floor(Math.min(w, h) * 0.1)));
        g.lineStyle(3, edge, 0.9);
        g.strokeRoundedRect(2, 2, w - 4, h - 4, Math.max(2, Math.floor(Math.min(w, h) * 0.12)));

        let s = (seed >>> 0) || 1;
        const rnd = () => {
          s = (s * 1664525 + 1013904223) >>> 0;
          return s / 0xffffffff;
        };
        for (let i = 0; i < 10; i++) {
          const px = 6 + rnd() * (w - 16);
          const py = 6 + rnd() * (h - 16);
          const pw = 6 + rnd() * 18;
          const ph = 4 + rnd() * 12;
          const c = rnd() > 0.6 ? 0x8f2a32 : (rnd() > 0.5 ? 0x68717d : 0x505964);
          g.fillStyle(c, 0.22 + rnd() * 0.22);
          g.fillRect(px, py, Math.min(pw, w - px - 6), Math.min(ph, h - py - 6));
        }

        g.fillStyle(dark, 0.75);
        const stripeH = Math.max(4, Math.floor(h * 0.16));
        g.fillRect(0, Math.floor(h * 0.32), w, stripeH);
        g.fillRect(0, Math.floor(h * 0.58), w, stripeH);
        g.lineStyle(2, 0x20252d, 0.55);
        g.beginPath();
        g.moveTo(8, Math.floor(h * 0.32));
        g.lineTo(w - 8, Math.floor(h * 0.32));
        g.moveTo(8, Math.floor(h * 0.32) + stripeH);
        g.lineTo(w - 8, Math.floor(h * 0.32) + stripeH);
        g.strokePath();

        if (cutout) {
          g.fillStyle(0x000000, 1);
          g.fillRoundedRect(Math.floor(w * 0.32), Math.floor(h * 0.28), Math.floor(w * 0.36), Math.floor(h * 0.44), 6);
          g.fillStyle(0x1f232a, 0.9);
          g.fillRoundedRect(Math.floor(w * 0.34), Math.floor(h * 0.30), Math.floor(w * 0.32), Math.floor(h * 0.40), 6);
        }
      });
    };

    makePlate('hunter_debris_plate0', 84, 54, 0x11aa33, true);
    makePlate('hunter_debris_plate1', 72, 46, 0x7722bb, false);
    makePlate('hunter_debris_plate2', 64, 40, 0x55cc10, true);
    makePlate('hunter_debris_plate3', 56, 36, 0xa8e123, false);

    mk('hunter_debris_spike0', 58, 58, (g, w, h) => {
      g.fillStyle(0x424a56, 1);
      g.fillTriangle(6, h - 10, w - 10, h - 8, Math.floor(w * 0.52), 6);
      g.fillStyle(0x2f353f, 0.95);
      g.fillTriangle(10, h - 14, w - 14, h - 12, Math.floor(w * 0.52), 10);
      g.lineStyle(3, 0x15191e, 0.85);
      g.strokeTriangle(6, h - 10, w - 10, h - 8, Math.floor(w * 0.52), 6);
      g.fillStyle(0x262c34, 0.7);
      g.fillRect(0, Math.floor(h * 0.62), w, 6);
      g.fillStyle(0x8f2a32, 0.5);
      g.fillCircle(Math.floor(w * 0.52), Math.floor(h * 0.56), 5.5);
    });
  }

  private static ensureBoostThrusterTextures(scene: MainScene) {
    if (scene.textures.exists('player_boost_thruster')) return;
    const w = 44;
    const h = 20;
    const g = scene.add.graphics({ x: 0, y: 0 });
    g.setVisible(false);

    g.fillStyle(0x2a2a2a, 1);
    g.fillRoundedRect(2, 5, w - 4, h - 10, 4);
    g.fillStyle(0x4a4a4a, 1);
    g.fillRoundedRect(5, 7, w - 10, h - 14, 4);
    g.fillStyle(0x111111, 1);
    g.fillRoundedRect(16, 7, w - 32, h - 14, 3);
    g.lineStyle(2, 0x0a0a0a, 0.9);
    g.strokeRoundedRect(2, 5, w - 4, h - 10, 4);

    g.generateTexture('player_boost_thruster', w, h);
    g.destroy();
  }

  public chassis: Phaser.Physics.Arcade.Sprite;
  private wheelL: Phaser.GameObjects.Sprite;
  private wheelR: Phaser.GameObjects.Sprite;
  private turretBase: Phaser.GameObjects.Sprite | null = null;
  private turretBarrel: Phaser.GameObjects.Sprite | null = null;
  private mgTurret: Phaser.GameObjects.Sprite | null = null;
  private mortarTurret: Phaser.GameObjects.Sprite | null = null;
  private detailLayer: Phaser.GameObjects.Sprite;
  private boostThrusterL?: Phaser.GameObjects.Sprite;
  private boostThrusterR?: Phaser.GameObjects.Sprite;
  private healthBar: Phaser.GameObjects.Graphics;
  
  private scene: MainScene;
  public type: TankType;
  public currentShell: ShellType = ShellType.HE;
  public hp: number;
  public maxHp: number;
  public isPlayer: boolean;
  public active = true;
  private lastFired: number = 0;
  private lastShellFired: Partial<Record<ShellType, number>> = {};
  private lastMgFired: number = 0;
  private lastShellSwitchAt: number = -999999;
  private mgAmmo: number = 30;
  private mgReloadingUntil: number = 0;
  private lastMortarFired: number = 0;
  private lastNukeFired: number = 0;
  private lastMinePlaced: number = -7000;
  private stunTimer: number = 0;
  private trajectoryGraphics: Phaser.GameObjects.Graphics;
  public isDead: boolean = false; 
  private lastDamageType: ShellType = ShellType.HE;
  private aimIndicatorWorld = new Phaser.Math.Vector2(0, 0);
  private aimIndicatorActive = false;
  
  private currentTurretAngle: number = 0; 
  private targetTurretAngle: number = 0;  
  private keys: any = null;
  private mineKey?: Phaser.Input.Keyboard.Key;
  private mineKeyNumpad?: Phaser.Input.Keyboard.Key;
  private keyboardListeners: { event: string; fn: (...args: any[]) => void }[] = [];
  private idleTimer: number = 0;
  private isMortarAiming: boolean = false;
  private isNukeAiming: boolean = false;
  private isShellAiming: boolean = false;
  private prevMouseFireHeld: boolean = false;
  private prevVirtualFireHeld: boolean = false;
  private prevVirtualNukeHeld: boolean = false;
  private autoFireMg: boolean = false;
  private mgTopUpActive: boolean = false;
  private mgTopUpNextBulletAt: number = 0;
  private prevQDown: boolean = false;
  private aimZoomHeldMs: number = 0;
  private mortarZoomHeldMs: number = 0;
  private nukeZoomHeldMs: number = 0;
  private mortarAimAngle: number = -Math.PI / 2;
  private virtualInput = { left: false, right: false, boost: false, zoom: false, lift: false, fire: false, mg: false, mortar: false, nuke: false };
  private scaleFactor: number = 1;
  private liftFuel = 1;
  private lastLiftFxT = 0;
  private tumbleRoll = 0;
  private hunterOverlay?: Phaser.GameObjects.Graphics;
  private hunterLaser?: Phaser.GameObjects.Graphics;
  private hunterAimStartT = 0;
  private cinematicSuspended = false;
  private camoGraphics?: Phaser.GameObjects.Graphics;
  private hullMaterialMul?: Phaser.GameObjects.Graphics;
  private hullMaterialAdd?: Phaser.GameObjects.Graphics;
  private turretMaterialMul?: Phaser.GameObjects.Graphics;
  private turretMaterialAdd?: Phaser.GameObjects.Graphics;
  private lastTapA = -999999;
  private lastTapD = -999999;
  private ramUntilT = 0;
  private ramDecayUntilT = 0;
  private ramDir: -1 | 1 = 1;
  private ramDamage = 0;
  private lastRamFxT = 0;
  private ramFlameUntilT = 0;
  private ramHitT = new Map<any, number>();
  private boostChargeReadyAt: [number, number] = [0, 0];
  private prevVirtualBoost = false;
  private noCooldown = false;
  private aimHoldSoundPlayed = false;
  private currentAimSound: Phaser.Sound.BaseSound | null = null;

  // Cache trajectory redraw state to avoid expensive full recompute every frame.
  private lastTrajectoryDrawT = 0;
  private lastTrajectoryAimX = Number.NaN;
  private lastTrajectoryAimY = Number.NaN;
  private lastTrajectoryTankX = Number.NaN;
  private lastTrajectoryTankY = Number.NaN;
  private lastTrajectoryTurretAngle = Number.NaN;
  private lastTrajectoryShell: ShellType = ShellType.HE;
  private lastTrajectoryMode = 0;
  private targetTurretAngleFiltered = Number.NaN;
  
  // Audio state
  private wasMoving = false;
  private wasAirborne = false;
  private lastVy = 0;
  private wasLiftHeld = false;
  private wasLiftHeldInput = false;
  private isRainPlaying = false;
  private isForestLoopPlaying = false;
  private idleSound: Phaser.Sound.BaseSound | null = null;
  private currentEngineRate: number = 1.0;
  private audioGrounded = true;
  private audioAirHeightMax = 0;
  private wasInWater = false;
  private lastLakeFallSoundAt = -999999;
  private riseLoopSound: Phaser.Sound.BaseSound | null = null;
  private riseStopTimer: Phaser.Time.TimerEvent | null = null;
  private riseToken = 0;
  private mgBurstShotCount = 0;
  private mgLastShotAt = 0;
  private mgTailPlayed = true;
  private mgLooping = false;
  private vibrationOffset = { x: 0, y: 0 };
  private readonly audioInstanceId = Phaser.Utils.String.UUID();
  private hunterWasLiftActive = false;
  private enemyBoostUntilT = 0;
  private enemyBoostUseT: number[] = [];
  private burnHeatStartT = 0;
  private burnHeatEndT = 0;
  private burnHeatTargets: any[] | null = null;
  private burnHeatOrigTints: number[] | null = null;

  private readonly VEL_STANDARD = 1800;
  private readonly VEL_HE = 1200;
  private readonly VEL_INCENDIARY = 1600;
  private readonly VEL_AP = 3500;
  private readonly VEL_MORTAR = 1500;
  private readonly VEL_BULLET = 8000;
  private readonly MG_MAG_SIZE = 30;
  private readonly MG_RELOAD_IDLE_MS = 1000;
  private readonly MG_RELOAD_MS = 3000;
  private readonly GRAVITY = 1000;
  private readonly LIFT_CONSUME_PER_SEC = 0.28;
  private readonly LIFT_REGEN_PER_SEC = 0.22;
  private readonly LIFT_THRUST = 3400;
  private readonly LIFT_MAX_UP_SPEED = 680;

  private tickMachineGunReload(time: number) {
    if (this.mgReloadingUntil > 0 && time >= this.mgReloadingUntil) {
      this.mgReloadingUntil = 0;
      this.mgAmmo = this.MG_MAG_SIZE;
    }

    if (this.mgReloadingUntil === 0 && this.mgAmmo <= 0) {
      this.mgTopUpActive = false;
      this.mgTopUpNextBulletAt = 0;
      this.mgReloadingUntil = time + this.MG_RELOAD_MS;
      return;
    }

    if (this.mgReloadingUntil > 0) return;

    const mgInputHeld = this.autoFireMg || this.virtualInput.mg;
    const canTopUpFromIdle = !mgInputHeld && this.mgAmmo > 0 && this.mgAmmo < this.MG_MAG_SIZE && time >= this.lastMgFired + this.MG_RELOAD_IDLE_MS;

    if (mgInputHeld && this.mgTopUpActive) {
      this.mgTopUpActive = false;
      this.mgTopUpNextBulletAt = 0;
      return;
    }

    if (!this.mgTopUpActive && canTopUpFromIdle) {
      this.mgTopUpActive = true;
      this.mgTopUpNextBulletAt = 0;
    }

    if (this.mgTopUpActive) {
      if (this.mgAmmo >= this.MG_MAG_SIZE) {
        this.mgAmmo = this.MG_MAG_SIZE;
        this.mgTopUpActive = false;
        this.mgTopUpNextBulletAt = 0;
        return;
      }

      const stepMs = 100;
      if (this.mgTopUpNextBulletAt <= 0) this.mgTopUpNextBulletAt = time + stepMs;
      if (time < this.mgTopUpNextBulletAt) return;

      const missing = this.MG_MAG_SIZE - this.mgAmmo;
      const bullets = Math.min(missing, Math.floor((time - this.mgTopUpNextBulletAt) / stepMs) + 1);
      if (bullets > 0) {
        this.mgAmmo = Math.min(this.MG_MAG_SIZE, this.mgAmmo + bullets);
        this.mgTopUpNextBulletAt += bullets * stepMs;
      }

      if (this.mgAmmo >= this.MG_MAG_SIZE) {
        this.mgAmmo = this.MG_MAG_SIZE;
        this.mgTopUpActive = false;
        this.mgTopUpNextBulletAt = 0;
      }
    }
  }

  public get x() { return this.chassis.x; }
  public get y() { return this.chassis.y; }
  public getBounds() { return this.chassis.getBounds(); }
  public getLiftFuelFraction() { return this.liftFuel; }
  public getMachineGunAmmo() { return this.mgAmmo; }
  public getMachineGunMagSize() { return this.MG_MAG_SIZE; }
  public getMachineGunReloadTotalMs() { return this.MG_RELOAD_MS; }
  public getMachineGunReloadRemaining(now: number) { return this.mgReloadingUntil > now ? (this.mgReloadingUntil - now) : 0; }
  public isRamming(time: number) { return this.isPlayer && !this.isDead && time < this.ramDecayUntilT; }

  private getBoostMultiplier(time: number) {
    if (time < this.ramUntilT) return 1.8;
    if (time < this.ramDecayUntilT) {
      const denom = Math.max(1, this.ramDecayUntilT - this.ramUntilT);
      const t = Phaser.Math.Clamp((time - this.ramUntilT) / denom, 0, 1);
      return Phaser.Math.Linear(1.8, 1, t);
    }
    return 1;
  }

  private spendBoostCharge(time: number): boolean {
    const cd = 3000;
    const aReady = this.boostChargeReadyAt[0] <= time;
    const bReady = this.boostChargeReadyAt[1] <= time;
    const idx = aReady ? 0 : (bReady ? 1 : -1);
    if (idx < 0) return false;
    if (idx === 0) this.boostChargeReadyAt[0] = time + cd;
    else this.boostChargeReadyAt[1] = time + cd;
    return true;
  }

  private getEnemyBoostMultiplier(time: number) {
    if (this.isPlayer) return 1;
    return time < this.enemyBoostUntilT ? 1.5 : 1;
  }

  private tryStartEnemyBoost(time: number, want: boolean) {
    if (this.isPlayer || this.isDead || !want) return;
    if (time < this.enemyBoostUntilT) return;
    const windowMs = 10000;
    const cutoff = time - windowMs;
    while (this.enemyBoostUseT.length > 0 && this.enemyBoostUseT[0] < cutoff) this.enemyBoostUseT.shift();
    if (this.enemyBoostUseT.length >= 2) return;
    this.enemyBoostUntilT = time + 2000;
    this.enemyBoostUseT.push(time);
  }

  public tryRamHit(target: any, time: number) {
    return;
  }

  private computeRamDamage(target?: any): number {
    const pb = this.chassis?.body as Phaser.Physics.Arcade.Body | undefined;
    const spec = SPECS[this.type];
    const targetBodyObj = target instanceof Tank ? target.chassis : target;
    const tb = targetBodyObj?.body as Phaser.Physics.Arcade.Body | undefined;
    const relVx = Math.abs((pb?.velocity?.x ?? 0) - (tb?.velocity?.x ?? 0));
    const denom = Math.max(1, spec.speed * 3.6);
    const t = Phaser.Math.Clamp(relVx / denom, 0, 1.6);
    return Math.round(220 + t * 2300);
  }

  private startRam(dir: -1 | 1, time: number) {
    if (!this.isPlayer || this.isDead) return;
    if (!this.spendBoostCharge(time)) return;
    this.ramDir = dir;
    this.ramUntilT = time + 1500;
    this.ramDecayUntilT = this.ramUntilT + 2500;
    this.ramFlameUntilT = time + 500;
    this.ramDamage = 0;
    this.ramHitT.clear();

    const mx = (this.wheelL.x + this.wheelR.x) * 0.5;
    const my = (this.wheelL.y + this.wheelR.y) * 0.5 + 12 * this.scaleFactor;
    const flameDir = (dir > 0 ? -1 : 1) as -1 | 1;
    this.scene.particles.createRamFlame(mx, my, this.scaleFactor, flameDir);
    this.lastRamFxT = time;
    this.scene.audio.playFolderExclusive('p_boost', 'vehicle/player_soviet/boost/sfx', { volume: 1, cooldownMs: 0 });
  }

  constructor(scene: MainScene, x: number, y: number, type: TankType, isPlayer: boolean = false) {
    this.scene = scene;
    this.type = type;
    this.isPlayer = isPlayer;
    this.currentShell = isPlayer ? ShellType.STANDARD : (type === TankType.ENEMY_TUMBLEWEED ? ShellType.AP : ShellType.HE);
    const spec = SPECS[type];
    this.hp = spec.hp;
    this.maxHp = this.hp;
    this.scaleFactor = Tank.getScaleFor(type, isPlayer);

    const getAsset = (key: string) => {
      if (scene.mapId !== 'desert' || !key) return key;
      const lastUnderscore = key.lastIndexOf('_');
      if (lastUnderscore === -1) return key;
      const prefix = key.substring(0, lastUnderscore);
      const part = key.substring(lastUnderscore + 1);
      return `${prefix}_desert_${part}`;
    };

    const factory = scene.add;
    this.wheelL = factory.sprite(x, y, getAsset(spec.assets.wheel)).setDepth(28).setScale(1.2 * this.scaleFactor);
    this.wheelR = factory.sprite(x, y, getAsset(spec.assets.wheel)).setDepth(28).setScale(1.2 * this.scaleFactor);
    this.chassis = scene.physics.add.sprite(x, y, getAsset(spec.assets.hull)).setDepth(25).setScale(this.scaleFactor);
    (this.chassis.body as Phaser.Physics.Arcade.Body)
      .setAllowGravity(true)
      .setDragX(1000)
      .setSize(100 * this.scaleFactor, 35 * this.scaleFactor, true)
      .setMass(50 * this.scaleFactor)
      .setCollideWorldBounds(true);
    this.detailLayer = factory.sprite(x, y, getAsset(spec.assets.detail)).setDepth(26).setScale(this.scaleFactor);
    if (!isPlayer && type === TankType.ENEMY_TUMBLEWEED) {
      this.wheelL.setAlpha(0);
      this.wheelR.setAlpha(0);
    }

    if (spec.assets.turret && spec.assets.turret !== '') {
      this.turretBase = factory.sprite(x, y, getAsset(spec.assets.turret)).setDepth(27).setScale(this.scaleFactor);
      this.turretBarrel = factory.sprite(x, y, `${getAsset(spec.assets.barrel)}_0`).setOrigin(0.1, 0.5).setDepth(29).setScale(this.scaleFactor);
    } else {
      this.turretBarrel = factory.sprite(x, y, `${getAsset(spec.assets.barrel)}_0`).setOrigin(0.1, 0.5).setDepth(29).setScale(this.scaleFactor);
    }

    const baseTint = this.getReadableTint(spec.bodyColor);
    this.chassis.setTint(baseTint);
    this.detailLayer.setTint(isPlayer && type === TankType.PLAYER_SOVIET ? 0xffffff : baseTint);
    this.wheelL.setTint(baseTint);
    this.wheelR.setTint(baseTint);
    this.turretBase?.setTint(baseTint);
    this.turretBarrel?.setTint(baseTint);
    // this.createMaterialOverlays(baseTint); // Disabled to remove "paint artifact"

    if (!isPlayer && type === TankType.ENEMY_HUNTER) {
      const g = factory.graphics().setDepth(26.7);
      g.setBlendMode(Phaser.BlendModes.NORMAL);
      g.setAlpha(0.56);
      const base = ((Math.floor(x) * 73856093) ^ (Math.floor(y) * 19349663) ^ 0x9e3779b9) >>> 0;
      let s = base;
      const rnd = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0xffffffff;
      };
      const shades = [0x5a6470, 0x49525d, 0x3f4752, 0x2f363f, 0x89232d];
      for (let i = 0; i < 30; i++) {
        const px = -72 + rnd() * 144;
        const py = -46 + rnd() * 70;
        const w = 8 + rnd() * 26;
        const h = 6 + rnd() * 18;
        const c = shades[(rnd() * shades.length) | 0];
        const accentBoost = c === 0x89232d ? 0.05 : 0;
        g.fillStyle(c, 0.14 + rnd() * (0.19 + accentBoost));
        g.fillRect(px, py, w, h);
      }
      g.fillStyle(0x14181e, 0.52);
      g.fillRect(-78, -20, 156, 10);
      g.fillRect(-62, 6, 124, 10);
      g.fillStyle(0x2c343e, 0.76);
      g.fillEllipse(-30, -38, 56, 22);
      g.fillEllipse(16, -28, 62, 24);
      g.fillEllipse(34, -44, 38, 15);
      g.fillStyle(0x1f242b, 0.88);
      g.fillEllipse(92, -8, 34, 14);
      g.fillEllipse(94, 14, 36, 16);
      g.fillStyle(0x0c1015, 0.85);
      g.fillCircle(105, -8, 2.6);
      g.fillCircle(106, 14, 2.8);
      g.lineStyle(2, 0x27303a, 0.86);
      g.beginPath();
      g.moveTo(-72, -30);
      g.lineTo(-26, -56);
      g.lineTo(20, -30);
      g.lineTo(68, -46);
      g.strokePath();
      g.lineStyle(1.5, 0x171c22, 0.9);
      g.beginPath();
      g.moveTo(-44, 16);
      g.lineTo(-8, -4);
      g.lineTo(34, 12);
      g.lineTo(60, -2);
      g.strokePath();
      g.fillStyle(0x91252f, 0.48);
      g.fillEllipse(40, -9, 11, 7);
      g.fillEllipse(46, 7, 13, 8);
      this.hunterOverlay = g;
      scene.tweens.add({
        targets: g,
        alpha: { from: 0.5, to: 0.72 },
        duration: 760,
        yoyo: true,
        repeat: -1
      });
      this.hunterLaser = factory.graphics().setDepth(52).setVisible(false);
    }

    if (isPlayer) {
      this.mgTurret = factory.sprite(x, y, 'hmg_base').setOrigin(0.2, 0.5).setDepth(30).setScale(1.05 * this.scaleFactor);
      this.mortarTurret = factory.sprite(x, y, 'mortar_base').setOrigin(0.5, 0.8).setDepth(26).setScale(0.7 * this.scaleFactor);
      Tank.ensureBoostThrusterTextures(scene);
      this.boostThrusterL = factory.sprite(x, y, 'player_boost_thruster').setDepth(28.4).setScale(this.scaleFactor * 0.6);
      this.boostThrusterR = factory.sprite(x, y, 'player_boost_thruster').setDepth(28.4).setScale(this.scaleFactor * 0.6);
    }
    
    this.trajectoryGraphics = factory.graphics().setDepth(40);
    this.healthBar = factory.graphics().setDepth(60);
    
    if (isPlayer && scene.input.keyboard) {
      this.keys = scene.input.keyboard.addKeys('A,D,LEFT,RIGHT,SHIFT,SPACE,C,Q,Z,ONE,TWO,THREE,FOUR,FIVE,X');
      this.mineKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.C);
      this.mineKeyNumpad = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.NUMPAD_FIVE);
      const bindKey = (event: string, fn: () => void) => {
        scene.input.keyboard.on(event, fn);
        this.keyboardListeners.push({ event, fn });
      };
      bindKey('keydown-ONE', () => this.setShell(ShellType.STANDARD));
      bindKey('keydown-TWO', () => this.setShell(ShellType.HE));
      bindKey('keydown-THREE', () => this.setShell(ShellType.AP));
      bindKey('keydown-FOUR', () => this.setShell(ShellType.INCENDIARY));
      bindKey('keydown-FIVE', () => { if (this.isPlayer && !this.isDead) this.tryPlaceMine(); });
      bindKey('keydown-X', () => { if (this.isPlayer && !this.isDead) this.isNukeAiming = true; });
      bindKey('keyup-X', () => {
        if (this.isPlayer && !this.isDead && this.isNukeAiming) {
          this.isNukeAiming = false;
          this.tryNuke();
        }
      });
    }
    this.idleTimer = Math.random() * 1000;
  }

  private getReadableTint(tint: number): number {
    if (this.isPlayer) return tint;
    const c = Phaser.Display.Color.ValueToColor(tint);
    const max = Math.max(c.red, c.green, c.blue);
    const min = 52;
    if (max >= min) return tint;
    if (max <= 0) return Phaser.Display.Color.GetColor(min, min, min);
    const s = min / max;
    return Phaser.Display.Color.GetColor(
      Math.min(255, Math.round(c.red * s)),
      Math.min(255, Math.round(c.green * s)),
      Math.min(255, Math.round(c.blue * s))
    );
  }

  private applyBaseTint() {
    const tint = this.getReadableTint(SPECS[this.type].bodyColor);
    this.chassis.setTint(tint);
    this.detailLayer.setTint(tint);
    this.wheelL.setTint(tint);
    this.wheelR.setTint(tint);
    this.turretBase?.setTint(tint);
    this.turretBarrel?.setTint(tint);
  }

  private createCamouflage() {
    if (!this.isPlayer) return;
    const g = this.scene.add.graphics();
    g.setDepth(25.1);
    g.setBlendMode(Phaser.BlendModes.MULTIPLY);
    
    // Brighter/More vivid camouflage colors
    const colors = [0x556b2f, 0x8b4513, 0x2f4f4f, 0x6b8e23];
    const w = 100, h = 35;
    
    for (let i = 0; i < 10; i++) {
        const c = Phaser.Utils.Array.GetRandom(colors);
        g.fillStyle(c, 0.65);
        
        const cx = Phaser.Math.Between(-w/2 + 5, w/2 - 5);
        const cy = Phaser.Math.Between(-h/2 + 5, h/2 - 5);
        const points = [];
        const sides = Phaser.Math.Between(3, 6);
        for (let j=0; j<sides; j++) {
            const ang = (j / sides) * Math.PI * 2 + Phaser.Math.FloatBetween(0, 1);
            const rad = Phaser.Math.Between(6, 18);
            points.push({ x: cx + Math.cos(ang)*rad, y: cy + Math.sin(ang)*rad });
        }
        g.fillPoints(points, true);
    }
    this.camoGraphics = g;
  }

  private createMaterialOverlays(baseTint: number) {
    const c = Phaser.Display.Color.ValueToColor(baseTint);
    const clamp8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    const shade = (mul: number, add: number) => Phaser.Display.Color.GetColor(
      clamp8(c.red * mul + add),
      clamp8(c.green * mul + add),
      clamp8(c.blue * mul + add)
    );

    const deep = shade(0.55, -8);
    const mid = shade(0.82, -2);
    const bright = shade(1.10, 10);
    const hot = Phaser.Display.Color.GetColor(
      clamp8(c.red * 1.35 + 18),
      clamp8(c.green * 1.25 + 16),
      clamp8(c.blue * 1.25 + 16)
    );

    const base = ((Math.floor(this.chassis.x) * 73856093) ^ (Math.floor(this.chassis.y) * 19349663) ^ ((this.type as number) * 83492791) ^ 0x9e3779b9) >>> 0;
    let s = base || 1;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };

    const hullW = 100;
    const hullH = 35;
    const fxAlphaMul = this.isPlayer ? 0.40 : 0.48;
    const fxAlphaAdd = this.isPlayer ? 0.22 : 0.18;

    const hm = this.scene.add.graphics().setDepth(25.55);
    hm.setBlendMode(Phaser.BlendModes.MULTIPLY);
    hm.setAlpha(fxAlphaMul);
    for (let i = 0; i < 14; i++) {
      const px = -hullW * 0.5 + rnd() * hullW;
      const py = -hullH * 0.5 + rnd() * hullH;
      const w = 8 + rnd() * 26;
      const h = 5 + rnd() * 16;
      hm.fillStyle(rnd() > 0.55 ? deep : mid, 0.12 + rnd() * 0.20);
      hm.fillRect(px, py, w, h);
    }
    hm.fillStyle(deep, 0.22);
    hm.fillRect(-hullW * 0.5, -hullH * 0.12, hullW, hullH * 0.18);
    hm.fillRect(-hullW * 0.5, hullH * 0.16, hullW, hullH * 0.12);
    hm.fillStyle(deep, 0.18);
    for (let i = 0; i < 10; i++) {
      const rx = -hullW * 0.45 + rnd() * hullW * 0.9;
      const ry = -hullH * 0.35 + rnd() * hullH * 0.7;
      hm.fillRect(rx, ry, 2 + rnd() * 10, 1 + rnd() * 2);
    }
    hm.fillStyle(0x0a0a0a, 0.16);
    for (let i = 0; i < 12; i++) {
      const rx = -hullW * 0.47 + rnd() * hullW * 0.94;
      const ry = -hullH * 0.42 + rnd() * hullH * 0.84;
      hm.fillCircle(rx, ry, 0.8 + rnd() * 1.2);
    }
    this.hullMaterialMul = hm;

    const ha = this.scene.add.graphics().setDepth(26.15);
    ha.setBlendMode(Phaser.BlendModes.ADD);
    ha.setAlpha(fxAlphaAdd);
    ha.fillStyle(bright, 0.12);
    ha.fillRect(-hullW * 0.44, -hullH * 0.42, hullW * 0.88, hullH * 0.18);
    ha.fillStyle(hot, 0.06);
    ha.fillRect(-hullW * 0.38, -hullH * 0.30, hullW * 0.62, hullH * 0.10);
    this.hullMaterialAdd = ha;

    if (this.turretBase) {
      const tw = 78;
      const th = 28;

      const tm = this.scene.add.graphics().setDepth(27.25);
      tm.setBlendMode(Phaser.BlendModes.MULTIPLY);
      tm.setAlpha(fxAlphaMul * 0.9);
      for (let i = 0; i < 10; i++) {
        const px = -tw * 0.5 + rnd() * tw;
        const py = -th * 0.5 + rnd() * th;
        const w = 6 + rnd() * 18;
        const h = 4 + rnd() * 12;
        tm.fillStyle(rnd() > 0.55 ? deep : mid, 0.10 + rnd() * 0.18);
        tm.fillRect(px, py, w, h);
      }
      tm.fillStyle(deep, 0.18);
      tm.fillRect(-tw * 0.5, -th * 0.08, tw, th * 0.16);
      this.turretMaterialMul = tm;

      const ta = this.scene.add.graphics().setDepth(27.85);
      ta.setBlendMode(Phaser.BlendModes.ADD);
      ta.setAlpha(fxAlphaAdd);
      ta.fillStyle(bright, 0.10);
      ta.fillRect(-tw * 0.40, -th * 0.42, tw * 0.80, th * 0.16);
      this.turretMaterialAdd = ta;
    }
  }

  public setCinematicSuspended(suspended: boolean) {
    this.cinematicSuspended = suspended;
    const body = this.chassis.body as Phaser.Physics.Arcade.Body | undefined;
    if (body) {
      body.setVelocity(0, 0);
      body.setAngularVelocity(0);
      body.setEnable(!suspended);
    }
    this.healthBar.setVisible(!suspended);
    if (suspended) this.hunterLaser?.clear().setVisible(false);
  }

  private hibernating = false;

  public setHibernating(hibernating: boolean) {
    if (this.isDead) return;
    if (hibernating === this.hibernating) return;
    this.hibernating = hibernating;

    const vis = !hibernating;
    const parts = [
      this.chassis,
      this.wheelL,
      this.wheelR,
      this.detailLayer,
      this.hullMaterialMul,
      this.hullMaterialAdd,
      this.boostThrusterL,
      this.boostThrusterR,
      this.turretBase,
      this.turretBarrel,
      this.turretMaterialMul,
      this.turretMaterialAdd,
      this.mgTurret,
      this.mortarTurret,
      this.hunterOverlay,
      this.hunterLaser,
      this.trajectoryGraphics,
      this.healthBar,
      this.camoGraphics
    ].filter((p): p is any => !!p);

    parts.forEach(p => {
      if (typeof p.setVisible === 'function') p.setVisible(vis);
      if (typeof p.setActive === 'function') p.setActive(vis);
    });

    const body = this.chassis.body as Phaser.Physics.Arcade.Body | undefined;
    if (body) {
      body.setVelocity(0, 0);
      body.setAngularVelocity(0);
      body.setEnable(vis);
    }
  }

  public setWorldPosition(x: number, y: number) {
    this.chassis.setPosition(x, y);
    this.syncLayers();
  }

  private tryPlaceMine() {
    const now = this.scene.time.now;
    if (!this.noCooldown && now < this.lastMinePlaced + 7000) return;
    this.lastMinePlaced = now;
    this.scene.placeMine(this.chassis.x);
  }

  public setVirtualInputState(state: { left: boolean; right: boolean; boost: boolean; zoom: boolean; lift: boolean; fire: boolean; mg: boolean; mortar: boolean; nuke: boolean; }) {
    this.virtualInput = state;
  }

  public setNoCooldown(active: boolean) {
    this.noCooldown = active;
  }

  public grantOneTimeCooldownWaiver(shell: ShellType.MORTAR | ShellType.NUKE) {
    const now = this.scene.time.now;
    if (shell === ShellType.MORTAR) {
      const readyAt = now - 20000;
      this.lastMortarFired = Math.min(this.lastMortarFired, readyAt);
      const last = this.lastShellFired[ShellType.MORTAR] ?? 0;
      this.lastShellFired[ShellType.MORTAR] = Math.min(last, readyAt);
      return;
    }

    const readyAt = now - 60000;
    this.lastNukeFired = Math.min(this.lastNukeFired, readyAt);
    const last = this.lastShellFired[ShellType.NUKE] ?? 0;
    this.lastShellFired[ShellType.NUKE] = Math.min(last, readyAt);
  }

  public getAimIndicatorWorld(out?: Phaser.Math.Vector2): Phaser.Math.Vector2 | null {
    if (!this.aimIndicatorActive) return null;
    if (out) {
      out.copy(this.aimIndicatorWorld);
      return out;
    }
    return this.aimIndicatorWorld.clone();
  }

  public cycleShell() {
    this.switchShell();
  }

  private canEnemyUseApShell(): boolean {
    return this.type === TankType.ENEMY_HUNTER || this.type === TankType.ENEMY_TUMBLEWEED;
  }

  private switchShell() {
    if (this.isDead) return;
    const types = [ShellType.STANDARD, ShellType.HE, ShellType.AP, ShellType.INCENDIARY];
    const nextIdx = (types.indexOf(this.currentShell) + 1) % types.length;
    this.setShell(types[nextIdx]);
  }

  public setShell(shell: ShellType) {
    if (this.isDead) return;
    if (shell === ShellType.BULLET) return;
    if (!this.isPlayer && this.type === TankType.ENEMY_HUNTER && shell === ShellType.NUKE) return;
    if (!this.isPlayer && shell === ShellType.AP && !this.canEnemyUseApShell()) shell = ShellType.HE;
    
    if (this.isPlayer && this.currentShell !== shell) {
      const now = this.scene.time.now;
      if (!this.noCooldown && now < this.lastShellSwitchAt + 500) return;
      this.lastShellSwitchAt = now;
    }

    if (this.isPlayer && this.currentShell !== shell) {
      this.scene.audio.playFolder('vehicle/player_soviet/shell_switch/sfx', { volume: 0.6, cooldownMs: 150 });
    }

    this.currentShell = shell;
    if (this.isPlayer) this.scene.events.emit('update-hud', { hp: (this.hp / this.maxHp) * 100, shell: ShellType[this.currentShell] });
  }

  public getCooldownRemaining(now: number) {
    if (this.isPlayer && this.noCooldown) {
      const cds: Partial<Record<ShellType, number>> = {};
      const shells = [ShellType.STANDARD, ShellType.HE, ShellType.AP, ShellType.INCENDIARY, ShellType.MORTAR, ShellType.NUKE];
      for (const s of shells) cds[s] = 0;
      return { shells: cds, mortarMs: 0, mgMs: 0, nukeMs: 0 };
    }
    const cds: Partial<Record<ShellType, number>> = {};
    const cdFor = (s: ShellType) => (
      s === ShellType.STANDARD ? 500 :
      s === ShellType.AP ? 5000 :
      s === ShellType.HE ? 7000 :
      s === ShellType.INCENDIARY ? 1250 :
      s === ShellType.MORTAR ? 20000 :
      s === ShellType.NUKE ? 60000 :
      0
    );
    const shells = [ShellType.STANDARD, ShellType.HE, ShellType.AP, ShellType.INCENDIARY, ShellType.MORTAR, ShellType.NUKE];
    for (const s of shells) {
      const cd = cdFor(s);
      const last = this.lastShellFired[s] ?? 0;
      cds[s] = Math.max(0, cd - (now - last));
    }
    const mortarMs = Math.max(0, 20000 - (now - this.lastMortarFired));
    const mgMs = Math.max(0, 60 - (now - this.lastMgFired));
    const nukeMs = Math.max(0, 60000 - (now - this.lastNukeFired));
    return { shells: cds, mortarMs, mgMs, nukeMs };
  }

  public applyStun(durationMs: number) {
    if (this.isPlayer || this.isDead) return;
    if (this.type === TankType.ENEMY_HUNTER && this.lastDamageType === ShellType.HE) {
      durationMs = Math.min(durationMs, 1000);
      this.hunterAimStartT = 0;
      this.hunterLaser?.clear().setVisible(false);
    }
    this.stunTimer = durationMs;
    const body = this.chassis.body as Phaser.Physics.Arcade.Body | undefined;
    if (body) body.setVelocityX(0);
    this.chassis.setTint(0x5555ff);
    this.scene.time.delayedCall(durationMs, () => {
        if (!this.isDead) this.applyBaseTint();
    });
  }

  private clampMortarAngle(angle: number): number {
    const deg = Phaser.Math.RadToDeg(angle);
    const normDeg = Phaser.Math.Angle.WrapDegrees(deg);
    if (normDeg > -45 && normDeg < 90) return Phaser.Math.DegToRad(-45);
    if (normDeg < -140 || (normDeg > 90 && normDeg < 180)) return Phaser.Math.DegToRad(-140);
    return angle;
  }

  private updateAudio(time: number, delta: number) {
    if (!this.isPlayer || this.type !== TankType.PLAYER_SOVIET) return;

    const loopId = `p_idle_${this.audioInstanceId}`;
    const mechLoopId = `p_mech_${this.audioInstanceId}`;
    const forestLoopId = `p_forest_${this.audioInstanceId}`;

    if (this.isDead || !this.active || !this.chassis?.active) {
      this.scene.audio.stopLoop(loopId, 400);
      this.scene.audio.stopLoop(mechLoopId, 400);
      this.scene.audio.stopLoop(forestLoopId, 400);
      this.idleSound = null;
      return;
    }

    const body = this.chassis.body as Phaser.Physics.Arcade.Body;
    let isMoving = Math.abs(body.velocity.x) > 15;

    if (this.isPlayer) {
      const left = (this.keys?.A?.isDown as boolean | undefined) || (this.keys?.LEFT?.isDown as boolean | undefined) || this.virtualInput.left;
      const right = (this.keys?.D?.isDown as boolean | undefined) || (this.keys?.RIGHT?.isDown as boolean | undefined) || this.virtualInput.right;
      isMoving = isMoving || !!(left || right);
    }

    const inForest = this.scene.mapId === 'forest';
    const grounded = this.audioGrounded;
    const waterSurfaceY = this.scene.getWaterSurfaceY(this.chassis.x);
    const inWater = waterSurfaceY !== null && this.chassis.y > waterSurfaceY + 8;

    // --- Idle Engine Pitch Modulation (Speed + Slope) ---
    const speedAbs = Math.abs(body.velocity.x);
    const speedT = Phaser.Math.Clamp(speedAbs / 750, 0, 1);
    let targetRate = isMoving ? Phaser.Math.Linear(1.0, 1.9, speedT) : 1.0;
    if (isMoving) {
      const vx = body.velocity.x;
      const moveDir = vx > 0 ? 1 : -1;
      const t = Phaser.Math.Clamp(Math.abs(Math.sin(this.chassis.rotation)) / Math.sin(Math.PI / 4), 0, 1);
      if (t > 0.02) {
        const uphill = (moveDir > 0 && this.chassis.rotation < 0) || (moveDir < 0 && this.chassis.rotation > 0);
        const slopeMul = uphill ? (1 - 0.22 * t) : (1 + 0.12 * t);
        targetRate *= slopeMul;
      }
    }
    targetRate = Phaser.Math.Clamp(targetRate, 0.7, 2.2);

    const dt = delta / 1000;
    const changeSpeed = isMoving ? 0.4 : 1.0;
    if (this.currentEngineRate < targetRate) {
      const diff = targetRate - this.currentEngineRate;
      const maxChange = changeSpeed * dt;
      if (diff <= maxChange) this.currentEngineRate = targetRate;
      else this.currentEngineRate += maxChange;
    } else if (this.currentEngineRate > targetRate) {
      this.currentEngineRate = Phaser.Math.Linear(this.currentEngineRate, targetRate, Math.min(dt * 5.0, 1.0));
    }

    try {
      (this.idleSound as any)?.setRate?.(this.currentEngineRate);
    } catch {}

    const idleFolder = 'vehicle/player_soviet/idle_engine_loop/sfx';
    if (!this.idleSound) {
      this.scene.audio.startLoop(loopId, idleFolder, { volume: 0.55, fadeInMs: 300, worldX: this.chassis.x, worldY: this.chassis.y, maxDistance: 5200 })
        .then(sound => {
          if (!sound) return;
          this.idleSound = sound;
          try {
            (this.idleSound as any).setRate?.(this.currentEngineRate);
          } catch {}
        })
        .catch(() => {});
    } else {
      (this.idleSound as any).__panzerWorldX = this.chassis.x;
      (this.idleSound as any).__panzerWorldY = this.chassis.y;
      (this.idleSound as any).__panzerMaxDistance = 5200;
    }

    const mechFolder = 'vehicle/player_soviet/cruise/mechanical_loop/sfx';
    const forestFolder = 'vehicle/player_soviet/cruise/tire_forest_loop/sfx';

    const shouldCruise = grounded && !inWater && isMoving;
    if (shouldCruise) {
      const hasMech = (this.scene.audio as any)['loops']?.has?.(mechLoopId) === true;
      if (!this.wasMoving || !hasMech) {
        this.scene.audio.startLoop(mechLoopId, mechFolder, { volume: 0.65, fadeInMs: 1000, worldX: this.chassis.x, worldY: this.chassis.y, maxDistance: 5200 }).catch(() => {});
      }
    } else if (this.wasMoving) {
      this.scene.audio.stopLoop(mechLoopId, 1000);
    }

    const shouldForest = shouldCruise && inForest;
    if (shouldForest) {
      const hasForest = (this.scene.audio as any)['loops']?.has?.(forestLoopId) === true;
      if (!this.isForestLoopPlaying || !hasForest) {
        this.isForestLoopPlaying = true;
        this.scene.audio.startLoop(forestLoopId, forestFolder, { volume: 0.6, fadeInMs: 1000, worldX: this.chassis.x, worldY: this.chassis.y, maxDistance: 5200 }).catch(() => {});
      }
    } else if (this.isForestLoopPlaying) {
      this.isForestLoopPlaying = false;
      this.scene.audio.stopLoop(forestLoopId, 1000);
    }

    const mechSound = (this.scene.audio as any)['loops']?.get(mechLoopId);
    if (mechSound) {
      (mechSound as any).__panzerWorldX = this.chassis.x;
      (mechSound as any).__panzerWorldY = this.chassis.y;
      (mechSound as any).__panzerMaxDistance = 5200;
    }

    const forestSound = (this.scene.audio as any)['loops']?.get(forestLoopId);
    if (forestSound) {
      (forestSound as any).__panzerWorldX = this.chassis.x;
      (forestSound as any).__panzerWorldY = this.chassis.y;
      (forestSound as any).__panzerMaxDistance = 5200;
    }

    this.wasMoving = shouldCruise;

    const isAirborne = !grounded;
    const liftHeld = ((this.keys?.SPACE?.isDown as boolean | undefined) || this.virtualInput.lift) === true;
    const liftActive = liftHeld && this.liftFuel > 0;

    if (liftActive && !this.wasLiftHeld) {
      this.riseToken++;
      const restarting = !!this.riseStopTimer;
      if (this.riseStopTimer) {
        this.riseStopTimer.remove(false);
        this.riseStopTimer = null;
      }
      if (restarting) {
        this.scene.audio.stopLoop('p_rise', 0);
        this.riseLoopSound = null;
      }

      this.scene.audio.playFolderExclusive('p_rise_start', 'vehicle/player_soviet/rise_start/sfx', { volume: 1 });

      this.scene.audio.startLoop('p_rise', 'vehicle/player_soviet/rise/sfx', { volume: 0.75, detune: -600, fadeInMs: restarting ? 80 : 0 })
        .then(sound => {
          if (!sound) return;
          this.riseLoopSound = sound;
          this.scene.audio.ensureLowpass(sound, 30);
          this.scene.audio.setLowpassFrequency(sound, 30);
          this.scene.audio.tweenLowpassFrequency(sound, 30000, 300);
          this.scene.audio.tweenDetune(sound, 100, 300);
        })
        .catch(() => {});
    } else if (!liftActive && this.wasLiftHeld) {
      this.riseToken++;
      const token = this.riseToken;
      if (this.riseStopTimer) {
        this.riseStopTimer.remove(false);
        this.riseStopTimer = null;
      }

      this.scene.audio.stopLoop('p_rise', 500);
      this.riseStopTimer = this.scene.time.delayedCall(
        500,
        () => {
          if (this.riseToken !== token) return;
          this.riseLoopSound = null;
          this.riseStopTimer = null;
        },
        undefined,
        this
      );
    }

    if (grounded && this.wasAirborne) {
      if (this.riseLoopSound || this.riseStopTimer) {
        this.riseToken++;
        if (this.riseStopTimer) {
          this.riseStopTimer.remove(false);
          this.riseStopTimer = null;
        }
        this.scene.audio.stopLoop('p_rise', 300);
        this.riseLoopSound = null;
      }
      if (this.lastVy > 250) {
        const h = this.audioAirHeightMax;
        const denom = 650 * this.scaleFactor;
        const t = Phaser.Math.Clamp(denom > 0 ? h / denom : 0, 0, 1);
        const vol = Phaser.Math.Linear(0.6, 1, t);
        const cutHz = Phaser.Math.Linear(560, 30000, t);
        this.scene.audio.playFolder('vehicle/player_soviet/fall/sfx', { volume: vol })
          .then(sound => {
            if (!sound) return;
            this.scene.audio.setLowpassFrequency(sound, cutHz);
          })
          .catch(() => {});
      }
      this.audioAirHeightMax = 0;
    }

    this.wasAirborne = isAirborne;
    this.wasLiftHeld = liftHeld;
    this.lastVy = body.velocity.y;

    // Rain loop logic removed due to missing audio file
  }

  public update(time: number, delta: number, player?: Tank) {
    if (!this.chassis.active || this.isDead) return;

    const waterSurfaceY = this.scene.getWaterSurfaceY(this.chassis.x);
    const inWater = waterSurfaceY !== null && this.chassis.y > waterSurfaceY + 8;
    const entersWater = waterSurfaceY !== null && this.chassis.y > waterSurfaceY - 18;
    const keepsWaterState = waterSurfaceY !== null && this.chassis.y > waterSurfaceY - 42;
    const touchingWater = this.wasInWater ? keepsWaterState : entersWater;

    if (touchingWater && !this.wasInWater) {
      const now = this.scene.time.now;
      if (this.isPlayer && now > this.lastLakeFallSoundAt + 900) {
        this.lastLakeFallSoundAt = now;
        this.scene.audio.playFolder('vehicle/Lake_fall/sfx', {
          volume: 1.0,
          worldX: this.chassis.x,
          worldY: waterSurfaceY ?? this.chassis.y,
          cooldownMs: 0
        }).catch(() => {});
      }
    }
    this.wasInWater = touchingWater;

    const groundSample = (x: number) => (this.isPlayer && inWater ? this.scene.getTerrainHeight(x) : this.scene.getGroundHeight(x));

    if (this.cinematicSuspended) {
      this.syncLayers();
      return;
    }

    // Optimized: Reduced samples from 5 to 3 for performance
    const samples = [-40, 0, 40];
    const terrainHeights = samples.map(off => groundSample(this.chassis.x + off));
    const sorted = terrainHeights.slice().sort((a, b) => a - b);
    const medianHeight = sorted[1]; // Middle of 3 samples
    
    const targetY = medianHeight - 22 * this.scaleFactor;
    if (this.chassis.y > targetY) {
        const diff = this.chassis.y - targetY;
        if (diff > 360) {
            this.chassis.y = targetY;
            (this.chassis.body as Phaser.Physics.Arcade.Body).setVelocityY(0);
        } else {
            this.chassis.y = Phaser.Math.Linear(this.chassis.y, targetY, 0.65);
            this.chassis.setVelocityY(Math.min(0, this.chassis.body.velocity.y));
        }
    }

    // Ensure opacity is full (fix for transparency bug)
    if (this.chassis.alpha < 1) this.chassis.setAlpha(1);
    if (this.wheelL.alpha < 1) this.wheelL.setAlpha(1);
    if (this.wheelR.alpha < 1) this.wheelR.setAlpha(1);
    if (this.detailLayer.alpha < 1) this.detailLayer.setAlpha(1);
    
    const groundedForRot = (this.chassis.body as Phaser.Physics.Arcade.Body).blocked.down || this.chassis.y >= targetY - 8 * this.scaleFactor;
    if (groundedForRot) {
      const targetRotation = this.scene.getTerrainNormal(this.chassis.x);
      this.chassis.rotation = Phaser.Math.Angle.RotateTo(this.chassis.rotation, targetRotation, 0.05);
    } else {
      let targetRot = -0.12; // Left-heavy bias
      if (this.isPlayer && !this.isDead) {
          const left = (this.keys?.A?.isDown || this.keys?.LEFT?.isDown || this.virtualInput.left);
          const right = (this.keys?.D?.isDown || this.keys?.RIGHT?.isDown || this.virtualInput.right);
          if (right && !left) targetRot = 0.25; // Right acceleration tilt
          else if (left && !right) targetRot = -0.35; // Left acceleration tilt
      }
      this.chassis.rotation = Phaser.Math.Linear(this.chassis.rotation, targetRot, 0.04);
    }

    this.tickMachineGunReload(time);

    this.updateBurnHeatTint(time);

    if (this.stunTimer > 0) {
        this.stunTimer -= delta;
        this.syncLayers();
        this.drawHealthBar();
        return; 
    }

    const spec = SPECS[this.type];
    const slopeDegrees = Math.abs(Phaser.Math.RadToDeg(this.chassis.rotation));
    const isStationary = Math.abs(this.chassis.body.velocity.x) < 5 && Math.abs(this.chassis.body.velocity.y) < 5;
    const inSwamp = this.scene.isSwampAt(this.chassis.x);
    const rainMud = this.scene.mapId === 'forest' && (this.scene.particles as any)?.isRainActive?.() === true;
    const swampMul = inSwamp ? 0.6 : 1.0;
    const waterMul = inWater ? 0.3 : 1.0;

    if (!this.isPlayer && this.type === TankType.ENEMY_HUNTER && this.chassis.getData('introDropping') === true) {
      const body = this.chassis.body as Phaser.Physics.Arcade.Body;
      const groundY = groundSample(this.chassis.x);
      const landed = body.blocked.down || this.chassis.y >= groundY - 70 * this.scaleFactor;
      if (!landed) {
        this.healthBar.setVisible(false);
        this.hunterLaser?.clear().setVisible(false);
        body.setVelocityX(body.velocity.x * 0.92);
        this.syncLayers();
        return;
      }
      this.chassis.setData('introDropping', false);
      this.healthBar.setVisible(true);
    }
    if (!this.isPlayer && this.type === TankType.ENEMY_TUMBLEWEED) {
      const body = this.chassis.body as Phaser.Physics.Arcade.Body;
      const rollSpeed = Phaser.Math.Clamp(body.velocity.x / 220, -3.2, 3.2);
      this.tumbleRoll += rollSpeed * (delta / 1000) * Math.PI * 2;
    }

    if (this.isPlayer) {
      const cam = this.scene.cameras.main;
      {
        const body = this.chassis.body as Phaser.Physics.Arcade.Body;
        this.audioGrounded = body.blocked.down || this.chassis.y >= targetY - 2 * this.scaleFactor;
      }
      const airH = Math.max(0, targetY - this.chassis.y);
      if (!this.audioGrounded) this.audioAirHeightMax = Math.max(this.audioAirHeightMax, airH);

      let direction = 0;
      const shiftJust = this.keys?.SHIFT ? Phaser.Input.Keyboard.JustDown(this.keys.SHIFT as any) : false;
      const virtualBoostHeld = this.virtualInput.boost === true;
      const virtualBoostJust = virtualBoostHeld && !this.prevVirtualBoost;
      this.prevVirtualBoost = virtualBoostHeld;

      if ((shiftJust || virtualBoostJust) && !this.isDead) {
        let dashDir: -1 | 1 | 0 = 0;
        if ((this.keys?.A?.isDown as boolean | undefined) || (this.keys?.LEFT?.isDown as boolean | undefined) || this.virtualInput.left) dashDir = -1;
        else if ((this.keys?.D?.isDown as boolean | undefined) || (this.keys?.RIGHT?.isDown as boolean | undefined) || this.virtualInput.right) dashDir = 1;
        else {
          const body = this.chassis.body as Phaser.Physics.Arcade.Body;
          if (Math.abs(body.velocity.x) > 25) dashDir = body.velocity.x < 0 ? -1 : 1;
        }
        if (dashDir !== 0) this.startRam(dashDir, time);
      }

      if ((this.keys?.A?.isDown as boolean | undefined) || (this.keys?.LEFT?.isDown as boolean | undefined) || this.virtualInput.left) direction = -1;
      else if ((this.keys?.D?.isDown as boolean | undefined) || (this.keys?.RIGHT?.isDown as boolean | undefined) || this.virtualInput.right) direction = 1;

      if (direction !== 0) {
        const boostMul = this.getBoostMultiplier(time);
        const throttle = 2.0 * boostMul;
        const body = this.chassis.body as Phaser.Physics.Arcade.Body;
        const grounded = body.blocked.down || this.chassis.y >= targetY - 2 * this.scaleFactor;
        const isAirborne = !grounded;
        let traction = 1.0;
        
        if (!isAirborne) {
            const uphill = (direction > 0 && this.chassis.rotation < 0) || (direction < 0 && this.chassis.rotation > 0);
            if (uphill) {
                const t = Phaser.Math.Clamp(Math.abs(Math.sin(this.chassis.rotation)) / Math.sin(Math.PI / 4), 0, 1);
                traction = 1 - 0.5 * t;
                traction = Phaser.Math.Clamp(traction, 0.2, 1);
            } else {
                const t = Phaser.Math.Clamp(Math.abs(Math.sin(this.chassis.rotation)) / Math.sin(Math.PI / 4), 0, 1);
                const boost = 1 + 0.25 * t;
                traction = Phaser.Math.Clamp(boost, 1.0, 1.35);
            }
        }
        
        const rainMul = rainMud ? 1.5 : 1.0;
        const targetVx = direction * spec.speed * throttle * traction * swampMul * waterMul * rainMul;
        this.chassis.setVelocityX(targetVx);
        this.chassis.setFlipX(direction < 0);
        if (boostMul > 1.02 && time < this.ramFlameUntilT && time > this.lastRamFxT + 90) {
          const mx = (this.wheelL.x + this.wheelR.x) * 0.5;
          const my = (this.wheelL.y + this.wheelR.y) * 0.5 + 12 * this.scaleFactor;
          const flameDir = (direction > 0 ? -1 : 1) as -1 | 1;
          this.scene.particles.createRamFlame(mx, my, this.scaleFactor, flameDir);
          this.lastRamFxT = time;
        }
      } else {
        const body = this.chassis.body as Phaser.Physics.Arcade.Body;
        if (slopeDegrees < 2) {
          body.setVelocityX(body.velocity.x * (inSwamp ? 0.74 : (rainMud ? 0.95 : 0.88)));
        } else {
          const slope = Phaser.Math.Clamp(slopeDegrees / 70, 0, 1);
          const downDir = this.chassis.rotation > 0 ? 1 : -1;
          const vx = body.velocity.x * 0.92 + downDir * 45 * slope;
          body.setVelocityX(Phaser.Math.Clamp(vx, -720 * swampMul, 720 * swampMul));
        }
      }

      const dt = delta / 1000;
      const body = this.chassis.body as Phaser.Physics.Arcade.Body;
      if (inWater && waterSurfaceY !== null) {
        const dy = (waterSurfaceY + 120) - this.chassis.y;
        const desiredVy = Phaser.Math.Clamp(dy * 6, -1400, 1400);
        const lerp = 0.055 * Phaser.Math.Clamp(delta / 16.666, 0, 2);
        body.setVelocityY(Phaser.Math.Linear(body.velocity.y, desiredVy, lerp));
      }
      const liftHeld = ((this.keys?.SPACE?.isDown as boolean | undefined) || this.virtualInput.lift) === true;
      const liftPressed = liftHeld && !this.wasLiftHeldInput;
      if (liftHeld && this.liftFuel > 0) {
        // Android touch: apply an immediate micro-impulse on press to remove perceived lift delay.
        if (liftPressed && this.scene.sys.game.device.os.android) {
          body.setVelocityY(Math.min(body.velocity.y, -180));
        }
        this.liftFuel = Math.max(0, this.liftFuel - this.LIFT_CONSUME_PER_SEC * dt);
        const vy = body.velocity.y;
        const nextVy = Math.max(vy - this.LIFT_THRUST * dt, -this.LIFT_MAX_UP_SPEED);
        body.setVelocityY(nextVy);
        if (time > this.lastLiftFxT + 70) {
          this.lastLiftFxT = time;
          const rot = this.chassis.rotation;
          const fx = this.chassis.x - Math.cos(rot) * 55 * (this.chassis.flipX ? -1 : 1);
          const fy = this.chassis.y + Math.sin(rot) * 12 + 18 * this.scaleFactor;
          this.scene.particles.createLiftFlame(fx, fy, this.scaleFactor);
        }
      } else {
        this.liftFuel = Math.min(1, this.liftFuel + this.LIFT_REGEN_PER_SEC * dt);
      }
      this.wasLiftHeldInput = liftHeld;

      
      const qDown = ((this.keys?.Q?.isDown as boolean | undefined) === true);
      if (qDown && !this.prevQDown) {
        if (this.mgTopUpActive) {
          this.mgTopUpActive = false;
          this.mgTopUpNextBulletAt = 0;
          this.autoFireMg = true;
        } else if (this.autoFireMg) {
          this.autoFireMg = false;
          this.mgTopUpActive = this.mgReloadingUntil <= 0 && this.mgAmmo > 0 && this.mgAmmo < this.MG_MAG_SIZE;
          this.mgTopUpNextBulletAt = 0;
          if (this.mgBurstShotCount > 0 && !this.mgTailPlayed) {
            this.mgTailPlayed = true;
            this.mgLooping = false;
            this.scene.audio.stopLoop('p_mg_loop', 90);
            this.scene.audio.playFolderExclusive('p_mg_last_shot', 'weapon/heavy_machine_gun/fire/tail/last_shot/sfx', { volume: 0.9, cooldownMs: 0 });
          }
          this.mgBurstShotCount = 0;
        } else {
          this.autoFireMg = true;
          this.mgTopUpActive = false;
          this.mgTopUpNextBulletAt = 0;
        }
      }
      this.prevQDown = qDown;
      if (this.autoFireMg || this.virtualInput.mg) {
        this.mgTopUpActive = false;
        this.mgTopUpNextBulletAt = 0;
        this.fireMachineGun(time);
      }
      this.tickMachineGunAudio(time);

      const minePressed =
        (this.mineKey && Phaser.Input.Keyboard.JustDown(this.mineKey)) ||
        (this.mineKeyNumpad && Phaser.Input.Keyboard.JustDown(this.mineKeyNumpad));
      if (minePressed && !this.isDead) this.tryPlaceMine();

      const isTouch = this.scene.sys.game.device.input.touch;
      const pointer = this.scene.input.activePointer;
      const uiBlocked = !isTouch && (this.scene as any)?.testRoomEnabled === true && (this.scene as any)?.testRoomUiBlocking === true;
      const mouseFireHeld = (isTouch || uiBlocked) ? false : ((typeof (pointer as any)?.leftButtonDown === 'function') ? (pointer as any).leftButtonDown() : (pointer?.isDown ?? false));
      const canAimShell = (
        this.currentShell === ShellType.STANDARD ||
        this.currentShell === ShellType.HE ||
        this.currentShell === ShellType.AP ||
        this.currentShell === ShellType.INCENDIARY
      );
      const held = (mouseFireHeld || this.virtualInput.fire) && !this.isMortarAiming && !this.isNukeAiming && canAimShell;

      const AIM_ZOOM_RAMP_MS = 1100;
      const MORTAR_ZOOM_RAMP_MS = 800;
      const NUKE_ZOOM_RAMP_MS = 900;

      const mortarZoomHeld = ((this.keys?.Z?.isDown as boolean | undefined) || this.virtualInput.mortar) === true || this.isMortarAiming;
      const keyboardXHeld = ((this.keys?.X?.isDown as boolean | undefined) === true);
      const virtualNukeHeld = this.virtualInput.nuke === true;
      
      const nukeInputActive = virtualNukeHeld || keyboardXHeld;
      if (nukeInputActive) {
        if (!this.isNukeAiming) this.isNukeAiming = true;
      } else if (this.isNukeAiming) {
        this.isNukeAiming = false;
        this.tryNuke();
      }
      
      const nukeHeld = this.isNukeAiming || nukeInputActive;

      if (this.virtualInput.zoom) this.aimZoomHeldMs = AIM_ZOOM_RAMP_MS;
      else if (held) this.aimZoomHeldMs = Math.min(AIM_ZOOM_RAMP_MS, this.aimZoomHeldMs + delta);
      else this.aimZoomHeldMs = Math.max(0, this.aimZoomHeldMs - delta * 2);

      if (this.isPlayer) {
        const aimHoldActive = held || mortarZoomHeld;
        const aimHoldProgressMs = held ? this.aimZoomHeldMs : this.mortarZoomHeldMs;
        if (aimHoldActive) {
          if (aimHoldProgressMs >= 500 && !this.aimHoldSoundPlayed) {
            this.aimHoldSoundPlayed = true;
            this.scene.audio.playFolder('vehicle/player_soviet/aim_hold/sfx', { volume: 0 }).then(sound => {
              if (!this.aimHoldSoundPlayed) {
                // User released button while sound was loading
                if (sound) this.fadeOutAndStop(sound, 300);
                return;
              }
              if (sound) {
                this.currentAimSound = sound;
                this.scene.tweens.add({
                  targets: sound,
                  volume: 0.6,
                  duration: 500,
                  ease: 'Sine.InOut'
                });
              }
            });
          }
        } else {
          if (this.currentAimSound) {
            this.fadeOutAndStop(this.currentAimSound, 300);
            this.currentAimSound = null;
          }
          this.aimHoldSoundPlayed = false;
        }
      }

      if (mortarZoomHeld) this.mortarZoomHeldMs = Math.min(MORTAR_ZOOM_RAMP_MS, this.mortarZoomHeldMs + delta);
      else this.mortarZoomHeldMs = Math.max(0, this.mortarZoomHeldMs - delta * 2);

      if (nukeHeld) this.nukeZoomHeldMs = Math.min(NUKE_ZOOM_RAMP_MS, this.nukeZoomHeldMs + delta);
      else this.nukeZoomHeldMs = Math.max(0, this.nukeZoomHeldMs - delta * 2);

      const aimZoomP = Phaser.Math.Clamp(this.aimZoomHeldMs / AIM_ZOOM_RAMP_MS, 0, 1);
      const mortarZoomP = Phaser.Math.Clamp(this.mortarZoomHeldMs / MORTAR_ZOOM_RAMP_MS, 0, 1);
      const nukeZoomP = Phaser.Math.Clamp(this.nukeZoomHeldMs / NUKE_ZOOM_RAMP_MS, 0, 1);

      const baseZoom = Phaser.Math.Clamp((this.scene?.defaultZoom as number | undefined) ?? 0.8, 0.1, 1.5);
      const minZoom = 0.1;
      const targetAimZoom = Phaser.Math.Linear(baseZoom, Math.max(minZoom, baseZoom * 0.55), aimZoomP);
      const targetMortarZoom = Phaser.Math.Linear(baseZoom, Math.max(minZoom, baseZoom * 0.55), mortarZoomP);
      const targetNukeZoom = Phaser.Math.Linear(baseZoom, Math.max(minZoom, baseZoom * 0.55), nukeZoomP);
      const targetZoom = Math.min(baseZoom, targetAimZoom, targetMortarZoom, targetNukeZoom);
      cam.zoom = Phaser.Math.Linear(cam.zoom, targetZoom, 0.05);

      const wasHeld = this.prevMouseFireHeld || this.prevVirtualFireHeld;
      if (held) {
        this.isShellAiming = true;
      } else if (this.isShellAiming && wasHeld) {
        this.isShellAiming = false;
        this.fire();
      } else if (!canAimShell) {
        this.isShellAiming = false;
      }
      this.prevMouseFireHeld = mouseFireHeld;
      this.prevVirtualFireHeld = this.virtualInput.fire;
      this.prevVirtualNukeHeld = virtualNukeHeld;

      const mortarKeyHeld = ((this.keys?.Z?.isDown as boolean | undefined) || this.virtualInput.mortar) === true;
      if (mortarKeyHeld) {
          if (!this.isMortarAiming) this.isMortarAiming = true;
      } else if (this.isMortarAiming) {
          const shotAngle = this.clampMortarAngle(this.mortarAimAngle);
          this.fireMortar(time, shotAngle);
          this.isMortarAiming = false;
      }

      // Aiming calculation moved to updateAiming() for Player
      if (!this.isPlayer) {
          // AI Aiming Logic remains here? Or should be removed if unused?
          // AI logic is below in the else block
      }
    } else if (player?.chassis.active) {
      this.updateAI(time, delta, player);
    }

    if (this.scene.mapId === 'desert' && (this.scene.particles as any)?.isSandstormActive?.() === true) {
      const dt = delta / 1000;
      const body = this.chassis.body as Phaser.Physics.Arcade.Body;
      const wind = this.scene.getWindAt(this.chassis.y);
      const push = Phaser.Math.Clamp(wind, -450, 450) * 0.95;
      body.setVelocityX(body.velocity.x + push * dt);
    }

    if (isStationary) {
        this.idleTimer += delta;
        const wiggle = Math.sin(this.idleTimer * 0.001) * 0.01;
        this.targetTurretAngle += wiggle;
        if (this.idleTimer % 800 < delta) {
            const exX = this.chassis.x - Math.cos(this.chassis.rotation) * 50 * (this.chassis.flipX ? -1 : 1);
            const exY = this.chassis.y + Math.sin(this.chassis.rotation) * 10;
            this.scene.particles.createExhaust(exX, exY);
        }

        // Idle Vibration (Breathing + Engine Shake)
        if (this.isPlayer && !this.isDead) {
             const timeSec = time * 0.001;
             // Slow breathe (2.5s cycle) + Fast engine rattle (20Hz approx)
             // Magnitude: 0.8px breathe, 0.6px rattle
             const breathe = Math.sin(timeSec * 2.5) * 0.8;
             const rattle = (Math.random() - 0.5) * 1.2;
             this.vibrationOffset.y = breathe + rattle;
             this.vibrationOffset.x = (Math.random() - 0.5) * 0.6;
        } else {
             this.vibrationOffset.x = 0;
             this.vibrationOffset.y = 0;
        }
    } else {
        this.vibrationOffset.x = 0;
        this.vibrationOffset.y = 0;
    }

    if (!this.isPlayer) {
        const dt = Phaser.Math.Clamp(delta / 1000, 0, 0.05);
        const traverseRadPerSec = Phaser.Math.Clamp(spec.traverseSpeed * 60, 0.45, 3.1);
        this.currentTurretAngle = Phaser.Math.Angle.RotateTo(this.currentTurretAngle, this.targetTurretAngle, traverseRadPerSec * dt);
        this.syncLayers();
    }
    this.drawHealthBar();
    if (this.isPlayer) this.updateAudio(time, delta);
    else this.updateEnemyEngineAudio(time, delta);
  }

  private updateHunterAttack(time: number, player: Tank, aligned: boolean, d: number) {
    if (this.isDead || !this.active) return;
    if (!this.hunterLaser) return;

    if (!aligned) {
      this.hunterAimStartT = 0;
      this.hunterLaser.clear().setVisible(false);
      return;
    }

    const spec = SPECS[this.type];
    const nextReadyT = this.lastFired + spec.fireRate;
    const aimStartT = nextReadyT - 1000;
    if (time < aimStartT) {
      this.hunterAimStartT = 0;
      this.hunterLaser.clear().setVisible(false);
      return;
    }
    if (this.hunterAimStartT === 0) this.hunterAimStartT = aimStartT;

    this.currentShell = this.pickHunterShell(time, d);

    const aimElapsed = time - this.hunterAimStartT;
    if (aimElapsed < 1000) {
      const muzzleX = this.chassis.x + Math.cos(this.currentTurretAngle) * spec.barrelLength * this.scaleFactor;
      const muzzleY = this.chassis.y - 20 * this.scaleFactor + Math.sin(this.currentTurretAngle) * spec.barrelLength * this.scaleFactor;
      this.hunterLaser.clear();
      this.hunterLaser.lineStyle(3, 0xff2222, 0.95);
      this.hunterLaser.beginPath();
      this.hunterLaser.moveTo(muzzleX, muzzleY);
      this.hunterLaser.lineTo(player.chassis.x, player.chassis.y - 35);
      this.hunterLaser.strokePath();
      this.hunterLaser.setVisible(true);
      return;
    }

    this.hunterLaser.clear().setVisible(false);
    this.hunterAimStartT = 0;
    if (this.currentShell === ShellType.STANDARD) this.currentShell = ShellType.HE;
    this.fire(player);
  }

  private pickHunterShell(time: number, d: number): ShellType {
    const nextT = (this.chassis.getData('hunterNextShellT') as number | undefined) ?? 0;
    if (time < nextT) {
      const s = this.currentShell;
      if (s === ShellType.HE || s === ShellType.AP || s === ShellType.INCENDIARY) return s;
    }

    const r = Math.random();
    let shell: ShellType = ShellType.HE;
    if (d > 2200) shell = r < 0.78 ? ShellType.AP : (r < 0.92 ? ShellType.HE : ShellType.INCENDIARY);
    else if (d < 750) shell = r < 0.62 ? ShellType.INCENDIARY : (r < 0.86 ? ShellType.HE : ShellType.AP);
    else shell = r < 0.52 ? ShellType.HE : (r < 0.78 ? ShellType.AP : ShellType.INCENDIARY);

    this.chassis.setData('hunterNextShellT', time + Phaser.Math.Between(550, 1050));
    return shell;
  }

  private updateHunterMobility(time: number, delta: number, player: Tank, d: number, slopeDegrees: number, swampMul: number, waterMul: number, inWater: boolean) {
    const body = this.chassis.body as Phaser.Physics.Arcade.Body;
    const spec = SPECS[this.type];

    const seed = (this.chassis.getData('hunterSeed') as number | undefined) ?? Math.random();
    if (this.chassis.getData('hunterSeed') === undefined) this.chassis.setData('hunterSeed', seed);

    const orbit = 650 + Math.sin(time * 0.00085 + seed * 9.1) * 320;
    let targetX = player.chassis.x + Math.sin(time * 0.0011 + seed * 7.7) * orbit;
    if (d > 1750) targetX = player.chassis.x + (player.chassis.x > this.chassis.x ? -1 : 1) * 520;
    if (d < 520) targetX = this.chassis.x + (player.chassis.x > this.chassis.x ? -1 : 1) * 820;

    const dir = Math.sign(targetX - this.chassis.x);
    const uphill = (dir > 0 && this.chassis.rotation < 0) || (dir < 0 && this.chassis.rotation > 0);
    const slope = Phaser.Math.Clamp(slopeDegrees / 85, 0, 1);
    const traction = uphill ? Phaser.Math.Clamp(1 - slope * 0.62, 0.35, 1) : Phaser.Math.Clamp(1 + slope * 0.14, 0.95, 1.22);

    const speedMul = 1.55 + Math.sin(time * 0.0026 + seed * 3.2) * 0.12;
    const accel = Phaser.Math.Clamp((targetX - this.chassis.x) / 480, -1, 1);
    this.tryStartEnemyBoost(time, !inWater && d > 1500 && Math.abs(targetX - this.chassis.x) > 650);
    const boostMul = this.getEnemyBoostMultiplier(time);
    const vx = accel * spec.speed * speedMul * boostMul * traction * swampMul * waterMul;
    body.setVelocityX(Phaser.Math.Clamp(vx, -1450 * swampMul, 1450 * swampMul));
    this.chassis.setFlipX(body.velocity.x < 0);

    const dt = delta / 1000;
    const groundY = this.scene.getGroundHeight(this.chassis.x);
    const playerGroundY = this.scene.getGroundHeight(player.chassis.x);
    const playerAirborne = player.chassis.y < playerGroundY - 220;

    const nextLiftT = (this.chassis.getData('hunterNextLiftT') as number | undefined) ?? 0;
    const liftUntilT = (this.chassis.getData('hunterLiftUntilT') as number | undefined) ?? 0;
    if (!playerAirborne && time > liftUntilT && time > nextLiftT) {
      if (Math.random() < 0.22) {
        this.chassis.setData('hunterLiftUntilT', time + Phaser.Math.Between(1700, 2600));
        this.chassis.setData('hunterNextLiftT', time + Phaser.Math.Between(4200, 7600));
      } else {
        this.chassis.setData('hunterNextLiftT', time + Phaser.Math.Between(1200, 2200));
      }
    }

    const liftActive = playerAirborne || time < liftUntilT;
    const riseLoopId = `e_hunter_rise_${this.audioInstanceId}`;
    const riseStartId = `e_hunter_rise_start_${this.audioInstanceId}`;
    if (liftActive && !this.hunterWasLiftActive) {
      this.scene.audio.playFolderExclusive(riseStartId, 'vehicle/enemy_hunter/rise_start/sfx', { volume: 1, cooldownMs: 0 });
    }
    if (liftActive) {
      this.scene.audio.startLoop(riseLoopId, 'vehicle/enemy_hunter/rise/sfx', { volume: 0.7, fadeInMs: this.hunterWasLiftActive ? 0 : 120, worldX: this.chassis.x, worldY: this.chassis.y, maxDistance: 5200 })
        .catch(() => {});
    } else if (this.hunterWasLiftActive) {
      this.scene.audio.stopLoop(riseLoopId, 500);
    }
    this.hunterWasLiftActive = liftActive;
    if (liftActive) {
      const desiredY = Phaser.Math.Clamp(player.chassis.y - 110, (this.scene.cameras.main.worldView.y - 400), groundY - 220);
      const wantUp = this.chassis.y > desiredY;
      if (wantUp && this.liftFuel > 0) {
        this.liftFuel = Math.max(0, this.liftFuel - this.LIFT_CONSUME_PER_SEC * 1.15 * dt);
        const vy = body.velocity.y;
        const nextVy = Math.max(vy - this.LIFT_THRUST * 0.95 * dt, -this.LIFT_MAX_UP_SPEED * 1.15);
        body.setVelocityY(nextVy);
        if (time > this.lastLiftFxT + 85) {
          this.lastLiftFxT = time;
          const rot = this.chassis.rotation;
          const fx = this.chassis.x - Math.cos(rot) * 55 * (this.chassis.flipX ? -1 : 1);
          const fy = this.chassis.y + Math.sin(rot) * 12 + 18 * this.scaleFactor;
          this.scene.particles.createLiftFlame(fx, fy, this.scaleFactor);
        }
      } else {
        this.liftFuel = Math.min(1, this.liftFuel + this.LIFT_REGEN_PER_SEC * dt);
      }
      if (!playerAirborne && this.liftFuel <= 0) this.chassis.setData('hunterLiftUntilT', 0);
    } else {
      const closeToGround = this.chassis.y > groundY - 70;
      const regen = closeToGround && !inWater;
      this.liftFuel = Math.min(1, this.liftFuel + (regen ? this.LIFT_REGEN_PER_SEC : this.LIFT_REGEN_PER_SEC * 0.45) * dt);
    }
  }

  private updateAI(time: number, delta: number, player: Tank) {
      const allowMove = !(this.scene.testRoomEnabled && !this.scene.testRoomAllowEnemyMove);
      const allowAttack = !(this.scene.testRoomEnabled && !this.scene.testRoomAllowEnemyAttack);
      const d = Phaser.Math.Distance.Between(this.chassis.x, this.chassis.y, player.chassis.x, player.chassis.y);
      const isDesert = this.scene.mapId === 'desert';
      const isMobile = !!(this.scene.sys.game.device.os.android || this.scene.sys.game.device.os.iOS);
      const aggroMul = (isMobile ? 0.5 : 1) * this.scene.getEnemyAggroVisionScale();
      const aggroRange = Tank.getAggroRangeFor(this.type) * (isDesert ? 1.3 : 1.0) * aggroMul;
      const spec = SPECS[this.type];
      const slopeDegrees = Math.abs(Phaser.Math.RadToDeg(this.chassis.rotation));
      const inSwamp = this.scene.isSwampAt(this.chassis.x);
      const waterSurfaceY = this.scene.getWaterSurfaceY(this.chassis.x);
      const inWater = waterSurfaceY !== null && this.chassis.y > waterSurfaceY + 8;
      const swampMul = inSwamp ? 0.6 : 1.0;
      const waterMul = inWater ? 0.3 : 1.0;

      if (d > aggroRange) return;

      if (this.type === TankType.ENEMY_TUMBLEWEED && isDesert) {
          // Tumbleweed Logic
           const body = this.chassis.body as Phaser.Physics.Arcade.Body;
           const seed = (this.chassis.getData('twSeed') as number | undefined) ?? Math.random();
           if (this.chassis.getData('twSeed') === undefined) this.chassis.setData('twSeed', seed);

           const nextBurst = (this.chassis.getData('twNextBurst') as number | undefined) ?? 0;
           const burstUntil = (this.chassis.getData('twBurstUntil') as number | undefined) ?? 0;
           if (allowMove && time > nextBurst) {
             this.chassis.setData('twBurstUntil', time + Phaser.Math.Between(420, 820));
             this.chassis.setData('twNextBurst', time + Phaser.Math.Between(2200, 5200));
           }

           const wind = this.scene.getWindAt(this.chassis.y);
           const windDir = wind >= 0 ? 1 : -1;
           const orbit = 760 + Math.sin(time * 0.0007 + seed * 9.3) * 260;
           const targetX = player.chassis.x + Math.sin(time * 0.0011 + seed * 6.7) * orbit;
           const dir = targetX > this.chassis.x ? 1 : -1;
           const gust = 1 + Math.sin(time * 0.003 + seed * 3.1) * 0.35;
           const burstMul = time < burstUntil ? 2.15 : 1.0;
           const drift = Math.abs(wind) > 6 ? 0.35 : 0.0;
           const driftStep = Math.floor(time / 900);
           const driftNoise = Math.sin(driftStep * 12.9898 + seed * 78.233) * 43758.5453;
           const driftRand = driftNoise - Math.floor(driftNoise);
           const driftDir = windDir * (driftRand > 0.5 ? 1 : -1);

           const slope = Phaser.Math.Clamp(slopeDegrees / 65, 0, 1);
           const downDir = this.chassis.rotation > 0 ? 1 : -1;
           const slopePush = downDir * (55 + 145 * slope) * (inSwamp ? 0.35 : 1.0);

           const windPush = Phaser.Math.Clamp(wind, -18, 18) * 9.5;
           if (allowMove) {
             this.tryStartEnemyBoost(time, !inWater && d > 1600 && Math.abs(targetX - this.chassis.x) > 900);
             const boostMul = this.getEnemyBoostMultiplier(time);
             const move = (dir * (1 - drift) + driftDir * drift) * spec.speed * gust * burstMul * boostMul * swampMul * waterMul + slopePush + windPush;
             body.setVelocityX(Phaser.Math.Clamp(move, -1400 * swampMul, 1400 * swampMul));
             this.chassis.setFlipX(body.velocity.x < 0);
           } else {
             body.setVelocityX(body.velocity.x * 0.88);
           }

           if (allowMove && !inWater && body.blocked.down) {
             const lastHop = (this.chassis.getData('twLastHop') as number | undefined) ?? 0;
             const hopPhase = Math.sin(time * 0.0032 + seed * 17.3);
             if (hopPhase > 0.997 && time > lastHop + 900) {
               this.chassis.setData('twLastHop', time);
               body.setVelocityY(-Phaser.Math.Between(240, 420));
             }
           }

           const lead = Phaser.Math.Clamp(d / 2600, 0, 1);
           const aimY = player.chassis.y - (d * (0.10 + lead * 0.08));
           this.targetTurretAngle = Phaser.Math.Angle.Between(this.chassis.x, this.chassis.y - 30, player.chassis.x, aimY);
           if (allowAttack && d < 3000 && Math.abs(Phaser.Math.Angle.Wrap(this.targetTurretAngle - this.currentTurretAngle)) < 0.35) this.fire(player);
           return;
      }

      // General AI Logic
      if (this.type === TankType.ENEMY_HUNTER && allowMove) {
         this.updateHunterMobility(time, delta, player, d, slopeDegrees, swampMul, waterMul, inWater);
      }

      const shooterX = this.chassis.x;
      const shooterY = this.chassis.y - 30;
      const directTargetX = player.chassis.x;
      const directTargetY = player.chassis.y - 35;
      const hasLos = this.scene.checkLineOfSight(shooterX, shooterY, directTargetX, directTargetY);

      const lastSeenT = (this.chassis.getData('aiLastSeenT') as number | undefined) ?? 0;
      let targetX = directTargetX;
      let targetY = directTargetY;
      if (hasLos) {
        this.chassis.setData('aiLastSeenT', time);
        this.chassis.setData('aiLastSeenX', directTargetX);
        this.chassis.setData('aiLastSeenY', directTargetY);
      } else if (time - lastSeenT < 1800) {
        const lx = this.chassis.getData('aiLastSeenX') as number | undefined;
        const ly = this.chassis.getData('aiLastSeenY') as number | undefined;
        if (typeof lx === 'number' && typeof ly === 'number') {
          targetX = lx;
          targetY = ly;
        }
      }

      const seed = (this.chassis.getData('aiSeed') as number | undefined) ?? Math.random();
      if (this.chassis.getData('aiSeed') === undefined) this.chassis.setData('aiSeed', seed);

      const typeSkill =
        this.type === TankType.ENEMY_TIGER ? 0.88 :
        this.type === TankType.ENEMY_STUG ? 0.82 :
        this.type === TankType.ENEMY_MAUS ? 0.78 :
        this.type === TankType.ENEMY_A7V ? 0.72 :
        this.type === TankType.ENEMY_PANZER ? 0.68 :
        this.type === TankType.ENEMY_LUCHS ? 0.62 :
        0.7;

      if (this.type !== TankType.ENEMY_HUNTER && this.type !== TankType.ENEMY_TUMBLEWEED) {
        const nextShellT = (this.chassis.getData('aiNextShellT') as number | undefined) ?? 0;
        const nextReadyT = this.lastFired + spec.fireRate;
        const justFired = time - this.lastFired < Phaser.Math.Clamp(spec.fireRate * 0.25, 250, 900);
        const inFinalAimWindow = hasLos && (nextReadyT - time) < 450;
        if (!justFired && !inFinalAimWindow && time > nextShellT && (hasLos || time - lastSeenT < 1400)) {
          let desiredShell = ShellType.HE;
          if (!hasLos && time - lastSeenT < 1400) {
            if (d < 900 && (this.type === TankType.ENEMY_LUCHS || this.type === TankType.ENEMY_PANZER)) desiredShell = ShellType.INCENDIARY;
            else desiredShell = ShellType.HE;
          } else if (d > 2100) {
            if (this.type === TankType.ENEMY_TIGER || this.type === TankType.ENEMY_STUG) desiredShell = ShellType.AP;
            else desiredShell = Math.random() < 0.35 ? ShellType.AP : ShellType.HE;
          } else if (d < 820) {
            if (this.type === TankType.ENEMY_LUCHS || this.type === TankType.ENEMY_PANZER) desiredShell = Math.random() < 0.7 ? ShellType.INCENDIARY : ShellType.HE;
            else desiredShell = Math.random() < 0.2 ? ShellType.AP : ShellType.HE;
          } else {
            if (this.type === TankType.ENEMY_LUCHS) desiredShell = Math.random() < 0.25 ? ShellType.INCENDIARY : ShellType.HE;
            else if (this.type === TankType.ENEMY_MAUS) desiredShell = Math.random() < 0.22 ? ShellType.AP : ShellType.HE;
            else desiredShell = Math.random() < 0.18 ? ShellType.AP : ShellType.HE;
          }

          if (desiredShell === ShellType.AP && !this.canEnemyUseApShell()) desiredShell = ShellType.HE;
          if (desiredShell !== this.currentShell) this.setShell(desiredShell);

          const minSwitch = Phaser.Math.Clamp(spec.fireRate * Phaser.Math.Linear(0.9, 0.65, typeSkill), 650, 5200);
          const maxSwitch = Phaser.Math.Clamp(spec.fireRate * Phaser.Math.Linear(1.15, 0.9, typeSkill), minSwitch + 100, 6800);
          this.chassis.setData('aiNextShellT', time + Phaser.Math.Between(Math.floor(minSwitch), Math.floor(maxSwitch)));
        }
      }

      const gWorld = this.scene.physics.world.gravity.y;
      const gEff = Math.max(120, gWorld - 750);
      let muzzleVel =
        this.currentShell === ShellType.AP ? this.VEL_AP :
        this.currentShell === ShellType.STANDARD ? this.VEL_STANDARD :
        this.currentShell === ShellType.INCENDIARY ? this.VEL_INCENDIARY :
        this.currentShell === ShellType.BULLET ? this.VEL_BULLET :
        this.currentShell === ShellType.MORTAR ? this.VEL_MORTAR :
        this.currentShell === ShellType.NUKE ? 450 :
        this.VEL_HE;
      if (!Number.isFinite(muzzleVel) || muzzleVel <= 0) muzzleVel = this.VEL_HE;
      if (this.currentShell !== ShellType.BULLET) {
        const t = Phaser.Math.Clamp((d - 1200) / 2200, 0, 1);
        muzzleVel *= Phaser.Math.Linear(0.55, 1.0, t);
      }

      if (this.type !== TankType.ENEMY_HUNTER) {
        const playerBody = player?.chassis?.body as Phaser.Physics.Arcade.Body | undefined;
        const playerVx = playerBody?.velocity?.x ?? 0;
        const playerVy = playerBody?.velocity?.y ?? 0;
        const leadMul = Phaser.Math.Clamp(0.65 + typeSkill * 0.45, 0.65, 1.05);
        const leadMax = Phaser.Math.Linear(650, 1150, typeSkill);

        let aimX = targetX;
        let aimY = targetY;
        let tSec = Phaser.Math.Clamp(Math.abs(aimX - shooterX) / Math.max(350, muzzleVel), 0, 2.6);
        for (let i = 0; i < 2; i++) {
          const px = targetX + Phaser.Math.Clamp(playerVx * tSec * leadMul, -leadMax, leadMax);
          const py = targetY + Phaser.Math.Clamp(playerVy * tSec * (leadMul * 0.6), -220, 220);
          aimX = px;
          aimY = py;

          const dx = aimX - shooterX;
          const dist = Math.abs(dx);
          const dy = aimY - shooterY;
          const theta = this.solveFiringAngle(muzzleVel, gEff, dist, dy);
          if (theta === null) break;
          const cos = Math.max(0.12, Math.cos(theta));
          tSec = Phaser.Math.Clamp(dist / Math.max(120, muzzleVel * cos), 0, 2.6);
        }

        const dx = aimX - shooterX;
        const dist = Math.abs(dx);
        const dy = aimY - shooterY;
        const theta = this.solveFiringAngle(muzzleVel, gEff, dist, dy);
        let desiredAngle = theta !== null ? (dx >= 0 ? theta : Math.PI - theta) : Phaser.Math.Angle.Between(shooterX, shooterY, aimX, aimY);

        const distT = Phaser.Math.Clamp(d / 2800, 0, 1);
        const baseErr = Phaser.Math.Linear(0.07, 0.02, typeSkill) * (0.55 + 0.65 * distT);
        const noise = (Math.sin(time * 0.00125 + seed * 17.3) + Math.sin(time * 0.00077 + seed * 9.7) * 0.7) / 1.7;
        desiredAngle = Phaser.Math.Angle.Wrap(desiredAngle + noise * baseErr);

        this.targetTurretAngle = desiredAngle;
      } else {
        this.targetTurretAngle = Phaser.Math.Angle.Between(shooterX, shooterY, directTargetX, directTargetY);
      }

      const aimDiff = Math.abs(Phaser.Math.Angle.Wrap(this.targetTurretAngle - this.currentTurretAngle));
      const baseRangeLimit = isDesert ? 3200 : 2800;
      const rangeLimit =
        baseRangeLimit +
        (this.currentShell === ShellType.AP ? 350 :
        this.currentShell === ShellType.STANDARD ? 200 : 0);
      const alignTolBase = Phaser.Math.Linear(0.28, 0.18, typeSkill);
      const alignTol =
        alignTolBase *
        (this.currentShell === ShellType.AP ? 0.9 :
        this.currentShell === ShellType.INCENDIARY ? 1.1 : 1);
      const canAttemptShot = allowAttack && d < rangeLimit && (hasLos || (time - lastSeenT < 900));

      const prevAimOkT = (this.chassis.getData('aiAimOkT') as number | undefined) ?? 0;
      const aimOk = aimDiff < alignTol;
      if (!canAttemptShot || !aimOk) {
        if (prevAimOkT !== 0) this.chassis.setData('aiAimOkT', 0);
      } else {
        if (prevAimOkT === 0) this.chassis.setData('aiAimOkT', time);
      }

      if (this.type === TankType.ENEMY_HUNTER) {
        const aligned = canAttemptShot && aimOk && (hasLos || time - lastSeenT < 250);
        this.updateHunterAttack(time, player, aligned, d);
      } else {
        const lockedT = (this.chassis.getData('aiAimOkT') as number | undefined) ?? 0;
        const minHoldMs =
          Phaser.Math.Linear(260, 130, typeSkill) *
          (d < 900 ? 0.75 : 1);
        if (canAttemptShot && aimOk && lockedT !== 0 && time - lockedT >= minHoldMs) this.fire(player);
      }

      if (this.type !== TankType.ENEMY_HUNTER) {
        const body = this.chassis.body as Phaser.Physics.Arcade.Body;
        const hpRatio = this.maxHp > 0 ? (this.hp / this.maxHp) : 1;
        const retreating = hpRatio < 0.25 && this.type !== TankType.ENEMY_MAUS;

        const desiredRange =
          this.type === TankType.ENEMY_TIGER ? 1850 :
          this.type === TankType.ENEMY_STUG ? 1700 :
          this.type === TankType.ENEMY_MAUS ? 1200 :
          this.type === TankType.ENEMY_A7V ? 900 :
          this.type === TankType.ENEMY_LUCHS ? 650 :
          750;

        const flankSign = (this.chassis.getData('aiFlankSign') as number | undefined);
        const nextFlankT = (this.chassis.getData('aiNextFlankT') as number | undefined) ?? 0;
        let flank = (flankSign === 1 || flankSign === -1) ? flankSign : (Math.random() < 0.5 ? -1 : 1);
        if (this.chassis.getData('aiFlankSign') === undefined) this.chassis.setData('aiFlankSign', flank);

        const blocked = (body.blocked.left && flank < 0) || (body.blocked.right && flank > 0);
        if (time > nextFlankT || blocked) {
          flank = Math.random() < 0.5 ? -1 : 1;
          if (blocked) flank *= -1;
          this.chassis.setData('aiFlankSign', flank);
          this.chassis.setData('aiNextFlankT', time + Phaser.Math.Between(2200, 5200));
        }

        const strafeAmp = Phaser.Math.Linear(120, 420, this.type === TankType.ENEMY_LUCHS ? 1 : 0.6);
        let desiredX = directTargetX + flank * desiredRange + Math.sin(time * 0.00105 + seed * 6.1) * strafeAmp;
        if (!hasLos) {
          if (time - lastSeenT < 1800) desiredX = targetX + flank * desiredRange;
          else desiredX = shooterX + flank * Phaser.Math.Linear(520, 860, typeSkill);
        }
        if (retreating) desiredX = shooterX + (directTargetX > shooterX ? -1 : 1) * (desiredRange + 650);

        const dxToDesired = desiredX - shooterX;
        const moveDir = Math.abs(dxToDesired) > 140 ? Math.sign(dxToDesired) : 0;

        if (allowMove && moveDir !== 0) {
          const uphill = (moveDir > 0 && this.chassis.rotation < 0) || (moveDir < 0 && this.chassis.rotation > 0);
          const slope = Phaser.Math.Clamp(slopeDegrees / 90, 0, 1);
          const traction = uphill ? Phaser.Math.Clamp(1 - slope * 0.55, 0.3, 1) : Phaser.Math.Clamp(1 + slope * 0.12, 0.95, 1.18);
          const aimSlow = Phaser.Math.Clamp(1 - Phaser.Math.Clamp(aimDiff / 0.55, 0, 1) * 0.42, 0.58, 1);
          const speedMul = (retreating ? 1.08 : 0.98) * aimSlow;
          const wantBoost = !inWater && (retreating || Math.abs(dxToDesired) > 1100) && (hasLos || time - lastSeenT < 1800);
          this.tryStartEnemyBoost(time, wantBoost);
          const boostMul = this.getEnemyBoostMultiplier(time);
          const vx = moveDir * spec.speed * speedMul * boostMul * traction * swampMul * waterMul;
          body.setVelocityX(Phaser.Math.Clamp(vx, -1450 * swampMul, 1450 * swampMul));
          this.chassis.setFlipX(vx < 0);
        } else {
          body.setVelocityX(body.velocity.x * 0.9);
        }
      } else if (isDesert) {
        const body = this.chassis.body as Phaser.Physics.Arcade.Body;
        body.setVelocityX(body.velocity.x * 0.9);
      }
  }

  public updateAiming() {
    if (!this.isPlayer || !this.active || this.isDead) return;

    const aimXRaw = this.scene.aimWorld.x;
    const aimYRaw = this.scene.aimWorld.y;
    const now = this.scene.time.now;
    const hasPrevAim = Number.isFinite(this.lastTrajectoryAimX) && Number.isFinite(this.lastTrajectoryAimY);
    const dtMs = hasPrevAim ? Math.max(1, now - this.lastTrajectoryDrawT) : 16;
    const lerpBase = Phaser.Math.Clamp(dtMs / 22, 0.08, 0.6);
    const aimX = hasPrevAim ? Phaser.Math.Linear(this.lastTrajectoryAimX, aimXRaw, lerpBase) : aimXRaw;
    const aimY = hasPrevAim ? Phaser.Math.Linear(this.lastTrajectoryAimY, aimYRaw, lerpBase) : aimYRaw;

    // Mortar Aim Update
    if (this.isMortarAiming) {
        const rot = this.chassis.rotation;
        const mx = this.chassis.x - Math.cos(rot) * 35 * this.scaleFactor;
        const my = this.chassis.y - Math.sin(rot) * 35 * this.scaleFactor - 25 * this.scaleFactor;
        this.mortarAimAngle = Phaser.Math.Angle.Between(mx, my, aimX, aimY);
    }

    const canAimShell = (
        this.currentShell === ShellType.STANDARD ||
        this.currentShell === ShellType.HE ||
        this.currentShell === ShellType.AP ||
        this.currentShell === ShellType.INCENDIARY ||
        this.currentShell === ShellType.MORTAR ||
        this.currentShell === ShellType.NUKE
    );

    if (canAimShell) {
         // IMPACT AIMING LOGIC: Crosshair is the landing point
         const g = this.GRAVITY;
         const startX = this.chassis.x;
         const startY = this.chassis.y - 30; // Approx turret height

         const dx = aimX - startX;
         const dy = aimY - startY;
         const dist = Math.abs(dx);
         
         // Select velocity based on shell type
         let v = this.VEL_HE;
         if (this.currentShell === ShellType.AP) v = this.VEL_AP;
         else if (this.currentShell === ShellType.STANDARD) v = this.VEL_STANDARD;
         else if (this.currentShell === ShellType.INCENDIARY) v = this.VEL_INCENDIARY;

         const angle = this.solveFiringAngle(v, g, dist, dy);
         
         if (angle !== null) {
             // Angle is relative to horizontal right.
             // If aiming left (dx < 0), we need to mirror.
             // Phaser: 0 is Right, -PI/2 is Up.
             // Our solveFiringAngle returns angle 'theta' such that positive is down, negative is up?
             // No, our derivation assumed y positive down.
             // root2 (low arc) usually returns a negative value (aiming up) if target is above or level.
             // So if dx > 0, angle is correct.
             // If dx < 0, we mirror: Math.PI - angle.
             
             if (dx >= 0) {
                 this.targetTurretAngle = angle;
             } else {
                 this.targetTurretAngle = Math.PI - angle;
             }
         } else {
             // Out of range: Aim at 45 degrees (max range)
             const maxRangeAngle = -Math.PI / 4; // -45 degrees (Up-Right)
             if (dx >= 0) this.targetTurretAngle = maxRangeAngle;
             else this.targetTurretAngle = Math.PI - maxRangeAngle;
         }

         this.chassis.setData('targetFireVel', v);
    } else {
         this.targetTurretAngle = Phaser.Math.Angle.Between(this.chassis.x, this.chassis.y - 30, aimX, aimY);
         this.chassis.setData('targetFireVel', null);
    }

    // Heavy machine gun follows direct crosshair aim to match desktop behavior.
    if (this.mgTurret) {
        const startX = this.mgTurret.x;
        const startY = this.mgTurret.y;
        const directAngle = Phaser.Math.Angle.Between(startX, startY, aimX, aimY);
        this.mgTurret.setRotation(directAngle);
        if (this.mgTurret.scaleX < 0) this.mgTurret.setFlipY(true);
    }

    const spec = SPECS[this.type];
    const sceneAny = this.scene as any;
    const mobileAimAssist = !!(this.scene.sys.game.device.os.android || this.scene.sys.game.device.os.iOS || sceneAny?.aimWorldOverrideActive === true);
    if (!Number.isFinite(this.targetTurretAngleFiltered)) this.targetTurretAngleFiltered = this.targetTurretAngle;
    const filterAlpha = mobileAimAssist ? 0.36 : 0.52;
    this.targetTurretAngleFiltered = Phaser.Math.Angle.RotateTo(this.targetTurretAngleFiltered, this.targetTurretAngle, filterAlpha);
    const traverseStep = mobileAimAssist ? Math.max(spec.traverseSpeed, 0.5) : spec.traverseSpeed;
    this.currentTurretAngle = Phaser.Math.Angle.RotateTo(this.currentTurretAngle, this.targetTurretAngleFiltered, traverseStep);

    this.syncLayers();

    const mode = this.isNukeAiming ? 3 : (this.isMortarAiming ? 2 : (this.isShellAiming ? 1 : 0));
    const intervalMs = mode === 0 ? 120 : 33;
    const cacheReady =
      Number.isFinite(this.lastTrajectoryAimX) &&
      Number.isFinite(this.lastTrajectoryAimY) &&
      Number.isFinite(this.lastTrajectoryTankX) &&
      Number.isFinite(this.lastTrajectoryTankY) &&
      Number.isFinite(this.lastTrajectoryTurretAngle);
    const changed =
      !cacheReady ||
      this.lastTrajectoryMode !== mode ||
      this.lastTrajectoryShell !== this.currentShell ||
      Math.abs(this.lastTrajectoryAimX - aimX) > 1.2 ||
      Math.abs(this.lastTrajectoryAimY - aimY) > 1.2 ||
      Math.abs(this.lastTrajectoryTankX - this.chassis.x) > 0.9 ||
      Math.abs(this.lastTrajectoryTankY - this.chassis.y) > 0.9 ||
      Math.abs(this.lastTrajectoryTurretAngle - this.currentTurretAngle) > 0.0025;

    if (mode === 0) {
      if (this.lastTrajectoryMode !== 0) {
        this.drawTrajectory();
        this.lastTrajectoryDrawT = now;
      }
    } else if (changed || now >= this.lastTrajectoryDrawT + intervalMs) {
      this.drawTrajectory();
      this.lastTrajectoryDrawT = now;
    }

    this.lastTrajectoryAimX = aimX;
    this.lastTrajectoryAimY = aimY;
    this.lastTrajectoryTankX = this.chassis.x;
    this.lastTrajectoryTankY = this.chassis.y;
    this.lastTrajectoryTurretAngle = this.currentTurretAngle;
    this.lastTrajectoryShell = this.currentShell;
    this.lastTrajectoryMode = mode;
  }

  private solveFiringAngle(v: number, g: number, x: number, y: number): number | null {
      // x: horizontal distance (always positive)
      // y: vertical distance (positive down)
      // v: velocity
      // g: gravity (positive)
      
      const A = (g * x * x) / (2 * v * v);
      const disc = x * x - 4 * A * (A - y);
      
      if (disc < 0) return null; // Target out of range
      
      // We want the low arc (flatter trajectory).
      // Based on derivation, root2 is the one.
      const tanTheta = (-x + Math.sqrt(disc)) / (2 * A);
      return Math.atan(tanTheta);
  }

  public destroy() {
    this.active = false;
    const kb = this.scene?.input?.keyboard;
    if (kb && this.keyboardListeners.length > 0) {
      for (const l of this.keyboardListeners) {
        try { kb.off(l.event, l.fn); } catch {}
      }
      this.keyboardListeners.length = 0;
    }
    if (!this.isPlayer) {
      this.scene.audio.stopLoop(`e_idle_${this.audioInstanceId}`, 0);
      this.scene.audio.stopLoop(`e_hunter_rise_${this.audioInstanceId}`, 0);
    }
    this.chassis.destroy();
    this.wheelL.destroy();
    this.wheelR.destroy();
    if (this.turretBase) this.turretBase.destroy();
    if (this.turretBarrel) this.turretBarrel.destroy();
    if (this.mgTurret) this.mgTurret.destroy();
    if (this.mortarTurret) this.mortarTurret.destroy();
    this.detailLayer.destroy();
    this.boostThrusterL?.destroy();
    this.boostThrusterR?.destroy();
    this.hunterOverlay?.destroy();
    // this.hullMaterialMul?.destroy();
    // this.hullMaterialAdd?.destroy();
    // this.turretMaterialMul?.destroy();
    // this.turretMaterialAdd?.destroy();
    this.camoGraphics?.destroy();
    this.healthBar.destroy();
    this.trajectoryGraphics.destroy();
  }

  private drawHealthBar() {
    this.healthBar.clear();
    const snap = (v: number) => Math.round(v);
    const w = Math.max(30, snap(80 * this.scaleFactor));
    const barH = Math.max(6, snap(6 * this.scaleFactor));
    const x0 = snap(this.chassis.x - w * 0.5);
    const y0 = snap(this.chassis.y - 85 * this.scaleFactor);
    this.healthBar.fillStyle(0x000000, 0.7);
    this.healthBar.fillRect(x0, y0, w, barH);
    const fill = Math.max(0, this.hp / this.maxHp);
    const color = this.isPlayer ? (fill > 0.5 ? 0x00ff00 : (fill > 0.2 ? 0xffff00 : 0xff0000)) : 0xff0000;
    this.healthBar.fillStyle(color, 1);
    const innerW = Math.max(1, w - 2);
    const innerH = Math.max(1, barH - 2);
    this.healthBar.fillRect(x0 + 1, y0 + 1, Math.round(innerW * fill), innerH);

    if (this.isPlayer) {
      const now = this.scene.time.now;
      const cd = 3000;
      const boxW = Math.max(12, snap(14 * this.scaleFactor));
      const boxH = Math.max(7, snap(8 * this.scaleFactor));
      const gap = Math.max(4, snap(6 * this.scaleFactor));
      const total = boxW * 2 + gap;
      const bx0 = snap(this.chassis.x - total * 0.5);
      const by0 = y0 + Math.max(8, snap(10 * this.scaleFactor));
      const readyAt = [this.boostChargeReadyAt[0], this.boostChargeReadyAt[1]];

      this.healthBar.lineStyle(1, 0xffffff, 0.75);
      for (let i = 0; i < 2; i++) {
        const x = bx0 + i * (boxW + gap);
        const t = readyAt[i] <= now ? 1 : Phaser.Math.Clamp(1 - (readyAt[i] - now) / cd, 0, 1);
        this.healthBar.fillStyle(0x000000, 0.55);
        this.healthBar.fillRect(x, by0, boxW, boxH);
        this.healthBar.strokeRect(x, by0, boxW, boxH);
        this.healthBar.fillStyle(0x66ccff, t >= 1 ? 0.95 : 0.5);
        this.healthBar.fillRect(x + 1, by0 + 1, Math.round((boxW - 2) * t), Math.max(1, boxH - 2));
      }
    }

    if (this.stunTimer > 0) {
        const stunH = Math.max(3, snap(4 * this.scaleFactor));
        const stunY = y0 - Math.max(8, snap(10 * this.scaleFactor));
        this.healthBar.fillStyle(0x5555ff, 1);
        this.healthBar.fillRect(x0, stunY, Math.round(w * (this.stunTimer / 3000)), stunH);
    }
    if (this.isPlayer && this.scene.time.now < this.lastMortarFired + 20000) {
        const cdH = Math.max(3, snap(4 * this.scaleFactor));
        const cdY = y0 - Math.max(16, snap(20 * this.scaleFactor));
        const cdLeft = 1 - (this.scene.time.now - this.lastMortarFired) / 20000;
        this.healthBar.fillStyle(0xff0000, 0.8);
        this.healthBar.fillRect(x0, cdY, Math.round(w * cdLeft), cdH);
    }
  }

  private syncLayers() {
    const spec = SPECS[this.type];
    // Apply vibration offset
    const tx = this.chassis.x + this.vibrationOffset.x;
    const ty = this.chassis.y + this.vibrationOffset.y;
    
    // Apply vibration to chassis visual only via origin (inverse shift)
    // originY = 0.5 - offset / height
    // We assume default origin is 0.5, 0.5
    if (this.vibrationOffset.y !== 0 || this.vibrationOffset.x !== 0) {
        const ox = 0.5 - this.vibrationOffset.x / (this.chassis.width || 1);
        const oy = 0.5 - this.vibrationOffset.y / (this.chassis.height || 1);
        this.chassis.setOrigin(ox, oy);
    } else {
        this.chassis.setOrigin(0.5, 0.5);
    }

    const rot = this.chassis.rotation;
    const fx = this.chassis.flipX ? -1 : 1;
    const tbx = tx + ((spec.turretOffset.x * this.scaleFactor) * fx * Math.cos(rot) - (spec.turretOffset.y * this.scaleFactor) * Math.sin(rot));
    const tby = ty + ((spec.turretOffset.x * this.scaleFactor) * fx * Math.sin(rot) + (spec.turretOffset.y * this.scaleFactor) * Math.cos(rot));
    
    const wheelSpacing = 40 * this.scaleFactor;
    this.wheelL.setPosition(tx - Math.cos(rot) * wheelSpacing, ty - Math.sin(rot) * wheelSpacing + 15 * this.scaleFactor).setRotation(tx * 0.05);
    this.wheelR.setPosition(tx + Math.cos(rot) * wheelSpacing, ty + Math.sin(rot) * wheelSpacing + 15 * this.scaleFactor).setRotation(tx * 0.05);

    if (this.boostThrusterL && this.boostThrusterR) {
      const mx = (this.wheelL.x + this.wheelR.x) * 0.5;
      const my = (this.wheelL.y + this.wheelR.y) * 0.5 + 12 * this.scaleFactor;
      const spread = 9 * this.scaleFactor;
      const lx = mx - Math.cos(rot) * spread;
      const ly = my - Math.sin(rot) * spread;
      const rx = mx + Math.cos(rot) * spread;
      const ry = my + Math.sin(rot) * spread;
      const sx = this.chassis.flipX ? -this.scaleFactor : this.scaleFactor;
      this.boostThrusterL.setPosition(lx, ly).setRotation(rot).setScale(sx * 0.6, this.scaleFactor * 0.6);
      this.boostThrusterR.setPosition(rx, ry).setRotation(rot).setScale(sx * 0.6, this.scaleFactor * 0.6);
    }
    
    const detailRot = this.type === TankType.ENEMY_TUMBLEWEED ? (rot + this.tumbleRoll) : rot;
    this.detailLayer.setPosition(tx, ty).setRotation(detailRot).setFlipX(this.chassis.flipX);
    if (this.turretBase) this.turretBase.setPosition(tbx, tby).setRotation(rot).setFlipX(this.chassis.flipX);
    if (this.turretBarrel) this.turretBarrel.setOrigin(0.1, 0.5).setPosition(tbx, tby).setRotation(this.currentTurretAngle).setFlipX(false);

    if (this.mgTurret) {
        this.mgTurret.setOrigin(0.2, 0.5).setPosition(tbx, tby - 25 * this.scaleFactor).setFlipX(false);
        if (!this.isPlayer) this.mgTurret.setRotation(this.currentTurretAngle);
        if (this.isPlayer) {
          const now = this.scene.time.now;
          const recoilP = Phaser.Math.Clamp(1 - (now - this.lastMgFired) / 90, 0, 1);
          const recoil = recoilP * 3 * this.scaleFactor;
          const r = this.mgTurret.rotation;
          this.mgTurret.setPosition(this.mgTurret.x - Math.cos(r) * recoil, this.mgTurret.y - Math.sin(r) * recoil);
        }
    }
    if (this.mortarTurret) {
        const mx = tx - Math.cos(rot) * 35 * this.scaleFactor;
        const my = ty - Math.sin(rot) * 35 * this.scaleFactor;
        const mAngle = this.clampMortarAngle(this.isMortarAiming ? this.mortarAimAngle : this.currentTurretAngle);
        this.mortarTurret.setPosition(mx, my - 15 * this.scaleFactor).setRotation(mAngle);
    }
    if (this.hunterOverlay) {
      const sx = this.chassis.flipX ? -this.scaleFactor : this.scaleFactor;
      this.hunterOverlay.setPosition(tx, ty).setRotation(rot).setScale(sx, this.scaleFactor);
    }
    if (this.camoGraphics) {
      const sx = this.chassis.flipX ? -this.scaleFactor : this.scaleFactor;
      this.camoGraphics.setPosition(tx, ty).setRotation(rot).setScale(sx, this.scaleFactor);
    }
    if (this.hullMaterialMul) {
      const sx = this.chassis.flipX ? -this.scaleFactor : this.scaleFactor;
      this.hullMaterialMul.setPosition(tx, ty).setRotation(rot).setScale(sx, this.scaleFactor);
    }
    if (this.hullMaterialAdd) {
      const sx = this.chassis.flipX ? -this.scaleFactor : this.scaleFactor;
      this.hullMaterialAdd.setPosition(tx, ty).setRotation(rot).setScale(sx, this.scaleFactor);
    }
    if (this.turretMaterialMul) {
      const sx = this.chassis.flipX ? -this.scaleFactor : this.scaleFactor;
      this.turretMaterialMul.setPosition(tbx, tby).setRotation(rot).setScale(sx, this.scaleFactor);
    }
    if (this.turretMaterialAdd) {
      const sx = this.chassis.flipX ? -this.scaleFactor : this.scaleFactor;
      this.turretMaterialAdd.setPosition(tbx, tby).setRotation(rot).setScale(sx, this.scaleFactor);
    }
  }

  public fireMachineGun(time: number) {
      if (this.isDead || this.stunTimer > 0) return;
      if (!this.noCooldown && time < this.lastMgFired + 60) return; 
      if (this.mgReloadingUntil > time) return;
      if (this.mgAmmo <= 0) return;

      const angle = this.mgTurret ? this.mgTurret.rotation : this.currentTurretAngle;
      let muzzleX = this.chassis.x;
      let muzzleY = this.chassis.y;

      if (this.mgTurret) {
          const barrelLen = (this.mgTurret.displayWidth || 0) * (1 - this.mgTurret.originX) || (36 * this.scaleFactor);
          muzzleX = this.mgTurret.x + Math.cos(angle) * barrelLen;
          muzzleY = this.mgTurret.y + Math.sin(angle) * barrelLen;
      } else {
          muzzleX = this.chassis.x + Math.cos(angle) * 40 * this.scaleFactor;
          muzzleY = this.chassis.y - 50 * this.scaleFactor + Math.sin(angle) * 40 * this.scaleFactor;
      }

      const bullet = this.scene.bulletGroup.create(muzzleX, muzzleY, this.scene.getProjectileTexture(ShellType.BULLET));
      if (!bullet) return;

      this.lastMgFired = time;
      this.mgAmmo = Math.max(0, this.mgAmmo - 1);
      this.onMachineGunShot(time);

      const tracerLen = this.scene.getTracerLength(muzzleX, muzzleY, angle, 12500, this);
      this.scene.particles.createMgTracer(muzzleX, muzzleY, angle, tracerLen);
      this.scene.particles.createMuzzleFlash(muzzleX, muzzleY, angle, ShellType.BULLET);

      bullet.setScale(0.4);
      const body = bullet.body as Phaser.Physics.Arcade.Body;
      body.setAllowGravity(false).setSize(20, 20);
      this.scene.physics.velocityFromRotation(angle, this.VEL_BULLET, body.velocity);
      bullet.setDepth(40).setData('type', ShellType.BULLET).setData('owner', this);
      const waterY = this.scene.getWaterSurfaceY(muzzleX);
      if (waterY !== null && muzzleY > waterY + 1) {
          bullet.setData('spawnedInWater', true);
          bullet.setData('inWater', true);
          bullet.setData('waterSlowApplied', true);
          bullet.setData('origDragX', body.drag.x);
          bullet.setData('origDragY', body.drag.y);
          body.setVelocity(body.velocity.x * 0.7, body.velocity.y * 0.7);
          body.setDrag(380, 380);
      }
      this.setupShellCollision(bullet);
      this.scene.time.delayedCall(5000, () => { if (bullet?.active) bullet.destroy(); });
  }

  public fireMortar(time: number, angleOverride?: number) {
      if (this.isDead || this.stunTimer > 0) return;
      if (!this.noCooldown && time < this.lastMortarFired + 20000) return;
      this.lastMortarFired = time;
      if (!this.noCooldown) {
        this.scene.events.emit('update-hud', { hp: (this.hp/this.maxHp)*100, isMortarCD: true });
        this.scene.time.delayedCall(20000, () => {
            this.scene.events.emit('update-hud', { hp: (this.hp/this.maxHp)*100, shell: ShellType[this.currentShell] });
        });
      }

      const angle = angleOverride ?? (this.mortarTurret?.rotation || -Math.PI/2);
      const rot = this.chassis.rotation;
      const muzzleX = this.chassis.x - Math.cos(rot) * 35 * this.scaleFactor;
      const muzzleY = this.chassis.y - Math.sin(rot) * 35 * this.scaleFactor - 25 * this.scaleFactor;
      
      this.scene.particles.createMuzzleFlash(muzzleX, muzzleY, angle, ShellType.HE);
      this.scene.cameras.main.shake(300, 0.02);
      this.playShellFireAudio(ShellType.MORTAR);

      const shell = this.scene.bulletGroup.create(muzzleX, muzzleY, this.scene.getProjectileTexture(ShellType.MORTAR));
      if (shell) {
          shell.setScale(2.5);
          (shell.body as Phaser.Physics.Arcade.Body).setAllowGravity(true);
          this.scene.physics.velocityFromRotation(angle, this.VEL_MORTAR, shell.body.velocity);
          shell.setDepth(30).setData('type', ShellType.MORTAR).setData('owner', this);
          const body = shell.body as Phaser.Physics.Arcade.Body;
          const waterY = this.scene.getWaterSurfaceY(muzzleX);
          if (waterY !== null && muzzleY > waterY + 1) {
              shell.setData('spawnedInWater', true);
              shell.setData('inWater', true);
              shell.setData('waterSlowApplied', true);
              shell.setData('origDragX', body.drag.x);
              shell.setData('origDragY', body.drag.y);
              body.setVelocity(body.velocity.x * 0.15, body.velocity.y * 0.15);
              body.setDrag(520, 520);
          }
          this.scene.particles.createShellTrail(shell, ShellType.MORTAR);
          this.startShellFlightLoop(shell, ShellType.MORTAR);
          this.setupShellCollision(shell);
          if (this.isPlayer) {
            this.scene.events.emit('player-fired-mortar', { owner: this, x: muzzleX, y: muzzleY });
          }
      }
  }

  public fire(target?: Tank) {
    if (this.isDead || this.stunTimer > 0) return;
    if (this.isPlayer && (this.currentShell === ShellType.MORTAR || this.currentShell === ShellType.NUKE)) return;
    const spec = SPECS[this.type];
    const time = this.scene.time.now;
    if (!this.isPlayer && time < this.lastFired + spec.fireRate) return;
    const shellCd = this.isPlayer ? (
      this.currentShell === ShellType.STANDARD ? 500 :
      this.currentShell === ShellType.AP ? 5000 :
      this.currentShell === ShellType.HE ? 7000 :
      this.currentShell === ShellType.INCENDIARY ? 1250 :
      this.currentShell === ShellType.MORTAR ? 20000 :
      this.currentShell === ShellType.NUKE ? 60000 :
      0
    ) : 0;
    const lastShellTime = this.lastShellFired[this.currentShell] ?? 0;
    if (!this.noCooldown && shellCd > 0 && time < lastShellTime + shellCd) return;

    this.lastFired = time;
    this.lastShellFired[this.currentShell] = time;

    if (!this.isPlayer) {
      this.scene.events.emit('combat-activity', { source: 'enemy-fire', team: 'enemy' });
    }

    const angle = this.currentTurretAngle;
    const muzzleX = this.chassis.x + Math.cos(angle) * spec.barrelLength * this.scaleFactor;
    const muzzleY = this.chassis.y - 20 * this.scaleFactor + Math.sin(angle) * spec.barrelLength * this.scaleFactor;
    
    this.scene.particles.createMuzzleFlash(muzzleX, muzzleY, angle, this.currentShell);
    this.playShellFireAudio(this.currentShell);

    const shell = this.scene.bulletGroup.create(muzzleX, muzzleY, this.scene.getProjectileTexture(this.currentShell));
    if (shell) {
        const body = shell.body as Phaser.Physics.Arcade.Body;
        if (this.currentShell === ShellType.BULLET) {
          body.setAllowGravity(false);
          this.scene.physics.velocityFromRotation(angle, this.VEL_BULLET, body.velocity);
          shell.setScale(0.4);
        } else {
          body.setAllowGravity(true);
          
          let vel = this.currentShell === ShellType.AP ? this.VEL_AP :
            (this.currentShell === ShellType.STANDARD ? this.VEL_STANDARD :
            (this.currentShell === ShellType.INCENDIARY ? this.VEL_INCENDIARY :
            (this.currentShell === ShellType.MORTAR ? this.VEL_MORTAR :
            (this.currentShell === ShellType.NUKE ? 450 :
            this.VEL_HE))));
            
          // Override velocity if player aiming calculated a specific apex velocity
          if (this.isPlayer) {
              const targetVel = this.chassis.getData('targetFireVel');
              if (typeof targetVel === 'number' && targetVel > 0) {
                  vel = targetVel;
              }
          }

          if (!this.isPlayer) {
            const d = target ? Phaser.Math.Distance.Between(this.chassis.x, this.chassis.y, target.chassis.x, target.chassis.y) : 1800;
            const t = Phaser.Math.Clamp((d - 1200) / 2200, 0, 1);
            const mult = Phaser.Math.Linear(0.55, 1.0, t);
            vel *= mult;
            body.setGravityY(-750);
          }
          this.scene.physics.velocityFromRotation(angle, vel, body.velocity);
          if (this.currentShell === ShellType.MORTAR) shell.setScale(2.5);
          else if (this.currentShell === ShellType.NUKE) shell.setScale(3.0);
        }
        if (!this.isPlayer && this.currentShell !== ShellType.BULLET) {
          const sx = shell.scaleX || 1;
          const sy = shell.scaleY || 1;
          shell.setScale(sx * 2, sy * 2);
        }
        shell.setDepth(30).setData('type', this.currentShell).setData('owner', this);
        const waterY = this.scene.getWaterSurfaceY(muzzleX);
        if (waterY !== null && muzzleY > waterY + 1) {
          shell.setData('spawnedInWater', true);
          shell.setData('inWater', true);
          shell.setData('waterSlowApplied', true);
          shell.setData('origDragX', body.drag.x);
          shell.setData('origDragY', body.drag.y);
          const mult = this.currentShell === ShellType.BULLET ? 0.7 : 0.15;
          body.setVelocity(body.velocity.x * mult, body.velocity.y * mult);
          body.setDrag(this.currentShell === ShellType.BULLET ? 380 : 520, this.currentShell === ShellType.BULLET ? 380 : 520);
        }
        if (this.currentShell !== ShellType.BULLET) this.scene.particles.createShellTrail(shell, this.currentShell);
        this.startShellFlightLoop(shell, this.currentShell);
        this.setupShellCollision(shell);
        if (this.isPlayer) {
          this.scene.events.emit('player-fired-shell', {
            owner: this,
            shellType: this.currentShell,
            x: muzzleX,
            y: muzzleY
          });
        }
    }
    this.scene.triggerRecoil(this.chassis, angle);

    if (this.isPlayer) {
      const waterY = this.scene.getWaterSurfaceY(this.chassis.x);
      const inWater = waterY !== null && this.chassis.y > waterY + 8;
      if (inWater) {
        const body = this.chassis.body as Phaser.Physics.Arcade.Body;
        const thrust = 1200;
        body.setVelocity(body.velocity.x - Math.cos(angle) * thrust, body.velocity.y - Math.sin(angle) * thrust);
        if (waterY !== null && this.chassis.y < waterY + 90 && Math.sin(angle) > 0.75) {
          body.setVelocityY(-1750);
        }
      }
    }
  }

  public tryNuke() {
    if (!this.isPlayer || this.isDead) return;
    const now = this.scene.time.now;
    if (!this.noCooldown && now < this.lastNukeFired + 60000) return;
    this.lastNukeFired = now;
    const x = this.scene.aimWorld?.x ?? this.scene.input.activePointer.worldX;
    const y = this.scene.aimWorld?.y ?? this.scene.input.activePointer.worldY;

    const nukeExplosionFolder = 'weapon/nuke/explosion/sfx';
    const preferredNukeReverbFolder = this.scene.mapId === 'forest'
      ? 'weapon/nuke/reverb_forest_after_explosion/sfx'
      : 'weapon/nuke/reverb/sfx';
    const nukeReverbFolder = this.scene.audio.hasFolderAudio(preferredNukeReverbFolder)
      ? preferredNukeReverbFolder
      : 'weapon/nuke/reverb/sfx';

    if (this.scene.audio.hasFolderAudio(nukeExplosionFolder)) {
      this.scene.audio.playFolder(nukeExplosionFolder, {
        worldX: x,
        worldY: y,
        maxDistance: 12000,
        volume: 1.0,
        cooldownMs: 0
      });
    }

    if (this.scene.audio.hasFolderAudio(nukeReverbFolder)) {
      this.scene.audio.playFolder(nukeReverbFolder, {
        worldX: x,
        worldY: y,
        maxDistance: 14000,
        volume: 0.95,
        cooldownMs: 0
      });
    }

    this.scene.events.emit('player-nuke', { x, y, owner: this, playDetonationSfx: false });
    this.scene.events.emit('player-fired-nuke', { owner: this, x, y });
  }

  private fadeOutAndStop(sound: Phaser.Sound.BaseSound, duration: number) {
    if (!sound || !this.scene) return;
    this.scene.tweens.killTweensOf(sound);
    
    let startVol = 1;
    try {
      const v = (sound as any).volume;
      if (typeof v === 'number' && Number.isFinite(v)) startVol = v;
    } catch {}
    const proxy = { val: startVol };

    this.scene.tweens.add({
      targets: proxy,
      val: 0,
      duration: duration,
      onUpdate: () => {
        try {
          if (sound && (sound as any).scene) (sound as any).setVolume(proxy.val);
        } catch {}
      },
      onComplete: () => {
        try {
          if (sound && (sound as any).scene) sound.stop();
        } catch {}
        try {
          if (sound && (sound as any).scene) sound.destroy();
        } catch {}
      }
    });
  }

  private tickMachineGunAudio(time: number) {
    if (!this.isPlayer) return;
    if (this.mgBurstShotCount <= 0) return;
    if (time < this.mgLastShotAt + 180) return;
    if (!this.mgTailPlayed) {
      this.mgTailPlayed = true;
      this.mgLooping = false;
      this.scene.audio.stopLoop('p_mg_loop', 90);
      this.scene.audio.playFolderExclusive('p_mg_last_shot', 'weapon/heavy_machine_gun/fire/tail/last_shot/sfx', { volume: 0.9, cooldownMs: 0 });
    }
    if (time > this.mgLastShotAt + 700) {
      this.mgBurstShotCount = 0;
    }
  }

  private onMachineGunShot(time: number) {
    if (!this.isPlayer) return;
    const gap = time - this.mgLastShotAt;
    if (gap > 260) {
      this.mgBurstShotCount = 0;
      this.mgTailPlayed = true;
      this.mgLooping = false;
      this.scene.audio.stopLoop('p_mg_loop', 60);
    }
    if (this.mgBurstShotCount === 0) {
      this.mgTailPlayed = true;
      this.mgLooping = false;
      this.scene.audio.stopLoop('p_mg_loop', 0);
      this.scene.audio.playFolderExclusive('p_mg_last_shot', 'weapon/heavy_machine_gun/fire/tail/last_shot/sfx', { volume: 0.9, cooldownMs: 0 });
    } else if (this.mgBurstShotCount === 1 && !this.mgLooping) {
      this.mgLooping = true;
      this.scene.audio.startLoop('p_mg_loop', 'weapon/heavy_machine_gun/fire/loop/sfx', { volume: 0.7, fadeInMs: 90 });
    }
    this.mgBurstShotCount += 1;
    this.mgLastShotAt = time;
    if (this.mgBurstShotCount >= 2) this.mgTailPlayed = false;
  }

  private getWeaponFolderForShellType(shellType: ShellType): string {
    return weaponFolderForShellType(shellType);
  }

  private getEnemyVehicleBaseFolderKey(): string | null {
    if (this.isPlayer) return null;
    if (this.type === TankType.ENEMY_TIGER) return 'vehicle/enemy_tiger';
    if (this.type === TankType.ENEMY_PANZER) return 'vehicle/enemy_panzer';
    if (this.type === TankType.ENEMY_STUG) return 'vehicle/enemy_stug';
    if (this.type === TankType.ENEMY_A7V) return 'vehicle/enemy_a7v';
    if (this.type === TankType.ENEMY_LUCHS) return 'vehicle/enemy_luchs';
    if (this.type === TankType.ENEMY_MAUS) return 'vehicle/enemy_maus';
    if (this.type === TankType.ENEMY_TUMBLEWEED) return 'vehicle/enemy_tumbleweed';
    if (this.type === TankType.ENEMY_HUNTER) return 'vehicle/enemy_hunter';
    return null;
  }

  private getEnemyVehicleFireFolderKey(): string | null {
    const base = this.getEnemyVehicleBaseFolderKey();
    return base ? `${base}/Fire/sfx` : null;
  }

  private getEnemyVehicleIdleEngineFolderKey(): string | null {
    const base = this.getEnemyVehicleBaseFolderKey();
    return base ? `${base}/idle_engine_loop/sfx` : null;
  }

  private getEnemyVehicleCookoffFolderKey(killType: ShellType): string | null {
    const base = this.getEnemyVehicleBaseFolderKey();
    if (!base) return null;
    const sub =
      killType === ShellType.AP ? 'piercing_armor_shell' :
      killType === ShellType.INCENDIARY ? 'incendiary_shell' :
      'standard_shell';
    return `${base}/cookoff/${sub}/sfx`;
  }

  private playShellFireAudio(shellType: ShellType) {
    if (shellType === ShellType.BULLET) return;
    if (this.isPlayer) {
      const folder = this.getWeaponFolderForShellType(shellType);
      this.scene.audio.playFolderExclusiveCrossfade(`shell_fire_${folder}`, `weapon/${folder}/fire/sfx`, { volume: 0.95, cooldownMs: 0 }, 500);
      return;
    }

    const vehicleFireFolder = this.getEnemyVehicleFireFolderKey();
    if (vehicleFireFolder) {
      this.scene.audio.playFolder(vehicleFireFolder, { worldX: this.chassis.x, worldY: this.chassis.y, volume: 0.95, cooldownMs: 0 });
      return;
    }

    const folder = this.getWeaponFolderForShellType(shellType);
    this.scene.audio.playFolder(`weapon/${folder}/fire/sfx`, { worldX: this.chassis.x, worldY: this.chassis.y, volume: 0.95, cooldownMs: 0 });
  }

  private updateEnemyEngineAudio(time: number, delta: number) {
    if (this.isPlayer) return;
    const folder = this.getEnemyVehicleIdleEngineFolderKey();
    if (!folder) return;

    const loopId = `e_idle_${this.audioInstanceId}`;
    const mechLoopId = `e_mech_${this.audioInstanceId}`;
    
    if (this.isDead || !this.active || !this.chassis?.active) {
      this.scene.audio.stopLoop(loopId, 400);
      this.scene.audio.stopLoop(mechLoopId, 400);
      this.idleSound = null;
      return;
    }

    // --- Idle Engine Loop ---
    const idleBaseVol = 0.55;

    if (!this.idleSound) {
      this.scene.audio.startLoop(loopId, folder, { volume: idleBaseVol, fadeInMs: 300, worldX: this.chassis.x, worldY: this.chassis.y, maxDistance: 5200 })
        .then(sound => {
          if (!sound) return;
          this.idleSound = sound;
          try {
            (this.idleSound as any).setRate?.(this.currentEngineRate);
          } catch {}
        })
        .catch(() => {});
    } else {
      (this.idleSound as any).__panzerWorldX = this.chassis.x;
      (this.idleSound as any).__panzerWorldY = this.chassis.y;
      (this.idleSound as any).__panzerMaxDistance = 5200;
      
      // Update volume if needed (though startLoop handles mixer volume, dynamic changes might be needed if mixer changes at runtime, 
      // but for enemies we just use constant volume for now unless we want to fade it?)
      // We'll stick to the volume set by startLoop/fadeLoop logic in SoundManager for now.
    }

    const body = this.chassis.body as Phaser.Physics.Arcade.Body;
    const isMoving = Math.abs(body.velocity.x) > 15;
    
    // --- Pitch Modulation (Same as Player) ---
    let targetRate = isMoving ? 1.6 : 1.0;
    
    if (isMoving) {
         const vx = body.velocity.x;
         const moveDir = vx > 0 ? 1 : -1;
         const t = Phaser.Math.Clamp(Math.abs(Math.sin(this.chassis.rotation)) / Math.sin(Math.PI / 4), 0, 1);
         if (t > 0.02) {
             const uphill = (moveDir > 0 && this.chassis.rotation < 0) || (moveDir < 0 && this.chassis.rotation > 0);
             const slopeMul = uphill ? (1 - 0.22 * t) : (1 + 0.12 * t);
             targetRate *= slopeMul;
         }
    }
    targetRate = Phaser.Math.Clamp(targetRate, 0.7, 2.2);

    const dt = delta / 1000;
    const changeSpeed = isMoving ? 0.4 : 1.0;
    
    if (this.currentEngineRate < targetRate) {
        const diff = targetRate - this.currentEngineRate;
        const maxChange = changeSpeed * dt;
        if (diff <= maxChange) this.currentEngineRate = targetRate;
        else this.currentEngineRate += maxChange;
    } else if (this.currentEngineRate > targetRate) {
        this.currentEngineRate = Phaser.Math.Linear(this.currentEngineRate, targetRate, Math.min(dt * 5.0, 1.0));
    }

    try {
      (this.idleSound as any).setRate?.(this.currentEngineRate);
    } catch {}

    // --- Mechanical Loop ---
    const baseFolder = this.getEnemyVehicleBaseFolderKey();
    if (baseFolder) {
        const mechFolder = `${baseFolder}/cruise/mechanical_loop/sfx`;
        if (isMoving) {
            this.scene.audio.startLoop(mechLoopId, mechFolder, { 
                volume: 0.65, // Will be multiplied by mixer volume in startLoop
                fadeInMs: 1000,
                worldX: this.chassis.x, 
                worldY: this.chassis.y, 
                maxDistance: 5200 
            });
        } else {
            this.scene.audio.stopLoop(mechLoopId, 1000);
        }
        
        // Update position for mech loop
        const mechSound = this.scene.audio['loops'].get(mechLoopId);
        if (mechSound) {
            (mechSound as any).__panzerWorldX = this.chassis.x;
            (mechSound as any).__panzerWorldY = this.chassis.y;
            (mechSound as any).__panzerMaxDistance = 5200;
        }
    }
  }

  private startShellFlightLoop(shell: any, shellType: ShellType) {
    if (!shell || !shell.active) return;
    if (shellType === ShellType.BULLET) return;
    const folder = this.getWeaponFolderForShellType(shellType);
    const loopId = `shell_flight_${Phaser.Utils.String.UUID()}`;
    shell.setData('flightLoopId', loopId);
    this.scene.audio.startLoop(loopId, `weapon/${folder}/flight_loop/sfx`, { volume: 0.35, fadeInMs: 500, worldX: shell.x, worldY: shell.y, maxDistance: 5200 })
      .then(sound => {
        if (!sound) return;
        if (!shell?.active) {
          try {
            this.scene?.audio?.stopLoop(loopId, 0);
          } catch {}
          return;
        }
        shell.setData('flightLoopSound', sound);
      })
      .catch(() => {});
  }

  private stopShellFlightLoop(shell: any) {
    const loopId = shell?.getData?.('flightLoopId') as string | undefined;
    if (loopId) this.scene.audio.stopLoop(loopId, 120);
    shell?.setData?.('flightLoopId', undefined);
    shell?.setData?.('flightLoopSound', undefined);
  }

  private setupShellCollision(shell: any) {
    const stype = shell.getData('type') as ShellType;
    const bornAt = this.scene.time.now;
    const maxLifeMs =
      stype === ShellType.BULLET ? 5500 :
      stype === ShellType.MORTAR ? 20000 :
      stype === ShellType.NUKE ? 22000 :
      14000;
    const check = () => {
        if (!shell?.active) {
          this.stopShellFlightLoop(shell);
          this.scene.events.off('update', check);
          return;
        }
        if (this.scene.time.now - bornAt > maxLifeMs) {
          this.stopShellFlightLoop(shell);
          this.scene.events.off('update', check);
          try { shell.destroy(); } catch {}
          return;
        }
        const flightSound = shell.getData('flightLoopSound') as Phaser.Sound.BaseSound | undefined;
        if (flightSound) {
          (flightSound as any).__panzerWorldX = shell.x;
          (flightSound as any).__panzerWorldY = shell.y;
          (flightSound as any).__panzerMaxDistance = 5200;
        }
        shell.rotation = Math.atan2(shell.body.velocity.y, shell.body.velocity.x);
        const body = shell.body as Phaser.Physics.Arcade.Body;
        const prevX = (shell.getData('prevX') as number | undefined) ?? (shell.x - body.velocity.x * (1 / 60));
        const prevY = (shell.getData('prevY') as number | undefined) ?? (shell.y - body.velocity.y * (1 / 60));
        const travelLine = new Phaser.Geom.Line(prevX, prevY, shell.x, shell.y);
        shell.setData('prevX', shell.x);
        shell.setData('prevY', shell.y);
        
        const hitBounds = (bounds: Phaser.Geom.Rectangle) =>
          Phaser.Geom.Intersects.RectangleToRectangle(shell.getBounds(), bounds) || Phaser.Geom.Intersects.LineToRectangle(travelLine, bounds);
        
        let radius = 300; let dmg = 100;
        if (stype === ShellType.AP) { radius = 110; dmg = 3200; } 
        else if (stype === ShellType.HE) { radius = 500; dmg = 1500; } 
        else if (stype === ShellType.STANDARD) { radius = 300; dmg = 450; }
        else if (stype === ShellType.MORTAR) { radius = 1500; dmg = 4000; }
        else if (stype === ShellType.INCENDIARY) { radius = 450; dmg = 1200; }
        else if (stype === ShellType.NUKE) { radius = 2500; dmg = 15000; }
        else if (stype === ShellType.BULLET) { radius = 5; dmg = 7.5; }

        const explode = (
          isDirectTankHit = false,
          impactMaterial: 'auto' | 'mud' | 'flesh' | 'metal' = 'auto'
        ) => {
            this.stopShellFlightLoop(shell);
            if (stype === ShellType.BULLET) {
                this.handlePointImpact(shell, stype);
            } else {
                this.scene.triggerExplosion(shell.x, shell.y, radius, dmg, isDirectTankHit, stype, this, 'shell', shell.rotation, impactMaterial);
            }
            this.scene.events.off('update', check); shell.destroy();
        };

        const ownerIsEnemy = !this.isPlayer;

        if (ownerIsEnemy && stype !== ShellType.BULLET) {
            const bullets = (this.scene.bulletGroup?.getChildren?.() as any[] | undefined) ?? [];
            const shellBounds = shell.getBounds();
            Phaser.Geom.Rectangle.Inflate(shellBounds, 8, 8);
            for (const b of bullets) {
                if (!b || b === shell || !b.active) continue;
                const bType = b.getData?.('type') as ShellType | undefined;
                const owner = b.getData?.('owner') as Tank | undefined;
                if (!owner || !owner.isPlayer) continue;
                if (bType !== ShellType.BULLET && bType !== ShellType.AP && bType !== ShellType.HE && bType !== ShellType.STANDARD && bType !== ShellType.INCENDIARY && bType !== ShellType.MORTAR && bType !== ShellType.NUKE) continue;
                const bBounds = (b.getBounds && b.getBounds()) as Phaser.Geom.Rectangle;
                if (!bBounds) continue;
                Phaser.Geom.Rectangle.Inflate(bBounds, bType === ShellType.BULLET ? 6 : 10, bType === ShellType.BULLET ? 6 : 10);
                const bBody = b.body as Phaser.Physics.Arcade.Body | undefined;
                let hit = Phaser.Geom.Intersects.RectangleToRectangle(shellBounds, bBounds);
                if (!hit && bBody) {
                    const bulletLine = new Phaser.Geom.Line(
                        ((b.getData?.('prevX') as number | undefined) ?? (b.x - bBody.velocity.x * (1 / 60))),
                        ((b.getData?.('prevY') as number | undefined) ?? (b.y - bBody.velocity.y * (1 / 60))),
                        b.x,
                        b.y
                    );
                    hit =
                        Phaser.Geom.Intersects.LineToRectangle(bulletLine, shellBounds) ||
                        Phaser.Geom.Intersects.LineToRectangle(travelLine, bBounds);
                }
                if (!hit) continue;
                this.scene.particles.createSmallSpark(shell.x, shell.y);
                const stopOtherFlightLoop = (p: any) => {
                  const id = p?.getData?.('flightLoopId') as string | undefined;
                  if (id) this.scene.audio.stopLoop(id, 120);
                  p?.setData?.('flightLoopId', undefined);
                  p?.setData?.('flightLoopSound', undefined);
                };
                if (bType === ShellType.BULLET) {
                  stopOtherFlightLoop(b);
                  b.destroy();
                } else if (bType !== ShellType.AP) {
                  stopOtherFlightLoop(b);
                  b.destroy();
                }
                this.scene.triggerExplosion(shell.x, shell.y, radius, dmg, false, stype, this.scene.player, 'shell', shell.rotation, 'metal');
                this.scene.awardEventPoints('intercept', '拦截炮弹', 80, '在空中引爆敌方炮弹');
                this.scene.events.off('update', check);
                this.stopShellFlightLoop(shell);
                shell.destroy();
                return;
            }
        }

        if (!ownerIsEnemy) {
            for (const e of this.scene.enemies) {
                if (e instanceof LandSubmarine && e.active && !e.isDead && hitBounds(e.getBounds())) {
                    if (stype === ShellType.BULLET) {
                        this.scene.particles.createSmallSpark(shell.x, shell.y);
                        e.takeDamage(1.5, ShellType.BULLET);
                        this.scene.events.off('update', check);
                        shell.destroy();
                        return;
                    }
                    explode(true, 'metal');
                    return;
                }
            }
        }

        if (this.scene.checkBridgeShellHit(shell.getBounds(), travelLine)) {
            if (stype === ShellType.BULLET) this.scene.particles.createSmallSpark(shell.x, shell.y);
            explode(); return;
        }

        const waterY = this.scene.getWaterSurfaceY(shell.x);
        const inWater = waterY !== null && shell.y > waterY + 1;
        const wasInWater = (shell.getData('inWater') as boolean | undefined) ?? false;
        if (inWater !== wasInWater) {
            shell.setData('inWater', inWater);
            const b = shell.body as Phaser.Physics.Arcade.Body;
            if (inWater) {
                this.stopShellFlightLoop(shell);
                const spawnedInWater = (shell.getData('spawnedInWater') as boolean | undefined) ?? false;
                if ((shell.getData('waterSlowApplied') as boolean | undefined) !== true) {
                    shell.setData('waterSlowApplied', true);
                    const mult = spawnedInWater ? (stype === ShellType.BULLET ? 0.7 : 0.15) : 0.2;
                    b.setVelocity(b.velocity.x * mult, b.velocity.y * mult);
                }
                if (waterY !== null) {
                    const splashStrength =
                      stype === ShellType.BULLET ? 260 :
                      stype === ShellType.MORTAR ? 1200 :
                      stype === ShellType.AP ? 520 :
                      stype === ShellType.NUKE ? 2000 :
                      780;
                    this.scene.particles.createWaterSplash(shell.x, waterY + 2, splashStrength);
                }
                shell.setData('origDragX', b.drag.x);
                shell.setData('origDragY', b.drag.y);
                const drag = spawnedInWater ? 520 : 1400;
                b.setDrag(drag, drag);

            } else {
                const odx = shell.getData('origDragX') as number | undefined;
                const ody = shell.getData('origDragY') as number | undefined;
                if (typeof odx === 'number' && typeof ody === 'number') b.setDrag(odx, ody);
            }
        }

        if (shell.y > this.scene.getTerrainHeight(shell.x)) { 
            if (stype === ShellType.BULLET) {
              if (this.scene.isWaterAt(shell.x)) this.scene.particles.createWaterSplash(shell.x, this.scene.getTerrainHeight(shell.x) + 2, 420);
              else this.scene.particles.createDirtImpact(shell.x, shell.y);
            }
            explode(false, 'mud'); return; 
        }

        if (this.scene.buildings.checkShellCollisions(shell, stype === ShellType.BULLET)) {
            explode(); return;
        }

        let hitSomething = false;

        const trees = this.scene.treeGroup.getChildren() as any[];
        for (let i = 0; i < trees.length; i++) {
            const t = trees[i];
            if (!t?.active) continue;
            if (t.getData?.('collapsed')) continue;
            if (hitBounds(t.getBounds())) { hitSomething = true; break; }
        }
        if (hitSomething) { explode(false, 'mud'); return; }

        if (!ownerIsEnemy && stype !== ShellType.BULLET) {
            const veg = (this.scene.vegetationGroup?.getChildren?.() as any[] | undefined) ?? [];
            for (const v of veg) {
                if (!v?.active) continue;
                if (!v.getData?.('birdTrigger') || v.getData?.('birdTriggered')) continue;
                const vx = v.x as number;
                if (!Number.isFinite(vx) || Math.abs(vx - shell.x) > 70) continue;
                if (hitBounds(v.getBounds())) {
                    const texKey = v.texture?.key as string | undefined;
                    const offY = texKey === 'veg_cactus' ? 80 : 100;
                    this.scene.particles.createFleeingBirds(v.x, v.y - offY);
                    v.setData('birdTriggered', true);
                    hitSomething = true;
                    break;
                }
            }
        }
        if (hitSomething) { explode(false, 'mud'); return; }
        
        const enemySoldiers = this.scene.enemyInfantry.soldiers;
        const alliedSoldiers = this.scene.allies.soldiers;
        for (let si = 0; si < enemySoldiers.length + alliedSoldiers.length; si++) {
            const s = si < enemySoldiers.length ? enemySoldiers[si] : alliedSoldiers[si - enemySoldiers.length];
            if (!s?.active) continue;
            if (ownerIsEnemy && !s.isAlly) continue;
            if (!hitBounds(s.torso.getBounds())) continue;
            if (stype === ShellType.BULLET) {
                if (typeof (s as any).setData === 'function') {
                    (s as any).setData('lastHitByMGAt', this.scene.time.now);
                    if (this.isPlayer) (s as any).setData('lastHitByPlayerMGAt', this.scene.time.now);
                }
                s.takeDamage(999999, s.isAlly ? this.scene.allies : this.scene.enemyInfantry, ShellType.BULLET, shell.x, shell.y);
                this.scene.events.off('update', check);
                shell.destroy();
                return;
            }
            explode(false, 'flesh');
            return;
        }

        for (let i = this.scene.animals.length - 1; i >= 0; i--) {
            const a = this.scene.animals[i];
            if (!a.active) {
                this.scene.animals.splice(i, 1);
                continue;
            }
            if (hitBounds(a.getBounds())) {
                if (stype === ShellType.BULLET) {
                    a.takeDamage(6, 'mg');
                    this.scene.events.off('update', check);
                    shell.destroy();
                    return;
                }
                a.takeDamage(999999, 'shell');
                shell.y = Math.min(shell.y, this.scene.getTerrainHeight(shell.x));
                explode(false, 'flesh');
                return;
            }
        }

        const targets = ownerIsEnemy ? [this.scene.player] : [this.scene.player, ...this.scene.enemies];
        for (const t of targets) {
            const bounds = (t !== this && t?.active && !t.isDead)
              ? (typeof (t as any).getDamageBounds === 'function' ? (t as any).getDamageBounds() : (t as any).getBounds())
              : null;
            if (bounds && hitBounds(bounds)) {
                if (typeof (t as any).registerAttachedTargetShellHit === 'function') {
                    (t as any).registerAttachedTargetShellHit(this);
                }
                if (stype === ShellType.BULLET) this.scene.particles.createSmallSpark(shell.x, shell.y);
                if (t instanceof Helicopter) {
                    if (stype === ShellType.BULLET) { t.takeDamage(dmg, stype); this.scene.events.off('update', check); shell.destroy(); return; }
                    explode(true, 'metal'); return;
                }
                explode(true, 'metal'); return;
            }
        }
    };
    this.scene.events.on('update', check);
    shell.on('destroy', () => {
      this.stopShellFlightLoop(shell);
      this.scene.events.off('update', check);
    });
  }

  private handlePointImpact(shell: any, stype: ShellType) {
      const shellBody = shell.body as Phaser.Physics.Arcade.Body;
      const shellRect = new Phaser.Geom.Rectangle(shell.x - 10, shell.y - 10, 20, 20);
      
      const velocity = shellBody.velocity;
      const speed = velocity.length();
      const line = new Phaser.Geom.Line(
          shell.x - velocity.x * (1/60), 
          shell.y - velocity.y * (1/60), 
          shell.x, 
          shell.y
      );

      const checkHit = (target: any, bounds: Phaser.Geom.Rectangle) => {
           if (Phaser.Geom.Intersects.RectangleToRectangle(shellRect, bounds)) return true;
           if (speed > 500 && Phaser.Geom.Intersects.LineToRectangle(line, bounds)) return true;
           return false;
      };

      const ownerIsEnemy = !this.isPlayer;
      const targets = ownerIsEnemy ? [this.scene.player] : [this.scene.player, ...this.scene.enemies];
      for (const t of targets) {
          if (t !== this && t.active && !t.isDead) {
              const bounds = typeof (t as any).getDamageBounds === 'function' ? (t as any).getDamageBounds() : (t as any).getBounds();
              if (checkHit(t, bounds)) {
                  this.scene.particles.createSmallSpark(shell.x, shell.y);
                  if (typeof (t as any).registerAttachedTargetShellHit === 'function') {
                      (t as any).registerAttachedTargetShellHit(this);
                  }
                  if (t instanceof Tank) t.takeDamage(7.5, ShellType.BULLET);
                  else if (t instanceof LandSubmarine) t.takeDamage(1.5, ShellType.BULLET);
                  else {
                      const maxHp = (t as any).maxHp as number | undefined;
                      const dmg = typeof maxHp === 'number' && maxHp >= 1000 ? 7.5 : 0.5;
                      t.takeDamage(dmg, stype);
                  }
                  return;
              }
          }
      }
      
      const enemySoldiers = this.scene.enemyInfantry.soldiers;
      const alliedSoldiers = this.scene.allies.soldiers;
      for (let si = 0; si < enemySoldiers.length + alliedSoldiers.length; si++) {
          const s = si < enemySoldiers.length ? enemySoldiers[si] : alliedSoldiers[si - enemySoldiers.length];
          if (!s?.active || !s.torso?.active) continue;
          if (ownerIsEnemy && !s.isAlly) continue;
          const bounds = s.torso.getBounds();
          bounds.width = Math.max(bounds.width, 20);
          bounds.height = Math.max(bounds.height, 30);
          bounds.x -= (bounds.width - s.torso.width) / 2;
          bounds.y -= (bounds.height - s.torso.height) / 2;

          if (checkHit(s, bounds)) {
              if (typeof (s as any).setData === 'function') {
                  (s as any).setData('lastHitByMGAt', this.scene.time.now);
                  if (this.isPlayer) (s as any).setData('lastHitByPlayerMGAt', this.scene.time.now);
              }
              // Soldier HP is 30. 5 shots to kill = 6 damage per shot.
              s.takeDamage(6, s.isAlly ? this.scene.allies : this.scene.enemyInfantry, ShellType.BULLET, shell.x, shell.y);
              return;
          }
      }

      for (let i = this.scene.animals.length - 1; i >= 0; i--) {
          const a = this.scene.animals[i];
          if (!a?.active) continue;
          const bounds = a.getBounds();
          if (checkHit(a, bounds)) {
              a.takeDamage(6, 'mg');
              return;
          }
      }
  }

  private drawTrajectory() {
    this.trajectoryGraphics.clear();
    this.aimIndicatorActive = false;
    const isZ = this.isMortarAiming;
    const isN = this.isNukeAiming;
    const isS = this.isShellAiming;

    if (!isZ && !isN && !isS) return;

    if (isN) {
        const cx = this.scene.aimWorld?.x ?? this.scene.input.activePointer.worldX;
        const cy = this.scene.aimWorld?.y ?? this.scene.input.activePointer.worldY;
        const groundY = this.scene.getTerrainHeight(cx);
        const y = Math.min(cy, groundY);
        this.aimIndicatorWorld.set(cx, y);
        this.aimIndicatorActive = true;
        
        // Nuke Target Indicator
        this.trajectoryGraphics.lineStyle(3, 0xff0000, 1);
        this.trajectoryGraphics.strokeCircle(cx, y, 40);
        this.trajectoryGraphics.lineBetween(cx - 60, y, cx + 60, y);
        this.trajectoryGraphics.lineBetween(cx, y - 60, cx, y + 60);
        
        // Radiation symbolish
        this.trajectoryGraphics.beginPath();
        this.trajectoryGraphics.arc(cx, y, 20, 0, Math.PI * 2);
        this.trajectoryGraphics.fillStyle(0xffaa00, 0.5);
        this.trajectoryGraphics.fillPath();
        
        // Vertical line from sky
        this.trajectoryGraphics.lineStyle(2, 0xff0000, 0.5);
        this.trajectoryGraphics.lineBetween(cx, y - 1000, cx, y);
        this.trajectoryGraphics.lineStyle(2, 0xffffff, 0.18);
        for (let ty = y - 1000; ty <= y; ty += 100) {
          const major = (Math.round((ty - (y - 1000)) / 100) % 3) === 0;
          const w = major ? 22 : 14;
          const a = major ? 0.26 : 0.18;
          this.trajectoryGraphics.lineStyle(2, 0xffffff, a);
          this.trajectoryGraphics.lineBetween(cx - w * 0.5, ty, cx + w * 0.5, ty);
        }
        return;
    }

    const angle = isZ ? this.clampMortarAngle(this.mortarAimAngle) : this.currentTurretAngle;
    const spec = SPECS[this.type];
    
    let px = 0;
    let py = 0;
    if (isZ) {
      const rot = this.chassis.rotation;
      px = this.chassis.x - Math.cos(rot) * 35 * this.scaleFactor;
      py = this.chassis.y - Math.sin(rot) * 35 * this.scaleFactor - 25 * this.scaleFactor;
    } else {
      px = this.chassis.x + Math.cos(angle) * spec.barrelLength * this.scaleFactor;
      py = this.chassis.y - 20 * this.scaleFactor + Math.sin(angle) * spec.barrelLength * this.scaleFactor;
    }
    
    let muzzleVel = isZ ? this.VEL_MORTAR : (this.currentShell === ShellType.AP ? this.VEL_AP :
      (this.currentShell === ShellType.STANDARD ? this.VEL_STANDARD :
      (this.currentShell === ShellType.INCENDIARY ? this.VEL_INCENDIARY : this.VEL_HE)));

    // Use prediction velocity if set
    if (this.isPlayer && !isZ) {
        const targetVel = this.chassis.getData('targetFireVel');
        if (typeof targetVel === 'number' && targetVel > 0) {
            muzzleVel = targetVel;
        }
    }

    const color =
      isZ ? 0xff0000 :
      (this.currentShell === ShellType.AP ? 0x4c1d95 : (this.currentShell === ShellType.INCENDIARY ? 0xff4400 : 0xffaa00));
    const dt = 1 / 60;
    const gravity = this.scene.physics.world.gravity.y;

    let vx = Math.cos(angle) * muzzleVel;
    let vy = Math.sin(angle) * muzzleVel;

    const points: Phaser.Math.Vector2[] = [];
    points.push(new Phaser.Math.Vector2(px, py));
    const terrainHeightAt = (x: number) => this.scene.getTerrainHeight(x);
    
    // Simulate until hitting ground or max steps
    for (let i = 0; i < 600; i++) {
      vy += gravity * dt; px += vx * dt; py += vy * dt;
      points.push(new Phaser.Math.Vector2(px, py));
      if (py > terrainHeightAt(px)) break;
    }
    if (points.length < 2) return;

    const lastIdx = points.length - 1;
    const prev = points[lastIdx - 1];
    const last = points[lastIdx];
    let impactX = last.x;
    let impactY = terrainHeightAt(impactX);

    const prevF = prev.y - terrainHeightAt(prev.x);
    const lastF = last.y - terrainHeightAt(last.x);
    if (prevF <= 0 && lastF >= 0) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) * 0.5;
        const x = Phaser.Math.Linear(prev.x, last.x, mid);
        const y = Phaser.Math.Linear(prev.y, last.y, mid);
        const f = y - terrainHeightAt(x);
        if (f > 0) hi = mid;
        else lo = mid;
      }
      impactX = Phaser.Math.Linear(prev.x, last.x, hi);
      impactY = terrainHeightAt(impactX);
      points[lastIdx].set(impactX, impactY);
    }

    // Determine dash start (last 250px near ground)
    const totalLen = points.length; // Approximation
    const dashStart = Math.max(2, totalLen - 15); // Last 15 points (approx 15 frames = 0.25s)
    
    this.trajectoryGraphics.lineStyle(8, 0x000000, 0.34).beginPath().moveTo(points[0].x, points[0].y);
    for (let i = 1; i < dashStart; i++) this.trajectoryGraphics.lineTo(points[i].x, points[i].y);
    this.trajectoryGraphics.strokePath();
    this.trajectoryGraphics.lineStyle(5, 0xffffff, 0.2).beginPath().moveTo(points[0].x, points[0].y);
    for (let i = 1; i < dashStart; i++) this.trajectoryGraphics.lineTo(points[i].x, points[i].y);
    this.trajectoryGraphics.strokePath();
    this.trajectoryGraphics.lineStyle(3, color, 1).beginPath().moveTo(points[0].x, points[0].y);
    for (let i = 1; i < dashStart; i++) this.trajectoryGraphics.lineTo(points[i].x, points[i].y);
    this.trajectoryGraphics.strokePath();

    // Draw dashed part
    this.trajectoryGraphics.lineStyle(5, 0x000000, 0.24);
    const dashLen = 10;
    const gapLen = 8;
    const patternLen = dashLen + gapLen;
    let patternPos = 0;
    
    for (let i = dashStart; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const segLen = p0.distance(p1);
      if (segLen <= 0.0001) continue;

      let t0 = 0;
      while (t0 < 1) {
        const phase = patternPos % patternLen;
        const on = phase < dashLen;
        const remainingInPhase = (on ? dashLen : patternLen) - phase;
        const remainingLen = segLen * (1 - t0);
        const takeLen = Math.min(remainingLen, remainingInPhase);
        const t1 = t0 + takeLen / segLen;
        if (on) {
          const ax = Phaser.Math.Linear(p0.x, p1.x, t0);
          const ay = Phaser.Math.Linear(p0.y, p1.y, t0);
          const bx = Phaser.Math.Linear(p0.x, p1.x, t1);
          const by = Phaser.Math.Linear(p0.y, p1.y, t1);
          this.trajectoryGraphics.lineBetween(ax, ay, bx, by);
        }
        patternPos += takeLen;
        t0 = t1;
      }
    }
    this.trajectoryGraphics.lineStyle(3, 0xffffff, 0.14);
    patternPos = 0;
    for (let i = dashStart; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const segLen = p0.distance(p1);
      if (segLen <= 0.0001) continue;

      let t0 = 0;
      while (t0 < 1) {
        const phase = patternPos % patternLen;
        const on = phase < dashLen;
        const remainingInPhase = (on ? dashLen : patternLen) - phase;
        const remainingLen = segLen * (1 - t0);
        const takeLen = Math.min(remainingLen, remainingInPhase);
        const t1 = t0 + takeLen / segLen;
        if (on) {
          const ax = Phaser.Math.Linear(p0.x, p1.x, t0);
          const ay = Phaser.Math.Linear(p0.y, p1.y, t0);
          const bx = Phaser.Math.Linear(p0.x, p1.x, t1);
          const by = Phaser.Math.Linear(p0.y, p1.y, t1);
          this.trajectoryGraphics.lineBetween(ax, ay, bx, by);
        }
        patternPos += takeLen;
        t0 = t1;
      }
    }
    this.trajectoryGraphics.lineStyle(3, color, 0.86);
    patternPos = 0;
    for (let i = dashStart; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const segLen = p0.distance(p1);
      if (segLen <= 0.0001) continue;

      let t0 = 0;
      while (t0 < 1) {
        const phase = patternPos % patternLen;
        const on = phase < dashLen;
        const remainingInPhase = (on ? dashLen : patternLen) - phase;
        const remainingLen = segLen * (1 - t0);
        const takeLen = Math.min(remainingLen, remainingInPhase);
        const t1 = t0 + takeLen / segLen;
        if (on) {
          const ax = Phaser.Math.Linear(p0.x, p1.x, t0);
          const ay = Phaser.Math.Linear(p0.y, p1.y, t0);
          const bx = Phaser.Math.Linear(p0.x, p1.x, t1);
          const by = Phaser.Math.Linear(p0.y, p1.y, t1);
          this.trajectoryGraphics.lineBetween(ax, ay, bx, by);
        }
        patternPos += takeLen;
        t0 = t1;
      }
    }
    let accum = 0;
    const tickEvery = 200;
    const midEvery = tickEvery * 2;
    const majorEvery = tickEvery * 5;
    let nextTick = tickEvery;
    const maxD = Math.max(1, tickEvery * 40);

    for (let i = 0; i < points.length - 1 && nextTick <= maxD; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const segLen = p0.distance(p1);
      if (segLen <= 0.0001) continue;

      while (accum + segLen >= nextTick && nextTick <= maxD) {
        const t = (nextTick - accum) / segLen;
        const tx = Phaser.Math.Linear(p0.x, p1.x, t);
        const ty = Phaser.Math.Linear(p0.y, p1.y, t);
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const inv = 1 / Math.max(0.0001, Math.sqrt(dx * dx + dy * dy));
        let nx = -dy * inv;
        let ny = dx * inv;
        const txv = dx * inv;
        const tyv = dy * inv;
        if (ny > 0) {
          nx = -nx;
          ny = -ny;
        }

        const isMajor = (nextTick % majorEvery) === 0;
        const isMid = !isMajor && (nextTick % midEvery) === 0;
        const len = isMajor ? 34 : (isMid ? 24 : 14);
        const gap = 6;
        const sx = tx + nx * gap;
        const sy = ty + ny * gap;
        const ex = tx + nx * (gap + len);
        const ey = ty + ny * (gap + len);

        this.trajectoryGraphics.lineStyle(isMajor ? 4 : 3, 0x000000, isMajor ? 0.24 : 0.2);
        this.trajectoryGraphics.lineBetween(sx, sy, ex, ey);
        this.trajectoryGraphics.lineStyle(isMajor ? 3 : 2, 0xffffff, isMajor ? 0.66 : (isMid ? 0.5 : 0.38));
        this.trajectoryGraphics.lineBetween(sx, sy, ex, ey);

        if (isMajor) {
          const cap = 7;
          const cx0 = ex - txv * cap;
          const cy0 = ey - tyv * cap;
          const cx1 = ex + txv * cap;
          const cy1 = ey + tyv * cap;
          this.trajectoryGraphics.lineStyle(4, 0x000000, 0.2);
          this.trajectoryGraphics.lineBetween(cx0, cy0, cx1, cy1);
          this.trajectoryGraphics.lineStyle(2, 0xffffff, 0.62);
          this.trajectoryGraphics.lineBetween(cx0, cy0, cx1, cy1);
        }

        nextTick += tickEvery;
      }
      accum += segLen;
    }

    this.aimIndicatorWorld.set(impactX, impactY);
    this.aimIndicatorActive = true;

    this.trajectoryGraphics.lineStyle(3, 0x000000, 0.24);
    this.trajectoryGraphics.strokeCircle(impactX, impactY, 13);
    this.trajectoryGraphics.lineStyle(2, 0xffffff, 0.58);
    this.trajectoryGraphics.strokeCircle(impactX, impactY, 13);
    this.trajectoryGraphics.lineStyle(2, color, 0.9);
    this.trajectoryGraphics.lineBetween(impactX - 18, impactY, impactX + 18, impactY);
    this.trajectoryGraphics.lineBetween(impactX, impactY - 18, impactX, impactY + 18);
  }

  public takeDamage(amt: number, type: ShellType = ShellType.HE) {
    if (this.isDead) return;
    if (this.cinematicSuspended) return;
    if (this.type === TankType.ENEMY_HUNTER && this.chassis.getData('introDropping') === true) return;
    if (type === ShellType.INCENDIARY) this.touchBurnHeat(this.scene.time.now, 1200);
    this.lastDamageType = type;
    this.hp -= amt;
    if (amt > 0) {
      this.scene.events.emit('combat-damage', { team: this.isPlayer ? 'ally' : 'enemy', source: 'tank' });
    }
    if (this.hp <= 0) this.explode();
    if (this.isPlayer) {
      const hpPct = (this.hp / this.maxHp) * 100;
      this.scene.events.emit('update-hud', { hp: hpPct, shell: ShellType[this.currentShell] });
      this.scene.events.emit('player-damaged', { amt, type, hp: hpPct });
    }
  }

  public markBurningVisual(time: number, durationMs: number): void {
    if (this.isDead) return;
    this.touchBurnHeat(time, durationMs);
  }

  private ensureBurnHeatTargets(): void {
    const targets: any[] = [];
    const add = (o: any) => { if (o && typeof o.setTint === 'function') targets.push(o); };
    add(this.chassis);
    add(this.detailLayer);
    add(this.wheelL);
    add(this.wheelR);
    add(this.turretBase);
    add(this.turretBarrel);
    add(this.mgTurret);
    add(this.mortarTurret);
    this.burnHeatTargets = targets;
    if (!this.burnHeatOrigTints || this.burnHeatOrigTints.length !== targets.length) {
      this.burnHeatOrigTints = targets.map(s => (typeof s.tintTopLeft === 'number' ? s.tintTopLeft : 0xffffff));
    }
  }

  private touchBurnHeat(time: number, durationMs: number): void {
    const recoverMs = 10000;
    const inactive = this.burnHeatEndT <= 0 || time > this.burnHeatEndT + recoverMs;
    if (!this.burnHeatTargets || !this.burnHeatOrigTints || inactive) {
      this.ensureBurnHeatTargets();
    }
    this.burnHeatStartT = time;
    this.burnHeatEndT = Math.max(this.burnHeatEndT, time + durationMs);
  }

  private updateBurnHeatTint(time: number): void {
    if (this.burnHeatEndT <= 0) return;
    const recoverMs = 10000;
    const rampMs = 900;
    if (time > this.burnHeatEndT + recoverMs) {
      if (this.burnHeatTargets && this.burnHeatOrigTints) {
        for (let i = 0; i < this.burnHeatTargets.length; i++) {
          const s = this.burnHeatTargets[i];
          if (!s?.active) continue;
          s.setTint(this.burnHeatOrigTints[i] ?? 0xffffff);
          if (typeof s.setAlpha === 'function') s.setAlpha(1);
        }
      }
      this.burnHeatStartT = 0;
      this.burnHeatEndT = 0;
      this.burnHeatTargets = null;
      this.burnHeatOrigTints = null;
      return;
    }
    if (!this.burnHeatTargets || !this.burnHeatOrigTints) this.ensureBurnHeatTargets();
    const hotTint = 0xff3311;
    const p = time < this.burnHeatEndT
      ? Phaser.Math.Clamp((time - this.burnHeatStartT) / rampMs, 0, 1)
      : Phaser.Math.Clamp(1 - (time - this.burnHeatEndT) / recoverMs, 0, 1);
    if (p <= 0) return;
    for (let i = 0; i < this.burnHeatTargets.length; i++) {
      const s = this.burnHeatTargets[i];
      if (!s?.active) continue;
      const c0 = Phaser.Display.Color.ValueToColor(this.burnHeatOrigTints[i] ?? 0xffffff);
      const c1 = Phaser.Display.Color.ValueToColor(hotTint);
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(c0, c1, 100, Math.round(p * 100));
      const v = Phaser.Display.Color.GetColor(c.r, c.g, c.b);
      s.setTint(v);
      if (typeof s.setAlpha === 'function') s.setAlpha(1);
    }
  }

  public explode() {
    if (this.isDead) return;
    this.isDead = true;
    this.active = false;
    if (!this.isPlayer) {
      this.scene.audio.stopLoop(`e_idle_${this.audioInstanceId}`, 300);
      this.idleSound = null;
    }
    if (!this.isPlayer && this.type === TankType.ENEMY_HUNTER) {
      this.scene.audio.stopLoop(`e_hunter_rise_${this.audioInstanceId}`, 300);
      this.hunterWasLiftActive = false;
    }
    this.hunterLaser?.clear().setVisible(false);
    if (this.isPlayer) this.scene.handlePlayerDefeat();
    if (!this.isPlayer) {
      const label =
        this.type === TankType.ENEMY_TIGER ? '虎式坦克' :
        this.type === TankType.ENEMY_PANZER ? '四号坦克' :
        this.type === TankType.ENEMY_STUG ? '突击炮' :
        this.type === TankType.ENEMY_A7V ? 'A7V' :
        this.type === TankType.ENEMY_LUCHS ? '山猫轻坦' :
        this.type === TankType.ENEMY_MAUS ? '鼠式超重坦' :
        this.type === TankType.ENEMY_TUMBLEWEED ? '风滚草战车' :
        this.type === TankType.ENEMY_HUNTER ? '猎杀者' :
        '敌方坦克';
      this.scene.recordEnemyVehicleKill(label, 1000, this, this.lastDamageType);

      if (this.type === TankType.ENEMY_HUNTER) {
        this.scene.awardEventPoints('special', '你说你惹祂干嘛？', 500, '击毁猎杀者');
      }
    }

    const x = this.chassis.x;
    const y = this.chassis.y;
    if (!this.isPlayer) {
      const cookoffFolder = this.getEnemyVehicleCookoffFolderKey(this.lastDamageType);
      if (cookoffFolder) {
        this.scene.audio.playFolder(cookoffFolder, { worldX: x, worldY: y, volume: 1.0, cooldownMs: 0, maxDistance: 5200, trackPosition: true });
        if (cookoffFolder.endsWith('/standard_shell/sfx')) {
          const dsFolder = cookoffFolder.replace('/standard_shell/sfx', '/standard_shell_DS/sfx');
          this.scene.audio.playFolder(dsFolder, { worldX: x, worldY: y, volume: 1.0, cooldownMs: 0, maxDistance: 5200, trackPosition: true });
        }
      }
    }
    const spec = SPECS[this.type];
    const bodyColor = spec.bodyColor;
    const debrisDepth = 34;
    const barrelTex = () => `${spec.assets.barrel}_${Phaser.Math.Between(0, 4)}`;
    const isHunter = this.type === TankType.ENEMY_HUNTER;

    const wreckParts = [
        this.chassis,
        this.wheelL,
        this.wheelR,
        this.detailLayer,
        this.turretBase,
        this.turretBarrel,
        this.mgTurret,
        this.mortarTurret,
        this.hunterOverlay,
        this.hunterLaser
    ].filter((t): t is any => !!t);

    const hideWreck = () => {
        wreckParts.forEach(p => {
            if ('setVisible' in p) (p as any).setVisible(false);
        });
    };

    let cleanedUp = false;
    const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        this.chassis.destroy(); this.wheelL.destroy(); this.wheelR.destroy();
        this.detailLayer.destroy(); this.turretBase?.destroy(); this.turretBarrel?.destroy();
        this.mgTurret?.destroy(); this.mortarTurret?.destroy();
        this.hunterOverlay?.destroy(); this.hunterLaser?.destroy();
        if (this.trajectoryGraphics?.active) this.trajectoryGraphics.destroy();
        if (this.healthBar?.active) this.healthBar.destroy();
    };

    if (this.healthBar?.active) this.healthBar.destroy();

    const chassisBody = this.chassis.body as Phaser.Physics.Arcade.Body | undefined;
    if (chassisBody) {
        chassisBody.setVelocity(0, 0);
        chassisBody.setAngularVelocity(0);
        chassisBody.setEnable(false);
    }

    const spawnDebris = (tex: string, tint: number, vx: number, vy: number, av: number, scale: number = 1) => {
        const d = this.scene.debrisGroup.get(x, y, tex);
        if (!d) return;
        d.setActive(true).setVisible(true).setTint(tint).setAlpha(1).setDepth(debrisDepth).setScale(scale);
        const body = d.body as Phaser.Physics.Arcade.Body;
        body.setEnable(true);
        body.setImmovable(false);
        body.setAllowGravity(true);
        body.setAllowRotation(true);
        body.setVelocity(vx, vy);
        d.setAngularVelocity(av);
        d.setData('sleeping', false);
        this.scene.tweens.add({ targets: d, alpha: 0, delay: 60000, duration: 5000, onComplete: () => d.destroy() });
    };

    if (isHunter) Tank.ensureHunterDebrisTextures(this.scene);
    const hunterDebrisKeys = ['hunter_debris_plate0', 'hunter_debris_plate1', 'hunter_debris_plate2', 'hunter_debris_plate3', 'hunter_debris_spike0'];
    const spawnHunterDebris = (count: number, tint: number) => {
      for (let i = 0; i < count; i++) {
        const tex = hunterDebrisKeys[Phaser.Math.Between(0, hunterDebrisKeys.length - 1)];
        const vx = Phaser.Math.Between(-1050, 1050);
        const vy = Phaser.Math.Between(-1650, -880);
        const av = Phaser.Math.Between(-1400, 1400);
        const s = 0.8 + Phaser.Math.FloatBetween(0, 0.55);
        spawnDebris(tex, tint, vx, vy, av, s);
      }
    };

    if (this.lastDamageType === ShellType.AP) {
        this.scene.requestHitStop(220);
        this.scene.particles.createAPImpact(x, y, 0);
        this.chassis.setTint(0x2a2a2a).setAlpha(0.9);
        this.detailLayer.setTint(0x2a2a2a).setAlpha(0.9);

        this.scene.time.addEvent({
            delay: 180,
            repeat: 12,
            callback: () => {
                if (!this.scene) return;
                const fx = x + Phaser.Math.Between(-35, 35);
                const fy = y + Phaser.Math.Between(-30, 10);
                this.scene.particles.createExhaust(fx, fy);
                this.scene.particles.createLingeringFire(fx, fy + 8, 18);
                if (Phaser.Math.Between(0, 3) === 0) this.scene.particles.createExplosion(fx, fy, Phaser.Math.Between(35, 55), false, true);
            }
        });

        this.scene.time.delayedCall(Phaser.Math.Between(1200, 1700), () => {
            if (!this.scene) return;
            this.scene.requestHitStop(320);
            this.scene.triggerExplosion(x, y, 520, 320, false, ShellType.HE, undefined, 'vehicle');
            hideWreck();

            // Fix: remove vehicle paint artifact by not spawning the 'hull' debris again or ensuring it fades
            // spawnDebris(spec.assets.hull, bodyColor, Phaser.Math.Between(-240, 240), Phaser.Math.Between(-620, -380), Phaser.Math.Between(-220, 220), 1.0);
            
            if (spec.assets.turret && spec.assets.turret !== '') spawnDebris(spec.assets.turret, bodyColor, Phaser.Math.Between(-850, 850), Phaser.Math.Between(-1400, -980), Phaser.Math.Between(-680, 680), 1.05);
            spawnDebris(barrelTex(), 0x222222, Phaser.Math.Between(-720, 720), Phaser.Math.Between(-1100, -750), Phaser.Math.Between(-900, 900), 1.0);
            spawnDebris(spec.assets.wheel, 0x111111, Phaser.Math.Between(-950, -450), Phaser.Math.Between(-950, -520), Phaser.Math.Between(-1200, 1200), 1.0);
            spawnDebris(spec.assets.wheel, 0x111111, Phaser.Math.Between(450, 950), Phaser.Math.Between(-950, -520), Phaser.Math.Between(-1200, 1200), 1.0);
            if (isHunter) {
              spawnHunterDebris(10, 0xff1a1a);
              spawnHunterDebris(4, 0x2a2a2a);
            }
            this.scene.time.delayedCall(3500, () => cleanup());
        });
    } else if (this.lastDamageType === ShellType.INCENDIARY) {
        this.scene.requestHitStop(220);
        this.scene.particles.createIncendiaryExplosion(x, y - 20, 100);
        this.chassis.setTint(0xff5522).setAlpha(0.95);
        this.detailLayer.setTint(0xaa3311).setAlpha(0.95);

        const swellTargets = [this.chassis, this.detailLayer, this.turretBase, this.turretBarrel].filter((t): t is Phaser.GameObjects.Sprite => !!t);
        this.scene.tweens.add({
            targets: swellTargets as any,
            scaleX: 1.15,
            scaleY: 1.15,
            duration: 600,
            ease: 'Sine.easeOut'
        });

        this.scene.time.addEvent({
            delay: 140,
            repeat: 10,
            callback: () => {
                if (!this.scene) return;
                const fx = x + Phaser.Math.Between(-45, 45);
                const fy = y + Phaser.Math.Between(-35, 20);
                this.scene.particles.createLingeringFire(fx, fy, 24);
                if (Phaser.Math.Between(0, 2) === 0) this.scene.particles.createExplosion(fx, fy, Phaser.Math.Between(35, 65), false, true);
            }
        });

        this.scene.time.delayedCall(800, () => {
            if (!this.scene) return;
            this.scene.requestHitStop(320);
            this.scene.triggerExplosion(x, y, 560, 340, false, ShellType.INCENDIARY);
            hideWreck();
            // Fix: Paint artifact
            // spawnDebris(spec.assets.hull, 0xff7744, Phaser.Math.Between(-320, 320), Phaser.Math.Between(-760, -460), Phaser.Math.Between(-220, 220), 1.15);
            spawnDebris(spec.assets.detail, 0x552211, Phaser.Math.Between(-520, 520), Phaser.Math.Between(-900, -520), Phaser.Math.Between(-720, 720), 1.0);
            if (spec.assets.turret && spec.assets.turret !== '') spawnDebris(spec.assets.turret, 0xff5533, Phaser.Math.Between(-520, 520), Phaser.Math.Between(-980, -680), Phaser.Math.Between(-520, 520), 1.1);
            spawnDebris(barrelTex(), 0x331111, Phaser.Math.Between(-650, 650), Phaser.Math.Between(-900, -620), Phaser.Math.Between(-900, 900), 1.0);
            if (isHunter) {
              spawnHunterDebris(12, 0xff3322);
              spawnHunterDebris(5, 0x2a2a2a);
            }
            this.scene.time.delayedCall(3500, () => cleanup());
        });
    } else {
        this.scene.requestHitStop(360);
        this.scene.triggerExplosion(x, y, 780, 520, false, ShellType.HE, undefined, 'vehicle');
        for (let i = 0; i < 4; i++) {
            this.scene.time.delayedCall(i * 90, () => {
                if (!this.scene) return;
                this.scene.particles.createExplosion(x + Phaser.Math.Between(-80, 80), y + Phaser.Math.Between(-60, 20), 140, true, true);
            });
        }
        hideWreck();

        // Fix: Paint artifact
        // spawnDebris(spec.assets.hull, bodyColor, Phaser.Math.Between(-780, 780), Phaser.Math.Between(-1400, -820), Phaser.Math.Between(-720, 720), 1.0);
        
        spawnDebris(spec.assets.wheel, 0x111111, Phaser.Math.Between(-1200, -520), Phaser.Math.Between(-1200, -720), Phaser.Math.Between(-1600, 1600), 1.0);
        spawnDebris(spec.assets.wheel, 0x111111, Phaser.Math.Between(520, 1200), Phaser.Math.Between(-1200, -720), Phaser.Math.Between(-1600, 1600), 1.0);
        spawnDebris(spec.assets.detail, 0x111111, Phaser.Math.Between(-820, 820), Phaser.Math.Between(-1200, -720), Phaser.Math.Between(-1200, 1200), 1.0);
        if (spec.assets.turret && spec.assets.turret !== '') spawnDebris(spec.assets.turret, bodyColor, Phaser.Math.Between(-980, 980), Phaser.Math.Between(-1600, -1100), Phaser.Math.Between(-1200, 1200), 1.0);
        spawnDebris(barrelTex(), 0x222222, Phaser.Math.Between(-920, 920), Phaser.Math.Between(-1400, -900), Phaser.Math.Between(-1400, 1400), 1.0);
        spawnDebris(barrelTex(), 0x222222, Phaser.Math.Between(-920, 920), Phaser.Math.Between(-1400, -900), Phaser.Math.Between(-1400, 1400), 1.0);
        if (isHunter) {
          spawnHunterDebris(18, 0xff1a1a);
          spawnHunterDebris(8, 0x2a2a2a);
        }
        this.scene.time.delayedCall(3500, () => cleanup());
    }
  }
}

export class LandSubmarine extends Phaser.Physics.Arcade.Sprite {
  private sceneRef: MainScene;
  public hp = 260;
  public maxHp = 260;
  public active = true;
  public isDead = false;
  public isPlayer = false;
  private hibernating = false;
  private mode: 'LAND' | 'LAKE' = 'LAND';
  private lake?: { x0: number; x1: number; waterY: number };
  private deathFxId = 0;
  private turretAngle = 0;
  private lastActionT = 0;
  private lastTrailT = 0;
  private lastDrillDustT = 0;
  private surfacedAtT = 0;
  private lockStartedAtT = 0;
  private lastShotT = 0;
  private shotsFired = 0;
  private volleyFired = false;
  private healthBar: Phaser.GameObjects.Graphics;
  private periscope: Phaser.GameObjects.Graphics;
  private hull: Phaser.GameObjects.Graphics;
  private laser: Phaser.GameObjects.Graphics;
  private cachedBounds = new Phaser.Geom.Rectangle();
  private burnHeatStartT = 0;
  private burnHeatEndT = 0;
  private burnHeatOrigTint: number | null = null;
  
  private aiState: 'SUBMERGED' | 'SURFACING' | 'LOCKING' | 'FIRING' | 'DIVING' = 'SUBMERGED';

  public declare body: Phaser.Physics.Arcade.Body;

  constructor(scene: MainScene, x: number, y: number, config?: { mode?: 'LAND' | 'LAKE'; lake?: { x0: number; x1: number; waterY: number } }) {
    super(scene, x, y, 'armoredcar_body');
    this.sceneRef = scene;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(28).setOrigin(0.5, 1).setScale(2.15);
    this.body.setAllowGravity(false);
    if (config?.mode) this.mode = config.mode;
    if (config?.lake) this.lake = config.lake;
    if (this.mode === 'LAKE' && this.lake) this.setData('lakeBound', true);
    if (this.mode === 'LAKE') this.setScale(1.9);
    this.healthBar = scene.add.graphics().setDepth(60);
    
    // Create periscope
    this.periscope = scene.add.graphics().setDepth(29);
    this.hull = scene.add.graphics().setDepth(30);
    this.laser = scene.add.graphics().setDepth(58);
    this.setVisible(false); // Initially submerged
    this.hull.setVisible(false);
  }

  public setHibernating(hibernating: boolean) {
    if (this.isDead) return;
    if (hibernating === this.hibernating) return;
    this.hibernating = hibernating;

    if (hibernating) {
      this.setVisible(false);
      this.hull.setVisible(false);
      this.periscope.setVisible(false);
      this.laser.setVisible(false);
      this.healthBar.setVisible(false);
      this.body.setVelocity(0, 0);
      this.body.setEnable(false);
      this.setActive(false);
      this.hull.setActive(false);
      this.periscope.setActive(false);
      this.laser.setActive(false);
      this.healthBar.setActive(false);
      return;
    }

    this.setActive(true);
    this.hull.setActive(true);
    this.periscope.setActive(true);
    this.laser.setActive(true);
    this.healthBar.setActive(true);
    this.body.setEnable(true);
  }

  public override getBounds<O extends Phaser.Geom.Rectangle>(output?: O): O {
    const out = (output ?? (this.cachedBounds as unknown as O)) as O;
    if (this.isDead) return out.setEmpty();
    const terrainY = this.sceneRef.getTerrainHeight(this.x);
    const surfaceY = this.mode === 'LAKE' && this.lake ? this.lake.waterY : terrainY;
    if (this.aiState === 'SUBMERGED') {
      if (this.mode === 'LAKE') return out.setTo(this.x - 170, this.y - 220, 340, 260);
      return out.setTo(this.x - 120, surfaceY - 140, 240, 180);
    }
    return out.setTo(this.x - 170, this.y - 220, 340, 260);
  }

  public update(time: number, delta: number, player: Tank) {
    if (this.isDead) return;
    if (this.hibernating) return;
    this.updateBurnHeatTint(time);

    const terrainY = this.sceneRef.getTerrainHeight(this.x);
    const surfaceY = this.mode === 'LAKE' && this.lake ? this.lake.waterY : terrainY;
    const diveY = this.mode === 'LAKE' ? (surfaceY + 260) : (terrainY + 240);
    const surfaceBodyY = this.mode === 'LAKE' ? (surfaceY + 40) : (terrainY - 90);
    const isMobile = !!(this.sceneRef.sys.game.device.os.android || this.sceneRef.sys.game.device.os.iOS);
    const aggroRange = 1800 * (isMobile ? 0.5 : 1) * this.sceneRef.getEnemyAggroVisionScale();
    const distToPlayer = Phaser.Math.Distance.Between(this.x, this.y, player.chassis.x, player.chassis.y);
    this.laser.clear();

    if (this.mode === 'LAKE' && this.lake) {
      const clampX = Phaser.Math.Clamp(this.x, this.lake.x0 + 120, this.lake.x1 - 120);
      if (isFinite(clampX) && Math.abs(clampX - this.x) > 1) this.x = clampX;
    }
    
    // State Machine
    if (this.aiState === 'SUBMERGED') {
        this.y = diveY;
        this.setVisible(false);
        this.hull.setVisible(false);
        this.periscope.setVisible(true);
        this.periscope.clear();
        
        if (this.mode === 'LAKE') {
          const finH = 26;
          this.periscope.fillStyle(0x0a2a44, 0.95);
          this.periscope.fillRoundedRect(this.x - 10, surfaceY - finH, 20, finH, 6);
          this.periscope.fillStyle(0x0f4e74, 0.95);
          this.periscope.fillRoundedRect(this.x - 7, surfaceY - finH - 8, 14, 14, 5);
          this.periscope.lineStyle(2, 0x66ccff, 0.65);
          this.periscope.beginPath();
          this.periscope.moveTo(this.x - 32, surfaceY + 2);
          this.periscope.lineTo(this.x + 32, surfaceY + 2);
          this.periscope.strokePath();
        } else {
          // Draw periscope
          const periH = 40;
          this.periscope.fillStyle(0x333333, 1);
          this.periscope.fillRect(this.x - 4, surfaceY - periH, 8, periH);
          this.periscope.fillRect(this.x - 12, surfaceY - periH, 24, 10);
          this.periscope.fillStyle(0x00ffff, 1); // Lens
          this.periscope.fillRect(this.x + (this.flipX ? -12 : 4), surfaceY - periH + 2, 8, 6);
        }

        if (distToPlayer > aggroRange) {
            this.body.setVelocityX(0);
            this.lastActionT = time;
        } else {
            const pvx = player.chassis.body?.velocity?.x ?? 0;
            const behindDir = Math.abs(pvx) > 25 ? (pvx > 0 ? -1 : 1) : (player.chassis.flipX ? 1 : -1);
            const targetX = player.chassis.x + behindDir * 650;
            const dx = targetX - this.x;
            const dist = Math.abs(dx);
            const dir = dx > 0 ? 1 : -1;
            
            // Emulate moving underground / underwater
            if (dist > 70) {
                this.body.setVelocityX(dir * (this.mode === 'LAKE' ? 380 : 260));
                this.setFlipX(dir < 0);
                
                if (time > this.lastTrailT + 180) {
                    this.lastTrailT = time;
                    if (this.mode !== 'LAKE') {
                      this.sceneRef.particles.createDirtImpact(this.x + Phaser.Math.Between(-10, 10), terrainY + Phaser.Math.Between(-2, 4));
                    } else {
                      this.sceneRef.particles.createWaterSplash(this.x + Phaser.Math.Between(-14, 14), surfaceY + 2, 110);
                    }
                }
            } else {
                this.body.setVelocityX(0);
                // Ready to surface
                if (time > this.lastActionT + 7000) {
                    this.aiState = 'SURFACING';
                    this.periscope.setVisible(false);
                    this.setAlpha(0.25);
                    this.hull.setVisible(true);
                    this.hull.setAlpha(0.25);
                    if (this.mode !== 'LAKE') this.sceneRef.particles.createCraterDebris(this.x, terrainY, 180);
                    this.lastDrillDustT = time;
                    this.sceneRef.tweens.add({
                        targets: this,
                        y: surfaceBodyY,
                        alpha: 1,
                        duration: 1050,
                        ease: 'Quad.out',
                        onUpdate: () => {
                            const now = this.sceneRef.time.now;
                            if (now > this.lastDrillDustT + 90) {
                                this.lastDrillDustT = now;
                                if (this.mode !== 'LAKE') this.sceneRef.particles.createDirtImpact(this.x + Phaser.Math.Between(-16, 16), terrainY + Phaser.Math.Between(-4, 6));
                            }
                        },
                        onComplete: () => {
                            this.aiState = 'LOCKING';
                            this.setAlpha(1);
                            this.surfacedAtT = this.sceneRef.time.now;
                            this.lockStartedAtT = this.surfacedAtT;
                            this.lastShotT = this.surfacedAtT;
                            this.shotsFired = 0;
                            this.volleyFired = false;
                        }
                    });
                }
            }
        }
    } else if (this.aiState === 'SURFACING') {
        this.periscope.setVisible(false);
        this.body.setVelocityX(0);
        // Tween handles movement
        this.hull.setVisible(true);
    } else if (this.aiState === 'LOCKING') {
        this.y = surfaceBodyY;
        this.body.setVelocityX(0);
        
        const aimX = player.chassis.x;
        const aimY = player.chassis.y - 30;
        this.turretAngle = Phaser.Math.Angle.Between(this.x, this.y - 30, aimX, aimY);

        const lockMs = this.mode === 'LAKE' ? 4200 : 8000;
        const t = Phaser.Math.Clamp((time - this.lockStartedAtT) / lockMs, 0, 1);
        const pulse = 0.55 + 0.35 * Math.sin(time * 0.02);
        const sx = this.x + Math.cos(this.turretAngle) * 58;
        const sy = this.y - 45 + Math.sin(this.turretAngle) * 58;
        const lockColor = this.mode === 'LAKE' ? 0x33ffcc : 0xff2222;
        this.laser.lineStyle(3, lockColor, pulse);
        this.laser.lineBetween(sx, sy, aimX, aimY);
        this.laser.fillStyle(lockColor, 0.5 + 0.3 * pulse);
        this.laser.fillCircle(aimX, aimY, 10 + 10 * (1 - t));

        if (time > this.lockStartedAtT + lockMs) {
            this.aiState = 'FIRING';
            this.lastShotT = time;
            this.shotsFired = 0;
        }
    } else if (this.aiState === 'FIRING') {
        this.y = surfaceBodyY;
        this.body.setVelocityX(0);
        const aimX = player.chassis.x;
        const aimY = player.chassis.y - 30;
        this.turretAngle = Phaser.Math.Angle.Between(this.x, this.y - 30, aimX, aimY);

        const sx = this.x + Math.cos(this.turretAngle) * 58;
        const sy = this.y - 45 + Math.sin(this.turretAngle) * 58;
        const fireColor = this.mode === 'LAKE' ? 0x66ccff : 0xff4444;
        this.laser.lineStyle(2, fireColor, 0.35);
        this.laser.lineBetween(sx, sy, aimX, aimY);

        if (this.shotsFired < 2 && time > this.lastShotT + 420) {
            this.lastShotT = time;
            this.shotsFired++;
            this.fireClusterVolley(player);
        }

        const lockMs = this.mode === 'LAKE' ? 4200 : 8000;
        const fireHoldMs = this.mode === 'LAKE' ? 1500 : 2200;
        if (time > this.lockStartedAtT + lockMs + fireHoldMs) {
            this.aiState = 'DIVING';
            if (this.mode !== 'LAKE') this.sceneRef.particles.createCraterDebris(this.x, terrainY, 160);
            this.lastDrillDustT = time;
            this.sceneRef.tweens.add({
                targets: this,
                y: diveY,
                duration: 800,
                ease: 'Quad.in',
                onUpdate: () => {
                    const now = this.sceneRef.time.now;
                    if (now > this.lastDrillDustT + 90) {
                        this.lastDrillDustT = now;
                        if (this.mode !== 'LAKE') this.sceneRef.particles.createDirtImpact(this.x + Phaser.Math.Between(-16, 16), terrainY + Phaser.Math.Between(-4, 6));
                    }
                },
                onComplete: () => {
                    this.setVisible(false);
                    this.hull.setVisible(false);
                    this.aiState = 'SUBMERGED';
                    this.lastActionT = this.sceneRef.time.now;
                }
            });
        }
    } else if (this.aiState === 'DIVING') {
        this.body.setVelocityX(0);
    }

    if (this.aiState === 'SURFACING' || this.aiState === 'LOCKING' || this.aiState === 'FIRING') {
      this.hull.setVisible(true);
      this.hull.setAlpha(this.alpha);
      this.drawHull(this.turretAngle);
    } else {
      this.hull.setVisible(false);
    }

    this.drawHealthBar();
  }

  private drawHull(angle: number) {
    if (!this.hull?.active) return;
    this.hull.clear();
    const ox = this.x;
    const oy = this.y;
    const dir = this.flipX ? -1 : 1;

    if (this.mode === 'LAKE') {
      const bodyW = 160;
      const bodyH = 32;
      const baseY = oy - 18;
      const hullColor = 0x0b3b5a;
      const hullAccent = 0x1278a6;

      this.hull.fillStyle(hullColor, 1);
      this.hull.fillRoundedRect(ox - bodyW / 2, baseY - bodyH, bodyW, bodyH, 18);

      this.hull.fillStyle(hullAccent, 0.95);
      this.hull.fillRoundedRect(ox - bodyW / 2 + 10, baseY - bodyH + 8, bodyW - 20, 10, 10);

      this.hull.fillStyle(0x062235, 1);
      this.hull.fillRoundedRect(ox - 26, baseY - bodyH - 18, 52, 18, 8);
      this.hull.fillStyle(0x66ccff, 0.85);
      this.hull.fillCircle(ox + dir * 14, baseY - bodyH - 10, 3);

      this.hull.fillStyle(0x061c2f, 1);
      for (let i = -2; i <= 2; i++) {
        this.hull.fillCircle(ox + i * 18, baseY - 16, 3);
      }

      const noseX = ox + dir * (bodyW / 2);
      this.hull.fillStyle(0x0a2a44, 1);
      this.hull.fillTriangle(noseX, baseY - 24, noseX + dir * 16, baseY - 18, noseX, baseY - 12);

      const tailX = ox - dir * (bodyW / 2);
      this.hull.fillStyle(0x0a2a44, 1);
      this.hull.fillTriangle(tailX, baseY - 26, tailX - dir * 18, baseY - 18, tailX, baseY - 10);
      this.hull.lineStyle(2, 0x33ffcc, 0.65);
      this.hull.beginPath();
      this.hull.moveTo(ox, baseY - 44);
      this.hull.lineTo(ox + Math.cos(angle) * 70, baseY - 44 + Math.sin(angle) * 70);
      this.hull.strokePath();
      return;
    }

    const bodyW = 120;
    const bodyH = 44;
    const baseY = oy - 22;
    this.hull.fillStyle(0x1b1b1b, 1);
    this.hull.fillRoundedRect(ox - bodyW / 2, baseY - bodyH, bodyW, bodyH, 10);
    this.hull.fillStyle(0x2a2a2a, 1);
    this.hull.fillRoundedRect(ox - 38, baseY - 72, 76, 26, 8);

    this.hull.fillStyle(0x111111, 1);
    this.hull.fillRoundedRect(ox - bodyW / 2, baseY - 12, bodyW, 14, 6);
    this.hull.fillStyle(0x0a0a0a, 1);
    this.hull.fillRoundedRect(ox - bodyW / 2 + 6, baseY - 10, bodyW - 12, 10, 5);

    const noseX = ox + dir * (bodyW / 2);
    const drillLen = 34;
    const drillR = 10;
    this.hull.fillStyle(0x555555, 1);
    this.hull.fillCircle(noseX + dir * drillLen, baseY - 34, drillR);
    this.hull.fillStyle(0x888888, 1);
    this.hull.fillCircle(noseX + dir * (drillLen + 10), baseY - 34, 5);
    this.hull.lineStyle(3, 0x666666, 1);
    this.hull.beginPath();
    this.hull.moveTo(ox, baseY - 58);
    this.hull.lineTo(ox + Math.cos(angle) * 60, baseY - 58 + Math.sin(angle) * 60);
    this.hull.strokePath();
  }

  private fireClusterVolley(player: Tank) {
    this.sceneRef.events.emit('combat-activity', { source: 'enemy-fire', team: 'enemy' });
    if (this.mode === 'LAKE') {
      const angle = this.turretAngle;
      const surfaceY = this.lake?.waterY ?? this.sceneRef.getWaterSurfaceY(this.x) ?? this.sceneRef.getTerrainHeight(this.x);
      const muzzleX = this.x + Math.cos(angle) * 60;
      const muzzleY = Math.max(surfaceY + 28, this.y - 35 + Math.sin(angle) * 60);

      this.sceneRef.audio.playFolder('vehicle/land_submarine/Fire/sfx', { worldX: muzzleX, worldY: muzzleY, volume: 0.95, cooldownMs: 0 });
      const spawnHoming = (speed: number, damage: number, radius: number, tint: number, lifeMs: number, turnRate: number, tag: string) => {
        const p = this.sceneRef.bulletGroup.create(muzzleX, muzzleY, tag === 'torpedo' ? 'proj_torpedo' : 'proj_missile');
        if (!p) return;
        p.setScale(tag === 'torpedo' ? 2.05 : 1.55).setDepth(40);
        p.setData('lakeWeapon', tag);
        if (tag === 'torpedo') p.setData('isTorpedo', true);
        this.sceneRef.particles.createShellTrail(p, ShellType.HE);
        const b = p.body as Phaser.Physics.Arcade.Body;
        b.setAllowGravity(false).setSize(tag === 'torpedo' ? 34 : 22, 18);
        this.sceneRef.physics.velocityFromRotation(angle, speed, b.velocity);

        const bornAt = this.sceneRef.time.now;
        const onUpdate = () => {
          if (!p.active) { this.sceneRef.events.off('update', onUpdate); return; }
          if (tag === 'torpedo') {
            const last = (p.getData('lastBubbleT') as number | undefined) ?? 0;
            const now = this.sceneRef.time.now;
            if (now > last + 140) {
              p.setData('lastBubbleT', now);
              this.sceneRef.particles.createWaterSplash(p.x + Phaser.Math.Between(-6, 6), surfaceY + 2, 90);
            }
          }
          const aimX = player.chassis.x;
          const aimY = Math.max(surfaceY + 30, player.chassis.y - 10);
          const desired = Phaser.Math.Angle.Between(p.x, p.y, aimX, aimY);
          const cur = Math.atan2(b.velocity.y, b.velocity.x);
          const next = Phaser.Math.Angle.RotateTo(cur, desired, turnRate);
          this.sceneRef.physics.velocityFromRotation(next, speed, b.velocity);
          p.rotation = next;
          if (p.y < surfaceY + 18) p.y = surfaceY + 18;
          if (this.sceneRef.time.now > bornAt + lifeMs) {
            this.sceneRef.triggerExplosion(p.x, p.y, radius, damage, false, ShellType.HE, this);
            this.sceneRef.events.off('update', onUpdate);
            p.destroy();
            return;
          }
          if (player?.active && Phaser.Geom.Intersects.RectangleToRectangle(p.getBounds(), player.getBounds())) {
            this.sceneRef.triggerExplosion(p.x, p.y, radius, damage, true, ShellType.HE, this);
            this.sceneRef.events.off('update', onUpdate);
            p.destroy();
            return;
          }
          if (p.y > this.sceneRef.getTerrainHeight(p.x)) {
            this.sceneRef.triggerExplosion(p.x, p.y, radius, damage, false, ShellType.HE, this);
            this.sceneRef.events.off('update', onUpdate);
            p.destroy();
            return;
          }
          if (this.sceneRef.buildings.checkShellCollisions(p, false)) {
            this.sceneRef.triggerExplosion(p.x, p.y, radius, damage, false, ShellType.HE, this);
            this.sceneRef.events.off('update', onUpdate);
            p.destroy();
          }
        };
        this.sceneRef.events.on('update', onUpdate);
        p.on('destroy', () => this.sceneRef.events.off('update', onUpdate));
      };

      this.sceneRef.particles.createMuzzleFlash(muzzleX, muzzleY, angle, ShellType.HE);
      spawnHoming(280, 3400, 980, 0x33bbff, 4200, 0.12, 'torpedo');
      spawnHoming(410, 2600, 900, 0xffaa00, 1600, 0.05, 'he');
      return;
    }

    const angle = this.turretAngle;
    const muzzleX = this.x + Math.cos(angle) * 60;
    const muzzleY = this.y - 35 + Math.sin(angle) * 60;

    this.sceneRef.audio.playFolder('vehicle/land_submarine/Fire/sfx', { worldX: muzzleX, worldY: muzzleY, volume: 0.95, cooldownMs: 0 });
    this.sceneRef.particles.createMuzzleFlash(muzzleX, muzzleY, angle, ShellType.HE);

    const canister = this.sceneRef.bulletGroup.create(muzzleX, muzzleY, 'proj_canister');
    if (!canister) return;
    canister.setScale(1.6).setDepth(40);
    this.sceneRef.particles.createShellTrail(canister, ShellType.HE);
    const body = canister.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(true).setSize(28, 28);
    this.sceneRef.physics.velocityFromRotation(angle, 1350, body.velocity);

    const split = () => {
      if (!canister.active) return;
      const baseAngle = Phaser.Math.Angle.Between(canister.x, canister.y, player.chassis.x, player.chassis.y - 30);
      for (let i = 0; i < 7; i++) {
        const s = this.sceneRef.bulletGroup.create(canister.x, canister.y, 'proj_cluster');
        if (!s) continue;
        s.setScale(1.1).setDepth(39);
        this.sceneRef.particles.createShellTrail(s, ShellType.HE);
        const sb = s.body as Phaser.Physics.Arcade.Body;
        sb.setAllowGravity(true).setSize(22, 22);
        const a = baseAngle + Phaser.Math.FloatBetween(-0.55, 0.55);
        const sp = Phaser.Math.Between(700, 1200);
        this.sceneRef.physics.velocityFromRotation(a, sp, sb.velocity);

        const subUpdate = () => {
          if (!s.active) { this.sceneRef.events.off('update', subUpdate); return; }
          s.rotation = Math.atan2(sb.velocity.y, sb.velocity.x);
          const prevX = (s.getData('prevX') as number | undefined) ?? (s.x - sb.velocity.x * (1 / 60));
          const prevY = (s.getData('prevY') as number | undefined) ?? (s.y - sb.velocity.y * (1 / 60));
          const travelLine = new Phaser.Geom.Line(prevX, prevY, s.x, s.y);
          s.setData('prevX', s.x);
          s.setData('prevY', s.y);

          const hitBounds = (bounds: Phaser.Geom.Rectangle) =>
            Phaser.Geom.Intersects.RectangleToRectangle(s.getBounds(), bounds) || Phaser.Geom.Intersects.LineToRectangle(travelLine, bounds);

          if (s.y > this.sceneRef.getTerrainHeight(s.x)) {
            this.sceneRef.triggerExplosion(s.x, s.y, 900, 2600, false, ShellType.HE, this);
            this.sceneRef.events.off('update', subUpdate);
            s.destroy();
            return;
          }
          if (this.sceneRef.buildings.checkShellCollisions(s, false)) {
            this.sceneRef.triggerExplosion(s.x, s.y, 900, 2600, false, ShellType.HE, this);
            this.sceneRef.events.off('update', subUpdate);
            s.destroy();
            return;
          }
          if (player?.active && hitBounds(player.getBounds())) {
            this.sceneRef.triggerExplosion(s.x, s.y, 900, 3200, true, ShellType.HE, this);
            this.sceneRef.events.off('update', subUpdate);
            s.destroy();
            return;
          }
        };
        this.sceneRef.events.on('update', subUpdate);
        s.on('destroy', () => this.sceneRef.events.off('update', subUpdate));
        this.sceneRef.time.delayedCall(1300, () => { if (s?.active) s.destroy(); });
      }

      this.sceneRef.particles.createExplosion(canister.x, canister.y, 180, true, true);
      canister.destroy();
    };

    const bornAt = this.sceneRef.time.now;
    const onUpdate = () => {
      if (!canister.active) { this.sceneRef.events.off('update', onUpdate); return; }
      canister.rotation = Math.atan2(body.velocity.y, body.velocity.x);

      if (this.sceneRef.time.now > bornAt + 260) { split(); this.sceneRef.events.off('update', onUpdate); return; }
      if (canister.y > this.sceneRef.getTerrainHeight(canister.x)) { split(); this.sceneRef.events.off('update', onUpdate); return; }
      if (this.sceneRef.buildings.checkShellCollisions(canister, false)) { split(); this.sceneRef.events.off('update', onUpdate); return; }
      if (player?.active && Phaser.Geom.Intersects.RectangleToRectangle(canister.getBounds(), player.getBounds())) { split(); this.sceneRef.events.off('update', onUpdate); return; }
    };
    this.sceneRef.events.on('update', onUpdate);
    canister.on('destroy', () => this.sceneRef.events.off('update', onUpdate));
    this.sceneRef.time.delayedCall(900, () => { if (canister?.active) split(); });
  }

  public takeDamage(amt: number, type: ShellType = ShellType.HE) {
    if (this.isDead) return;
    if (type === ShellType.INCENDIARY) this.touchBurnHeat(this.sceneRef.time.now, 1200);

    this.hp -= amt;
    if (amt > 0) this.sceneRef.events.emit('combat-damage', { team: 'enemy', source: 'land_submarine' });
    if (this.hp <= 0) this.destroySub(type);
  }

  public markBurningVisual(time: number, durationMs: number): void {
    if (this.isDead) return;
    this.touchBurnHeat(time, durationMs);
  }

  private touchBurnHeat(time: number, durationMs: number): void {
    const recoverMs = 10000;
    const inactive = this.burnHeatEndT <= 0 || time > this.burnHeatEndT + recoverMs;
    if (inactive || this.burnHeatOrigTint === null) {
      this.burnHeatOrigTint = typeof (this as any).tintTopLeft === 'number' ? (this as any).tintTopLeft : 0xffffff;
    }
    this.burnHeatStartT = time;
    this.burnHeatEndT = Math.max(this.burnHeatEndT, time + durationMs);
  }

  private updateBurnHeatTint(time: number): void {
    if (this.burnHeatEndT <= 0 || this.burnHeatOrigTint === null) return;
    const recoverMs = 10000;
    const rampMs = 900;
    if (time > this.burnHeatEndT + recoverMs) {
      this.setTint(this.burnHeatOrigTint);
      this.burnHeatStartT = 0;
      this.burnHeatEndT = 0;
      this.burnHeatOrigTint = null;
      return;
    }
    const hotTint = 0xff3311;
    const p = time < this.burnHeatEndT
      ? Phaser.Math.Clamp((time - this.burnHeatStartT) / rampMs, 0, 1)
      : Phaser.Math.Clamp(1 - (time - this.burnHeatEndT) / recoverMs, 0, 1);
    if (p <= 0) return;
    const c0 = Phaser.Display.Color.ValueToColor(this.burnHeatOrigTint);
    const c1 = Phaser.Display.Color.ValueToColor(hotTint);
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(c0, c1, 100, Math.round(p * 100));
    const v = Phaser.Display.Color.GetColor(c.r, c.g, c.b);
    this.setTint(v);
  }

  private drawHealthBar() {
    if (!this.healthBar?.active || this.isDead || !this.body) {
        if (this.healthBar?.active) this.healthBar.clear();
        return;
    }
    this.healthBar.clear();
    if (this.aiState !== 'LOCKING' && this.aiState !== 'FIRING') return;
    const hY = this.y - 90;
    
    this.healthBar.fillStyle(0x000000, 0.7);
    this.healthBar.fillRect(this.x - 45, hY, 90, 6);
    const fill = Math.max(0, this.hp / this.maxHp);
    this.healthBar.fillStyle(0xff0000, 1);
    this.healthBar.fillRect(this.x - 44, hY + 1, 88 * fill, 4);
  }

  private destroySub(killType: ShellType) {
    if (this.isDead) return;
    const fxType = killType === ShellType.BULLET ? ShellType.HE : killType;
    const cookoffSub =
      killType === ShellType.AP ? 'piercing_armor_shell' :
      killType === ShellType.INCENDIARY ? 'incendiary_shell' :
      'standard_shell';

    const preBounds = this.getBounds(new Phaser.Geom.Rectangle());
    const cx = preBounds.width > 0 ? preBounds.centerX : this.x;
    const cy = preBounds.height > 0 ? preBounds.centerY : this.y;
    this.isDead = true;
    const fxId = ++this.deathFxId;
    this.active = false;
    this.body.setVelocity(0, 0);
    this.body.enable = false;
    if (this.healthBar?.active) this.healthBar.destroy();
    if (this.periscope?.active) this.periscope.destroy();
    if (this.hull?.active) this.hull.destroy();
    if (this.laser?.active) this.laser.destroy();
    this.setVisible(false);

    if (this.mode === 'LAKE') {
      this.sceneRef.recordEnemyVehicleKill('水潜艇', 1200, this);
      const cookoffFolder = `vehicle/land_submarine/cookoff/${cookoffSub}/sfx`;
      this.sceneRef.audio.playFolder(cookoffFolder, { worldX: cx, worldY: cy, volume: 1.0, cooldownMs: 0, maxDistance: 5200, trackPosition: true });
      if (cookoffFolder.endsWith('/standard_shell/sfx')) {
        this.sceneRef.audio.playFolder(cookoffFolder.replace('/standard_shell/sfx', '/standard_shell_DS/sfx'), { worldX: cx, worldY: cy, volume: 1.0, cooldownMs: 0, maxDistance: 5200, trackPosition: true });
      }
      const surfaceY = this.lake?.waterY ?? this.sceneRef.getWaterSurfaceY(cx) ?? this.sceneRef.getTerrainHeight(cx);
      this.sceneRef.requestHitStop(180);
      this.sceneRef.cameras.main.shake(700, 0.048);
      this.sceneRef.particles.createWaterSplash(cx, surfaceY + 2, 900);

      const bubble = this.sceneRef.add.particles(cx, Math.max(surfaceY + 20, cy), 'spark', {
        speed: { min: 40, max: 220 },
        angle: { min: 250, max: 290 },
        scale: { start: 2.2, end: 0 },
        alpha: { start: 0.45, end: 0 },
        lifespan: { min: 700, max: 1500 },
        quantity: 18,
        emitting: false,
        tint: [0xcfe7ff, 0x6bb7ff, 0xffffff],
        blendMode: 'ADD',
        gravityY: -800
      }).setDepth(98);
      bubble.explode();

      const silt = this.sceneRef.add.particles(cx, Math.max(surfaceY + 40, cy + 10), 'smoke_puff', {
        speed: { min: 20, max: 120 },
        angle: { min: 240, max: 300 },
        scale: { start: 0.8, end: 3.8 },
        alpha: { start: 0.22, end: 0 },
        lifespan: { min: 1200, max: 2400 },
        quantity: 14,
        emitting: false,
        tint: [0x061c2f, 0x0b3356, 0x1a6aa8],
        gravityY: -90
      }).setDepth(94);
      silt.explode();

      this.sceneRef.time.delayedCall(2400, () => { bubble.destroy(); silt.destroy(); });
      this.sceneRef.time.delayedCall(3500, () => this.destroy());
      return;
    }

    const radius =
      fxType === ShellType.AP ? 420 :
      fxType === ShellType.INCENDIARY ? 560 :
      fxType === ShellType.MORTAR ? 620 :
      520;
    const dmg = fxType === ShellType.AP ? 220 : 280;

    this.sceneRef.recordEnemyVehicleKill('大地潜艇', 1000, this);
    {
      const cookoffFolder = `vehicle/land_submarine/cookoff/${cookoffSub}/sfx`;
      this.sceneRef.audio.playFolder(cookoffFolder, { worldX: cx, worldY: cy, volume: 1.0, cooldownMs: 0, maxDistance: 5200, trackPosition: true });
      if (cookoffFolder.endsWith('/standard_shell/sfx')) {
        this.sceneRef.audio.playFolder(cookoffFolder.replace('/standard_shell/sfx', '/standard_shell_DS/sfx'), { worldX: cx, worldY: cy, volume: 1.0, cooldownMs: 0, maxDistance: 5200, trackPosition: true });
      }
    }
    const groundY = this.sceneRef.getTerrainHeight(cx);
    const fxY = Math.min(cy, groundY - 10);
    this.sceneRef.triggerExplosion(cx, fxY, radius, dmg, false, fxType, this, 'vehicle');

    this.sceneRef.requestHitStop(fxType === ShellType.AP ? 160 : 260);
    this.sceneRef.cameras.main.shake(900, fxType === ShellType.AP ? 0.046 : 0.078);

    this.sceneRef.particles.createSmallSpark(cx + Phaser.Math.Between(-40, 40), cy + Phaser.Math.Between(-30, 30));
    if (fxType === ShellType.AP) this.sceneRef.particles.createVehicleExplosion(cx, fxY, radius * 0.55);
    if (fxType === ShellType.INCENDIARY) this.sceneRef.particles.createLingeringFire(cx, cy, 110);
    else this.sceneRef.particles.createLingeringFire(cx, cy, 85);

    const cookOffCount = fxType === ShellType.AP ? 3 : (fxType === ShellType.INCENDIARY ? 6 : 4);
    for (let i = 0; i < cookOffCount; i++) {
      this.sceneRef.time.delayedCall(160 + i * 220, () => {
        if (!this.sceneRef || this.isDead === false || this.deathFxId !== fxId) return;
        const ox = cx + Phaser.Math.Between(-150, 150);
        const oy = cy + Phaser.Math.Between(-110, 70);
        const r = Phaser.Math.Between(60, 120);
        this.sceneRef.particles.createExplosion(ox, oy, r, false, false);
        if (Phaser.Math.Between(0, 2) !== 0) this.sceneRef.particles.createSmallSpark(ox + Phaser.Math.Between(-26, 26), oy + Phaser.Math.Between(-18, 18));
        if (fxType === ShellType.INCENDIARY && Phaser.Math.Between(0, 3) === 0) this.sceneRef.particles.createLingeringFire(ox, oy, Phaser.Math.Between(10, 20));
      });
    }

    const spawnDebris = (tex: string, tint: number, s: number, vx: number, vy: number, av: number) => {
      const d = this.sceneRef.debrisGroup.get(cx + Phaser.Math.Between(-30, 30), cy + Phaser.Math.Between(-20, 20), tex);
      if (!d) return;
      d.setActive(true).setVisible(true).setDepth(34).setTint(tint).setAlpha(1).setScale(s);
      const db = d.body as Phaser.Physics.Arcade.Body;
      db.setEnable(true);
      db.setSize(d.displayWidth, d.displayHeight, true);
      db.setImmovable(false);
      db.setAllowGravity(true);
      db.setAllowRotation(true);
      db.setVelocity(vx, vy);
      d.setAngularVelocity(av);
      d.setData('sleeping', false);
      this.sceneRef.tweens.add({ targets: d, alpha: 0, delay: 26000, duration: 5000, onComplete: () => d.destroy() });
    };

    const kick = fxType === ShellType.AP ? 0.65 : 1.0;
    spawnDebris('armoredcar_body', 0x3a3a3a, 1.45, Phaser.Math.Between(-620, 620) * kick, Phaser.Math.Between(-1120, -720) * kick, Phaser.Math.Between(-620, 620));
    spawnDebris('brick_metal', 0x666666, 1.05, Phaser.Math.Between(-980, 980) * kick, Phaser.Math.Between(-1280, -820) * kick, Phaser.Math.Between(-900, 900));
    spawnDebris('shell_model', 0x1a1a1a, 2.1, Phaser.Math.Between(-880, 880) * kick, Phaser.Math.Between(-1120, -720) * kick, Phaser.Math.Between(-980, 980));

    this.sceneRef.time.delayedCall(3500, () => this.destroy());
  }
}
