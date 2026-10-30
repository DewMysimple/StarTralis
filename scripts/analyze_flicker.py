"""Decode every frame of the reported recording, excluding static copy/cursor.

This measures picture changes; it does not infer the original pointer events.
Python analysis dependencies are separate from the application runtime.
"""
import argparse
import json
import shutil
from pathlib import Path

import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--video", type=Path, default=Path(r"C:\Users\Administrator\Desktop\PixPin_2026-10-30_22-46-44.mp4"))
args = parser.parse_args()
video = ROOT / "source/diagnostics" / args.video.name
video.parent.mkdir(parents=True, exist_ok=True)
if args.video.resolve() != video.resolve():
    shutil.copy2(args.video, video)
output = ROOT / "docs/verification/iteration-02"
output.mkdir(parents=True, exist_ok=True)
capture = cv2.VideoCapture(str(video))
if not capture.isOpened():
    raise RuntimeError(f"Cannot open {video}")
fps = capture.get(cv2.CAP_PROP_FPS)
width, height = int(capture.get(3)), int(capture.get(4))
rows, thumbs = [], []
baseline = previous = mask = None
while True:
    success, frame = capture.read()
    if not success:
        break
    index = len(rows)
    # Area resampling reduces decode-analysis cost; every input frame is read.
    small = cv2.resize(frame, (850, 438), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float64)
    if baseline is None:
        baseline, previous = gray.copy(), gray.copy()
        mask = np.ones(gray.shape, dtype=bool)
        mask[175:263, 255:595] = False  # fixed title and subtitle
        mask[282:305, 413:438] = False  # center ring
        mask[140:196, 637:693] = False  # recording cursor
    delta = np.maximum(gray - baseline, 0)
    energy = float(delta[mask].sum())
    previous_energy = rows[-1]["energy"] if rows else 0
    rows.append({
        "frame": index, "time": round(index / fps, 6),
        "energy": round(energy, 4),
        "changePercent": round((energy / previous_energy - 1) * 100, 5) if previous_energy > 100 else 0,
        "meanAbsoluteDifference": round(float(np.abs(gray - previous)[mask].mean()), 6),
        "pixelsAbove8": int((delta[mask] > 8).sum()),
        "pixelsAbove20": int((delta[mask] > 20).sum()),
        "pixelsAbove40": int((delta[mask] > 40).sum()),
    })
    thumb = cv2.cvtColor(cv2.resize(frame, (425, 219), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
    thumbs.append(Image.fromarray(thumb))
    previous = gray
capture.release()
drops = [r for r in rows if 3 <= r["time"] <= 9.6 and r["changePercent"] < -8]
intervals = np.diff([r["time"] for r in drops])
for sheet in range((len(rows) + 31) // 32):
    image = Image.new("RGB", (1700, 8 * 242), "#10131a")
    draw = ImageDraw.Draw(image)
    for slot, index in enumerate(range(sheet * 32, min(len(rows), (sheet + 1) * 32))):
        x, y = slot % 4 * 425, slot // 4 * 242
        image.paste(thumbs[index], (x, y))
        draw.text((x + 8, y + 222), f'F{index:03d}  {index/fps:.3f}s  {rows[index]["changePercent"]:+.1f}%', fill="#d0d8e4")
    image.save(output / f"input-contact-{sheet+1:02d}.jpg", quality=88)
selected = {0, 169, 170, 202, 203, len(rows) - 1}
for row in sorted(drops, key=lambda r: r["changePercent"])[:4]:
    selected.update([row["frame"] - 1, row["frame"]])
# A second sequential pass retains only selected native frames, rather than
# holding 256 full-resolution RGB arrays (about 2.5 GB) in memory.
capture = cv2.VideoCapture(str(video))
for index in range(len(rows)):
    success, frame = capture.read()
    if not success:
        raise RuntimeError(f"Second decode ended at frame {index}")
    if index in selected:
        cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 94])[1].tofile(str(output / f"input-frame-{index:03d}.jpg"))
capture.release()
data = {
    "video": str(video.relative_to(ROOT)).replace("\\", "/"),
    "fps": fps, "width": width, "height": height,
    "frameCount": len(rows), "duration": len(rows) / fps,
    "measurement": "850x438 area-resampled positive luma difference from frame 0; title, ring and recording cursor masked. All frames decoded. Frame index is zero based.",
    "drops": drops,
    "medianDropInterval": round(float(np.median(intervals)), 6) if len(intervals) else None,
    "frames": rows,
}
(output / "input-frames.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
fig, axes = plt.subplots(3, 1, figsize=(14, 9), sharex=True, constrained_layout=True)
times = [r["time"] for r in rows]
axes[0].plot(times, [r["energy"] for r in rows], color="#347ec7")
axes[0].set_ylabel("Dynamic luma energy")
axes[1].plot(times, [r["changePercent"] for r in rows], color="#be4e53")
axes[1].axhline(-5, ls="--", color="#777", label="-5% reference")
axes[1].set_ylim(-35, 12)
axes[1].set_ylabel("Frame change (%)")
axes[1].legend()
axes[2].plot(times, [r["meanAbsoluteDifference"] for r in rows], color="#347ec7")
axes[2].set_ylabel("Mean absolute difference")
axes[2].set_xlabel("Recording time (s)")
for ax in axes:
    ax.grid(alpha=.2)
    for r in drops:
        ax.axvline(r["time"], color="#be4e53", lw=.6, alpha=.25)
fig.suptitle("Reported flicker: every one of 256 frames decoded")
fig.savefig(output / "input-brightness.png", dpi=150)
plt.close(fig)
print(json.dumps({k: v for k, v in data.items() if k != "frames"}, ensure_ascii=False, indent=2))
