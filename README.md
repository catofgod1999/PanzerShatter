制作：LicseL



## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Zeabur 部署音效延迟优化

- 项目已内置两层优化：
  - 关键音效优先预热 + 后台渐进式预加载（减少首发音效卡顿）
  - `Caddyfile` 对 `/sfx/*` 启用长期缓存（降低重复访问延迟）

- 如果你在 Zeabur 使用 Caddy 静态部署：
  - 确保部署时使用仓库根目录下的 `Caddyfile`
  - 保证 `dist` 内容映射到 Caddy 的静态目录（如 `/usr/share/caddy`）

- 推荐额外开启 Zeabur CDN 或将服务部署到用户更近区域，可进一步降低首包和首播延迟。
使用Ai模型：Gemini、Gpt、Claude、Suno。
