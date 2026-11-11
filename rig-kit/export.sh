#!/usr/bin/env bash
# usage: ./export.sh path/to/char.riv animationName seconds   -> mp4 (phone-friendly), gif, transparent sprite sheet + json
set -e
RIV=$1; ANIM=$2; SECS=${3:-2}; DIR=$(dirname "$RIV"); HERE=$(dirname "$0")
export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}
node "$HERE/client.mjs" riv_render_gif "{\"path\":\"$RIV\",\"animation\":\"$ANIM\",\"duration\":$(python3 -c "print($SECS*2)"),\"fps\":24,\"width\":420,\"background\":\"#ffffff\",\"outPath\":\"$DIR/$ANIM.gif\"}"
node "$HERE/client.mjs" riv_render_sprites "{\"path\":\"$RIV\",\"animation\":\"$ANIM\",\"count\":$(python3 -c "print(int($SECS*12))"),\"duration\":$SECS,\"fps\":12,\"width\":360,\"out\":\"$DIR/${ANIM}_sprites.png\"}"
ffmpeg -v error -y -stream_loop 2 -i "$DIR/$ANIM.gif" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" -c:v libx264 -preset veryfast -crf 20 -movflags +faststart "$DIR/$ANIM.mp4"
echo "done: $DIR/$ANIM.mp4 $DIR/$ANIM.gif $DIR/${ANIM}_sprites.png"
