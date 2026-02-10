import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: './',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'panzer-sfx-manifest',
          resolveId(id) {
            if (id === 'virtual:sfx-manifest') return '\0virtual:sfx-manifest';
            return null;
          },
          load(id) {
            if (id !== '\0virtual:sfx-manifest') return null;
            const rootPublicSfx = path.resolve(__dirname, 'public', 'sfx');
            const folders: Record<string, string[]> = {};
            const exts = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.webm', '.flac', '.mp4', '.opus', '.wma']);
            const toPosix = (p: string) => p.split(path.sep).join('/');
            const walk = (dir: string) => {
              let entries: fs.Dirent[] = [];
              try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
              } catch {
                return;
              }
              for (const e of entries) {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) walk(full);
                else if (e.isFile()) {
                  const ext = path.extname(e.name).toLowerCase();
                  if (!exts.has(ext)) continue;
                  const rel = toPosix(path.relative(rootPublicSfx, full));
                  const relDir = toPosix(path.dirname(rel)).replace(/^\.\/?/, '');
                  const folderKey = relDir === '.' ? '' : relDir;
                  // Encode the URL components to handle special characters (spaces, Chinese, etc.)
                  const urlParts = rel.split('/').map(part => encodeURIComponent(part));
                  const url = `sfx/${urlParts.join('/')}`;
                  (folders[folderKey] ??= []).push(url);
                }
              }
            };
            walk(rootPublicSfx);
            for (const k of Object.keys(folders)) folders[k].sort();
            const code = `export default ${JSON.stringify({ folders }, null, 2)};`;
            return code;
          },
          handleHotUpdate(ctx) {
            if (ctx.file.includes(`${path.sep}public${path.sep}sfx${path.sep}`)) {
              const mod = ctx.server.moduleGraph.getModuleById('\0virtual:sfx-manifest');
              if (mod) ctx.server.moduleGraph.invalidateModule(mod);
            }
          }
        }
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
