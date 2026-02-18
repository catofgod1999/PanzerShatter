
import Phaser from 'phaser';
import type { MainScene } from '../MainScene';
import { Tank } from './Tank';
import { ShellType } from '../types/GameplayTypes';

export class Helicopter extends Phaser.Physics.Arcade.Sprite {
  private sceneRef: MainScene;
  public hp = 100; // Normalized for percentage (100 bullets = dead, 300 bullets = dead mentioned in prompt 1, but "1% per bullet" in prompt 2 takes priority)
  public maxHp = 100;
  public active = true;
  public isDead = false;
  private rotor: Phaser.GameObjects.Rectangle;
  private lastMissileFired = 0;
  private firstEngagementTime = 0;
  private healthBar: Phaser.GameObjects.Graphics;
  private isBurning = false;
  private burnUntilT = 0;
  private lastBurnFxT = 0;
  private lastDamageType: ShellType = ShellType.HE;
  private readonly audioInstanceId = Phaser.Utils.String.UUID();
  private mechanicalLoopSound: Phaser.Sound.BaseSound | null = null;
  private mechanicalLoopStarting = false;
  private burnHeatStartT = 0;
  private burnHeatEndT = 0;
  private burnHeatOrigTint: number | null = null;

  // Declare properties that might not be correctly inherited in the type system
  public declare body: Phaser.Physics.Arcade.Body;

  constructor(scene: MainScene, x: number, y: number, opts?: { cinematic?: boolean; invulnerable?: boolean; hideHealthBar?: boolean }) {
    super(scene, x, y, 'heli_body');
    this.sceneRef = scene;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.body.setAllowGravity(false);
    
    const heliScale = 1.5 * (3 / 4);
    this.setDepth(40).setScale(heliScale);
    this.rotor = scene.add.rectangle(x, y - 30, 150 * (3 / 4), 4, 0x111111).setDepth(this.depth + 1);
    this.healthBar = scene.add.graphics().setDepth(this.depth + 10);
    this.firstEngagementTime = scene.time.now;
    this.lastMissileFired = scene.time.now + 5000; // First shot after 5 seconds
    if (opts?.cinematic) this.setData('cinematic', true);
    if (opts?.invulnerable) this.setData('invulnerable', true);
    if (opts?.hideHealthBar) this.healthBar.setVisible(false);
    this.once('destroy', () => { 
        this.sceneRef.audio.stopLoop(`e_heli_mech_${this.audioInstanceId}`, 0);
        this.mechanicalLoopSound = null;
        this.mechanicalLoopStarting = false;
        if (this.healthBar?.active) this.healthBar.destroy(); 
        if (this.rotor?.active) this.rotor.destroy();
    });
  }

  public update(time: number, delta: number, player: Tank) {
    if (this.isDead) return;

    this.rotor.setDepth(this.depth + 1);
    this.healthBar.setDepth(this.depth + 10);

    if (this.getData('cinematic') === true) {
      this.rotor.setPosition(this.x, this.y - 30);
      this.rotor.scaleX = Math.sin(time * 0.06);
      if (this.healthBar?.active) this.healthBar.clear();
      return;
    }

    this.updateMechanicalLoop(time);
    this.updateBurnHeatTint(time);

    // Hover logic: Low altitude above terrain
    const terrainH = this.sceneRef.getTerrainHeight(this.x);
    const hoverY = terrainH - 350 + Math.sin(time * 0.001) * 20;
    this.y = Phaser.Math.Linear(this.y, hoverY, 0.03);
    
    // Rotor animation
    this.rotor.setPosition(this.x, this.y - 30);
    this.rotor.scaleX = Math.sin(time * 0.06);

    // AI Positioning: Stay visible in range but dynamic
    const dist = Phaser.Math.Distance.Between(this.x, this.y, player.chassis.x, player.chassis.y);
    
    const isMobile = !!(this.sceneRef.sys.game.device.os.android || this.sceneRef.sys.game.device.os.iOS);
    const aggroRange = 1800 * (isMobile ? 0.5 : 1) * this.sceneRef.getEnemyAggroVisionScale();
    if (dist < aggroRange) {
        const targetX = player.chassis.x + 400;
        const moveX = (targetX - this.x) * 0.02;
        this.body.setVelocityX(moveX * 60);
        this.setFlipX(player.chassis.x < this.x);

        if (time > this.lastMissileFired + 10000) {
            this.fireMissile(player);
            this.lastMissileFired = time;
        }
    } else {
        this.body.setVelocityX(this.body.velocity.x * 0.92);
    }

    this.isBurning = time < this.burnUntilT;
    if (this.isBurning && time > this.lastBurnFxT + 220) {
        this.sceneRef.particles.createLingeringFire(this.x + Phaser.Math.Between(-20, 20), this.y + Phaser.Math.Between(-12, 12), 22);
        this.lastBurnFxT = time;
    }

    this.drawHealthBar();
  }

  private fireMissile(player: Tank) {
    const muzzleX = this.x + (this.flipX ? -40 : 40), muzzleY = this.y + 20;
    this.sceneRef.events.emit('combat-activity', { source: 'enemy-fire', team: 'enemy' });
    this.sceneRef.audio.playFolder('vehicle/enemy_helicopter/Fire/sfx', { worldX: muzzleX, worldY: muzzleY, volume: 0.95, cooldownMs: 0 });
    const missile = this.sceneRef.physics.add.sprite(muzzleX, muzzleY, 'proj_missile').setScale(1.2).setDepth(45);
    (missile.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
    this.sceneRef.particles.createShellTrail(missile, ShellType.HE);

    const stopProjectileFlightLoop = (projectile: any) => {
        if (!projectile) return;
        const loopId = projectile.getData?.('flightLoopId') as string | undefined;
        if (loopId) {
            this.sceneRef.audio.stopLoop(loopId, 0);
            projectile.setData?.('flightLoopId', undefined);
        }
        projectile.setData?.('flightLoopSound', undefined);
    };
    missile.once(Phaser.GameObjects.Events.DESTROY, () => stopProjectileFlightLoop(missile));
    
    // Simple homing logic using physics velocity updates
    // Use a named function for the update listener so it can be safely removed by off()
    const onUpdate = () => {
        if (!missile.active || !player.chassis.active) {
            stopProjectileFlightLoop(missile);
            this.sceneRef.events.off('update', onUpdate);
            return;
        }
        {
            const missileBounds = missile.getBounds();
            Phaser.Geom.Rectangle.Inflate(missileBounds, 8, 8);
            const projectiles = (this.sceneRef.bulletGroup?.getChildren?.() as any[] | undefined) ?? [];
            for (const p of projectiles) {
                if (!p || !p.active) continue;
                const pType = p.getData?.('type') as ShellType | undefined;
                const pOwner = p.getData?.('owner') as Tank | undefined;
                if (!pOwner || !pOwner.isPlayer) continue;
                if (pType !== ShellType.BULLET && pType !== ShellType.AP && pType !== ShellType.HE && pType !== ShellType.STANDARD && pType !== ShellType.INCENDIARY && pType !== ShellType.MORTAR && pType !== ShellType.NUKE) continue;
                const pBounds = (p.getBounds && p.getBounds()) as Phaser.Geom.Rectangle;
                if (!pBounds) continue;
                Phaser.Geom.Rectangle.Inflate(pBounds, pType === ShellType.BULLET ? 6 : 10, pType === ShellType.BULLET ? 6 : 10);
                let hit = Phaser.Geom.Intersects.RectangleToRectangle(missileBounds, pBounds);
                const pBody = p.body as Phaser.Physics.Arcade.Body | undefined;
                if (!hit && pBody) {
                    const pLine = new Phaser.Geom.Line(
                        ((p.getData?.('prevX') as number | undefined) ?? (p.x - pBody.velocity.x * (1 / 60))),
                        ((p.getData?.('prevY') as number | undefined) ?? (p.y - pBody.velocity.y * (1 / 60))),
                        p.x,
                        p.y
                    );
                    hit = Phaser.Geom.Intersects.LineToRectangle(pLine, missileBounds);
                }
                if (!hit) continue;
                this.sceneRef.particles.createSmallSpark(missile.x, missile.y);
                if (pType !== ShellType.AP) {
                    stopProjectileFlightLoop(p);
                    p.destroy();
                }
                this.sceneRef.awardEventPoints('intercept', '导弹拦截', 180, '拦截导弹');
                this.sceneRef.triggerExplosion(missile.x, missile.y, 200, 200, false, ShellType.HE, this.sceneRef.player);
                stopProjectileFlightLoop(missile);
                missile.destroy();
                this.sceneRef.events.off('update', onUpdate);
                return;
            }
        }
        const angle = Phaser.Math.Angle.Between(missile.x, missile.y, player.chassis.x, player.chassis.y);
        this.sceneRef.physics.velocityFromRotation(angle, 300, missile.body.velocity);
        missile.setRotation(angle);

        // Collision check
        if (Phaser.Geom.Intersects.RectangleToRectangle(missile.getBounds(), player.chassis.getBounds())) {
            player.takeDamage(800);
            this.sceneRef.triggerExplosion(missile.x, missile.y, 200, 200, true, ShellType.HE, this);
            stopProjectileFlightLoop(missile);
            missile.destroy();
            this.sceneRef.events.off('update', onUpdate);
        }
        
        // Timeout
        if (missile.active && !this.sceneRef.cameras.main.worldView.contains(missile.x, missile.y)) {
             stopProjectileFlightLoop(missile);
             missile.destroy();
             this.sceneRef.events.off('update', onUpdate);
        }
    };
    this.sceneRef.events.on('update', onUpdate);
  }

  private drawHealthBar() {
    if (!this.active || !this.healthBar?.active || this.isDead || !this.body) {
        if (this.healthBar?.active) this.healthBar.clear();
        return;
    }
    this.healthBar.clear();
    this.healthBar.fillStyle(0x000000, 0.7);
    this.healthBar.fillRect(this.x - 40, this.y - 60, 80, 6);
    const fill = Math.max(0, this.hp / this.maxHp);
    this.healthBar.fillStyle(this.isBurning ? 0xff6600 : 0xff0000, 1);
    this.healthBar.fillRect(this.x - 39, this.y - 59, 78 * fill, 4);
  }

  public takeDamage(amt: number, type: ShellType = ShellType.BULLET) {
    if (this.isDead) return;
    if (this.getData('invulnerable') === true) return;

    this.lastDamageType = type;
    let actualDamage = 0;
    switch(type) {
        case ShellType.STANDARD: actualDamage = 30; break;
        case ShellType.HE: actualDamage = 100; break; // 1-shot kill
        case ShellType.AP: actualDamage = 40; break;  // 40% dmg
        case ShellType.INCENDIARY: 
            actualDamage = amt;
            this.burnUntilT = Math.max(this.burnUntilT, this.sceneRef.time.now + 6000);
            this.touchBurnHeat(this.sceneRef.time.now, 6000);
            this.isBurning = true;
            break;
        case ShellType.BULLET: 
            actualDamage = 0.25;
            break;
        default: actualDamage = amt;
    }

    this.hp -= actualDamage;
    if (actualDamage > 0) this.sceneRef.events.emit('combat-damage', { team: 'enemy', source: 'helicopter' });
    if (this.hp <= 0) this.destroyHeli();
  }

  private destroyHeli() {
    this.isDead = true;
    this.active = false;
    this.sceneRef.recordEnemyVehicleKill('直升机', 1000, this, this.lastDamageType);
    this.sceneRef.audio.stopLoop(`e_heli_mech_${this.audioInstanceId}`, 300);
    this.mechanicalLoopSound = null;
    this.mechanicalLoopStarting = false;

    const cookoffSub =
      this.lastDamageType === ShellType.AP ? 'piercing_armor_shell' :
      this.lastDamageType === ShellType.INCENDIARY ? 'incendiary_shell' :
      'standard_shell';
    const cookoffFolder = `vehicle/enemy_helicopter/cookoff/${cookoffSub}/sfx`;
    this.sceneRef.audio.playFolder(cookoffFolder, { worldX: this.x, worldY: this.y, volume: 1.0, cooldownMs: 0 });
    if (cookoffFolder.endsWith('/standard_shell/sfx')) {
      this.sceneRef.audio.playFolder(cookoffFolder.replace('/standard_shell/sfx', '/standard_shell_DS/sfx'), { worldX: this.x, worldY: this.y, volume: 1.0, cooldownMs: 0 });
    }
    this.sceneRef.triggerExplosion(this.x, this.y, 600, 1000, false, ShellType.HE, this, 'vehicle');
    this.sceneRef.particles.createLingeringFire(this.x, this.y, 40);

    const wreck = this.sceneRef.debrisGroup.get(this.x, this.y, 'heli_body');
    if (wreck) {
        wreck.setActive(true).setVisible(true).setDepth(34).setAlpha(1).setScale(1.5 * (3 / 4)).setTint(0x777777);
        const body = wreck.body as Phaser.Physics.Arcade.Body;
        body.setEnable(true);
        body.setImmovable(false);
        body.setAllowGravity(true);
        body.setAllowRotation(true);
        body.setVelocity(Phaser.Math.Between(-180, 180), Phaser.Math.Between(-200, -50));
        wreck.setAngularVelocity(Phaser.Math.Between(-220, 220));
        wreck.setData('sleeping', false);
        this.sceneRef.tweens.add({ targets: wreck, alpha: 0, delay: 60000, duration: 5000, onComplete: () => wreck.destroy() });
        this.sceneRef.time.delayedCall(500, () => { if (wreck.active) this.sceneRef.particles.createLingeringFire(wreck.x, wreck.y, 30); });
        this.sceneRef.time.delayedCall(1200, () => { if (wreck.active) this.sceneRef.triggerExplosion(wreck.x, wreck.y, 600, 1200, false, ShellType.HE, this, 'vehicle'); });
    }

    this.rotor.destroy();
    this.healthBar.destroy();
    this.destroy();
  }

  private updateMechanicalLoop(time: number): void {
    if (this.isDead || !this.active) return;
    const loopId = `e_heli_mech_${this.audioInstanceId}`;
    if (!this.mechanicalLoopSound && !this.mechanicalLoopStarting) {
      this.mechanicalLoopStarting = true;
      this.sceneRef.audio.startLoop(loopId, 'vehicle/enemy_helicopter/mechanical_loop/sfx', { volume: 0.65, fadeInMs: 900, worldX: this.x, worldY: this.y, maxDistance: 5200 })
        .then(sound => {
          this.mechanicalLoopStarting = false;
          if (!sound) return;
          if (this.isDead || !this.active) {
            this.sceneRef.audio.stopLoop(loopId, 0);
            return;
          }
          this.mechanicalLoopSound = sound;
        })
        .catch(() => { this.mechanicalLoopStarting = false; });
    } else if (this.mechanicalLoopSound) {
      (this.mechanicalLoopSound as any).__panzerWorldX = this.x;
      (this.mechanicalLoopSound as any).__panzerWorldY = this.y;
      (this.mechanicalLoopSound as any).__panzerMaxDistance = 5200;
    }
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
    this.setAlpha(1);
  }
}
