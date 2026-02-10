
const fs = require('fs');
const path = require('path');

function makeKeyForUrl(url) {
    let h = 2166136261;
    for (let i = 0; i < url.length; i++) {
      h ^= url.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `sfx_${(h >>> 0).toString(16)}`;
}

const root = path.join(__dirname, 'public', 'sfx');

function walk(dir) {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            walk(fullPath);
        } else {
            const rel = path.relative(root, fullPath).replace(/\\/g, '/');
            const url = `sfx/${rel}`;
            const key = makeKeyForUrl(url);
            console.log(`${key} -> ${url}`);
        }
    });
}

walk(root);
