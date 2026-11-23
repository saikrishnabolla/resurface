#!/bin/bash
# usage: compose.sh <top.mp4> <clip> <posY 0-1> <out.mp4>
set -e
D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$2")
T=$(python3 -c "print(max(0,$D-2))")
HASA=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$2" | head -1)
ffmpeg -v error -y -i "$1" -i "$2" -loop 1 -i "$(dirname "$0")/cta.png" -filter_complex "[1:v]fps=30,scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960:(iw-1080)/2:(ih-960)*$3,setsar=1[b];[0:v]fps=30,setsar=1[t];[t][b]vstack[v];[v][2:v]overlay=x=W-w-28:y=988:enable='gte(t,$T)'[o]" -map "[o]" ${HASA:+-map 1:a} -t "$D" -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart "$4"
