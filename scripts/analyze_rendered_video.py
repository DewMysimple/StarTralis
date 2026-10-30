"""Analyze all encoded demo frames separately from raw Canvas measurements."""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument("--video", type=Path, default=Path("docs/verification/interaction.webm"))
parser.add_argument("--output", type=Path, default=Path("docs/verification/iteration-02/after-video-frames.json"))
args = parser.parse_args()
capture = cv2.VideoCapture(str(args.video))
if not capture.isOpened():
    raise RuntimeError(f"Cannot open {args.video}")
fps = capture.get(cv2.CAP_PROP_FPS)
rows, baseline = [], None
mask = np.ones((300, 480), dtype=bool)
mask[120:183, 144:336] = False
mask[194:209, 231:249] = False
while True:
    success, frame = capture.read()
    if not success:
        break
    gray = cv2.cvtColor(cv2.resize(frame, (480, 300), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(float)
    if baseline is None:
        baseline = gray.copy()
    energy = float(np.maximum(gray - baseline, 0)[mask].sum())
    previous = rows[-1]["energy"] if rows else 0
    rows.append({"frame": len(rows), "time": len(rows) / fps, "energy": energy, "changePercent": (energy / previous - 1) * 100 if previous > 100 else 0})
capture.release()
steady = [row for row in rows if 3 <= row["time"] <= 8]
if not steady:
    raise RuntimeError("Demo is too short for the 3-8 second steady window")
result = {
    "source": args.video.as_posix(), "fps": fps, "frameCount": len(rows),
    "measurement": "Every encoded frame decoded at 480x300; positive luma above first frame, title and ring masked. Recording time 3-8 seconds is inside this demo's known hold; release excluded. Separate from raw Canvas measurements.",
    "steady": {"from": 3, "to": 8, "worstDropPercent": min(row["changePercent"] for row in steady), "negativeJumpsOver5Percent": sum(row["changePercent"] < -5 for row in steady)},
    "frames": rows,
}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps({key: value for key, value in result.items() if key != "frames"}, indent=2))
