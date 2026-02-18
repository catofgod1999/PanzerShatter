
import Phaser from 'phaser';
import type { MainScene } from '../MainScene';
import { ShellType } from '../types/GameplayTypes';

export class ParticleSystems {
  private scene: MainScene;
  private fxMul = 1;
  private mgTracerOuterPool: Phaser.GameObjects.Line[] = [];
  private mgTracerCorePool: Phaser.GameObjects.Line[] = [];
  private activeMgTracers: Array<{ outer: Phaser.GameObjects.Line; core: Phaser.GameObjects.Line; start: number; end: number }> = [];
  private activeShellTrails: Array<{
    shell: Phaser.GameObjects.Sprite;
    stype: ShellType;
    ownerIsPlayer: boolean;
    baseScale: number;
    microGlintA: Phaser.GameObjects.Image;
    microGlintB: Phaser.GameObjects.Image;
    apReflectA?: Phaser.GameObjects.Ellipse;
    apReflectB?: Phaser.GameObjects.Ellipse;
    apHeat?: Phaser.GameObjects.Ellipse;
    apShock?: Phaser.GameObjects.Ellipse;
    apRedLine?: Phaser.GameObjects.Graphics;
    managers: Array<{ destroy: () => void }>;
    lastTracerT: number;
    lastAirT: number;
    tracerEveryMs: number;
    airEveryMs: number;
    tracerOuter: number;
    tracerCore: number;
    tracerGlow: number;
    tracerOuterWidth: number;
    tracerCoreWidth: number;
    tracerGlowWidth: number;
    tracerOuterAlpha: number;
    tracerCoreAlpha: number;
    tracerGlowAlpha: number;
    tracerLenMult: number;
    tracerLenMin: number;
    tracerLenMax: number;
    airColor: number;
    airAlpha: number;
    glowCore?: Phaser.GameObjects.Ellipse;
    glowHalo?: Phaser.GameObjects.Ellipse;
    glowCoreW: number;
    glowCoreH: number;
    glowHaloW: number;
    glowHaloH: number;
  }> = [];
  private activeWindEmitters: Array<{
    emitter: Phaser.GameObjects.Particles.ParticleEmitter;
    y: number;
    factor: number;
    kind?: 'sandstorm' | 'fog' | 'rain' | 'other';
    baseFrequency?: number;
    baseQuantity?: number;
    minFrequency?: number;
    maxQuantity?: number;
  }> = [];
  private activeWeatherObjects: Phaser.GameObjects.GameObject[] = [];
  private lastWindUpdateT = 0;
  private activeSandstorm: { until: number } | null = null;
  private activeRain: { until: number } | null = null;
  private sandstormFx:
    | null
    | {
        until: number;
        streaks: Phaser.GameObjects.Particles.ParticleEmitter;
        grains: Phaser.GameObjects.Particles.ParticleEmitter;
        haze: Phaser.GameObjects.Particles.ParticleEmitter;
        streakEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
        grainEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
        hazeEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
        streakRect: Phaser.Geom.Rectangle;
        grainRect: Phaser.Geom.Rectangle;
        hazeRect: Phaser.Geom.Rectangle;
      } = null;
  private forestRainFx:
    | null
    | {
        until: number;
        drops: Phaser.GameObjects.Particles.ParticleEmitter;
        mist: Phaser.GameObjects.Particles.ParticleEmitter;
        dropsEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
        mistEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
        dropsRect: Phaser.Geom.Rectangle;
        mistRect: Phaser.Geom.Rectangle;
      } = null;
  private blackRainFx:
    | null
    | {
        until: number;
        drops: Phaser.GameObjects.Particles.ParticleEmitter;
        mist: Phaser.GameObjects.Particles.ParticleEmitter;
        dropsEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
        mistEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
        dropsRect: Phaser.Geom.Rectangle;
        mistRect: Phaser.Geom.Rectangle;
      } = null;
  private destroyed = false;
  private glowBudget = 0;
  private glowBudgetMax = 18;
  private activeSoftRingFx = 0;
  private maxSoftRingFx = 8;
  private baseFxMul = 1;
  private baseGlowBudgetMax = 18;
  private baseSoftRingFx = 8;
  private dynamicFxScale = 1;
  private dynamicWeatherDensity = 1;
  private androidDynamicFxEnabled = false;
  private lastDynamicFxTuneT = 0;
  private cinematicGrade:
    | null
    | {
        centerLift?: Phaser.GameObjects.Image;
        vignette?: Phaser.GameObjects.Image;
      } = null;
  private combatPulseUntil = 0;
  private readonly onCombatDamage = () => {
    this.combatPulseUntil = this.scene.time.now + 2200;
  };

  constructor(scene: MainScene) {
    this.scene = scene;
    const isAndroid = this.scene.sys.game.device.os.android;
    const isIOS = this.scene.sys.game.device.os.iOS;
    this.fxMul = isAndroid ? 0.52 : (isIOS ? 0.6 : 1);
    this.baseFxMul = this.fxMul;
    this.glowBudgetMax = this.fxMul < 0.7 ? 10 : (this.fxMul < 0.85 ? 14 : 24);
    this.maxSoftRingFx = this.fxMul < 0.7 ? 4 : (this.fxMul < 0.85 ? 6 : 11);
    this.baseGlowBudgetMax = this.glowBudgetMax;
    this.baseSoftRingFx = this.maxSoftRingFx;
    this.dynamicFxScale = 1;
    this.dynamicWeatherDensity = 1;
    this.androidDynamicFxEnabled = isAndroid;
    this.lastDynamicFxTuneT = 0;
    this.setupCinematicGrade();
    this.scene.events.on('combat-damage', this.onCombatDamage, this);
    this.scene.events.on('update', this.update, this);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private q(v: number) {
    return Math.max(1, Math.round(v * this.fxMul));
  }

  private f(ms: number) {
    return Math.max(1, Math.round(ms / Math.max(0.05, this.fxMul)));
  }

  private mixColor(a: number, b: number, t: number) {
    const k = Phaser.Math.Clamp(t, 0, 1);
    const ca = Phaser.Display.Color.IntegerToColor(a);
    const cb = Phaser.Display.Color.IntegerToColor(b);
    const r = Math.round(ca.red + (cb.red - ca.red) * k);
    const g = Math.round(ca.green + (cb.green - ca.green) * k);
    const bl = Math.round(ca.blue + (cb.blue - ca.blue) * k);
    return Phaser.Display.Color.GetColor(r, g, bl);
  }

  private isNearCamera(x: number, y: number, padding: number = 360) {
    const cam = this.scene.cameras.main;
    const z = Math.max(0.0001, cam.zoom);
    const viewW = cam.width / z;
    const viewH = cam.height / z;
    return (
      x >= cam.scrollX - padding &&
      x <= cam.scrollX + viewW + padding &&
      y >= cam.scrollY - padding &&
      y <= cam.scrollY + viewH + padding
    );
  }

  private tryReserveGlow(cost: number) {
    const c = Math.max(0, cost);
    if (c <= 0) return true;
    if (this.glowBudget + c > this.glowBudgetMax) return false;
    this.glowBudget += c;
    return true;
  }

  private releaseGlow(cost: number) {
    if (cost <= 0) return;
    this.glowBudget = Math.max(0, this.glowBudget - cost);
  }

  private setupCinematicGrade() {
    let centerLift: Phaser.GameObjects.Image | undefined;
    if (this.scene.textures.exists('fx_soft_glow')) {
      centerLift = this.scene.add.image(0, 0, 'fx_soft_glow').setDepth(86).setScrollFactor(0);
      centerLift.setBlendMode(Phaser.BlendModes.ADD);
      centerLift.setTint(0xc4dcff);
      centerLift.setAlpha(0.08);
    }

    let vignette: Phaser.GameObjects.Image | undefined;
    if (this.scene.textures.exists('fx_vignette_soft')) {
      vignette = this.scene.add.image(0, 0, 'fx_vignette_soft').setDepth(85).setScrollFactor(0);
      vignette.setBlendMode(Phaser.BlendModes.NORMAL);
      vignette.setTint(0x04060b);
      vignette.setAlpha(0.28);
    }

    this.cinematicGrade = { centerLift, vignette };
    this.updateCinematicGrade();
  }


  private destroyCinematicGrade() {
    if (!this.cinematicGrade) return;
    const { centerLift, vignette } = this.cinematicGrade;
    centerLift?.destroy();
    vignette?.destroy();
    this.cinematicGrade = null;
  }


  private updateCinematicGrade() {
    if (!this.cinematicGrade) return;
    const cam = this.scene.cameras.main;

    // Screen-space anchor: do not follow world zoom.
    // Add a little overscan so camera shake never reveals texture bounds.
    const viewW = cam.width;
    const viewH = cam.height;
    const shakeX = Number((cam as any)?.shakeEffect?._offsetX ?? 0);
    const shakeY = Number((cam as any)?.shakeEffect?._offsetY ?? 0);
    const x0 = -shakeX;
    const y0 = -shakeY;
    const now = this.scene.time.now;

    const breathe = 0.5 + 0.5 * Math.sin(now * 0.0012);
    const combatK = Phaser.Math.Clamp((this.combatPulseUntil - now) / 2200, 0, 1);

    if (this.cinematicGrade.vignette) {
      const v = this.cinematicGrade.vignette;
      v.setPosition(x0 + viewW * 0.5, y0 + viewH * 0.5);
      v.setScale((viewW / 512) * 1.38, (viewH / 512) * 1.38);
      v.setAlpha(0.19 + combatK * 0.12 + breathe * 0.014);
    }

    if (this.cinematicGrade.centerLift) {
      const lift = this.cinematicGrade.centerLift;
      const scale = Math.max(viewW, viewH) / 64;
      lift.setPosition(x0 + viewW * 0.5, y0 + viewH * 0.56);
      lift.setScale(scale * 1.56, scale * 1.18);
      lift.setAlpha(0.04 + breathe * 0.03 + combatK * 0.044);
    }
  }


  private spawnSoftShockRing(
    x: number,
    y: number,
    opts?: {
      radius?: number;
      color?: number;
      alpha?: number;
      durationMs?: number;
      depth?: number;
      expand?: number;
      anisotropy?: number;
      rotation?: number;
    }
  ) {
    if (!this.isNearCamera(x, y, 420)) return;
    if (this.activeSoftRingFx >= this.maxSoftRingFx) return;
    const key = this.scene.textures.exists('fx_soft_ring')
      ? 'fx_soft_ring'
      : (this.scene.textures.exists('fx_soft_glow') ? 'fx_soft_glow' : null);
    if (!key) return;

    this.activeSoftRingFx++;
    const radius = Math.max(18, opts?.radius ?? 120);
    const color = opts?.color ?? 0xffc998;
    const alpha = Phaser.Math.Clamp(opts?.alpha ?? 0.34, 0, 1);
    const duration = Math.max(120, opts?.durationMs ?? 360);
    const depth = opts?.depth ?? 105;
    const expand = Phaser.Math.Clamp(opts?.expand ?? 5.4, 1.2, 9.0);
    const anisotropy = Phaser.Math.Clamp(opts?.anisotropy ?? 0.62, 0.18, 1.6);
    const rotation = opts?.rotation ?? 0;
    const baseScale = radius / 64;

    const ring = this.scene.add.image(x, y, key).setDepth(depth);
    ring.setBlendMode(Phaser.BlendModes.ADD);
    ring.setTint(color);
    ring.setAlpha(alpha * (this.fxMul < 0.85 ? 0.9 : 1));
    ring.setScale(baseScale * 0.52, baseScale * 0.34 * anisotropy);
    ring.setRotation(rotation);

    this.scene.tweens.add({
      targets: ring,
      scaleX: ring.scaleX * expand,
      scaleY: ring.scaleY * expand * 0.92,
      alpha: 0,
      duration,
      ease: 'Cubic.out',
      onComplete: () => {
        ring.destroy();
        this.activeSoftRingFx = Math.max(0, this.activeSoftRingFx - 1);
      }
    });
  }

  private pulseNearbyTankHighlights(x: number, y: number, radius: number, intensity: number = 1) {
    const entries: Array<{ tank: any; d2: number; tx: number; ty: number }> = [];
    const radiusSq = radius * radius;
    const addTank = (tank: any) => {
      if (!tank?.chassis?.active || tank?.isDead) return;
      const tx = Number(tank.chassis.x);
      const ty = Number(tank.chassis.y - 24);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
      const dx = tx - x;
      const dy = ty - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > radiusSq) return;
      entries.push({ tank, d2, tx, ty });
    };

    addTank((this.scene as any).player);
    const enemies = ((this.scene as any).enemies as any[] | undefined) ?? [];
    for (const e of enemies) addTank(e);
    if (entries.length === 0) return;

    entries.sort((a, b) => a.d2 - b.d2);
    const limit = this.fxMul < 0.85 ? 2 : 4;

    for (let i = 0; i < entries.length && i < limit; i++) {
      const e = entries[i];
      if (!this.isNearCamera(e.tx, e.ty, 260)) continue;
      const d = Math.sqrt(e.d2);
      const falloff = 1 - Phaser.Math.Clamp(d / radius, 0, 1);
      const k = Phaser.Math.Clamp(falloff * intensity, 0.25, 1.4);
      const cost = 0.35 + k * 0.25;
      if (!this.tryReserveGlow(cost)) continue;

      const angle = Math.atan2(e.ty - y, e.tx - x) + Math.PI * 0.5;
      const depth = Math.max(35, Number((e.tank.turretBase?.depth ?? e.tank.chassis?.depth ?? 34) + 2));
      const streak = this.scene.add.ellipse(
        e.tx,
        e.ty,
        28 + 28 * k,
        8 + 8 * k,
        this.mixColor(0xb8d8ff, 0xffd2a0, 0.3),
        0.16 + 0.18 * k
      ).setDepth(depth);
      streak.setBlendMode(Phaser.BlendModes.ADD);
      streak.setRotation(angle);

      this.scene.tweens.add({
        targets: streak,
        alpha: 0,
        scaleX: 1.65,
        scaleY: 1.18,
        duration: 240,
        ease: 'Quad.out',
        onComplete: () => {
          streak.destroy();
          this.releaseGlow(cost);
        }
      });

      if (this.scene.textures.exists('fx_soft_glow') && this.tryReserveGlow(0.22)) {
        const glint = this.scene.add.image(e.tx, e.ty, 'fx_soft_glow').setDepth(depth - 1);
        glint.setBlendMode(Phaser.BlendModes.ADD);
        glint.setTint(0xe8f3ff);
        glint.setAlpha(0.09 + 0.1 * k);
        glint.setScale(0.22 + 0.15 * k, 0.15 + 0.1 * k);
        glint.setRotation(angle + 0.05);
        this.scene.tweens.add({
          targets: glint,
          alpha: 0,
          scaleX: glint.scaleX * 2.2,
          scaleY: glint.scaleY * 1.8,
          duration: 220,
          ease: 'Sine.out',
          onComplete: () => {
            glint.destroy();
            this.releaseGlow(0.22);
          }
        });
      }
    }
  }

  private emitScreenExposurePulse(
    x: number,
    y: number,
    opts?: {
      strength?: number;
      color?: number;
      durationMs?: number;
    }
  ) {
    if (!this.isNearCamera(x, y, 520)) return;
    const cam = this.scene.cameras.main;
    const screenX = (x - cam.scrollX) * cam.zoom;
    const screenY = (y - cam.scrollY) * cam.zoom;
    const strength = Phaser.Math.Clamp(opts?.strength ?? 0.42, 0.08, 0.98);
    const color = opts?.color ?? 0xffc896;
    const duration = Math.max(90, opts?.durationMs ?? 280);

    if (this.scene.textures.exists('fx_soft_glow') && this.tryReserveGlow(0.62 + strength * 0.75)) {
      const bloom = this.scene.add.image(screenX, screenY, 'fx_soft_glow').setDepth(118).setScrollFactor(0);
      bloom.setBlendMode(Phaser.BlendModes.ADD);
      bloom.setTint(color);
      bloom.setAlpha(strength * 0.54 * (this.fxMul < 0.85 ? 0.88 : 1));
      bloom.setScale((cam.width / 64) * 0.23, (cam.height / 64) * 0.21);
      this.scene.tweens.add({
        targets: bloom,
        alpha: 0,
        scaleX: bloom.scaleX * 1.66,
        scaleY: bloom.scaleY * 1.48,
        duration,
        ease: 'Quad.out',
        onComplete: () => {
          bloom.destroy();
          this.releaseGlow(0.62 + strength * 0.75);
        }
      });
    }

    if (this.scene.textures.exists('fx_soft_ring') && this.tryReserveGlow(0.32 + strength * 0.28)) {
      const flashRing = this.scene.add.image(screenX, screenY, 'fx_soft_ring').setDepth(119).setScrollFactor(0);
      flashRing.setBlendMode(Phaser.BlendModes.ADD);
      flashRing.setTint(this.mixColor(color, 0xfff0dc, 0.24));
      flashRing.setAlpha(strength * 0.28 * (this.fxMul < 0.85 ? 0.86 : 1));
      flashRing.setScale((cam.width / 128) * 0.2, (cam.height / 128) * 0.2);
      this.scene.tweens.add({
        targets: flashRing,
        alpha: 0,
        scaleX: flashRing.scaleX * 2.35,
        scaleY: flashRing.scaleY * 2.06,
        duration: Math.max(90, Math.round(duration * 0.82)),
        ease: 'Cubic.out',
        onComplete: () => {
          flashRing.destroy();
          this.releaseGlow(0.32 + strength * 0.28);
        }
      });
    }

    if (this.scene.textures.exists('fx_soft_glow') && this.tryReserveGlow(0.46 + strength * 0.5)) {
      const screenBloom = this.scene.add.image(cam.width * 0.5, cam.height * 0.5, 'fx_soft_glow').setDepth(117).setScrollFactor(0);
      screenBloom.setBlendMode(Phaser.BlendModes.ADD);
      screenBloom.setTint(color);
      screenBloom.setAlpha(strength * 0.11 * (this.fxMul < 0.85 ? 0.8 : 1));
      screenBloom.setScale((cam.width / 64) * 0.42, (cam.height / 64) * 0.4);
      this.scene.tweens.add({
        targets: screenBloom,
        alpha: 0,
        scaleX: screenBloom.scaleX * 1.16,
        scaleY: screenBloom.scaleY * 1.12,
        duration: Math.max(80, Math.round(duration * 0.74)),
        ease: 'Sine.out',
        onComplete: () => {
          screenBloom.destroy();
          this.releaseGlow(0.46 + strength * 0.5);
        }
      });
    }
  }


  private spawnCinematicGlow(
    x: number,
    y: number,
    opts?: {
      radius?: number;
      color?: number;
      alpha?: number;
      durationMs?: number;
      depth?: number;
      scaleMul?: number;
    }
  ) {
    const radius = Math.max(8, opts?.radius ?? 80);
    const color = opts?.color ?? 0xffc787;
    const alpha = Phaser.Math.Clamp(opts?.alpha ?? 0.4, 0, 1);
    const duration = Math.max(120, opts?.durationMs ?? 620);
    const depth = opts?.depth ?? 108;
    const scaleMul = Phaser.Math.Clamp(opts?.scaleMul ?? 2.2, 1.1, 4.0);
    const mobile = this.fxMul < 0.85;

    if (!this.isNearCamera(x, y, radius * 2.4) && alpha <= 0.42) return;

    const warmColor = this.mixColor(color, 0xffb070, 0.26);
    const coreColor = this.mixColor(color, 0xffe8ce, 0.2);
    const coolFringeColor = this.mixColor(color, 0xaed9ff, 0.3);
    const baseCost = Phaser.Math.Clamp((radius / 125) * (0.7 + alpha), 0.35, 2.6);

    if (this.scene.textures.exists('fx_soft_glow')) {
      const baseScale = radius / 32;
      const spawnLayer = (
        tint: number,
        layerAlpha: number,
        sx: number,
        sy: number,
        targetMulX: number,
        targetMulY: number,
        layerDuration: number,
        layerDepth: number,
        costMul: number,
        ease: string,
        rotation: number = 0
      ) => {
        const layerCost = baseCost * costMul;
        if (!this.tryReserveGlow(layerCost)) return;
        const glow = this.scene.add.image(x, y, 'fx_soft_glow').setDepth(layerDepth);
        glow.setBlendMode(Phaser.BlendModes.ADD);
        glow.setTint(tint);
        glow.setAlpha(layerAlpha);
        glow.setScale(sx, sy);
        glow.setRotation(rotation);
        this.scene.tweens.add({
          targets: glow,
          scaleX: sx * targetMulX,
          scaleY: sy * targetMulY,
          alpha: 0,
          duration: layerDuration,
          ease,
          onComplete: () => {
            glow.destroy();
            this.releaseGlow(layerCost);
          }
        });
      };

      spawnLayer(
        warmColor,
        alpha * 0.84,
        baseScale * 0.84,
        baseScale * 0.84,
        scaleMul,
        scaleMul,
        duration,
        depth,
        0.56,
        'Cubic.out'
      );
      spawnLayer(
        color,
        alpha * 0.62,
        baseScale * 0.56,
        baseScale * 0.56,
        scaleMul * 0.9,
        scaleMul * 0.9,
        Math.max(100, Math.round(duration * 0.76)),
        depth + 1,
        0.44,
        'Quad.out'
      );
      spawnLayer(
        coreColor,
        alpha * (mobile ? 0.42 : 0.54),
        baseScale * 0.30,
        baseScale * 0.30,
        scaleMul * 0.66,
        scaleMul * 0.66,
        Math.max(90, Math.round(duration * 0.62)),
        depth + 2,
        0.28,
        'Sine.out'
      );

      if (!mobile) {
        spawnLayer(
          coolFringeColor,
          alpha * 0.26,
          baseScale * 0.42,
          baseScale * 0.24,
          scaleMul * 1.15,
          scaleMul * 0.78,
          Math.max(120, Math.round(duration * 0.92)),
          depth + 1,
          0.22,
          'Sine.out',
          Phaser.Math.FloatBetween(-0.18, 0.18)
        );
      }
      return;
    }

    // No circular fallback: avoids visible semi-transparent circle artifacts on explosion flashes.
    return;
  }

  private tuneAndroidFxBudget(now: number) {
    if (!this.androidDynamicFxEnabled) return;
    if (now < this.lastDynamicFxTuneT + 650) return;
    this.lastDynamicFxTuneT = now;

    const loopAny = (this.scene.game as any)?.loop;
    const fpsRaw = Number(loopAny?.actualFps ?? loopAny?.fps ?? 60);
    const fps = Number.isFinite(fpsRaw) ? fpsRaw : 60;

    let targetScale = 1;
    if (fps < 46) targetScale = 0.58;
    else if (fps < 52) targetScale = 0.68;
    else if (fps < 56) targetScale = 0.78;
    else if (fps < 59) targetScale = 0.88;

    const smooth = Phaser.Math.Linear(this.dynamicFxScale, targetScale, targetScale < this.dynamicFxScale ? 0.34 : 0.14);
    const nextScale = Phaser.Math.Clamp(smooth, 0.55, 1);
    this.dynamicFxScale = nextScale;
    this.dynamicWeatherDensity = Phaser.Math.Clamp(0.55 + nextScale * 0.45, 0.55, 1);

    this.glowBudgetMax = Math.max(6, Math.round(this.baseGlowBudgetMax * nextScale));
    this.maxSoftRingFx = Math.max(2, Math.round(this.baseSoftRingFx * nextScale));
    this.fxMul = Phaser.Math.Clamp(this.baseFxMul * (0.82 + 0.18 * nextScale), this.baseFxMul * 0.78, this.baseFxMul);
  }

  private destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off('combat-damage', this.onCombatDamage, this);
    this.scene.events.off('update', this.update, this);
    this.destroyCinematicGrade();
    this.activeMgTracers.forEach(t => { t.outer.destroy(); t.core.destroy(); });
    this.mgTracerOuterPool.forEach(l => l.destroy());
    this.mgTracerCorePool.forEach(l => l.destroy());
    for (const t of this.activeShellTrails) for (const m of t.managers) m.destroy();
    for (const o of this.activeWeatherObjects) (o as any)?.destroy?.();
    this.activeMgTracers = [];
    this.activeWindEmitters = [];
    this.activeWeatherObjects = [];
    this.activeShellTrails = [];
    this.mgTracerOuterPool = [];
    this.mgTracerCorePool = [];
  }

  private update() {
    if (this.destroyed) return;
    const now = this.scene.time.now;
    this.tuneAndroidFxBudget(now);

    this.updateMgTracers();
    this.updateShellTrails();
    this.updateCinematicGrade();

    if (now > this.lastWindUpdateT + 250) {
        this.lastWindUpdateT = now;
        for (let i = this.activeWindEmitters.length - 1; i >= 0; i--) {
          const e = this.activeWindEmitters[i];
          if (!e.emitter || !e.emitter.active) {
            this.activeWindEmitters.splice(i, 1);
            continue;
          }
          const wind = this.scene.getWindAt(e.y);
          e.emitter.accelerationX = wind * e.factor;
          if (e.kind === 'sandstorm') {
            const k = Phaser.Math.Clamp(Math.abs(wind) / 260, 0, 1);
            const density = this.dynamicWeatherDensity;
            if (typeof e.baseFrequency === 'number') {
              const f = e.baseFrequency / ((0.75 + 1.35 * k) * Math.max(0.55, density));
              e.emitter.frequency = Math.max(e.minFrequency ?? 4, f);
            }
            if (typeof e.baseQuantity === 'number') {
              const q = Math.round(e.baseQuantity * (0.9 + 0.9 * k) * density);
              e.emitter.quantity = Math.min(e.maxQuantity ?? 6, Math.max(1, q));
            }
          }
        }
    }

    if (this.activeSandstorm && now > this.activeSandstorm.until) this.activeSandstorm = null;
    if (this.activeRain && now > this.activeRain.until) this.activeRain = null;
    if (this.forestRainFx && now < this.forestRainFx.until) this.updateForestRainFx();
    if (this.blackRainFx && now < this.blackRainFx.until) this.updateBlackRainFx();
    if (this.activeSandstorm && now < this.activeSandstorm.until) this.updateSandstormFx();
  }

  private getWeatherAnchorCenterX(): number {
    const px = (this.scene as any)?.player?.chassis?.x as number | undefined;
    if (typeof px === 'number' && Number.isFinite(px)) return px;
    return this.scene.cameras.main.worldView.centerX;
  }

  private getWeatherAnchorSpanX(): number {
    const cam = this.scene.cameras.main;
    const baseZoom = Phaser.Math.Clamp((this.scene as any)?.defaultZoom ?? cam.zoom ?? 0.8, 0.1, 1.5);
    const minZoom = Math.max(0.1, baseZoom * 0.55);
    return cam.width / Math.max(0.0001, minZoom);
  }

  private updateWindEmitterY(emitter: Phaser.GameObjects.Particles.ParticleEmitter | undefined | null, y: number) {
    if (!emitter) return;
    for (const e of this.activeWindEmitters) {
      if (e.emitter === emitter) {
        e.y = y;
        return;
      }
    }
  }

  private updateForestRainFx() {
    if (!this.forestRainFx) return;
    const fx = this.forestRainFx;
    const now = this.scene.time.now;
    if (now > fx.until) return;
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    const centerX = this.getWeatherAnchorCenterX();
    const spanX = this.getWeatherAnchorSpanX();
    const half = spanX * 0.5;

    const yMin = view.y - 60;
    const yMax = view.bottom - 100;
    const yMid = (yMin + yMax) * 0.5;

    fx.dropsRect.setTo(centerX - half - 200, yMin, spanX + 400, Math.max(1, yMax - yMin));
    fx.mistRect.setTo(centerX - half - 260, view.bottom - 260, spanX + 520, 200);
    this.updateWindEmitterY(fx.dropsEmitter, yMid);
    this.updateWindEmitterY(fx.mistEmitter, yMid);

    if (this.androidDynamicFxEnabled) {
      const density = this.dynamicWeatherDensity;
      fx.dropsEmitter.frequency = Math.max(2, this.f(5) / Math.max(0.55, density));
      fx.dropsEmitter.quantity = Math.max(1, Math.round(this.q(2) * density));
      fx.mistEmitter.frequency = Math.max(80, this.f(320) / Math.max(0.6, density));
      fx.mistEmitter.quantity = Math.max(1, Math.round(this.q(2) * density));
    }
  }

  private updateBlackRainFx() {
    if (!this.blackRainFx) return;
    const fx = this.blackRainFx;
    const now = this.scene.time.now;
    if (now > fx.until) return;
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    const centerX = this.getWeatherAnchorCenterX();
    const spanX = this.getWeatherAnchorSpanX();
    const half = spanX * 0.5;

    const yMin = view.y - 40;
    const yMax = view.bottom - 80;
    const yMid = (yMin + yMax) * 0.5;

    fx.dropsRect.setTo(centerX - half - 240, yMin, spanX + 480, Math.max(1, yMax - yMin));
    fx.mistRect.setTo(centerX - half - 320, view.bottom - 290, spanX + 640, 260);
    this.updateWindEmitterY(fx.dropsEmitter, yMid);
    this.updateWindEmitterY(fx.mistEmitter, yMid);

    if (this.androidDynamicFxEnabled) {
      const density = this.dynamicWeatherDensity;
      fx.dropsEmitter.frequency = Math.max(2, this.f(4) / Math.max(0.55, density));
      fx.dropsEmitter.quantity = Math.max(1, Math.round(this.q(3) * density));
      fx.mistEmitter.frequency = Math.max(80, this.f(300) / Math.max(0.6, density));
      fx.mistEmitter.quantity = Math.max(1, Math.round(this.q(3) * density));
    }
  }

  private updateSandstormFx() {
    if (!this.sandstormFx) return;
    const fx = this.sandstormFx;
    const now = this.scene.time.now;
    if (now > fx.until) return;
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    const centerX = this.getWeatherAnchorCenterX();
    const spanX = this.getWeatherAnchorSpanX();
    const half = spanX * 0.5;

    const yMin = view.bottom - 220;
    const yMax = view.bottom - 20;
    const yMid = (yMin + yMax) * 0.5;
    const wind = this.scene.getWindAt(yMid);
    const baseX = wind >= 0 ? centerX - half - 260 : centerX + half + 260;

    fx.streakRect.setTo(baseX - 30, yMin, 60, Math.max(1, yMax - yMin));
    fx.grainRect.setTo(baseX - 60, yMin, 120, Math.max(1, (yMax + 60) - yMin));
    fx.hazeRect.setTo(centerX - half - 420, view.y, spanX + 840, Math.max(1, view.height));
    this.updateWindEmitterY(fx.streakEmitter, yMid);
    this.updateWindEmitterY(fx.grainEmitter, yMid);
  }

  private updateMgTracers() {
    const now = this.scene.time.now;
    for (let i = this.activeMgTracers.length - 1; i >= 0; i--) {
      const t = this.activeMgTracers[i];
      if (now >= t.end) {
        t.outer.setVisible(false);
        t.core.setVisible(false);
        this.mgTracerOuterPool.push(t.outer);
        this.mgTracerCorePool.push(t.core);
        this.activeMgTracers.splice(i, 1);
        continue;
      }
      const k = (t.end - now) / (t.end - t.start);
      t.outer.setAlpha(0.22 * k);
      t.core.setAlpha(0.85 * k);
    }
  }

  private spawnShellTracer(
    shell: Phaser.GameObjects.Sprite,
    t: {
      tracerOuter: number;
      tracerCore: number;
      tracerGlow: number;
      tracerOuterWidth: number;
      tracerCoreWidth: number;
      tracerGlowWidth: number;
      tracerOuterAlpha: number;
      tracerCoreAlpha: number;
      tracerGlowAlpha: number;
      tracerLenMult: number;
      tracerLenMin: number;
      tracerLenMax: number;
    }
  ) {
    const a = (shell as any).rotation ?? 0;
    const body = shell.body as Phaser.Physics.Arcade.Body | undefined;
    const vx = body?.velocity?.x ?? Math.cos(a) * 1200;
    const vy = body?.velocity?.y ?? Math.sin(a) * 1200;
    const sp = Math.sqrt(vx * vx + vy * vy);
    const len = Phaser.Math.Clamp(sp * t.tracerLenMult, t.tracerLenMin, t.tracerLenMax);
    const sx = shell.x - Math.cos(a) * len;
    const sy = shell.y - Math.sin(a) * len;

    const targets: Phaser.GameObjects.GameObject[] = [];

    if (t.tracerGlowWidth > 0 && t.tracerGlowAlpha > 0) {
      const glow = this.scene.add.line(0, 0, 0, 0, 0, 0, t.tracerGlow, t.tracerGlowAlpha).setOrigin(0).setDepth(29) as any;
      glow.setTo(sx, sy, shell.x, shell.y);
      if (glow.setStrokeStyle) glow.setStrokeStyle(t.tracerGlowWidth, t.tracerGlow, t.tracerGlowAlpha);
      if (glow.setLineWidth) glow.setLineWidth(t.tracerGlowWidth);
      glow.setBlendMode(Phaser.BlendModes.ADD);
      targets.push(glow);
    }

    if (t.tracerOuterWidth > 0 && t.tracerOuterAlpha > 0) {
      const outer = this.scene.add.line(0, 0, 0, 0, 0, 0, t.tracerOuter, t.tracerOuterAlpha).setOrigin(0).setDepth(30) as any;
      outer.setTo(sx, sy, shell.x, shell.y);
      if (outer.setStrokeStyle) outer.setStrokeStyle(t.tracerOuterWidth, t.tracerOuter, t.tracerOuterAlpha);
      if (outer.setLineWidth) outer.setLineWidth(t.tracerOuterWidth);
      outer.setBlendMode(Phaser.BlendModes.ADD);
      targets.push(outer);
    }

    if (t.tracerCoreWidth > 0 && t.tracerCoreAlpha > 0) {
      const core = this.scene.add.line(0, 0, 0, 0, 0, 0, t.tracerCore, t.tracerCoreAlpha).setOrigin(0).setDepth(31) as any;
      core.setTo(sx, sy, shell.x, shell.y);
      if (core.setStrokeStyle) core.setStrokeStyle(t.tracerCoreWidth, t.tracerCore, t.tracerCoreAlpha);
      if (core.setLineWidth) core.setLineWidth(t.tracerCoreWidth);
      core.setBlendMode(Phaser.BlendModes.ADD);
      targets.push(core);
    }

    if (targets.length === 0) return;
    this.scene.tweens.add({
      targets: targets as any,
      alpha: 0,
      duration: 160,
      ease: 'Quad.out',
      onComplete: () => targets.forEach(o => o.destroy())
    });
  }

  private spawnShellAirStreak(shell: Phaser.GameObjects.Sprite, color: number, alpha: number) {
    const a = (shell as any).rotation ?? 0;
    const r = this.scene.add.ellipse(shell.x, shell.y, 10, 34, color, alpha).setRotation(a).setDepth(27) as any;
    r.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({ targets: r, scaleX: 2.4, scaleY: 3.8, alpha: 0, duration: 240, ease: 'Quad.out', onComplete: () => r.destroy() });
  }

  private updateShellTrails() {
    const now = this.scene.time.now;
    for (let i = this.activeShellTrails.length - 1; i >= 0; i--) {
      const t = this.activeShellTrails[i];
      const shell = t.shell;
      if (!shell?.active) {
        for (const m of t.managers) m.destroy();
        this.activeShellTrails.splice(i, 1);
        continue;
      }

      const waterY = this.scene.getWaterSurfaceY(shell.x);
      const inWater = !!shell.getData('inWater') || (waterY !== null && shell.y > waterY + 2);
      if (inWater) {
        for (const m of t.managers) m.destroy();
        this.activeShellTrails.splice(i, 1);
        continue;
      }

      const a = (shell as any).rotation ?? 0;
      const body = shell.body as Phaser.Physics.Arcade.Body | undefined;
      const vx = body?.velocity?.x ?? Math.cos(a) * 1200;
      const vy = body?.velocity?.y ?? Math.sin(a) * 1200;
      const sp = Math.sqrt(vx * vx + vy * vy);
      const dirAng = sp > 0.1 ? Math.atan2(vy, vx) : a;
      const k = Phaser.Math.Clamp(sp / 1750, 0.65, 1.25);
      const spN = Phaser.Math.Clamp((sp - 650) / 1200, 0, 1);

      t.microGlintA.setPosition(shell.x, shell.y).setRotation(a).setScale(0.22 * t.baseScale * k);
      t.microGlintB.setPosition(shell.x, shell.y).setRotation(a).setScale(0.12 * t.baseScale * k);
      if (t.stype === ShellType.AP) {
        t.microGlintA.setAlpha(0.07 + spN * 0.1);
        t.microGlintB.setAlpha(0.05 + spN * 0.07);
      }

      if (t.glowHalo || t.glowCore) {
        const back = (8 + 14 * k) * t.baseScale;
        t.glowHalo?.setPosition(shell.x - Math.cos(a) * back, shell.y - Math.sin(a) * back).setRotation(a).setScale(k);
        t.glowCore?.setPosition(shell.x - Math.cos(a) * (back * 0.75), shell.y - Math.sin(a) * (back * 0.75)).setRotation(a).setScale(k);
      }

      if (t.apReflectA && t.apReflectB && t.apHeat && t.apShock) {
        const wave = (Math.sin(now * 0.03 + shell.x * 0.01) + 1) * 0.5;
        const wave2 = (Math.sin(now * 0.023 + shell.y * 0.012 + 1.4) + 1) * 0.5;
        const back = (16 + 22 * k) * t.baseScale;
        t.apReflectA
          .setPosition(shell.x, shell.y)
          .setRotation(a + (wave - 0.5) * 0.12)
          .setScale((0.9 + wave * 0.7) * t.baseScale * k, (0.7 + wave2 * 0.5) * t.baseScale)
          .setAlpha((0.075 + wave * 0.06) * spN);
        t.apReflectB
          .setPosition(shell.x, shell.y)
          .setRotation(a + (wave2 - 0.5) * 0.08)
          .setScale((0.7 + wave2 * 0.8) * t.baseScale * k, (0.7 + wave * 0.5) * t.baseScale)
          .setAlpha((0.04 + wave2 * 0.04) * spN);
        t.apHeat
          .setPosition(shell.x - Math.cos(a) * back, shell.y - Math.sin(a) * back)
          .setRotation(a)
          .setScale((0.95 + wave2 * 0.7) * t.baseScale * k, (0.85 + wave * 0.75) * t.baseScale)
          .setAlpha((0.03 + wave * 0.03) * spN);
        t.apShock
          .setPosition(shell.x - Math.cos(a) * (back * 1.15), shell.y - Math.sin(a) * (back * 1.15))
          .setRotation(a)
          .setScale((0.8 + wave * 0.55) * t.baseScale * k, (0.7 + wave2 * 0.6) * t.baseScale)
          .setAlpha((0.028 + wave2 * 0.03) * spN);
      }

      if (t.apRedLine) {
        const len = (22 + 34 * k) * t.baseScale;
        const x0 = shell.x - Math.cos(dirAng) * len;
        const y0 = shell.y - Math.sin(dirAng) * len;
        t.apRedLine.clear();
        t.apRedLine.lineStyle(Math.max(1, 2.6 * t.baseScale), 0x5a0012, 0.62);
        t.apRedLine.beginPath();
        t.apRedLine.moveTo(x0, y0);
        t.apRedLine.lineTo(shell.x, shell.y);
        t.apRedLine.strokePath();
      }

      if (t.tracerEveryMs > 0 && now >= t.lastTracerT + t.tracerEveryMs) {
        t.lastTracerT = now;
        this.spawnShellTracer(shell, t);
      }

      if (t.airEveryMs > 0 && t.airAlpha > 0 && now >= t.lastAirT + t.airEveryMs) {
        t.lastAirT = now;
        this.spawnShellAirStreak(shell, t.airColor, t.airAlpha);
      }
    }
  }

  private trackWeatherObject(obj: Phaser.GameObjects.GameObject | undefined | null) {
    if (!obj) return;
    this.activeWeatherObjects.push(obj);
    (obj as any).once?.(Phaser.GameObjects.Events.DESTROY, () => {
      const idx = this.activeWeatherObjects.indexOf(obj);
      if (idx >= 0) this.activeWeatherObjects.splice(idx, 1);
    });
  }

  private applyWindToEmitter(
    emitter: any,
    y: number,
    factor: number,
    meta?: {
      kind?: 'sandstorm' | 'fog' | 'rain' | 'other';
      baseFrequency?: number;
      baseQuantity?: number;
      minFrequency?: number;
      maxQuantity?: number;
    }
  ) {
    if (!emitter) return;
    this.activeWindEmitters.push({ emitter, y, factor, ...(meta ?? {}) });
    emitter.accelerationX = this.scene.getWindAt(y) * factor;
  }

  private ensureWeatherTextures() {
    const g = this.scene.add.graphics({ x: 0, y: 0 });
    g.setVisible(false);

    if (!this.scene.textures.exists('fx_sand_grain')) {
      g.clear();
      for (let i = 0; i < 18; i++) {
        const x = Phaser.Math.Between(1, 14);
        const y = Phaser.Math.Between(1, 14);
        const w = Phaser.Math.Between(1, 3);
        const h = Phaser.Math.Between(1, 2);
        g.fillStyle(0xffffff, Phaser.Math.FloatBetween(0.25, 0.9));
        g.fillRect(x, y, w, h);
      }
      g.generateTexture('fx_sand_grain', 16, 16);
    }

    for (let i = 0; i < 3; i++) {
      const key = `fx_sand_streak_${i}`;
      if (this.scene.textures.exists(key)) continue;
      const w = 64;
      const h = 18;
      g.clear();
      for (let s = 0; s < 14; s++) {
        const y = 3 + s + Phaser.Math.Between(-1, 1);
        const x0 = Phaser.Math.Between(0, 18);
        const x1 = Phaser.Math.Between(34, 64);
        const thick = Phaser.Math.Between(1, 3);
        const a = Phaser.Math.FloatBetween(0.10, 0.30);
        g.fillStyle(0xffffff, a);
        g.fillRect(x0, y, x1 - x0, thick);
        if (Math.random() < 0.5) g.fillRect(Phaser.Math.Between(0, 30), y + Phaser.Math.Between(-2, 2), Phaser.Math.Between(6, 14), 1);
      }
      for (let d = 0; d < 26; d++) {
        g.fillStyle(0xffffff, Phaser.Math.FloatBetween(0.06, 0.22));
        g.fillRect(Phaser.Math.Between(0, w - 1), Phaser.Math.Between(0, h - 1), 1, 1);
      }
      g.generateTexture(key, w, h);
    }

    for (let i = 0; i < 3; i++) {
      const key = `fx_fog_wisp_${i}`;
      if (this.scene.textures.exists(key)) continue;
      const r = (() => {
        let t = (1337 + i * 97) >>> 0;
        return () => {
          t += 0x6d2b79f5;
          let x = t;
          x = Math.imul(x ^ (x >>> 15), x | 1);
          x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
          return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
        };
      })();
      const w = 100 + Math.floor(r() * 60);
      const h = 44 + Math.floor(r() * 34);
      g.clear();
      g.fillStyle(0xffffff, 0.52);
      g.fillEllipse(w * 0.5, h * 0.6, w * 0.76, h * 0.56);
      const blobs = 12 + Math.floor(r() * 10);
      for (let b = 0; b < blobs; b++) {
        const cx = Math.floor(r() * w);
        const cy = Math.floor(r() * (h * 0.55)) + Math.floor(h * 0.25);
        const ew = 24 + Math.floor(r() * 68);
        const eh = 12 + Math.floor(r() * 30);
        g.fillEllipse(cx, cy, ew, eh);
      }
      g.generateTexture(key, w, h);
    }

    g.destroy();
  }

  private createVolumeSmoke(x: number, y: number, radius: number, darkness: number, durationMs: number) {
    const windFactor = 0.32 + Math.min(0.32, radius / 700);
    const tintA = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0x9aa3aa),
      Phaser.Display.Color.ValueToColor(0x0a0a0a),
      1,
      darkness
    );
    const tintB = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(0x6b737a),
      Phaser.Display.Color.ValueToColor(0x000000),
      1,
      Math.min(1, darkness + 0.15)
    );
    const t1 = Phaser.Display.Color.GetColor(tintA.r, tintA.g, tintA.b);
    const t2 = Phaser.Display.Color.GetColor(tintB.r, tintB.g, tintB.b);

    const core = this.scene.add.particles(x, y, 'smoke_puff', {
      speed: { min: 20, max: 120 },
      angle: { min: 235, max: 305 },
      scale: { start: Math.max(1.0, radius * 0.008), end: Math.max(4.2, radius * 0.021) },
      alpha: { start: 0.20, end: 0 },
      lifespan: { min: Math.max(2200, durationMs * 0.45), max: Math.max(4200, durationMs * 0.75) },
      quantity: Math.round(8 + radius * 0.015),
      emitting: false,
      tint: [t1, t2],
      gravityY: -120
    }).setDepth(90);
    core.explode();
    this.applyWindToEmitter(core as any, y, windFactor);

    const mid = this.scene.add.particles(x, y, 'smoke_puff', {
      speed: { min: 10, max: 70 },
      angle: { min: 0, max: 360 },
      scale: { start: Math.max(0.9, radius * 0.006), end: Math.max(3.2, radius * 0.015) },
      alpha: { start: 0.14, end: 0 },
      lifespan: { min: Math.max(1800, durationMs * 0.4), max: Math.max(3600, durationMs * 0.65) },
      quantity: Math.round(5 + radius * 0.01),
      emitting: false,
      tint: [t2, t1],
      gravityY: -80
    }).setDepth(88);
    mid.explode();
    this.applyWindToEmitter(mid as any, y, windFactor * 0.85);

    const haze = this.scene.add.particles(x, y, 'smoke_puff', {
      speed: { min: 6, max: 40 },
      angle: { min: 0, max: 360 },
      scale: { start: Math.max(3.0, radius * 0.013), end: Math.max(8.0, radius * 0.03) },
      alpha: { start: 0.08, end: 0 },
      lifespan: { min: Math.max(3600, durationMs * 0.6), max: Math.max(6400, durationMs * 1.0) },
      quantity: Math.round(2 + radius * 0.006),
      emitting: false,
      tint: [t1],
      gravityY: -40
    }).setDepth(86);
    haze.explode();
    this.applyWindToEmitter(haze as any, y, windFactor * 0.65);

    this.scene.time.delayedCall(Math.max(8500, durationMs + 2500), () => {
        core.destroy();
        mid.destroy();
        haze.destroy();
    });
  }

  public createSandstorm(until?: number) {
    const duration = until ?? (this.scene.time.now + 15000);
    this.createSandstormFx(duration);
  }

  public createSandstormFx(until: number) {
    if (this.activeSandstorm && this.activeSandstorm.until >= until) return;
    this.activeSandstorm = { until };

    const durationMs = until - this.scene.time.now;
    const blowing = this.createDesertBlowingSand(durationMs);

    this.ensureWeatherTextures();
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    const centerX = this.getWeatherAnchorCenterX();
    const spanX = this.getWeatherAnchorSpanX();
    const half = spanX * 0.5;
    const hazeRect = new Phaser.Geom.Rectangle(centerX - half - 420, view.y, spanX + 840, Math.max(1, view.height));
    
    const windSpeed = this.scene.getWindAt(view.centerY) * 1.5;

    const haze = this.scene.add.particles(0, 0, 'smoke_puff', {
      emitZone: { type: 'random', source: hazeRect },
      lifespan: { min: 4000, max: 6000 },
      frequency: this.f(50),
      quantity: this.q(4),
      scale: { start: 2.0, end: 3.5 },
      alpha: { start: 0.4, end: 0 },
      rotate: { min: 0, max: 360 },
      tint: [0xd7c3a2, 0xcbb48d, 0xe2d6bf],
      speedX: { min: windSpeed - 50, max: windSpeed + 50 },
      speedY: { min: -20, max: 20 },
      emitting: true
    }).setDepth(100);
    this.trackWeatherObject(haze);
    const hazeEmitter = haze;

    this.sandstormFx = {
      until,
      streaks: blowing.streaks,
      grains: blowing.grains,
      haze,
      streakEmitter: blowing.streakEmitter,
      grainEmitter: blowing.grainEmitter,
      hazeEmitter,
      streakRect: blowing.streakRect,
      grainRect: blowing.grainRect,
      hazeRect
    };
    this.updateSandstormFx();

    const stopDelay = Math.max(800, durationMs);
    this.scene.time.delayedCall(stopDelay, () => {
      if (!this.sandstormFx || this.sandstormFx.until !== until) return;
      try {
        this.sandstormFx.streakEmitter?.stop?.();
        this.sandstormFx.grainEmitter?.stop?.();
        this.sandstormFx.hazeEmitter?.stop?.();
      } catch {}
    });
    this.scene.time.delayedCall(stopDelay + 6200, () => {
      if (!this.sandstormFx || this.sandstormFx.until !== until) return;
      try { this.sandstormFx.streaks.destroy(); } catch {}
      try { this.sandstormFx.grains.destroy(); } catch {}
      try { this.sandstormFx.haze.destroy(); } catch {}
      this.sandstormFx = null;
    });
  }

  public isSandstormActive(): boolean {
    return !!this.activeSandstorm && this.scene.time.now < this.activeSandstorm.until;
  }

  public createDesertBlowingSand(durationMs: number) {
    this.ensureWeatherTextures();
    const cam = this.scene.cameras.main;
    const view = cam.worldView;

    const yMin = view.bottom - 220;
    const yMax = view.bottom - 20;
    const yMid = (yMin + yMax) * 0.5;
    const wind = this.scene.getWindAt(yMid);
    const baseX = wind >= 0 ? view.x - 260 : view.right + 260;
    const streakRect = new Phaser.Geom.Rectangle(baseX - 30, yMin, 60, Math.max(1, yMax - yMin));
    const grainRect = new Phaser.Geom.Rectangle(baseX - 60, yMin, 120, Math.max(1, (yMax + 60) - yMin));

    const streakKey = `fx_sand_streak_${Phaser.Math.Between(0, 2)}`;
    const streaks = this.scene.add.particles(0, 0, streakKey, {
      emitZone: { type: 'random', source: streakRect },
      lifespan: { min: 1100, max: 2200 },
      frequency: this.f(18),
      quantity: this.q(2),
      scale: { start: 0.55, end: 0.18 },
      alpha: { start: 0.30, end: 0 },
      rotate: { min: -18, max: 18 },
      tint: [0xf2e6c9, 0xe4d3ad, 0xd5c29a],
      speedX: { min: wind * 0.28 - 70, max: wind * 0.28 + 50 },
      speedY: { min: -14, max: 22 }
    }).setDepth(84);
    this.trackWeatherObject(streaks);
    const streakEmitter = streaks as any;
    this.applyWindToEmitter(streakEmitter as any, yMid, 1.25, { kind: 'sandstorm', baseFrequency: this.f(18), baseQuantity: this.q(2), minFrequency: this.f(6), maxQuantity: this.q(4) });

    const grains = this.scene.add.particles(0, 0, 'fx_sand_grain', {
      emitZone: { type: 'random', source: grainRect },
      lifespan: { min: 800, max: 1800 },
      frequency: this.f(10),
      quantity: this.q(2),
      scale: { start: 0.85, end: 0.20 },
      alpha: { start: 0.40, end: 0 },
      rotate: { min: 0, max: 360 },
      tint: [0xf7f0de, 0xe6d7b8, 0xdbc79d],
      speedX: { min: wind * 0.24 - 50, max: wind * 0.24 + 40 },
      speedY: { min: -44, max: 60 }
    }).setDepth(82);
    this.trackWeatherObject(grains);
    const grainEmitter = grains as any;
    this.applyWindToEmitter(grainEmitter as any, yMid, 1.05, { kind: 'sandstorm', baseFrequency: this.f(10), baseQuantity: this.q(2), minFrequency: this.f(4), maxQuantity: this.q(4) });

    const stopDelay = Math.max(800, durationMs);
    this.scene.time.delayedCall(stopDelay, () => { streakEmitter?.stop?.(); grainEmitter?.stop?.(); });
    this.scene.time.delayedCall(stopDelay + 2600, () => { streaks.destroy(); grains.destroy(); });
    return { streaks, grains, streakEmitter, grainEmitter, streakRect, grainRect };
  }

  public createForestFog(durationMs: number) {
    this.ensureWeatherTextures();
    const cam = this.scene.cameras.main;
    const view = cam.worldView;

    const yMin = view.bottom - 420;
    const yMax = view.bottom - 120;
    const yMid = (yMin + yMax) * 0.5;

    const mkKey = () => this.scene.textures.exists('cloud_0')
      ? `cloud_${Phaser.Math.Between(0, 9)}`
      : `fx_fog_wisp_${Phaser.Math.Between(0, 2)}`;

    const layerA = this.scene.add.particles(0, 0, mkKey(), {
      x: { min: view.x - 260, max: view.right + 260 },
      y: { min: yMin, max: yMax },
      lifespan: { min: Math.max(5200, durationMs * 0.55), max: Math.max(9800, durationMs * 0.95) },
      frequency: this.f(520),
      quantity: this.q(1),
      scale: { start: 0.42, end: 0.92 },
      alpha: { start: 0.10, end: 0 },
      rotate: { min: 0, max: 360 },
      tint: [0xc9d3cf, 0xaebbb5, 0xdee6e3],
      speedX: { min: -10, max: 10 },
      speedY: { min: -5, max: 5 }
    }).setDepth(62);
    this.trackWeatherObject(layerA);
    this.applyWindToEmitter(layerA as any, yMid, 0.12);

    const layerB = this.scene.add.particles(0, 0, mkKey(), {
      x: { min: view.x - 300, max: view.right + 300 },
      y: { min: yMin - 80, max: yMax - 40 },
      lifespan: { min: Math.max(6400, durationMs * 0.65), max: Math.max(11800, durationMs * 1.05) },
      frequency: this.f(780),
      quantity: this.q(1),
      scale: { start: 0.58, end: 1.18 },
      alpha: { start: 0.085, end: 0 },
      rotate: { min: 0, max: 360 },
      tint: [0xc4cec9, 0xb5c2bd, 0xe2e9e6],
      speedX: { min: -8, max: 8 },
      speedY: { min: -4, max: 4 }
    }).setDepth(64);
    this.trackWeatherObject(layerB);
    this.applyWindToEmitter(layerB as any, yMid - 60, 0.09);

    const stopDelay = Math.max(1200, durationMs);
    this.scene.time.delayedCall(stopDelay, () => { (layerA as any)?.stop?.(); (layerB as any)?.stop?.(); });
    this.scene.time.delayedCall(stopDelay + 13200, () => { layerA.destroy(); layerB.destroy(); });
  }

  public createForestRain(durationMs: number) {
    this.ensureWeatherTextures();
    const cam = this.scene.cameras.main;
    const view = cam.worldView;

    const yMin = view.y - 60;
    const yMax = view.bottom - 100;
    const yMid = (yMin + yMax) * 0.5;
    const wind = this.scene.getWindAt(yMid);
    const centerX = this.getWeatherAnchorCenterX();
    const spanX = this.getWeatherAnchorSpanX();
    const half = spanX * 0.5;
    const dropsRect = new Phaser.Geom.Rectangle(centerX - half - 200, yMin, spanX + 400, Math.max(1, yMax - yMin));
    const mistRect = new Phaser.Geom.Rectangle(centerX - half - 260, view.bottom - 260, spanX + 520, 200);

    const drops = this.scene.add.particles(0, 0, 'fx_sand_grain', {
      emitZone: { type: 'random', source: dropsRect },
      lifespan: { min: 580, max: 1080 },
      frequency: this.f(5),
      quantity: this.q(2),
      scale: { start: 0.85, end: 0.22 },
      alpha: { start: 1, end: 0 },
      rotate: { min: 80, max: 100 },
      tint: [0xd8efff, 0xb6ddff, 0x92caff],
      speedX: { min: wind * 0.32 - 46, max: wind * 0.32 + 46 },
      speedY: { min: 820, max: 1260 }
    }).setDepth(90);
    this.trackWeatherObject(drops);
    const dropsEmitter = drops as any;
    this.applyWindToEmitter(dropsEmitter as any, yMid, 0.85, { kind: 'rain' });

    const mist = this.scene.add.particles(0, 0, `fx_fog_wisp_${Phaser.Math.Between(0, 2)}`, {
      emitZone: { type: 'random', source: mistRect },
      lifespan: { min: 3200, max: 6400 },
      frequency: this.f(320),
      quantity: this.q(2),
      scale: { start: 0.58, end: 1.15 },
      alpha: { start: 0.26, end: 0 },
      rotate: { min: 0, max: 360 },
      tint: [0xbad0df, 0xa7bfd1, 0xcfe0ea],
      speedX: { min: -22, max: 22 },
      speedY: { min: -14, max: 14 }
    }).setDepth(80);
    this.trackWeatherObject(mist);
    const mistEmitter = mist as any;
    this.applyWindToEmitter(mistEmitter as any, yMid, 0.16, { kind: 'rain' });

    const stopDelay = Math.max(1200, durationMs);
    this.activeRain = { until: this.scene.time.now + stopDelay };
    this.forestRainFx = {
      until: this.scene.time.now + stopDelay,
      drops,
      mist,
      dropsEmitter: dropsEmitter as any,
      mistEmitter: mistEmitter as any,
      dropsRect,
      mistRect
    };
    this.updateForestRainFx();
    this.scene.time.delayedCall(stopDelay, () => { dropsEmitter?.stop?.(); mistEmitter?.stop?.(); });
    this.scene.time.delayedCall(stopDelay + 6200, () => {
      if (this.forestRainFx && this.forestRainFx.until <= this.scene.time.now) this.forestRainFx = null;
      drops.destroy();
      mist.destroy();
    });
  }

  public createBlackRain(centerX: number, radius: number, durationMs: number) {
    this.ensureWeatherTextures();
    const cam = this.scene.cameras.main;
    const view = cam.worldView;

    const yMin = view.y - 40;
    const yMax = view.bottom - 80;
    const yMid = (yMin + yMax) * 0.5;
    const wind = this.scene.getWindAt(yMid);
    const anchorX = this.getWeatherAnchorCenterX();
    const spanX = this.getWeatherAnchorSpanX();
    const half = spanX * 0.5;
    const dropsRect = new Phaser.Geom.Rectangle(anchorX - half - 240, yMin, spanX + 480, Math.max(1, yMax - yMin));
    const mistRect = new Phaser.Geom.Rectangle(anchorX - half - 320, view.bottom - 290, spanX + 640, 260);

    const drops = this.scene.add.particles(0, 0, 'fx_sand_grain', {
      emitZone: { type: 'random', source: dropsRect },
      lifespan: { min: 620, max: 1180 },
      frequency: this.f(4),
      quantity: this.q(3),
      scale: { start: 0.95, end: 0.26 },
      alpha: { start: 1, end: 0 },
      rotate: { min: 80, max: 100 },
      tint: [0x222222, 0x000000, 0x333333],
      speedX: { min: wind * 0.28 - 42, max: wind * 0.28 + 42 },
      speedY: { min: 880, max: 1320 }
    }).setDepth(92);
    this.trackWeatherObject(drops);
    const dropsEmitter = drops as any;
    this.applyWindToEmitter(dropsEmitter as any, yMid, 0.9);

    const mist = this.scene.add.particles(0, 0, `fx_fog_wisp_${Phaser.Math.Between(0, 2)}`, {
      emitZone: { type: 'random', source: mistRect },
      lifespan: { min: 3600, max: 7200 },
      frequency: this.f(300),
      quantity: this.q(3),
      scale: { start: 0.7, end: 1.35 },
      alpha: { start: 0.32, end: 0 },
      rotate: { min: 0, max: 360 },
      tint: [0x111111, 0x000000, 0x222222],
      speedX: { min: -18, max: 18 },
      speedY: { min: -16, max: 16 }
    }).setDepth(82);
    this.trackWeatherObject(mist);
    const mistEmitter = mist as any;
    this.applyWindToEmitter(mistEmitter as any, yMid, 0.2);

    const stopDelay = Math.max(1200, durationMs);
    this.activeRain = { until: this.scene.time.now + stopDelay };
    if (this.blackRainFx && this.blackRainFx.until > this.scene.time.now) {
      const prev = this.blackRainFx;
      (prev.dropsEmitter as any)?.stop?.();
      (prev.mistEmitter as any)?.stop?.();
      prev.drops.destroy();
      prev.mist.destroy();
      this.blackRainFx = null;
    }
    this.blackRainFx = {
      until: this.scene.time.now + stopDelay,
      drops,
      mist,
      dropsEmitter: dropsEmitter as any,
      mistEmitter: mistEmitter as any,
      dropsRect,
      mistRect
    };
    this.updateBlackRainFx();
    this.scene.time.delayedCall(stopDelay, () => { dropsEmitter?.stop?.(); mistEmitter?.stop?.(); });
    this.scene.time.delayedCall(stopDelay + 7200, () => {
      if (this.blackRainFx && this.blackRainFx.until <= this.scene.time.now) this.blackRainFx = null;
      drops.destroy();
      mist.destroy();
    });
  }

  public isRainActive(): boolean {
    return !!this.activeRain && this.scene.time.now < this.activeRain.until;
  }

  public createMudSplash(x: number, y: number, strength: number) {
    const qty = Math.round(10 + strength * 0.035);
    const droplets = this.scene.add.particles(x, y, 'spark', {
      speed: { min: 160, max: 520 + strength * 0.45 },
      angle: { min: 220, max: 320 },
      scale: { start: 2.2, end: 0 },
      lifespan: { min: 380, max: 820 },
      quantity: qty,
      emitting: false,
      tint: [0x2a241a, 0x3a3328, 0x2f3d1f, 0x4a4a3a],
      gravityY: 1900
    }).setDepth(110);
    droplets.explode();

    const muck = this.scene.add.particles(x, y - 10, 'smoke_puff', {
      speed: { min: 40, max: 180 + strength * 0.15 },
      angle: { min: 230, max: 310 },
      scale: { start: 0.7, end: 3.4 },
      alpha: { start: 0.22, end: 0 },
      lifespan: { min: 1100, max: 2600 },
      quantity: Math.round(10 + strength * 0.02),
      emitting: false,
      tint: [0x3b4231, 0x2f3326, 0x1f231a],
      gravityY: -80
    }).setDepth(96);
    muck.explode();
    this.applyWindToEmitter(muck as any, y, 0.22);

    this.scene.time.delayedCall(2600, () => { droplets.destroy(); muck.destroy(); });
  }

  public createSmallSpark(x: number, y: number) {
    const sparks = this.scene.add.particles(x, y, 'spark', {
      speed: { min: 100, max: 300 }, scale: { start: 1, end: 0 }, lifespan: 200,
      quantity: 5, emitting: false, tint: 0xffff00, blendMode: 'ADD'
    }).setDepth(45);
    sparks.explode();
    this.scene.time.delayedCall(500, () => sparks.destroy());
  }

  public createFleeingBirds(x: number, y: number) {
    const tint = (this.scene as any)?.mapId === 'desert' ? 0x666666 : 0xe8e8e8;
    const now = this.scene.time.now;
    const last = ((this.scene as any).__lastBirdSfxT as number | undefined) ?? 0;
    if (now > last + 450) {
      (this.scene as any).__lastBirdSfxT = now;
      this.scene.audio.playFolder('environment/forest/point_3d/creatures/birds_flock/scream/sfx', { worldX: x, volume: 0.9, cooldownMs: 0 });
      this.scene.audio.playFolder('environment/forest/point_3d/creatures/birds_flock/wing_flap/sfx', { worldX: x, volume: 0.8, cooldownMs: 0 });
    }
    for (let i = 0; i < 8; i++) {
        const bird = this.scene.add.sprite(x + Phaser.Math.Between(-40, 40), y + Phaser.Math.Between(-30, 30), 'bird_part').setDepth(35).setScale(Phaser.Math.FloatBetween(0.8, 1.2));
        bird.setTint(tint);
        const angle = Phaser.Math.DegToRad(Phaser.Math.Between(200, 340)); 
        const speed = Phaser.Math.Between(400, 800);
        this.scene.tweens.add({
            targets: bird,
            x: bird.x + Math.cos(angle) * 1500,
            y: bird.y + Math.sin(angle) * 1500,
            alpha: 0,
            duration: Phaser.Math.Between(3000, 5000),
            onComplete: () => bird.destroy()
        });
    }
  }

  public createMortarExplosion(x: number, y: number, radius: number) {
      this.spawnCinematicGlow(x, y, {
        radius: Math.max(48, radius * 1.25),
        color: 0xffc28a,
        alpha: 0.52,
        durationMs: 760,
        depth: 110,
        scaleMul: 2.9
      });

      this.spawnSoftShockRing(x, y, {
        radius: Math.max(34, radius * 0.62),
        color: 0xffe2bc,
        alpha: 0.24,
        durationMs: 240,
        depth: 110,
        expand: 2.9,
        anisotropy: 0.88
      });

      this.scene.time.delayedCall(80, () => {
        this.spawnCinematicGlow(x, y + 2, {
          radius: Math.max(68, radius * 1.9),
          color: 0xffd3a1,
          alpha: 0.22,
          durationMs: 860,
          depth: 108,
          scaleMul: 3.15
        });
      });



      const sparks = this.scene.add.particles(x, y, 'spark', {
        speed: { min: 180, max: 900 },
        angle: { min: 210, max: 330 },
        scale: { start: 7, end: 0 },
        lifespan: 650,
        quantity: 90,
        emitting: false,
        tint: [0xffffff, 0xffffaa, 0xffcc66, 0xff8844],
        blendMode: 'ADD',
        gravityY: 650
      }).setDepth(103); sparks.explode();

      const dust = this.scene.add.particles(x, y, 'smoke_puff', {
        speed: { min: 80, max: 420 },
        angle: { min: 200, max: 340 },
        scale: { start: 0.5, end: 2.7 },
        alpha: { start: 0.30, end: 0 },
        lifespan: { min: 900, max: 1700 },
        quantity: 55,
        emitting: false,
        tint: [0xcfc7bb, 0xb7afa2, 0xa79f92],
        gravityY: 280
      }).setDepth(100); dust.explode();
      this.applyWindToEmitter(dust as any, y, 0.18);

      const dirt = this.scene.add.particles(x, y, 'brick_concrete', {
        speed: { min: 450, max: 1400 },
        angle: { min: 200, max: 340 },
        scale: { start: 0.62, end: 0.12 },
        alpha: { start: 1, end: 0.15 },
        lifespan: { min: 950, max: 1700 },
        quantity: 85,
        emitting: false,
        gravityY: 2400,
        tint: [0x6b4a2a, 0x5a3a1f, 0x3d2b1f]
      }).setDepth(105); dirt.explode();
      this.applyWindToEmitter(dirt as any, y, 0.06);

      const groundDust = this.scene.add.particles(x, y + 6, 'smoke_puff', {
        speed: { min: 120, max: 520 },
        angle: { min: 180, max: 360 },
        scale: { start: 0.9, end: 3.2 },
        alpha: { start: 0.18, end: 0 },
        lifespan: { min: 700, max: 1300 },
        quantity: 48,
        emitting: false,
        tint: [0x9b8e7b, 0x7a6f63, 0x6b6158],
        gravityY: 300
      }).setDepth(98); groundDust.explode();
      this.applyWindToEmitter(groundDust as any, y, 0.10);

      const smoke = this.scene.add.particles(x, y, 'smoke_puff', {
        speed: { min: 50, max: 220 },
        angle: { min: 245, max: 295 },
        scale: { start: 1.0, end: 5.2 },
        alpha: { start: 0.22, end: 0 },
        lifespan: { min: 2600, max: 4200 },
        quantity: 70,
        emitting: false,
        tint: [0x9aa3aa, 0x808a92, 0x6b737a],
        gravityY: -120
      }).setDepth(96); smoke.explode();
      this.applyWindToEmitter(smoke as any, y, 0.34);

      const chunks = this.scene.add.particles(x, y, 'brick_concrete', {
        speed: { min: 260, max: 900 },
        angle: { min: 200, max: 340 },
        scale: { start: 0.45, end: 0.15 },
        lifespan: 1600,
        quantity: 28,
        emitting: false,
        gravityY: 1300,
        tint: [0x444444, 0x2a2a2a]
      }).setDepth(106); chunks.explode();
      this.applyWindToEmitter(chunks as any, y, 0.10);

      this.createVolumeSmoke(x, y - 50, radius * 0.55, 0.42, 7200);
      this.scene.time.addEvent({
        delay: 120,
        repeat: 4,
        callback: () => {
          const ox = x + Phaser.Math.Between(-radius * 0.35, radius * 0.35);
          const oy = y + Phaser.Math.Between(-radius * 0.25, radius * 0.25);

          const shrap = this.scene.add.particles(ox, oy, 'spark', {
            speed: { min: 200, max: 950 },
            angle: { min: 200, max: 340 },
            scale: { start: 2.8, end: 0 },
            lifespan: 420,
            quantity: this.q(18),
            emitting: false,
            tint: [0xffffff, 0xffffaa, 0xffcc66],
            blendMode: 'ADD',
            gravityY: 820
          }).setDepth(104);
          shrap.explode();
          this.scene.time.delayedCall(900, () => shrap.destroy());
        }
      });
      this.scene.time.delayedCall(7000, () => { smoke.destroy(); dust.destroy(); chunks.destroy(); sparks.destroy(); dirt.destroy(); groundDust.destroy(); });
  }


  public createImpactMaterialFragments(
    x: number,
    y: number,
    radius: number,
    material: 'mud' | 'flesh' | 'metal' = 'mud',
    opts?: { armorPiercing?: boolean }
  ) {
    if (!this.isNearCamera(x, y, radius * 2.2)) return;

    const isApMetalHit = material === 'metal' && opts?.armorPiercing === true;

    if (material === 'metal') {
      const sparkTex = this.scene.textures.exists('spark_hd') ? 'spark_hd' : 'spark';
      const coreQty = this.q(Math.max(24, Math.round((isApMetalHit ? 96 : 48) + radius * (isApMetalHit ? 0.11 : 0.06))));
      const sprayQty = this.q(Math.max(16, Math.round((isApMetalHit ? 76 : 28) + radius * (isApMetalHit ? 0.09 : 0.04))));
      const glitterQty = this.q(Math.max(14, Math.round((isApMetalHit ? 64 : 24) + radius * (isApMetalHit ? 0.07 : 0.03))));
      const slagQty = this.q(Math.max(4, Math.round((isApMetalHit ? 10 : 6) + radius * 0.02)));

      if (isApMetalHit) {
        this.spawnCinematicGlow(x, y, {
          radius: Math.max(72, radius * 0.44),
          color: 0xffc996,
          alpha: 0.3,
          durationMs: 280,
          depth: 110,
          scaleMul: 1.95
        });
      }

      const coreSparks = this.scene.add.particles(x, y, 'spark', {
        speed: { min: isApMetalHit ? 480 : 320, max: isApMetalHit ? 2000 : 1400 },
        angle: { min: 0, max: 360 },
        scale: { start: isApMetalHit ? 1.95 : 1.45, end: 0 },
        alpha: { start: 1, end: 0 },
        lifespan: { min: isApMetalHit ? 180 : 210, max: isApMetalHit ? 520 : 560 },
        quantity: coreQty,
        emitting: false,
        tint: [0xfff5dc, 0xffe2b0, 0xffbb76, 0xff8643],
        blendMode: 'ADD',
        gravityY: isApMetalHit ? 1450 : 1250
      }).setDepth(109);

      const spray = this.scene.add.particles(x, y, sparkTex, {
        speed: { min: isApMetalHit ? 900 : 560, max: isApMetalHit ? 2600 : 1800 },
        angle: { min: 0, max: 360 },
        scale: { start: isApMetalHit ? 1.5 : 1.1, end: 0 },
        alpha: { start: 0.9, end: 0 },
        lifespan: { min: isApMetalHit ? 120 : 150, max: isApMetalHit ? 360 : 320 },
        quantity: sprayQty,
        emitting: false,
        tint: [0xffffff, 0xffefca, 0xffc88d, 0xff9c57],
        blendMode: 'ADD',
        gravityY: isApMetalHit ? 1180 : 980
      }).setDepth(110);

      const glitter = this.scene.add.particles(x, y, sparkTex, {
        speed: { min: isApMetalHit ? 320 : 180, max: isApMetalHit ? 1200 : 760 },
        angle: { min: 0, max: 360 },
        scale: { start: isApMetalHit ? 0.95 : 0.7, end: 0 },
        alpha: { start: 0.72, end: 0 },
        lifespan: { min: isApMetalHit ? 140 : 180, max: isApMetalHit ? 420 : 460 },
        quantity: glitterQty,
        emitting: false,
        tint: [0xfff6df, 0xffe7bf, 0xffc08a],
        blendMode: 'ADD',
        gravityY: isApMetalHit ? 980 : 860
      }).setDepth(111);

      const slagTex = this.scene.textures.exists('brick_metal') ? 'brick_metal' : 'brick_concrete';
      const slag = this.scene.add.particles(x, y, slagTex, {
        speed: { min: isApMetalHit ? 220 : 160, max: isApMetalHit ? 760 : 540 },
        angle: { min: 0, max: 360 },
        scale: { start: isApMetalHit ? 0.2 : 0.16, end: 0.05 },
        alpha: { start: 0.76, end: 0 },
        lifespan: { min: 420, max: isApMetalHit ? 1080 : 900 },
        quantity: slagQty,
        emitting: false,
        tint: [0x7a7a7a, 0x545454, 0x2f2f2f],
        gravityY: 1600,
        rotate: { min: 0, max: 360 }
      }).setDepth(107);

      coreSparks.explode();
      spray.explode();
      glitter.explode();
      slag.explode();

      this.scene.time.delayedCall(isApMetalHit ? 2200 : 1600, () => {
        coreSparks.destroy();
        spray.destroy();
        glitter.destroy();
        slag.destroy();
      });
      return;
    }

    const profile = (() => {
      if (material === 'flesh') {
        return {
          mainTex: this.scene.textures.exists('meat_chunk') ? 'meat_chunk' : 'brick_mud',
          microTex: this.scene.textures.exists('meat_chunk') ? 'meat_chunk' : 'brick_mud',
          mainTint: [0x8a1818, 0x6e1010, 0x4f0909],
          microTint: [0x7a1111, 0x590a0a, 0x360505],
          speed: { min: 130, max: 640 },
          gravity: 1200,
          mainScale: { start: 1.28, end: 0.52 },
          microScale: { start: 0.92, end: 0.36 },
          mainLife: { min: 760, max: 1500 },
          microLife: { min: 420, max: 960 },
          count: Math.round(14 + radius * 0.06)
        };
      }
      return {
        mainTex: this.scene.textures.exists('brick_mud') ? 'brick_mud' : 'brick_concrete',
        microTex: this.scene.textures.exists('brick_concrete') ? 'brick_concrete' : (this.scene.textures.exists('brick_mud') ? 'brick_mud' : 'brick_concrete'),
        mainTint: [0x8b6a4d, 0x76583f, 0x5f4734, 0x473526],
        microTint: [0xa07c5d, 0x7e6147, 0x5e4835],
        speed: { min: 170, max: 790 },
        gravity: 1550,
        mainScale: { start: 0.88, end: 0.22 },
        microScale: { start: 0.50, end: 0.12 },
        mainLife: { min: 820, max: 1760 },
        microLife: { min: 460, max: 1100 },
        count: Math.round(18 + radius * 0.09)
      };
    })();

    const mainQty = this.q(profile.count);
    const microQty = this.q(Math.max(4, Math.round(profile.count * 0.45)));

    const chips = this.scene.add.particles(x, y, profile.mainTex, {
      speed: profile.speed,
      angle: { min: 205, max: 335 },
      scale: profile.mainScale,
      alpha: { start: 1, end: 0.16 },
      lifespan: profile.mainLife,
      quantity: mainQty,
      emitting: false,
      tint: profile.mainTint,
      gravityY: profile.gravity,
      rotate: { min: 0, max: 360 }
    }).setDepth(107);

    const micro = this.scene.add.particles(x, y - 3, profile.microTex, {
      speed: { min: profile.speed.min * 0.75, max: profile.speed.max * 1.1 },
      angle: { min: 195, max: 345 },
      scale: profile.microScale,
      alpha: { start: 1, end: 0 },
      lifespan: profile.microLife,
      quantity: microQty,
      emitting: false,
      tint: profile.microTint,
      gravityY: Math.round(profile.gravity * 1.08),
      rotate: { min: 0, max: 360 }
    }).setDepth(108);

    chips.explode();
    micro.explode();

    this.scene.time.delayedCall(material === 'metal' ? 2300 : 1800, () => {
      chips.destroy();
      micro.destroy();
    });
  }

  public createVehicleHitAccent(
    x: number,
    y: number,
    shellType: ShellType,
    impactAngle: number = 0
  ) {
    if (!this.isNearCamera(x, y, 560)) return;

    const incomingDir = Number.isFinite(impactAngle) ? impactAngle : -Math.PI / 2;
    const sprayDir = incomingDir + Math.PI;

    const profile = (() => {
      switch (shellType) {
        case ShellType.AP:
          return {
            glowColor: 0xffecd0,
            ringColor: 0xaed9ff,
            slashColor: 0xfff4df,
            emberColor: 0xffbd84,
            glowAlpha: 0.28,
            ringAlpha: 0.16,
            slashCount: 12,
            slashSpread: 0.52,
            slashLenMin: 54,
            slashLenMax: 190,
            slashWidth: 2.2,
            streakLen: 168,
            streakWidth: 14,
            streakAlpha: 0.34,
            plumeQty: 16,
            plumeSpreadDeg: 22,
            plumeSpeedMin: 200,
            plumeSpeedMax: 760,
            plumeLifeMin: 260,
            plumeLifeMax: 760,
            plumeGravity: -120,
            emberQty: 24,
            exposure: 0.16
          };
        case ShellType.HE:
          return {
            glowColor: 0xffc38a,
            ringColor: 0xffdfb8,
            slashColor: 0xffefcf,
            emberColor: 0xffb067,
            glowAlpha: 0.34,
            ringAlpha: 0.22,
            slashCount: 14,
            slashSpread: 1.08,
            slashLenMin: 42,
            slashLenMax: 156,
            slashWidth: 2.5,
            streakLen: 126,
            streakWidth: 24,
            streakAlpha: 0.30,
            plumeQty: 28,
            plumeSpreadDeg: 46,
            plumeSpeedMin: 160,
            plumeSpeedMax: 720,
            plumeLifeMin: 320,
            plumeLifeMax: 920,
            plumeGravity: 40,
            emberQty: 34,
            exposure: 0.24
          };
        case ShellType.INCENDIARY:
          return {
            glowColor: 0xff9f5f,
            ringColor: 0xffc888,
            slashColor: 0xffe2bc,
            emberColor: 0xff7c2e,
            glowAlpha: 0.30,
            ringAlpha: 0.18,
            slashCount: 11,
            slashSpread: 0.9,
            slashLenMin: 36,
            slashLenMax: 138,
            slashWidth: 2.2,
            streakLen: 114,
            streakWidth: 20,
            streakAlpha: 0.28,
            plumeQty: 24,
            plumeSpreadDeg: 40,
            plumeSpeedMin: 130,
            plumeSpeedMax: 560,
            plumeLifeMin: 440,
            plumeLifeMax: 1200,
            plumeGravity: 30,
            emberQty: 56,
            exposure: 0.20
          };
        case ShellType.MORTAR:
          return {
            glowColor: 0xffc996,
            ringColor: 0xffe8cc,
            slashColor: 0xfff0d8,
            emberColor: 0xffc58f,
            glowAlpha: 0.32,
            ringAlpha: 0.20,
            slashCount: 12,
            slashSpread: 1.2,
            slashLenMin: 52,
            slashLenMax: 172,
            slashWidth: 2.3,
            streakLen: 132,
            streakWidth: 22,
            streakAlpha: 0.28,
            plumeQty: 30,
            plumeSpreadDeg: 64,
            plumeSpeedMin: 140,
            plumeSpeedMax: 680,
            plumeLifeMin: 380,
            plumeLifeMax: 980,
            plumeGravity: 90,
            emberQty: 30,
            exposure: 0.22
          };
        case ShellType.NUKE:
          return {
            glowColor: 0xfff1d4,
            ringColor: 0xd4e7ff,
            slashColor: 0xfff9ea,
            emberColor: 0xffd4a8,
            glowAlpha: 0.22,
            ringAlpha: 0.14,
            slashCount: 8,
            slashSpread: 1.4,
            slashLenMin: 62,
            slashLenMax: 220,
            slashWidth: 2.6,
            streakLen: 168,
            streakWidth: 32,
            streakAlpha: 0.22,
            plumeQty: 34,
            plumeSpreadDeg: 78,
            plumeSpeedMin: 170,
            plumeSpeedMax: 820,
            plumeLifeMin: 420,
            plumeLifeMax: 1120,
            plumeGravity: 40,
            emberQty: 40,
            exposure: 0.28
          };
        default:
          return {
            glowColor: 0xffc894,
            ringColor: 0xffe2bf,
            slashColor: 0xfff1d6,
            emberColor: 0xffbb80,
            glowAlpha: 0.30,
            ringAlpha: 0.18,
            slashCount: 10,
            slashSpread: 0.78,
            slashLenMin: 38,
            slashLenMax: 140,
            slashWidth: 2.0,
            streakLen: 112,
            streakWidth: 18,
            streakAlpha: 0.30,
            plumeQty: 20,
            plumeSpreadDeg: 34,
            plumeSpeedMin: 150,
            plumeSpeedMax: 620,
            plumeLifeMin: 280,
            plumeLifeMax: 820,
            plumeGravity: 20,
            emberQty: 26,
            exposure: 0.18
          };
      }
    })();

    this.spawnCinematicGlow(x, y, {
      radius: 78,
      color: profile.glowColor,
      alpha: profile.glowAlpha,
      durationMs: 220,
      depth: 113,
      scaleMul: 1.9
    });
    this.spawnSoftShockRing(x, y, {
      radius: 58,
      color: profile.ringColor,
      alpha: profile.ringAlpha,
      durationMs: 220,
      depth: 112,
      expand: 2.6,
      anisotropy: 0.82
    });

    this.emitScreenExposurePulse(x, y, {
      strength: profile.exposure,
      color: profile.glowColor,
      durationMs: 180
    });

    const nx = Math.cos(sprayDir);
    const ny = Math.sin(sprayDir);

    if (this.tryReserveGlow(0.35)) {
      const streak = this.scene.add.ellipse(
        x - nx * 8,
        y - ny * 8,
        profile.streakLen,
        profile.streakWidth,
        profile.glowColor,
        profile.streakAlpha
      ).setDepth(113);
      streak.setBlendMode(Phaser.BlendModes.ADD);
      streak.setRotation(sprayDir);

      this.scene.tweens.add({
        targets: streak,
        alpha: 0,
        scaleX: 1.6,
        scaleY: 0.82,
        duration: 170,
        ease: 'Cubic.out',
        onComplete: () => {
          streak.destroy();
          this.releaseGlow(0.35);
        }
      });
    }

    const slash = this.scene.add.graphics().setDepth(114);
    slash.setBlendMode(Phaser.BlendModes.ADD);
    slash.lineStyle(profile.slashWidth, profile.slashColor, 0.88);
    const slashCount = this.q(profile.slashCount);
    for (let i = 0; i < slashCount; i++) {
      const ang = sprayDir + Phaser.Math.FloatBetween(-profile.slashSpread, profile.slashSpread);
      const len = Phaser.Math.FloatBetween(profile.slashLenMin, profile.slashLenMax);
      const jitterX = Phaser.Math.FloatBetween(-5, 5);
      const jitterY = Phaser.Math.FloatBetween(-5, 5);
      slash.beginPath();
      slash.moveTo(x + jitterX, y + jitterY);
      slash.lineTo(x + jitterX + Math.cos(ang) * len, y + jitterY + Math.sin(ang) * len);
      slash.strokePath();
    }
    this.scene.tweens.add({
      targets: slash,
      alpha: 0,
      duration: 220,
      ease: 'Sine.out',
      onComplete: () => slash.destroy()
    });

    const plume = this.scene.add.particles(x - nx * 5, y - ny * 5, 'smoke_puff', {
      speed: { min: profile.plumeSpeedMin, max: profile.plumeSpeedMax },
      angle: {
        min: Phaser.Math.RadToDeg(sprayDir) - profile.plumeSpreadDeg,
        max: Phaser.Math.RadToDeg(sprayDir) + profile.plumeSpreadDeg
      },
      scale: { start: 0.34, end: 1.85 },
      alpha: { start: 0.28, end: 0 },
      lifespan: { min: profile.plumeLifeMin, max: profile.plumeLifeMax },
      quantity: this.q(profile.plumeQty),
      emitting: false,
      tint: [0xb8b3ac, 0x908b84, 0x67635d],
      gravityY: profile.plumeGravity
    }).setDepth(106);
    plume.explode();
    this.applyWindToEmitter(plume as any, y, 0.2);

    const embers = this.scene.add.particles(x, y, 'spark', {
      speed: { min: 180, max: shellType === ShellType.INCENDIARY ? 820 : 620 },
      angle: {
        min: Phaser.Math.RadToDeg(sprayDir) - (profile.plumeSpreadDeg + 12),
        max: Phaser.Math.RadToDeg(sprayDir) + (profile.plumeSpreadDeg + 12)
      },
      scale: { start: shellType === ShellType.AP ? 1.6 : 2.1, end: 0 },
      alpha: { start: 0.9, end: 0 },
      lifespan: { min: 200, max: shellType === ShellType.INCENDIARY ? 980 : 620 },
      quantity: this.q(profile.emberQty),
      emitting: false,
      tint: [0xffffff, 0xfff0cb, profile.emberColor, 0xff7a2b],
      blendMode: 'ADD',
      gravityY: shellType === ShellType.AP ? 920 : 1120
    }).setDepth(112);
    embers.explode();

    this.scene.time.delayedCall(1300, () => {
      plume.destroy();
      embers.destroy();
    });

    if (shellType === ShellType.AP || shellType === ShellType.HE) {
      this.scene.time.delayedCall(70, () => {
        this.spawnSoftShockRing(x, y, {
          radius: shellType === ShellType.AP ? 78 : 86,
          color: shellType === ShellType.AP ? 0xe2f0ff : 0xffd6a7,
          alpha: shellType === ShellType.AP ? 0.10 : 0.13,
          durationMs: 260,
          depth: 111,
          expand: shellType === ShellType.AP ? 3.0 : 3.3,
          anisotropy: 0.86
        });
      });
    }
  }

  public createExplosion(x: number, y: number, radius: number, isHE: boolean = false, volumeSmoke: boolean = false) {
    const heK = isHE ? 1 : 0.72;

    this.spawnCinematicGlow(x, y, {
      radius: radius * (isHE ? 1.75 : 1.28),
      color: isHE ? 0xffb06a : 0xffc79a,
      alpha: isHE ? 0.46 : 0.32,
      durationMs: isHE ? 760 : 520,
      depth: 102,
      scaleMul: isHE ? 2.55 : 2.1
    });
    this.spawnSoftShockRing(x, y, {
      radius: radius * (isHE ? 1.6 : 1.25),
      color: isHE ? 0xffc286 : 0xffd2ae,
      alpha: isHE ? 0.23 : 0.17,
      durationMs: isHE ? 420 : 300,
      depth: 101,
      expand: isHE ? 4.6 : 3.9,
      anisotropy: 0.72
    });

    this.scene.time.delayedCall(isHE ? 110 : 90, () => {
      this.spawnCinematicGlow(x, y, {
        radius: radius * (isHE ? 2.3 : 1.85),
        color: isHE ? 0xffdaaa : 0xffe8cd,
        alpha: isHE ? 0.19 : 0.16,
        durationMs: isHE ? 980 : 700,
        depth: 100,
        scaleMul: isHE ? 2.9 : 2.45
      });
      this.spawnSoftShockRing(x, y, {
        radius: radius * (isHE ? 2.0 : 1.55),
        color: 0xb4d5ff,
        alpha: isHE ? 0.09 : 0.07,
        durationMs: isHE ? 520 : 420,
        depth: 99,
        expand: isHE ? 5.2 : 4.5,
        anisotropy: 0.8
      });
      this.spawnSoftShockRing(x, y + 2, {
        radius: radius * (isHE ? 1.42 : 1.2),
        color: isHE ? 0xfff1d2 : 0xffedd8,
        alpha: isHE ? 0.08 : 0.06,
        durationMs: isHE ? 360 : 280,
        depth: 100,
        expand: isHE ? 3.6 : 3.1,
        anisotropy: 0.9
      });
    });

    if (this.isNearCamera(x, y, 320)) {
      this.combatPulseUntil = Math.max(this.combatPulseUntil, this.scene.time.now + (isHE ? 900 : 600));
      this.emitScreenExposurePulse(x, y, {
        strength: isHE ? 0.46 : 0.3,
        color: isHE ? 0xffbf82 : 0xffd7b0,
        durationMs: isHE ? 360 : 270
      });
    }
    this.pulseNearbyTankHighlights(x, y, radius * (isHE ? 8 : 6), 0.9 + heK * 0.55);

    if (isHE) {
      const fireball = this.scene.add.particles(x, y, 'smoke_puff', {
        speed: { min: 20, max: 100 },
        angle: { min: 0, max: 360 },
        scale: { start: 1.6, end: 4.2 },
        alpha: { start: 0.48, end: 0 },
        lifespan: 620,
        quantity: this.q(6),
        emitting: false,
        tint: [0xfff3d2, 0xffb165, 0xa44723],
        blendMode: 'ADD'
      }).setDepth(92);
      fireball.explode();
      this.scene.time.delayedCall(900, () => fireball.destroy());
    }

    const fire = this.scene.add.particles(x, y, 'spark', {
      speed: { min: 100, max: isHE ? 500 : 300 },
      scale: { start: isHE ? 5.6 : 2.8, end: 0 },
      lifespan: isHE ? 760 : 420,
      quantity: this.q(isHE ? 78 : 32),
      emitting: false,
      tint: [0xfff6dc, 0xffd3a2, 0xffa260, 0xff6a2d, 0x2e1d16],
      blendMode: 'ADD'
    }).setDepth(91);
    fire.explode();

    if (volumeSmoke) this.createVolumeSmoke(x, y - 35, radius * 0.95, isHE ? 0.55 : 0.35, isHE ? 9000 : 6200);
    this.scene.time.delayedCall(3400, () => { fire.destroy(); });
  }


  public createVehicleExplosion(x: number, y: number, radius: number) {
    this.spawnCinematicGlow(x, y, {
      radius: Math.max(92, radius * 1.35),
      color: 0xffb67a,
      alpha: 0.5,
      durationMs: 820,
      depth: 112,
      scaleMul: 2.6
    });
    this.spawnCinematicGlow(x, y + 3, {
      radius: Math.max(96, radius * 1.46),
      color: 0xffd9b8,
      alpha: 0.28,
      durationMs: 520,
      depth: 110,
      scaleMul: 2.9
    });
    this.spawnSoftShockRing(x, y, {
      radius: Math.max(110, radius * 1.65),
      color: 0xffc994,
      alpha: 0.23,
      durationMs: 520,
      depth: 109,
      expand: 5.0,
      anisotropy: 0.78
    });
    this.scene.time.delayedCall(120, () => {
      this.spawnSoftShockRing(x, y + 5, {
        radius: Math.max(126, radius * 1.9),
        color: 0xb4d7ff,
        alpha: 0.1,
        durationMs: 720,
        depth: 108,
        expand: 5.6,
        anisotropy: 0.86
      });
      this.spawnSoftShockRing(x, y + 4, {
        radius: Math.max(94, radius * 1.32),
        color: 0xfff0d7,
        alpha: 0.08,
        durationMs: 360,
        depth: 110,
        expand: 3.8,
        anisotropy: 0.92
      });
    });

    if (this.isNearCamera(x, y, 420)) {
      this.combatPulseUntil = Math.max(this.combatPulseUntil, this.scene.time.now + 1200);
      this.emitScreenExposurePulse(x, y, {
        strength: 0.5,
        color: 0xffbe80,
        durationMs: 360
      });
    }
    this.pulseNearbyTankHighlights(x, y, Math.max(380, radius * 4.6), 1.5);

    const sparks = this.scene.add.particles(x, y, 'spark', {
      speed: { min: 300, max: 1200 },
      angle: { min: 210, max: 330 },
      scale: { start: 6.6, end: 0 },
      lifespan: 900,
      quantity: this.q(Math.round(98 + radius * 0.36)),
      emitting: false,
      tint: [0xfff7e2, 0xffddb8, 0xffb371, 0xff7b43, 0xffe8c2],
      blendMode: 'ADD',
      gravityY: 900
    }).setDepth(104);
    sparks.explode();

    const shrap = this.scene.add.particles(x, y, 'brick_concrete', {
      speed: { min: 280, max: 960 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.9, end: 0.15 },
      lifespan: { min: 1400, max: 3800 },
      quantity: this.q(Math.round(45 + radius * 0.18)),
      emitting: false,
      tint: [0x1a1a1a, 0x333333, 0x0a0a0a],
      gravityY: 1200
    }).setDepth(60);
    shrap.explode();

    this.createVolumeSmoke(x, y - 40, radius * 1.6, 0.85, 16000);

    const popCount = 3;
    for (let i = 0; i < popCount; i++) {
      this.scene.time.delayedCall(180 + i * 220, () => {
        const ox = x + Phaser.Math.Between(-radius * 0.35, radius * 0.35);
        const oy = y + Phaser.Math.Between(-radius * 0.25, radius * 0.10);
        const p = this.scene.add.particles(ox, oy, 'spark', {
          speed: { min: 120, max: 520 },
          angle: { min: 210, max: 330 },
          scale: { start: 3.8, end: 0 },
          lifespan: 520,
          quantity: this.q(20),
          emitting: false,
          tint: [0xffd08a, 0xfff2d8, 0xff6f3a],
          blendMode: 'ADD',
          gravityY: 850
        }).setDepth(103);
        p.explode();
        this.scene.time.delayedCall(900, () => p.destroy());
      });
    }

    this.scene.time.delayedCall(5000, () => { sparks.destroy(); shrap.destroy(); });
  }


  public createIncendiaryExplosion(x: number, y: number, radius: number) {
      this.spawnCinematicGlow(x, y, {
        radius: Math.max(54, radius * 1.28),
        color: 0xffc48a,
        alpha: 0.36,
        durationMs: 320,
        depth: 110,
        scaleMul: 2.8
      });
      this.spawnCinematicGlow(x, y + 5, {
        radius: Math.max(76, radius * 1.78),
        color: 0xff8f52,
        alpha: 0.22,
        durationMs: 470,
        depth: 109,
        scaleMul: 3.0
      });
      this.spawnSoftShockRing(x, y + 2, {
        radius: Math.max(84, radius * 1.95),
        color: 0xffbc84,
        alpha: 0.17,
        durationMs: 440,
        depth: 108,
        expand: 4.7,
        anisotropy: 0.75
      });

      if (this.isNearCamera(x, y, 320)) {
        this.combatPulseUntil = Math.max(this.combatPulseUntil, this.scene.time.now + 760);
        this.emitScreenExposurePulse(x, y, {
          strength: 0.46,
          color: 0xffb474,
          durationMs: 340
        });
      }
      this.pulseNearbyTankHighlights(x, y, Math.max(250, radius * 4.2), 1.0);

      const flames = this.scene.add.particles(x, y, 'smoke_puff', {
          speed: { min: 20, max: 80 },
          angle: { min: 200, max: 340 },
          scale: { start: 1.2, end: 3.6 },
          alpha: { start: 0.45, end: 0 },
          lifespan: 1100,
          quantity: this.q(16),
          emitting: false,
          tint: [0xfff3d2, 0xffa45f, 0x9c3f24],
          blendMode: 'ADD',
          gravityY: -100
      }).setDepth(100);
      flames.explode();
      this.scene.time.delayedCall(2000, () => flames.destroy());

      for (let i = 0; i < 16; i++) {
        this.scene.time.delayedCall(120 + i * 160, () => {
          const fx = x + Phaser.Math.Between(-radius * 0.35, radius * 0.35);
          const fy = y + Phaser.Math.Between(-radius * 0.25, radius * 0.10);
          this.createLingeringFire(fx, fy, 26);
        });
      }

      const shards = this.scene.add.particles(x, y, 'spark', {
          speed: { min: 160, max: 1100 },
          angle: { min: 0, max: 360 },
          scale: { start: 4.0, end: 0.35 },
          lifespan: { min: 500, max: 1400 },
          alpha: { start: 1, end: 0 },
          quantity: this.q(Math.round(196 + radius * 0.42)),
          emitting: false,
          tint: [0xfff3d8, 0xffe0b4, 0xffbe72, 0xff8a42],
          blendMode: 'ADD',
          gravityY: 380
      }).setDepth(108);
      shards.explode();

      const whiteSmoke = this.scene.add.particles(x, y - 10, 'smoke_puff', {
          speed: { min: 30, max: 160 },
          angle: { min: 250, max: 290 },
          scale: { start: 1.1, end: 5.2 },
          alpha: { start: 0.14, end: 0 },
          lifespan: { min: 2200, max: 5200 },
          quantity: this.q(Math.round(36 + radius * 0.14)),
          emitting: false,
          tint: [0xf2fbff, 0xcfe7ff, 0xffffff],
          gravityY: -120
      }).setDepth(96);
      whiteSmoke.explode();
      this.applyWindToEmitter(whiteSmoke as any, y, 0.32);

      this.scene.time.delayedCall(15000, () => { shards.destroy(); whiteSmoke.destroy(); });
  }


  public createNukeExplosion(x: number, y: number, craterRadius: number) {
      const sizeK = Phaser.Math.Clamp(craterRadius / 620, 0.85, 1.8);
      // Android-only trim: keeps nuke readable while reducing peak particle load.
      const nukeFxLiteMul = this.fxMul < 0.85 ? 0.74 : 1;
      const nukeQ = (count: number) => Math.max(1, Math.round(count * nukeFxLiteMul));
      const nukeF = (ms: number) => Math.max(12, Math.round(ms / nukeFxLiteMul));
      this.spawnCinematicGlow(x, y, {
        radius: craterRadius * 0.56,
        color: 0xfff0c8,
        alpha: 0.84,
        durationMs: 1100,
        depth: 157,
        scaleMul: 3.5
      });
      this.spawnSoftShockRing(x, y, {
        radius: craterRadius * 0.62,
        color: 0xffddb3,
        alpha: 0.34,
        durationMs: 760,
        depth: 156,
        expand: 6.0,
        anisotropy: 0.86
      });
      this.scene.time.delayedCall(180, () => {
        this.spawnCinematicGlow(x, y + 8, {
          radius: craterRadius * 1.05,
          color: 0xffb54d,
          alpha: 0.36,
          durationMs: 1520,
          depth: 146,
          scaleMul: 4.0
        });
        this.spawnSoftShockRing(x, y + 6, {
          radius: craterRadius * 1.10,
          color: 0xbcdcff,
          alpha: 0.20,
          durationMs: 1080,
          depth: 145,
          expand: 6.6,
          anisotropy: 0.94
        });
      });

      this.emitScreenExposurePulse(x, y, {
        strength: 0.72,
        color: 0xffd9a6,
        durationMs: 620
      });

      if (this.scene.textures.exists('fx_soft_glow') && this.tryReserveGlow(1.25)) {
        const lensHalo = this.scene.add.image(x, y, 'fx_soft_glow').setDepth(158);
        lensHalo.setBlendMode(Phaser.BlendModes.ADD);
        lensHalo.setTint(0xfff2d8);
        lensHalo.setAlpha(0.52 * (this.fxMul < 0.85 ? 0.86 : 1));
        lensHalo.setScale(3.8 * sizeK, 2.8 * sizeK);
        this.scene.tweens.add({
          targets: lensHalo,
          alpha: 0,
          scaleX: lensHalo.scaleX * 1.55,
          scaleY: lensHalo.scaleY * 1.42,
          duration: 680,
          ease: 'Quad.out',
          onComplete: () => {
            lensHalo.destroy();
            this.releaseGlow(1.25);
          }
        });
      }

      const thermalCoreA = this.scene.add.circle(x, y, 22, 0xffffff, 1).setDepth(156);
      thermalCoreA.setBlendMode(Phaser.BlendModes.ADD);
      const thermalCoreB = this.scene.add.circle(x, y, 30, 0xffd59a, 0.75).setDepth(155);
      thermalCoreB.setBlendMode(Phaser.BlendModes.ADD);
      const thermalVoid = this.scene.add.circle(x, y + 6, 18, 0x0a0a0a, 0.35).setDepth(154);
      this.scene.tweens.add({ targets: thermalCoreA, radius: craterRadius * 0.14, alpha: 0, duration: 520, ease: 'Cubic.out', onComplete: () => thermalCoreA.destroy() });
      this.scene.tweens.add({ targets: thermalCoreB, radius: craterRadius * 0.22, alpha: 0, duration: 680, ease: 'Cubic.out', onComplete: () => thermalCoreB.destroy() });
      this.scene.tweens.add({ targets: thermalVoid, radius: craterRadius * 0.16, alpha: 0, duration: 760, ease: 'Cubic.out', onComplete: () => thermalVoid.destroy() });

      const shockA = this.scene.add.ellipse(x, y, 60, 28, 0xffffff, 0.35).setDepth(150);
      shockA.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({ targets: shockA, scaleX: 240 * sizeK, scaleY: 92 * sizeK, alpha: 0, duration: 820, ease: 'Cubic.out', onComplete: () => shockA.destroy() });

      const shockB = this.scene.add.ellipse(x, y, 70, 32, 0xffc56a, 0.18).setDepth(149);
      shockB.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({ targets: shockB, scaleX: 300 * sizeK, scaleY: 110 * sizeK, alpha: 0, duration: 1180, ease: 'Cubic.out', onComplete: () => shockB.destroy() });

      const condensation = this.scene.add.ellipse(x, y - 16, 110, 38, 0xffffff, 0.18).setDepth(147);
      condensation.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({ targets: condensation, scaleX: 310 * sizeK, scaleY: 120 * sizeK, alpha: 0, duration: 980, ease: 'Cubic.out', onComplete: () => condensation.destroy() });

      const groundGlow = this.scene.add.circle(x, y, 50, 0xffaa22, 0.55).setDepth(140);
      groundGlow.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({ targets: groundGlow, radius: craterRadius * 0.95, alpha: 0, duration: 1400, ease: 'Quad.out', onComplete: () => groundGlow.destroy() });

      const fireCore = this.scene.add.circle(x, y, 40, 0xffffff, 0.85).setDepth(152);
      fireCore.setBlendMode(Phaser.BlendModes.ADD);
      this.scene.tweens.add({
        targets: fireCore,
        radius: craterRadius * 0.38,
        alpha: 0,
        duration: 760,
        ease: 'Cubic.out',
        onComplete: () => fireCore.destroy()
      });

      const fireball = this.scene.add.particles(x, y, 'smoke_puff', {
        speed: { min: 60, max: 420 * sizeK },
        angle: { min: 0, max: 360 },
        scale: { start: 6.0 * sizeK, end: 22.0 * sizeK },
        alpha: { start: 0.9, end: 0 },
        lifespan: { min: 780, max: 1200 },
        quantity: nukeQ(Math.round(160 * sizeK)),
        emitting: false,
        tint: [0xffffff, 0xfff2cc, 0xffcc66, 0xff8844, 0xaa2200],
        blendMode: 'ADD'
      }).setDepth(148);
      fireball.explode();

      const sparks = this.scene.add.particles(x, y, 'spark_hd', {
        speed: { min: 220, max: 980 * sizeK },
        angle: { min: 0, max: 360 },
        scale: { start: 0.85 * sizeK, end: 0 },
        alpha: { start: 0.9, end: 0 },
        lifespan: { min: 520, max: 980 },
        quantity: nukeQ(Math.round(120 * sizeK)),
        emitting: false,
        tint: [0xffffff, 0xfff6c7, 0xffcc66, 0xff8844],
        blendMode: 'ADD',
        gravityY: 980
      }).setDepth(153);
      sparks.explode();

      const baseSurge = this.scene.add.particles(x, y + 10, 'smoke_puff', {
        speedX: { min: -2400 * sizeK, max: 2400 * sizeK },
        speedY: { min: -120 * sizeK, max: 220 * sizeK },
        scale: { start: 2.6 * sizeK, end: 10.5 * sizeK },
        alpha: { start: 0.20, end: 0 },
        lifespan: { min: 3200, max: 7000 },
        quantity: nukeQ(Math.round(130 * sizeK)),
        emitting: false,
        tint: [0xcfc7bb, 0xb7afa2, 0x8b7a6b, 0x5b4c42],
        gravityY: 180
      }).setDepth(112);
      baseSurge.explode();
      this.applyWindToEmitter(baseSurge as any, y, 0.24);

      const dustWave = this.scene.add.particles(x, y + 12, 'smoke_puff', {
        speed: { min: 620 * sizeK, max: 2100 * sizeK },
        angle: { min: 180, max: 360 },
        scale: { start: 3.0 * sizeK, end: 12.0 * sizeK },
        alpha: { start: 0.20, end: 0 },
        lifespan: { min: 2200, max: 6200 },
        quantity: nukeQ(Math.round(170 * sizeK)),
        emitting: false,
        tint: [0x6b6158, 0x554433, 0x3d2b1f, 0x2a231b],
        gravityY: 420
      }).setDepth(114);
      dustWave.explode();
      this.applyWindToEmitter(dustWave as any, y, 0.26);

      const stem = this.scene.add.particles(x, y, 'smoke_puff', {
        speedX: { min: -70 * sizeK, max: 70 * sizeK },
        speedY: { min: -520 * sizeK, max: -1150 * sizeK },
        angle: { min: 258, max: 282 },
        scale: { start: 5.6 * sizeK, end: 18.5 * sizeK },
        alpha: { start: 0.42, end: 0 },
        lifespan: { min: 2600, max: 5200 },
        quantity: 8,
        frequency: nukeF(26),
        tint: [0xfff2cc, 0x9fa7ad, 0x6a6a6a, 0x2a2a2a],
        blendMode: 'NORMAL',
        gravityY: -140
      }).setDepth(126);
      this.applyWindToEmitter(stem as any, y, 0.62);

      const stemPos = { y };
      const stemRise = 1300 * sizeK;
      this.scene.tweens.add({
        targets: stemPos,
        y: y - stemRise,
        duration: 3600,
        ease: 'Quad.out',
        onUpdate: () => stem.setPosition(x, stemPos.y),
        onComplete: () => stem.stop()
      });

      const capStartT = 760;
      this.scene.time.delayedCall(capStartT, () => {
        const capPos = { y: y - stemRise * 0.72 };
        const capGlow = this.scene.add.particles(x, capPos.y, 'smoke_puff', {
          speed: { min: 80, max: 520 * sizeK },
          angle: { min: 0, max: 360 },
          scale: { start: 10.0 * sizeK, end: 34.0 * sizeK },
          alpha: { start: 0.38, end: 0 },
          lifespan: { min: 1600, max: 3600 },
          quantity: nukeQ(Math.round(180 * sizeK)),
          emitting: false,
          tint: [0xffffff, 0xfff2cc, 0xffcc66, 0xff8844],
          blendMode: 'ADD'
        }).setDepth(136);
        capGlow.explode();

        const capRim = this.scene.add.ellipse(x, capPos.y - 6 * sizeK, 180 * sizeK, 66 * sizeK, 0xffffff, 0.18).setDepth(137);
        capRim.setBlendMode(Phaser.BlendModes.ADD);
        this.scene.tweens.add({ targets: capRim, scaleX: 3.1, scaleY: 2.9, alpha: 0, duration: 2600, ease: 'Cubic.out', onComplete: () => capRim.destroy() });

        const capDense = this.scene.add.particles(x, capPos.y, 'smoke_puff', {
          speed: { min: 20, max: 260 * sizeK },
          angle: { min: 0, max: 360 },
          scale: { start: 8.5 * sizeK, end: 34.0 * sizeK },
          alpha: { start: 0.30, end: 0 },
          lifespan: { min: 3800, max: 8200 },
          quantity: nukeQ(Math.round(190 * sizeK)),
          emitting: false,
          tint: [0x2a2a2a, 0x3a3a3a, 0x5a5a5a, 0x7a828a],
          blendMode: 'NORMAL',
          gravityY: -60
        }).setDepth(124);
        capDense.explode();
        this.applyWindToEmitter(capDense as any, capPos.y, 0.72);

        const capSmoke = this.scene.add.particles(x, capPos.y, 'smoke_puff', {
          speed: { min: 60, max: 460 * sizeK },
          angle: { min: 0, max: 360 },
          scale: { start: 12.5 * sizeK, end: 56.0 * sizeK },
          alpha: { start: 0.26, end: 0 },
          lifespan: { min: 6200, max: 13000 },
          quantity: nukeQ(Math.round(300 * sizeK)),
          emitting: false,
          tint: [0xb7bfc7, 0x8a929a, 0x5a5a5a, 0x2a2a2a, 0x121212],
          blendMode: 'SCREEN',
          gravityY: -80
        }).setDepth(125);
        capSmoke.explode();
        this.applyWindToEmitter(capSmoke as any, capPos.y, 0.72);

        const capSkirt = this.scene.add.particles(x, capPos.y + 40, 'smoke_puff', {
          speedX: { min: -900 * sizeK, max: 900 * sizeK },
          speedY: { min: -120 * sizeK, max: 180 * sizeK },
          scale: { start: 2.4 * sizeK, end: 12.5 * sizeK },
          alpha: { start: 0.14, end: 0 },
          lifespan: { min: 5200, max: 9800 },
          quantity: nukeQ(Math.round(120 * sizeK)),
          emitting: false,
          tint: [0xb7afa2, 0x8b7a6b, 0x5b4c42, 0x3a2f2a],
          gravityY: 90
        }).setDepth(123);
        capSkirt.explode();
        this.applyWindToEmitter(capSkirt as any, capPos.y, 0.80);

        const groundY = this.scene.getTerrainHeight(x);
        const sootFall = this.scene.add.particles(x, groundY - 4, 'smoke_puff', {
          speed: { min: 10, max: 60 },
          angle: { min: 80, max: 100 },
          scale: { start: 0.7, end: 2.8 },
          alpha: { start: 0.10, end: 0 },
          lifespan: { min: 4200, max: 8200 },
          quantity: nukeQ(Math.round(45 * sizeK)),
          frequency: nukeF(90),
          tint: [0x444444, 0x333333, 0x222222],
          blendMode: 'NORMAL',
          gravityY: 160
        }).setDepth(124);
        this.applyWindToEmitter(sootFall as any, groundY, 0.85);

        this.scene.time.delayedCall(15000, () => { capGlow.destroy(); capDense.destroy(); capSmoke.destroy(); capSkirt.destroy(); });
        this.scene.time.delayedCall(15000, () => { sootFall.destroy(); });
      });

      this.scene.time.delayedCall(15000, () => { stem.destroy(); sparks.destroy(); fireball.destroy(); baseSurge.destroy(); dustWave.destroy(); });
  }

  public createWPBurn(x: number, y: number, spread: number) {
    this.spawnCinematicGlow(x, y, {
      radius: 92 + spread * 0.65,
      color: 0xdaf2ff,
      alpha: 0.34,
      durationMs: 560,
      depth: 97,
      scaleMul: 2.6
    });
    this.spawnSoftShockRing(x, y, {
      radius: 110 + spread * 0.72,
      color: 0xbbe3ff,
      alpha: 0.15,
      durationMs: 560,
      depth: 96,
      expand: 4.4,
      anisotropy: 0.82
    });

    const sparks = this.scene.add.particles(x, y, 'spark', {
      speed: { min: 20, max: 220 },
      angle: { min: 210, max: 330 },
      scale: { start: 2.4, end: 0 },
      alpha: { start: 0.9, end: 0 },
      lifespan: { min: 600, max: 1600 },
      quantity: Math.round(18 + spread * 0.05),
      emitting: false,
      tint: [0xffffff, 0xf2fbff, 0xd6ffff, 0xfff6c7],
      blendMode: 'ADD',
      gravityY: 420
    }).setDepth(98);
    sparks.explode();

    const smoke = this.scene.add.particles(x + Phaser.Math.Between(-spread, spread), y - 18, 'smoke_puff', {
      speed: { min: 10, max: 70 },
      angle: { min: 240, max: 300 },
      scale: { start: 1.2, end: 7.5 },
      alpha: { start: 0.16, end: 0 },
      lifespan: { min: 2600, max: 6800 },
      quantity: Math.round(14 + spread * 0.03),
      emitting: false,
      tint: [0xffffff, 0xf2fbff, 0xcfe7ff],
      gravityY: -80
    }).setDepth(94);
    smoke.explode();
    this.applyWindToEmitter(smoke as any, y, 0.28);

    this.scene.time.delayedCall(7200, () => { sparks.destroy(); smoke.destroy(); });
  }


  public createLingeringFire(x: number, y: number, spread: number) {
    const fireData = [{ t: 0x660000, s: 3.0, sp: 15, l: 1500, d: 93 }, { t: 0xff4400, s: 2.0, sp: 40, l: 800, d: 94 }, { t: 0xffcc00, s: 1.2, sp: 70, l: 500, d: 95 }];
    fireData.forEach(f => {
        const p = this.scene.add.particles(x + Phaser.Math.Between(-spread, spread), y, 'spark', {
            speed: { min: 10, max: f.sp }, scale: { start: f.s, end: 0 }, lifespan: f.l,
            quantity: 6, emitting: false, tint: f.t, blendMode: 'ADD', gravityY: -120
        }).setDepth(f.d);
        p.explode();
        this.scene.time.delayedCall(f.l + 100, () => p.destroy());
    });
  }

  public createMuzzleFlash(x: number, y: number, angle: number, type: ShellType) {
    const deg = Phaser.Math.RadToDeg(angle);

    if (type === ShellType.BULLET) {
      const core = this.scene.add.ellipse(x, y, 24, 7, 0xfff2d6, 0.82).setDepth(46);
      core.setBlendMode(Phaser.BlendModes.ADD);
      core.setRotation(angle);
      this.scene.tweens.add({ targets: core, scaleX: 2.6, scaleY: 0.32, alpha: 0, duration: 82, ease: 'Quad.out', onComplete: () => core.destroy() });

      const flash = this.scene.add.particles(x, y, 'spark', {
        speed: { min: 900, max: 1700 },
        angle: { min: deg - 4, max: deg + 4 },
        scale: { start: 1.35, end: 0 },
        alpha: { start: 0.95, end: 0 },
        lifespan: { min: 55, max: 110 },
        quantity: 14,
        emitting: false,
        tint: [0xfff8e6, 0xffe0b5, 0xffba74],
        blendMode: 'ADD'
      }).setDepth(45);
      flash.explode();

      const smoke = this.scene.add.particles(x - Math.cos(angle) * 6, y - Math.sin(angle) * 6, 'smoke_puff', {
        speed: { min: 16, max: 72 },
        angle: { min: deg + 155, max: deg + 205 },
        scale: { start: 0.45, end: 1.6 },
        alpha: { start: 0.13, end: 0 },
        lifespan: { min: 260, max: 620 },
        quantity: 3,
        emitting: false,
        tint: [0x3a3a3a, 0x1a1a1a]
      }).setDepth(44);
      smoke.explode();

      this.scene.time.delayedCall(800, () => { flash.destroy(); smoke.destroy(); });
      return;
    }

    let colors = [0xffd2a0, 0xfff1dc, 0xff7c3f];
    let scale = 4.8;
    let qty = 55;
    let smokeQty = 10;
    let smokeTint: number[] = [0x2a2a2a, 0x0e0e0e];
    let ringColor = 0xffc58f;

    if (type === ShellType.AP) {
      colors = [0xcdeeff, 0x9ad9ff, 0xf2f8ff];
      scale = 3.1;
      qty = 42;
      smokeQty = 6;
      smokeTint = [0x22333a, 0x0a0f14];
      ringColor = 0xa5d9ff;
    } else if (type === ShellType.STANDARD) {
      colors = [0xfff5de, 0xffddb0, 0xffb575];
      scale = 5.4;
      qty = 78;
      smokeQty = 12;
      ringColor = 0xffcc98;
    } else if (type === ShellType.INCENDIARY) {
      colors = [0xfff3d7, 0xffcc8e, 0xff8748];
      scale = 6.8;
      qty = 110;
      smokeQty = 14;
      smokeTint = [0x4a3a2a, 0x1a1410];
      ringColor = 0xffb77b;
    } else if (type === ShellType.HE) {
      colors = [0xfff1d9, 0xffcf9c, 0xff7c46];
      scale = 7.2;
      qty = 95;
      smokeQty = 16;
      smokeTint = [0x2a2420, 0x0a0a0a];
      ringColor = 0xffbc85;
    }

    this.spawnCinematicGlow(x, y, {
      radius: 48 + scale * 6,
      color: ringColor,
      alpha: 0.22,
      durationMs: 180,
      depth: 46,
      scaleMul: 1.85
    });
    this.spawnSoftShockRing(x, y, {
      radius: 56 + scale * 5,
      color: ringColor,
      alpha: type === ShellType.AP ? 0.22 : 0.18,
      durationMs: 170,
      depth: 46,
      expand: 3.7,
      anisotropy: 0.52,
      rotation: angle
    });

    const flash = this.scene.add.particles(x, y, 'spark', {
      speed: { min: 420, max: 1200 },
      angle: { min: deg - 10, max: deg + 10 },
      scale: { start: scale, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: { min: 160, max: 260 },
      quantity: qty,
      emitting: false,
      tint: colors,
      blendMode: 'ADD'
    }).setDepth(45);
    flash.explode();

    const smoke = this.scene.add.particles(x - Math.cos(angle) * 18, y - Math.sin(angle) * 18, 'smoke_puff', {
      speed: { min: 25, max: 140 },
      angle: { min: deg + 150, max: deg + 210 },
      scale: { start: 0.75, end: 3.8 },
      alpha: { start: 0.20, end: 0 },
      lifespan: { min: 900, max: 2000 },
      quantity: smokeQty,
      emitting: false,
      tint: smokeTint,
      gravityY: -60
    }).setDepth(44);
    smoke.explode();
    this.applyWindToEmitter(smoke as any, y, 0.14);

    this.scene.time.delayedCall(2200, () => { flash.destroy(); smoke.destroy(); });
  }


  public createMgTracer(x: number, y: number, angle: number, length: number = 800) {
      const ex = x + Math.cos(angle) * length;
      const ey = y + Math.sin(angle) * length;

      const outer = (this.mgTracerOuterPool.pop() ?? this.scene.add.line(0, 0, 0, 0, 0, 0, 0xffc64d, 0.26).setOrigin(0).setDepth(44)) as any;
      outer.setTo(x, y, ex, ey);
      if (outer.setStrokeStyle) outer.setStrokeStyle(9, 0xffc64d, 0.26);
      if (outer.setLineWidth) outer.setLineWidth(9);
      outer.setAlpha(0.26).setVisible(true).setDepth(44);

      const core = (this.mgTracerCorePool.pop() ?? this.scene.add.line(0, 0, 0, 0, 0, 0, 0xffffff, 0.85).setOrigin(0).setDepth(45)) as any;
      core.setTo(x, y, ex, ey);
      if (core.setStrokeStyle) core.setStrokeStyle(3.5, 0xffffff, 0.9);
      if (core.setLineWidth) core.setLineWidth(3.5);
      core.setAlpha(0.9).setVisible(true).setDepth(45);

      {
        const steps = 12;
        let prevY = y;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const px = Phaser.Math.Linear(x, ex, t);
          const py = Phaser.Math.Linear(y, ey, t);
          const waterY = this.scene.getWaterSurfaceY(px);
          if (waterY !== null && prevY <= waterY && py >= waterY) {
            this.createWaterSplash(px, waterY + 2, 260);
            break;
          }
          prevY = py;
        }
      }

      const now = this.scene.time.now;
      this.activeMgTracers.push({ outer, core, start: now, end: now + 140 });
  }

  public createAPImpact(x: number, y: number, angle: number) {
      this.spawnCinematicGlow(x, y, {
        radius: 58,
        color: 0xffc796,
        alpha: 0.34,
        durationMs: 240,
        depth: 112,
        scaleMul: 2.0
      });
      this.spawnSoftShockRing(x, y, {
        radius: 78,
        color: 0xffbd86,
        alpha: 0.2,
        durationMs: 240,
        depth: 111,
        expand: 4.3,
        anisotropy: 0.52,
        rotation: angle
      });
      this.spawnSoftShockRing(x, y, {
        radius: 92,
        color: 0xffd5a6,
        alpha: 0.11,
        durationMs: 320,
        depth: 110,
        expand: 4.9,
        anisotropy: 0.62,
        rotation: angle
      });

      const streakA = this.scene.add.ellipse(x, y, 12, 4, 0xfff2d6, 0.75).setDepth(113);
      const streakB = this.scene.add.ellipse(x, y, 12, 4, 0xffc988, 0.58).setDepth(112);
      streakA.setBlendMode(Phaser.BlendModes.ADD);
      streakB.setBlendMode(Phaser.BlendModes.ADD);
      streakA.setRotation(angle + 0.12);
      streakB.setRotation(angle - 0.12);
      this.scene.tweens.add({ targets: streakA, alpha: 0, scaleX: 36, scaleY: 2.1, duration: 140, ease: 'Quad.out', onComplete: () => streakA.destroy() });
      this.scene.tweens.add({ targets: streakB, alpha: 0, scaleX: 30, scaleY: 1.9, duration: 165, ease: 'Quad.out', onComplete: () => streakB.destroy() });

      const needleA = this.scene.add.ellipse(x, y, 14, 4, 0xff2840, 0.52).setDepth(114);
      const needleB = this.scene.add.ellipse(x, y, 14, 4, 0xffe8f2, 0.56).setDepth(115);
      needleA.setBlendMode(Phaser.BlendModes.ADD);
      needleB.setBlendMode(Phaser.BlendModes.ADD);
      needleA.setRotation(angle);
      needleB.setRotation(angle + 0.08);
      this.scene.tweens.add({ targets: needleA, alpha: 0, scaleX: 82, scaleY: 2.15, duration: 150, ease: 'Quad.out', onComplete: () => needleA.destroy() });
      this.scene.tweens.add({ targets: needleB, alpha: 0, scaleX: 58, scaleY: 1.9, duration: 165, ease: 'Quad.out', onComplete: () => needleB.destroy() });

      const deg = Phaser.Math.RadToDeg(angle);
      const sparkTex = this.scene.textures.exists('spark_hd') ? 'spark_hd' : 'spark';
      const sparks = this.scene.add.particles(x, y, 'spark', {
          speed: { min: 880, max: 2200 },
          angle: { min: deg - 130, max: deg + 130 },
          scale: { start: 2.15, end: 0 },
          alpha: { start: 1, end: 0 },
          lifespan: { min: 220, max: 500 },
          quantity: this.q(118),
          emitting: false,
          tint: [0xfff4df, 0xffdfb5, 0xffbf7a, 0xff934f],
          blendMode: 'ADD',
          gravityY: 1350
      }).setDepth(46);
      sparks.explode();

      const jet = this.scene.add.particles(x, y, 'spark', {
          speed: { min: 1500, max: 3200 },
          angle: { min: deg - 10, max: deg + 10 },
          scale: { start: 2.25, end: 0 },
          alpha: { start: 1, end: 0 },
          lifespan: { min: 110, max: 230 },
          quantity: this.q(28),
          emitting: false,
          tint: [0xfff0e0, 0xffd5a5, 0xff9d63],
          blendMode: 'ADD',
          gravityY: 920
      }).setDepth(47);
      jet.explode();

      const glitter = this.scene.add.particles(x, y, sparkTex, {
          speed: { min: 520, max: 1800 },
          angle: { min: deg - 170, max: deg + 170 },
          scale: { start: 1.0, end: 0 },
          alpha: { start: 0.82, end: 0 },
          lifespan: { min: 130, max: 340 },
          quantity: this.q(92),
          emitting: false,
          tint: [0xffffff, 0xfff0cf, 0xffcb8f],
          blendMode: 'ADD',
          gravityY: 1100
      }).setDepth(48);
      glitter.explode();

      const slagTex = this.scene.textures.exists('brick_metal') ? 'brick_metal' : 'brick_concrete';
      const slag = this.scene.add.particles(x, y, slagTex, {
          speed: { min: 180, max: 640 },
          angle: { min: deg - 165, max: deg + 165 },
          scale: { start: 0.18, end: 0.05 },
          alpha: { start: 0.72, end: 0 },
          lifespan: { min: 400, max: 980 },
          quantity: this.q(5),
          emitting: false,
          tint: [0x7a7a7a, 0x4a4a4a, 0x2a2a2a],
          gravityY: 1600
      }).setDepth(42);
      slag.explode();

      const smoke = this.scene.add.particles(x - Math.cos(angle) * 10, y - Math.sin(angle) * 10, 'smoke_puff', {
          speed: { min: 30, max: 160 },
          angle: { min: deg + 150, max: deg + 210 },
          scale: { start: 0.55, end: 2.8 },
          alpha: { start: 0.16, end: 0 },
          lifespan: { min: 800, max: 1800 },
          quantity: 14,
          emitting: false,
          tint: [0x8b8f96, 0x5b5f66, 0x2a2a2a],
          gravityY: -40
      }).setDepth(44);
      smoke.explode();
      this.applyWindToEmitter(smoke as any, y, 0.12);

      this.scene.time.delayedCall(1900, () => { sparks.destroy(); jet.destroy(); glitter.destroy(); slag.destroy(); smoke.destroy(); });
  }


  public createAPImpactHeavy(x: number, y: number, angle: number) {
      this.spawnCinematicGlow(x, y, {
        radius: 74,
        color: 0xffc38a,
        alpha: 0.4,
        durationMs: 340,
        depth: 112,
        scaleMul: 2.25
      });
      this.spawnSoftShockRing(x, y, {
        radius: 94,
        color: 0xffba7f,
        alpha: 0.24,
        durationMs: 340,
        depth: 111,
        expand: 4.6,
        anisotropy: 0.54,
        rotation: angle
      });
      this.spawnSoftShockRing(x, y, {
        radius: 118,
        color: 0xffd7ac,
        alpha: 0.13,
        durationMs: 440,
        depth: 110,
        expand: 5.1,
        anisotropy: 0.66,
        rotation: angle
      });

      const deg = Phaser.Math.RadToDeg(angle);
      const sparkTex = this.scene.textures.exists('spark_hd') ? 'spark_hd' : 'spark';
      const pierce = this.scene.add.ellipse(x, y, 14, 4, 0xfff3df, 0.82).setDepth(113);
      pierce.setBlendMode(Phaser.BlendModes.ADD);
      pierce.setRotation(angle);
      this.scene.tweens.add({ targets: pierce, alpha: 0, scaleX: 56, scaleY: 2.4, duration: 150, ease: 'Quad.out', onComplete: () => pierce.destroy() });

      const sparks = this.scene.add.particles(x, y, 'spark', {
          speed: { min: 920, max: 2600 },
          angle: { min: deg - 145, max: deg + 145 },
          scale: { start: 2.35, end: 0 },
          alpha: { start: 1, end: 0 },
          lifespan: { min: 220, max: 520 },
          quantity: this.q(196),
          emitting: false,
          tint: [0xfff4df, 0xffdfb2, 0xffbf7a, 0xff8f52],
          blendMode: 'ADD',
          gravityY: 1450
      }).setDepth(46);
      sparks.explode();

      const jet = this.scene.add.particles(x, y, 'spark', {
          speed: { min: 1800, max: 3600 },
          angle: { min: deg - 9, max: deg + 9 },
          scale: { start: 2.4, end: 0 },
          alpha: { start: 1, end: 0 },
          lifespan: { min: 110, max: 240 },
          quantity: this.q(44),
          emitting: false,
          tint: [0xfff4e2, 0xffdeb6, 0xffa66e],
          blendMode: 'ADD',
          gravityY: 960
      }).setDepth(47);
      jet.explode();

      const glitter = this.scene.add.particles(x, y, sparkTex, {
          speed: { min: 560, max: 2100 },
          angle: { min: deg - 175, max: deg + 175 },
          scale: { start: 1.15, end: 0 },
          alpha: { start: 0.85, end: 0 },
          lifespan: { min: 120, max: 360 },
          quantity: this.q(170),
          emitting: false,
          tint: [0xffffff, 0xfff0cf, 0xffcf97],
          blendMode: 'ADD',
          gravityY: 1120
      }).setDepth(48);
      glitter.explode();

      const slagTex = this.scene.textures.exists('brick_metal') ? 'brick_metal' : 'brick_concrete';
      const slag = this.scene.add.particles(x, y, slagTex, {
          speed: { min: 220, max: 780 },
          angle: { min: deg - 165, max: deg + 165 },
          scale: { start: 0.2, end: 0.05 },
          alpha: { start: 0.72, end: 0 },
          lifespan: { min: 430, max: 1080 },
          quantity: this.q(8),
          emitting: false,
          tint: [0x787878, 0x515151, 0x2f2f2f],
          gravityY: 1600
      }).setDepth(42);
      slag.explode();

      const smoke = this.scene.add.particles(x - Math.cos(angle) * 12, y - Math.sin(angle) * 12, 'smoke_puff', {
          speed: { min: 40, max: 200 },
          angle: { min: deg + 150, max: deg + 210 },
          scale: { start: 0.75, end: 3.6 },
          alpha: { start: 0.18, end: 0 },
          lifespan: { min: 1200, max: 2400 },
          quantity: 18,
          emitting: false,
          tint: [0x8b8f96, 0x5b5f66, 0x2a2a2a],
          gravityY: -60
      }).setDepth(44);
      smoke.explode();
      this.applyWindToEmitter(smoke as any, y, 0.14);

      this.scene.time.delayedCall(2100, () => { sparks.destroy(); jet.destroy(); glitter.destroy(); slag.destroy(); smoke.destroy(); });
  }


  public createShellTrail(shell: Phaser.GameObjects.Sprite, stype: ShellType) {
      if (this.destroyed) return;
      if (!shell?.active) return;
      if (stype === ShellType.BULLET) return;

      const waterY = this.scene.getWaterSurfaceY(shell.x);
      const inWater = !!shell.getData('inWater') || (waterY !== null && shell.y > waterY + 2);
      if (inWater) return;

      const owner = shell.getData('owner') as any;
      const ownerIsPlayer = !!owner?.isPlayer;

      const managers: Array<{ destroy: () => void }> = [];
      const tailPersistMs =
        stype === ShellType.AP ? 2400 :
        stype === ShellType.STANDARD ? 2600 :
        stype === ShellType.HE ? 3800 :
        stype === ShellType.INCENDIARY ? 3800 :
        stype === ShellType.MORTAR ? 2600 :
        stype === ShellType.NUKE ? 5200 :
        2400;

      const stopAndDestroyLater = (mgr: any) => {
        try { mgr?.emitters?.list?.forEach?.((e: any) => e?.stop?.()); } catch {}
        try { mgr?.stop?.(); } catch {}
        try { mgr?.stopFollow?.(); } catch {}
        this.scene.time.delayedCall(Math.max(0, tailPersistMs), () => { try { mgr?.destroy?.(); } catch {} });
      };

      const push = (m: any, destroy?: () => void) => {
        if (!m) return;
        const d = destroy ?? (() => {
          if ((m as any)?.emitters) stopAndDestroyLater(m);
          else m?.destroy?.();
        });
        managers.push({ destroy: d });
      };

      const bright2 = (c: number) => {
        const col = Phaser.Display.Color.ValueToColor(c);
        return Phaser.Display.Color.GetColor(
          Math.min(255, col.red * 2),
          Math.min(255, col.green * 2),
          Math.min(255, col.blue * 2)
        );
      };
      const brightArr = (arr: number[]) => arr.map(bright2);

      let tint = bright2(0xffffff);
      if (stype === ShellType.AP) tint = bright2(0x6d28d9);
      else if (stype === ShellType.HE) tint = bright2(0xcfeaff);
      else if (stype === ShellType.INCENDIARY) tint = bright2(0xffb36a);
      else if (stype === ShellType.MORTAR) tint = bright2(0xf2ead8);
      else if (stype === ShellType.NUKE) tint = bright2(0xd7b3ff);

      const shellDepth = (shell as any)?.depth as number | undefined;
      const fxDepth = Number.isFinite(shellDepth) ? Math.max(0, (shellDepth as number) - 1) : 29;
      const baseScale = Phaser.Math.Clamp(((shell as any)?.scaleX as number | undefined) ?? 1, 0.35, 3.0);

      const microGlintA = this.scene.add.image(shell.x, shell.y, 'spark_hd').setDepth(fxDepth);
      microGlintA.setBlendMode(Phaser.BlendModes.ADD);
      microGlintA.setTint(tint);
      microGlintA.setAlpha(ownerIsPlayer ? 0.095 : 0.08);
      microGlintA.setScale(0.22 * baseScale);
      push(microGlintA);

      const microGlintB = this.scene.add.image(shell.x, shell.y, 'spark_hd').setDepth(fxDepth);
      microGlintB.setBlendMode(Phaser.BlendModes.ADD);
      microGlintB.setTint(0xffffff);
      microGlintB.setAlpha(0.06);
      microGlintB.setScale(0.12 * baseScale);
      push(microGlintB);

      let apReflectA: Phaser.GameObjects.Ellipse | undefined;
      let apReflectB: Phaser.GameObjects.Ellipse | undefined;
      let apHeat: Phaser.GameObjects.Ellipse | undefined;
      let apShock: Phaser.GameObjects.Ellipse | undefined;
      let apRedLine: Phaser.GameObjects.Graphics | undefined;
      let glowCore: Phaser.GameObjects.Ellipse | undefined;
      let glowHalo: Phaser.GameObjects.Ellipse | undefined;
      if (stype === ShellType.AP) {
        apReflectA = this.scene.add.ellipse(shell.x, shell.y, 18, 6, bright2(0xf3e8ff), 0.06).setDepth(fxDepth) as any;
        apReflectA.setBlendMode(Phaser.BlendModes.ADD);
        apReflectB = this.scene.add.ellipse(shell.x, shell.y, 42, 14, bright2(0xd8b4fe), 0.035).setDepth(fxDepth) as any;
        apReflectB.setBlendMode(Phaser.BlendModes.ADD);
        apHeat = this.scene.add.ellipse(shell.x, shell.y, 46, 20, bright2(0xf3e8ff), 0.030).setDepth(Math.max(0, fxDepth - 1)) as any;
        apHeat.setBlendMode(Phaser.BlendModes.SCREEN);
        apShock = this.scene.add.ellipse(shell.x, shell.y, 62, 22, bright2(0xd8b4fe), 0.030).setDepth(Math.max(0, fxDepth - 2)) as any;
        apShock.setBlendMode(Phaser.BlendModes.ADD);
        apRedLine = this.scene.add.graphics().setDepth(fxDepth + 0.2) as any;
        push(apReflectA);
        push(apReflectB);
        push(apHeat);
        push(apShock);
        push(apRedLine);
      }

      const microTrail = this.scene.add.particles(0, 0, 'spark', {
        speed: { min: 6, max: 28 },
        angle: { min: 0, max: 360 },
        scale: { start: 0.24 * baseScale, end: 0 },
        alpha: { start: ownerIsPlayer ? 0.13 : 0.10, end: 0 },
        lifespan: { min: 140, max: 260 },
        quantity: 1,
        frequency: ownerIsPlayer ? 44 : 55,
        tint: stype === ShellType.AP ? brightArr([0xf3e8ff, 0xd8b4fe, 0x6d28d9]) : [bright2(0xffffff), tint],
        blendMode: 'ADD'
      }).setDepth(fxDepth);
      (microTrail as any).startFollow(shell);
      push(microTrail, () => stopAndDestroyLater(microTrail));

      if (ownerIsPlayer) {
        const wakeTint =
          stype === ShellType.AP ? brightArr([0xf3e8ff, 0xd8b4fe, 0x6d28d9, 0x3b2b4a]) :
          stype === ShellType.INCENDIARY ? brightArr([0xfff2cc, 0xffd77a, 0xffb84d]) :
          brightArr([0xe6f2ff, 0xcfc7bb, 0xa39a8f, 0x5b5f66]);
        const wake = this.scene.add.particles(0, 0, 'smoke_puff', {
          speed: { min: 8, max: 55 },
          angle: { min: 150, max: 210 },
          scale: { start: 0.18 * baseScale, end: 0.95 * baseScale },
          alpha: { start: stype === ShellType.AP ? 0.14 : 0.16, end: 0 },
          lifespan: { min: 900, max: 2200 },
          quantity: 1,
          frequency: stype === ShellType.AP ? 16 : 20,
          tint: wakeTint,
          gravityY: -18
        }).setDepth(Math.max(0, fxDepth - 1));
        (wake as any).startFollow(shell);
        push(wake, () => stopAndDestroyLater(wake));
      }

      let tracerEveryMs = 0;
      let tracerOuter = 0xffffff;
      let tracerCore = 0xffffff;
      let tracerGlow = 0xffffff;
      let tracerOuterWidth = 10;
      let tracerCoreWidth = 3;
      let tracerGlowWidth = 0;
      let tracerOuterAlpha = 0.20;
      let tracerCoreAlpha = 0.75;
      let tracerGlowAlpha = 0;
      let tracerLenMult = 0.11;
      let tracerLenMin = 240;
      let tracerLenMax = 720;
      let airEveryMs = 0;
      let airColor = 0xffffff;
      let airAlpha = 0;
      let glowCoreColor = 0xffffff;
      let glowCoreAlpha = 0;
      let glowCoreW = 0;
      let glowCoreH = 0;
      let glowHaloColor = 0xffffff;
      let glowHaloAlpha = 0;
      let glowHaloW = 0;
      let glowHaloH = 0;

      if (stype === ShellType.AP) {
        const smoke = this.scene.add.particles(0, 0, 'smoke_puff', {
          speed: { min: 6, max: 38 },
          angle: { min: 150, max: 210 },
          scale: { start: 0.14, end: 1.05 },
          alpha: { start: 0.12, end: 0 },
          lifespan: { min: 1200, max: 2000 },
          quantity: 1,
          frequency: ownerIsPlayer ? 26 : 36,
          tint: brightArr([0xf3e8ff, 0xd8b4fe, 0x6d28d9, 0x3b2b4a, 0x6b6f75]),
          gravityY: -68
        }).setDepth(26);
        (smoke as any).startFollow(shell);
        push(smoke, () => stopAndDestroyLater(smoke));

        const grit = this.scene.add.particles(0, 0, 'spark', {
          speed: { min: 120, max: 460 },
          angle: { min: 168, max: 192 },
          scale: { start: 0.95, end: 0 },
          alpha: { start: 0.30, end: 0 },
          lifespan: { min: 90, max: 220 },
          quantity: 1,
          frequency: ownerIsPlayer ? 40 : 52,
          tint: brightArr([0xf3e8ff, 0xd8b4fe, 0x6d28d9]),
          blendMode: 'ADD'
        }).setDepth(27);
        (grit as any).startFollow(shell);
        push(grit, () => stopAndDestroyLater(grit));

        const tracer = this.scene.add.particles(0, 0, 'spark', {
          speed: { min: 650, max: 1700 },
          angle: { min: 164, max: 196 },
          scale: { start: 1.35, end: 0 },
          alpha: { start: 0.58, end: 0 },
          lifespan: { min: 900, max: 2000 },
          quantity: 1,
          frequency: ownerIsPlayer ? 14 : 18,
          tint: brightArr([0xf3e8ff, 0xd8b4fe, 0x6d28d9]),
          blendMode: 'ADD',
          accelerationX: { min: -240, max: 240 },
          accelerationY: { min: -980, max: 980 }
        }).setDepth(28);
        (tracer as any).startFollow(shell);
        push(tracer, () => stopAndDestroyLater(tracer));

        tracerEveryMs = 0;
        airEveryMs = 18;
        airColor = bright2(0xd8b4fe);
        airAlpha = 0.12;
        glowCoreColor = bright2(0xf3e8ff);
        glowCoreAlpha = 0.18;
        glowCoreW = 26;
        glowCoreH = 12;
        glowHaloColor = bright2(0xd8b4fe);
        glowHaloAlpha = 0.05;
        glowHaloW = 110;
        glowHaloH = 40;
      } else if (stype === ShellType.STANDARD) {
        const smoke = this.scene.add.particles(0, 0, 'smoke_puff', {
          speed: { min: 10, max: 70 },
          angle: { min: 150, max: 210 },
          scale: { start: 0.30, end: ownerIsPlayer ? 1.75 : 1.35 },
          alpha: { start: ownerIsPlayer ? 0.30 : 0.22, end: 0 },
          lifespan: { min: 520, max: ownerIsPlayer ? 2000 : 1500 },
          quantity: 1,
          frequency: ownerIsPlayer ? 16 : 22,
          tint: brightArr([0x9aa3aa, 0x7b8087, 0x4a4f56]),
          gravityY: -22
        }).setDepth(26);
        (smoke as any).startFollow(shell);
        push(smoke);

        const flash = this.scene.add.particles(0, 0, 'spark', {
          speed: { min: 30, max: 120 },
          angle: { min: 165, max: 195 },
          scale: { start: 0.75, end: 0 },
          alpha: { start: 0.22, end: 0 },
          lifespan: { min: 90, max: 160 },
          quantity: 1,
          frequency: 90,
          tint: brightArr([0xffffff, 0xfff2cc, 0xffd77a]),
          blendMode: 'ADD'
        }).setDepth(27);
        (flash as any).startFollow(shell);
        push(flash);

        tracerEveryMs = ownerIsPlayer ? 0 : 55;
        tracerOuter = bright2(0xffd77a);
        tracerCore = bright2(0xffffff);
        tracerGlow = bright2(0xffaa55);
        tracerOuterWidth = 8;
        tracerCoreWidth = 3;
        tracerGlowWidth = 22;
        tracerOuterAlpha = 0.12;
        tracerCoreAlpha = 0.65;
        tracerGlowAlpha = 0.10;
        tracerLenMult = 0.105;
        tracerLenMin = 210;
        tracerLenMax = 620;
        airEveryMs = 0;
        glowCoreColor = bright2(0xfff2cc);
        glowCoreAlpha = 0.38;
        glowCoreW = 20;
        glowCoreH = 10;
        glowHaloColor = bright2(0xffc45a);
        glowHaloAlpha = 0.12;
        glowHaloW = 64;
        glowHaloH = 26;
      } else if (stype === ShellType.HE) {
        const smoke = this.scene.add.particles(0, 0, 'smoke_puff', {
          speed: { min: 14, max: 95 },
          angle: { min: 150, max: 210 },
          scale: { start: 0.40, end: ownerIsPlayer ? 2.65 : 2.20 },
          alpha: { start: ownerIsPlayer ? 0.30 : 0.24, end: 0 },
          lifespan: { min: 1200, max: ownerIsPlayer ? 3400 : 2800 },
          quantity: 1,
          frequency: ownerIsPlayer ? 12 : 16,
          tint: brightArr([0xffffff, 0xe6f2ff, 0xccedff]),
          gravityY: -22
        }).setDepth(25);
        (smoke as any).startFollow(shell);
        push(smoke);

        const flame = this.scene.add.particles(0, 0, 'spark', {
          speed: { min: 30, max: 220 },
          angle: { min: 155, max: 205 },
          scale: { start: 1.35, end: 0 },
          alpha: { start: 0.36, end: 0 },
          lifespan: { min: 110, max: 260 },
          quantity: 1,
          frequency: 22,
          tint: brightArr([0xffffff, 0xfff7da, 0xffe6a6]),
          blendMode: 'ADD'
        }).setDepth(27);
        (flame as any).startFollow(shell);
        push(flame);

        tracerEveryMs = ownerIsPlayer ? 0 : 60;
        tracerOuter = bright2(0xe6f2ff);
        tracerCore = bright2(0xffffff);
        tracerGlow = bright2(0xbbefff);
        tracerOuterWidth = 8;
        tracerCoreWidth = 3;
        tracerGlowWidth = 18;
        tracerOuterAlpha = 0.10;
        tracerCoreAlpha = 0.55;
        tracerGlowAlpha = 0.08;
        tracerLenMult = 0.10;
        tracerLenMin = 220;
        tracerLenMax = 720;
        airEveryMs = 0;
        glowCoreColor = bright2(0xe6f2ff);
        glowCoreAlpha = 0.36;
        glowCoreW = 22;
        glowCoreH = 12;
        glowHaloColor = bright2(0xbbefff);
        glowHaloAlpha = 0.10;
        glowHaloW = 70;
        glowHaloH = 30;
      } else if (stype === ShellType.INCENDIARY) {
        const flame = this.scene.add.particles(0, 0, 'spark', {
          speed: { min: 20, max: 150 },
          angle: { min: 150, max: 210 },
          scale: { start: 1.8, end: 0 },
          alpha: { start: 0.75, end: 0 },
          lifespan: { min: 140, max: 420 },
          quantity: 3,
          frequency: 18,
          tint: brightArr([0xffffff, 0xfff2cc, 0xffb84d, 0xff6a00, 0xff2200]),
          blendMode: 'ADD'
        }).setDepth(28);
        (flame as any).startFollow(shell);
        push(flame);

        const smoke = this.scene.add.particles(0, 0, 'smoke_puff', {
          speed: { min: 10, max: 65 },
          angle: { min: 150, max: 210 },
          scale: { start: 0.14, end: ownerIsPlayer ? 0.72 : 0.55 },
          alpha: { start: ownerIsPlayer ? 0.18 : 0.14, end: 0 },
          lifespan: { min: 1100, max: ownerIsPlayer ? 3400 : 2900 },
          quantity: 1,
          frequency: ownerIsPlayer ? 18 : 26,
          tint: brightArr([0x6b6b6b, 0x3a3a3a, 0x1a1a1a]),
          gravityY: -10
        }).setDepth(25);
        (smoke as any).startFollow(shell);
        push(smoke);

        const ember = this.scene.add.particles(0, 0, 'spark', {
          speed: { min: 26, max: 190 },
          angle: { min: 155, max: 205 },
          scale: { start: 1.2, end: 0 },
          alpha: { start: 0.55, end: 0 },
          lifespan: { min: 140, max: 520 },
          quantity: 1,
          frequency: 40,
          tint: brightArr([0xfff2cc, 0xffb84d, 0xff6a00, 0xff2200]),
          blendMode: 'ADD'
        }).setDepth(27);
        (ember as any).startFollow(shell);
        push(ember);

        tracerEveryMs = ownerIsPlayer ? 0 : 42;
        tracerOuter = bright2(0xff8844);
        tracerCore = bright2(0xffffff);
        tracerGlow = bright2(0xff6a00);
        tracerOuterWidth = 10;
        tracerCoreWidth = 3;
        tracerGlowWidth = 26;
        tracerOuterAlpha = 0.13;
        tracerCoreAlpha = 0.60;
        tracerGlowAlpha = 0.12;
        tracerLenMult = 0.14;
        tracerLenMin = 260;
        tracerLenMax = 780;
        airEveryMs = 140;
        airColor = bright2(0xff6a00);
        airAlpha = 0.07;
        glowCoreColor = bright2(0xff6a00);
        glowCoreAlpha = 0.55;
        glowCoreW = 24;
        glowCoreH = 12;
        glowHaloColor = bright2(0xffc45a);
        glowHaloAlpha = 0.14;
        glowHaloW = 88;
        glowHaloH = 34;
      } else if (stype === ShellType.MORTAR) {
        const smoke = this.scene.add.particles(0, 0, 'smoke_puff', {
          speed: { min: 18, max: 90 },
          angle: { min: 150, max: 210 },
          scale: { start: 0.40, end: ownerIsPlayer ? 2.05 : 1.65 },
          alpha: { start: ownerIsPlayer ? 0.24 : 0.18, end: 0 },
          lifespan: { min: 520, max: ownerIsPlayer ? 2200 : 1600 },
          quantity: 1,
          frequency: ownerIsPlayer ? 14 : 18,
          tint: brightArr([0x8a8f97, 0x5b5f66, 0x2a2a2a]),
          gravityY: -14
        }).setDepth(25);
        (smoke as any).startFollow(shell);
        push(smoke);

        const embers = this.scene.add.particles(0, 0, 'spark', {
          speed: { min: 12, max: 60 },
          angle: { min: 150, max: 210 },
          scale: { start: 0.8, end: 0 },
          alpha: { start: 0.22, end: 0 },
          lifespan: { min: 220, max: 560 },
          quantity: 1,
          frequency: 140,
          tint: brightArr([0xfff2cc, 0xffaa55, 0xff6a00]),
          blendMode: 'ADD'
        }).setDepth(26);
        (embers as any).startFollow(shell);
        push(embers);

        tracerEveryMs = ownerIsPlayer ? 0 : 80;
        tracerOuter = bright2(0xffffff);
        tracerCore = bright2(0xffffff);
        tracerGlow = bright2(0xffffff);
        tracerOuterWidth = 7;
        tracerCoreWidth = 3;
        tracerGlowWidth = 16;
        tracerOuterAlpha = 0.08;
        tracerCoreAlpha = 0.42;
        tracerGlowAlpha = 0.05;
        tracerLenMult = 0.10;
        tracerLenMin = 220;
        tracerLenMax = 660;
        airEveryMs = 180;
        airColor = bright2(0xffffff);
        airAlpha = 0.05;
        glowCoreColor = bright2(0xffffff);
        glowCoreAlpha = 0.24;
        glowCoreW = 18;
        glowCoreH = 10;
        glowHaloColor = bright2(0xffffff);
        glowHaloAlpha = 0.08;
        glowHaloW = 58;
        glowHaloH = 22;
      } else if (stype === ShellType.NUKE) {
        const smoke = this.scene.add.particles(0, 0, 'smoke_puff', {
          speed: { min: 22, max: 140 },
          angle: { min: 150, max: 210 },
          scale: { start: 1.0, end: ownerIsPlayer ? 5.2 : 4.6 },
          alpha: { start: ownerIsPlayer ? 0.30 : 0.26, end: 0 },
          lifespan: { min: 1200, max: ownerIsPlayer ? 4000 : 3400 },
          quantity: 3,
          frequency: ownerIsPlayer ? 14 : 16,
          tint: brightArr([0x61676f, 0x2a2d33, 0x0e0e0e]),
          gravityY: -6
        }).setDepth(25);
        (smoke as any).startFollow(shell);
        push(smoke);

        const plume = this.scene.add.particles(0, 0, 'smoke_puff', {
          speed: { min: 12, max: 90 },
          angle: { min: 150, max: 210 },
          scale: { start: 0.75, end: 3.4 },
          alpha: { start: 0.16, end: 0 },
          lifespan: { min: 820, max: 2400 },
          quantity: 1,
          frequency: 42,
          tint: brightArr([0xdedede, 0xcfc7bb, 0xa39a8f]),
          gravityY: -18
        }).setDepth(24);
        (plume as any).startFollow(shell);
        push(plume);

        const sparks = this.scene.add.particles(0, 0, 'spark', {
          speed: { min: 30, max: 220 },
          angle: { min: 160, max: 200 },
          scale: { start: 2.4, end: 0 },
          alpha: { start: 0.70, end: 0 },
          lifespan: { min: 140, max: 420 },
          quantity: 3,
          frequency: 26,
          tint: brightArr([0xffffff, 0xfff2cc, 0xffb84d, 0xff6a00, 0xff3311]),
          blendMode: 'ADD',
          gravityY: 520
        }).setDepth(28);
        (sparks as any).startFollow(shell);
        push(sparks);

        tracerEveryMs = 70;
        tracerOuter = bright2(0xffc45a);
        tracerCore = bright2(0xffffff);
        tracerGlow = bright2(0xff6a00);
        tracerOuterWidth = 12;
        tracerCoreWidth = 4;
        tracerGlowWidth = 42;
        tracerOuterAlpha = 0.10;
        tracerCoreAlpha = 0.52;
        tracerGlowAlpha = 0.08;
        tracerLenMult = 0.12;
        tracerLenMin = 340;
        tracerLenMax = 980;
        airEveryMs = 110;
        airColor = bright2(0xff6a00);
        airAlpha = 0.06;
        glowCoreColor = bright2(0xfff2b8);
        glowCoreAlpha = 0.55;
        glowCoreW = 30;
        glowCoreH = 14;
        glowHaloColor = bright2(0xff6a00);
        glowHaloAlpha = 0.14;
        glowHaloW = 120;
        glowHaloH = 44;
      }

      tracerEveryMs = 0;
      if (stype !== ShellType.AP) {
        airEveryMs = 0;
        glowCoreAlpha = 0;
        glowHaloAlpha = 0;
      }

      if (glowHaloAlpha > 0 && glowHaloW > 0 && glowHaloH > 0) {
        glowHalo = this.scene.add.ellipse(shell.x, shell.y, glowHaloW, glowHaloH, glowHaloColor, glowHaloAlpha).setDepth(33) as any;
        glowHalo.setBlendMode(Phaser.BlendModes.ADD);
        push(glowHalo);
      }
      if (glowCoreAlpha > 0 && glowCoreW > 0 && glowCoreH > 0) {
        glowCore = this.scene.add.ellipse(shell.x, shell.y, glowCoreW, glowCoreH, glowCoreColor, glowCoreAlpha).setDepth(34) as any;
        glowCore.setBlendMode(Phaser.BlendModes.ADD);
        push(glowCore);
      }

      const rec = {
        shell,
        stype,
        ownerIsPlayer,
        baseScale,
        microGlintA,
        microGlintB,
        apReflectA,
        apReflectB,
        apHeat,
        apShock,
        apRedLine,
        managers,
        lastTracerT: this.scene.time.now,
        lastAirT: this.scene.time.now,
        tracerEveryMs,
        airEveryMs,
        tracerOuter,
        tracerCore,
        tracerGlow,
        tracerOuterWidth,
        tracerCoreWidth,
        tracerGlowWidth,
        tracerOuterAlpha,
        tracerCoreAlpha,
        tracerGlowAlpha,
        tracerLenMult,
        tracerLenMin,
        tracerLenMax,
        airColor,
        airAlpha,
        glowCore,
        glowHalo,
        glowCoreW,
        glowCoreH,
        glowHaloW,
        glowHaloH
      };

      this.activeShellTrails.push(rec);
      (shell as any).once?.(Phaser.GameObjects.Events.DESTROY, () => {
        const idx = this.activeShellTrails.indexOf(rec);
        if (idx >= 0) this.activeShellTrails.splice(idx, 1);
        for (const m of managers) m.destroy();
      });
  }

  public createDirtImpact(x: number, y: number) {
    const dirt = this.scene.add.particles(x, y, 'smoke_puff', {
        speed: { min: 50, max: 200 },
        angle: { min: 200, max: 340 },
        scale: { start: 0.7, end: 1.35 },
        alpha: { start: 0.32, end: 0 },
        lifespan: { min: 420, max: 780 },
        quantity: 4,
        emitting: false,
        tint: [0x5a4a3a, 0x3a2a1a],
        gravityY: 400
    }).setDepth(90);
    dirt.explode();
    this.scene.time.delayedCall(1000, () => dirt.destroy());

    const debris = this.scene.add.particles(x, y, 'brick_concrete', {
        speed: { min: 100, max: 300 },
        angle: { min: 200, max: 340 },
        scale: { start: 0.3, end: 0.1 },
        lifespan: 600,
        quantity: 5,
        emitting: false,
        tint: [0x4a3a2a, 0x2a1a0a],
        gravityY: 800
    }).setDepth(91);
    debris.explode();
    this.scene.time.delayedCall(1000, () => debris.destroy());
  }

  public createConcreteDust(x: number, y: number, type: "impact" | "collapse") {
      const isCollapse = type === "collapse";

      const microDust = this.scene.add.particles(x, y, 'smoke_puff', {
          speed: isCollapse ? { min: 80, max: 320 } : { min: 60, max: 220 },
          angle: isCollapse ? { min: 165, max: 375 } : { min: 195, max: 345 },
          scale: isCollapse ? { start: 0.24, end: 0.95 } : { start: 0.12, end: 0.58 },
          alpha: isCollapse ? { start: 0.24, end: 0 } : { start: 0.20, end: 0 },
          lifespan: isCollapse ? { min: 800, max: 2200 } : { min: 260, max: 760 },
          quantity: isCollapse ? 34 : 10,
          emitting: false,
          tint: [0x8f8f8f, 0x747474, 0x5d5d5d],
          gravityY: isCollapse ? 220 : 460
      }).setDepth(isCollapse ? 107 : 95);
      microDust.explode();

      const concreteGrains = this.scene.add.particles(x, y - 4, 'brick_concrete', {
          speed: isCollapse ? { min: 140, max: 460 } : { min: 120, max: 300 },
          angle: isCollapse ? { min: 185, max: 355 } : { min: 205, max: 335 },
          scale: isCollapse ? { start: 0.30, end: 0.08 } : { start: 0.18, end: 0.05 },
          alpha: { start: 1, end: 0.16 },
          lifespan: isCollapse ? { min: 900, max: 2100 } : { min: 520, max: 980 },
          quantity: isCollapse ? 30 : 8,
          emitting: false,
          tint: [0x8a8a8a, 0x6a6a6a, 0x4a4a4a],
          gravityY: isCollapse ? 1300 : 980,
          rotate: { min: 0, max: 360 }
      }).setDepth(isCollapse ? 110 : 96);
      concreteGrains.explode();

      if (isCollapse) {
          const rollingDust = this.scene.add.particles(x, y + 8, 'smoke_puff', {
              speedX: { min: -420, max: 420 },
              speedY: { min: -40, max: 120 },
              scale: { start: 0.20, end: 1.35 },
              alpha: { start: 0.18, end: 0 },
              lifespan: { min: 1100, max: 2300 },
              quantity: 24,
              emitting: false,
              tint: [0x7a746b, 0x5e5850, 0x423f38],
              gravityY: 260
          }).setDepth(106);
          rollingDust.explode();

          this.scene.time.delayedCall(420, () => {
              const aftershock = this.scene.add.particles(x, y + 12, 'brick_concrete', {
                  speed: { min: 90, max: 280 },
                  angle: { min: 200, max: 340 },
                  scale: { start: 0.22, end: 0.06 },
                  alpha: { start: 1, end: 0.08 },
                  lifespan: { min: 700, max: 1500 },
                  quantity: 18,
                  emitting: false,
                  tint: [0x7a7a7a, 0x5c5c5c],
                  gravityY: 1180,
                  rotate: { min: 0, max: 360 }
              }).setDepth(109);
              aftershock.explode();
              this.scene.time.delayedCall(1700, () => aftershock.destroy());
          });

          this.scene.time.delayedCall(2600, () => rollingDust.destroy());
      }

      this.scene.time.delayedCall(isCollapse ? 2800 : 1200, () => {
          microDust.destroy();
          concreteGrains.destroy();
      });
  }

  public createBuildingGroundContactDust(
    x: number,
    y: number,
    width: number,
    intensity: number = 1
  ) {
    const widthK = Phaser.Math.Clamp((Math.max(20, width) / 220) * intensity, 0.45, 2.6);
    if (!this.isNearCamera(x, y, Math.max(260, width * 1.4))) return;

    const roll = this.scene.add.particles(x, y + 6, 'smoke_puff', {
      speedX: { min: -360 * widthK, max: 360 * widthK },
      speedY: { min: -44, max: 100 },
      scale: { start: 0.24 * widthK, end: 1.5 * widthK },
      alpha: { start: 0.24, end: 0 },
      lifespan: { min: 900, max: 2300 },
      quantity: Math.max(8, Math.round(20 * widthK)),
      emitting: false,
      tint: [0x8a8178, 0x70675f, 0x575049],
      gravityY: 240
    }).setDepth(108);
    roll.explode();
    this.applyWindToEmitter(roll as any, y, 0.14);

    const blanket = this.scene.add.particles(x, y + 10, 'smoke_puff', {
      speedX: { min: -160 * widthK, max: 160 * widthK },
      speedY: { min: -14, max: 46 },
      scale: { start: 0.52 * widthK, end: 2.3 * widthK },
      alpha: { start: 0.14, end: 0 },
      lifespan: { min: 1200, max: 2800 },
      quantity: Math.max(5, Math.round(11 * widthK)),
      emitting: false,
      tint: [0xa0978a, 0x847b70, 0x6a6259],
      gravityY: 130
    }).setDepth(107);
    blanket.explode();
    this.applyWindToEmitter(blanket as any, y, 0.08);

    const chips = this.scene.add.particles(x, y + 2, 'brick_concrete', {
      speed: { min: 70, max: 260 * widthK },
      angle: { min: 190, max: 350 },
      scale: { start: 0.16, end: 0.05 },
      alpha: { start: 0.92, end: 0 },
      lifespan: { min: 620, max: 1400 },
      quantity: Math.max(6, Math.round(14 * widthK)),
      emitting: false,
      tint: [0x7e7e7e, 0x646464, 0x494949],
      gravityY: 980,
      rotate: { min: 0, max: 360 }
    }).setDepth(110);
    chips.explode();

    this.scene.time.delayedCall(2900, () => {
      roll.destroy();
      blanket.destroy();
      chips.destroy();
    });
  }

  public createBuildingCollapse(x: number, y: number, material: string, width: number) {
    const isWood = material.includes('wood');
    const isMetal = material.includes('metal');
    const widthK = Phaser.Math.Clamp(width / 220, 0.85, 2.4);
    this.spawnCinematicGlow(x, y - 12, {
      radius: Math.max(70, width * 0.55),
      color: isWood ? 0xffc68a : 0xf2f7ff,
      alpha: isWood ? 0.20 : 0.16,
      durationMs: 680,
      depth: 113,
      scaleMul: 2.0
    });

    const debrisColor = isWood
        ? [0x8f5e38, 0x70462f, 0x593526]
        : (isMetal ? [0x6f7f8f, 0x566674, 0x3b4651] : [0x8a8a8a, 0x6c6c6c, 0x4d4d4d]);
    const dustColor = isWood
        ? [0x7b6a5b, 0x5f5146, 0x4a4038]
        : (isMetal ? [0x7f868c, 0x6b7278, 0x565d63] : [0x8a8178, 0x716860, 0x564f49]);

    const fractureBurst = this.scene.add.particles(x, y - 20, 'brick_concrete', {
        speed: { min: 220, max: 760 * widthK },
        angle: { min: 188, max: 352 },
        scale: { start: 0.34, end: 0.08 },
        alpha: { start: 1, end: 0.2 },
        lifespan: { min: 900, max: 2200 },
        quantity: Math.round(36 * widthK),
        emitting: false,
        tint: debrisColor,
        gravityY: 1400,
        rotate: { min: 0, max: 360 }
    }).setDepth(112);
    fractureBurst.explode();

    const collapseColumn = this.scene.add.particles(x, y + 6, 'smoke_puff', {
        speedY: { min: -260 * widthK, max: -620 * widthK },
        speedX: { min: -260 * widthK, max: 260 * widthK },
        scale: { start: 0.26 * widthK, end: 1.25 * widthK },
        alpha: { start: 0.24, end: 0 },
        lifespan: { min: 1300, max: 3600 },
        quantity: Math.round(26 * widthK),
        emitting: false,
        tint: dustColor,
        gravityY: 180
    }).setDepth(109);
    collapseColumn.explode();

    const baseRoll = this.scene.add.particles(x, y + 12, 'smoke_puff', {
        speedX: { min: -480 * widthK, max: 480 * widthK },
        speedY: { min: -50, max: 160 },
        scale: { start: 0.22 * widthK, end: 1.55 * widthK },
        alpha: { start: 0.20, end: 0 },
        lifespan: { min: 1200, max: 3000 },
        quantity: Math.round(30 * widthK),
        emitting: false,
        tint: dustColor,
        gravityY: 280
    }).setDepth(108);
    baseRoll.explode();

    const followUpPulse = (delayMs: number, yOffset: number, qtyMul: number) => {
        this.scene.time.delayedCall(delayMs, () => {
            const pulse = this.scene.add.particles(x, y + yOffset, 'brick_concrete', {
                speed: { min: 110, max: 340 * widthK },
                angle: { min: 198, max: 342 },
                scale: { start: 0.24 * qtyMul, end: 0.06 },
                alpha: { start: 1, end: 0.08 },
                lifespan: { min: 700, max: 1700 },
                quantity: Math.round(16 * widthK * qtyMul),
                emitting: false,
                tint: debrisColor,
                gravityY: 1280,
                rotate: { min: 0, max: 360 }
            }).setDepth(111);
            pulse.explode();
            this.scene.time.delayedCall(1800, () => pulse.destroy());
        });
    };

    followUpPulse(880, 0, 1.0);
    this.scene.time.delayedCall(920, () => {
      this.spawnCinematicGlow(x, y + 2, {
        radius: Math.max(80, width * 0.68),
        color: 0xddeeff,
        alpha: 0.12,
        durationMs: 760,
        depth: 110,
        scaleMul: 2.3
      });
    });
    followUpPulse(1780, 12, 0.85);
    this.scene.time.delayedCall(1820, () => {
      this.spawnCinematicGlow(x, y + 10, {
        radius: Math.max(90, width * 0.8),
        color: 0xffd6a3,
        alpha: 0.10,
        durationMs: 860,
        depth: 109,
        scaleMul: 2.6
      });
    });

    this.scene.time.delayedCall(3900, () => {
        fractureBurst.destroy();
        collapseColumn.destroy();
        baseRoll.destroy();
    });
  }

  public createAPTrail(shell: Phaser.GameObjects.Sprite) {
      this.createShellTrail(shell, ShellType.AP);
  }

  public createCraterDebris(
    x: number,
    y: number,
    radius: number,
    material: 'mud' | 'flesh' | 'metal' = 'mud',
    intensityScale: number = 1
  ) {
      const coupling = Phaser.Math.Clamp(intensityScale, 0.08, 2.0);
      const intensity = Phaser.Math.Clamp((radius / 420) * coupling, 0.35, 12);
      const qtyDirt = Math.round((34 + intensity * 28) * coupling);
      const qtyDust = Math.round((22 + intensity * 16) * coupling);
      const upMin = 320 + intensity * 64;
      const upMax = 690 + intensity * 150;

      const matProfile = (() => {
        if (material === 'metal') {
          return {
            chunkTex: this.scene.textures.exists('brick_metal') ? 'brick_metal' : 'brick_concrete',
            gritTex: this.scene.textures.exists('brick_metal') ? 'brick_metal' : 'brick_concrete',
            chunkTint: [0xc3ccd6, 0x95a1ad, 0x6b7782],
            gritTint: [0xe2e8ef, 0xc5cfda, 0x8a96a3],
            plumeTint: [0xd6dde5, 0xb2bcc7, 0x8a949f],
            gravity: 1700
          };
        }
        if (material === 'flesh') {
          return {
            chunkTex: this.scene.textures.exists('meat_chunk') ? 'meat_chunk' : 'brick_mud',
            gritTex: this.scene.textures.exists('meat_chunk') ? 'meat_chunk' : 'brick_mud',
            chunkTint: [0x8a1a1a, 0x6a1010, 0x4d0909],
            gritTint: [0x7a1111, 0x590a0a, 0x360505],
            plumeTint: [0x9b8a82, 0x6f5f59, 0x4a3d38],
            gravity: 1200
          };
        }
        return {
          chunkTex: this.scene.textures.exists('brick_mud') ? 'brick_mud' : 'brick_concrete',
          gritTex: this.scene.textures.exists('brick_concrete') ? 'brick_concrete' : (this.scene.textures.exists('brick_mud') ? 'brick_mud' : 'brick_concrete'),
          chunkTint: [0x8b6c4f, 0x73563d, 0x5b442f],
          gritTint: [0xa37e5e, 0x856748, 0x5f4834],
          plumeTint: [0xcdb8a2, 0xad9780, 0x8b765f],
          gravity: 1450
        };
      })();

      const terrainFn = (this.scene as any).getTerrainHeight as ((wx: number) => number) | undefined;
      const sampleGroundY = (wx: number) => {
        if (typeof terrainFn === 'function') {
          const gy = Number(terrainFn.call(this.scene, wx));
          if (Number.isFinite(gy)) return gy;
        }
        return y;
      };

      const spread = Math.max(24, radius * 0.26);
      const sampleCount = Phaser.Math.Clamp(Math.round(2 + intensity * 0.4), 2, 5);
      const perSampleQty = Math.max(4, Math.round(qtyDirt / sampleCount));

      const dirtEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
      for (let i = 0; i < sampleCount; i++) {
        const sx = x + Phaser.Math.Between(-spread, spread);
        const sy = sampleGroundY(sx) - Phaser.Math.Between(0, 4);
        const dirt = this.scene.add.particles(sx, sy, matProfile.chunkTex, {
          speed: { min: 180, max: 600 + intensity * 100 },
          angle: { min: 200, max: 340 },
          scale: { start: 0.70, end: 0.16 },
          lifespan: { min: 1200, max: 3200 },
          quantity: this.q(perSampleQty),
          emitting: false,
          tint: matProfile.chunkTint,
          gravityY: matProfile.gravity,
          rotate: { min: 0, max: 360 }
        }).setDepth(24);
        dirt.explode();
        dirtEmitters.push(dirt);
      }

      const centerGroundY = sampleGroundY(x);
      const plume = this.scene.add.particles(x, centerGroundY - 4, 'smoke_puff', {
          speed: { min: upMin, max: upMax },
          angle: { min: 250, max: 290 },
          scale: { start: 1.4 + intensity * 0.08, end: 8.0 + intensity * 0.30 },
          alpha: { start: 0.32, end: 0 },
          lifespan: { min: 1800, max: 5200 },
          quantity: this.q(qtyDust),
          emitting: false,
          tint: matProfile.plumeTint,
          gravityY: 860
      }).setDepth(35);
      plume.explode();
      this.applyWindToEmitter(plume as any, centerGroundY, 0.16);

      const grit = this.scene.add.particles(x, centerGroundY - 2, matProfile.gritTex, {
          speed: { min: 160, max: 560 + intensity * 100 },
          angle: { min: 200, max: 340 },
          scale: { start: 0.42, end: 0.12 },
          alpha: { start: 0.92, end: 0 },
          lifespan: { min: 700, max: 1600 },
          quantity: this.q(Math.round((16 + intensity * 10) * coupling)),
          emitting: false,
          tint: matProfile.gritTint,
          gravityY: Math.round(matProfile.gravity * 1.05),
          rotate: { min: 0, max: 360 }
      }).setDepth(34);
      grit.explode();

      this.scene.time.delayedCall(6200, () => {
        for (const e of dirtEmitters) e.destroy();
        plume.destroy();
        grit.destroy();
      });
  }
  
  public createExhaust(x: number, y: number) {
    const puffs = this.scene.add.particles(x, y, 'smoke_puff', {
        speed: { min: 30, max: 100 }, angle: { min: 180, max: 240 }, scale: { start: 0.3, end: 1.5 },
        alpha: { start: 0.4, end: 0 }, lifespan: 500, quantity: 3, emitting: false, tint: 0x888888
    }).setDepth(14);
    puffs.explode();
    this.scene.time.delayedCall(600, () => puffs.destroy());
  }

  public createRamFlame(x: number, y: number, scale: number, dir: -1 | 1) {
    const core = this.scene.add.ellipse(x, y, 16 * scale, 10 * scale, 0xffffff, 0.22).setDepth(121);
    core.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: core,
      x: x + dir * 46 * scale,
      scaleX: 2.2,
      scaleY: 0.7,
      alpha: 0,
      duration: 220,
      ease: 'Quad.out',
      onComplete: () => core.destroy()
    });

    const flame = this.scene.add.particles(x, y, 'spark', {
      speed: { min: 700 * scale, max: 2100 * scale },
      angle: dir < 0 ? { min: 170, max: 190 } : { min: -10, max: 10 },
      scale: { start: 3.8 * scale, end: 0 },
      alpha: { start: 0.95, end: 0 },
      lifespan: { min: 140, max: 320 },
      quantity: Math.max(16, Math.round(26 * scale)),
      emitting: false,
      tint: [0xffffff, 0xfff2b8, 0xffa03a, 0xff3b1a],
      blendMode: 'ADD',
      gravityY: 1200
    }).setDepth(120);
    flame.explode();

    const smoke = this.scene.add.particles(x, y, 'smoke_puff', {
      speed: { min: 40 * scale, max: 160 * scale },
      angle: dir < 0 ? { min: 160, max: 200 } : { min: -20, max: 20 },
      scale: { start: 0.5 * scale, end: 2.4 * scale },
      alpha: { start: 0.14, end: 0 },
      lifespan: { min: 220, max: 500 },
      quantity: Math.max(6, Math.round(10 * scale)),
      emitting: false,
      tint: [0x5a5a5a, 0x3a3a3a, 0x202020]
    }).setDepth(118);
    smoke.explode();

    this.scene.time.delayedCall(520, () => { flame.destroy(); smoke.destroy(); });
  }

  public createLiftFlame(x: number, y: number, scale: number) {
    const lenK = 0.5;
    const core = this.scene.add.ellipse(x, y, 18 * scale, 36 * scale * lenK, 0xbbefff, 0.30).setDepth(121);
    core.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({ targets: core, y: y - 42 * scale * lenK, scaleX: 0.55, scaleY: 2.4 * lenK, alpha: 0, duration: 260, ease: 'Quad.out', onComplete: () => core.destroy() });

    const flame = this.scene.add.particles(x, y, 'spark', {
      speed: { min: 900 * scale * lenK, max: 2400 * scale * lenK },
      angle: { min: 82, max: 98 },
      scale: { start: 4.4 * scale, end: 0 },
      alpha: { start: 0.95, end: 0 },
      lifespan: { min: 220, max: 520 },
      quantity: Math.max(18, Math.round(30 * scale)),
      emitting: false,
      tint: [0xffffff, 0xfff2b8, 0xffa03a, 0xff3b1a],
      blendMode: 'ADD',
      gravityY: 2200 * lenK
    }).setDepth(120);
    flame.explode();

    const embers = this.scene.add.particles(x + Phaser.Math.Between(-6, 6) * scale, y + 12 * scale * lenK, 'spark', {
      speed: { min: 120 * scale * lenK, max: 520 * scale * lenK },
      angle: { min: 70, max: 110 },
      scale: { start: 1.3 * scale, end: 0 },
      alpha: { start: 0.55, end: 0 },
      lifespan: { min: 420, max: 900 },
      quantity: Math.max(6, Math.round(10 * scale)),
      emitting: false,
      tint: [0xffc45a, 0xff6a2a, 0xff2a1a],
      blendMode: 'ADD',
      gravityY: 2000 * lenK
    }).setDepth(119);
    embers.explode();

    const smoke = this.scene.add.particles(x, y + 10 * scale * lenK, 'smoke_puff', {
      speed: { min: 70 * scale * lenK, max: 240 * scale * lenK },
      angle: { min: 250, max: 290 },
      scale: { start: 0.8 * scale, end: 3.6 * scale },
      alpha: { start: 0.20, end: 0 },
      lifespan: { min: 900, max: 1900 },
      quantity: Math.max(8, Math.round(14 * scale)),
      emitting: false,
      tint: [0x5a5a5a, 0x3a3a3a, 0x202020]
    }).setDepth(118);
    smoke.explode();
    this.applyWindToEmitter(smoke as any, y, 0.28);

    this.scene.time.delayedCall(2000, () => { flame.destroy(); embers.destroy(); smoke.destroy(); });
  }

  public createBloodSplatter(x: number, y: number) {
    const blood = this.scene.add.particles(x, y, 'meat_chunk', {
        speed: { min: 50, max: 250 }, scale: { start: 1, end: 0 }, alpha: { start: 1, end: 0.5 },
        lifespan: 1200, gravityY: 600, quantity: 20, emitting: false, tint: 0x990000
    }).setDepth(21);
    blood.explode();
    this.scene.time.delayedCall(1500, () => blood.destroy());
  }

  public createRepairEffect(x: number, y: number, tint: number | number[] = 0x00ff00) {
    const repair = this.scene.add.particles(x, y, 'repair_spark', {
        speed: { min: 60, max: 180 }, scale: { start: 0.6, end: 0 }, lifespan: 700,
        gravityY: -250, quantity: 8, emitting: false, tint, blendMode: 'ADD'
    }).setDepth(100);
    repair.explode();
    this.scene.time.delayedCall(800, () => repair.destroy());
  }

  public createWaterSplash(x: number, y: number, strength: number) {
    const qty = Math.round(18 + strength * 0.06);
    const spray = this.scene.add.particles(x, y, 'spark', {
      speed: { min: 220, max: 900 + strength * 0.8 },
      angle: { min: 220, max: 320 },
      scale: { start: 3.2, end: 0 },
      lifespan: { min: 450, max: 950 },
      quantity: qty,
      emitting: false,
      tint: [0xffffff, 0xcfe7ff, 0x6bb7ff],
      blendMode: 'ADD',
      gravityY: 1600
    }).setDepth(110);
    spray.explode();

    const mist = this.scene.add.particles(x, y - 15, 'smoke_puff', {
      speed: { min: 30, max: 140 },
      angle: { min: 235, max: 305 },
      scale: { start: 0.6, end: 2.8 },
      alpha: { start: 0.18, end: 0 },
      lifespan: { min: 900, max: 1800 },
      quantity: Math.round(10 + strength * 0.02),
      emitting: false,
      tint: [0xcfe7ff, 0xffffff],
      gravityY: -120
    }).setDepth(96);
    mist.explode();
    this.applyWindToEmitter(mist as any, y, 0.25);

    this.scene.time.delayedCall(2200, () => { spray.destroy(); mist.destroy(); });
  }
}
