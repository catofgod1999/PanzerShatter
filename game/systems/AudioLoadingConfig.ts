export type AudioLoadingPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface AudioLoadingRule {
  pattern: string | RegExp;
  priority: AudioLoadingPriority;
  samplesCount: number | 'all';
  description: string;
}

export const AUDIO_LOADING_RULES: AudioLoadingRule[] = [
  // P0: load before entering battle.
  {
    pattern: /^bgm\/forest\/(non_combat|combat)\/sfx$/,
    priority: 'P0',
    samplesCount: 'all',
    description: 'Core forest BGM for early gameplay'
  },
  {
    pattern: /^environment\/forest\/ambient_2d\/forest_loop\/sfx$/,
    priority: 'P0',
    samplesCount: 'all',
    description: 'Core forest ambient loop'
  },
  {
    pattern: /^weapon\/standard\/fire\/sfx$/,
    priority: 'P0',
    samplesCount: 3,
    description: 'High-frequency standard fire'
  },
  {
    pattern: /^weapon\/standard\/explosion\/sfx$/,
    priority: 'P0',
    samplesCount: 3,
    description: 'High-frequency standard explosion'
  },
  {
    pattern: /^weapon\/standard\/ground_hit_forest\/sfx$/,
    priority: 'P0',
    samplesCount: 3,
    description: 'High-frequency standard ground hit'
  },
  {
    pattern: /^weapon\/standard\/reverb_forest_after_explosion\/sfx$/,
    priority: 'P0',
    samplesCount: 3,
    description: 'High-frequency standard reverb'
  },
  {
    pattern: /^vehicle\/player_soviet\/(idle_engine_loop|cruise\/engine_loop|startup|shutdown|rise|rise_start)\//,
    priority: 'P0',
    samplesCount: 'all',
    description: 'Player tank core SFX'
  },

  // P1: load in gameplay background.
  {
    pattern: /^bgm\//,
    priority: 'P1',
    samplesCount: 'all',
    description: 'Remaining BGM'
  },
  {
    pattern: /^environment\/forest\/ambient_2d\//,
    priority: 'P1',
    samplesCount: 'all',
    description: 'Remaining ambient 2D loops'
  },
  {
    pattern: /^weapon\/(armor_piercing_shell|he|incendiary|mortar|nuke|heavy_machine_gun|spg_mortar|torpedo|tracking_missile)\//,
    priority: 'P1',
    samplesCount: 1,
    description: 'Other weapon families'
  },
  {
    pattern: /^weapon\/standard\/(hit_vehicle|flight_loop)\/sfx$/,
    priority: 'P1',
    samplesCount: 1,
    description: 'Secondary standard weapon SFX'
  },
  {
    pattern: /^vehicle\/player_soviet\/(boost|fall|shell_switch|aim_hold|cruise\/(mechanical_loop|tire_forest_loop))\//,
    priority: 'P1',
    samplesCount: 1,
    description: 'Secondary player tank SFX'
  },
  {
    pattern: /^vehicle\/enemy_[^\/]+\/(idle_engine_loop|cruise|Fire)\//,
    priority: 'P1',
    samplesCount: 1,
    description: 'Enemy vehicle core SFX'
  },
  {
    pattern: /^vehicle\/helicopter\//,
    priority: 'P1',
    samplesCount: 1,
    description: 'Helicopter SFX'
  },

  // P2: medium priority.
  {
    pattern: /^environment\/forest\/point_3d\/creatures\//,
    priority: 'P2',
    samplesCount: 1,
    description: 'Creature SFX'
  },
  {
    pattern: /^environment\/forest\/point_3d\/static\//,
    priority: 'P2',
    samplesCount: 1,
    description: 'Static object SFX'
  },
  {
    pattern: /^infantry\//,
    priority: 'P2',
    samplesCount: 1,
    description: 'Infantry SFX'
  },
  {
    pattern: /^vehicle\/enemy_[^\/]+\/cookoff\//,
    priority: 'P2',
    samplesCount: 1,
    description: 'Enemy cookoff SFX'
  },
  {
    pattern: /^vehicle\/(Lake_fall|land_submarine)\//,
    priority: 'P2',
    samplesCount: 1,
    description: 'Generic vehicle SFX'
  },

  // P3: on-demand only.
  {
    pattern: /.*/,
    priority: 'P3',
    samplesCount: 0,
    description: 'On-demand SFX'
  }
];
