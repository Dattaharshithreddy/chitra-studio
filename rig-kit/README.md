# rig-kit: animate 2D cartoon characters from one drawing

This turns a finished character drawing (for example, from an AI image tool) into a **bone-rigged Rive animation**. It exports MP4, GIF and a transparent sprite sheet. It's free, with no AI video: the character stays exactly as drawn.

Approved test (Nov 2026): the "checked shirt + dhoti" man, with a wave loop and a cheer.

## Setup (once)
```bash
cd rig-kit
npm install                        # rive-mcp-server (free, commercial use OK) + MCP SDK
pip install numpy scipy pillow     # needs ffmpeg and a Chromium (Playwright) for rendering
```

## Steps per pose
1. **Get the art right first.** Use a plain white background and a full body. For a character that changes pose, generate **all poses in ONE image** (a pose sheet). AI tools redraw the face differently in separate images, and the face must match in every pose.
2. **Write a config** (copy `examples/wave.json`). All coordinates are pixels in the image (after `crop_x`):
   - `feet`, `neck`: anchor points. `head_box`: the area that holds the head.
   - `arms.<name>`: `region` (box around that arm), `seed` (a point on the arm's skin), `sh` / `el` / `hand` (shoulder inside the sleeve, elbow, hand tip), optional `cut` (a diagonal line when the arm touches an ear or the face).
   - `pockets`: boxes where trapped white background (between raised arms and the neck) should be removed.
   - `eyes`: boxes for the blink eyelids. `skin_px`: a skin pixel, used for the eyelid colour.
   - `anims[].channels`: `root` (squash: scaleY offset), `head` (degrees), `up_<arm>` / `lo_<arm>` (degrees from the rest pose). Each channel is a keyframe list `[frame, value, easing?]`, or `{"cycles","amp","phase"}` for a seamless loop. 60 fps.
3. `python3 rig.py examples/my.json`, then **open `out/<name>_seg.png` and check it**: each arm, the head and the body must be separate, solid colours with no stray bits.
4. `node client.mjs riv_create @examples/out/<name>.args.json`
5. Check frames: `node client.mjs riv_render_frame '{"path":"examples/out/<name>.riv","animation":"<anim>","time":0.4}'`. Zoom in on the joints.
6. `./export.sh examples/out/<name>.riv <anim> <seconds>` gives the MP4 (plays on phones), GIF and sprite sheet + JSON.

## Lessons (why it's built this way)
- **Never stretch a shirt past about 45° of arm lift.** A raised arm needs a drawing where the arm is already up, so the sleeve and folds are drawn correctly. Stretching one drawing tears or warps the shirt. Professional cut-out animation uses pose swaps for the same reason.
- **Separate arms by colour** (skin vs cloth), not by hand-drawn lines. Fingers that outlines split off get merged by distance to the hand.
- **The pale anti-alias rim** from the white background must move with the arm, or it leaves a ghost outline.
- **Arms are meshes skinned to two bones**, so elbows bend smoothly. Keep the shoulder rotation small (a few degrees) and do the big moves at the elbow.
- **Eyelids are skin-coloured shapes** shown for 6 frames per blink.
- **Phones may not play GIFs.** Always deliver MP4 too.

Character art is not committed (public repo). Put the image next to the config locally.
