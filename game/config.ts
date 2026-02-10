
import Phaser from 'phaser';
import { MainScene } from './MainScene';
import { MenuScene } from './MenuScene';
import { UIScene } from './UIScene';
import { AudioNoticeScene } from './AudioNoticeScene';

const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
const renderResolution = isAndroid ? Math.min(3, Math.max(1.5, dpr * 1.15)) : 1;

export const GameConfig = ({
  type: Phaser.AUTO,
  parent: 'phaser-game',
  resolution: renderResolution,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 1000 },
      debug: false
    }
  },
  input: {
    activePointers: 6
  },
  scene: [AudioNoticeScene, MenuScene, MainScene, UIScene],
  render: {
    pixelArt: false,
    antialias: true,
    antialiasGL: true,
    roundPixels: false
  }
} as any) as Phaser.Types.Core.GameConfig;
