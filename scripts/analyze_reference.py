"""Decode every reference frame; retain measured evidence and contact sheets.

Analysis only: OpenCV / numpy / Pillow are not application dependencies.
Frame indices are zero-based. Brightness statistics describe the video,
not an inferred record of the original user's pointer events.
"""
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "reference"
OUTPUT.mkdir(parents=True, exist_ok=True)
video_path = next((ROOT / "source").glob("*.mp4"))
capture = cv2.VideoCapture(str(video_path))
if not capture.isOpened():
    raise RuntimeError(f"Cannot open {video_path}")
fps = capture.get(cv2.CAP_PROP_FPS)
width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
key_times = [0, .5, 1, 2, 4, 6, 8, 10, 11, 12, 16, 20, 24, 28, 32, 36, 40, 44, 46, 47, 47.5, 48, 48.25, 48.5, 49, 50, (frame_count-1)/fps]
key_frames = {round(t * fps): t for t in key_times}
metrics = []
thumbnails = []
baseline = previous = mask = None
frame_index = 0
while True:
    success, frame = capture.read()
    if not success:
        break
    small = cv2.resize(frame, (739, 360), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32)
    if baseline is None:
        baseline = gray.copy()
        mask = np.ones(gray.shape, dtype=bool)
        # Exclude changing title/subtitle, persistent center mark, bottom watermark.
        mask[140:220, 210:530] = False
        mask[228:258, 353:386] = False
        mask[330:, :] = False
        previous = gray
    difference = np.maximum(gray - baseline, 0)
    values = gray[mask]
    delta = difference[mask]
    metrics.append({
        "frame": frame_index,
        "time": round(frame_index / fps, 6),
        "meanLuma": round(float(values.mean()), 5),
        "trailLumaAboveBaseline": round(float(delta.mean()), 5),
        "changedAreaPercent": round(float((delta > 8).mean() * 100), 5),
        "brightAreaPercent": round(float((values > 55).mean() * 100), 5),
        "frameDifference": round(float(np.abs(gray-previous)[mask].mean()), 5),
    })
    if frame_index in key_frames:
        thumb = cv2.resize(frame, (1478, 720), interpolation=cv2.INTER_AREA)
        cv2.imencode('.jpg', thumb, [cv2.IMWRITE_JPEG_QUALITY, 91])[1].tofile(str(OUTPUT / f"frame-{frame_index:04d}.jpg"))
    if frame_index % 30 == 0 or frame_index == frame_count-1:
        thumb = cv2.cvtColor(cv2.resize(frame, (480, 234), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
        thumbnails.append((frame_index, Image.fromarray(thumb)))
    previous = gray
    frame_index += 1
capture.release()
for page in range((len(thumbnails)+15)//16):
    selected = thumbnails[page*16:(page+1)*16]
    sheet = Image.new('RGB', (1920, 4*260), '#101318')
    draw = ImageDraw.Draw(sheet)
    for slot, (index, thumb) in enumerate(selected):
        x, y = (slot % 4)*480, (slot//4)*260
        sheet.paste(thumb, (x, y))
        draw.text((x+10, y+238), f"{index/fps:06.2f}s / F{index:04d}", fill='#c6d1df')
    sheet.save(OUTPUT / f"contact-{page+1}.jpg", quality=91)
data = {
    "source": video_path.name,
    "fps": fps,
    "width": width,
    "height": height,
    "frameCount": frame_index,
    "duration": frame_index/fps,
    "indexing": "zero-based",
    "measurement": "739x360 area-sampled luma; title, center ring and bottom watermark masked; positive difference from frame 0. This measures picture changes, not original interaction events.",
    "keyFrames": [{"frame": index, "time": round(index/fps, 6), "image": f"reference/frame-{index:04d}.jpg"} for index in sorted(key_frames)],
    "frames": metrics,
}
serialized = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
(OUTPUT / 'frames.json').write_text(serialized, encoding='utf-8')
(OUTPUT / 'frames.js').write_text('window.ASTRAL_REFERENCE=' + serialized + ';', encoding='utf-8')
print(json.dumps({"framesDecoded":frame_index, "fps":fps, "resolution":[width,height], "keyFrames":len(key_frames), "output":str(OUTPUT)}, ensure_ascii=False))
for second in [0, .5, 2, 8, 12, 46, 47, 47.5, 48, 48.5, 49, 50]:
    print(json.dumps(metrics[min(round(second*fps),len(metrics)-1)]))
