
import Phaser from 'phaser';
import type { MainScene } from '../MainScene';
import { Tank } from '../entities/Tank';
import { ShellType } from '../types/GameplayTypes';

enum Role { RIFLE, RPG, ENGINEER }
enum State { IDLE, WALK, RUN, SHOOT, SURRENDER }

class Soldier {
  public root: Phaser.GameObjects.Container;
  public head: Phaser.GameObjects.Sprite;
  public torso: Phaser.GameObjects.Sprite;
  public arms: Phaser.GameObjects.Sprite[] = [];
  public legs: Phaser.GameObjects.Sprite[] = [];
  public weapon: Phaser.GameObjects.Sprite;
  public whiteFlag?: Phaser.GameObjects.Sprite;
  public wrench?: Phaser.GameObjects.Sprite;
  public healthBar: Phaser.GameObjects.Graphics;
  
  public x: number;
  public y: number;
  public isAlly: boolean;
  public role: Role;
  public active = true;
  public hp = 30; 
  private maxHp = 30;
  private lastRepairTime = 0;

  public state: State = State.IDLE;
  private animTimer = 0;
  public facing = 1; 
  private readonly baseScale = 2.24;

  constructor(scene: MainScene, x: number, y: number, isAlly: boolean, isEngineer: boolean = false) {
    this.isAlly = isAlly;
    this.role = isEngineer ? Role.ENGINEER : (Math.random() > 0.8 ? Role.RPG : Role.RIFLE);
    this.x = x; this.y = y;
    
    const f = scene.add;
    if (!scene.textures.exists('inf_white_flag')) {
      const g = scene.add.graphics({ x: 0, y: 0 });
      g.setVisible(false);
      g.clear();
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(0, 0, 3, 36, 1);
      g.fillStyle(0xf7f7f7, 1);
      g.fillRoundedRect(3, 6, 18, 12, 2);
      g.fillStyle(0xdddddd, 0.55);
      g.fillRect(3, 6, 18, 2);
      g.fillRect(3, 10, 18, 1);
      g.fillRect(3, 14, 18, 1);
      g.lineStyle(1, 0xbdbdbd, 0.7);
      g.strokeRoundedRect(3.5, 6.5, 17, 11, 2);
      g.generateTexture('inf_white_flag', 22, 36);
      g.destroy();
    }
    let tKey = isAlly ? 'inf_torso_ally' : 'inf_torso_enemy';
    if (isEngineer) tKey = 'inf_torso_eng';

    const factionStr = isEngineer ? 'eng' : (isAlly ? 'ally' : 'enemy');
    const headKey = isEngineer ? 'inf_head_neutral' : (isAlly ? 'inf_head_ally_neutral' : 'inf_head_enemy_neutral');
    const armKey = `inf_limb_arm_${factionStr}`;
    const legKey = `inf_limb_leg_${factionStr}`;

    this.root = f.container(x, y).setDepth(21);
    this.torso = f.sprite(0, 0, tKey).setScale(this.baseScale);
    // Raise head slightly to sit on new neck
    this.head = f.sprite(0, -14, headKey).setScale(this.baseScale); 
    this.arms = [
      f.sprite(0, 0, armKey).setOrigin(0.5, 0).setScale(this.baseScale),
      f.sprite(0, 0, armKey).setOrigin(0.5, 0).setScale(this.baseScale)
    ];
    this.legs = [
      f.sprite(0, 0, legKey).setOrigin(0.5, 0).setScale(this.baseScale),
      f.sprite(0, 0, legKey).setOrigin(0.5, 0).setScale(this.baseScale)
    ];
    this.weapon = f.sprite(0, 0, 'inf_weapon').setOrigin(0.1, 0.5).setScale(this.baseScale);
    if (isEngineer) this.weapon.setVisible(false); 
    if (isEngineer) this.wrench = f.sprite(0, 0, 'inf_wrench').setOrigin(0.15, 0.8).setScale(this.baseScale).setVisible(false);
    if (!isAlly) this.whiteFlag = f.sprite(0, 0, 'inf_white_flag').setOrigin(0.15, 0.95).setScale(this.baseScale * 0.85).setVisible(false);
    this.healthBar = f.graphics().setDepth(50);

    this.root.add(this.legs);
    this.root.add(this.arms);
    this.root.add([this.torso, this.weapon, ...(this.wrench ? [this.wrench] : []), ...(this.whiteFlag ? [this.whiteFlag] : []), this.head]);

    this.animTimer = Math.random() * 1000;
  }

  public getData(key: string) { return (this.torso as any).getData(key); }
  public setData(key: string, val: any) { (this.torso as any).setData(key, val); }

  public update(scene: MainScene, delta: number, manager?: InfantryManager) {
    if (!this.active) return;
    const ty = scene.getGroundHeight(this.x);
    this.y = ty - 12 * this.baseScale;
    const rot = scene.getTerrainNormal(this.x);
    this.animTimer += delta;
    const isEngineer = this.role === Role.ENGINEER;

    // Water Damage
    const waterY = scene.getWaterSurfaceY(this.x);
    if (waterY !== null && this.y > waterY + 10) {
        const now = scene.time.now;
        const lastDmg = (this.getData('lastWaterDmgT') as number | undefined) || 0;
        if (now > lastDmg + 1000) {
            this.setData('lastWaterDmgT', now);
            this.takeDamage(this.maxHp * 0.09, manager, ShellType.HE);
        }
    }

    const player = scene.player;
    const distToPlayer = Phaser.Math.Distance.Between(this.x, this.y, player.chassis.x, player.chassis.y);
    const repairCap = player.maxHp * 0.6;
    const isRepairing = this.role === Role.ENGINEER && this.active && !this.getData('retired') && distToPlayer < 190 && player.hp < repairCap;
    if (isRepairing) this.facing = player.chassis.x > this.x ? 1 : -1;

    let legAngle = 0, armAngle = 0, bounce = 0, rootAngle = rot;
    const now = scene.time.now;
    const injuredUntil = (this.getData('injuredUntil') as number | undefined) || 0;
    const isInjured = now < injuredUntil;
    const lastHitAt = (this.getData('lastHitAt') as number | undefined) || 0;

    if (this.state === State.WALK || this.state === State.RUN) {
        const speed = (this.state === State.RUN ? 0.015 : 0.008) * (isInjured ? 0.75 : 1);
        const amp = (this.state === State.RUN ? 45 : 25) * (isInjured ? 0.7 : 1);
        legAngle = Math.sin(this.animTimer * speed) * amp;
        armAngle = -Phaser.Math.Angle.Wrap(Math.sin(this.animTimer * speed) * (amp * 0.8));
        bounce = Math.abs(Math.sin(this.animTimer * speed * 2)) * (this.state === State.RUN ? 4.2 : 3.2);
        rootAngle = rot + (this.state === State.RUN ? 0.14 : 0.08) * this.facing;

        // Footstep Audio
        const stepCycle = (this.animTimer * speed * 2) % (Math.PI * 2);
        // Peak of sine wave is step impact
        if (stepCycle > 2.8 && stepCycle < 3.4) {
             const lastStep = (this.getData('lastStepTime') as number | undefined) ?? 0;
             if (now - lastStep > 300) { // Throttle
                  this.setData('lastStepTime', now);
                  if (scene.mapId === 'forest') {
                      scene.audio.playFolder('infantry/common/footsteps/Forest/sfx', { 
                          worldX: this.x, 
                          worldY: this.y, 
                          volume: 0.35, 
                          maxDistance: 900 
                      });
                  }
             }
        }
    } else if (this.state === State.IDLE) bounce = Math.sin(this.animTimer * 0.002) * 1;

    this.torso.setFlipX(this.facing < 0);
    this.head.setFlipX(this.facing < 0);
    this.weapon.setFlipY(this.facing < 0);

    const s = this.baseScale;
    const realY = this.y - bounce * s * 0.85;

    this.root.setPosition(this.x, realY).setRotation(rootAngle);
    this.torso.setPosition(0, 0).setRotation(0);

    const headOffset = this.torso.displayHeight * 0.48;
    this.head.setPosition(0, -headOffset).setRotation(0);

    const footLift = (this.state === State.WALK || this.state === State.RUN) ? (Math.max(0, Math.sin(this.animTimer * 0.02)) * 2.5) : 0;
    const fx = this.facing;
    this.legs[0].setPosition(-3 * s * fx, 10 * s - footLift * s).setRotation(Phaser.Math.DegToRad(legAngle));
    this.legs[1].setPosition(3 * s * fx, 10 * s - (2.5 * s - footLift * s)).setRotation(Phaser.Math.DegToRad(-legAngle));
    
    if (isRepairing) {
        const p = (now * 0.004) % 1;
        const swing = p < 0.22 ? (p / 0.22) : (1 - (p - 0.22) / 0.78);
        const swingRot = Phaser.Math.Linear(-1.25, 0.45, swing) * fx;
        const off = (1 - swing) * 2.6;

        this.arms[0].setPosition(-5.5 * s * fx, -2.5 * s - off).setRotation(swingRot + 0.25 * fx);
        this.arms[1].setPosition(5.5 * s * fx, -2.5 * s - off).setRotation(swingRot - 0.25 * fx);
        this.weapon.setPosition(8 * s * fx, 2 * s).setRotation(0);
        if (this.wrench) {
          this.wrench.setVisible(true);
          const arm = this.arms[1];
          const handLen = arm.displayHeight * 0.92;
          const handX = arm.x - Math.sin(arm.rotation) * handLen;
          const handY = arm.y + Math.cos(arm.rotation) * handLen;
          const gripOff = 2.4 * s;
          this.wrench.setPosition(
            handX - Math.sin(arm.rotation) * gripOff,
            handY + Math.cos(arm.rotation) * gripOff
          ).setRotation(arm.rotation + 0.6 * fx);
          this.wrench.setFlipY(fx < 0);
        }

        if (now > this.lastRepairTime + 220) {
            const tb = player.chassis.getBounds();
            const hitX = fx > 0 ? (tb.left + 10) : (tb.right - 10);
            const hitY = tb.centerY - 30;
            const repairAmt = player.maxHp * 0.0035;
            player.hp = Math.min(repairCap, player.hp + repairAmt);
            scene.particles.createRepairEffect(hitX, hitY);
            if (Math.random() < 0.85) scene.particles.createSmallSpark(hitX, hitY);
            
            // Repair Loop Sound
            if (!this.getData('repairLoopPlaying')) {
                const loopId = `repair_loop_${this.getData('uuid') ?? Math.random()}`;
                this.setData('repairLoopId', loopId);
                this.setData('repairLoopPlaying', true);
                scene.audio.startLoop(loopId, 'infantry/allies/engineer/repair/sfx', {
                    worldX: this.x,
                    worldY: this.y,
                    volume: 0.65,
                    fadeInMs: 200,
                    maxDistance: 1200
                }).catch(() => {});
            }
            this.lastRepairTime = now;
            scene.events.emit('update-hud', { hp: (player.hp/player.maxHp)*100, shell: ShellType[player.currentShell] });
        }
    } else if (this.wrench) {
        this.wrench.setVisible(false);
        // Stop Repair Loop
        if (this.getData('repairLoopPlaying')) {
            const loopId = this.getData('repairLoopId');
            if (loopId) scene.audio.stopLoop(loopId, 300);
            this.setData('repairLoopPlaying', false);
        }
    }

    if (!isRepairing) {
      if (this.state === State.SHOOT) {
        if (!isEngineer) this.weapon.setVisible(true);
        if (this.whiteFlag) this.whiteFlag.setVisible(false);
        this.weapon.setPosition(8 * s * fx, 2 * s);
        const recoil = Math.sin(this.animTimer * 0.025) * 0.12;
        this.weapon.setRotation(this.weapon.rotation + recoil * fx);
        this.arms[0].setPosition(-5.5 * s * fx, -2.5 * s).setRotation(this.weapon.rotation + 0.18 * fx);
        this.arms[1].setPosition(5.5 * s * fx, -2.5 * s).setRotation(this.weapon.rotation - 0.18 * fx);
      } else if (this.state === State.SURRENDER) {
        if (!isEngineer) this.weapon.setVisible(false);
        // Correct hands up animation: Arms should point UP, not just rotate weirdly
        // Upper arm (pivot at shoulder) should rotate ~140-160 degrees (upwards)
        const raise = 14 * s;
        const poleX = 3.2 * s * fx;
        const poleY = -raise - (3.5 * s);
        
        // Adjust arms to look like natural surrender pose
        // Left arm (back)
        this.arms[0].setPosition(-3.5 * s * fx, -2.5 * s).setRotation(Phaser.Math.DegToRad(-145 * fx));
        // Right arm (front)
        this.arms[1].setPosition(3.5 * s * fx, -2.5 * s).setRotation(Phaser.Math.DegToRad(-145 * fx));
        
        if (this.whiteFlag) this.whiteFlag.setVisible(true).setPosition(poleX, poleY).setRotation(0).setFlipX(fx < 0);
      } else {
        if (!isEngineer) this.weapon.setVisible(true);
        if (this.whiteFlag) this.whiteFlag.setVisible(false);
        this.arms[0].setPosition(-5.5 * s * fx, -2.5 * s).setRotation(Phaser.Math.DegToRad(armAngle));
        this.arms[1].setPosition(5.5 * s * fx, -2.5 * s).setRotation(Phaser.Math.DegToRad(-armAngle));
        this.weapon.setPosition(8 * s * fx, 2 * s).setRotation(0);
      }
    }
    const emotion = (now - lastHitAt < 480) ? 'scared' : (this.state === State.SHOOT ? 'angry' : (this.hp / this.maxHp < 0.35 ? 'scared' : 'neutral'));
    const factionPrefix = isEngineer ? '' : (this.isAlly ? 'ally_' : 'enemy_');
    const headTex = `inf_head_${factionPrefix}${emotion}`;
    if (this.head.texture.key !== headTex) this.head.setTexture(headTex);
    this.drawHealthBar();
  }

  public setState(state: State, facing: number) {
    this.state = state; this.facing = facing;
  }

  private drawHealthBar() {
    this.healthBar.clear();
    const bx = this.x - 10, by = this.y - 35;
    this.healthBar.fillStyle(0x000000, 0.6);
    this.healthBar.fillRect(bx, by, 20, 3);
    const fill = Math.max(0, this.hp / this.maxHp);
    this.healthBar.fillStyle(this.isAlly ? 0x00ff00 : 0xff0000, 1);
    this.healthBar.fillRect(bx, by, 20 * fill, 3);
  }

  public takeDamage(amt: number, manager?: InfantryManager, sourceType: ShellType = ShellType.BULLET, hitX?: number, hitY?: number) {
    this.hp -= amt;
    if (manager) {
      this.setData('lastHitAt', manager.scene.time.now);
      if (amt > 0) manager.scene.events.emit('combat-damage', { team: this.isAlly ? 'ally' : 'enemy', source: 'infantry' });
    }
    if (this.hp <= 0) {
      if (manager) manager.handleDeath(this, sourceType, hitX, hitY);
      this.destroy();
    }
  }

  public destroy() {
    this.active = false;
    [this.root, this.healthBar].forEach(s => s && s.destroy());
  }
}

export class InfantryManager {
  public scene: MainScene;
  public soldiers: Soldier[] = [];
  private isAllyTeam: boolean;

  constructor(scene: MainScene, isAlly: boolean) { this.scene = scene; this.isAllyTeam = isAlly; }

  public spawn(x: number, y: number, isEngineer: boolean = false) {
    this.soldiers.push(new Soldier(this.scene, x, y, this.isAllyTeam, isEngineer));
  }

  public update(player: Tank, delta: number) {
    const allowMove = !(this.scene.testRoomEnabled && !this.isAllyTeam && !this.scene.testRoomAllowEnemyMove);
    const allowAttack = !(this.scene.testRoomEnabled && !this.isAllyTeam && !this.scene.testRoomAllowEnemyAttack);
    const isMobile = !!(this.scene.sys.game.device.os.android || this.scene.sys.game.device.os.iOS);
    const aggroMul = (isMobile ? 0.5 : 1) * (this.isAllyTeam ? 1 : this.scene.getEnemyAggroVisionScale());
    this.soldiers = this.soldiers.filter(s => {
      if (!s.active) return false;
      if (s.getData('retired')) { s.setState(State.IDLE, 1); s.update(this.scene, delta, this); return true; }
      if (s.getData('surrendered')) { s.setState(State.SURRENDER, s.facing); s.update(this.scene, delta, this); return true; }
      s.update(this.scene, delta, this);
      const detectionRange = 1200 * aggroMul; 
      let isActing = false;

      let target: any = null;
      const enemyTanks = this.isAllyTeam ? this.scene.enemies : [player];
      const enemySoldiers = this.isAllyTeam ? this.scene.enemyInfantry.soldiers : this.scene.allies.soldiers;
      
      for (const en of enemySoldiers) {
          if (en.active && Phaser.Math.Distance.Between(s.x, s.y, en.x, en.y) < 800 * aggroMul) {
              // Check Line of Sight
              if (this.scene.checkLineOfSight(s.x, s.y - 10, en.x, en.y - 10)) {
                  target = en; break;
              }
          }
      }
      if (!target) {
          for (const t of enemyTanks) {
              // Cast to any to access shared x/y properties on Tank/Helicopter union
              const tx = (t as any).x;
              const ty = (t as any).y;
              if (t.active && Phaser.Math.Distance.Between(s.x, s.y, tx, ty) < detectionRange) {
                  // Check Line of Sight (aim a bit higher for tanks/helis)
                  if (this.scene.checkLineOfSight(s.x, s.y - 10, tx, ty - 30)) {
                      target = t; break;
                  }
              }
          }
      }

      if (s.isAlly) {
          const isEng = s.role === Role.ENGINEER;
          const shouldRepair = isEng && (player.hp / player.maxHp) < 0.6;
          const idx = this.soldiers.indexOf(s);
          const tankBounds = player.chassis.getBounds();
          const gap = 40;
          let targetX = player.chassis.x - (shouldRepair ? 60 : 200) - (idx * 35);
          targetX = Math.min(targetX, tankBounds.left - gap);
          const distToTarget = Math.abs(s.x - targetX);
          if (distToTarget > 15) {
              const dir = targetX > s.x ? 1 : -1;
              const runStep = (shouldRepair ? 0.9 : 0.35) * delta;
              const walkStep = (shouldRepair ? 0.45 : 0.18) * delta;
              s.x += dir * (distToTarget > 300 ? runStep : walkStep);
              s.setState(distToTarget > 300 ? State.RUN : State.WALK, dir);
              isActing = true;
          }
          if (Phaser.Geom.Intersects.RectangleToRectangle(tankBounds, s.torso.getBounds())) {
              s.x = Math.min(s.x, tankBounds.left - gap);
          }
          if (!isEng && target && Math.random() < 0.05) {
              // Cast target to any for safe x property access
              this.fire(s, target); s.setState(State.SHOOT, (target as any).x > s.x ? 1 : -1);
              isActing = true;
          }
      } else {
          const nearPlayer = Phaser.Math.Distance.Between(s.x, s.y, player.chassis.x, player.chassis.y) < 260;
          const lowHp = s.hp < 12;
          if (!s.getData('surrendered') && nearPlayer) {
            const baseChance = lowHp ? 0.08 : 0.035;
            if (Math.random() < baseChance) {
              s.setData('surrendered', true);
              s.setState(State.SURRENDER, player.chassis.x > s.x ? 1 : -1);
              isActing = true;
            }
          }
          if (!s.getData('surrendered') && allowAttack && target && Math.random() < 0.05) {
              this.fire(s, target); s.setState(State.SHOOT, (target as any).x > s.x ? 1 : -1);
              isActing = true;
          }
      }

      if (!isActing) s.setState(State.IDLE, s.facing);
      return true;
    });
  }

  public checkSquash(tankChassis: Phaser.Physics.Arcade.Sprite, isEnemyTankHint?: boolean) {
    if (!tankChassis?.active) return;

    const body = tankChassis.body as Phaser.Physics.Arcade.Body | undefined;
    const v = body ? Math.hypot(body.velocity.x, body.velocity.y) : 0;
    if (v < 120) return;

    const isPlayerTank = this.scene.player.chassis === tankChassis;

    // Determine if tank belongs to enemy faction (allow caller to provide hint to avoid repeated scans).
    const isEnemyTank = typeof isEnemyTankHint === 'boolean'
      ? isEnemyTankHint
      : this.scene.enemies.some(e => e instanceof Tank && e.chassis === tankChassis);

    const tb = tankChassis.getBounds();
    const nearPadX = tb.width * 0.65 + 48;
    const nearPadY = tb.height * 0.8 + 52;

    for (let i = 0; i < this.soldiers.length; i++) {
      const s = this.soldiers[i];
      if (!s?.active) continue;

      // Skip collision if both are enemies (requested by user)
      if (isEnemyTank && !s.isAlly) continue;

      if (Math.abs(s.x - tb.centerX) > nearPadX || Math.abs(s.y - tb.centerY) > nearPadY) continue;

      const sb = s.torso.getBounds();
      if (Phaser.Geom.Intersects.RectangleToRectangle(tb, sb)) {
        if (isPlayerTank && s.isAlly) continue;
        this.handleDeath(s, ShellType.HE, s.x, s.y, true);
        s.destroy();
      }
    }
  }

  private fire(s: Soldier, target: any) {
    // Cast target to any for safe x/y properties access
    const tx = (target as any).x;
    const ty = (target as any).y;
    const angle = Phaser.Math.Angle.Between(s.x, s.y, tx, ty);
    s.weapon.setRotation(angle - s.root.rotation);

    if (s.role === Role.RPG) {
        const r = this.scene.physics.add.sprite(s.x, s.y, 'proj_rpg').setScale(0.8);
        this.scene.physics.velocityFromRotation(angle, 900, r.body.velocity);
        const colliderTarget = target.chassis ? target.chassis : (target.torso ? target.torso : target);
        this.scene.physics.add.overlap(r, colliderTarget, () => {
            this.scene.triggerExplosion(r.x, r.y, 50, 70); r.destroy();
        });
        this.scene.time.delayedCall(3000, () => r.destroy());
    } else { 
        // Limit burst duration (0.4s max for visual/audio)
        if (!s.getData('burstEndTime')) {
            s.setData('burstEndTime', this.scene.time.now + 400);
        }
        if (this.scene.time.now > s.getData('burstEndTime')) {
             if (Math.random() < 0.05) s.setData('burstEndTime', undefined); // Small chance to reset and fire again later
             return;
        }

        const muzzleX = s.x + Math.cos(angle) * 15, muzzleY = s.y + Math.sin(angle) * 15;
        const tracerColor = Math.random() > 0.5 ? 0xffcc00 : 0xff4400;
        const line = this.scene.add.line(0,0, muzzleX, muzzleY, muzzleX + Math.cos(angle)*800, muzzleY + Math.sin(angle)*800, tracerColor, 0.8).setOrigin(0).setDepth(30).setLineWidth(2);
        this.scene.tweens.add({ targets: line, alpha: 0, duration: 150, onComplete: () => line.destroy() });
        
        // Enemy Shoot Sound
        if (!s.isAlly) {
            this.scene.audio.playFolder('infantry/enemy/shoot/sfx', {
                worldX: s.x,
                worldY: s.y,
                volume: 0.55,
                maxDistance: 1400,
                cooldownMs: 80
            });
        }

        if (Math.random() < 0.4) {
            if (target instanceof Soldier) target.takeDamage(10, this, ShellType.BULLET, tx, ty);
            else if (target.takeDamage) target.takeDamage(5);
            else { 
                const enemies = this.isAllyTeam ? this.scene.enemyInfantry.soldiers : this.scene.allies.soldiers;
                enemies.forEach((en: Soldier) => { if (en.torso === target || en.head === target) en.takeDamage(10, this, ShellType.BULLET, tx, ty); });
            }
        }
    }
  }

  public applyDamage(ex: number, ey: number, rad: number, damage: number = 0, shellType: ShellType = ShellType.HE) {
    const now = this.scene.time.now;
    this.soldiers.forEach(s => {
      if (this.isAllyTeam) return; 
      if (!s.active) return;
      const d = Phaser.Math.Distance.Between(ex, ey, s.x, s.y);
      if (d >= rad) return;

      const t = Phaser.Math.Clamp(d / Math.max(1, rad), 0, 1);
      if (t > 0.82) {
        s.hp = Math.max(1, s.hp - 18);
        s.setData('injuredUntil', now + 7000);
        this.scene.particles.createBloodSplatter(s.x, s.y);
        this.scene.addBloodStain(s.x, s.y);
        return;
      }

      if (t > 0.55) {
        if (shellType !== ShellType.BULLET) {
          this.scene.audio.playFolder('weapon/common/killed_humans_and_animals_by_shell/sfx', { worldX: s.x, worldY: s.y, volume: 0.95, cooldownMs: 0 });
        }
        this.handleExplosionDeath(s, "heavy");
        s.destroy();
        return;
      }

      if (t > 0.25) {
        if (shellType !== ShellType.BULLET) {
          this.scene.audio.playFolder('weapon/common/killed_humans_and_animals_by_shell/sfx', { worldX: s.x, worldY: s.y, volume: 0.95, cooldownMs: 0 });
        }
        this.handleExplosionDeath(s, "dismember");
        s.destroy();
        return;
      }

      if (shellType !== ShellType.BULLET) {
        this.scene.audio.playFolder('weapon/common/killed_humans_and_animals_by_shell/sfx', { worldX: s.x, worldY: s.y, volume: 0.95, cooldownMs: 0 });
      }
      this.handleExplosionDeath(s, "pulverize");
      s.destroy();
    });
  }

  public handleDeath(s: Soldier, sourceType: ShellType, hitX?: number, hitY?: number, squashed: boolean = false) {
    if (!s.isAlly && s.getData('surrendered')) {
      this.scene.awardEventPoints('special', '无情！', 80, '击杀投降的敌人');
    }
    if (squashed) {
      this.handleCrushDeath(s, hitX ?? s.x, hitY ?? s.y);
      return;
    }
    if (sourceType === ShellType.BULLET) {
      this.handleGunKill(s, hitX ?? s.x, hitY ?? s.y);
      return;
    }
    this.handleExplosionDeath(s, "dismember", false);
  }

  private spawnDebrisXY(tex: string, x: number, y: number, vx: number, vy: number, av: number, scaleX: number, scaleY: number, tint: number = 0xffffff) {
    const d = this.scene.debrisGroup.get(x, y, tex);
    if (!d) return null;
    d.setActive(true).setVisible(true).setDepth(20).setTint(tint).setAlpha(1).setScale(scaleX, scaleY);
    const body = d.body as Phaser.Physics.Arcade.Body;
    body.setEnable(true).setImmovable(false).setAllowGravity(true).setAllowRotation(true).setVelocity(vx, vy).setAngularDrag(500).setDrag(200, 100);
    d.setAngularVelocity(av);
    d.setData('sleeping', false);
    this.scene.tweens.add({ targets: d, alpha: 0, delay: 12000, duration: 4000, onComplete: () => d.destroy() });
    return d;
  }

  private spawnDebris(tex: string, x: number, y: number, vx: number, vy: number, av: number, scale: number, tint: number = 0xffffff) {
    return this.spawnDebrisXY(tex, x, y, vx, vy, av, scale, scale, tint);
  }

  private handleCrushDeath(s: Soldier, hitX: number, hitY: number) {
    if (!s.isAlly) {
      this.scene.infantryKills++;
      this.scene.awardEventPoints('special', '还以为是减速带呢', 120, '战车碾压敌方步兵');
    }
    this.scene.audio.playFolder('weapon/common/killed_humans_and_animals_by_shell/sfx', { worldX: hitX, worldY: hitY, volume: 0.95, cooldownMs: 0 });

    const groundY = this.scene.getTerrainHeight(s.x);
    for (let i = 0; i < 3; i++) this.scene.addBloodStain(s.x + Phaser.Math.Between(-10, 10), groundY);
    this.scene.particles.createBloodSplatter(hitX, hitY);
    this.scene.particles.createBloodSplatter(s.x + Phaser.Math.Between(-14, 14), groundY - Phaser.Math.Between(0, 8));

    const torsoTex = s.role === Role.ENGINEER ? 'inf_torso_eng' : (s.isAlly ? 'inf_torso_ally' : 'inf_torso_enemy');
    const factionStr = s.role === Role.ENGINEER ? 'eng' : (s.isAlly ? 'ally' : 'enemy');
    const headTex = s.role === Role.ENGINEER ? 'inf_head_dead' : (s.isAlly ? 'inf_head_ally_dead' : 'inf_head_enemy_dead');
    
    this.spawnDebrisXY(torsoTex, s.x + Phaser.Math.Between(-6, 6), groundY - 12, Phaser.Math.Between(-180, 180), Phaser.Math.Between(-90, -10), Phaser.Math.Between(-500, 500), 1.65, 0.32);
    this.spawnDebrisXY(headTex, s.x + Phaser.Math.Between(-12, 12), groundY - 20, Phaser.Math.Between(-260, 260), Phaser.Math.Between(-320, -160), Phaser.Math.Between(-900, 900), 0.92, 0.92);
    for (let i = 0; i < 2; i++) this.spawnDebris('meat_chunk', s.x, groundY - 10, Phaser.Math.Between(-420, 420), Phaser.Math.Between(-260, -80), Phaser.Math.Between(-1400, 1400), 1.0);
  }

  private handleGunKill(s: Soldier, hitX: number, hitY: number) {
    if (!s.isAlly) {
      this.scene.infantryKills++;
      this.scene.awardEventPoints('infantry_kill', '步兵击杀', 10, '击杀步兵');
    }
    const now = this.scene.time.now;
    const lastHitByMGAt = (s.getData('lastHitByMGAt') as number | undefined) ?? 0;
    if (now - lastHitByMGAt < 650) {
      this.scene.audio.playFolder('weapon/common/killed_humans_and_animals_by_shell/sfx', { worldX: hitX, worldY: hitY, volume: 0.95, cooldownMs: 0 });
    }
    this.scene.particles.createBloodSplatter(hitX, hitY);
    this.scene.addBloodStain(s.x, s.y);

    const hole = this.scene.add.circle(hitX + Phaser.Math.Between(-2, 2), hitY + Phaser.Math.Between(-2, 2), Phaser.Math.FloatBetween(1.0, 1.6), 0x4a0000, 0.0).setDepth(26);
    this.scene.tweens.add({ targets: hole, alpha: 0.8, duration: 120, onComplete: () => this.scene.time.delayedCall(45000, () => { if (hole.active) hole.destroy(); }) });

    const torsoTex = s.role === Role.ENGINEER ? 'inf_torso_eng' : (s.isAlly ? 'inf_torso_ally' : 'inf_torso_enemy');
    const factionStr = s.role === Role.ENGINEER ? 'eng' : (s.isAlly ? 'ally' : 'enemy');
    const limbTex = Math.random() > 0.5 ? `inf_limb_arm_${factionStr}` : `inf_limb_leg_${factionStr}`;
    const headTex = s.role === Role.ENGINEER ? 'inf_head_dead' : (s.isAlly ? 'inf_head_ally_dead' : 'inf_head_enemy_dead');

    const lastHitByPlayerMGAt = (s.getData('lastHitByPlayerMGAt') as number | undefined) ?? 0;
    const isPlayerMgFriendlyKill = s.isAlly && now - lastHitByPlayerMGAt < 600;
    const markPenalty = (d: any) => {
      if (!isPlayerMgFriendlyKill || !d?.active) return;
      d.setData('friendlyPenaltyFragment', true);
    };

    markPenalty(this.spawnDebris(torsoTex, s.x, s.y, Phaser.Math.Between(-140, 140), Phaser.Math.Between(-260, -120), Phaser.Math.Between(-220, 220), 1.12));
    markPenalty(this.spawnDebris(headTex, s.x, s.y - 10, Phaser.Math.Between(-180, 180), Phaser.Math.Between(-320, -160), Phaser.Math.Between(-380, 380), 1.12));
    markPenalty(this.spawnDebris(limbTex, s.x, s.y, Phaser.Math.Between(-240, 240), Phaser.Math.Between(-300, -140), Phaser.Math.Between(-520, 520), 1.12));
    markPenalty(this.spawnDebris('inf_weapon', s.x, s.y - 6, Phaser.Math.Between(-240, 240), Phaser.Math.Between(-360, -160), Phaser.Math.Between(-900, 900), 1.12));
    if (Math.random() < 0.35) markPenalty(this.spawnDebris('meat_chunk', s.x, s.y, Phaser.Math.Between(-420, 420), Phaser.Math.Between(-420, -220), Phaser.Math.Between(-1200, 1200), 1.0));
  }

  private handleExplosionDeath(s: Soldier, mode: "heavy" | "dismember" | "pulverize", squashed: boolean = false) {
    if (!s.isAlly) {
      this.scene.infantryKills++;
      // Fix: Add event points for explosion kills to ensure consistent feedback
      this.scene.awardEventPoints('infantry_kill', '步兵击杀', 10, '击杀步兵');
    }
    this.scene.addBloodStain(s.x, s.y);

    const factionStr = s.role === Role.ENGINEER ? 'eng' : (s.isAlly ? 'ally' : 'enemy');
    const headTex = s.role === Role.ENGINEER ? 'inf_head_dead' : (s.isAlly ? 'inf_head_ally_dead' : 'inf_head_enemy_dead');
    const armTex = `inf_limb_arm_${factionStr}`;
    const legTex = `inf_limb_leg_${factionStr}`;

    if (mode === "heavy") {
      this.scene.particles.createBloodSplatter(s.x, s.y);
      const torsoTex = s.role === Role.ENGINEER ? 'inf_torso_eng' : (s.isAlly ? 'inf_torso_ally' : 'inf_torso_enemy');
      this.spawnDebris(torsoTex, s.x, s.y, Phaser.Math.Between(-320, 320), Phaser.Math.Between(-480, -240), Phaser.Math.Between(-350, 350), 1.12);
      this.spawnDebris(headTex, s.x, s.y - 10, Phaser.Math.Between(-420, 420), Phaser.Math.Between(-600, -320), Phaser.Math.Between(-550, 550), 1.12);
      return;
    }

    if (mode === "pulverize") {
      for (let i = 0; i < 4; i++) this.scene.particles.createBloodSplatter(s.x + Phaser.Math.Between(-12, 12), s.y + Phaser.Math.Between(-10, 10));
      for (let i = 0; i < 18; i++) this.spawnDebris('meat_chunk', s.x, s.y, Phaser.Math.Between(-1600, 1600), Phaser.Math.Between(-1400, -650), Phaser.Math.Between(-2200, 2200), 1.0);
      this.spawnDebris(headTex, s.x, s.y - 10, Phaser.Math.Between(-1100, 1100), Phaser.Math.Between(-1400, -800), Phaser.Math.Between(-1800, 1800), 1.12);
      return;
    }

    this.scene.particles.createBloodSplatter(s.x, s.y);
    const torsoTex = s.role === Role.ENGINEER ? 'inf_torso_eng' : (s.isAlly ? 'inf_torso_ally' : 'inf_torso_enemy');
    const parts = [
      { tex: headTex },
      { tex: torsoTex },
      { tex: armTex },
      { tex: legTex },
      { tex: 'meat_chunk' }
    ];
    parts.forEach(p => {
      const vx = squashed ? Phaser.Math.Between(-900, 900) : Phaser.Math.Between(-900, 900);
      const vy = squashed ? Phaser.Math.Between(-350, 0) : Phaser.Math.Between(-1200, -650);
      const av = Phaser.Math.Between(-1600, 1600);
      const sc = p.tex === torsoTex || p.tex.includes('inf_head') ? 1.12 : 1.0;
      this.spawnDebris(p.tex, s.x, s.y, vx, vy, av, sc);
    });
  }
}
