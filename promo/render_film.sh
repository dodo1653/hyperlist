# usage: bash render_film.sh <url> <frames_dir> <dur> <music.wav> <out.mp4>   (120 fps -> 2-frame blend -> 60 fps, the reference's frame rate)
U=$1; D=$2; DUR=$3; M=$4; O=$5; N=$(python -c "print(int($DUR*120))")
rm -rf $D
for i in $(seq 1 15); do n=$(ls $D 2>/dev/null | wc -l); [ $n -ge $N ] && break; from=$(python -c "print($n/120)"); node /d/cooks/pitwall/render.mjs "$U" $D 120 $from > $D.log 2>&1; done
ffmpeg -y -loglevel error -framerate 120 -i $D/f%05d.jpg -i $M -vf "tmix=frames=2:weights='1 1',framestep=2,format=yuv420p" -r 60 -c:v libx264 -crf 17 -preset slow -maxrate 20M -bufsize 40M -c:a aac -b:a 192k -shortest $O
ffprobe -v error -show_entries format=duration,size -of csv=p=0 $O
