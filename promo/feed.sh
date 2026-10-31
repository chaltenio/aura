#!/usr/bin/env bash
# feed.sh: turn a short clip into a fake phone camera for Chrome (--use-file-for-fake-video-capture).
# Crops to the 3:4 portrait the pages ask for, scales to 720x960, and plays forward then backward so the loop never jumps.
#   promo/feed.sh in.mp4 out.y4m [top] [zoom]
#   top  = where the crop starts, as a fraction of the spare height (default 0.3)
#   zoom = crop width as a fraction of the clip's width, centred (default 1: full width)
set -euo pipefail
in=$1 out=$2 top=${3:-0.3} zoom=${4:-1}
cw="trunc(iw*${zoom}/2)*2" ch="trunc(iw*${zoom}*4/3/2)*2"
ffmpeg -v error -y -i "$in" -filter_complex \
  "[0:v]crop=${cw}:${ch}:(iw-${cw})/2:(ih-${ch})*${top},scale=720:960:flags=lanczos,fps=30,setsar=1,split[f][b];[b]reverse[r];[f][r]concat=n=2:v=1,format=yuv420p[v]" \
  -map "[v]" -f yuv4mpegpipe "$out"
echo "$out: $(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=width,height,nb_read_frames -of csv=p=0 "$out")"
