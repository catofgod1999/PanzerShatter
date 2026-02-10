export enum TankType { PLAYER_SOVIET, ENEMY_TIGER, ENEMY_PANZER, ENEMY_STUG, ENEMY_A7V, ENEMY_LUCHS, ENEMY_MAUS, ENEMY_TUMBLEWEED, ENEMY_HUNTER }
export enum ShellType { STANDARD, HE, AP, INCENDIARY, BULLET, MORTAR, NUKE }

export const weaponFolderForShellType = (shellType: ShellType): string => {
  if (shellType === ShellType.STANDARD) return 'standard';
  if (shellType === ShellType.HE) return 'he';
  if (shellType === ShellType.AP) return 'armor_piercing_shell';
  if (shellType === ShellType.INCENDIARY) return 'incendiary';
  if (shellType === ShellType.MORTAR) return 'mortar';
  if (shellType === ShellType.NUKE) return 'nuke';
  return 'standard';
};
