
import Phaser from 'phaser';
import type { MainScene } from '../MainScene';

enum BuildingStyle { DEFAULT, AMERICAN_CABIN, HAKKA, MIDDLE_EAST, MILITARY_BASE }

class Building {
    private scene: MainScene;
    public container: Phaser.GameObjects.Container;
    public bricks: Phaser.GameObjects.Sprite[] = [];
    private ruined = false;
    private worldX: number;
    private worldY: number;
    private widthInBricks: number;
    private heightInBricks: number;
    private material: string;
    private style: BuildingStyle;
    private isIndestructible: boolean = false;
    private detachBudget = 0;
    private allowEnemyInfantrySpawn: boolean;
    private sandstormLastCollapseAt = Number.NEGATIVE_INFINITY;

    private static readonly PARTIAL_COLLAPSE_WINDOW_MS = 1900;
    private static readonly FULL_COLLAPSE_WINDOW_MS = 2200;

    constructor(scene: MainScene, x: number, y: number, style: BuildingStyle, allowEnemyInfantrySpawn: boolean = true) {
        this.scene = scene;
        this.worldX = x; this.worldY = y;
        this.style = style;
        this.allowEnemyInfantrySpawn = allowEnemyInfantrySpawn;

        let w = 5, h = 6, mat = 'brick_concrete';
        // Enhanced style parameters
        let roofType: 'flat' | 'peaked' | 'dome' = 'flat';
        let windowFreq = 0; // 0 = none, 2 = every 2nd col, etc.
        let windowStartRow = 2;
        let baseTint = 0xffffff;
        let roofTint = 0x888888;
        let doorX = -1; // -1 = random
        
        switch(style) {
            case BuildingStyle.AMERICAN_CABIN: 
                w = 9; h = 8; mat = 'brick_wood'; 
                roofType = 'peaked'; 
                windowFreq = 3; 
                baseTint = 0xffddbb; 
                roofTint = 0x8f5e38;
                break;
            case BuildingStyle.HAKKA: 
                w = 18; h = 12; mat = 'brick_concrete'; 
                roofType = 'flat'; 
                baseTint = 0xdddddd; 
                break;
            case BuildingStyle.MIDDLE_EAST: 
                w = 10; h = 7; mat = 'brick_me'; 
                roofType = 'dome'; // Simulated by step-up
                windowFreq = 4; 
                baseTint = 0xffeebb; 
                break;
            case BuildingStyle.MILITARY_BASE: 
                w = 16; h = 9; mat = 'brick_metal'; 
                roofType = 'flat'; 
                windowFreq = 5; 
                baseTint = 0xccddff; 
                roofTint = 0x556677;
                break;
            default: 
                w = 6 + Math.floor(Math.random()*4); 
                h = 6 + Math.floor(Math.random()*5); 
                mat = Math.random() > 0.5 ? 'brick_concrete' : 'brick_wood';
                windowFreq = Math.random() > 0.5 ? 2 : 0;
                baseTint = Phaser.Display.Color.RandomRGB().color;
        }

        this.widthInBricks = w;
        this.heightInBricks = h;
        this.material = mat;
        this.container = scene.add.container(x, y);

        doorX = Math.floor(w / 2);

        for (let i = 0; i < w; i++) {
            const colWorldX = x + i * 20;
            const groundHeight = this.scene.getTerrainHeight(colWorldX);
            const extraRows = Math.max(0, Math.ceil((groundHeight - y) / 20));

            for (let j = -extraRows; j < h; j++) {
                // Determine brick type/status
                let isWall = true;
                let isWindow = false;
                let isDoor = false;
                let isRoof = false;
                let brickMat = this.material;
                let tint = baseTint;

                // Roof Logic
                if (roofType === 'peaked') {
                    const roofH = 3;
                    const roofStart = h - roofH;
                    if (j >= roofStart) {
                        const rowInRoof = j - roofStart; // 0, 1, 2
                        const inset = roofH - 1 - rowInRoof; // 2, 1, 0
                        if (i < inset || i >= w - inset) isWall = false;
                        else {
                            isRoof = true;
                            brickMat = 'brick_red_wood';
                            tint = roofTint;
                        }
                    }
                } else if (roofType === 'dome') {
                    if (j === h - 1 && (i === 0 || i === w - 1)) isWall = false;
                }

                // Door Logic
                if (j < 2 && j >= 0 && i === doorX) {
                    isDoor = true;
                    tint = 0x331100; // Dark door
                }

                // Window Logic
                if (!isDoor && !isRoof && j >= windowStartRow && j < h - 1) {
                     if (windowFreq > 0 && (i % windowFreq === 1)) {
                         if ((j - windowStartRow) % 3 !== 1) { // Gap between floors
                             isWindow = true;
                             tint = 0x223344; // Dark glass
                         }
                     }
                }

                // Hakka Special
                if (style === BuildingStyle.HAKKA) {
                    const centerW = w/2;
                    const isGate = j < 4 && Math.abs(i - centerW) < 2;
                    if (isGate) isWall = false;
                    const isInner = i > 1 && i < w - 2 && j > 1 && j < h - 1;
                    if (isInner) isWall = false; // Hollow center
                }

                if (!isWall) continue;

                const brick = scene.add.sprite(i * 20, -j * 20 - 10, brickMat);
                
                // Variance
                if (!isWindow && !isDoor && !isRoof) {
                    const noise = Phaser.Math.Between(-20, 20);
                    const c = Phaser.Display.Color.ValueToColor(tint);
                    c.brighten(noise);
                    brick.setTint(c.color);
                } else {
                    brick.setTint(tint);
                }

                // Subsurface bricks
                if (j < 0) brick.setTint(0x444444);

                if (isWindow && this.allowEnemyInfantrySpawn && Math.random() > 0.85) {
                     this.scene.enemyInfantry.spawn(x + i*20, y - j*20);
                }

                const baseHp = (this.style === BuildingStyle.MILITARY_BASE) ? 8 : 4;
                brick.setData('hp', baseHp); 
                brick.setData('gridX', i);
                brick.setData('gridY', j);
                this.container.add(brick);
                this.bricks.push(brick);
            }
        }
        this.container.setDepth(15);
    }

    public isRuined() { return this.ruined; }

    public getTacticalMarker() {
        const w = this.widthInBricks * 20;
        const h = Math.max(80, this.heightInBricks * 20);
        const activeBricks = this.bricks.filter(b => b?.active).length;
        const ruinedLike = this.ruined || activeBricks <= Math.max(3, Math.round(this.bricks.length * 0.18));
        return {
            x: this.worldX + w * 0.5,
            y: this.worldY - h * 0.46,
            w,
            h,
            ruined: ruinedLike
        };
    }


    public containsPoint(x: number, y: number): boolean {
        if (this.ruined) return false;
        const bounds = new Phaser.Geom.Rectangle(
            this.worldX,
            this.worldY - (this.heightInBricks * 20 + 40),
            this.widthInBricks * 20,
            this.heightInBricks * 20 + 200
        );
        return Phaser.Geom.Rectangle.Contains(bounds, x, y);
    }

    public intersectsXBand(x0: number, x1: number): boolean {
        if (this.ruined || !this.container.active) return false;
        const left = this.worldX;
        const right = this.worldX + this.widthInBricks * 20;
        return right >= x0 && left <= x1;
    }

    public getLineBlockBounds() {
        return new Phaser.Geom.Rectangle(
            this.worldX,
            this.worldY - (this.heightInBricks * 20 + 40),
            this.widthInBricks * 20,
            this.heightInBricks * 20 + 40
        );
    }

    private getActiveBrickMap(): Map<string, Phaser.GameObjects.Sprite> {
        const map = new Map<string, Phaser.GameObjects.Sprite>();
        for (const b of this.bricks) {
            if (!b.active) continue;
            const gx = b.getData('gridX') as number;
            const gy = b.getData('gridY') as number;
            map.set(`${gx},${gy}`, b);
        }
        return map;
    }

    private isBrickGrounded(brick: Phaser.GameObjects.Sprite): boolean {
        const gx = brick.getData('gridX') as number;
        const brickWorldY = this.container.y + brick.y;
        const terrainY = this.scene.getTerrainHeight(this.worldX + gx * 20);
        return brickWorldY + 10 >= terrainY - 4;
    }

    private getConnectedToGround(activeMap: Map<string, Phaser.GameObjects.Sprite>): Set<string> {
        const connected = new Set<string>();
        const q: string[] = [];

        for (const [key, b] of activeMap) {
            const gy = b.getData('gridY') as number;
            if (gy <= 0 && this.isBrickGrounded(b)) {
                connected.add(key);
                q.push(key);
            }
        }

        while (q.length) {
            const key = q.pop() as string;
            const [gxStr, gyStr] = key.split(',');
            const gx = Number(gxStr);
            const gy = Number(gyStr);
            const neighbors = [`${gx - 1},${gy}`, `${gx + 1},${gy}`, `${gx},${gy - 1}`, `${gx},${gy + 1}`];
            for (const nk of neighbors) {
                if (connected.has(nk)) continue;
                if (!activeMap.has(nk)) continue;
                connected.add(nk);
                q.push(nk);
            }
        }

        return connected;
    }

    private isSupportBroken(): boolean {
        const supportedCols = new Array(this.widthInBricks).fill(false);
        let hasAnyActive = false;
        for (const b of this.bricks) {
            if (!b.active) continue;
            hasAnyActive = true;
            const gx = b.getData('gridX') as number;
            const gy = b.getData('gridY') as number;
            if (gy <= 0 && this.isBrickGrounded(b)) supportedCols[gx] = true;
        }
        if (!hasAnyActive) return true;
        const supportedCount = supportedCols.reduce((acc, v) => acc + (v ? 1 : 0), 0);
        return supportedCount < Math.ceil(this.widthInBricks * 0.6);
    }

    private getCollapseSfxFolder(kind: "partial" | "full"): string {
        return `environment/forest/point_3d/static/buildings/default/${kind}_collapse/sfx`;
    }

    private playCollapseSfx(kind: "partial" | "full") {
        const cx = this.worldX + (this.widthInBricks * 10);
        this.scene.audio.playFolder(this.getCollapseSfxFolder(kind), {
            worldX: cx,
            worldY: this.worldY,
            volume: kind === "full" ? 1.0 : 0.85,
            cooldownMs: kind === "full" ? 120 : 320,
            trackPosition: true
        });
    }

    private emitBrickDebris(
        bx: number,
        by: number,
        brickMat: string,
        brickTint: number,
        type: "ground" | "structural",
        phase: "partial" | "full"
    ) {
        const d = this.scene.debrisGroup.get(bx, by, brickMat);
        if (!d) return;

        const isFull = phase === "full";
        d.setActive(true).setVisible(true).setTint(brickTint).setDepth(isFull ? 34 : 35);

        const body = d.body as Phaser.Physics.Arcade.Body;
        const vx = isFull ? Phaser.Math.Between(-260, 260) : Phaser.Math.Between(-150, 150);
        const vy = isFull
            ? (type === "ground" ? Phaser.Math.Between(20, 220) : Phaser.Math.Between(-210, 120))
            : (type === "ground" ? Phaser.Math.Between(-20, 90) : Phaser.Math.Between(-120, 40));

        body
            .setEnable(true)
            .setImmovable(false)
            .setAllowGravity(true)
            .setAllowRotation(true)
            .setVelocity(vx, vy)
            .setDrag(isFull ? 26 : 18, isFull ? 10 : 7)
            .setBounce(isFull ? 0.18 : 0.12);

        d.setAngularVelocity(isFull ? Phaser.Math.Between(-340, 340) : Phaser.Math.Between(-220, 220));
        d.setAlpha(1);
        d.setScale(Phaser.Math.FloatBetween(isFull ? 0.68 : 0.62, isFull ? 1.05 : 0.95));
        d.setData('sleeping', false);
        this.scene.tweens.add({
            targets: d,
            alpha: 0,
            delay: isFull ? 22000 : 16000,
            duration: isFull ? 5200 : 4200,
            onComplete: () => d.destroy()
        });
    }

    private releaseBrickAsDebris(
        brick: Phaser.GameObjects.Sprite,
        type: "ground" | "structural",
        phase: "partial" | "full",
        delayMs: number
    ) {
        const release = () => {
            if (!this.container.active) return;
            if (phase === "full" && brick.active) {
                brick.setActive(false).setVisible(false);
            }
            const bx = this.container.x + brick.x;
            const by = this.container.y + brick.y;
            this.emitBrickDebris(bx, by, brick.texture.key, brick.tintTopLeft, type, phase);
            if (phase === "partial" && Math.random() < 0.28) {
                this.scene.particles.createConcreteDust(bx, by + 4, "impact");
            }
        };

        if (delayMs > 0) {
            this.scene.time.delayedCall(delayMs, release);
            return;
        }
        release();
    }

    private detachUnsupportedBricks(maxDetach: number, type: "ground" | "structural"): number {
        if (this.ruined || this.isIndestructible) return 0;
        const activeMap = this.getActiveBrickMap();
        if (activeMap.size === 0) return 0;

        const connected = this.getConnectedToGround(activeMap);
        const unsupported: Phaser.GameObjects.Sprite[] = [];
        for (const [key, brick] of activeMap) {
            if (connected.has(key)) continue;
            unsupported.push(brick);
        }

        if (unsupported.length <= 0) return 0;

        unsupported.sort((a, b) => {
            const ay = a.getData('gridY') as number;
            const by = b.getData('gridY') as number;
            if (ay !== by) return by - ay;
            const ax = a.getData('gridX') as number;
            const bx = b.getData('gridX') as number;
            return Math.abs(ax - this.widthInBricks * 0.5) - Math.abs(bx - this.widthInBricks * 0.5);
        });

        const targetDetach = Math.min(maxDetach, unsupported.length);
        let detached = 0;
        const denom = Math.max(1, targetDetach - 1);

        for (let i = 0; i < targetDetach; i++) {
            const brick = unsupported[i];
            if (!brick.active) continue;
            brick.setActive(false).setVisible(false);
            detached++;

            const wave = (i / denom) * (Building.PARTIAL_COLLAPSE_WINDOW_MS - 420);
            const jitter = Phaser.Math.Between(80, 520);
            const delayMs = Phaser.Math.Clamp(Math.round(wave + jitter), 0, Building.PARTIAL_COLLAPSE_WINDOW_MS);
            this.releaseBrickAsDebris(brick, type, "partial", delayMs);
        }

        const remainingActive = this.bricks.some(b => b.active);
        if (!remainingActive) {
            this.ruined = true;
            this.scene.time.delayedCall(Building.PARTIAL_COLLAPSE_WINDOW_MS, () => {
                if (this.container.active) this.container.destroy(true);
            });
        }

        return detached;
    }

    public update() {
        if (this.ruined || this.isIndestructible) return;
        const currentGround = this.scene.getTerrainHeight(this.worldX);
        if (currentGround > this.worldY + 100) {
            this.collapse("ground");
            return;
        }
        if (this.detachBudget > 0) {
            const budget = Math.min(this.detachBudget, 40);
            this.detachBudget -= budget;
            const detached = this.detachUnsupportedBricks(budget, "ground");
            if (detached > 0 && !this.ruined) this.playCollapseSfx("partial");
        } else {
            const detached = this.detachUnsupportedBricks(6, "ground");
            if (detached > 0 && !this.ruined) this.playCollapseSfx("partial");
        }
    }

    public checkShellCollision(shell: Phaser.Physics.Arcade.Sprite, isMG: boolean = false): boolean {
        if (this.ruined) return false;
        const bounds = new Phaser.Geom.Rectangle(this.worldX, this.worldY - (this.heightInBricks * 20 + 40), this.widthInBricks * 20, this.heightInBricks * 20 + 200);
        if (Phaser.Geom.Rectangle.Contains(bounds, shell.x, shell.y)) {
            if (!this.isIndestructible) this.applyDamage(shell.x, shell.y, isMG ? 7.5 : 80, isMG);
            return true;
        }
        return false;
    }

    public applyDamage(ex: number, ey: number, rad: number, isMG: boolean = false) {
        if (this.ruined || this.isIndestructible) return;
        let hitAny = false;
        this.bricks.forEach(b => {
            if (!b.active) return;
            const bx = this.container.x + b.x;
            const by = this.container.y + b.y;
            const d = Phaser.Math.Distance.Between(ex, ey, bx, by);
            if (d < rad) {
                if (isMG) {
                    let hp = b.getData('hp') - 1;
                    b.setData('hp', hp);
                    // 机枪打在建筑上溅起石灰/碎石
                    this.scene.particles.createConcreteDust(bx, by, "impact");
                    if (hp > 0) {
                        b.setTint(0x555555); 
                        return;
                    }
                }
                b.setActive(false).setVisible(false);
                hitAny = true;
                if (Math.random() > 0.10) {
                    const delayMs = Phaser.Math.Between(0, 180);
                    this.releaseBrickAsDebris(b, "structural", "partial", delayMs);
                }
            }
        });
        if (hitAny) {
            this.detachBudget = Math.min(220, this.detachBudget + (isMG ? 25 : 140));
            const detached = this.detachUnsupportedBricks(isMG ? 10 : 60, "structural");
            if (this.isSupportBroken()) {
                this.collapse("ground");
                return;
            }
            const structuralBricks = this.bricks.filter(b => b.getData('gridY') >= 0); 
            const activeCount = structuralBricks.filter(b => b.active).length;
            if (activeCount < structuralBricks.length * 0.3) {
                this.collapse("structural");
                return;
            }
            if (!this.ruined && (detached > 0 || hitAny)) this.playCollapseSfx("partial");
        }
    }

    private partialCollapseBySandstorm(): boolean {
        if (this.ruined || this.isIndestructible || !this.container.active) return false;

        const active = this.bricks.filter(b => b.active);
        if (active.length <= 0) return false;

        Phaser.Utils.Array.Shuffle(active);
        const detachCount = Phaser.Math.Clamp(
            Math.round(active.length * Phaser.Math.FloatBetween(0.16, 0.34)),
            8,
            Math.max(8, Math.floor(active.length * 0.55))
        );

        let detached = 0;
        for (let i = 0; i < detachCount; i++) {
            const brick = active[i];
            if (!brick?.active) continue;
            brick.setActive(false).setVisible(false);
            detached++;
            const delayMs = Phaser.Math.Between(20, Building.PARTIAL_COLLAPSE_WINDOW_MS);
            this.releaseBrickAsDebris(brick, "structural", "partial", delayMs);
        }

        this.detachBudget = Math.min(240, this.detachBudget + detached * 2);
        const unsupported = this.detachUnsupportedBricks(Math.max(10, Math.floor(detachCount * 0.65)), "ground");
        const changed = detached + unsupported;
        if (changed > 0 && !this.ruined) this.playCollapseSfx("partial");

        const structuralBricks = this.bricks.filter(b => (b.getData('gridY') as number) >= 0);
        const activeCount = structuralBricks.filter(b => b.active).length;
        if (this.isSupportBroken() || activeCount < structuralBricks.length * 0.45) {
            this.collapse("structural");
            return true;
        }

        return changed > 0;
    }

    public applySandstormCollapse(now: number, fullChance: number): boolean {
        if (this.ruined || this.isIndestructible || !this.container.active) return false;
        if (now < this.sandstormLastCollapseAt + 850) return false;
        this.sandstormLastCollapseAt = now;
        if (Math.random() < Phaser.Math.Clamp(fullChance, 0, 1)) {
            this.collapse("ground");
            return true;
        }
        return this.partialCollapseBySandstorm();
    }

    private collapse(type: "ground" | "structural") {
        if (this.ruined || this.isIndestructible) return;
        this.ruined = true;
        this.scene.allies.spawn(this.worldX - 40, this.worldY, true);

        const cx = this.worldX + (this.widthInBricks * 10);
        const buildingWidthPx = this.widthInBricks * 20;
        this.scene.particles.createConcreteDust(cx, this.worldY, "collapse");
        this.scene.particles.createBuildingCollapse(cx, this.worldY, this.material, buildingWidthPx);
        this.scene.particles.createBuildingGroundContactDust(cx, this.worldY + 6, buildingWidthPx, 1.0);
        this.playCollapseSfx("full");

        const activeBricks = this.bricks.filter(b => b.active);
        if (activeBricks.length <= 0) {
            this.container.destroy(true);
            return;
        }

        const sorted = activeBricks.sort((a, b) => {
            const ay = a.getData('gridY') as number;
            const by = b.getData('gridY') as number;
            if (type === "ground") {
                if (ay !== by) return ay - by;
            } else if (ay !== by) {
                return by - ay;
            }
            const ax = a.getData('gridX') as number;
            const bx = b.getData('gridX') as number;
            return Math.abs(ax - this.widthInBricks * 0.5) - Math.abs(bx - this.widthInBricks * 0.5);
        });

        const gridYs = sorted.map(b => b.getData('gridY') as number);
        const minGridY = gridYs.reduce((m, v) => Math.min(m, v), Number.POSITIVE_INFINITY);
        const maxGridY = gridYs.reduce((m, v) => Math.max(m, v), Number.NEGATIVE_INFINITY);
        const spanY = Math.max(1, maxGridY - minGridY);
        const halfW = Math.max(1, (this.widthInBricks - 1) * 0.5);
        const maxReleaseDelay = type === "ground" ? 1350 : 1700;
        const dustStep = Math.max(4, Math.floor(sorted.length / 12));
        const contactPulseCount = Phaser.Math.Clamp(Math.round(this.widthInBricks * 0.6), 3, 9);
        const contactSpan = Math.max(20, buildingWidthPx / Math.max(1, contactPulseCount));

        for (let i = 0; i < contactPulseCount; i++) {
            const edgeT = contactPulseCount <= 1 ? 0 : i / (contactPulseCount - 1);
            const waveT = type === "ground" ? edgeT : (Math.abs(edgeT - 0.5) * 1.15);
            const delayMs = Phaser.Math.Clamp(
                Math.round(220 + waveT * maxReleaseDelay + Phaser.Math.Between(0, 220)),
                160,
                Building.FULL_COLLAPSE_WINDOW_MS + 260
            );

            this.scene.time.delayedCall(delayMs, () => {
                if (this.ruined === false) return;
                const px = this.worldX + contactSpan * i + contactSpan * 0.5 + Phaser.Math.Between(-8, 8);
                const gy = this.scene.getTerrainHeight(px);
                this.scene.particles.createBuildingGroundContactDust(
                    Phaser.Math.Clamp(px, this.worldX, this.worldX + buildingWidthPx),
                    gy + 5,
                    Math.min(120, contactSpan * 1.4),
                    0.7
                );
            });
        }

        sorted.forEach((brick, index) => {
            const gx = brick.getData('gridX') as number;
            const gy = brick.getData('gridY') as number;
            const heightT = Phaser.Math.Clamp((gy - minGridY) / spanY, 0, 1);
            const sideT = Phaser.Math.Clamp(Math.abs(gx - halfW) / halfW, 0, 1);

            let delayMs: number;
            if (type === "ground") {
                // Support-first: bottom fails first, upper floors follow quickly.
                const floorWave = heightT * 860;
                const sideWave = sideT * 180;
                const supportLag = gy <= 0 ? 0 : 90;
                const jitter = Phaser.Math.Between(20, 140);
                delayMs = floorWave + sideWave + supportLag + jitter;
            } else {
                // Structural failure: top/center starts first, then cascades out.
                const topFirst = (1 - heightT) * 320;
                const sideWave = sideT * 260;
                const jitter = Phaser.Math.Between(40, 200);
                delayMs = topFirst + sideWave + jitter;
            }

            delayMs = Phaser.Math.Clamp(Math.round(delayMs), 0, maxReleaseDelay);
            this.releaseBrickAsDebris(brick, type, "full", delayMs);

            if (index % dustStep === 0) {
                this.scene.time.delayedCall(delayMs, () => {
                    if (!this.container.active) return;
                    const px = this.container.x + brick.x;
                    const py = this.container.y + brick.y;
                    const gy = this.scene.getTerrainHeight(px);
                    const dustY = Math.max(py + 6, gy + 4);
                    this.scene.particles.createConcreteDust(px, dustY, "impact");
                    if (py + 20 >= gy) {
                        this.scene.particles.createBuildingGroundContactDust(px, gy + 5, 76, 0.55);
                    }
                });
            }
        });

        this.scene.time.delayedCall(Building.FULL_COLLAPSE_WINDOW_MS, () => {
            if (this.container.active) this.container.destroy(true);
        });
    }

}

export class BuildingManager {
    private scene: MainScene;
    private buildings: Building[] = [];
    constructor(scene: MainScene) { this.scene = scene; }
    public createBuilding(x: number, y: number, style: BuildingStyle, allowEnemyInfantrySpawn: boolean = true) {
        this.buildings.push(new Building(this.scene, x, y, style, allowEnemyInfantrySpawn));
    }
    public update() {
        let write = 0;
        for (let i = 0; i < this.buildings.length; i++) {
            const b = this.buildings[i];
            b.update();
            if ((b as any).container?.active !== false) {
                this.buildings[write++] = b;
            }
        }
        this.buildings.length = write;
    }
    public applyExplosion(ex: number, ey: number, rad: number) {
        this.buildings.forEach(b => b.applyDamage(ex, ey, rad));
    }
    public checkShellCollisions(shell: Phaser.Physics.Arcade.Sprite, isMG: boolean = false): boolean {
        for (const b of this.buildings) {
            if (b.checkShellCollision(shell, isMG)) return true;
        }
        return false;
    }

    public checkLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
        const line = new Phaser.Geom.Line(x1, y1, x2, y2);
        for (const b of this.buildings) {
            if (b.isRuined()) continue;
            if (Phaser.Geom.Intersects.LineToRectangle(line, b.getLineBlockBounds())) return true;
        }
        return false;
    }

    public applySandstormFront(x0: number, x1: number, now: number, fullChance: number = 0.5): number {
        const left = Math.min(x0, x1);
        const right = Math.max(x0, x1);
        let affected = 0;
        for (const b of this.buildings) {
            if (!b.intersectsXBand(left, right)) continue;
            if (b.applySandstormCollapse(now, fullChance)) affected++;
        }
        return affected;
    }

    public isPointBlocked(x: number, y: number): boolean {
        for (const b of this.buildings) {
            if (b.containsPoint(x, y)) return true;
        }
        return false;
    }

    public getTacticalMarkers(limit: number = 96) {
        const out: { x: number; y: number; w: number; h: number; ruined: boolean }[] = [];
        for (const b of this.buildings) {
            const marker = b.getTacticalMarker();
            if (!Number.isFinite(marker.x) || !Number.isFinite(marker.y)) continue;
            out.push(marker);
            if (out.length >= limit) break;
        }
        return out;
    }
}
