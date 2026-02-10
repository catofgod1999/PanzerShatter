
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { GameConfig } from './game/config';

const readAndroidViewport = () => {
  if (typeof window === 'undefined') return { w: 0, h: 0 };
  const vv = window.visualViewport;
  const w = Math.max(0, Math.round(vv?.width ?? window.innerWidth));
  const h = Math.max(0, Math.round(vv?.height ?? window.innerHeight));
  return { w, h };
};

type TacticalMapPoint = { x: number; y: number };
type TacticalMapRect = { x: number; y: number; w: number; h: number };
type TacticalMapPayload = {
  visible: boolean;
  mapId?: string;
  viewRect?: TacticalMapRect;
  worldWidth?: number;
  player?: TacticalMapPoint;
  enemies?: TacticalMapPoint[];
  allies?: TacticalMapPoint[];
  enemyVehicles?: TacticalMapPoint[];
  enemyInfantry?: TacticalMapPoint[];
  allyInfantry?: TacticalMapPoint[];
  buildings?: { x: number; y: number; w: number; h: number; ruined?: boolean }[];
  lakes?: { x0: number; x1: number; waterY: number }[];
  terrain?: TacticalMapPoint[];
  preFinalSafeX?: number | null;
};

type PerfSectionStat = { id: string; ms: number };
type PerfPanelPayload = {
  visible: boolean;
  fps?: number;
  frameMs?: number;
  sections?: PerfSectionStat[];
  top3?: PerfSectionStat[];
};

type AppUiAnchorId = 'hud-title' | 'hud-status' | 'cooldown-panel' | 'tactical-map';
type AppUiAnchor = { x: number; y: number };
type AppUiLayoutState = Partial<Record<AppUiAnchorId, AppUiAnchor>>;

const APP_UI_LAYOUT_KEY = 'panzer-app-ui-layout-v1';
const UI_PRESETS = ['tankstar', 'new', 'default', 'compact', 'wide'] as const;
const ANDROID_DEFAULT_LAYOUT_MIGRATION_KEY = 'panzer-android-default-layout-v3';
const ANDROID_DEFAULT_LAYOUT_CODE = 'eyJ2IjozLCJwcmVzZXQiOiJ0YW5rc3RhciIsInVpRWRpdCI6MCwiY3VzdG9tTGF5b3V0cyI6eyJ0YW5rc3RhciI6IntcImFjdGlvbi1ib29zdFwiOntcInhcIjowLjg4MzUxMTcyNTQ2MTc2OTgsXCJ5XCI6MC44NjU0NjM4ODQ5NTQ0NzY5fSxcInRhbmtzdGFyLW1vdmVcIjp7XCJ4XCI6MC4xMTAyMTgxNTM4NDEwMzM5OCxcInlcIjowLjgwNzIwMjg2MDk4MDI0MDJ9LFwic2hlbGwtc3dpdGNoXCI6e1wieFwiOjAuODg4OTgxNDkxOTU5Mjk5OCxcInlcIjowLjMwODQ1NDkwOTE0NjE0MTU0fSxcImFjdGlvbi1tZ1wiOntcInhcIjowLjE5MzI2ODg2NjM2NTMwODI0LFwieVwiOjAuNjI5ODM3MjEzOTM5MjQ5NH0sXCJzaGVsbC1udWtlXCI6e1wieFwiOjAuMTc2NzIxMjI1NTQ4MTgzNzMsXCJ5XCI6MC40ODk2ODQxMjc4NDAyMzE1fSxcInNoZWxsLW1vcnRhclwiOntcInhcIjowLjExNzA0MjgxNTkxMTgxNjMsXCJ5XCI6MC41NTc1ODg5ODk1MDYzMDE4fSxcImFjdGlvbi1saWZ0XCI6e1wieFwiOjAuOTU4MTM0MDIwNjE4NTU2NyxcInlcIjowLjg2NDE2fX0ifSwiYXBwVWlMYXlvdXQiOnsidGFjdGljYWwtbWFwIjp7IngiOi0wLjAwMTM3MTI0NjAyMzI3NjQwODIsInkiOi0wLjA0OTU1OTY4Mjk4NjgxNTE3fSwiaHVkLXN0YXR1cyI6eyJ4IjotMC4xMTU5NzgyOTc3NzIxMzk5LCJ5IjotMC4wOTMxOTI1MTA2MjkxMjQ5NH0sImNvb2xkb3duLXBhbmVsIjp7IngiOjAuMTU4OTUxOTI0MjkyMzU1NzcsInkiOi0wLjIxOTIyMzc2OTYyNzE1MTMyfX19';

const encodeLayoutCode = (payload: any): string => {
  try {
    const json = JSON.stringify(payload);
    const raw = window.btoa(unescape(encodeURIComponent(json)));
    return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } catch {
    return '';
  }
};

const decodeLayoutCode = (code: string): any | null => {
  try {
    const normalized = code.trim().replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4;
    const b64 = pad === 0 ? normalized : (normalized + '='.repeat(4 - pad));
    const json = decodeURIComponent(escape(window.atob(b64)));
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const App: React.FC = () => {
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const [started, setStarted] = useState(false);
  const [gameReady, setGameReady] = useState(false);
  const [defeat, setDefeat] = useState<{ visible: boolean; score?: number; tankKills?: number; infantryKills?: number; saved?: number; x?: number; y?: number }>({ visible: false });
  const gameRef = useRef<Phaser.Game | null>(null);
  const [androidFrame, setAndroidFrame] = useState<{ w: number; h: number }>(() => {
    if (!isAndroid) return { w: 0, h: 0 };
    return readAndroidViewport();
  });

  const defaultZoomKey = 'panzer-default-zoom';
  const zoomMin = isAndroid ? 0.2 : 0.1;
  const zoomMax = 1.5;
  const [defaultZoom, setDefaultZoom] = useState<number>(() => {
    const v = Number.parseFloat(window.localStorage.getItem(defaultZoomKey) ?? '');
    if (Number.isFinite(v)) return Math.round(Math.min(zoomMax, Math.max(zoomMin, v)) * 10) / 10;
    return isAndroid ? 0.5 : 0.8;
  });

  const uiLayoutKey = 'panzer-ui-layout';
  const [uiLayout, setUiLayout] = useState<string>(() => {
    const v = window.localStorage.getItem(uiLayoutKey);
    if (v === 'tankstar' || v === 'new' || v === 'compact' || v === 'wide' || v === 'default') return v;
    return isAndroid ? 'tankstar' : 'default';
  });

  const uiEditKey = 'panzer-ui-edit';
  const [uiEditMode, setUiEditMode] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(uiEditKey) === '1';
    } catch {
      return false;
    }
  });

  const uiButtonScaleKey = 'panzer-ui-button-scale';
  const [uiButtonScale, setUiButtonScale] = useState<number>(() => {
    try {
      const raw = Number.parseFloat(window.localStorage.getItem(uiButtonScaleKey) ?? '');
      if (Number.isFinite(raw)) return Math.round(Math.min(1.35, Math.max(0.75, raw)) * 100) / 100;
    } catch {}
    return 1;
  });

  const aimSensitivityKey = 'panzer-aim-sensitivity';
  const [aimSensitivity, setAimSensitivity] = useState<number>(() => {
    try {
      const raw = Number.parseFloat(window.localStorage.getItem(aimSensitivityKey) ?? '');
      if (Number.isFinite(raw)) return Math.round(Math.min(2.0, Math.max(0.5, raw)) * 100) / 100;
    } catch {}
    return 1;
  });


  const [appUiLayout, setAppUiLayout] = useState<AppUiLayoutState>(() => {
    try {
      const raw = window.localStorage.getItem(APP_UI_LAYOUT_KEY);
      if (!raw) return {};
      const data = JSON.parse(raw) as AppUiLayoutState;
      if (!data || typeof data !== 'object') return {};
      return data;
    } catch {
      return {};
    }
  });
  const [layoutCodeInput, setLayoutCodeInput] = useState('');
  const dragUiRef = useRef<{ id: AppUiAnchorId; startX: number; startY: number; originX: number; originY: number } | null>(null);

  const startGame = useCallback(async () => {
    if (gameRef.current) return;
    const game = new Phaser.Game(GameConfig);
    gameRef.current = game;
    setGameReady(true);
  }, []);

  const [menuOpen, setMenuOpen] = useState(false);
  const [testRoomOpen, setTestRoomOpen] = useState(false);
  const [testRoomCommand, setTestRoomCommand] = useState('');
  const [testRoomEnemyAttack, setTestRoomEnemyAttack] = useState(true);
  const [testRoomEnemyMove, setTestRoomEnemyMove] = useState(true);
  const [testRoomNoCooldown, setTestRoomNoCooldown] = useState(false);
  const [activeSounds, setActiveSounds] = useState<{ key: string; url: string; volume: number; loop: boolean }[]>([]);
  const [perfPanel, setPerfPanel] = useState<{ enabled: boolean; fps: number; frameMs: number; sections: PerfSectionStat[] }>({
    enabled: false,
    fps: 0,
    frameMs: 0,
    sections: []
  });
  const setLayoutEditEnabled = useCallback((enabled: boolean, closeMenu: boolean = false) => {
    setUiEditMode(enabled);
    try { window.localStorage.setItem(uiEditKey, enabled ? '1' : '0'); } catch {}
    window.dispatchEvent(new CustomEvent('panzer-ui-edit', { detail: { enabled } }));
    if (closeMenu) setMenuOpen(false);
  }, [uiEditKey]);

  const tacticalMapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tacticalMapData, setTacticalMapData] = useState<TacticalMapPayload>({ visible: false });

  useEffect(() => {
    const onAudioDebug = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail && Array.isArray(ce.detail.sounds)) {
        setActiveSounds(ce.detail.sounds);
      }
    };
    window.addEventListener('panzer-audio-debug', onAudioDebug as EventListener);
    return () => {
      window.removeEventListener('panzer-audio-debug', onAudioDebug as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = window.location.search;
    const enabled = !!(import.meta.env.DEV || q.includes('perf=1') || q.includes('debug_perf=1') || window.localStorage.getItem('panzer-dev-perf') === '1');
    if (!enabled) return;

    setPerfPanel(prev => ({ ...prev, enabled: true }));
    const onPerfStats = (e: Event) => {
      const ce = e as CustomEvent;
      const d = (ce.detail ?? {}) as PerfPanelPayload;
      if (d.visible === false) return;
      const sections = Array.isArray(d.sections) ? d.sections.slice(0, 6) : [];
      setPerfPanel({
        enabled: true,
        fps: Number.isFinite(Number(d.fps)) ? Number(d.fps) : 0,
        frameMs: Number.isFinite(Number(d.frameMs)) ? Number(d.frameMs) : 0,
        sections
      });
    };

    window.addEventListener('panzer-perf-stats', onPerfStats as EventListener);
    return () => {
      window.removeEventListener('panzer-perf-stats', onPerfStats as EventListener);
    };
  }, []);

  useEffect(() => {
    const onTacticalMapData = (e: Event) => {
      const ce = e as CustomEvent;
      const d = (ce.detail ?? {}) as TacticalMapPayload;
      if (!d || d.visible !== true) {
        setTacticalMapData({ visible: false });
        return;
      }
      setTacticalMapData({
        visible: true,
        mapId: d.mapId,
        viewRect: d.viewRect,
        worldWidth: d.worldWidth,
        player: d.player,
        enemies: Array.isArray(d.enemies) ? d.enemies : [],
        allies: Array.isArray(d.allies) ? d.allies : [],
        enemyVehicles: Array.isArray(d.enemyVehicles) ? d.enemyVehicles : [],
        enemyInfantry: Array.isArray(d.enemyInfantry) ? d.enemyInfantry : [],
        allyInfantry: Array.isArray(d.allyInfantry) ? d.allyInfantry : [],
        buildings: Array.isArray(d.buildings) ? d.buildings : [],
        lakes: Array.isArray(d.lakes) ? d.lakes : [],
        terrain: Array.isArray(d.terrain) ? d.terrain : [],
        preFinalSafeX: d.preFinalSafeX ?? null
      });
    };

    window.addEventListener('panzer-tactical-map-data', onTacticalMapData as EventListener);
    return () => {
      window.removeEventListener('panzer-tactical-map-data', onTacticalMapData as EventListener);
    };
  }, []);

  const getUiViewport = useCallback(() => {
    if (isAndroid) {
      const w = Math.max(1, androidFrame.w || window.innerWidth || 1);
      const h = Math.max(1, androidFrame.h || window.innerHeight || 1);
      return { w, h };
    }
    return { w: Math.max(1, window.innerWidth || 1), h: Math.max(1, window.innerHeight || 1) };
  }, [isAndroid, androidFrame.w, androidFrame.h]);

  const getAppUiTransform = useCallback((id: AppUiAnchorId): React.CSSProperties => {
    const p = appUiLayout[id];
    if (!p) return {};
    const { w, h } = getUiViewport();
    return {
      transform: `translate(${Math.round(p.x * w)}px, ${Math.round(p.y * h)}px)`
    };
  }, [appUiLayout, getUiViewport]);

  const onStartAppUiDrag = useCallback((id: AppUiAnchorId, e: React.PointerEvent) => {
    if (!isAndroid || !uiEditMode) return;
    e.preventDefault();
    e.stopPropagation();
    const entry = appUiLayout[id] ?? { x: 0, y: 0 };
    dragUiRef.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      originX: entry.x,
      originY: entry.y
    };
  }, [isAndroid, uiEditMode, appUiLayout]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragUiRef.current;
      if (!d) return;
      const { w, h } = getUiViewport();
      const dx = (e.clientX - d.startX) / w;
      const dy = (e.clientY - d.startY) / h;
      setAppUiLayout(prev => ({
        ...prev,
        [d.id]: {
          x: Phaser.Math.Clamp(d.originX + dx, -0.45, 0.45),
          y: Phaser.Math.Clamp(d.originY + dy, -0.45, 0.45)
        }
      }));
    };

    const onUp = () => {
      dragUiRef.current = null;
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove as any);
      window.removeEventListener('pointerup', onUp as any);
      window.removeEventListener('pointercancel', onUp as any);
    };
  }, [getUiViewport]);

  useEffect(() => {
    try {
      window.localStorage.setItem(APP_UI_LAYOUT_KEY, JSON.stringify(appUiLayout));
    } catch {}
  }, [appUiLayout]);

  useEffect(() => {
    const next = Math.round(Math.min(1.35, Math.max(0.75, uiButtonScale)) * 100) / 100;
    try { window.localStorage.setItem(uiButtonScaleKey, next.toFixed(2)); } catch {}
    window.dispatchEvent(new CustomEvent('panzer-ui-button-scale', { detail: { scale: next } }));
  }, [uiButtonScale, uiButtonScaleKey]);

  useEffect(() => {
    const next = Math.round(Math.min(2.0, Math.max(0.5, aimSensitivity)) * 100) / 100;
    try { window.localStorage.setItem(aimSensitivityKey, next.toFixed(2)); } catch {}
    window.dispatchEvent(new CustomEvent('panzer-aim-sensitivity', { detail: { value: next } }));
  }, [aimSensitivity, aimSensitivityKey]);


  useEffect(() => {
    if (!isAndroid) return;
    try {
      if (window.localStorage.getItem(ANDROID_DEFAULT_LAYOUT_MIGRATION_KEY) === '1') return;
      const data = decodeLayoutCode(ANDROID_DEFAULT_LAYOUT_CODE);
      if (!data || typeof data !== 'object') return;

      const preset = 'tankstar';
      if (data.customLayouts && typeof data.customLayouts === 'object') {
        for (const key of UI_PRESETS) {
          const raw = (data.customLayouts as any)[key];
          if (typeof raw === 'string') {
            try { window.localStorage.setItem(`panzer-ui-custom-layout-v2:${key}`, raw); } catch {}
          }
        }
      }

      if (data.appUiLayout && typeof data.appUiLayout === 'object') {
        setAppUiLayout(data.appUiLayout as AppUiLayoutState);
      }

      setUiLayout(preset);
      setUiEditMode(false);
      try { window.localStorage.setItem(uiLayoutKey, preset); } catch {}
      try { window.localStorage.setItem(uiEditKey, '0'); } catch {}
      window.dispatchEvent(new CustomEvent('panzer-ui-layout', { detail: { layout: preset } }));
      window.dispatchEvent(new CustomEvent('panzer-ui-layout-reset', { detail: { preset } }));
      window.localStorage.setItem(ANDROID_DEFAULT_LAYOUT_MIGRATION_KEY, '1');
    } catch {}
  }, [isAndroid, uiEditKey, uiLayoutKey]);

  const exportLayoutCode = useCallback(() => {
    const customLayouts: Record<string, string> = {};
    for (const preset of UI_PRESETS) {
      const k = `panzer-ui-custom-layout-v2:${preset}`;
      const raw = window.localStorage.getItem(k);
      if (raw) customLayouts[preset] = raw;
    }

    const payload = {
      v: 3,
      preset: uiLayout,
      uiEdit: uiEditMode ? 1 : 0,
      customLayouts,
      appUiLayout
    };

    const code = encodeLayoutCode(payload);
    if (!code) return;
    setLayoutCodeInput(code);
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(code).catch(() => {});
    }
  }, [uiLayout, uiEditMode, appUiLayout]);

  const importLayoutCode = useCallback(() => {
    const data = decodeLayoutCode(layoutCodeInput);
    if (!data || typeof data !== 'object') return;

    const nextPreset = typeof data.preset === 'string' ? data.preset : uiLayout;
    if (nextPreset === 'tankstar' || nextPreset === 'new' || nextPreset === 'default' || nextPreset === 'compact' || nextPreset === 'wide') {
      setUiLayout(nextPreset);
      try { window.localStorage.setItem(uiLayoutKey, nextPreset); } catch {}
      window.dispatchEvent(new CustomEvent('panzer-ui-layout', { detail: { layout: nextPreset } }));
    }

    if (data.customLayouts && typeof data.customLayouts === 'object') {
      for (const preset of UI_PRESETS) {
        const raw = (data.customLayouts as any)[preset];
        if (typeof raw === 'string') {
          try { window.localStorage.setItem(`panzer-ui-custom-layout-v2:${preset}`, raw); } catch {}
        }
      }
    }

    if (data.appUiLayout && typeof data.appUiLayout === 'object') {
      setAppUiLayout(data.appUiLayout as AppUiLayoutState);
    }

    window.dispatchEvent(new CustomEvent('panzer-ui-layout-reset', { detail: { preset: nextPreset } }));
  }, [layoutCodeInput, uiLayout, uiLayoutKey]);

  useEffect(() => {
    const onResetAppUi = () => setAppUiLayout({});
    window.addEventListener('panzer-app-ui-reset', onResetAppUi);
    return () => window.removeEventListener('panzer-app-ui-reset', onResetAppUi);
  }, []);

  const returnToMainMenu = useCallback(() => {
    setMenuOpen(false);
    setDefeat({ visible: false });
    setStarted(false);
    setTestRoomOpen(false);
    setTestRoomCommand('');
    setTacticalMapData({ visible: false });
    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
    }
    setGameReady(false);
  }, []);

  useEffect(() => {
    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  const handleStart = useCallback(async () => {
    if (started) return;
    await startGame();
    setStarted(true);
    const scoreEl = document.getElementById('total-score');
    if (scoreEl) scoreEl.innerText = '\u603b\u79ef\u5206: 0';
  }, [started, startGame]);

  const tryUnlockAudio = useCallback(async () => {
    const sound = (gameRef.current as any)?.sound;
    const ctx: AudioContext | undefined = sound?.context;
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {}
    }
    if (typeof sound?.unlock === 'function') {
      try {
        sound.unlock();
      } catch {}
    }
  }, []);

  useEffect(() => {
    handleStart();
  }, [handleStart]);

  useEffect(() => {
    const onFirstGesture = () => {
      tryUnlockAudio();
    };
    window.addEventListener('pointerdown', onFirstGesture, { passive: true });
    window.addEventListener('touchstart', onFirstGesture, { passive: true });
    window.addEventListener('keydown', onFirstGesture, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture as any);
      window.removeEventListener('touchstart', onFirstGesture as any);
      window.removeEventListener('keydown', onFirstGesture as any);
    };
  }, [tryUnlockAudio]);

  useEffect(() => {
    if (!isAndroid) return;
    const update = () => {
      setAndroidFrame(readAndroidViewport());
    };
    const vv = window.visualViewport;
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, [isAndroid]);

  useEffect(() => {
    if (!isAndroid) return;
    if (!gameRef.current) return;
    if (androidFrame.w <= 0 || androidFrame.h <= 0) return;
    try {
      (gameRef.current as any).scale?.resize?.(androidFrame.w, androidFrame.h);
      (gameRef.current as any).scale?.refresh?.();
    } catch {}
  }, [isAndroid, androidFrame.w, androidFrame.h]);

  useEffect(() => {
    if (!gameReady || !gameRef.current) return;
    const canvas = gameRef.current.canvas;
    if (!canvas) return;
    const prevent = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 2 || e.buttons === 2) prevent(e);
    };
    const onPointerMove = (e: PointerEvent) => {
      if ((e.buttons & 2) !== 0) prevent(e);
    };
    canvas.style.touchAction = 'none';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    (canvas.style as any).imageRendering = 'auto';
    (canvas.style as any).backfaceVisibility = 'hidden';
    (canvas.style as any).webkitFontSmoothing = 'antialiased';
    (canvas.style as any).textRendering = 'geometricPrecision';
    canvas.addEventListener('contextmenu', prevent);
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    return () => {
      canvas.removeEventListener('contextmenu', prevent);
      canvas.removeEventListener('pointerdown', onPointerDown as any);
      canvas.removeEventListener('pointermove', onPointerMove as any);
    };
  }, [gameReady, isAndroid]);

  useEffect(() => {
    const onDefeat = (e: Event) => {
      const ce = e as CustomEvent;
      const d = (ce.detail ?? {}) as any;
      setDefeat({ visible: true, score: d.score, tankKills: d.tankKills, infantryKills: d.infantryKills, saved: d.saved, x: d.x, y: d.y });
      setTacticalMapData({ visible: false });
    };
    const onClear = () => setDefeat({ visible: false });
    window.addEventListener('panzer-defeat', onDefeat as EventListener);
    window.addEventListener('panzer-defeat-clear', onClear);
    return () => {
      window.removeEventListener('panzer-defeat', onDefeat as EventListener);
      window.removeEventListener('panzer-defeat-clear', onClear);
    };
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const ce = e as CustomEvent;
      const d = (ce.detail ?? {}) as any;
      setTestRoomOpen(true);
      if (typeof d.enemyAttack === 'boolean') setTestRoomEnemyAttack(d.enemyAttack);
      if (typeof d.enemyMove === 'boolean') setTestRoomEnemyMove(d.enemyMove);
      if (typeof d.noCooldown === 'boolean') setTestRoomNoCooldown(d.noCooldown);
    };
    const onClose = () => {
      setTestRoomOpen(false);
      setTestRoomCommand('');
    };
    window.addEventListener('panzer-testroom-open', onOpen as EventListener);
    window.addEventListener('panzer-testroom-close', onClose as EventListener);
    return () => {
      window.removeEventListener('panzer-testroom-open', onOpen as EventListener);
      window.removeEventListener('panzer-testroom-close', onClose as EventListener);
    };
  }, []);

  useEffect(() => {
    const canvas = tacticalMapCanvasRef.current;
    if (!canvas) return;

    const mapWidth = isAndroid ? 170 : 188;
    const mapHeight = isAndroid ? 104 : 114;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    if (canvas.width !== Math.round(mapWidth * dpr) || canvas.height !== Math.round(mapHeight * dpr)) {
      canvas.width = Math.round(mapWidth * dpr);
      canvas.height = Math.round(mapHeight * dpr);
      canvas.style.width = `${mapWidth}px`;
      canvas.style.height = `${mapHeight}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, mapWidth, mapHeight);

    // frame
    ctx.fillStyle = 'rgba(6, 10, 14, 0.82)';
    ctx.fillRect(0, 0, mapWidth, mapHeight);
    ctx.strokeStyle = 'rgba(159, 188, 201, 0.58)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, mapWidth - 1, mapHeight - 1);

    if (!started || tacticalMapData.visible !== true || !tacticalMapData.viewRect) return;

    const view = tacticalMapData.viewRect;
    const toX = (x: number) => ((x - view.x) / Math.max(1, view.w)) * mapWidth;
    const toY = (y: number) => ((y - view.y) / Math.max(1, view.h)) * mapHeight;

    // grid
    ctx.strokeStyle = 'rgba(160, 190, 205, 0.14)';
    for (let i = 1; i < 4; i++) {
      const gx = (mapWidth * i) / 4;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, mapHeight);
      ctx.stroke();
    }
    for (let i = 1; i < 3; i++) {
      const gy = (mapHeight * i) / 3;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(mapWidth, gy);
      ctx.stroke();
    }

    // terrain profile
    const terrain = tacticalMapData.terrain ?? [];
    if (terrain.length > 1) {
      ctx.beginPath();
      ctx.moveTo(toX(terrain[0].x), mapHeight + 2);
      for (const p of terrain) ctx.lineTo(toX(p.x), toY(p.y));
      ctx.lineTo(toX(terrain[terrain.length - 1].x), mapHeight + 2);
      ctx.closePath();
      ctx.fillStyle = 'rgba(88, 110, 90, 0.46)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(164, 198, 170, 0.62)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      const first = terrain[0];
      ctx.moveTo(toX(first.x), toY(first.y));
      for (let i = 1; i < terrain.length; i++) {
        const p = terrain[i];
        ctx.lineTo(toX(p.x), toY(p.y));
      }
      ctx.stroke();
    }

    // lake spans
    for (const l of tacticalMapData.lakes ?? []) {
      const x0 = toX(l.x0);
      const x1 = toX(l.x1);
      const y = toY(l.waterY);
      ctx.strokeStyle = 'rgba(70, 180, 255, 0.82)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }

    const preFinalX = tacticalMapData.preFinalSafeX;
    if (typeof preFinalX === 'number' && Number.isFinite(preFinalX)) {
      const sx = toX(preFinalX);
      if (sx >= 0 && sx <= mapWidth) {
        ctx.strokeStyle = 'rgba(255, 90, 90, 0.78)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, mapHeight);
        ctx.stroke();
      }
    }

    const drawEnemyVehicle = (x: number, y: number) => {
      ctx.fillStyle = 'rgba(255, 68, 68, 0.98)';
      ctx.strokeStyle = 'rgba(55, 8, 8, 0.95)';
      ctx.lineWidth = 1;
      ctx.fillRect(x - 3.6, y - 2.4, 7.2, 4.8);
      ctx.strokeRect(x - 3.6, y - 2.4, 7.2, 4.8);
      ctx.beginPath();
      ctx.moveTo(x + 3.6, y);
      ctx.lineTo(x + 6.0, y);
      ctx.stroke();
    };

    const drawEnemyInfantry = (x: number, y: number) => {
      ctx.strokeStyle = 'rgba(255, 112, 96, 0.98)';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(x - 2.4, y - 2.4);
      ctx.lineTo(x + 2.4, y + 2.4);
      ctx.moveTo(x + 2.4, y - 2.4);
      ctx.lineTo(x - 2.4, y + 2.4);
      ctx.stroke();
    };

    const drawAllyInfantry = (x: number, y: number) => {
      ctx.fillStyle = 'rgba(112, 255, 162, 0.98)';
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(8, 34, 18, 0.95)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 1.3, y);
      ctx.lineTo(x + 1.3, y);
      ctx.moveTo(x, y - 1.3);
      ctx.lineTo(x, y + 1.3);
      ctx.stroke();
    };

    const drawBuilding = (x: number, y: number, bw: number, bh: number, ruined?: boolean) => {
      const halfW = bw * 0.5;
      const halfH = bh * 0.5;
      ctx.fillStyle = ruined ? 'rgba(118, 112, 104, 0.56)' : 'rgba(180, 194, 210, 0.62)';
      ctx.strokeStyle = ruined ? 'rgba(88, 80, 74, 0.72)' : 'rgba(236, 241, 246, 0.76)';
      ctx.lineWidth = 1;
      ctx.fillRect(x - halfW, y - halfH, bw, bh);
      ctx.strokeRect(x - halfW, y - halfH, bw, bh);
      if (ruined) {
        ctx.strokeStyle = 'rgba(76, 70, 64, 0.82)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(x - halfW, y - halfH);
        ctx.lineTo(x + halfW, y + halfH);
        ctx.moveTo(x - halfW, y + halfH);
        ctx.lineTo(x + halfW, y - halfH);
        ctx.stroke();
      }
    };

    const drawPlayer = (x: number, y: number) => {
      ctx.fillStyle = 'rgba(120, 224, 255, 1)';
      ctx.beginPath();
      ctx.moveTo(x, y - 5.4);
      ctx.lineTo(x + 4.8, y + 3.9);
      ctx.lineTo(x, y + 1.9);
      ctx.lineTo(x - 4.8, y + 3.9);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(6, 20, 30, 0.98)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(220, 245, 255, 0.9)';
      ctx.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
    };

    // building markers
    for (const b of tacticalMapData.buildings ?? []) {
      const x = toX(b.x);
      const y = toY(b.y);
      const bw = Math.max(3.2, (b.w / Math.max(1, view.w)) * mapWidth);
      const bh = Math.max(2.6, (b.h / Math.max(1, view.h)) * mapHeight * 0.35);
      if (x + bw * 0.5 < 0 || x - bw * 0.5 > mapWidth || y + bh * 0.5 < 0 || y - bh * 0.5 > mapHeight) continue;
      drawBuilding(x, y, bw, bh, b.ruined);
    }

    const allyInfantry = (tacticalMapData.allyInfantry && tacticalMapData.allyInfantry.length > 0)
      ? tacticalMapData.allyInfantry
      : (tacticalMapData.allies ?? []);
    const enemyInfantry = tacticalMapData.enemyInfantry ?? [];
    const enemyVehicles = tacticalMapData.enemyVehicles ?? [];
    const fallbackEnemies = (enemyInfantry.length === 0 && enemyVehicles.length === 0) ? (tacticalMapData.enemies ?? []) : [];

    for (const a of allyInfantry) {
      const x = toX(a.x);
      const y = toY(a.y);
      if (x < 0 || y < 0 || x > mapWidth || y > mapHeight) continue;
      drawAllyInfantry(x, y);
    }

    for (const e of enemyInfantry) {
      const x = toX(e.x);
      const y = toY(e.y);
      if (x < 0 || y < 0 || x > mapWidth || y > mapHeight) continue;
      drawEnemyInfantry(x, y);
    }

    for (const e of enemyVehicles) {
      const x = toX(e.x);
      const y = toY(e.y);
      if (x < 0 || y < 0 || x > mapWidth || y > mapHeight) continue;
      drawEnemyVehicle(x, y);
    }

    // fallback enemies (old payload compatibility)
    if (fallbackEnemies.length > 0) {
      for (const e of fallbackEnemies) {
        const x = toX(e.x);
        const y = toY(e.y);
        if (x < 0 || y < 0 || x > mapWidth || y > mapHeight) continue;
        drawEnemyVehicle(x, y);
      }
    }

    // player marker
    const p = tacticalMapData.player;
    if (p) {
      const px = toX(p.x);
      const py = toY(p.y);
      drawPlayer(px, py);
    }

    // Chinese legend so each icon type is instantly readable
    const legendH = 18;
    const legendY = mapHeight - legendH;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.46)';
    ctx.fillRect(0, legendY, mapWidth, legendH);
    ctx.font = '9px sans-serif';
    ctx.textBaseline = 'middle';

    const drawLegendItem = (x: number, y: number, label: string, draw: () => void, color = 'rgba(220,230,238,0.92)') => {
      draw();
      ctx.fillStyle = color;
      ctx.fillText(label, x + 6, y + 0.5);
    };

    const row1 = legendY + 5.6;
    const row2 = legendY + 13.2;

    drawLegendItem(6, row1, '\u6211\u65b9', () => drawPlayer(6, row1));
    drawLegendItem(44, row1, '\u654c\u8f66', () => drawEnemyVehicle(44, row1));
    drawLegendItem(82, row1, '\u654c\u5175', () => drawEnemyInfantry(82, row1));
    drawLegendItem(120, row1, '\u53cb\u519b', () => drawAllyInfantry(120, row1));

    drawLegendItem(6, row2, '\u5efa\u7b51', () => drawBuilding(6, row2, 6.6, 4.2, false));
    drawLegendItem(44, row2, '\u5e9f\u589f', () => drawBuilding(44, row2, 6.6, 4.2, true));
    ctx.fillStyle = 'rgba(182, 204, 222, 0.72)';
    ctx.fillText('\u96f7\u8fbe', mapWidth - 22, row2);

  }, [isAndroid, started, tacticalMapData]);

  const androidViewStyle = isAndroid
    ? {
        width: Math.max(1, androidFrame.w),
        height: Math.max(1, androidFrame.h),
        position: 'fixed' as const,
        left: 0,
        top: 0
      }
    : undefined;

  return (
    <div id="game-container" className="relative w-screen h-screen overflow-hidden bg-black">
      <div
        className={`${isAndroid ? '' : 'w-full h-full'} relative bg-zinc-900 overflow-hidden`}
        style={androidViewStyle}
      >
        <div id="phaser-game" className="z-0 w-full h-full" />
        
        <div
          className={`absolute top-0 left-0 w-full h-full pointer-events-none flex flex-col justify-between ${isAndroid ? "px-2 pb-2" : "p-2"}`}
          style={isAndroid ? { paddingTop: "max(env(safe-area-inset-top), 0.35rem)" } : undefined}
        >
          
          <div className={`w-full bg-transparent pointer-events-auto ${isAndroid ? "flex flex-col gap-1.5 px-1 py-1" : "flex flex-row items-center justify-between p-2"}`}>
              <div className={`flex items-center gap-2 ${isAndroid ? "justify-between" : "border-r-2 border-zinc-700/50 pr-2"}`}>
                 <div
                   className={`text-white flex flex-col justify-center ${isAndroid && uiEditMode ? "cursor-move rounded px-1 ring-1 ring-yellow-500/60" : ""}`}
                   onPointerDown={(e) => onStartAppUiDrag('hud-title', e)}
                   style={getAppUiTransform('hud-title')}
                 >
                   <h1 className="text-sm font-bold uppercase tracking-tighter text-yellow-500 leading-none">{'\u7099\u70ed\u91d1\u5c5e'}</h1>
                 </div>
                 <button 
                    className={`bg-zinc-700 hover:bg-zinc-600 text-white rounded border border-zinc-500 ${isAndroid ? "text-[11px] px-2 py-1" : "text-[12px] px-2 py-1"}`}
                    onClick={() => setMenuOpen(true)}
                 >
                   [ 菜单 / MENU ]
                 </button>
              </div>
              
              <div
                 className={`text-right px-2 ${isAndroid ? "" : "border-r-2 border-zinc-700/50"} ${isAndroid && uiEditMode ? "cursor-move rounded ring-1 ring-yellow-500/60" : ""}`}
                 onPointerDown={(e) => onStartAppUiDrag('hud-status', e)}
                 style={getAppUiTransform('hud-status')}
              >
                 <div id="hull-health" className={`font-bold text-white leading-none ${isAndroid ? "text-[13px]" : "text-sm"}`}>状态: 100%</div>
                 <div id="ammo-status" className={`text-yellow-400 font-mono leading-none mt-0.5 ${isAndroid ? "text-[11px]" : "text-[12px]"}`}>弹药: 标准弹</div>
                 <div id="total-score" className={`text-emerald-400 font-mono leading-none mt-0.5 ${isAndroid ? "text-[11px]" : "text-[12px]"}`}>总积分: 0</div>
              </div>

              <div
                id="cooldown-panel"
                className={`flex ${isAndroid ? "w-full items-center justify-start gap-1.5 overflow-x-auto pb-0.5" : "flex-1 flex-wrap items-center justify-end gap-2 overflow-hidden"} ${isAndroid && uiEditMode ? "cursor-move rounded ring-1 ring-yellow-500/60" : ""}`}
                onPointerDown={(e) => onStartAppUiDrag('cooldown-panel', e)}
                style={getAppUiTransform('cooldown-panel')}
              >
                  <div className={`flex flex-col ${isAndroid ? "w-14" : "w-16"} shrink-0`}>
                    <div className={`flex justify-between font-mono text-zinc-200 leading-none mb-0.5 ${isAndroid ? "text-[10px]" : "text-[12px]"}`}>
                      <span>标准</span><span id="cd-std-text">就绪</span>
                    </div>
                    <div className="h-2.5 bg-zinc-800/80 rounded-full overflow-hidden">
                      <div id="cd-std-bar" className="h-full bg-zinc-200 rounded-full" style={{ width: '100%' }} />
                    </div>
                  </div>

                  <div className={`flex flex-col ${isAndroid ? "w-14" : "w-16"} shrink-0`}>
                    <div className={`flex justify-between font-mono text-zinc-200 leading-none mb-0.5 ${isAndroid ? "text-[10px]" : "text-[12px]"}`}>
                      <span>高爆</span><span id="cd-he-text">就绪</span>
                    </div>
                    <div className="h-2.5 bg-zinc-800/80 rounded-full overflow-hidden">
                      <div id="cd-he-bar" className="h-full bg-yellow-500 rounded-full" style={{ width: '100%' }} />
                    </div>
                  </div>

                  <div className={`flex flex-col ${isAndroid ? "w-14" : "w-16"} shrink-0`}>
                    <div className={`flex justify-between font-mono text-zinc-200 leading-none mb-0.5 ${isAndroid ? "text-[10px]" : "text-[12px]"}`}>
                      <span>穿甲</span><span id="cd-ap-text">就绪</span>
                    </div>
                    <div className="h-2.5 bg-zinc-800/80 rounded-full overflow-hidden">
                      <div id="cd-ap-bar" className="h-full bg-cyan-400 rounded-full" style={{ width: '100%' }} />
                    </div>
                  </div>

                  <div className={`flex flex-col ${isAndroid ? "w-14" : "w-16"} shrink-0`}>
                    <div className={`flex justify-between font-mono text-zinc-200 leading-none mb-0.5 ${isAndroid ? "text-[10px]" : "text-[12px]"}`}>
                      <span>燃烧</span><span id="cd-inc-text">就绪</span>
                    </div>
                    <div className="h-2.5 bg-zinc-800/80 rounded-full overflow-hidden">
                      <div id="cd-inc-bar" className="h-full bg-orange-500 rounded-full" style={{ width: '100%' }} />
                    </div>
                  </div>

                  <div className={`flex flex-col ${isAndroid ? "w-14" : "w-16"} shrink-0`}>
                    <div className={`flex justify-between font-mono text-zinc-200 leading-none mb-0.5 ${isAndroid ? "text-[10px]" : "text-[12px]"}`}>
                      <span>迫击</span><span id="cd-mtr-text">就绪</span>
                    </div>
                    <div className="h-2.5 bg-zinc-800/80 rounded-full overflow-hidden">
                      <div id="cd-mtr-bar" className="h-full bg-red-500 rounded-full" style={{ width: '100%' }} />
                    </div>
                  </div>

                  <div className={`flex flex-col ${isAndroid ? "w-20" : "w-24"} shrink-0`}>
                    <div className={`flex justify-between font-mono text-zinc-200 leading-none mb-0.5 ${isAndroid ? "text-[10px]" : "text-[12px]"}`}>
                      <span>机枪</span><span id="cd-mg-text"></span>
                    </div>
                    <div className="h-2.5 bg-zinc-800/80 rounded-full overflow-hidden">
                      <div id="cd-mg-chain" className="h-full flex items-center gap-[1px] px-1">
                        {Array.from({ length: 30 }).map((_, i) => (
                          <div
                            key={i}
                            data-idx={i}
                            className="h-2 w-[2px] rounded-sm bg-zinc-700/70"
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className={`flex flex-col ${isAndroid ? "w-14" : "w-16"} shrink-0`}>
                    <div className={`flex justify-between font-mono text-zinc-200 leading-none mb-0.5 ${isAndroid ? "text-[10px]" : "text-[12px]"}`}>
                      <span>核弹</span><span id="cd-nuk-text">就绪</span>
                    </div>
                    <div className="h-2.5 bg-zinc-800/80 rounded-full overflow-hidden">
                      <div id="cd-nuk-bar" className="h-full bg-fuchsia-500 rounded-full" style={{ width: '100%' }} />
                    </div>
                  </div>
              </div>
          </div>

          <div
            className={`${isAndroid && uiEditMode ? 'pointer-events-auto cursor-move' : 'pointer-events-none'} absolute left-2 z-20`}
            onPointerDown={(e) => onStartAppUiDrag('tactical-map', e)}
            style={{
              top: isAndroid
                ? 'calc(max(env(safe-area-inset-top), 0.35rem) + 64px)'
                : '70px',
              ...getAppUiTransform('tactical-map')
            }}
          >
            <div className={`rounded-md border border-zinc-600/80 bg-black/55 shadow-[0_0_0_1px_rgba(180,200,220,0.08)] ${isAndroid && uiEditMode ? 'ring-1 ring-yellow-500/60' : ''}`}>
              <canvas ref={tacticalMapCanvasRef} />
            </div>
          </div>

          {perfPanel.enabled && (
            <div className="pointer-events-none absolute right-2 top-2 z-40 min-w-[200px] max-w-[280px] rounded border border-emerald-500/30 bg-black/68 p-2 text-[11px] text-emerald-200 shadow-[0_6px_20px_rgba(0,0,0,0.45)]">
              <div className="flex items-center justify-between border-b border-emerald-400/20 pb-1 text-[10px] uppercase tracking-wide text-emerald-300/90">
                <span>Perf</span>
                <span>{perfPanel.fps.toFixed(1)} FPS | {perfPanel.frameMs.toFixed(2)}ms</span>
              </div>
              <div className="mt-1 space-y-0.5 font-mono text-[10px] leading-tight">
                {perfPanel.sections.length === 0 && <div className="text-zinc-400">等待采样...</div>}
                {perfPanel.sections.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-emerald-100/95">
                    <span className="mr-2 truncate">{s.id}</span>
                    <span>{s.ms.toFixed(2)}ms</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isAndroid && started && uiEditMode && (
            <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center">
              <div className="pointer-events-auto w-[min(86vw,360px)] rounded-lg border border-yellow-500/60 bg-black/74 p-3 shadow-[0_10px_28px_rgba(0,0,0,0.55)]">
                <div className="mb-2 flex items-center justify-between text-xs text-zinc-200">
                  <span>虚拟按键大小</span>
                  <span className="font-mono text-yellow-300">{uiButtonScale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.75}
                  max={1.35}
                  step={0.01}
                  value={uiButtonScale}
                  onChange={(e) => {
                    const raw = Number.parseFloat(e.target.value);
                    const next = Math.round(Math.min(1.35, Math.max(0.75, Number.isFinite(raw) ? raw : 1)) * 100) / 100;
                    setUiButtonScale(next);
                  }}
                  className="w-full accent-yellow-500"
                />
                <button
                  className="mt-3 w-full rounded bg-yellow-500 py-2 text-sm font-bold text-black hover:bg-yellow-400 active:bg-yellow-600"
                  onClick={() => setLayoutEditEnabled(false, true)}
                >
                  确认键位
                </button>
              </div>


            </div>
          )}

          {testRoomOpen && (
            <div
              className={`pointer-events-auto self-start bg-black/60 ${isAndroid ? '' : 'backdrop-blur-sm'} border border-zinc-700/60 rounded-md p-3 w-[320px]`}
              onPointerDown={(e) => {
                window.dispatchEvent(new CustomEvent('panzer-testroom-ui-block', { detail: { blocked: true } }));
                e.stopPropagation();
              }}
              onPointerUp={(e) => {
                window.dispatchEvent(new CustomEvent('panzer-testroom-ui-block', { detail: { blocked: false } }));
                e.stopPropagation();
              }}
              onPointerCancel={(e) => {
                window.dispatchEvent(new CustomEvent('panzer-testroom-ui-block', { detail: { blocked: false } }));
                e.stopPropagation();
              }}
              onPointerLeave={() => window.dispatchEvent(new CustomEvent('panzer-testroom-ui-block', { detail: { blocked: false } }))}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-xs font-mono text-yellow-400 mb-2">测试房间</div>

              <div className="flex flex-col gap-2">
                <label className="flex items-center justify-between text-xs text-zinc-200">
                  <span>敌人攻击</span>
                  <input
                    type="checkbox"
                    checked={testRoomEnemyAttack}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setTestRoomEnemyAttack(next);
                      window.dispatchEvent(new CustomEvent('panzer-testroom-settings', { detail: { enemyAttack: next } }));
                    }}
                    className="accent-yellow-500"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-zinc-200">
                  <span>敌人移动</span>
                  <input
                    type="checkbox"
                    checked={testRoomEnemyMove}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setTestRoomEnemyMove(next);
                      window.dispatchEvent(new CustomEvent('panzer-testroom-settings', { detail: { enemyMove: next } }));
                    }}
                    className="accent-yellow-500"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-zinc-200">
                  <span>无CD</span>
                  <input
                    type="checkbox"
                    checked={testRoomNoCooldown}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setTestRoomNoCooldown(next);
                      window.dispatchEvent(new CustomEvent('panzer-testroom-settings', { detail: { noCooldown: next } }));
                    }}
                    className="accent-yellow-500"
                  />
                </label>

                <div className="flex flex-col gap-1 mt-1">
                  <div className="text-[11px] text-zinc-300">
                    生成单位：输入代码（例如 ENEMY_MAUS / ALLY_ENGINEER / FOX / HELICOPTER / BASE）
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={testRoomCommand}
                      onChange={(e) => setTestRoomCommand(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        const cmd = testRoomCommand.trim();
                        if (!cmd) return;
                        window.dispatchEvent(new CustomEvent('panzer-testroom-command', { detail: { command: cmd } }));
                        setTestRoomCommand('');
                      }}
                      className="flex-1 bg-zinc-900/70 text-zinc-100 border border-zinc-700 rounded px-2 py-1 text-sm font-mono outline-none focus:border-yellow-500"
                      placeholder="ENEMY_MAUS"
                    />
                    <button
                      className="bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600 text-black font-bold px-3 rounded text-sm"
                      onClick={() => {
                        const cmd = testRoomCommand.trim();
                        if (!cmd) return;
                        window.dispatchEvent(new CustomEvent('panzer-testroom-command', { detail: { command: cmd } }));
                        setTestRoomCommand('');
                      }}
                    >
                      生成
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    className="flex-1 bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-800 text-white font-bold py-2 rounded text-sm"
                    onClick={() => window.dispatchEvent(new Event('panzer-testroom-clear'))}
                  >
                    Clear
                  </button>
                </div>

                {activeSounds.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-zinc-700/50 flex flex-col gap-1 max-h-40 overflow-y-auto">
                    <div className="text-[10px] font-mono text-zinc-400">Playing Sounds ({activeSounds.length})</div>
                    {activeSounds.map((s, i) => (
                      <div key={i} className="flex flex-col text-[10px] font-mono text-zinc-500 border-b border-zinc-800/50 pb-1 last:border-0">
                        <div className="flex justify-between">
                           <span className="text-yellow-500/70 truncate mr-2" title={s.key}>{s.key}</span>
                           <span className="text-zinc-600 shrink-0">{Math.round(s.volume * 100)}%</span>
                        </div>
                        <div className="text-zinc-600 truncate text-[9px]" title={s.url}>
                          {s.url}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Menu Modal */}
      {menuOpen && (
        <div className={`absolute inset-0 z-[100] flex items-center justify-center bg-black/80 ${isAndroid ? '' : 'backdrop-blur-sm'} animate-in fade-in duration-200 pointer-events-auto`}>
          <div className={`bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl flex flex-col gap-4 ${isAndroid ? "w-[88vw] max-w-[360px] max-h-[86vh] overflow-y-auto p-4" : "w-64 p-6"}`}> 
             <h2 className="text-white text-lg font-bold text-center border-b border-zinc-700 pb-2">菜单</h2>

             <div className="flex flex-col gap-2">
               <div className="flex items-center justify-between text-xs text-zinc-200">
                 <span>默认缩放视野</span>
                 <span className="font-mono">{defaultZoom.toFixed(1)}</span>
               </div>
               <input
                 type="range"
                 min={zoomMin}
                 max={zoomMax}
                 step={0.1}
                 value={(zoomMin + zoomMax) - defaultZoom}
                 onChange={(e) => {
                   const raw = Number.parseFloat(e.target.value);
                   const next = Math.round(Math.min(zoomMax, Math.max(zoomMin, (zoomMin + zoomMax - raw))) * 10) / 10;
                   setDefaultZoom(next);
                   try { window.localStorage.setItem(defaultZoomKey, next.toFixed(1)); } catch {}
                   window.dispatchEvent(new CustomEvent('panzer-default-zoom', { detail: { zoom: next } }));
                 }}
                 className="w-full accent-yellow-500"
               />
             </div>

             <div className="flex flex-col gap-2">
               <div className="flex items-center justify-between text-xs text-zinc-200">
                 <span>瞄准灵敏度</span>
                 <span className="font-mono">{aimSensitivity.toFixed(2)}x</span>
               </div>
               <input
                 type="range"
                 min={0.5}
                 max={2.0}
                 step={0.05}
                 value={aimSensitivity}
                 onChange={(e) => {
                   const raw = Number.parseFloat(e.target.value);
                   const next = Math.round(Math.min(2.0, Math.max(0.5, raw)) * 100) / 100;
                   setAimSensitivity(next);
                 }}
                 className="w-full accent-yellow-500"
               />
             </div>

             {isAndroid && (
             <div className="flex flex-col gap-2">
               <div className="flex items-center justify-between text-xs text-zinc-200">
                 <span>操作方式</span>
               </div>
               <select
                 value={uiLayout}
                 onChange={(e) => {
                   const raw = e.target.value;
                  const next = raw === 'tankstar' || raw === 'new' || raw === 'compact' || raw === 'wide' ? raw : 'default';
                   setUiLayout(next);
                   try { window.localStorage.setItem(uiLayoutKey, next); } catch {}
                   window.dispatchEvent(new CustomEvent('panzer-ui-layout', { detail: { layout: next } }));
                 }}
                 className="w-full bg-zinc-800 text-zinc-200 border border-zinc-700 rounded px-2 py-1 text-sm"
               >
                <option value="tankstar">手机新版（推荐）</option>
                <option value="new">旧版（摇杆瞄准）</option>
                <option value="default">旧版（全屏点按）- 默认</option>
                <option value="compact">旧版（全屏点按）- 紧凑</option>
                <option value="wide">旧版（全屏点按）- 宽松</option>
               </select>
             </div>
             )}

             {isAndroid && (
             <div className="flex flex-col gap-2">
               <label className="flex items-center justify-between text-xs text-zinc-200">
                 <span>按键布局编辑（UI+虚拟按键）</span>
                 <input
                   type="checkbox"
                   checked={uiEditMode}
                   onChange={(e) => {
                    const enabled = !!e.target.checked;
                    setLayoutEditEnabled(enabled);
                  }}
                   className="accent-yellow-500"
                 />
               </label>
               <div className="text-[11px] text-zinc-400 leading-snug">可拖动：顶部状态、冷却条、小地图与虚拟按键（菜单按钮固定）。</div>
               <button
                 className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 py-2 rounded text-sm"
                 onClick={() => {
                   window.dispatchEvent(new CustomEvent('panzer-ui-layout-reset', { detail: { preset: uiLayout } }));
                 }}
               >
                 重置虚拟按键布局
               </button>
               <button
                 className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 py-2 rounded text-sm"
                 onClick={() => setAppUiLayout({})}
               >
                 重置屏幕UI位置
               </button>
               <div className="grid grid-cols-2 gap-2">
                 <button
                   className="bg-zinc-700 hover:bg-zinc-600 text-white py-2 rounded text-sm"
                   onClick={() => exportLayoutCode()}
                 >
                   导出布局代码
                 </button>
                 <button
                   className="bg-zinc-700 hover:bg-zinc-600 text-white py-2 rounded text-sm"
                   onClick={() => importLayoutCode()}
                 >
                   导入布局代码
                 </button>
               </div>
               <input
                 value={layoutCodeInput}
                 onChange={(e) => setLayoutCodeInput(e.target.value)}
                 placeholder="粘贴布局代码"
                 className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-2 py-1 text-xs font-mono"
               />
             </div>
             )}
             
             <button 
               className="bg-zinc-700 hover:bg-zinc-600 text-white font-bold py-2 rounded"
               onClick={() => returnToMainMenu()}
             >
               返回主菜单
             </button>
             
             <button 
               className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 py-1 rounded text-sm mt-2"
               onClick={() => setMenuOpen(false)}
             >
               取消
             </button>
          </div>
        </div>
      )}

      {/* Defeat Screen */}
      {defeat.visible && (
        <div className={`absolute inset-0 z-50 flex items-center justify-center bg-black/80 ${isAndroid ? '' : 'backdrop-blur-sm'} animate-in fade-in duration-500`}>
          <div className="bg-zinc-900/90 border border-red-900/50 p-8 rounded-lg max-w-lg w-full shadow-2xl text-center relative overflow-hidden">
            <div className="text-sm font-mono tracking-widest text-zinc-300">战败</div>
            <div className="mt-2 text-3xl font-bold">载具已被摧毁</div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-zinc-200">
              <div className="rounded-md bg-black/40 p-3 border border-zinc-800/60">
                <div className="text-[10px] font-mono text-zinc-400">积分</div>
                <div className="text-xl font-bold">{Math.max(0, defeat.score ?? 0)}</div>
              </div>
              <div className="rounded-md bg-black/40 p-3 border border-zinc-800/60">
                <div className="text-[10px] font-mono text-zinc-400">救下战友</div>
                <div className="text-xl font-bold">{Math.max(0, defeat.saved ?? 0)}</div>
              </div>
              <div className="rounded-md bg-black/40 p-3 border border-zinc-800/60">
                <div className="text-[10px] font-mono text-zinc-400">击毁敌方载具</div>
                <div className="text-xl font-bold">{Math.max(0, defeat.tankKills ?? 0)}</div>
              </div>
              <div className="rounded-md bg-black/40 p-3 border border-zinc-800/60">
                <div className="text-[10px] font-mono text-zinc-400">歼敌人数</div>
                <div className="text-xl font-bold">{Math.max(0, defeat.infantryKills ?? 0)}</div>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between">
              <div className="text-xs font-mono text-zinc-400">载具已被摧毁</div>
              <button
                className="px-4 py-2 rounded-md bg-yellow-500 text-black font-bold hover:bg-yellow-400 active:bg-yellow-600"
                onClick={() => returnToMainMenu()}
              >
                返回主菜单
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
