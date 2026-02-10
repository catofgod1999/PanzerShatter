
import Phaser from 'phaser';
import { MainScene } from '../MainScene';

type AnimalType = 'rabbit' | 'elk' | 'fox' | 'boar' | 'crow' | 'scorpion' | 'snake';

export class Animal extends Phaser.GameObjects.Sprite {
    private mainScene: MainScene;
    private kind: AnimalType;
    private aiState: 'idle' | 'walk' | 'flee' | 'dead' = 'idle';
    private stateTimer = 0;
    private moveDir = 0;
    private moveSpeed = 0;
    private groundY = 0;
    private flyBaseY = 0;
    private flyAlt = 0;
    private flyPhase = 0;
    private hp = 20;
    private visualRoot?: Phaser.GameObjects.Container;
    private visualParts: Phaser.GameObjects.Sprite[] = [];
    private visualLegs: Phaser.GameObjects.Sprite[] = [];
    private visualWings: Phaser.GameObjects.Sprite[] = [];
    private visualSegments: Phaser.GameObjects.Sprite[] = [];
    private visualTailParts: Phaser.GameObjects.Sprite[] = [];
    private visualClaws: Phaser.GameObjects.Sprite[] = [];
    private visualHead?: Phaser.GameObjects.Sprite;
    private visualTail?: Phaser.GameObjects.Sprite;
    private visualSnakeTongue?: Phaser.GameObjects.Sprite;
    private visualScale = 1;
    private visualFacing = 1;
    private visualAnimT = 0;
    private rabbitHopNextAt = 0;
    private rabbitHopJitter = Math.random() * 1000;
    private idleSfxUntil = 0;
    private fleeSfxUntil = 0;
    private readonly voiceSfxId: string;

    constructor(scene: MainScene, x: number, y: number, type: AnimalType) {
        super(scene, x, y, type);
        this.mainScene = scene;
        this.kind = type;
        this.voiceSfxId = `animal_voice_${type}_${Math.floor(scene.time.now)}_${Math.floor(Math.random() * 1_000_000_000)}`;
        scene.add.existing(this);
        scene.physics.add.existing(this);

        const body = this.body as Phaser.Physics.Arcade.Body;
        body.setCollideWorldBounds(true);
        body.setGravityY(type === 'crow' ? 0 : 800);
        
        if (type === 'rabbit') {
            this.setScale(0.22);
            body.setSize(7, 6);
            this.hp = 10;
        } else if (type === 'elk') {
            this.setScale(1.2);
            body.setSize(40, 36);
            this.hp = 40;
        } else if (type === 'fox') {
            this.setScale(0.9);
            body.setSize(32, 18);
            this.hp = 25;
        } else if (type === 'boar') {
            this.setScale(1.15);
            body.setSize(48, 26);
            this.hp = 55;
        } else if (type === 'snake') {
            this.setScale(0.29);
            body.setSize(10, 3);
            this.hp = 22;
            const colors = [0xa86e2a, 0x111111, 0x2b8a3e, 0xd9c45a, 0xf1e3c6];
            this.setTint(colors[Math.floor(Math.random() * colors.length)]);
        } else if (type === 'scorpion') {
            this.setScale(0.34);
            body.setSize(11, 6);
            this.hp = 35;
        } else {
            this.setScale(0.75);
            body.setSize(22, 14);
            this.hp = 18;
            body.setAllowGravity(false);
            this.flyPhase = Math.random() * Math.PI * 2;
            const groundH = this.mainScene.getTerrainHeight(x);
            this.flyAlt = 140 + Math.random() * 120;
            this.flyBaseY = Math.min(y, groundH - this.flyAlt);
            this.setY(this.flyBaseY);
        }

        this.setDepth(20);
        this.stateTimer = scene.time.now + Phaser.Math.Between(500, 2000);
        this.createAdvancedVisuals();
        this.setAlpha(0);
    }

    public static createTextures(scene: Phaser.Scene) {
        const g = scene.add.graphics({ x: 0, y: 0 });
        g.setVisible(false);

        const forceKeys = new Set<string>([
            'an_rabbit_body',
            'an_rabbit_head',
            'an_rabbit_tail',
            'an_snake_seg',
            'an_snake_head',
            'an_snake_tongue'
        ]);

        for (const k of forceKeys) {
            if (scene.textures.exists(k)) scene.textures.remove(k);
        }

        const ensure = (key: string, draw: () => void, w: number, h: number) => {
            if (scene.textures.exists(key)) return;
            g.clear();
            draw();
            g.generateTexture(key, w, h);
        };

        const makeLeg = (key: string, w: number, h: number, hoof: boolean) => {
            ensure(key, () => {
                g.fillStyle(0x2b2b2b, 1);
                g.fillRoundedRect(1, 0, w - 2, h - (hoof ? 3 : 1), 2);
                g.fillStyle(0x1a1a1a, 1);
                if (hoof) g.fillRoundedRect(0, h - 5, w, 5, 2);
                else g.fillRoundedRect(0, h - 3, w, 3, 2);
                g.lineStyle(1, 0x000000, 0.35);
                g.strokeRoundedRect(1, 0, w - 2, h - (hoof ? 3 : 1), 2);
            }, w, h);
        };

        makeLeg('an_leg_small', 8, 16, false);
        makeLeg('an_leg_medium', 9, 20, false);
        makeLeg('an_leg_large', 10, 26, true);

        ensure('an_rabbit_leg_front', () => {
            g.fillStyle(0xf0f0f0, 1);
            g.fillRoundedRect(2, 2, 10, 16, 5);
            g.fillStyle(0xdadada, 1);
            g.fillRoundedRect(3, 10, 8, 8, 4);
            g.lineStyle(2, 0x000000, 0.22);
            g.strokeRoundedRect(2, 2, 10, 16, 5);
        }, 14, 22);

        ensure('an_rabbit_leg_hind', () => {
            g.fillStyle(0xf0f0f0, 1);
            g.fillRoundedRect(1, 4, 12, 16, 6);
            g.fillStyle(0xdadada, 1);
            g.fillRoundedRect(2, 12, 10, 8, 5);
            g.lineStyle(2, 0x000000, 0.22);
            g.strokeRoundedRect(1, 4, 12, 16, 6);
        }, 14, 24);

        ensure('an_rabbit_body', () => {
            g.fillStyle(0xf3f3f3, 1);
            g.fillEllipse(24, 20, 34, 16);
            g.fillEllipse(16, 21, 18, 12);
            g.fillStyle(0xe9e9e9, 1);
            g.fillEllipse(30, 18, 18, 9);
            g.fillStyle(0xffffff, 0.65);
            g.fillEllipse(30, 16, 12, 6);
            g.lineStyle(2, 0x000000, 0.28);
            g.strokeEllipse(24, 20, 34, 16);
        }, 50, 34);

        ensure('an_rabbit_head', () => {
            g.fillStyle(0xf7f7f7, 1);
            g.fillCircle(14, 22, 10);
            g.fillStyle(0xf0f0f0, 1);
            g.fillRoundedRect(9, -2, 5, 32, 3);
            g.fillRoundedRect(16, -2, 5, 32, 3);
            g.fillStyle(0xffc2d1, 0.9);
            g.fillRoundedRect(10.5, 6, 2.5, 20, 1.5);
            g.fillRoundedRect(17.5, 6, 2.5, 20, 1.5);
            g.fillStyle(0x2b2b2b, 1);
            g.fillCircle(18, 22, 1.6);
            g.fillCircle(10, 22, 1.6);
            g.fillStyle(0x444444, 1);
            g.fillCircle(24, 26, 1.3);
            g.fillStyle(0xffffff, 0.7);
            g.fillCircle(18.5, 21.4, 0.6);
            g.lineStyle(2, 0x000000, 0.25);
            g.strokeCircle(14, 22, 10);
        }, 30, 46);

        ensure('an_rabbit_tail', () => {
            g.fillStyle(0xffffff, 1);
            g.fillCircle(10, 12, 7);
            g.fillStyle(0xe6e6e6, 1);
            g.fillCircle(8, 10, 3);
            g.lineStyle(2, 0x000000, 0.20);
            g.strokeCircle(10, 12, 7);
        }, 22, 22);

        ensure('an_fox_body', () => {
            g.fillStyle(0xcc6a2a, 1);
            g.fillEllipse(26, 18, 42, 18);
            g.fillStyle(0xa84e1a, 1);
            g.fillEllipse(20, 18, 20, 10);
            g.fillStyle(0xffddc2, 1);
            g.fillEllipse(36, 22, 18, 8);
            g.lineStyle(2, 0x000000, 0.30);
            g.strokeEllipse(26, 18, 42, 18);
        }, 56, 34);

        ensure('an_fox_head', () => {
            g.fillStyle(0xcc6a2a, 1);
            g.fillCircle(18, 18, 12);
            g.fillStyle(0xffddc2, 1);
            g.fillEllipse(24, 22, 18, 10);
            g.fillStyle(0x2b1b12, 1);
            g.fillCircle(28, 22, 1.8);
            g.fillStyle(0x111111, 1);
            g.fillCircle(22, 16, 1.6);
            g.fillCircle(14, 16, 1.6);
            g.fillStyle(0xffffff, 0.7);
            g.fillCircle(22.4, 15.4, 0.6);
            g.fillStyle(0x2a1a10, 1);
            g.fillTriangle(6, 6, 12, 2, 14, 10);
            g.fillTriangle(22, 2, 28, 6, 20, 10);
            g.lineStyle(2, 0x000000, 0.28);
            g.strokeCircle(18, 18, 12);
        }, 36, 36);

        ensure('an_fox_tail', () => {
            g.fillStyle(0xcc6a2a, 1);
            g.fillRoundedRect(2, 6, 34, 14, 8);
            g.fillStyle(0xffddc2, 1);
            g.fillRoundedRect(24, 8, 12, 10, 6);
            g.lineStyle(2, 0x000000, 0.25);
            g.strokeRoundedRect(2, 6, 34, 14, 8);
        }, 40, 26);

        ensure('an_boar_body', () => {
            g.fillStyle(0x3b2f2a, 1);
            g.fillRoundedRect(6, 10, 50, 22, 10);
            g.fillStyle(0x2a211d, 1);
            g.fillRoundedRect(34, 14, 22, 16, 8);
            g.fillStyle(0xe6e6e6, 1);
            g.fillTriangle(52, 22, 60, 20, 56, 26);
            g.fillStyle(0xffffff, 0.35);
            g.fillEllipse(24, 16, 18, 10);
            g.lineStyle(2, 0x000000, 0.30);
            g.strokeRoundedRect(6, 10, 50, 22, 10);
        }, 64, 40);

        ensure('an_boar_head', () => {
            g.fillStyle(0x2a211d, 1);
            g.fillRoundedRect(8, 12, 28, 20, 10);
            g.fillStyle(0x1b1b1b, 0.9);
            g.fillRoundedRect(26, 18, 10, 10, 4);
            g.fillStyle(0xffffff, 0.75);
            g.fillCircle(16, 18, 1.2);
            g.fillCircle(22, 18, 1.2);
            g.fillStyle(0xe6e6e6, 1);
            g.fillTriangle(30, 24, 42, 20, 36, 30);
            g.lineStyle(2, 0x000000, 0.28);
            g.strokeRoundedRect(8, 12, 28, 20, 10);
        }, 44, 44);

        ensure('an_elk_body', () => {
            g.fillStyle(0x8b4513, 1);
            g.fillRoundedRect(10, 12, 58, 24, 10);
            g.fillStyle(0x6f360f, 1);
            g.fillRoundedRect(12, 14, 24, 10, 6);
            g.fillStyle(0xffffff, 0.22);
            g.fillEllipse(42, 18, 26, 12);
            g.lineStyle(2, 0x000000, 0.28);
            g.strokeRoundedRect(10, 12, 58, 24, 10);
        }, 80, 48);

        ensure('an_elk_head', () => {
            g.fillStyle(0x8b4513, 1);
            g.fillRoundedRect(10, 16, 34, 20, 10);
            g.fillStyle(0xd2b48c, 1);
            g.fillRoundedRect(30, 22, 14, 12, 6);
            g.fillStyle(0x111111, 1);
            g.fillCircle(18, 24, 1.6);
            g.fillCircle(24, 24, 1.6);
            g.fillStyle(0xf5deb3, 1);
            g.fillRect(16, 0, 3, 18);
            g.fillRect(26, 0, 3, 18);
            g.fillRect(12, 8, 10, 3);
            g.fillRect(22, 8, 10, 3);
            g.lineStyle(2, 0x000000, 0.24);
            g.strokeRoundedRect(10, 16, 34, 20, 10);
        }, 52, 52);

        ensure('an_crow_body', () => {
            g.fillStyle(0x111111, 1);
            g.fillEllipse(18, 18, 28, 16);
            g.fillStyle(0x0a0a0a, 1);
            g.fillEllipse(12, 18, 18, 10);
            g.fillStyle(0x222222, 1);
            g.fillTriangle(26, 18, 40, 14, 40, 22);
            g.fillStyle(0xffffff, 0.75);
            g.fillCircle(22, 14, 1.2);
            g.lineStyle(2, 0x000000, 0.30);
            g.strokeEllipse(18, 18, 28, 16);
        }, 44, 36);

        ensure('an_crow_wing', () => {
            g.fillStyle(0x0a0a0a, 1);
            g.fillRoundedRect(2, 8, 34, 14, 10);
            g.fillStyle(0x1a1a1a, 1);
            g.fillRoundedRect(8, 10, 26, 10, 8);
            g.lineStyle(2, 0x000000, 0.25);
            g.strokeRoundedRect(2, 8, 34, 14, 10);
        }, 40, 30);

        ensure('an_snake_seg', () => {
            g.fillStyle(0x2b8a3e, 1);
            g.fillRoundedRect(2, 8, 34, 8, 6);
            g.fillStyle(0x1f6a2e, 1);
            g.fillRoundedRect(6, 9, 26, 6, 5);
            g.fillStyle(0xffffff, 0.18);
            g.fillEllipse(14, 9, 10, 4);
            g.lineStyle(2, 0x000000, 0.20);
            g.strokeRoundedRect(2, 8, 34, 8, 6);
        }, 38, 20);

        ensure('an_snake_head', () => {
            g.fillStyle(0x2b8a3e, 1);
            g.fillRoundedRect(6, 10, 24, 12, 8);
            g.fillStyle(0x1f6a2e, 1);
            g.fillRoundedRect(16, 13, 14, 8, 6);
            g.fillStyle(0x111111, 1);
            g.fillCircle(12, 15, 1.4);
            g.fillCircle(12, 19, 1.4);
            g.fillStyle(0xffffff, 0.65);
            g.fillCircle(12.5, 14.6, 0.55);
            g.lineStyle(2, 0x000000, 0.25);
            g.strokeRoundedRect(6, 10, 24, 12, 8);
        }, 36, 28);

        ensure('an_scorp_body', () => {
            g.fillStyle(0x5a3a22, 1);
            g.fillRoundedRect(20, 18, 32, 18, 10);
            g.fillStyle(0x4a2f1c, 1);
            g.fillRoundedRect(10, 14, 28, 20, 12);

            g.fillStyle(0x2a1a10, 1);
            g.fillRoundedRect(12, 16, 24, 16, 10);
            g.fillStyle(0x3a2314, 1);
            g.fillEllipse(16, 22, 10, 6);
            g.fillEllipse(16, 28, 10, 6);

            g.fillStyle(0x111111, 0.85);
            g.fillCircle(18, 18, 1.4);
            g.fillCircle(22, 18, 1.4);

            g.fillStyle(0xffffff, 0.12);
            g.fillEllipse(40, 22, 16, 8);

            g.lineStyle(2, 0x000000, 0.26);
            g.strokeRoundedRect(10, 14, 28, 20, 12);
            g.strokeRoundedRect(20, 18, 32, 18, 10);
        }, 60, 52);

        ensure('an_scorp_leg', () => {
            g.lineStyle(4, 0x3a2314, 1);
            g.beginPath();
            g.moveTo(4, 4);
            g.lineTo(18, 12);
            g.lineTo(32, 6);
            g.strokePath();
        }, 36, 20);

        ensure('an_scorp_tail', () => {
            g.fillStyle(0x5a3a22, 1);
            g.fillRoundedRect(2, 8, 28, 10, 6);
            g.fillStyle(0x3a2314, 1);
            g.fillRoundedRect(18, 6, 14, 14, 8);
            g.lineStyle(2, 0x000000, 0.25);
            g.strokeRoundedRect(2, 8, 28, 10, 6);
        }, 36, 28);

        ensure('an_scorp_tail_seg', () => {
            g.fillStyle(0x5a3a22, 1);
            g.fillRoundedRect(2, 6, 18, 10, 6);
            g.fillStyle(0x3a2314, 1);
            g.fillRoundedRect(10, 8, 10, 6, 5);
            g.lineStyle(2, 0x000000, 0.22);
            g.strokeRoundedRect(2, 6, 18, 10, 6);
        }, 24, 22);

        ensure('an_scorp_claw', () => {
            g.fillStyle(0x3a2314, 1);
            g.fillRoundedRect(2, 10, 24, 10, 6);
            g.fillStyle(0x2a1a10, 1);
            g.fillTriangle(20, 8, 34, 14, 20, 20);
            g.fillTriangle(18, 12, 30, 14, 18, 16);
            g.lineStyle(2, 0x000000, 0.25);
            g.strokeRoundedRect(2, 10, 24, 10, 6);
        }, 36, 28);

        ensure('an_scorp_stinger', () => {
            g.fillStyle(0x2a1a10, 1);
            g.fillTriangle(2, 10, 22, 2, 22, 18);
            g.fillStyle(0x000000, 0.25);
            g.fillTriangle(6, 10, 20, 4, 20, 16);
        }, 24, 20);

        ensure('an_snake_tongue', () => {
            g.lineStyle(3, 0xd72638, 1);
            g.beginPath();
            g.moveTo(2, 10);
            g.lineTo(22, 10);
            g.strokePath();
            g.lineStyle(2, 0xd72638, 1);
            g.beginPath();
            g.moveTo(18, 10);
            g.lineTo(22, 6);
            g.moveTo(18, 10);
            g.lineTo(22, 14);
            g.strokePath();
        }, 24, 20);

        if (!scene.textures.exists('rabbit')) {
            const g = scene.add.graphics({ x: 0, y: 0 });
            g.setVisible(false);
            g.fillStyle(0xffffff);
            g.fillRect(0, 10, 24, 14); // Body
            g.fillRect(18, 0, 4, 12); // Ear
            g.fillRect(2, 18, 6, 6); // Leg
            g.fillRect(16, 18, 6, 6); // Leg
            g.fillStyle(0xffaaaa);
            g.fillCircle(22, 14, 1); // Eye
            g.generateTexture('rabbit', 24, 24);
            g.destroy();
        }

        if (!scene.textures.exists('elk')) {
            const g = scene.add.graphics({ x: 0, y: 0 });
            g.setVisible(false);
            g.fillStyle(0x8B4513); // SaddleBrown
            g.fillRect(0, 10, 40, 26); // Body
            g.fillRect(30, 0, 10, 15); // Neck/Head
            g.fillStyle(0xD2691E); // Chocolate
            g.fillRect(4, 36, 6, 10); // Leg
            g.fillRect(30, 36, 6, 10); // Leg
            g.fillStyle(0xF5DEB3); // Wheat (Antlers)
            g.fillRect(32, -5, 2, 10); 
            g.fillRect(36, -8, 2, 12);
            g.fillRect(30, -2, 10, 2);
            g.generateTexture('elk', 45, 48);
            g.destroy();
        }

        if (!scene.textures.exists('fox')) {
            const g = scene.add.graphics({ x: 0, y: 0 });
            g.setVisible(false);
            g.fillStyle(0xcc6a2a);
            g.fillRect(0, 10, 32, 14);
            g.fillStyle(0xffbb88);
            g.fillRect(22, 6, 10, 10);
            g.fillStyle(0x2b1b12);
            g.fillRect(6, 22, 4, 4);
            g.fillRect(20, 22, 4, 4);
            g.fillStyle(0xffffff, 0.9);
            g.fillRect(28, 12, 2, 2);
            g.generateTexture('fox', 36, 28);
            g.destroy();
        }

        if (!scene.textures.exists('boar')) {
            const g = scene.add.graphics({ x: 0, y: 0 });
            g.setVisible(false);
            g.fillStyle(0x3b2f2a);
            g.fillRoundedRect(0, 10, 48, 22, 8);
            g.fillStyle(0x2a211d);
            g.fillRoundedRect(34, 14, 14, 14, 6);
            g.fillStyle(0xffffff, 0.9);
            g.fillRect(42, 17, 2, 2);
            g.fillStyle(0xe6e6e6, 0.9);
            g.fillRect(46, 20, 2, 2);
            g.fillStyle(0x1b1b1b);
            g.fillRect(10, 30, 5, 6);
            g.fillRect(30, 30, 5, 6);
            g.generateTexture('boar', 52, 40);
            g.destroy();
        }

        if (!scene.textures.exists('crow')) {
            const g = scene.add.graphics({ x: 0, y: 0 });
            g.setVisible(false);
            g.fillStyle(0x111111);
            g.fillEllipse(12, 12, 20, 10);
            g.fillStyle(0x0a0a0a);
            g.fillTriangle(4, 12, 0, 6, 0, 18);
            g.fillTriangle(20, 12, 28, 8, 28, 16);
            g.fillStyle(0x222222);
            g.fillRect(12, 16, 2, 6);
            g.fillStyle(0xffffff, 0.8);
            g.fillRect(14, 10, 2, 2);
            g.generateTexture('crow', 30, 26);
            g.destroy();
        }

        if (!scene.textures.exists('snake')) {
            const g = scene.add.graphics({ x: 0, y: 0 });
            g.setVisible(false);
            g.clear();
            g.fillStyle(0x2b8a3e);
            g.fillRoundedRect(0, 8, 44, 10, 6);
            g.fillCircle(42, 13, 7);
            g.fillStyle(0x000000, 0.75);
            g.fillCircle(45, 12, 1.2);
            g.fillStyle(0xffffff, 0.85);
            g.fillCircle(46, 11, 0.6);
            g.generateTexture('snake', 52, 28);
            g.destroy();
        }

        if (!scene.textures.exists('scorpion')) {
            const g = scene.add.graphics({ x: 0, y: 0 });
            g.setVisible(false);
            g.clear();
            g.fillStyle(0x5a3a22);
            g.fillRoundedRect(8, 10, 34, 18, 8);
            g.fillRoundedRect(38, 12, 14, 10, 5);
            g.fillStyle(0x3a2314);
            g.fillRoundedRect(0, 14, 12, 6, 3);
            g.fillRoundedRect(2, 20, 12, 6, 3);
            g.fillRoundedRect(0, 8, 12, 6, 3);
            g.fillRoundedRect(2, 2, 10, 8, 4);
            g.fillStyle(0x2a1a10);
            g.fillTriangle(10, 6, 18, 0, 16, 10);
            g.generateTexture('scorpion', 56, 32);
            g.destroy();
        }

        if (!scene.textures.exists('rabbit_chunk')) {
            const g = scene.add.graphics({ x: 0, y: 0 });
            g.setVisible(false);
            g.clear();
            g.fillStyle(0xffffff);
            g.fillRect(0, 2, 10, 7);
            g.fillStyle(0xe6e6e6);
            g.fillRect(1, 0, 5, 4);
            g.generateTexture('rabbit_chunk', 10, 10);
            g.destroy();
        }

        if (!scene.textures.exists('elk_chunk')) {
            const g = scene.add.graphics({ x: 0, y: 0 });
            g.setVisible(false);
            g.clear();
            g.fillStyle(0x8B4513);
            g.fillRect(0, 2, 14, 10);
            g.fillStyle(0xD2691E);
            g.fillRect(2, 0, 8, 5);
            g.generateTexture('elk_chunk', 14, 14);
            g.destroy();
        }

        g.destroy();
    }

    preUpdate(time: number, delta: number) {
        super.preUpdate(time, delta);
        if (this.aiState === 'dead') return;
        this.visualAnimT += delta;

        const body = this.body as Phaser.Physics.Arcade.Body;
        if (!body) return;

        const groundH = this.mainScene.getGroundHeight(this.x);
        this.groundY = groundH;
        if (this.kind !== 'crow') {
            const bottom = body.bottom;
            if (Number.isFinite(bottom)) {
                const dy = groundH - bottom;
                if (dy < 0) {
                    this.y += dy;
                    if (body.velocity.y > 0) body.velocity.y = 0;
                }
            } else {
                this.y = groundH;
                body.velocity.y = 0;
            }
        } else {
            const minAlt = 120;
            const maxAlt = 280;
            if (!Number.isFinite(this.flyAlt) || this.flyAlt <= 0) {
                this.flyAlt = 140 + Math.random() * 120;
            }
            this.flyAlt = Phaser.Math.Clamp(this.flyAlt, minAlt, maxAlt);

            const desiredBaseY = groundH - this.flyAlt;
            if (!Number.isFinite(this.flyBaseY) || this.flyBaseY === 0) {
                this.flyBaseY = desiredBaseY;
            } else {
                this.flyBaseY = Phaser.Math.Linear(this.flyBaseY, desiredBaseY, 0.08);
            }

            const ceiling = groundH - minAlt;
            const floor = groundH - maxAlt;
            this.flyBaseY = Phaser.Math.Clamp(this.flyBaseY, floor, ceiling);
            body.setVelocityY(0);
        }

        // State Machine
        if (time > this.stateTimer) {
            this.pickState();
        }
        if (this.aiState === 'flee') {
            this.ensureFleeSpeed();
        }

        // Idle SFX Logic
        if (this.aiState === 'idle' || this.aiState === 'walk') {
            const now = this.mainScene.time.now;
            if (now > this.idleSfxUntil && Math.random() < 0.005) { // Low chance per frame (~0.3/sec)
                this.idleSfxUntil = now + 7500 + Math.random() * 7500;
                this.mainScene.audio.playFolderExclusive(this.voiceSfxId, `environment/forest/point_3d/creatures/${this.kind}/idle/sfx`, { worldX: this.x, worldY: this.y, volume: 0.65, cooldownMs: 0 });
            }
        }

        // Behavior
        if (this.kind === 'crow') {
            const t = time * 0.004 + this.flyPhase;
            const bob = Math.sin(t * 2.3) * 6 + Math.sin(t * 0.9) * 3;
            if (this.aiState === 'walk') {
                const target = this.moveDir * (this.moveSpeed * 2.0);
                body.setVelocityX(Phaser.Math.Linear(body.velocity.x, target, 0.22));
                this.setFlipX(this.moveDir < 0);
            } else if (this.aiState === 'flee') {
                const target = this.moveDir * (this.moveSpeed * 3.6);
                body.setVelocityX(Phaser.Math.Linear(body.velocity.x, target, 0.30));
                this.setFlipX(this.moveDir < 0);
            } else {
                body.setVelocityX(body.velocity.x * 0.92);
            }
            const minAlt = 120;
            const maxAlt = 280;
            const ceiling = this.groundY - minAlt;
            const floor = this.groundY - maxAlt;
            const wantY = Phaser.Math.Clamp(this.flyBaseY + bob, floor + 4, ceiling - 4);
            this.y = Phaser.Math.Linear(this.y, wantY, 0.2);
            this.y = Phaser.Math.Clamp(this.y, floor, ceiling);
        } else if (this.kind === 'snake') {
            if (this.aiState === 'walk') {
                const target = this.moveDir * (this.moveSpeed * 1.0);
                body.setVelocityX(Phaser.Math.Linear(body.velocity.x, target, 0.18));
                this.setFlipX(this.moveDir < 0);
            } else if (this.aiState === 'flee') {
                const target = this.moveDir * (this.moveSpeed * 1.45);
                body.setVelocityX(Phaser.Math.Linear(body.velocity.x, target, 0.26));
                this.setFlipX(this.moveDir < 0);
            } else {
                body.setVelocityX(body.velocity.x * 0.8);
            }
        } else if (this.kind === 'scorpion') {
            if (this.aiState === 'walk') {
                const target = this.moveDir * (this.moveSpeed * 1.0);
                body.setVelocityX(Phaser.Math.Linear(body.velocity.x, target, 0.20));
                this.setFlipX(this.moveDir < 0);
            } else if (this.aiState === 'flee') {
                const target = this.moveDir * (this.moveSpeed * 1.55);
                body.setVelocityX(Phaser.Math.Linear(body.velocity.x, target, 0.30));
                this.setFlipX(this.moveDir < 0);
            } else {
                body.setVelocityX(body.velocity.x * 0.7);
            }
        } else if (this.kind === 'rabbit') {
            const onGround = body.blocked.down || body.touching.down;
            if (this.aiState === 'walk' || this.aiState === 'flee') {
                const isFlee = this.aiState === 'flee';
                const speedMul = isFlee ? 1.25 : 1.0;
                const vx = this.moveDir * (this.moveSpeed * speedMul);
                if (onGround) {
                    const base = isFlee ? 260 : 360;
                    const span = isFlee ? 160 : 260;
                    if (time >= this.rabbitHopNextAt) {
                        body.setVelocityY(isFlee ? -380 : -300);
                        const j = (Math.sin((time + this.rabbitHopJitter) * 0.01) + 1) * 0.5;
                        this.rabbitHopNextAt = time + base + j * span;
                    }
                    body.setVelocityX(vx * 0.75);
                } else {
                    body.setVelocityX(vx);
                }
                this.setFlipX(this.moveDir < 0);
            } else {
                body.setVelocityX(body.velocity.x * 0.7);
            }
        } else {
            if (this.aiState === 'walk') {
                const target = this.moveDir * this.moveSpeed;
                body.setVelocityX(Phaser.Math.Linear(body.velocity.x, target, 0.16));
                this.setFlipX(this.moveDir < 0);
                
                if (Math.random() < 0.02 && body.touching.down) {
                    body.setVelocityY(-200);
                }
            } else if (this.aiState === 'flee') {
                const target = this.moveDir * this.moveSpeed * 1.55;
                body.setVelocityX(Phaser.Math.Linear(body.velocity.x, target, 0.24));
                this.setFlipX(this.moveDir < 0);

                if (Math.random() < 0.08 && body.touching.down) {
                    body.setVelocityY(-350);
                }
            } else {
                body.setVelocityX(body.velocity.x * 0.7);
            }
        }

        // Check danger
        this.checkForDanger();
        this.syncVisuals(time);
    }

    private createAdvancedVisuals() {
        const s = this.mainScene;
        this.visualRoot?.destroy();
        this.visualRoot = s.add.container(this.x, this.y).setDepth(20);
        this.visualParts = [];
        this.visualLegs = [];
        this.visualWings = [];
        this.visualSegments = [];
        this.visualTailParts = [];
        this.visualClaws = [];
        this.visualHead = undefined;
        this.visualTail = undefined;
        this.visualSnakeTongue = undefined;
        this.visualFacing = 1;

        if (this.kind === 'rabbit') {
            this.visualScale = 0.36;
            const body = s.add.sprite(0, 0, 'an_rabbit_body').setOrigin(0.46, 0.62);
            const tail = s.add.sprite(-22, 2, 'an_rabbit_tail').setOrigin(0.5, 0.5);
            const head = s.add.sprite(22, -12, 'an_rabbit_head').setOrigin(0.45, 0.76);
            this.visualHead = head;
            const legs = [
                s.add.sprite(12, 14, 'an_rabbit_leg_front').setOrigin(0.5, 0.08),
                s.add.sprite(20, 14, 'an_rabbit_leg_front').setOrigin(0.5, 0.08),
                s.add.sprite(-10, 14, 'an_rabbit_leg_hind').setOrigin(0.5, 0.10),
                s.add.sprite(-2, 14, 'an_rabbit_leg_hind').setOrigin(0.5, 0.10)
            ];
            this.visualLegs.push(...legs);
            this.visualParts.push(...legs, tail, body, head);
            this.visualRoot.add(this.visualParts);
        } else if (this.kind === 'fox') {
            this.visualScale = 1.0;
            const body = s.add.sprite(0, 0, 'an_fox_body').setOrigin(0.45, 0.6);
            const head = s.add.sprite(22, -6, 'an_fox_head').setOrigin(0.5, 0.65);
            const tail = s.add.sprite(-26, 2, 'an_fox_tail').setOrigin(0.2, 0.55);
            this.visualHead = head;
            this.visualTail = tail;
            const legs = [
                s.add.sprite(-12, 12, 'an_leg_medium').setOrigin(0.5, 0.05),
                s.add.sprite(-4, 12, 'an_leg_medium').setOrigin(0.5, 0.05),
                s.add.sprite(6, 12, 'an_leg_medium').setOrigin(0.5, 0.05),
                s.add.sprite(14, 12, 'an_leg_medium').setOrigin(0.5, 0.05)
            ];
            this.visualLegs.push(...legs);
            this.visualParts.push(...legs, tail, body, head);
            this.visualRoot.add(this.visualParts);
        } else if (this.kind === 'boar') {
            this.visualScale = 1.0;
            const body = s.add.sprite(0, 0, 'an_boar_body').setOrigin(0.45, 0.62);
            const head = s.add.sprite(28, 0, 'an_boar_head').setOrigin(0.5, 0.66);
            this.visualHead = head;
            const legs = [
                s.add.sprite(-14, 14, 'an_leg_medium').setOrigin(0.5, 0.05),
                s.add.sprite(-6, 14, 'an_leg_medium').setOrigin(0.5, 0.05),
                s.add.sprite(6, 14, 'an_leg_medium').setOrigin(0.5, 0.05),
                s.add.sprite(16, 14, 'an_leg_medium').setOrigin(0.5, 0.05)
            ];
            this.visualLegs.push(...legs);
            this.visualParts.push(...legs, body, head);
            this.visualRoot.add(this.visualParts);
        } else if (this.kind === 'elk') {
            this.visualScale = 0.92;
            const body = s.add.sprite(0, 0, 'an_elk_body').setOrigin(0.45, 0.62);
            const head = s.add.sprite(30, -8, 'an_elk_head').setOrigin(0.5, 0.70);
            this.visualHead = head;
            const legs = [
                s.add.sprite(-18, 16, 'an_leg_large').setOrigin(0.5, 0.05),
                s.add.sprite(-6, 16, 'an_leg_large').setOrigin(0.5, 0.05),
                s.add.sprite(10, 16, 'an_leg_large').setOrigin(0.5, 0.05),
                s.add.sprite(22, 16, 'an_leg_large').setOrigin(0.5, 0.05)
            ];
            this.visualLegs.push(...legs);
            this.visualParts.push(...legs, body, head);
            this.visualRoot.add(this.visualParts);
        } else if (this.kind === 'crow') {
            this.visualScale = 0.95;
            const body = s.add.sprite(0, 0, 'an_crow_body').setOrigin(0.5, 0.55);
            const wingL = s.add.sprite(-6, 2, 'an_crow_wing').setOrigin(0.85, 0.55);
            const wingR = s.add.sprite(-6, 2, 'an_crow_wing').setOrigin(0.85, 0.55);
            wingR.setFlipY(true);
            this.visualWings.push(wingL, wingR);
            this.visualParts.push(wingL, wingR, body);
            this.visualRoot.add(this.visualParts);
        } else if (this.kind === 'snake') {
            this.visualScale = 0.35;
            const segCount = 6;
            for (let i = 0; i < segCount; i++) {
                const seg = s.add.sprite(-i * 10, 0, 'an_snake_seg').setOrigin(0.55, 0.65);
                seg.setTint(this.tintTopLeft);
                this.visualSegments.push(seg);
            }
            const head = s.add.sprite(10, 0, 'an_snake_head').setOrigin(0.5, 0.66);
            head.setTint(this.tintTopLeft);
            this.visualHead = head;
            const tongue = s.add.sprite(24, 4, 'an_snake_tongue').setOrigin(0, 0.5);
            tongue.setTint(0xffffff);
            tongue.setAlpha(0);
            this.visualSnakeTongue = tongue;
            this.visualParts.push(...this.visualSegments, head, tongue);
            this.visualRoot.add(this.visualParts);
        } else if (this.kind === 'scorpion') {
            this.visualScale = 0.34;
            const body = s.add.sprite(0, 0, 'an_scorp_body').setOrigin(0.5, 0.62);
            const tailParts: Phaser.GameObjects.Sprite[] = [];
            for (let i = 0; i < 4; i++) {
                const seg = s.add.sprite(-10 - i * 10, -8 - i * 5, 'an_scorp_tail_seg').setOrigin(0.15, 0.55);
                tailParts.push(seg);
            }
            const stinger = s.add.sprite(-54, -30, 'an_scorp_stinger').setOrigin(0.25, 0.6);
            tailParts.push(stinger);
            this.visualTailParts.push(...tailParts);

            const claws = [
                s.add.sprite(20, 6, 'an_scorp_claw').setOrigin(0.2, 0.55),
                s.add.sprite(20, 6, 'an_scorp_claw').setOrigin(0.2, 0.55)
            ];
            claws[1].setFlipY(true);
            this.visualClaws.push(...claws);

            const legs: Phaser.GameObjects.Sprite[] = [];
            for (let i = 0; i < 3; i++) {
                const y = 6 + i * 5;
                const l = s.add.sprite(-6, y, 'an_scorp_leg').setOrigin(0.5, 0.5).setScale(0.9, 0.9);
                const r = s.add.sprite(6, y, 'an_scorp_leg').setOrigin(0.5, 0.5).setScale(0.9, 0.9);
                r.setFlipX(true);
                legs.push(l, r);
            }
            this.visualLegs.push(...legs);

            this.visualParts.push(...legs, ...tailParts, body, ...claws);
            this.visualRoot.add(this.visualParts);
        }

        this.visualRoot.setScale(this.visualScale, this.visualScale);
    }

    private syncVisuals(time: number) {
        if (!this.visualRoot || !this.visualRoot.active) return;
        this.visualRoot.setPosition(this.x, this.y);

        if (this.aiState === 'dead') {
            this.visualRoot.setVisible(false);
            return;
        }

        const facing = (this.aiState === 'walk' || this.aiState === 'flee') ? (this.moveDir === 0 ? this.visualFacing : this.moveDir) : this.visualFacing;
        if (facing !== 0) this.visualFacing = facing;

        const fx = this.visualFacing >= 0 ? 1 : -1;
        this.visualRoot.setScale(this.visualScale * fx, this.visualScale);

        const baseRot = this.kind === 'crow' ? 0 : this.mainScene.getTerrainNormal(this.x) * 0.8;
        const t = time * 0.001;

        let bob = 0;
        let sway = 0;
        let legA = 0;
        let legB = 0;

        if (this.kind === 'rabbit') {
            if (this.aiState === 'walk' || this.aiState === 'flee') {
                const isFlee = this.aiState === 'flee';
                const sp = isFlee ? 0.024 : 0.018;
                const p = this.visualAnimT * sp;
                const hop = Math.max(0, Math.sin(p));
                const lift = hop * hop;
                bob = lift * (isFlee ? 6.5 : 4.6);
                sway = Math.sin(p * 0.5) * (isFlee ? 0.14 : 0.10);
                legA = -hop * (isFlee ? 1.25 : 0.95);
                legB = hop * (isFlee ? 0.85 : 0.65);
            } else {
                bob = Math.sin((t + this.flyPhase) * 2.6) * 0.55;
                sway = Math.sin((t + this.flyPhase) * 2.1) * 0.04;
            }
        } else if (this.aiState === 'walk') {
            const sp = 0.008 + (this.moveSpeed / 3200);
            bob = Math.abs(Math.sin(this.visualAnimT * sp)) * (this.kind === 'elk' ? 2.2 : 1.7);
            sway = Math.sin(this.visualAnimT * sp * 0.6) * 0.08;
            legA = Math.sin(this.visualAnimT * sp) * 0.8;
            legB = Math.sin(this.visualAnimT * sp + Math.PI) * 0.8;
        } else if (this.aiState === 'flee') {
            const sp = 0.013 + (this.moveSpeed / 2800);
            bob = Math.abs(Math.sin(this.visualAnimT * sp)) * (this.kind === 'elk' ? 3.6 : 2.8);
            sway = Math.sin(this.visualAnimT * sp * 0.7) * 0.14;
            legA = Math.sin(this.visualAnimT * sp) * 1.1;
            legB = Math.sin(this.visualAnimT * sp + Math.PI) * 1.1;
        } else {
            bob = Math.sin((t + this.flyPhase) * 3.1) * 0.8;
            sway = Math.sin((t + this.flyPhase) * 2.2) * 0.05;
        }

        this.visualRoot.setRotation(baseRot + sway * fx);
        this.visualRoot.y -= bob;

        if (this.kind === 'crow') {
            const flap = Math.sin((t + this.flyPhase) * (this.aiState === 'flee' ? 14 : 9.5)) * (this.aiState === 'idle' ? 0.38 : 0.62);
            if (this.visualWings.length >= 2) {
                this.visualWings[0].setRotation(-0.9 + flap).setScale(1, 1);
                this.visualWings[1].setRotation(0.9 - flap).setScale(1, 1);
            }
            this.visualRoot.setRotation(Math.sin((t + this.flyPhase) * 3.0) * 0.08);
        } else if (this.kind === 'snake') {
            const baseWave = (this.aiState === 'flee' ? 0.75 : 0.48);
            const freq = this.aiState === 'flee' ? 8 : 5;
            const pulse = (Math.sin((t + this.flyPhase) * (this.aiState === 'flee' ? 2.6 : 1.9)) + 1) * 0.5;
            const wave = baseWave * (pulse * pulse);
            for (let i = 0; i < this.visualSegments.length; i++) {
                const seg = this.visualSegments[i];
                const k = i / Math.max(1, this.visualSegments.length - 1);
                const ang = Math.sin((t * freq) - k * 2.2) * wave;
                seg.setRotation(ang * 0.12);
                seg.setPosition(-i * 10, Math.sin((t * freq) - k * 2.2) * (1.8 + wave * 1.8));
            }
            if (this.visualHead) {
                const headBob = Math.sin((t * freq) + 1.2) * (0.6 + wave * 1.2);
                this.visualHead.setPosition(12, headBob).setRotation(Math.sin((t * freq) + 0.5) * 0.04);
            }
            if (this.visualSnakeTongue && this.visualHead) {
                const flick = (Math.sin((t + this.flyPhase) * 9.5) + 1) * 0.5;
                const a = (this.aiState === 'flee' ? 0.6 : 0.4) * flick;
                this.visualSnakeTongue.setAlpha(a);
                this.visualSnakeTongue.setPosition(this.visualHead.x + 18, this.visualHead.y + 6);
                this.visualSnakeTongue.setRotation(this.visualHead.rotation * 0.5);
            }
        } else if (this.kind === 'scorpion') {
            const pace = this.aiState === 'flee' ? 0.030 : (this.aiState === 'walk' ? 0.020 : 0.010);
            const step = Math.sin(this.visualAnimT * pace);
            for (let i = 0; i < this.visualLegs.length; i++) {
                const leg = this.visualLegs[i];
                const side = (i % 2 === 0) ? 1 : -1;
                const phase = (i % 6) * 0.55;
                const s0 = Math.sin(this.visualAnimT * pace + phase);
                leg.setRotation((step * 0.25 + s0 * 0.18) * side);
            }

            if (this.visualClaws.length >= 2) {
                const o = (Math.sin((t + this.flyPhase) * (this.aiState === 'idle' ? 2.6 : 4.8)) + 1) * 0.5;
                const open = (this.aiState === 'flee' ? 0.62 : 0.42) * o;
                this.visualClaws[0].setRotation(-0.35 - open);
                this.visualClaws[1].setRotation(0.35 + open);
            }

            if (this.visualTailParts.length > 0) {
                const curl = this.aiState === 'flee' ? 0.95 : (this.aiState === 'walk' ? 0.70 : 0.45);
                const wig = Math.sin((t + this.flyPhase) * (this.aiState === 'flee' ? 8.5 : 5.5)) * 0.08;
                for (let i = 0; i < this.visualTailParts.length; i++) {
                    const part = this.visualTailParts[i];
                    const k = i / Math.max(1, this.visualTailParts.length - 1);
                    part.setRotation((curl * (0.55 + k * 0.55) + wig * (1 - k)) * fx);
                }
            }
        } else {
            if (this.visualLegs.length >= 4) {
                if (this.kind === 'rabbit') {
                    const hop = Math.max(0, Math.sin(this.visualAnimT * (this.aiState === 'flee' ? 0.024 : 0.018)));
                    const lift = hop * hop;
                    this.visualLegs[0].setRotation(legB * 0.65).setY(12 + lift * -2.0);
                    this.visualLegs[1].setRotation(legB * 0.65).setY(12 + lift * -2.0);
                    this.visualLegs[2].setRotation(legA).setY(14 + lift * -6.0);
                    this.visualLegs[3].setRotation(legA).setY(14 + lift * -6.0);
                } else {
                    this.visualLegs[0].setRotation(legA).setY(12 + Math.max(0, -Math.sin(this.visualAnimT * 0.02)) * 2.0);
                    this.visualLegs[1].setRotation(legB).setY(12 + Math.max(0, Math.sin(this.visualAnimT * 0.02)) * 2.0);
                    this.visualLegs[2].setRotation(legB).setY(12 + Math.max(0, -Math.sin(this.visualAnimT * 0.02)) * 2.0);
                    this.visualLegs[3].setRotation(legA).setY(12 + Math.max(0, Math.sin(this.visualAnimT * 0.02)) * 2.0);
                }
            } else if (this.visualLegs.length >= 2) {
                this.visualLegs[0].setRotation(legA);
                this.visualLegs[1].setRotation(-legA);
            }
            if (this.visualHead) {
                const headRot = (-sway * 0.55 + Math.sin((t + this.flyPhase) * 2.8) * 0.02) * fx;
                this.visualHead.setRotation(headRot);
            }
            if (this.visualTail) {
                const tailAmp = this.aiState === 'flee' ? 0.42 : 0.28;
                this.visualTail.setRotation(Math.sin((t + this.flyPhase) * (this.aiState === 'flee' ? 9.5 : 6.5)) * tailAmp * fx);
            }
        }
    }

    private stopCreatureVoiceSfx() {
        this.mainScene.audio.stopExclusive(this.voiceSfxId, 60);
    }

    destroy(fromScene?: boolean) {
        this.stopCreatureVoiceSfx();
        this.visualRoot?.destroy();
        this.visualRoot = undefined;
        this.visualParts = [];
        this.visualLegs = [];
        this.visualWings = [];
        this.visualSegments = [];
        super.destroy(fromScene);
    }

    private getFleeSpeedRange(): { min: number; max: number } {
        switch (this.kind) {
            case 'crow':
                return { min: 170, max: 260 };
            case 'rabbit':
                return { min: 180, max: 280 };
            case 'snake':
                return { min: 120, max: 180 };
            case 'scorpion':
                return { min: 95, max: 150 };
            default:
                return { min: 130, max: 220 };
        }
    }

    private ensureFleeSpeed(forceRefresh: boolean = false) {
        const range = this.getFleeSpeedRange();
        if (
            forceRefresh ||
            !Number.isFinite(this.moveSpeed) ||
            this.moveSpeed < range.min
        ) {
            this.moveSpeed = Phaser.Math.FloatBetween(range.min, range.max);
        }
    }

    private pickState() {
        if (this.aiState === 'flee') {
            // Calm down eventually
            if (Math.random() > 0.7) {
                this.aiState = 'idle';
                this.stateTimer = this.scene.time.now + Phaser.Math.Between(1000, 3000);
            } else {
                this.stateTimer = this.scene.time.now + Phaser.Math.Between(500, 1500);
            }
            return;
        }

        const roll = Math.random();
        const idleP = this.kind === 'snake' ? 0.25 : (this.kind === 'scorpion' ? 0.3 : 0.4);
        if (roll < idleP) {
            this.aiState = 'idle';
            this.stateTimer = this.scene.time.now + Phaser.Math.Between(1000, 4000);
        } else {
            this.aiState = 'walk';
            this.moveDir = Math.random() > 0.5 ? 1 : -1;
            if (this.kind === 'snake') {
                this.moveSpeed = 70 + Math.random() * 95;
                this.stateTimer = this.scene.time.now + Phaser.Math.Between(2500, 6000);
            } else if (this.kind === 'scorpion') {
                this.moveSpeed = 55 + Math.random() * 85;
                this.stateTimer = this.scene.time.now + Phaser.Math.Between(2000, 5200);
            } else {
                this.moveSpeed = (this.kind === 'rabbit' ? (90 + Math.random() * 120) : (60 + Math.random() * 110));
                this.stateTimer = this.scene.time.now + Phaser.Math.Between(2000, 5000);
            }
            if (this.kind === 'rabbit') this.rabbitHopNextAt = 0;
        }
    }

    private checkForDanger() {
        // Simple proximity check for explosions or tanks
        // Note: For performance, we might not want to check every frame against everything.
        // Instead, rely on takeDamage being called by explosions.
        
        // Check player distance
        if (this.mainScene.player && this.mainScene.player.chassis.active) {
            const d = Phaser.Math.Distance.Between(this.x, this.y, this.mainScene.player.chassis.x, this.mainScene.player.chassis.y);
            const panicR = this.kind === 'crow' ? 520 : (this.kind === 'snake' ? 460 : (this.kind === 'scorpion' ? 260 : 300));
            if (d < panicR && this.aiState !== 'flee') {
                this.fleeFrom(this.mainScene.player.chassis.x);
            }
        }
    }

    public fleeFrom(sourceX: number) {
        this.aiState = 'flee';
        this.moveDir = this.x < sourceX ? -1 : 1;
        this.stateTimer = this.scene.time.now + 3000;
        this.ensureFleeSpeed(true);

        const body = this.body as Phaser.Physics.Arcade.Body | undefined;
        if (body) {
            const kickMul = this.kind === 'crow' ? 2.5 : (this.kind === 'rabbit' ? 1.35 : 1.0);
            const kick = this.moveDir * this.moveSpeed * kickMul;
            if (Math.abs(body.velocity.x) < Math.abs(kick) * 0.65) {
                body.setVelocityX(kick);
            }
            if (this.kind === 'rabbit' && (body.blocked.down || body.touching.down)) {
                body.setVelocityY(Math.min(body.velocity.y, -260));
            }
        }

        const now = this.scene.time.now;
        if (now > this.fleeSfxUntil) {
            this.fleeSfxUntil = now + 8000;
            this.mainScene.audio.playFolderExclusive(this.voiceSfxId, `environment/forest/point_3d/creatures/${this.kind}/flee/sfx`, { worldX: this.x, worldY: this.y, volume: 0.8, cooldownMs: 0 });
        }

        if (this.kind === 'rabbit') this.rabbitHopNextAt = 0;
    }

    public takeDamage(amount: number, source: 'shell' | 'bullet' | 'mg' | 'collision' | 'other' = 'other') {
        if (this.aiState === 'dead') return;
        this.hp -= amount;
        if (this.hp <= 0) {
            this.die(source);
        } else {
            this.fleeFrom(this.x + (Math.random() > 0.5 ? 100 : -100));
        }
    }

    private die(source: 'shell' | 'bullet' | 'mg' | 'collision' | 'other') {
        this.aiState = 'dead';
        this.setData('dead', true);
        this.stopCreatureVoiceSfx();
        this.mainScene.awardEventPoints('special', '大自然毁灭者', 60, '猎杀小动物');
        const body = this.body as Phaser.Physics.Arcade.Body | undefined;
        if (body) {
            body.setVelocity(0, 0);
            body.checkCollision.none = true;
            body.setEnable(false);
        }

        const scene = this.mainScene;
        const x = this.x;
        const y = this.groundY || this.y;
        if (source === 'shell' || source === 'mg' || source === 'collision') {
            scene.audio.playFolder('weapon/common/killed_humans_and_animals_by_shell/sfx', { worldX: x, worldY: y, volume: 0.95, cooldownMs: 0 });
        }
        scene.addBloodStain(x, y);

        const meatCount = this.kind === 'rabbit' ? Phaser.Math.Between(6, 10) : Phaser.Math.Between(10, 16);
        const scale = this.kind === 'rabbit' ? 1.0 : 1.25;
        const vMul = this.kind === 'rabbit' ? 0.95 : 1.15;

        const spawnFragment = (tex: string, sc: number) => {
            const d = scene.debrisGroup.get(x + Phaser.Math.Between(-10, 10), y - Phaser.Math.Between(6, 24), tex);
            if (!d) return;
            d.setActive(true).setVisible(true).setDepth(20).setAlpha(1).setScale(sc);
            const db = d.body as Phaser.Physics.Arcade.Body | undefined;
            db?.setEnable(true).setImmovable(false).setAllowGravity(true).setAllowRotation(true);
            db?.setAngularDrag(500).setDrag(200, 100);
            db?.setVelocity(Phaser.Math.Between(-520, 520) * vMul, Phaser.Math.Between(-620, -180) * vMul);
            d.setAngularVelocity(Phaser.Math.Between(-1600, 1600));
            d.setData('sleeping', false);
            scene.tweens.add({ targets: d, alpha: 0, delay: 10000, duration: 4000, onComplete: () => d.destroy() });
        };

        for (let i = 0; i < meatCount; i++) spawnFragment('meat_chunk', Phaser.Math.FloatBetween(0.85, 1.15) * scale);

        this.destroy();
    }
}
