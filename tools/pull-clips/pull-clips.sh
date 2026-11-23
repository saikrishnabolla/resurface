#!/usr/bin/env bash
# pull-clips.sh: download and cut clips from YouTube or Instagram.
#
# Usage:
#   ./pull-clips.sh CLIPS_FILE [OUTPUT_DIR]
#   cat clips.txt | ./pull-clips.sh - my-run
#
# CLIPS_FILE has one clip per line, pipe separated:
#   name|source|start|end
#
#   name    output file name, without .mp4
#   source  YouTube or Instagram URL (safest), or any URL yt-dlp supports.
#           Bare IDs: prefix yt: or ig: (yt:rYGg2nYZvLI, ig:DUoooY2Ee9z).
#           A bare ID with no prefix uses DEFAULT_PLATFORM (youtube).
#   start   seconds (16.5), mm:ss (01:05) or hh:mm:ss(.ms). Blank = 0
#   end     same formats. Blank = to the end of the video (whole video)
#
# Blank lines and lines starting with # are ignored.
#
# Output: OUTPUT_DIR/<name>.mp4 for each clip, plus OUTPUT_DIR/<dir>.zip.
# Default OUTPUT_DIR: ~/Downloads/clips/<clips file name>
#
# Env options:
#   DEFAULT_PLATFORM=instagram  treat bare IDs as Instagram codes
#   PAD=3          seconds of padding fetched around YouTube sections
#   KEEP_SOURCES=1 keep downloaded source files in OUTPUT_DIR/.sources
#   NO_ZIP=1       skip the zip
#   NO_OPEN=1      do not open the folder when finished (macOS)
#   COOKIES_FROM_BROWSER=chrome  pass browser cookies to yt-dlp
#                                (often needed for Instagram)

set -uo pipefail

PAD="${PAD:-3}"
DEFAULT_PLATFORM="${DEFAULT_PLATFORM:-youtube}"

die() { echo "Error: $*" >&2; exit 1; }

for bin in yt-dlp ffmpeg awk; do
  command -v "$bin" >/dev/null 2>&1 || die "$bin not found. Install with: brew install yt-dlp ffmpeg"
done

[ $# -ge 1 ] || { sed -n '2,30p' "$0"; exit 1; }

clips_file="$1"
if [ "$clips_file" = "-" ]; then
  tmp_in="$(mktemp)"; cat > "$tmp_in"; clips_file="$tmp_in"; run_name="clips"
else
  [ -f "$clips_file" ] || die "clips file not found: $clips_file"
  base="$(basename "$clips_file")"; run_name="${base%.*}"
fi
clips_file="$(cd "$(dirname "$clips_file")" && pwd)/$(basename "$clips_file")"

out_dir="${2:-$HOME/Downloads/clips/$run_name}"
mkdir -p "$out_dir" || die "cannot create $out_dir"
out_dir="$(cd "$out_dir" && pwd)"
src_dir="$out_dir/.sources"
mkdir -p "$src_dir"

ytdlp_extra=()
[ -n "${COOKIES_FROM_BROWSER:-}" ] && ytdlp_extra+=(--cookies-from-browser "$COOKIES_FROM_BROWSER")

# Convert 16.5, 01:05, 1:02:03.25 to seconds. Empty stays empty.
to_seconds() {
  local t="${1// /}"
  [ -z "$t" ] && { echo ""; return; }
  echo "$t" | awk -F: '{
    s = 0
    for (i = 1; i <= NF; i++) {
      if ($i !~ /^[0-9]+(\.[0-9]+)?$/) { print "ERR"; exit }
      s = s * 60 + $i
    }
    printf "%.3f\n", s
  }'
}

# Decide platform and canonical URL. Prints "platform|key|url".
resolve_source() {
  local s="${1// /}"
  case "$s" in
    *instagram.com/*)
      local code; code="$(echo "$s" | sed -E 's#.*/(reel|reels|p|tv)/([^/?]+).*#\2#')"
      echo "instagram|ig-$code|https://www.instagram.com/reel/$code/" ;;
    *youtube.com/*|*youtu.be/*)
      local id; id="$(echo "$s" | sed -E 's#.*(v=|youtu\.be/|shorts/|embed/|live/)([A-Za-z0-9_-]{11}).*#\2#')"
      echo "youtube|yt-$id|https://www.youtube.com/watch?v=$id" ;;
    http*://*)
      local key; key="url-$(printf '%s' "$s" | cksum | awk '{print $1}')"
      echo "other|$key|$s" ;;
    yt:*|youtube:*)
      local id="${s#*:}"; echo "youtube|yt-$id|https://www.youtube.com/watch?v=$id" ;;
    ig:*|instagram:*)
      local code="${s#*:}"; echo "instagram|ig-$code|https://www.instagram.com/reel/$code/" ;;
    *)
      if [ "$DEFAULT_PLATFORM" = "instagram" ]; then
        echo "instagram|ig-$s|https://www.instagram.com/reel/$s/"
      else
        echo "youtube|yt-$s|https://www.youtube.com/watch?v=$s"
      fi ;;
  esac
}

# Download the whole source once and reuse it for every clip.
fetch_full() {
  local key="$1" url="$2" existing
  existing="$(find "$src_dir" -maxdepth 1 -name "$key.*" ! -name '*.part' | head -1)"
  if [ -n "$existing" ]; then echo "$existing"; return 0; fi
  yt-dlp ${ytdlp_extra[@]+"${ytdlp_extra[@]}"} -f "bv*+ba/b" --merge-output-format mp4 \
    -o "$src_dir/$key.%(ext)s" "$url" </dev/null >&2 || return 1
  find "$src_dir" -maxdepth 1 -name "$key.*" ! -name '*.part' | head -1
}

# Accurate re-encoded cut. $3 start offset in file, $4 duration (blank = to end).
cut_clip() {
  local input="$1" output="$2" ss="$3" dur="$4"
  local args=(-nostdin -hide_banner -loglevel error -y -ss "$ss" -i "$input")
  [ -n "$dur" ] && args+=(-t "$dur")
  ffmpeg "${args[@]}" -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 192k \
    -movflags +faststart "$output"
}

ok=0; failed=()
line_no=0
while IFS= read -r line || [ -n "$line" ]; do
  line_no=$((line_no + 1))
  line="${line%$'\r'}"
  case "$line" in ''|\#*) continue ;; esac

  IFS='|' read -r name source start end <<<"$line"
  name="$(echo "$name" | sed -E 's/^ +| +$//g; s#[/:]#-#g')"
  [ -n "$name" ] && [ -n "${source// /}" ] || { echo "Line $line_no: need name|source, skipping"; failed+=("line $line_no"); continue; }

  s="$(to_seconds "${start:-}")"; e="$(to_seconds "${end:-}")"
  if [ "$s" = "ERR" ] || [ "$e" = "ERR" ]; then
    echo "Line $line_no ($name): bad time '$start' / '$end', skipping"; failed+=("$name"); continue
  fi
  [ -z "$s" ] && s="0.000"
  dur=""
  if [ -n "$e" ]; then
    dur="$(awk -v a="$s" -v b="$e" 'BEGIN { printf "%.3f", b - a }')"
    if awk -v d="$dur" 'BEGIN { exit !(d <= 0) }'; then
      echo "Line $line_no ($name): end is not after start, skipping"; failed+=("$name"); continue
    fi
  fi

  IFS='|' read -r platform key url <<<"$(resolve_source "$source")"
  out="$out_dir/$name.mp4"
  echo ""
  echo "==> $name  [$platform]  ${start:-0} to ${end:-end}"

  if [ "$platform" = "youtube" ] && [ -n "$dur" ]; then
    # Fetch only a padded section, then trim accurately with ffmpeg.
    fs="$(awk -v a="$s" -v p="$PAD" 'BEGIN { x = a - p; if (x < 0) x = 0; printf "%.3f", x }')"
    fe="$(awk -v b="$e" -v p="$PAD" 'BEGIN { printf "%.3f", b + p }')"
    sec_base="$src_dir/$key-$fs-$fe"
    section="$(find "$src_dir" -maxdepth 1 -name "$(basename "$sec_base").*" ! -name '*.part' | head -1)"
    if [ -z "$section" ]; then
      yt-dlp ${ytdlp_extra[@]+"${ytdlp_extra[@]}"} -f "bv*+ba/b" --merge-output-format mp4 \
        --download-sections "*$fs-$fe" -o "$sec_base.%(ext)s" "$url" </dev/null \
        && section="$(find "$src_dir" -maxdepth 1 -name "$(basename "$sec_base").*" ! -name '*.part' | head -1)"
    fi
    if [ -n "$section" ]; then
      offset="$(awk -v a="$s" -v f="$fs" 'BEGIN { printf "%.3f", a - f }')"
      cut_clip "$section" "$out" "$offset" "$dur" && { ok=$((ok + 1)); continue; }
    fi
    echo "   Section download failed, falling back to full download"
  fi

  input="$(fetch_full "$key" "$url")"
  if [ -z "$input" ]; then
    echo "   Download failed: $url"; failed+=("$name"); continue
  fi
  if cut_clip "$input" "$out" "$s" "$dur"; then
    ok=$((ok + 1))
  else
    echo "   ffmpeg cut failed"; failed+=("$name")
  fi
done < "$clips_file"

if [ -n "${tmp_in:-}" ]; then rm -f "$tmp_in"; fi
if [ -z "${KEEP_SOURCES:-}" ]; then rm -rf "$src_dir"; fi

zip_path=""
if [ -z "${NO_ZIP:-}" ] && [ "$ok" -gt 0 ] && command -v zip >/dev/null 2>&1; then
  zip_path="$out_dir/$(basename "$out_dir").zip"
  rm -f "$zip_path"
  (cd "$out_dir" && zip -qj "$zip_path" ./*.mp4)
fi

echo ""
echo "Done: $ok clip(s) in $out_dir"
[ -n "$zip_path" ] && echo "Zip: $zip_path"
if [ "${#failed[@]}" -gt 0 ]; then
  echo "Failed (${#failed[@]}): ${failed[*]}"
fi

if [ -z "${NO_OPEN:-}" ] && command -v open >/dev/null 2>&1 && [ "$(uname)" = "Darwin" ]; then
  open "$out_dir"
fi

[ "${#failed[@]}" -eq 0 ]
