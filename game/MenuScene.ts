
import Phaser from 'phaser';
import { SoundManager } from './systems/SoundManager';

export class MenuScene extends Phaser.Scene {
    // Explicitly declare Phaser systems to satisfy strict type checking
    public add!: Phaser.GameObjects.GameObjectFactory;
    public tweens!: Phaser.Tweens.TweenManager;
    public cameras!: Phaser.Cameras.Scene2D.CameraManager;
    public scene!: Phaser.Scenes.ScenePlugin;
    public scale!: Phaser.Scale.ScaleManager;

    private menuAudio?: SoundManager;
    private readonly menuBgmLoopId = 'bgm_menu_main';
    private onMenuBgmUnlock?: () => void;
    private menuPrewarmed = false;
    private loadOverlay?: Phaser.GameObjects.Container;
    private loadOverlayUnsubProgress?: () => void;
    private loadOverlayRunning = false;
    private loadOverlayFill?: Phaser.GameObjects.Rectangle;
    private loadOverlayInfo?: Phaser.GameObjects.Text;

    constructor() {
        super('MenuScene');
    }

    private prewarmMenuEntryAudio() {
        if (!this.menuAudio) this.menuAudio = new SoundManager(this as any);
        if (this.menuPrewarmed) return;
        this.menuPrewarmed = true;
        this.menuAudio.prewarmFolders(['bgm/menu/main_menu/sfx'], 1, 2);
    }

    private startMenuBgm() {
        if ((this.sound as any)?.locked) return;
        const ctx = (this.sound as any)?.context as AudioContext | undefined;
        if (ctx && ctx.state === 'suspended') return;
        this.prewarmMenuEntryAudio();
        this.menuAudio.startLoop(this.menuBgmLoopId, 'bgm/menu/main_menu/sfx', {
            volume: 0.62,
            fadeInMs: 480,
            startAtRandomOffset: false
        }).catch(() => {});
    }

    private ensureMenuBgmPlaying = () => {
        this.startMenuBgm();
    };

    private fadeOutMenuBgm(ms: number = 420) {
        this.menuAudio?.stopLoop(this.menuBgmLoopId, ms);
    }

    private softResetAudioForSceneTransition() {
        try { this.menuAudio?.dispose(); } catch {}
        this.menuAudio = undefined;
        SoundManager.softResetSceneAudio(this);
    }

    private destroyLoadOverlay() {
        if (this.loadOverlayUnsubProgress) {
            try { this.loadOverlayUnsubProgress(); } catch {}
            this.loadOverlayUnsubProgress = undefined;
        }
        if (this.loadOverlay?.active) {
            try { this.loadOverlay.destroy(true); } catch {}
        }
        this.loadOverlay = undefined;
        this.loadOverlayFill = undefined;
        this.loadOverlayInfo = undefined;
        this.loadOverlayRunning = false;
    }

    private ensureLoadOverlay() {
        if (this.loadOverlay?.active) return this.loadOverlay;
        const w = this.scale.width;
        const h = this.scale.height;
        const container = this.add.container(0, 0).setDepth(4000);
        const blocker = this.add.rectangle(w * 0.5, h * 0.5, w, h, 0x000000, 0.9).setInteractive();
        const title = this.add.text(w * 0.5, h * 0.5 - 72, '正在加载音频资源', {
            fontFamily: 'Arial Black',
            fontSize: '30px',
            color: '#f2f4f8',
            stroke: '#000000',
            strokeThickness: 7
        }).setOrigin(0.5);
        const barW = Phaser.Math.Clamp(Math.round(w * 0.56), 300, 680);
        const barH = 22;
        const barBg = this.add.rectangle(w * 0.5, h * 0.5 - 8, barW, barH, 0x23262f, 1).setOrigin(0.5);
        barBg.setStrokeStyle(2, 0x6e7687, 0.9);
        const fill = this.add.rectangle((w * 0.5) - barW * 0.5 + 2, h * 0.5 - 8, 0, barH - 4, 0x6dd4ff, 1).setOrigin(0, 0.5);
        const info = this.add.text(w * 0.5, h * 0.5 + 34, '0%', {
            fontFamily: 'Arial Black',
            fontSize: '20px',
            color: '#d7deec',
            stroke: '#000000',
            strokeThickness: 5
        }).setOrigin(0.5);
        const hint = this.add.text(w * 0.5, h * 0.5 + 72, '首次进入会加载部分音效，随机音效采用分阶段加载策略，确保首次体验无延迟', {
            fontSize: '16px',
            color: '#9ca8bb',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5);

        container.add([blocker, title, barBg, fill, info, hint]);

        const updateProgress = (loaded: number, total: number) => {
            const safeTotal = Math.max(1, total);
            const ratio = Phaser.Math.Clamp(loaded / safeTotal, 0, 1);
            fill.width = Math.max(0, Math.round((barW - 4) * ratio));
            const pct = Math.round(ratio * 100);
            if (total <= 0) {
                info.setText('准备中...');
            } else {
                info.setText(`${pct}% (${loaded}/${total})`);
            }
        };

        updateProgress(0, 1);
        this.loadOverlayUnsubProgress = SoundManager.onSessionAudioPackProgress(updateProgress);
        this.loadOverlay = container;
        this.loadOverlayFill = fill;
        this.loadOverlayInfo = info;
        return container;
    }

    private async startBattleWithAudioGate(sceneData: any) {
        if (this.loadOverlayRunning) return;
        this.loadOverlayRunning = true;

        if (!this.menuAudio) this.menuAudio = new SoundManager(this as any);

        try {
            if (!SoundManager.isSessionAudioPackReady()) {
                this.ensureLoadOverlay();
                
                const overlay = this.loadOverlay;
                const updateP0Progress = (loaded: number, total: number) => {
                    if (!overlay?.active) return;
                    const fill = this.loadOverlayFill;
                    const info = this.loadOverlayInfo;
                    if (!fill || !info) return;
                    const w = this.scale.width;
                    const barW = Phaser.Math.Clamp(Math.round(w * 0.56), 300, 680);
                    const safeTotal = Math.max(1, total);
                    const ratio = Phaser.Math.Clamp(loaded / safeTotal, 0, 1);
                    fill.width = Math.max(0, Math.round((barW - 4) * ratio));
                    const pct = Math.round(ratio * 100);
                    if (total <= 0) {
                        info.setText('准备中...');
                    } else {
                        info.setText(`${pct}% (${loaded}/${total})`);
                    }
                };
                
                console.log('[MenuScene] Starting P0 audio loading...');
                await this.menuAudio.ensureSessionAudioPack({
                    priority: 'P0',
                    concurrency: 5,
                    onProgress: (loaded, total) => {
                        console.log(`[MenuScene] P0 Progress: ${loaded}/${total}`);
                        updateP0Progress(loaded, total);
                    }
                });
                console.log('[MenuScene] P0 audio loading completed');
            }
            this.destroyLoadOverlay();
            this.cameras.main.fade(500, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', () => {
                this.fadeOutMenuBgm();
                this.softResetAudioForSceneTransition();
                this.scene.start('MainScene', sceneData);
            });
        } catch {
            this.destroyLoadOverlay();
            this.loadOverlayRunning = false;
        }
    }

    create() {
        this.prewarmMenuEntryAudio();
        if (!(this.sound as any)?.locked) this.startMenuBgm();
        this.onMenuBgmUnlock = () => this.startMenuBgm();
        this.sound.once('unlocked', this.onMenuBgmUnlock, this);
        this.input.on('pointerdown', this.ensureMenuBgmPlaying, this);
        this.input.keyboard?.on('keydown', this.ensureMenuBgmPlaying, this);

        const bg = this.add.graphics();
        const grid = this.add.graphics();
        const embers = this.add.group(); // Embers group

        // Stylized title for "????"
        const titleText = '炙热金属';
        const titleShadow = this.add.text(0, 0, titleText, {
            fontFamily: 'Arial Black',
            fontSize: '84px',
            color: '#120f0d',
            stroke: '#000000',
            strokeThickness: 14
        }).setOrigin(0.5).setDepth(12).setAlpha(0.88);

        const title = this.add.text(0, 0, titleText, {
            fontFamily: 'Arial Black',
            fontSize: '84px',
            color: '#d4d8de',
            stroke: '#17191c',
            strokeThickness: 9
        }).setOrigin(0.5).setDepth(14);

        const titleHeat = this.add.text(0, 0, titleText, {
            fontFamily: 'Arial Black',
            fontSize: '84px',
            color: '#ffae57',
            stroke: '#7a2e14',
            strokeThickness: 3
        }).setOrigin(0.5).setDepth(15).setAlpha(0.26);
        titleHeat.setBlendMode(Phaser.BlendModes.ADD);

        const titleRim = this.add.text(0, 0, titleText, {
            fontFamily: 'Arial Black',
            fontSize: '84px',
            color: '#fff6e4',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0.5).setDepth(16).setAlpha(0.62);
        titleRim.setBlendMode(Phaser.BlendModes.ADD);

        const logoByText = 'By LicseL';
        const logoByShadow = this.add.text(0, 0, logoByText, {
            fontFamily: 'Arial Black',
            fontSize: '22px',
            color: '#0a0b0d',
            stroke: '#000000',
            strokeThickness: 6,
            letterSpacing: 2
        }).setOrigin(0.5).setDepth(12).setAlpha(0.82);

        const logoBy = this.add.text(0, 0, logoByText, {
            fontFamily: 'Arial Black',
            fontSize: '22px',
            color: '#c8ced8',
            stroke: '#1a1d24',
            strokeThickness: 3,
            letterSpacing: 2
        }).setOrigin(0.5).setDepth(15).setAlpha(0.92);

        const logoByGlow = this.add.text(0, 0, logoByText, {
            fontFamily: 'Arial Black',
            fontSize: '22px',
            color: '#ffbb6e',
            stroke: '#5d220f',
            strokeThickness: 2,
            letterSpacing: 2
        }).setOrigin(0.5).setDepth(16).setAlpha(0.28);
        logoByGlow.setBlendMode(Phaser.BlendModes.ADD);

        for (const t of [titleShadow, title, titleHeat, titleRim, logoByShadow, logoBy, logoByGlow]) {
            t.setPadding(0, 12, 0, 8);
            t.setLineSpacing(2);
        }

        const titleSweep = this.add.rectangle(0, 0, 280, 16, 0xfff6cf, 0.0)
            .setOrigin(0.5)
            .setDepth(17)
            .setAngle(-17);
        titleSweep.setBlendMode(Phaser.BlendModes.ADD);

        const titleSweepSoft = this.add.rectangle(0, 0, 420, 30, 0xff9a4a, 0.0)
            .setOrigin(0.5)
            .setDepth(13)
            .setAngle(-17);
        titleSweepSoft.setBlendMode(Phaser.BlendModes.ADD);

        const titleSweepMask = title.createBitmapMask();
        titleSweep.setMask(titleSweepMask);
        titleSweepSoft.setMask(titleSweepMask);

        this.tweens.add({
            targets: titleHeat,
            alpha: { from: 0.18, to: 0.36 },
            duration: 980,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        this.tweens.add({
            targets: titleRim,
            alpha: { from: 0.46, to: 0.76 },
            duration: 1240,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        this.tweens.add({
            targets: logoByGlow,
            alpha: { from: 0.2, to: 0.52 },
            duration: 1460,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        let titleW = 460;
        const runTitleSweep = () => {
            const startX = title.x - titleW * 0.62;
            const endX = title.x + titleW * 0.62;
            const baseY = title.y - title.displayHeight * 0.16;

            titleSweep.setPosition(startX, baseY).setAlpha(0);
            titleSweepSoft.setPosition(startX - 22, baseY + 4).setAlpha(0);

            this.tweens.add({
                targets: titleSweep,
                x: endX,
                alpha: { from: 0.0, to: 0.92 },
                duration: 860,
                ease: 'Cubic.out'
            });
            this.tweens.add({
                targets: titleSweep,
                alpha: 0,
                duration: 220,
                delay: 640,
                ease: 'Quad.out'
            });

            this.tweens.add({
                targets: titleSweepSoft,
                x: endX + 34,
                alpha: { from: 0.0, to: 0.34 },
                duration: 1020,
                ease: 'Cubic.out'
            });
            this.tweens.add({
                targets: titleSweepSoft,
                alpha: 0,
                duration: 260,
                delay: 700,
                ease: 'Quad.out'
            });
        };
        runTitleSweep();
        const titleSweepTimer = this.time.addEvent({ delay: 2300, loop: true, callback: runTitleSweep });

        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            if (this.onMenuBgmUnlock) this.sound.off('unlocked', this.onMenuBgmUnlock, this);
            this.input.off('pointerdown', this.ensureMenuBgmPlaying, this);
            this.input.keyboard?.off('keydown', this.ensureMenuBgmPlaying, this);
            try { titleSweepTimer.remove(false); } catch {}
            this.destroyLoadOverlay();
            try { this.menuAudio?.dispose(); } catch {}
            this.menuAudio = undefined;
        });

        // Headphone Logo & Advice
        const hpIcon = this.add.graphics();
        const hpAdvice = this.add.text(0, 0, '佩戴耳机或使用音箱获得最好的游戏体验', {
            fontSize: '24px',
            color: '#aaaaaa',
            fontStyle: 'bold'
        }).setOrigin(0.5);
        hpAdvice.setPadding(0, 6, 0, 6);
        hpAdvice.setLineSpacing(2);
        hpAdvice.setAlpha(0);
        hpIcon.setAlpha(0);

        const createButton = (label: string, color: number) => {
            const btnBg = this.add.rectangle(0, 0, 260, 60, color).setInteractive({ useHandCursor: true });
            btnBg.setStrokeStyle(2, 0x888888); // Metallic border
            const btnText = this.add.text(0, 0, label, {
                fontSize: '24px',
                fontStyle: 'bold',
                color: '#ffffff'
            }).setOrigin(0.5);
            btnText.setPadding(0, 4, 0, 4);
            return { btnBg, btnText };
        };

        const { btnBg: startBtnBg, btnText: startBtnText } = createButton('开始作战', 0x8b0000); // Dark Red
        
        startBtnBg.on('pointerover', () => {
            startBtnBg.setFillStyle(0xb22222); // FireBrick
            this.tweens.add({ targets: [startBtnBg, startBtnText], scaleX: 1.05, scaleY: 1.05, duration: 100 });
        });
        startBtnBg.on('pointerout', () => {
            startBtnBg.setFillStyle(0x8b0000);
            this.tweens.add({ targets: [startBtnBg, startBtnText], scaleX: 1, scaleY: 1, duration: 100 });
        });
        startBtnBg.on('pointerdown', () => {
            this.startBattleWithAudioGate({ mapId: 'forest' });
        });

        // 教程按钮
        const { btnBg: tutorialRunBtnBg, btnText: tutorialRunBtnText } = createButton('教程关', 0x3b3f63);
        tutorialRunBtnBg.on('pointerover', () => {
            tutorialRunBtnBg.setFillStyle(0x4d5380);
            this.tweens.add({ targets: [tutorialRunBtnBg, tutorialRunBtnText], scaleX: 1.05, scaleY: 1.05, duration: 100 });
        });
        tutorialRunBtnBg.on('pointerout', () => {
            tutorialRunBtnBg.setFillStyle(0x3b3f63);
            this.tweens.add({ targets: [tutorialRunBtnBg, tutorialRunBtnText], scaleX: 1, scaleY: 1, duration: 100 });
        });
        tutorialRunBtnBg.on('pointerdown', () => {
            this.startBattleWithAudioGate({ mapId: 'forest', tutorial: true });
        });

        // Tutorial level button
        const { btnBg: tutBtnBg, btnText: tutBtnText } = createButton('操作教学', 0x333333); // Dark Grey

        tutBtnBg.on('pointerover', () => {
            tutBtnBg.setFillStyle(0x555555);
            this.tweens.add({ targets: [tutBtnBg, tutBtnText], scaleX: 1.05, scaleY: 1.05, duration: 100 });
        });
        tutBtnBg.on('pointerout', () => {
            tutBtnBg.setFillStyle(0x333333);
            this.tweens.add({ targets: [tutBtnBg, tutBtnText], scaleX: 1, scaleY: 1, duration: 100 });
        });
        tutBtnBg.on('pointerdown', () => {
            this.showTutorial(this.scale.width, this.scale.height);
        });

        let layoutState = {
            btnW: 260,
            btnH: 60,
            cheatY: 0,
            inputW: 260,
            inputH: 40,
            inputFontSize: 18,
            inputRadius: 6
        };

        // Ember spawning loop
        const spawnEmber = (w: number, h: number) => {
             const x = Phaser.Math.Between(0, w);
             const startY = h + 20;
             const size = Phaser.Math.FloatBetween(2, 6);
             const color = Math.random() > 0.7 ? 0xffcc00 : 0xff4400; // Orange/Gold
             const ember = this.add.rectangle(x, startY, size, size, color);
             ember.setAlpha(Phaser.Math.FloatBetween(0.4, 0.9));
             embers.add(ember);

             this.tweens.add({
                 targets: ember,
                 y: startY - Phaser.Math.Between(100, h * 0.8),
                 x: x + Phaser.Math.Between(-50, 50),
                 alpha: 0,
                 angle: Phaser.Math.Between(0, 360),
                 duration: Phaser.Math.Between(2000, 6000),
                 onComplete: () => { ember.destroy(); }
             });
        };
        
        // Spawn embers periodically
        const emberTimer = this.time.addEvent({
            delay: 150,
            callback: () => {
                if (this.cameras.main) spawnEmber(this.scale.width, this.scale.height);
            },
            loop: true
        });

        const layout = () => {
            const w = this.scale.width;
            const h = this.scale.height;
            const unit = Math.max(1, Math.min(w, h));

            bg.clear();
            // 1. Dark, gritty metallic gradient background
            bg.fillGradientStyle(0x1a1c20, 0x1a1c20, 0x08090a, 0x08090a, 1);
            bg.fillRect(0, 0, w, h);

            // 2. Distant War Scene (Silhouette - Ruins/Mountains)
            const farBase = h * 0.65;
            const stepFar = Phaser.Math.Clamp(Math.round(w / 12), 40, 100);
            grid.clear();
            
            // Draw distant jagged terrain
            grid.fillStyle(0x0f1115, 1); // Darker than sky
            grid.beginPath();
            grid.moveTo(0, h);
            grid.lineTo(0, farBase);
            for (let x = 0; x <= w + stepFar; x += stepFar) {
                 const variance = (Math.sin(x * 0.01) + Math.cos(x * 0.03)) * unit * 0.05;
                 grid.lineTo(x, farBase + variance - Math.random() * unit * 0.02); // Jagged
            }
            grid.lineTo(w, h);
            grid.closePath();
            grid.fillPath();

            // 3. Tank Silhouette (Mid/Foreground)
            const tankScale = unit * 0.0035; // Adjust scale based on unit
            const tankX = w * 0.75;
            const tankY = h * 0.85;
            
            grid.fillStyle(0x050607, 1); // Almost black
            grid.beginPath();
            // Simplified heavy tank profile
            // Tracks
            grid.moveTo(tankX - 120 * tankScale, tankY + 20 * tankScale);
            grid.lineTo(tankX + 120 * tankScale, tankY + 20 * tankScale);
            grid.lineTo(tankX + 100 * tankScale, tankY - 20 * tankScale);
            grid.lineTo(tankX - 100 * tankScale, tankY - 20 * tankScale);
            // Hull
            grid.lineTo(tankX - 110 * tankScale, tankY - 20 * tankScale);
            grid.lineTo(tankX - 110 * tankScale, tankY - 50 * tankScale);
            grid.lineTo(tankX + 110 * tankScale, tankY - 50 * tankScale);
            grid.lineTo(tankX + 110 * tankScale, tankY - 20 * tankScale);
            // Turret
            grid.moveTo(tankX - 50 * tankScale, tankY - 50 * tankScale);
            grid.lineTo(tankX - 40 * tankScale, tankY - 90 * tankScale);
            grid.lineTo(tankX + 60 * tankScale, tankY - 90 * tankScale);
            grid.lineTo(tankX + 70 * tankScale, tankY - 50 * tankScale);
            // Barrel (pointing up-left)
            const barrelLen = 180 * tankScale;
            grid.moveTo(tankX, tankY - 70 * tankScale);
            grid.lineTo(tankX - barrelLen, tankY - 140 * tankScale);
            grid.lineTo(tankX - barrelLen, tankY - 125 * tankScale);
            grid.lineTo(tankX, tankY - 60 * tankScale);
            grid.fillPath();

            // 4. Foreground Debris/Ruins
            const nearBase = h * 0.85;
            const stepNear = Phaser.Math.Clamp(Math.round(w / 8), 60, 150);
            grid.fillStyle(0x000000, 1);
            grid.beginPath();
            grid.moveTo(0, h);
            grid.lineTo(0, nearBase);
            for (let x = 0; x <= w + stepNear; x += stepNear) {
                const variance = (Math.cos(x * 0.02) * unit * 0.08);
                // Draw some "building" like blocks
                if (x % (stepNear * 2) === 0) {
                     grid.lineTo(x, nearBase - unit * 0.1);
                     grid.lineTo(x + stepNear * 0.5, nearBase - unit * 0.1);
                     grid.lineTo(x + stepNear * 0.5, nearBase + variance);
                } else {
                     grid.lineTo(x, nearBase + variance);
                }
            }
            grid.lineTo(w, h);
            grid.closePath();
            grid.fillPath();

            // 5. Vignette (Dark corners)
            // Can't do radial gradient easily with Graphics without texture, 
            // so we'll simulate with semi-transparent borders or just a dark overlay at bottom
            bg.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.8, 0.8);
            bg.fillRect(0, h * 0.7, w, h * 0.3);
            bg.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.8, 0.8, 0, 0);
            bg.fillRect(0, 0, w, h * 0.15);

            // Layout UI
            const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
            const topInset = Math.max(0, Math.round(vv?.offsetTop ?? 0));
            const bottomInset = Math.max(0, Math.round((window.innerHeight - ((vv?.height ?? h) + (vv?.offsetTop ?? 0)))));
            const safeTop = Math.max(Math.round(unit * 0.06), topInset + Math.round(unit * 0.04));
            const safeBottom = Math.max(Math.round(unit * 0.08), bottomInset + Math.round(unit * 0.06));

            const titleSize = Phaser.Math.Clamp(Math.round(unit * 0.13), 52, 90);
            const titleStroke = Phaser.Math.Clamp(Math.round(titleSize * 0.14), 8, 14);
            const titleY = safeTop + titleSize * 0.70;

            titleShadow.setFontSize(`${titleSize}px`);
            titleShadow.setStroke('#000000', titleStroke + 4);
            titleShadow.setPosition(w / 2 + titleSize * 0.018, titleY + titleSize * 0.022);

            title.setFontSize(`${titleSize}px`);
            title.setStroke('#15181c', titleStroke);
            title.setPosition(w / 2, titleY);

            titleHeat.setFontSize(`${titleSize}px`);
            titleHeat.setStroke('#6c240f', Math.max(2, Math.round(titleStroke * 0.45)));
            titleHeat.setPosition(w / 2, titleY + titleSize * 0.01);

            titleRim.setFontSize(`${titleSize}px`);
            titleRim.setStroke('#000000', Math.max(1, Math.round(titleStroke * 0.3)));
            titleRim.setPosition(w / 2, titleY - titleSize * 0.01);

            const logoBySize = Phaser.Math.Clamp(Math.round(titleSize * 0.25), 16, 26);
            const logoByY = titleY + titleSize * 0.74;
            logoByShadow.setFontSize(`${logoBySize}px`);
            logoByShadow.setPosition(w / 2 + logoBySize * 0.08, logoByY + logoBySize * 0.10);
            logoBy.setFontSize(`${logoBySize}px`);
            logoBy.setPosition(w / 2, logoByY);
            logoByGlow.setFontSize(`${logoBySize}px`);
            logoByGlow.setPosition(w / 2, logoByY + logoBySize * 0.03);

            titleW = Math.max(280, title.displayWidth);
            titleSweep.setSize(Math.max(150, titleSize * 0.88), Math.max(10, titleSize * 0.18));
            titleSweepSoft.setSize(Math.max(280, titleSize * 1.7), Math.max(22, titleSize * 0.34));

            hpIcon.clear();
            hpAdvice.setText('');

            let btnW = Phaser.Math.Clamp(Math.round(unit * 0.40), 230, 360);
            let btnH = Phaser.Math.Clamp(Math.round(unit * 0.092), 50, 72);
            let btnGap = Phaser.Math.Clamp(Math.round(unit * 0.073), 40, 68);

            const minBtnTop = logoByY + logoBySize * 0.95 + unit * 0.14;
            const maxBtnBottom = h - safeBottom;
            const requiredHeight = btnH * 3 + btnGap * 2.45;
            const availableHeight = Math.max(120, maxBtnBottom - minBtnTop);
            if (requiredHeight > availableHeight) {
                const k = Phaser.Math.Clamp(availableHeight / requiredHeight, 0.74, 1);
                btnW = Math.round(btnW * Phaser.Math.Clamp(k + 0.12, 0.82, 1));
                btnH = Math.round(btnH * k);
                btnGap = Math.round(btnGap * k);
            }

            let startY = minBtnTop + btnH * 0.5;
            let tutorialY = startY + btnH + btnGap * 0.8;
            let tutY = tutorialY + btnH + btnGap * 0.8;
            let cheatY = tutY + btnH + btnGap * 0.72;
            const overflow = (cheatY + btnH * 0.5) - maxBtnBottom;
            if (overflow > 0) {
                startY -= overflow;
                tutorialY -= overflow;
                tutY -= overflow;
                cheatY -= overflow;
            }


            const btnFont = Phaser.Math.Clamp(Math.round(btnH * 0.38), 18, 26);
            const btnTextYOffset = Math.max(0, Math.round(btnH * 0.04));
            startBtnBg.setPosition(w / 2, startY);
            startBtnBg.setSize(btnW, btnH);
            startBtnText.setPosition(w / 2, startY + btnTextYOffset);
            startBtnText.setFontSize(`${btnFont}px`);

            tutorialRunBtnBg.setPosition(w / 2, tutorialY);
            tutorialRunBtnBg.setSize(btnW, btnH);
            tutorialRunBtnText.setPosition(w / 2, tutorialY + btnTextYOffset);
            tutorialRunBtnText.setFontSize(`${btnFont}px`);

            tutBtnBg.setPosition(w / 2, tutY);
            tutBtnBg.setSize(btnW, btnH);
            tutBtnText.setPosition(w / 2, tutY + btnTextYOffset);
            tutBtnText.setFontSize(`${btnFont}px`);

            layoutState = {
                btnW,
                btnH,
                cheatY,
                inputW: btnW,
                inputH: Math.round(btnH * 0.68),
                inputFontSize: Phaser.Math.Clamp(Math.round(btnH * 0.32), 14, 22),
                inputRadius: Phaser.Math.Clamp(Math.round(btnH * 0.12), 6, 10)
            };
        };

        const canvas = this.sys.game.canvas as HTMLCanvasElement | undefined;
        const cheatInput = canvas ? document.createElement('input') : null;
        let cheatInputDestroyed = false;
        const destroyCheatInput = () => {
            if (cheatInputDestroyed) return;
            cheatInputDestroyed = true;
            if (cheatInput) {
                cheatInput.onkeydown = null;
                cheatInput.remove();
            }
        };
        if (cheatInput && canvas) {
            cheatInput.type = 'text';
            cheatInput.placeholder = '';
            cheatInput.autocomplete = 'off';
            (cheatInput as any).autocorrect = 'off';
            (cheatInput as any).autocapitalize = 'off';
            cheatInput.spellcheck = false;
            cheatInput.style.position = 'absolute';
            cheatInput.style.zIndex = '9999';
            cheatInput.style.border = '1px solid rgba(200,200,200,0.35)';
            cheatInput.style.background = 'rgba(0,0,0,0.55)';
            cheatInput.style.color = '#ffffff';
            cheatInput.style.padding = '0 10px';
            cheatInput.style.outline = 'none';
            cheatInput.style.transform = 'translate(-50%, -50%)';
            document.body.appendChild(cheatInput);

            const placeCheatInput = () => {
                if (cheatInputDestroyed) return;
                const w = this.scale.width;
                const h = this.scale.height;
                const rect = canvas.getBoundingClientRect();
                const gx = w / 2;
                const gy = layoutState.cheatY;
                const sx = rect.left + (gx / Math.max(1, w)) * rect.width;
                const sy = rect.top + (gy / Math.max(1, h)) * rect.height;
                cheatInput.style.width = `${layoutState.inputW}px`;
                cheatInput.style.height = `${layoutState.inputH}px`;
                cheatInput.style.fontSize = `${layoutState.inputFontSize}px`;
                cheatInput.style.borderRadius = `${layoutState.inputRadius}px`;
                cheatInput.style.left = `${sx}px`;
                cheatInput.style.top = `${sy}px`;
            };
            const onResize = () => {
                layout();
                placeCheatInput();
            };
            onResize();
            this.scale.on('resize', onResize);

            cheatInput.onkeydown = (ev: KeyboardEvent) => {
                if (ev.key !== 'Enter') return;
                const cmd = cheatInput.value.trim();
                cheatInput.value = '';
                cheatInput.blur();
                if (cmd === '沙漠') {
                    destroyCheatInput();
                    this.scale.off('resize', placeCheatInput);
                    this.startBattleWithAudioGate({ mapId: 'desert' });
                } else if (cmd === '测试') {
                    destroyCheatInput();
                    this.scale.off('resize', placeCheatInput);
                    this.startBattleWithAudioGate({ mapId: 'forest', testRoom: true });
                }
            };

            this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
                this.scale.off('resize', onResize);
                destroyCheatInput();
            });
            this.events.once(Phaser.Scenes.Events.SLEEP, () => {
                this.scale.off('resize', onResize);
                destroyCheatInput();
            });
            this.events.once(Phaser.Scenes.Events.DESTROY, () => {
                this.scale.off('resize', onResize);
                destroyCheatInput();
            });
        }

        if (!cheatInput || !canvas) {
            const onResize = () => layout();
            onResize();
            this.scale.on('resize', onResize);
            this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', onResize));
            this.events.once(Phaser.Scenes.Events.SLEEP, () => this.scale.off('resize', onResize));
            this.events.once(Phaser.Scenes.Events.DESTROY, () => this.scale.off('resize', onResize));
        }
    }

    private showTestRoomPicker(w: number, h: number) {
        const unit = Math.max(1, Math.min(w, h));
        const titleSize = Phaser.Math.Clamp(Math.round(unit * 0.06), 22, 36);
        const btnW = Phaser.Math.Clamp(Math.round(unit * 0.46), 260, 380);
        const btnH = Phaser.Math.Clamp(Math.round(unit * 0.10), 52, 74);
        const btnFont = Phaser.Math.Clamp(Math.round(btnH * 0.38), 18, 28);
        const padBottom = Phaser.Math.Clamp(Math.round(unit * 0.10), 60, 110);

        const container = this.add.container(0, 0).setDepth(120);
        const bg = this.add.rectangle(w/2, h/2, w, h, 0x000000, 0.92).setInteractive();
        container.add(bg);

        const title = this.add.text(w/2, h/2 - 140, '选择测试房间场景', {
            fontFamily: 'Arial Black',
            fontSize: `${titleSize}px`,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: Math.max(6, Math.round(titleSize * 0.22))
        }).setOrigin(0.5);
        container.add(title);

        const makePick = (y: number, label: string, mapId: 'forest' | 'desert') => {
            const color = mapId === 'forest' ? 0xff0000 : 0xd4a373;
            const hover = mapId === 'forest' ? 0xff4444 : 0xe0b181;
            const btn = this.add.rectangle(w/2, y, btnW, btnH, color).setInteractive({ useHandCursor: true });
            const text = this.add.text(w/2, y, label, {
                fontSize: `${btnFont}px`,
                fontStyle: 'bold',
                color: '#ffffff'
            }).setOrigin(0.5);
            btn.on('pointerover', () => {
                btn.setFillStyle(hover);
                this.tweens.add({ targets: [btn, text], scaleX: 1.08, scaleY: 1.08, duration: 90 });
            });
            btn.on('pointerout', () => {
                btn.setFillStyle(color);
                this.tweens.add({ targets: [btn, text], scaleX: 1, scaleY: 1, duration: 90 });
            });
            btn.on('pointerdown', () => {
                container.destroy();
                this.startBattleWithAudioGate({ mapId, testRoom: true });
            });
            container.add([btn, text]);
        };

        makePick(h/2 - btnH * 0.75, '树林（测试）', 'forest');
        makePick(h/2 + btnH * 0.75, '沙漠（测试）', 'desert');

        const cancelBg = this.add.rectangle(w/2, h - padBottom, Math.round(btnW * 0.7), Math.round(btnH * 0.8), 0x444444).setInteractive({ useHandCursor: true });
        cancelBg.setStrokeStyle(2, 0x888888);
        const cancelText = this.add.text(w/2, h - padBottom, '取消', { fontSize: `${Math.max(16, Math.round(btnFont * 0.9))}px`, color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
        cancelBg.on('pointerdown', () => container.destroy());
        container.add([cancelBg, cancelText]);
    }

    private showTutorial(w: number, h: number) {
        const unit = Math.max(1, Math.min(w, h));
        const fontSize = Phaser.Math.Clamp(Math.round(unit * 0.034), 14, 22);
        const lineSpacing = Phaser.Math.Clamp(Math.round(fontSize * 0.6), 8, 14);
        const bottomPad = Phaser.Math.Clamp(Math.round(unit * 0.10), 60, 110);
        const btnW = Phaser.Math.Clamp(Math.round(unit * 0.38), 220, 360);
        const btnH = Phaser.Math.Clamp(Math.round(unit * 0.085), 46, 70);

        const container = this.add.container(0, 0).setDepth(100);
        
        // Background overlay
        const bg = this.add.rectangle(w/2, h/2, w, h, 0x000000, 0.9);
        container.add(bg);

        const content = [
            "【PC端操作指南】",
            "",
            "键盘操作:",
            "  - A、D: 控制战车移动",
            "  - SPACE: 升空/辅助机动",
            "  - 1/2/3/4: 切换武器 (机枪弹/高爆弹/穿甲弹/燃烧弹)",
            "  - 按Shift: 战车冲刺",
            "",
            "鼠标操作:",
            "  - 移动: 瞄准",
            "  - 左键: 射击",
            "  - 右键: 开启/关闭 倍镜",
            "",
            "进阶机制:",
            "  - 拦截: 机枪或炮弹可击落敌方导弹/炮弹",
            "  - 破坏: 爆炸会破坏地形，甚至造成塌陷",
            "  - 殉爆: 击穿装甲可造成致命伤害",
            "",
            "注意: 战友会在生命值低于60%时自动维修"
        ];

        const text = this.add.text(w/2, h/2 - 40, content, {
            fontSize: `${fontSize}px`,
            color: '#eeeeee',
            align: 'center',
            lineSpacing
        }).setOrigin(0.5);
        container.add(text);

        const backBtn = this.add.rectangle(w/2, h - bottomPad, btnW, btnH, 0x666666).setInteractive({ useHandCursor: true });
        backBtn.setStrokeStyle(2, 0xffffff);
        const backText = this.add.text(w/2, h - bottomPad, '返回主菜单', { fontSize: `${Math.max(14, Math.round(btnH * 0.38))}px`, color: '#ffffff' }).setOrigin(0.5);
        
        backBtn.on('pointerdown', () => {
            container.destroy();
        });
        
        container.add([backBtn, backText]);
    }
}
