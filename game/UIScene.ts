
import Phaser from 'phaser';
import { ShellType } from './types/GameplayTypes';
import { Capacitor } from '@capacitor/core';

interface WeaponWheelOption {
  type: ShellType;
  label: string;
  angleDeg: number;
  startDeg: number;
  endDeg: number;
}

export class UIScene extends Phaser.Scene {
  private heldPointers = {
    left: new Set<number>(),
    right: new Set<number>(),
    boost: new Set<number>(),
    zoom: new Set<number>(),
    lift: new Set<number>(),
    fire: new Set<number>(),
    mg: new Set<number>(),
    mortar: new Set<number>(),
    nuke: new Set<number>()
  };

  private crosshair?: Phaser.GameObjects.Image;
  private onUiLayoutHandler?: EventListener;
  private onPlayerDamagedHandler?: (...args: any[]) => void;
  private onPlayerFiredMortarHandler?: (...args: any[]) => void;
  private onPlayerFiredNukeHandler?: (...args: any[]) => void;
  private touchSpecialAimMode: 'none' | 'mortar' | 'nuke' = 'none';

  private bossBar?: Phaser.GameObjects.Container;
  private bossBarFill?: Phaser.GameObjects.Rectangle;
  private bossBarLagFill?: Phaser.GameObjects.Rectangle;
  private bossBarName?: Phaser.GameObjects.Text;
  private bossBarShowTween?: Phaser.Tweens.Tween;
  private bossBarLagTween?: Phaser.Tweens.Tween;
  private bossBarVisible: boolean = false;
  private bossBarBaseY: number = 0;
  private bossBarInnerWidth: number = 1;
  private bossBarLastRatio: number | null = null;

  private buttons: Array<{ id: string; bg: any; label: Phaser.GameObjects.Text }> = [];
  private aimArea?: Phaser.GameObjects.Rectangle;
  private aimStickBg?: Phaser.GameObjects.Arc;
  private aimStickTriangle?: Phaser.GameObjects.Triangle;
  private aimStickCenter = new Phaser.Math.Vector2();
  private aimStickRadius: number = 0;
  private aimStickVec = new Phaser.Math.Vector2();
  private aimCursor = new Phaser.Math.Vector2();
  private aimMoveSpeed: number = 0;
  private aimClampRect = new Phaser.Geom.Rectangle(0, 0, 0, 0);
  private aimPointerId: number | null = null;
  private aimStartScreen = new Phaser.Math.Vector2();
  private aimStartWorld = new Phaser.Math.Vector2();
  private aimFireTimer?: Phaser.Time.TimerEvent;
  private aimFirePointerId: number | null = null;
  private tankstarAimGfx?: Phaser.GameObjects.Graphics;
  private tankstarAimOrigin?: Phaser.GameObjects.Arc;
  private tankstarAimPowerBg?: Phaser.GameObjects.Rectangle;
  private tankstarAimPowerFill?: Phaser.GameObjects.Rectangle;
  private tankstarAimLastPointerScreen = new Phaser.Math.Vector2();
  private tankstarMoveBg?: Phaser.GameObjects.Arc;
  private tankstarMoveKnob?: Phaser.GameObjects.Arc;
  private tankstarMoveCenter = new Phaser.Math.Vector2();
  private tankstarMoveRadius: number = 0;
  private tankstarMovePointerId: number | null = null;
  private tankstarMoveAxis: number = 0;
  private edgeDecor: Phaser.GameObjects.GameObject[] = [];
  private edgeState = {
    leftGear: null as Phaser.GameObjects.Container | null,
    rightGear: null as Phaser.GameObjects.Container | null,
    leftCan: null as Phaser.GameObjects.Container | null,
    rightCan: null as Phaser.GameObjects.Container | null,
    lastMoveT: 0,
    gearShake: 0,
    canShake: 0
  };

  private layoutEditMode: boolean = false;
  private onUiEditHandler?: EventListener;
  private onUiLayoutResetHandler?: EventListener;
  private onUiButtonScaleHandler?: EventListener;
  private onAimSensitivityHandler?: EventListener;
  private uiButtonScale: number = 1;
  private aimSensitivity: number = 1;

  // Radial Weapon Wheel
  private weaponWheel?: Phaser.GameObjects.Container;
  private weaponWheelGfx?: Phaser.GameObjects.Graphics;
  private weaponWheelPointerId: number | null = null;
  private weaponWheelTimer?: Phaser.Time.TimerEvent;
  private weaponWheelOrigin = new Phaser.Math.Vector2();
  private weaponWheelSelection: ShellType | null = null;
  private currentShellBtnText?: Phaser.GameObjects.Text;
  private readonly weaponWheelInnerRadius = 48;
  private readonly weaponWheelOuterRadius = 122;
  private readonly weaponWheelOptions: WeaponWheelOption[] = [
    { type: ShellType.STANDARD, label: '标准', angleDeg: 140, startDeg: 102, endDeg: 178 },
    { type: ShellType.HE, label: '高爆', angleDeg: 50, startDeg: 12, endDeg: 88 },
    { type: ShellType.AP, label: '穿甲', angleDeg: -40, startDeg: -78, endDeg: -2 },
    { type: ShellType.INCENDIARY, label: '燃烧', angleDeg: -130, startDeg: -168, endDeg: -92 }
  ];

  constructor() {
    super('UIScene');
  }

  create() {
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setZoom(1);
    this.input.addPointer(9);

    this.crosshair = this.add.image(0, 0, 'crosshair').setOrigin(0.5).setAlpha(0.9).setDepth(1000);

    this.buildLayout();
    this.scale.on('resize', this.handleResize, this);

    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.releasePointerEverywhere(p.id));
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.releasePointerEverywhere(p.id));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onWeaponBtnMove(p));

    this.onUiLayoutHandler = () => this.buildLayout();
    window.addEventListener('panzer-ui-layout', this.onUiLayoutHandler);

    try {
      this.layoutEditMode = window.localStorage.getItem('panzer-ui-edit') === '1';
    } catch {}
    this.uiButtonScale = this.readUiButtonScale();
    this.aimSensitivity = this.readAimSensitivity();
    this.onUiEditHandler = (e: Event) => {
      const ce = e as CustomEvent;
      const enabled = !!(ce.detail && (ce.detail as any).enabled);
      this.layoutEditMode = enabled;
      try { window.localStorage.setItem('panzer-ui-edit', enabled ? '1' : '0'); } catch {}
      this.buildLayout();
    };
    window.addEventListener('panzer-ui-edit', this.onUiEditHandler);

    this.onUiLayoutResetHandler = (e: Event) => {
      const ce = e as CustomEvent;
      const d = (ce.detail ?? {}) as any;
      const preset = typeof d.preset === 'string' ? d.preset : this.getUiLayoutPreset();
      this.resetCustomLayout(preset);
      this.buildLayout();
    };
    window.addEventListener('panzer-ui-layout-reset', this.onUiLayoutResetHandler);

    this.onUiButtonScaleHandler = (e: Event) => {
      const ce = e as CustomEvent;
      const raw = Number((ce.detail as any)?.scale);
      const next = Number.isFinite(raw) ? Phaser.Math.Clamp(raw, 0.75, 1.35) : this.readUiButtonScale();
      if (Math.abs(next - this.uiButtonScale) < 0.001) return;
      this.uiButtonScale = next;
      this.buildLayout();
    };
    window.addEventListener('panzer-ui-button-scale', this.onUiButtonScaleHandler);

    this.onAimSensitivityHandler = (e: Event) => {
      const ce = e as CustomEvent;
      const raw = Number((ce.detail as any)?.value);
      const next = Number.isFinite(raw) ? Phaser.Math.Clamp(raw, 0.5, 2.0) : this.readAimSensitivity();
      this.aimSensitivity = next;
    };
    window.addEventListener('panzer-aim-sensitivity', this.onAimSensitivityHandler);

    const main: any = this.scene.get('MainScene');
    this.onPlayerDamagedHandler = () => this.triggerBombShake(1);
    main?.events?.on?.('player-damaged', this.onPlayerDamagedHandler);
    this.onPlayerFiredMortarHandler = () => this.clearTouchSpecialAimMode('mortar');
    this.onPlayerFiredNukeHandler = () => this.clearTouchSpecialAimMode('nuke');
    main?.events?.on?.('player-fired-mortar', this.onPlayerFiredMortarHandler);
    main?.events?.on?.('player-fired-nuke', this.onPlayerFiredNukeHandler);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.handleResize, this);
      this.input.off('pointerup');
      this.input.off('pointerupoutside');
      if (this.onUiLayoutHandler) window.removeEventListener('panzer-ui-layout', this.onUiLayoutHandler);
      if (this.onUiEditHandler) window.removeEventListener('panzer-ui-edit', this.onUiEditHandler);
      if (this.onUiLayoutResetHandler) window.removeEventListener('panzer-ui-layout-reset', this.onUiLayoutResetHandler);
      if (this.onUiButtonScaleHandler) window.removeEventListener('panzer-ui-button-scale', this.onUiButtonScaleHandler);
      if (this.onAimSensitivityHandler) window.removeEventListener('panzer-aim-sensitivity', this.onAimSensitivityHandler);
      const m: any = this.scene.get('MainScene');
      if (this.onPlayerDamagedHandler) m?.events?.off?.('player-damaged', this.onPlayerDamagedHandler);
      if (this.onPlayerFiredMortarHandler) m?.events?.off?.('player-fired-mortar', this.onPlayerFiredMortarHandler);
      if (this.onPlayerFiredNukeHandler) m?.events?.off?.('player-fired-nuke', this.onPlayerFiredNukeHandler);
    });
  }

  public get isInteracting(): boolean {
    if (this.layoutEditMode) return false;
    return this.aimPointerId !== null || 
           this.tankstarMovePointerId !== null ||
           Object.values(this.heldPointers).some(s => s.size > 0);
  }

  update(_time: number, delta: number) {
    const main: any = this.scene.get('MainScene');
    if (!main?.sys?.isActive?.()) return;

    if (this.currentShellBtnText?.active && main?.player?.currentShell !== undefined) {
      const shell = main.player.currentShell;
      const labels: Record<number, string> = {
          [ShellType.STANDARD]: '\u6807\u51c6',
          [ShellType.HE]: '\u9ad8\u7206',
          [ShellType.AP]: '\u7a7f\u7532',
          [ShellType.INCENDIARY]: '\u71c3\u70e7',
          [ShellType.MORTAR]: '\u8feb\u51fb',
          [ShellType.NUKE]: '\u6838\u5f39'
      };
      const txt = labels[shell] || '\u70ae\u5f39';
      if (this.currentShellBtnText.text !== txt) {
          this.currentShellBtnText.setText(txt);
      }
    }

    this.updateBossBar(main);

    const preset = this.getUiLayoutPreset();
    if (this.layoutEditMode) {
      for (const set of Object.values(this.heldPointers)) set.clear();
      this.touchSpecialAimMode = 'none';
      main.vLeft = false;
      main.vRight = false;
      main.vBoost = false;
      main.vZoom = false;
      main.vLift = false;
      main.vFire = false;
      main.vMg = false;
      main.vMortar = false;
      main.vNuke = false;
      if (this.crosshair?.visible) this.crosshair.setVisible(false);
      return;
    }
    if (typeof (main as any).aimWorldOverrideActive === 'boolean') {
      (main as any).aimWorldOverrideActive = this.sys.game.device.input.touch && (preset === 'new' || preset === 'tankstar');
    } else {
      (main as any).aimWorldOverrideActive = this.sys.game.device.input.touch && (preset === 'new' || preset === 'tankstar');
    }

    const moveDead = 0.22;
    const useMoveAxis = this.sys.game.device.input.touch && preset === 'tankstar';
    const moveAxis = useMoveAxis ? this.tankstarMoveAxis : 0;
    main.vLeft = this.heldPointers.left.size > 0 || moveAxis < -moveDead;
    main.vRight = this.heldPointers.right.size > 0 || moveAxis > moveDead;
    main.vBoost = this.heldPointers.boost.size > 0;
    main.vZoom = this.heldPointers.zoom.size > 0;
    main.vLift = this.heldPointers.lift.size > 0;
    const aimHoldActive = this.heldPointers.fire.size > 0 || this.aimFirePointerId !== null;
    main.vFire = aimHoldActive;
    main.vMg = this.heldPointers.mg.size > 0;
    // Keep touch firing flow aligned with desktop: shell switch + hold/release fire.
    const touchDesktopParity = this.sys.game.device.input.touch && (preset === 'new' || preset === 'tankstar');
    if (touchDesktopParity) {
      main.vFire = this.touchSpecialAimMode === 'none' ? aimHoldActive : false;
      main.vMortar = this.touchSpecialAimMode === 'mortar' ? aimHoldActive : false;
      main.vNuke = this.touchSpecialAimMode === 'nuke' ? aimHoldActive : false;
    } else {
      this.touchSpecialAimMode = 'none';
      main.vMortar = this.heldPointers.mortar.size > 0;
      main.vNuke = this.heldPointers.nuke.size > 0;
    }

    const isTouch = this.sys.game.device.input.touch;
    if (!isTouch) {
      const p = this.input.activePointer;
      const aimSense = Phaser.Math.Clamp(this.aimSensitivity, 0.5, 2.0);
      const w = Math.max(1, this.scale.width);
      const h = Math.max(1, this.scale.height);
      const cx = w * 0.5;
      const cy = h * 0.5;
      const screenX = Phaser.Math.Clamp(cx + (p.x - cx) * aimSense, 0, w);
      const screenY = Phaser.Math.Clamp(cy + (p.y - cy) * aimSense, 0, h);
      if (main.aimScreen) main.aimScreen.set(screenX, screenY);
      if (this.crosshair) this.crosshair.setPosition(screenX, screenY).setVisible(true);
      return;
    }

    if (preset === 'tankstar' && this.tankstarMovePointerId !== null) {
      const p = this.input.manager.pointers.find(ptr => ptr.id === this.tankstarMovePointerId);
      if (p && p.active) this.updateTankstarMoveFromPointer(p);
    }

    if (preset === 'new') {
      if (this.crosshair?.visible) this.crosshair.setVisible(false);

      const cam = main.cameras?.main as Phaser.Cameras.Scene2D.Camera | undefined;
      const player = main.player;
      if (!cam || !player?.chassis?.active || !main.aimWorld?.set) return;

      if (Math.abs(main.aimWorld.x) < 0.1 && Math.abs(main.aimWorld.y) < 0.1) {
        const fx = player.chassis.flipX ? -1 : 1;
        main.aimWorld.set(player.chassis.x + fx * 800, player.chassis.y - 30);
      }

      const pid = this.aimPointerId;
      if (pid !== null) {
        const p = this.input.manager.pointers.find(ptr => ptr.id === pid);
        if (!p || !p.active) {
          this.releasePointerEverywhere(pid);
          return;
        }

        const mag = Math.min(1, Math.sqrt(this.aimStickVec.x * this.aimStickVec.x + this.aimStickVec.y * this.aimStickVec.y));
        if (mag < 0.001) return;
        const nx = this.aimStickVec.x / mag;
        const ny = this.aimStickVec.y / mag;
        const aimSense = Phaser.Math.Clamp(this.aimSensitivity, 0.5, 2.0);
        const senseT = Phaser.Math.Clamp((aimSense - 0.5) / 1.5, 0, 1);
        const responseExp = Phaser.Math.Linear(1.65, 0.62, senseT);
        const responseMag = Phaser.Math.Clamp(Math.pow(mag, responseExp), 0, 1);
        const rangeMul = Phaser.Math.Linear(0.58, 1.32, senseT);

        const maxScreenDist = Math.min(this.aimClampRect.width, this.aimClampRect.height) * 0.62;
        const dist = (maxScreenDist / Math.max(0.001, cam.zoom)) * responseMag * rangeMul;

        const px = player.chassis.x;
        const py = player.chassis.y - 30;
        main.aimWorld.set(px + nx * dist, py + ny * dist);
      }
      return;
    }

    if (preset === 'tankstar') {
      if (this.crosshair?.visible) this.crosshair.setVisible(false);

      const cam = main.cameras?.main as Phaser.Cameras.Scene2D.Camera | undefined;
      const player = main.player;
      if (!cam || !player?.chassis?.active || !main.aimWorld?.set) return;

      if (Math.abs(main.aimWorld.x) < 0.1 && Math.abs(main.aimWorld.y) < 0.1) {
        const fx = player.chassis.flipX ? -1 : 1;
        main.aimWorld.set(player.chassis.x + fx * 800, player.chassis.y - 30);
      }

      const pid = this.aimPointerId;
      if (pid !== null) {
        const p = this.input.manager.pointers.find(ptr => ptr.id === pid);
        if (!p || !p.active) {
          this.releasePointerEverywhere(pid);
          return;
        }

        const mag = Math.min(1, Math.sqrt(this.aimStickVec.x * this.aimStickVec.x + this.aimStickVec.y * this.aimStickVec.y));
        if (mag < 0.001) return;
        const nx = this.aimStickVec.x / mag;
        const ny = this.aimStickVec.y / mag;
        const aimSense = Phaser.Math.Clamp(this.aimSensitivity, 0.5, 2.0);
        const senseT = Phaser.Math.Clamp((aimSense - 0.5) / 1.5, 0, 1);
        const responseExp = Phaser.Math.Linear(1.65, 0.62, senseT);
        const responseMag = Phaser.Math.Clamp(Math.pow(mag, responseExp), 0, 1);
        const rangeMul = Phaser.Math.Linear(0.58, 1.32, senseT);

        const maxWorldDist = (this.aimClampRect.width * 1.15) / Math.max(0.001, cam.zoom);
        const dist = maxWorldDist * responseMag * rangeMul;

        const px = player.chassis.x;
        const py = player.chassis.y - 30;
        main.aimWorld.set(px + nx * dist, py + ny * dist);
      }
      return;
    }

    if (this.aimPointerId !== null) {
      const p = this.input.manager.pointers.find(ptr => ptr.id === this.aimPointerId);
      if (p && p.active) {
        const aimSense = Phaser.Math.Clamp(this.aimSensitivity, 0.5, 2.0);
        const w = Math.max(1, this.scale.width);
        const h = Math.max(1, this.scale.height);
        const cx = w * 0.5;
        const cy = h * 0.5;
        const screenX = Phaser.Math.Clamp(cx + (p.x - cx) * aimSense, 0, w);
        const screenY = Phaser.Math.Clamp(cy + (p.y - cy) * aimSense, 0, h);
        if (main.aimScreen) main.aimScreen.set(screenX, screenY);
        if (this.crosshair) this.crosshair.setPosition(screenX, screenY).setVisible(true);
        return;
      }
    }

    if (this.crosshair?.visible) this.crosshair.setVisible(false);
  }

  private handleResize(gameSize: Phaser.Structs.Size) {
    this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height);
    this.buildLayout();
  }

  private getUiLayoutPreset(): 'tankstar' | 'new' | 'default' | 'compact' | 'wide' {
    try {
      const v = window.localStorage.getItem('panzer-ui-layout');
      if (v === 'tankstar' || v === 'new' || v === 'default' || v === 'compact' || v === 'wide') return v;
    } catch {}
    return Capacitor.getPlatform() === 'android' ? 'tankstar' : 'new';
  }

  private getCustomLayoutKey(preset: string): string {
    return `panzer-ui-custom-layout-v2:${preset}`;
  }

  private loadCustomLayout(preset: string): Record<string, { x: number; y: number }> {
    try {
      const raw = window.localStorage.getItem(this.getCustomLayoutKey(preset));
      if (!raw) return {};
      const parsed = JSON.parse(raw) as any;
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed as Record<string, { x: number; y: number }>;
    } catch {
      return {};
    }
  }

  private saveCustomLayoutEntry(preset: string, id: string, x: number, y: number) {
    const w = Math.max(1, this.scale.width);
    const h = Math.max(1, this.scale.height);
    const nx = Phaser.Math.Clamp(x / w, 0, 1);
    const ny = Phaser.Math.Clamp(y / h, 0, 1);
    const cur = this.loadCustomLayout(preset);
    cur[id] = { x: nx, y: ny };
    try {
      window.localStorage.setItem(this.getCustomLayoutKey(preset), JSON.stringify(cur));
    } catch {}
  }

  private resetCustomLayout(preset: string) {
    try {
      window.localStorage.removeItem(this.getCustomLayoutKey(preset));
    } catch {}
  }

  private readUiButtonScale(): number {
    try {
      const raw = Number.parseFloat(window.localStorage.getItem('panzer-ui-button-scale') ?? '1');
      if (Number.isFinite(raw)) return Phaser.Math.Clamp(raw, 0.75, 1.35);
    } catch {}
    return 1;
  }

  private readAimSensitivity(): number {
    try {
      const raw = Number.parseFloat(window.localStorage.getItem('panzer-aim-sensitivity') ?? '1');
      if (Number.isFinite(raw)) return Phaser.Math.Clamp(raw, 0.5, 2.0);
    } catch {}
    return 1;
  }

  private getGameViewportRect(w: number, h: number, out?: Phaser.Geom.Rectangle): Phaser.Geom.Rectangle {
    // Use full viewport to avoid any black side bars/letterboxing.
    if (out) {
      out.setTo(0, 0, w, h);
      return out;
    }
    return new Phaser.Geom.Rectangle(0, 0, w, h);
  }

  private buildLayout() {
    for (const b of this.buttons) {
      b.bg.destroy();
      b.label.destroy();
    }
    this.buttons = [];
    if (this.aimArea?.active) this.aimArea.destroy();
    this.aimArea = undefined;
    if (this.aimStickBg?.active) this.aimStickBg.destroy();
    this.aimStickBg = undefined;
    if (this.aimStickTriangle?.active) this.aimStickTriangle.destroy();
    this.aimStickTriangle = undefined;
    this.aimStickVec.set(0, 0);
    this.aimPointerId = null;
    if (this.aimFireTimer) this.aimFireTimer.destroy();
    this.aimFireTimer = undefined;
    this.aimFirePointerId = null;
    if (this.tankstarAimGfx?.active) this.tankstarAimGfx.destroy();
    this.tankstarAimGfx = undefined;
    if (this.tankstarAimOrigin?.active) this.tankstarAimOrigin.destroy();
    this.tankstarAimOrigin = undefined;
    if (this.tankstarAimPowerBg?.active) this.tankstarAimPowerBg.destroy();
    this.tankstarAimPowerBg = undefined;
    if (this.tankstarAimPowerFill?.active) this.tankstarAimPowerFill.destroy();
    this.tankstarAimPowerFill = undefined;
    this.tankstarAimLastPointerScreen.set(0, 0);
    if (this.tankstarMoveBg?.active) this.tankstarMoveBg.destroy();
    this.tankstarMoveBg = undefined;
    if (this.tankstarMoveKnob?.active) this.tankstarMoveKnob.destroy();
    this.tankstarMoveKnob = undefined;
    this.tankstarMoveCenter.set(0, 0);
    this.tankstarMoveRadius = 0;
    this.tankstarMovePointerId = null;
    this.tankstarMoveAxis = 0;
    for (const d of this.edgeDecor) d.destroy();
    this.edgeDecor = [];
    this.edgeState.leftGear = null;
    this.edgeState.rightGear = null;
    this.edgeState.leftCan = null;
    this.edgeState.rightCan = null;
    this.edgeState.gearShake = 0;
    this.edgeState.canShake = 0;

    if (this.bossBar?.active) this.bossBar.destroy();
    this.bossBar = undefined;
    this.bossBarFill = undefined;
    this.bossBarLagFill = undefined;
    this.bossBarName = undefined;
    this.bossBarLastRatio = null;
    if (this.bossBarShowTween) this.bossBarShowTween.stop();
    this.bossBarShowTween = undefined;
    if (this.bossBarLagTween) this.bossBarLagTween.stop();
    this.bossBarLagTween = undefined;
    this.bossBarVisible = false;

    const w = this.scale.width;
    const h = this.scale.height;
    const gameRect = this.getGameViewportRect(w, h, this.aimClampRect);
    this.buildBossBar(w, h, gameRect);

    // Only show controls on Android/Native platform
    if (Capacitor.getPlatform() !== 'android') return;

    // Strict height-based scaling for consistent look across devices
    // Base unit is 15% of screen height
    const unit = h * 0.15;
    const buttonScale = Phaser.Math.Clamp(this.uiButtonScale, 0.75, 1.35);
    
    const preset = this.getUiLayoutPreset();
    const custom = this.loadCustomLayout(preset);
    const applyPos = (id: string, x: number, y: number) => {
      const p = custom[id];
      if (!p) return { x, y };
      return { x: p.x * w, y: p.y * h };
    };
    if (preset === 'tankstar') {
      if (!this.layoutEditMode) {
        const aimX = w * 0.5;
        const aimY = h * 0.5;
        const aimW = w;
        const aimH = h;
        this.aimArea = this.add.rectangle(aimX, aimY, aimW, aimH, 0x000000, 0.001).setDepth(0);
        this.aimArea.setInteractive({ useHandCursor: false });
        if (this.sys.game.device.input.touch) {
          this.aimArea.on('pointerdown', (p: Phaser.Input.Pointer) => this.onTankstarAimDown(p));
          this.aimArea.on('pointermove', (p: Phaser.Input.Pointer) => this.onTankstarAimMove(p));
          this.aimArea.on('pointerup', (p: Phaser.Input.Pointer) => this.onTankstarAimUp(p));
          this.aimArea.on('pointerout', (p: Phaser.Input.Pointer) => this.onTankstarAimUp(p));
        }
      }

      this.tankstarAimGfx = this.add.graphics().setDepth(1006);
      this.tankstarAimOrigin = this.add.circle(0, 0, unit * 0.18, 0x000000, 0.35).setStrokeStyle(3, 0xffffff, 0.55).setDepth(1007).setVisible(false);
      const barW = Math.max(10, Math.round(unit * 0.18));
      const barH = Math.max(60, Math.round(unit * 1.6));
      const rightSpace = Math.max(0, w - (gameRect.x + gameRect.width));
      const barFallbackX = rightSpace > unit * 2.2
        ? (gameRect.x + gameRect.width + rightSpace * 0.85)
        : (w - unit * 0.55);
      const barPos = applyPos('tankstar-power', barFallbackX, gameRect.y + unit * 0.55);
      const barX = barPos.x;
      const barY = barPos.y;
      this.tankstarAimPowerBg = this.add.rectangle(barX, barY, barW, barH, 0x000000, 0.35).setStrokeStyle(2, 0xffffff, 0.35).setDepth(1007).setOrigin(0.5, 0);
      this.tankstarAimPowerFill = this.add.rectangle(barX, barY + barH, barW - 4, 2, 0xffaa00, 0.75).setDepth(1008).setOrigin(0.5, 1).setVisible(false);
      if (this.layoutEditMode && this.tankstarAimPowerBg?.active) {
        const bg = this.tankstarAimPowerBg;
        bg.setInteractive();
        this.input.setDraggable(bg);
        bg.on('drag', (_p: any, dragX: number, dragY: number) => {
          bg.setPosition(dragX, dragY);
          if (this.tankstarAimPowerFill?.active) {
            const fill = this.tankstarAimPowerFill;
            fill.setPosition(dragX, dragY + bg.height);
          }
        });
        bg.on('dragend', () => this.saveCustomLayoutEntry(preset, 'tankstar-power', bg.x, bg.y));
      }
    } else if (preset !== 'new') {
      if (!this.layoutEditMode) {
        const aimX = w * 0.5;
        const aimY = h * 0.5;
        const aimW = w;
        const aimH = h;
        this.aimArea = this.add.rectangle(aimX, aimY, aimW, aimH, 0x000000, 0.001).setDepth(0);
        this.aimArea.setInteractive({ useHandCursor: false });
        if (this.sys.game.device.input.touch) {
          this.aimArea.on('pointerdown', (p: Phaser.Input.Pointer) => this.onAimDown(p));
          this.aimArea.on('pointermove', (p: Phaser.Input.Pointer) => this.onAimMove(p));
          this.aimArea.on('pointerup', (p: Phaser.Input.Pointer) => this.onAimUp(p));
          this.aimArea.on('pointerout', (p: Phaser.Input.Pointer) => this.onAimUp(p));
        }
      }
    } else {
      const buttonSize = unit * 0.85 * buttonScale;
      const shellRadius = buttonSize * 0.5;

      const bottomSpace = h - (gameRect.y + gameRect.height);
      const bottomRowY = (bottomSpace > unit * 0.95)
        ? (h - unit * 0.85)
        : (gameRect.y + gameRect.height - unit * 0.85);

      const stackX = w - unit * 0.55;
      const stackGap = unit * 0.62;

      this.aimStickRadius = unit * 1.25 * buttonScale;
      const circleX = stackX - (buttonSize * 0.95) - this.aimStickRadius - unit * 0.22;
      const circleBottom = bottomRowY - shellRadius + unit * 0.02;
      const circleY = circleBottom - this.aimStickRadius;
      this.aimStickCenter.set(circleX, circleY);
      this.aimMoveSpeed = gameRect.height * 1.25;

      const stick = this.add.circle(this.aimStickCenter.x, this.aimStickCenter.y, this.aimStickRadius, 0x550000, 0.65)
        .setStrokeStyle(5, 0xffdddd, 0.35)
        .setDepth(1005);
      stick.setInteractive(new Phaser.Geom.Circle(this.aimStickRadius, this.aimStickRadius, this.aimStickRadius), Phaser.Geom.Circle.Contains);
      stick.on('pointerdown', (p: Phaser.Input.Pointer) => this.onStickDown(p));
      stick.on('pointermove', (p: Phaser.Input.Pointer) => this.onStickMove(p));
      stick.on('pointerup', (p: Phaser.Input.Pointer) => this.onStickUp(p));
      this.aimStickBg = stick as any;

      const triSize = this.aimStickRadius * 0.22;
      const tri = this.add.triangle(
        this.aimStickCenter.x,
        this.aimStickCenter.y,
        0, -triSize,
        triSize, triSize,
        -triSize, triSize,
        0x3355ff,
        0.95
      ).setDepth(1006);
      tri.setOrigin(0.5, 0.5);
      this.aimStickTriangle = tri;

      this.aimCursor.set(gameRect.x + gameRect.width * 0.5, gameRect.y + gameRect.height * 0.5);
    }

    const makeButton = (
      id: string,
      label: string,
      x: number,
      y: number,
      size: number,
      onDown: (pid: number) => void,
      onUp: (pid: number) => void,
      color: number = 0x000000,
      strokeColor: number = 0xffffff,
      releaseOnOut: boolean = true
    ) => {
      const p0 = applyPos(id, x, y);
      x = p0.x;
      y = p0.y;
      const radius = size * 0.5;
      const bg = this.add.circle(x, y, radius, color, 0.45).setStrokeStyle(3, strokeColor, 0.5).setDepth(1010);
      const isAndroid = !!this.sys.game.device.os.android;
      const fontSize = Math.max(12, Math.round(size * (isAndroid ? 0.32 : 0.28)));
      const t = this.add.text(x, y, label, {
        fontFamily: 'monospace',
        fontSize: `${fontSize}px`,
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: Math.max(2, Math.round(fontSize * 0.18)),
        fontStyle: '700'
      }).setOrigin(0.5).setDepth(1011);
      if (isAndroid && typeof window !== 'undefined') {
        const dpr = window.devicePixelRatio || 1;
        t.setResolution(Phaser.Math.Clamp(dpr, 1.25, 3));
      }
      
      bg.setInteractive(new Phaser.Geom.Circle(radius, radius, radius), Phaser.Geom.Circle.Contains);

      if (this.layoutEditMode) {
        this.input.setDraggable(bg);
        bg.on('drag', (_p: any, dragX: number, dragY: number) => {
          bg.setPosition(dragX, dragY);
          t.setPosition(dragX, dragY);
        });
        bg.on('dragend', () => this.saveCustomLayoutEntry(preset, id, bg.x, bg.y));
      } else {
        const press = (pid: number) => {
          bg.setFillStyle(0xffffff, 0.3);
          bg.setStrokeStyle(3, 0xffffff, 0.8);
          onDown(pid);
        };
        const release = (pid: number) => {
          bg.setFillStyle(color, 0.45);
          bg.setStrokeStyle(3, strokeColor, 0.5);
          onUp(pid);
        };

        bg.on('pointerdown', (p: Phaser.Input.Pointer) => press(p.id));
        bg.on('pointerup', (p: Phaser.Input.Pointer) => release(p.id));
        if (releaseOnOut) bg.on('pointerout', (p: Phaser.Input.Pointer) => release(p.id));
      }

      this.buttons.push({ id, bg: bg as any, label: t });
      return { bg, t };
    };

    // --- Left Hand Controls ---
    let leftBaseX = unit * 1.5;
    let leftBaseY = h - unit * 1.5;
    if (preset === 'new' || preset === 'tankstar') {
      const buttonSize = unit * 0.85 * buttonScale;
      const shellRadius = buttonSize * 0.5;
      const bottomSpace = h - (gameRect.y + gameRect.height);
      const bottomRowY = (bottomSpace > unit * 0.95)
        ? (h - unit * 0.85)
        : (gameRect.y + gameRect.height - unit * 0.85);

      const leftSpace = gameRect.x;
      leftBaseY = bottomRowY;
      leftBaseX = leftSpace > unit * 2.4 ? Math.max(unit * 1.1, leftSpace * 0.5) : (gameRect.x + unit * 1.5);
      leftBaseY = bottomRowY - shellRadius * 0.05;
    }
    
    if (preset === 'tankstar') {
      this.tankstarMoveRadius = unit * 1.15 * buttonScale;
      const movePos = applyPos('tankstar-move', leftBaseX, leftBaseY);
      this.tankstarMoveCenter.set(movePos.x, movePos.y);
      const bg = this.add.circle(this.tankstarMoveCenter.x, this.tankstarMoveCenter.y, this.tankstarMoveRadius, 0x000000, 0.26)
        .setStrokeStyle(4, 0xffffff, 0.22)
        .setDepth(1005);
      bg.setInteractive(new Phaser.Geom.Circle(this.tankstarMoveRadius, this.tankstarMoveRadius, this.tankstarMoveRadius), Phaser.Geom.Circle.Contains);
      if (this.layoutEditMode) {
        this.input.setDraggable(bg);
        bg.on('drag', (_p: any, dragX: number, dragY: number) => {
          this.tankstarMoveCenter.set(dragX, dragY);
          bg.setPosition(dragX, dragY);
          if (this.tankstarMoveKnob?.active) this.tankstarMoveKnob.setPosition(dragX, dragY);
        });
        bg.on('dragend', () => this.saveCustomLayoutEntry(preset, 'tankstar-move', bg.x, bg.y));
      } else {
        bg.on('pointerdown', (p: Phaser.Input.Pointer) => this.onTankstarMoveDown(p));
        bg.on('pointermove', (p: Phaser.Input.Pointer) => this.onTankstarMoveMove(p));
        bg.on('pointerup', (p: Phaser.Input.Pointer) => this.onTankstarMoveUp(p));
      }
      this.tankstarMoveBg = bg as any;

      const knobR = Math.max(10, Math.round(this.tankstarMoveRadius * 0.33));
      this.tankstarMoveKnob = this.add.circle(this.tankstarMoveCenter.x, this.tankstarMoveCenter.y, knobR, 0xffffff, 0.20)
        .setStrokeStyle(3, 0xffffff, 0.45)
        .setDepth(1006);
    } else {
      makeButton('move-left', '\u25c0', leftBaseX - unit * 0.8, leftBaseY, unit * 1.3 * buttonScale, (pid) => this.heldPointers.left.add(pid), (pid) => this.heldPointers.left.delete(pid));
      makeButton('move-right', '\u25b6', leftBaseX + unit * 0.8, leftBaseY, unit * 1.3 * buttonScale, (pid) => this.heldPointers.right.add(pid), (pid) => this.heldPointers.right.delete(pid));
    }


    // --- Right Hand Controls (Custom Layout) ---
    // Legacy: two rows aligned to the bottom-right
    
    const setShell = (type: ShellType) => {
      this.clearTouchSpecialAimMode();
      const main: any = this.scene.get('MainScene');
      if (main?.player?.setShell) {
        main.player.setShell(type);
      }
    };

    if (preset === 'new') {
      const buttonSize = unit * 0.85 * buttonScale;
      const spacing = unit * 0.92 * buttonScale;

      const bottomSpace = h - (gameRect.y + gameRect.height);
      const bottomY = (bottomSpace > unit * 0.95)
        ? (h - unit * 0.85)
        : (gameRect.y + gameRect.height - unit * 0.85);

      const rightSpace = Math.max(0, w - (gameRect.x + gameRect.width));
      const useRightBand = rightSpace > unit * 2.4;

      const rowGap = spacing;
      const shellsBaseY = bottomY;
      const shellsRow2Y = shellsBaseY - rowGap;
      const shellsRow3Y = shellsBaseY - rowGap * 2;
      const col1X = useRightBand ? (gameRect.x + gameRect.width + rightSpace * 0.35) : (w - unit * 0.75 - spacing * 5);
      const col2X = useRightBand ? (gameRect.x + gameRect.width + rightSpace * 0.75) : (w - unit * 0.75);

      const stackX = useRightBand ? (gameRect.x + gameRect.width + rightSpace * 0.55) : (w - unit * 0.55);
      const stackY = useRightBand ? (shellsRow3Y - unit * 0.75) : (this.aimStickCenter.y - unit * 0.25);
      const stackGap = buttonSize * 1.08;
      const mgY = stackY - stackGap;
      const boostY = stackY;
      const liftY = stackY + stackGap;

      const colorShell = 0x0088ff;
      const colorSpecial = 0x222222;
      const colorBoost = 0xffaa00;
      const colorMg = 0x0b3a2e;
      const shellSwitchY = gameRect.y + gameRect.height * 0.5;

      makeButton('shell-mortar', '\u8feb\u51fb', col1X, shellsBaseY, buttonSize, () => this.toggleTouchSpecialAimMode('mortar'), () => {}, colorSpecial);
      
      const switchPos = applyPos('shell-switch', col2X, shellSwitchY);
      const { bg: shellBg, t: shellTxt } = makeButton('shell-switch', '\u70ae\u5f39', col2X, shellSwitchY, buttonSize, 
          (pid) => this.onWeaponBtnDown({ id: pid } as any, switchPos.x, switchPos.y), 
          (pid) => {}, 
          colorShell
      );
      this.currentShellBtnText = shellTxt;
      shellBg.on('pointermove', (p: Phaser.Input.Pointer) => this.onWeaponBtnMove(p));

      makeButton('shell-nuke', '\u6838\u5f39', col1X, shellsRow2Y, buttonSize, () => this.toggleTouchSpecialAimMode('nuke'), () => {}, colorSpecial);

      makeButton('action-mg', '\u673a\u67aa', stackX, mgY, buttonSize, (pid) => this.heldPointers.mg.add(pid), (pid) => this.heldPointers.mg.delete(pid), colorMg);
      makeButton('action-boost', '\u52a0\u901f', stackX, boostY, buttonSize, (pid) => this.heldPointers.boost.add(pid), (pid) => this.heldPointers.boost.delete(pid), colorBoost);
      makeButton('action-lift', '\u5347\u7a7a', stackX, liftY, buttonSize, (pid) => this.heldPointers.lift.add(pid), (pid) => this.heldPointers.lift.delete(pid), colorSpecial, 0xffffff, false);
    } else if (preset === 'tankstar') {
      const buttonSize = unit * 0.82 * buttonScale;
      const spacing = unit * 0.88 * buttonScale;

      const bottomSpace = h - (gameRect.y + gameRect.height);
      const bottomY = (bottomSpace > unit * 0.95)
        ? (h - unit * 0.84)
        : (gameRect.y + gameRect.height - unit * 0.84);

      const rightSpace = Math.max(0, w - (gameRect.x + gameRect.width));
      const useRightBand = rightSpace > unit * 2.4;
      const actionX = useRightBand
        ? (gameRect.x + gameRect.width + rightSpace * 0.64)
        : (w - unit * 0.62);

      const actionBottomY = bottomY - buttonSize * 0.08;
      const stackGap = buttonSize * 1.02;
      const mgY = actionBottomY - stackGap * 2;
      const boostY = actionBottomY - stackGap;
      const liftY = actionBottomY;

      const shellSwitchX = actionX - spacing * 1.2;
      // Android default: keep shell-switch on vertical center line for faster thumb reach.
      const shellSwitchY = gameRect.y + gameRect.height * 0.5;
      const specialShellBaseY = bottomY - buttonSize * 0.04;
      const mortarX = shellSwitchX - spacing * 0.92;
      const mortarY = specialShellBaseY - spacing * 0.04;
      const nukeX = shellSwitchX - spacing * 0.54;
      const nukeY = specialShellBaseY - spacing * 1.0;

      const colorShell = 0x0088ff;
      const colorSpecial = 0x222222;
      const colorBoost = 0xffaa00;
      const colorMg = 0x0b3a2e;

      makeButton('shell-mortar', '\u8feb\u51fb', mortarX, mortarY, buttonSize, () => this.toggleTouchSpecialAimMode('mortar'), () => {}, colorSpecial);

      const switchPos = applyPos('shell-switch', shellSwitchX, shellSwitchY);
      const { bg: shellBg, t: shellTxt } = makeButton('shell-switch', '\u70ae\u5f39', shellSwitchX, shellSwitchY, buttonSize,
          (pid) => this.onWeaponBtnDown({ id: pid } as any, switchPos.x, switchPos.y),
          (pid) => {},
          colorShell
      );
      this.currentShellBtnText = shellTxt;
      shellBg.on('pointermove', (p: Phaser.Input.Pointer) => this.onWeaponBtnMove(p));

      makeButton('shell-nuke', '\u6838\u5f39', nukeX, nukeY, buttonSize, () => this.toggleTouchSpecialAimMode('nuke'), () => {}, colorSpecial);

      makeButton('action-mg', '\u673a\u67aa', actionX, mgY, buttonSize, (pid) => this.heldPointers.mg.add(pid), (pid) => this.heldPointers.mg.delete(pid), colorMg);
      makeButton('action-boost', '\u52a0\u901f', actionX, boostY, buttonSize, (pid) => this.heldPointers.boost.add(pid), (pid) => this.heldPointers.boost.delete(pid), colorBoost);
      makeButton('action-lift', '\u5347\u7a7a', actionX, liftY, buttonSize, (pid) => this.heldPointers.lift.add(pid), (pid) => this.heldPointers.lift.delete(pid), colorSpecial, 0xffffff, false);

    } else {
      const buttonSize = unit * 0.9 * buttonScale;
      const spacing = unit * (preset === 'compact' ? 0.95 : (preset === 'wide' ? 1.25 : 1.1)) * buttonScale;
      
      const row2Y = h - unit * (preset === 'compact' ? 1.2 : (preset === 'wide' ? 1.4 : 1.3));
      const row1Y = h - unit * (preset === 'compact' ? 2.35 : (preset === 'wide' ? 2.65 : 2.5));
      
      const rightMargin = w - unit * (preset === 'compact' ? 1.2 : (preset === 'wide' ? 0.6 : 0.8));
      
      const incX = rightMargin;
      const apX = incX - spacing;
      const heX = apX - spacing;
      const stdX = heX - spacing;
      const nukeX = stdX - spacing;
      
      const boostX = nukeX - spacing;
      const mortarX = boostX - spacing;
      const liftX = apX;

      const colorShell = 0x0088ff;
      const colorSpecial = 0x222222;
      const colorBoost = 0xffaa00;

      makeButton('shell-nuke', '\u6838\u5f39', nukeX, row2Y, buttonSize, () => setShell(ShellType.NUKE), () => {}, colorSpecial);
      makeButton('shell-std', '\u6807\u51c6', stdX, row2Y, buttonSize, () => setShell(ShellType.STANDARD), () => {}, colorShell);
      makeButton('shell-he', '\u9ad8\u7206', heX, row2Y, buttonSize, () => setShell(ShellType.HE), () => {}, colorShell);
      makeButton('shell-ap', '\u7a7f\u7532', apX, row2Y, buttonSize, () => setShell(ShellType.AP), () => {}, colorShell);
      makeButton('shell-inc', '\u71c3\u70e7', incX, row2Y, buttonSize, () => setShell(ShellType.INCENDIARY), () => {}, colorShell);

      makeButton('shell-mortar', '\u8feb\u51fb', mortarX, row1Y, buttonSize, () => setShell(ShellType.MORTAR), () => {}, colorSpecial);
      
      makeButton('action-boost', '\u52a0\u901f', boostX, row1Y, buttonSize, 
        (pid) => this.heldPointers.boost.add(pid), 
        (pid) => this.heldPointers.boost.delete(pid),
        colorBoost
      );
      
      makeButton('action-lift', '\u5347\u7a7a', liftX, row1Y, buttonSize, 
        (pid) => this.heldPointers.lift.add(pid), 
        (pid) => this.heldPointers.lift.delete(pid), 
        colorSpecial,
        0xffffff,
        false
      );
    }
  }

  private isTouchDesktopParityPreset(): boolean {
    if (!this.sys.game.device.input.touch) return false;
    const preset = this.getUiLayoutPreset();
    return preset === 'new' || preset === 'tankstar';
  }

  private toggleTouchSpecialAimMode(mode: 'mortar' | 'nuke') {
    if (!this.isTouchDesktopParityPreset()) {
      const main: any = this.scene.get('MainScene');
      if (main?.player?.setShell) {
        main.player.setShell(mode === 'mortar' ? ShellType.MORTAR : ShellType.NUKE);
      }
      return;
    }
    this.touchSpecialAimMode = this.touchSpecialAimMode === mode ? 'none' : mode;
  }

  private clearTouchSpecialAimMode(mode?: 'mortar' | 'nuke') {
    if (!mode || this.touchSpecialAimMode === mode) {
      this.touchSpecialAimMode = 'none';
    }
  }

  private buildBossBar(w: number, h: number, gameRect: Phaser.Geom.Rectangle) {
    const barW = Math.min(gameRect.width * 0.78, 560);
    const barH = Math.max(18, Math.round(h * 0.026));
    const pad = Math.max(2, Math.round(barH * 0.18));
    const innerW = Math.max(1, barW - pad * 2);
    const innerH = Math.max(1, barH - pad * 2);
    const y = gameRect.y + gameRect.height - Math.max(56, Math.round(h * 0.07));

    this.bossBarBaseY = y;
    this.bossBarInnerWidth = innerW;

    const c = this.add.container(w * 0.5, y).setDepth(1200);
    c.setVisible(false);
    c.setAlpha(0);
    c.y = y + 26;

    const bg = this.add.rectangle(0, 0, barW, barH, 0x000000, 0.72).setStrokeStyle(2, 0xffffff, 0.68);
    const frame = this.add.rectangle(0, 0, barW + 8, barH + 10, 0x000000, 0.18).setStrokeStyle(1, 0xffffff, 0.25);

    const x0 = -barW * 0.5 + pad;
    const lag = this.add.rectangle(x0, 0, innerW, innerH, 0x5a0000, 0.85).setOrigin(0, 0.5);
    const fill = this.add.rectangle(x0, 0, innerW, innerH, 0xc21414, 0.95).setOrigin(0, 0.5);

    const name = this.add.text(-barW * 0.5, -barH * 0.95, '\u730e\u6740\u8005', {
      fontSize: `${Math.max(14, Math.round(barH * 0.95))}px`,
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0, 1);

    c.add([frame, bg, lag, fill, name]);

    this.bossBar = c;
    this.bossBarFill = fill;
    this.bossBarLagFill = lag;
    this.bossBarName = name;
  }

  private setBossBarVisible(visible: boolean) {
    if (!this.bossBar?.active) return;
    if (this.bossBarVisible === visible) return;
    this.bossBarVisible = visible;

    if (this.bossBarShowTween) this.bossBarShowTween.stop();
    const c = this.bossBar;
    const y0 = this.bossBarBaseY;

    if (visible) {
      c.setVisible(true);
      c.setAlpha(0);
      c.y = y0 + 26;
      c.setScale(0.99, 0.99);
      this.bossBarShowTween = this.tweens.add({
        targets: c,
        alpha: 1,
        y: y0,
        scaleX: 1,
        scaleY: 1,
        duration: 520,
        ease: 'Cubic.Out'
      });
    } else {
      this.bossBarShowTween = this.tweens.add({
        targets: c,
        alpha: 0,
        y: y0 + 22,
        duration: 420,
        ease: 'Cubic.In',
        onComplete: () => {
          if (c.active) c.setVisible(false);
        }
      });
    }
  }

  private updateBossBar(main: any) {
    const tank = main?.hunterBossTank;
    const active = !!tank?.active && tank?.isDead !== true;
    const introDropping = tank?.chassis?.getData?.('introDropping') === true;
    const shouldShow = active && !introDropping;
    this.setBossBarVisible(shouldShow);

    if (!shouldShow) {
      this.bossBarLastRatio = null;
      return;
    }

    const hp = Number(tank?.hp ?? 0);
    const maxHp = Math.max(1, Number(tank?.maxHp ?? 1));
    const ratio = Phaser.Math.Clamp(hp / maxHp, 0, 1);

    if (this.bossBarName?.active) {
      if (this.bossBarName.text !== '\u730e\u6740\u8005') this.bossBarName.setText('\u730e\u6740\u8005');
    }

    if (this.bossBarFill?.active) this.bossBarFill.setScale(ratio, 1);

    const prev = this.bossBarLastRatio;
    this.bossBarLastRatio = ratio;

    if (!this.bossBarLagFill?.active) return;
    const lagNow = Phaser.Math.Clamp(this.bossBarLagFill.scaleX, 0, 1);

    if (prev === null) {
      this.bossBarLagFill.setScale(ratio, 1);
      return;
    }

    if (ratio >= lagNow - 0.0001) {
      if (this.bossBarLagTween) this.bossBarLagTween.stop();
      this.bossBarLagTween = undefined;
      this.bossBarLagFill.setScale(ratio, 1);
      return;
    }

    if (this.bossBarLagTween) this.bossBarLagTween.stop();
    const drop = Phaser.Math.Clamp((prev - ratio) * this.bossBarInnerWidth, 0, this.bossBarInnerWidth);
    const delay = Phaser.Math.Clamp(180 + drop * 0.9, 180, 520);
    this.bossBarLagTween = this.tweens.add({
      targets: this.bossBarLagFill,
      scaleX: ratio,
      duration: 620,
      delay,
      ease: 'Cubic.Out'
    });

    const shake = Phaser.Math.Clamp((prev - ratio) * 2.2, 0, 0.08);
    if (shake > 0.001 && this.bossBar?.active) {
      this.bossBar.x = this.scale.width * 0.5 + Phaser.Math.Between(-1, 1);
      this.bossBar.y = this.bossBarBaseY + Phaser.Math.Between(-1, 1);
      this.time.delayedCall(60, () => {
        if (!this.bossBar?.active) return;
        this.bossBar.x = this.scale.width * 0.5;
        this.bossBar.y = this.bossBarBaseY;
      });
    }

    if (this.bossBar?.active) {
      this.bossBar.setScale(1 + shake, 1 + shake);
      this.time.delayedCall(120, () => {
        if (!this.bossBar?.active) return;
        this.bossBar.setScale(1, 1);
      });
    }
  }

  private buildEdgeDecor(w: number, h: number, gameRect: Phaser.Geom.Rectangle) {
    const leftW = Math.max(0, gameRect.x);
    const rightW = Math.max(0, w - (gameRect.x + gameRect.width));
    const minW = Math.max(28, Math.min(120, h * 0.12));
    if (leftW < minW && rightW < minW) return;

    const makeAssembly = (side: 'left' | 'right', x0: number, width: number) => {
      if (width < minW) return;
      const cx = x0 + width * 0.5;
      const cy = h * 0.5;

      const canW = Math.min(width * 0.62, Math.max(40, width - 16));
      const canH = h * 0.78;
      const canX = cx;
      const canY = cy;

      const can = this.add.container(canX, canY).setDepth(2);
      const g0 = this.add.graphics();
      const r = Math.max(10, Math.min(canW, canH) * 0.06);
      g0.fillStyle(0x0c0f13, 0.55);
      g0.fillRoundedRect(-canW * 0.5, -canH * 0.5, canW, canH, r);
      g0.fillStyle(0x1a2028, 0.55);
      g0.fillRoundedRect(-canW * 0.46, -canH * 0.45, canW * 0.92, canH * 0.90, r);
      g0.fillStyle(0x000000, 0.22);
      g0.fillRoundedRect(-canW * 0.40, -canH * 0.40, canW * 0.80, canH * 0.80, r);
      for (let i = -4; i <= 4; i++) {
        const yy = (i / 4) * canH * 0.38;
        g0.lineStyle(2, 0xffffff, 0.045);
        g0.beginPath();
        g0.moveTo(-canW * 0.44, yy);
        g0.lineTo(canW * 0.44, yy);
        g0.strokePath();
      }
      can.add(g0);

      const gearR = Math.min(width * 0.44, h * 0.12);
      const gear = this.add.container(cx, cy).setDepth(3);
      const gg = this.add.graphics();
      const toothCount = 12;
      for (let i = 0; i < toothCount; i++) {
        const a = (i / toothCount) * Math.PI * 2;
        const tx = Math.cos(a) * (gearR * 0.92);
        const ty = Math.sin(a) * (gearR * 0.92);
        const tw = gearR * 0.22;
        const th = gearR * 0.30;
        gg.fillStyle(0x11161d, 0.6);
        gg.fillRoundedRect(tx - tw * 0.5, ty - th * 0.5, tw, th, 4);
      }
      gg.fillStyle(0x0a0f14, 0.75);
      gg.fillCircle(0, 0, gearR);
      gg.fillStyle(0x1b232e, 0.55);
      gg.fillCircle(0, 0, gearR * 0.78);
      gg.fillStyle(0x0a0f14, 0.85);
      gg.fillCircle(0, 0, gearR * 0.26);
      gg.fillStyle(0x3a3f46, 0.35);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        gg.fillCircle(Math.cos(a) * gearR * 0.55, Math.sin(a) * gearR * 0.55, Math.max(2, gearR * 0.06));
      }
      gear.add(gg);

      const glass = this.add.graphics();
      glass.fillStyle(0x000000, 0.28);
      glass.fillRect(x0, 0, width, h);
      glass.setDepth(1);

      this.edgeDecor.push(glass, can, gear);
      if (side === 'left') {
        this.edgeState.leftGear = gear;
        this.edgeState.leftCan = can;
      } else {
        this.edgeState.rightGear = gear;
        this.edgeState.rightCan = can;
      }
    };

    makeAssembly('left', 0, leftW);
    makeAssembly('right', gameRect.x + gameRect.width, rightW);
  }

  private updateEdgeDecor(main: any, delta: number) {
    if (!this.edgeState.leftGear && !this.edgeState.rightGear) return;
    const player = main?.player;
    const body = player?.chassis?.body as Phaser.Physics.Arcade.Body | undefined;
    const now = (main?.time?.now as number | undefined) ?? 0;

    let speed = 0;
    if (body) {
      const vx = Math.abs(body.velocity.x);
      speed = Phaser.Math.Clamp(vx / 360, 0, 7);
    }

    if (speed > 0.08) this.edgeState.lastMoveT = now;
    const movingRecently = now < this.edgeState.lastMoveT + 180;
    const gearBase = movingRecently ? (0.002 + speed * 0.012) : 0;
    const shake = this.edgeState.gearShake;
    const rotJitter = shake > 0 ? (Math.sin(now * 0.09) * 0.006 * shake) : 0;

    if (this.edgeState.leftGear) this.edgeState.leftGear.rotation += gearBase * delta + rotJitter;
    if (this.edgeState.rightGear) this.edgeState.rightGear.rotation += gearBase * delta - rotJitter;

    const liftHeld = main?.vLift === true;
    const can = this.edgeState.canShake;
    const canJitter = (liftHeld ? 1 : 0) + can;
    const canOff = canJitter > 0 ? (Math.sin(now * 0.07) * 2.6 * canJitter) : 0;
    const canRot = canJitter > 0 ? (Math.sin(now * 0.05 + 0.7) * 0.012 * canJitter) : 0;

    const applyCan = (c: Phaser.GameObjects.Container | null, side: -1 | 1) => {
      if (!c) return;
      c.x += Math.cos(now * 0.06 + side) * 0.25 * canJitter;
      c.y += canOff * 0.02;
      c.rotation = canRot * 0.35;
    };
    applyCan(this.edgeState.leftCan, -1);
    applyCan(this.edgeState.rightCan, 1);

    this.edgeState.gearShake = Math.max(0, this.edgeState.gearShake - delta / 700);
    this.edgeState.canShake = Math.max(0, this.edgeState.canShake - delta / 900);
  }

  public triggerBombShake(strength: number = 1) {
    this.edgeState.gearShake = Phaser.Math.Clamp(this.edgeState.gearShake + strength, 0, 3);
    this.edgeState.canShake = Phaser.Math.Clamp(this.edgeState.canShake + strength * 0.7, 0, 2.2);
    const main: any = this.scene.get('MainScene');
    const p = main?.particles;
    if (p?.createSmallSpark) {
      const w = this.scale.width;
      const h = this.scale.height;
      const gameRect = this.getGameViewportRect(w, h);
      const leftW = Math.max(0, gameRect.x);
      const rightX = gameRect.x + gameRect.width;
      const rightW = Math.max(0, w - rightX);
      for (let i = 0; i < 5; i++) {
        const useLeft = leftW > 30 && (rightW < 30 || Phaser.Math.Between(0, 1) === 0);
        const x = useLeft
          ? Phaser.Math.Between(8, Math.max(8, Math.floor(leftW - 8)))
          : Phaser.Math.Between(Math.floor(rightX + 8), Math.max(Math.floor(rightX + 8), Math.floor(rightX + rightW - 8)));
        const y = Phaser.Math.Between(Math.floor(h * 0.25), Math.floor(h * 0.75));
        p.createSmallSpark(x, y);
      }
    }
  }

  private isPointOverButton(x: number, y: number): boolean {
    // Check if point is inside any button's hit area
    // Buttons are circles
    for (const btn of this.buttons) {
      const bg = btn.bg;
      if (bg.getBounds().contains(x, y)) {
         return true;
      }
    }
    return false;
  }

  private onAimDown(p: Phaser.Input.Pointer) {
    // Explicitly ignore if touching a button
    if (this.isPointOverButton(p.x, p.y)) return;

    const main: any = this.scene.get('MainScene');
    if (!main?.sys?.isActive?.()) return;
    if (this.aimPointerId !== null) return;
    this.aimPointerId = p.id;

    let ax = main.aimWorld?.x ?? 0;
    let ay = main.aimWorld?.y ?? 0;
    if (Math.abs(ax) < 0.1 && Math.abs(ay) < 0.1 && main.player?.chassis?.active) {
         ax = main.player.chassis.x;
         ay = main.player.chassis.y;
         if (main.aimWorld) main.aimWorld.set(ax, ay);
    }

    this.aimStartScreen.set(p.x, p.y);
    this.aimStartWorld.set(ax, ay);

    if (this.aimFireTimer) this.aimFireTimer.destroy();
    this.aimFirePointerId = null;
    this.aimFireTimer = this.time.delayedCall(140, () => {
      if (this.aimPointerId !== p.id) return;
      const dx = p.x - this.aimStartScreen.x;
      const dy = p.y - this.aimStartScreen.y;
      if ((dx * dx + dy * dy) > (22 * 22)) return;
      this.aimFirePointerId = p.id;
    });
  }

  private onAimMove(p: Phaser.Input.Pointer) {
    if (this.aimPointerId !== p.id) return;
    const main: any = this.scene.get('MainScene');
    if (!main?.sys?.isActive?.()) return;

    const dx = p.x - this.aimStartScreen.x;
    const dy = p.y - this.aimStartScreen.y;
    if (this.aimFirePointerId === null && (dx * dx + dy * dy) > (26 * 26)) {
      if (this.aimFireTimer) this.aimFireTimer.destroy();
      this.aimFireTimer = undefined;
    }
  }

  private onAimUp(p: Phaser.Input.Pointer) {
    if (this.aimPointerId !== p.id) return;
    this.aimPointerId = null;
    if (this.aimFirePointerId === p.id) this.aimFirePointerId = null;
    if (this.aimFireTimer) this.aimFireTimer.destroy();
    this.aimFireTimer = undefined;
  }

  private onStickDown(p: Phaser.Input.Pointer) {
    if (this.isPointOverButton(p.x, p.y)) return;
    if (this.aimPointerId !== null) return;
    this.aimPointerId = p.id;
    this.updateStickFromPointer(p);

    if (this.aimFireTimer) this.aimFireTimer.destroy();
    this.aimFireTimer = undefined;
    this.aimFirePointerId = null;
    const magSq = this.aimStickVec.x * this.aimStickVec.x + this.aimStickVec.y * this.aimStickVec.y;
    if (magSq >= 0.02) this.aimFirePointerId = p.id;
  }

  private onStickMove(p: Phaser.Input.Pointer) {
    if (this.aimPointerId !== p.id) return;
    this.updateStickFromPointer(p);
    if (this.aimFirePointerId === null) {
      const magSq = this.aimStickVec.x * this.aimStickVec.x + this.aimStickVec.y * this.aimStickVec.y;
      if (magSq >= 0.02) this.aimFirePointerId = p.id;
    }
  }

  private onStickUp(p: Phaser.Input.Pointer) {
    if (this.aimPointerId !== p.id) return;
    this.aimPointerId = null;
    this.resetStickState(p.id);
  }

  private resetStickState(pointerId?: number) {
    this.aimStickVec.set(0, 0);
    if (this.aimStickTriangle?.active) this.aimStickTriangle.setPosition(this.aimStickCenter.x, this.aimStickCenter.y);
    if (pointerId !== undefined && this.aimFirePointerId === pointerId) this.aimFirePointerId = null;
    if (this.aimFireTimer) this.aimFireTimer.destroy();
    this.aimFireTimer = undefined;
  }

  private updateStickFromPointer(p: Phaser.Input.Pointer) {
    const dx = p.x - this.aimStickCenter.x;
    const dy = p.y - this.aimStickCenter.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const r = Math.max(1, this.aimStickRadius);
    const clampedLen = Math.min(r, len);
    const nx = len > 0.0001 ? (dx / len) : 0;
    const ny = len > 0.0001 ? (dy / len) : 0;
    const mag = clampedLen / r;
    this.aimStickVec.set(nx * mag, ny * mag);

    if (this.aimStickTriangle?.active) {
      const tx = this.aimStickCenter.x + nx * clampedLen;
      const ty = this.aimStickCenter.y + ny * clampedLen;
      this.aimStickTriangle.setPosition(tx, ty);
    }
  }

  private onTankstarAimDown(p: Phaser.Input.Pointer) {
    if (this.isPointOverButton(p.x, p.y)) return;
    const main: any = this.scene.get('MainScene');
    if (!main?.sys?.isActive?.()) return;
    if (this.aimPointerId !== null) return;
    this.aimPointerId = p.id;
    this.aimStartScreen.set(p.x, p.y);
    this.tankstarAimLastPointerScreen.set(p.x, p.y);
    this.aimStickVec.set(0, 0);
    this.aimFirePointerId = null;
    if (this.aimFireTimer) this.aimFireTimer.destroy();
    this.aimFireTimer = this.time.delayedCall(120, () => {
      if (this.aimPointerId !== p.id) return;
      const dx = p.x - this.aimStartScreen.x;
      const dy = p.y - this.aimStartScreen.y;
      if ((dx * dx + dy * dy) > (20 * 20)) return;
      this.aimFirePointerId = p.id;
    });
    if (this.tankstarAimOrigin?.active) this.tankstarAimOrigin.setPosition(p.x, p.y).setVisible(true);
    if (this.tankstarAimPowerFill?.active) this.tankstarAimPowerFill.setVisible(false);
    if (this.tankstarAimGfx?.active) this.tankstarAimGfx.clear();
  }

  private onTankstarAimMove(p: Phaser.Input.Pointer) {
    if (this.aimPointerId !== p.id) return;
    if (this.isPointOverButton(p.x, p.y)) return;
    this.tankstarAimLastPointerScreen.set(p.x, p.y);
    this.updateTankstarAimFromPointer(p);
    if (this.aimFirePointerId === null) {
      const magSq = this.aimStickVec.x * this.aimStickVec.x + this.aimStickVec.y * this.aimStickVec.y;
      if (magSq >= 0.015) this.aimFirePointerId = p.id;
    }
  }

  private onTankstarAimUp(p: Phaser.Input.Pointer) {
    if (this.aimPointerId !== p.id) return;
    this.aimPointerId = null;
    this.resetTankstarAimState(p.id);
  }

  private resetTankstarAimState(pointerId?: number) {
    this.aimStickVec.set(0, 0);
    if (pointerId !== undefined && this.aimFirePointerId === pointerId) this.aimFirePointerId = null;
    if (this.aimFireTimer) this.aimFireTimer.destroy();
    this.aimFireTimer = undefined;
    if (this.tankstarAimOrigin?.active) this.tankstarAimOrigin.setVisible(false);
    if (this.tankstarAimPowerFill?.active) this.tankstarAimPowerFill.setVisible(false);
    if (this.tankstarAimGfx?.active) this.tankstarAimGfx.clear();
  }

  private updateTankstarAimFromPointer(p: Phaser.Input.Pointer) {
    const dx = p.x - this.aimStartScreen.x;
    const dy = p.y - this.aimStartScreen.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    // Smooth dampening factor based on drag length
    // When len is small, we want fine control (lower sensitivity)
    // When len is large, we want normal control
    const maxDrag = Math.max(80, Math.min(this.aimClampRect.width, this.aimClampRect.height) * 0.45);
    
    // Apply a non-linear response curve for smoother aiming
    // Quadratic ease-out feeling: output = input * (2 - input) ? No, we want precise low-end.
    // Let's use a simple exponential response for magnitude
    
    const rawRatio = Math.min(1, len / maxDrag);
    const easedRatio = rawRatio; // Linear for now, but we can tweak if needed.
    
    // Deadzone to prevent jitter at very start
    if (len < 4) {
        this.aimStickVec.set(0, 0);
        return;
    }

    const clampedLen = Math.min(maxDrag, len);
    const nx = len > 0.0001 ? (dx / len) : 0;
    const ny = len > 0.0001 ? (dy / len) : 0;
    const mag = clampedLen / maxDrag;
    this.aimStickVec.set(nx * mag, ny * mag);

    const gfx = this.tankstarAimGfx;
    if (gfx?.active) {
      gfx.clear();
      if (clampedLen >= 6) {
        const ex = this.aimStartScreen.x + nx * clampedLen;
        const ey = this.aimStartScreen.y + ny * clampedLen;
        gfx.lineStyle(6, 0x000000, 0.22);
        gfx.beginPath();
        gfx.moveTo(this.aimStartScreen.x, this.aimStartScreen.y);
        gfx.lineTo(ex, ey);
        gfx.strokePath();
        gfx.lineStyle(3, 0xffaa00, 0.85);
        gfx.beginPath();
        gfx.moveTo(this.aimStartScreen.x, this.aimStartScreen.y);
        gfx.lineTo(ex, ey);
        gfx.strokePath();
        gfx.fillStyle(0xffaa00, 0.9);
        gfx.fillCircle(ex, ey, 6);
      }
    }

    if (this.tankstarAimPowerFill?.active && this.tankstarAimPowerBg?.active) {
      const bg = this.tankstarAimPowerBg;
      const fill = this.tankstarAimPowerFill;
      const fullH = bg.height - 4;
      const h = Math.max(2, Math.round(fullH * mag));
      fill.setSize(bg.width - 4, h);
      fill.setPosition(bg.x, bg.y + bg.height - 2);
      fill.setVisible(mag >= 0.02);
    }
  }

  private onTankstarMoveDown(p: Phaser.Input.Pointer) {
    if (this.tankstarMovePointerId !== null) return;
    if (this.aimPointerId === p.id) return;
    this.tankstarMovePointerId = p.id;
    this.updateTankstarMoveFromPointer(p);
  }

  private onTankstarMoveMove(p: Phaser.Input.Pointer) {
    if (this.tankstarMovePointerId !== p.id) return;
    this.updateTankstarMoveFromPointer(p);
  }

  private onTankstarMoveUp(p: Phaser.Input.Pointer) {
    if (this.tankstarMovePointerId !== p.id) return;
    this.tankstarMovePointerId = null;
    this.tankstarMoveAxis = 0;
    if (this.tankstarMoveKnob?.active) this.tankstarMoveKnob.setPosition(this.tankstarMoveCenter.x, this.tankstarMoveCenter.y);
  }

  private updateTankstarMoveFromPointer(p: Phaser.Input.Pointer) {
    const dx = p.x - this.tankstarMoveCenter.x;
    const dy = p.y - this.tankstarMoveCenter.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const r = Math.max(1, this.tankstarMoveRadius);
    const clampedLen = Math.min(r, len);
    const nx = len > 0.0001 ? (dx / len) : 0;
    const ny = len > 0.0001 ? (dy / len) : 0;
    const x = this.tankstarMoveCenter.x + nx * clampedLen;
    const y = this.tankstarMoveCenter.y + ny * clampedLen;
    if (this.tankstarMoveKnob?.active) this.tankstarMoveKnob.setPosition(x, y);
    this.tankstarMoveAxis = Phaser.Math.Clamp(dx / r, -1, 1);
  }

  // --- Radial Weapon Wheel Implementation ---

  private normalizeWheelAngle(deg: number): number {
    let v = deg % 360;
    if (v > 180) v -= 360;
    if (v <= -180) v += 360;
    return v;
  }

  private angleDistanceDeg(a: number, b: number): number {
    return Math.abs(this.normalizeWheelAngle(a - b));
  }

  private isAngleInWheelSector(angleDeg: number, startDeg: number, endDeg: number): boolean {
    const norm360 = (deg: number) => {
      let d = deg % 360;
      if (d < 0) d += 360;
      return d;
    };
    let a = norm360(angleDeg);
    let s = norm360(startDeg);
    let e = norm360(endDeg);
    if (e < s) e += 360;
    if (a < s) a += 360;
    return a >= s && a <= e;
  }

  private drawWheelSlice(
    gfx: Phaser.GameObjects.Graphics,
    startDeg: number,
    endDeg: number,
    rInner: number,
    rOuter: number,
    color: number,
    alpha: number
  ) {
    const norm360 = (deg: number) => {
      let d = deg % 360;
      if (d < 0) d += 360;
      return d;
    };
    let s = norm360(startDeg);
    let e = norm360(endDeg);
    if (e <= s) e += 360;
    const span = e - s;
    const steps = Math.max(5, Math.ceil(span / 10));

    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i <= steps; i++) {
      const deg = s + (span * i) / steps;
      const rad = Phaser.Math.DegToRad(deg);
      pts.push(new Phaser.Math.Vector2(Math.cos(rad) * rOuter, Math.sin(rad) * rOuter));
    }
    for (let i = steps; i >= 0; i--) {
      const deg = s + (span * i) / steps;
      const rad = Phaser.Math.DegToRad(deg);
      pts.push(new Phaser.Math.Vector2(Math.cos(rad) * rInner, Math.sin(rad) * rInner));
    }

    gfx.fillStyle(color, alpha);
    gfx.lineStyle(2, 0xffffff, 0.45);
    gfx.fillPoints(pts, true);
    gfx.strokePoints(pts, true);
  }

  private onWeaponBtnDown(p: Phaser.Input.Pointer, originX: number, originY: number) {
    if (this.weaponWheelPointerId !== null) return;
    if (this.aimPointerId === p.id || this.tankstarMovePointerId === p.id) return;

    this.weaponWheelPointerId = p.id;
    this.weaponWheelOrigin.set(originX, originY);

    this.weaponWheelTimer = this.time.delayedCall(200, () => {
      if (this.weaponWheelPointerId === p.id) {
        this.showWeaponWheel();
      }
    });
  }

  private onWeaponBtnMove(p: Phaser.Input.Pointer) {
    if (this.weaponWheelPointerId !== p.id) return;
    if (this.weaponWheel?.visible) {
      this.updateWeaponWheelSelection(p);
    }
  }

  private onWeaponBtnUp(p: Phaser.Input.Pointer) {
    if (this.weaponWheelPointerId !== p.id) return;
    this.weaponWheelPointerId = null;

    if (this.weaponWheelTimer) {
      this.weaponWheelTimer.destroy();
      this.weaponWheelTimer = undefined;
    }

    if (this.weaponWheel?.visible) {
      if (this.weaponWheelSelection !== null) {
        const main: any = this.scene.get('MainScene');
        if (main?.player?.setShell) main.player.setShell(this.weaponWheelSelection);
      }
      this.hideWeaponWheel();
    } else {
      const main: any = this.scene.get('MainScene');
      if (main?.player?.cycleShell) main.player.cycleShell();
    }
  }

  private createWeaponWheel() {
    const c = this.add.container(0, 0).setDepth(2000).setVisible(false);
    const gfx = this.add.graphics();
    c.add(gfx);

    const isAndroid = !!this.sys.game.device.os.android;
    const r = (this.weaponWheelInnerRadius + this.weaponWheelOuterRadius) * 0.5;
    for (const opt of this.weaponWheelOptions) {
      const rad = Phaser.Math.DegToRad(opt.angleDeg);
      const tx = Math.cos(rad) * r;
      const ty = Math.sin(rad) * r;
      const t = this.add.text(tx, ty, opt.label, {
        fontSize: isAndroid ? '17px' : '16px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3
      }).setOrigin(0.5);
      if (isAndroid && typeof window !== 'undefined') {
        const dpr = window.devicePixelRatio || 1;
        t.setResolution(Phaser.Math.Clamp(dpr, 1.25, 3));
      }
      c.add(t);
    }

    this.weaponWheel = c;
    this.weaponWheelGfx = gfx;
  }

  private showWeaponWheel() {
    if (!this.weaponWheel) this.createWeaponWheel();

    const b = this.aimClampRect;
    const pad = 10;
    const outer = this.weaponWheelOuterRadius;
    const minX = b.x + outer + pad;
    const maxX = b.x + b.width - outer - pad;
    const topGuard = Math.max(b.y + outer + pad, b.y + b.height * 0.34);
    const minY = Math.min(topGuard, b.y + b.height - outer - pad);
    const maxY = b.y + b.height - outer - pad;
    const safeMinX = Math.min(minX, maxX);
    const safeMaxX = Math.max(minX, maxX);
    const safeMinY = Math.min(minY, maxY);
    const safeMaxY = Math.max(minY, maxY);
    this.weaponWheelOrigin.set(
      Phaser.Math.Clamp(this.weaponWheelOrigin.x, safeMinX, safeMaxX),
      Phaser.Math.Clamp(this.weaponWheelOrigin.y, safeMinY, safeMaxY)
    );

    this.weaponWheel?.setPosition(this.weaponWheelOrigin.x, this.weaponWheelOrigin.y)
      .setVisible(true)
      .setScale(0);

    this.tweens.add({
      targets: this.weaponWheel,
      scaleX: 1,
      scaleY: 1,
      duration: 150,
      ease: 'Back.Out'
    });

    this.weaponWheelSelection = null;
    this.drawWeaponWheelSectors(-1);
  }

  private hideWeaponWheel() {
    if (!this.weaponWheel) return;
    this.tweens.add({
      targets: this.weaponWheel,
      scaleX: 0,
      scaleY: 0,
      alpha: 0,
      duration: 150,
      onComplete: () => {
        this.weaponWheel?.setVisible(false).setAlpha(1);
      }
    });
  }

  private updateWeaponWheelSelection(p: Phaser.Input.Pointer) {
    const dx = p.x - this.weaponWheelOrigin.x;
    const dy = p.y - this.weaponWheelOrigin.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < 20 * 20) {
      this.weaponWheelSelection = null;
      this.drawWeaponWheelSectors(-1);
      return;
    }

    const angle = Phaser.Math.RadToDeg(Math.atan2(dy, dx));

    let bestIndex = -1;
    for (let i = 0; i < this.weaponWheelOptions.length; i++) {
      const option = this.weaponWheelOptions[i];
      if (this.isAngleInWheelSector(angle, option.startDeg, option.endDeg)) {
        bestIndex = i;
        break;
      }
    }

    if (bestIndex < 0) {
      this.weaponWheelSelection = null;
      this.drawWeaponWheelSectors(-1);
      return;
    }

    this.weaponWheelSelection = this.weaponWheelOptions[bestIndex].type;
    this.drawWeaponWheelSectors(bestIndex);
  }

  private drawWeaponWheelSectors(highlightIndex: number) {
    const gfx = this.weaponWheelGfx;
    if (!gfx) return;
    gfx.clear();

    const rOuter = this.weaponWheelOuterRadius;
    const rInner = this.weaponWheelInnerRadius;

    for (let i = 0; i < this.weaponWheelOptions.length; i++) {
      const opt = this.weaponWheelOptions[i];
      const isHighlight = i === highlightIndex;
      const color = isHighlight ? 0x00aaff : 0x000000;
      const alpha = isHighlight ? 0.62 : 0.42;
      this.drawWheelSlice(gfx, opt.startDeg, opt.endDeg, rInner, rOuter, color, alpha);
    }

    gfx.fillStyle(0x000000, 0.34);
    gfx.fillCircle(0, 0, rInner - 4);
    gfx.lineStyle(2, 0xffffff, 0.35);
    gfx.strokeCircle(0, 0, rInner - 4);
  }


  private releasePointerEverywhere(pointerId: number) {
    for (const set of Object.values(this.heldPointers)) set.delete(pointerId);
    if (this.aimPointerId === pointerId) {
      this.aimPointerId = null;
      this.resetStickState(pointerId);
      this.resetTankstarAimState(pointerId);
    }
    if (this.tankstarMovePointerId === pointerId) this.onTankstarMoveUp({ id: pointerId } as any);
    if (this.aimFirePointerId === pointerId) this.aimFirePointerId = null;
    if (this.weaponWheelPointerId === pointerId) this.onWeaponBtnUp({ id: pointerId } as any);
  }
}

