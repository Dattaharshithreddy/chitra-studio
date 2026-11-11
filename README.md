# Chitra Studio

An Android AI image & video studio in the spirit of Higgsfield. It runs 598 models (Kling, Veo, Seedance, Wan, Sora, Nano Banana, Flux and more) through [Muapi](https://muapi.ai), and has an MCP server so Claude can create inside the same studio.

**Beyond the original:** one-shot **Storyboards** (a consistent character becomes keyframes, then animated shots with a camera move per shot), **variations and model shoot-outs**, 27 **cinematic camera moves**, camera bodies and lenses, controls for every model, a shared gallery that shows what Claude made, and "Animate / Edit this" remixing from any result.

## Pieces
| Folder | What |
|---|---|
| `app/` | Capacitor Android app (`www/` = the UI). CI builds the signed APK and publishes it to GitHub Releases. |
| `server/` | **Chitra Hub**: Muapi proxy, job store, live events, and the **MCP endpoint** at `/mcp/<STUDIO_TOKEN>`. It also serves the same UI in a browser. |
| `shared/` | Model catalog (derived from the MIT-licensed Open-Generative-AI project) plus the presets/payload builder that both parts use. |

## Setup
1. **Deploy the hub.** On Render: New → Blueprint → this repo (it uses `render.yaml`). Set `MUAPI_KEY`, then copy the generated `STUDIO_TOKEN`.
   To run it locally instead: `cd server && npm i && MUAPI_KEY=... STUDIO_TOKEN=... npm start`, plus `cloudflared tunnel --url http://localhost:8787` if you need a public URL.
   Render's free disk is wiped on every redeploy. To keep history, add a persistent disk mounted at `/data`.
2. **Install the APK** from Releases. In the app, open Settings, enter the Hub URL and token, then tap Save & test.
3. **Connect Claude.** In claude.ai, go to Settings → Connectors → Add custom connector and use the URL `https://<hub>/mcp/<STUDIO_TOKEN>`. The app's Settings screen shows this URL with a Copy button.

Direct mode (in Settings) skips the hub and calls Muapi from the phone with your own key. History then stays on the phone, and Claude can't see it.

## MCP tools
`list_models`, `get_presets`, `generate`, `generate_variations`, `create_storyboard`, `get_job`, `list_jobs`, `upload_from_url`, `favorite_job`.

Not affiliated with Higgsfield. The keystore in `app/android/keystore` is only for personal sideloading. Replace it (and set `KEYSTORE_PASSWORD`) before any Play Store release.
