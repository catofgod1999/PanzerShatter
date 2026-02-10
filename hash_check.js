
const urls = [
  'sfx/vehicle/player_soviet/aim_hold/sfx/1.ogg',
  'sfx/vehicle/player_soviet/aim_hold/sfx/2.ogg',
  'sfx/vehicle/player_soviet/aim_hold/sfx/3.ogg',
  'sfx/vehicle/player_soviet/cruise/engine_loop/sfx/Master.ogg',
  'sfx/vehicle/player_soviet/cruise/mechanical_loop/sfx/we.ogg',
  'sfx/vehicle/player_soviet/cruise/tire_forest_loop/sfx/asds.ogg',
  'sfx/vehicle/player_soviet/shell_switch/sfx/1-001.ogg',
  'sfx/vehicle/player_soviet/shell_switch/sfx/1-002.ogg',
  'sfx/vehicle/player_soviet/shell_switch/sfx/1-003.ogg',
  'sfx/vehicle/player_soviet/shell_switch/sfx/1-004.ogg'
];

function makeKeyForUrl(url) {
    let h = 2166136261;
    for (let i = 0; i < url.length; i++) {
      h ^= url.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `sfx_${(h >>> 0).toString(16)}`;
}

urls.forEach(url => {
    console.log(`${makeKeyForUrl(url)} -> ${url}`);
});
