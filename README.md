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

## Character Kit (2D characters for Claude)
Design a character once and every later call stays on-model:
- `create_character`: master design (or your approved images) plus turnaround, expression, hand/paw and action-pose sheets.
- `pose_character`: any pose, expression or prop, as a transparent PNG or on a background.
- `animate_character`: 22 preset actions (walk/run cycles, jump, drink, throw, talk…), custom movement, or motion copied from a reference video. Cycles loop seamlessly (the start frame is reused as the end frame). The default green screen is keyed out into **transparent PNG frames, a sprite sheet (+ JSON) and a GIF**, ready for a 2D engine.
- `export_character_parts`: splits the character into body-part layers for cut-out rigging.
- `export_frames`: turns any video into a frames zip and sprite sheet.

The hub needs `ffmpeg` and `zip` for exports (both included in the Docker image).

## MCP tools
`create_character`, `list_characters`, `get_character`, `list_character_actions`, `pose_character`, `animate_character`, `export_character_parts`, `export_frames`, `list_models`, `get_presets`, `generate`, `generate_variations`, `create_storyboard`, `get_job`, `list_jobs`, `upload_from_url`, `favorite_job`.

Not affiliated with Higgsfield. The keystore in `app/android/keystore` is only for personal sideloading. Replace it (and set `KEYSTORE_PASSWORD`) before any Play Store release.
