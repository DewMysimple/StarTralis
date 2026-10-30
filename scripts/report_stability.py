"""Build standalone plots and the data payload for the iteration-02 report."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.font_manager import findfont
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs/verification/iteration-02"
load = lambda name: json.loads((OUTPUT / name).read_text(encoding="utf-8-sig"))
before, after = load("before-trace.json"), load("after-trace.json")
recording = load("input-frames.json")
live = load("live-performance.json")
release, resume = load("release-curve.json"), load("resume-continuity.json")
freeze_dpr = {"before": load("fractional-dpr-freeze-before.json"), "after": load("fractional-dpr-freeze.json")}
encoded_video = load("after-video-frames.json")
lossy_video = load("recorder-lossy-frames.json")
lossy_raw = load("recorder-lossy-raw-canvas.json")
tests = load("browser-tests.json")["stats"]
production = load("production-smoke.json")

fig, axes = plt.subplots(3, 1, figsize=(14, 11), constrained_layout=True)
for dataset, label, color in [(before, "Before: incremental + periodic redraw (480 stars)", "#ca6942"), (after, "After: one history renderer (360 stars)", "#277ea0")]:
    frames = dataset["frames"]
    times = np.array([row["time"] for row in frames])
    energy = np.array([row["luma"] for row in frames])
    normalization = energy[np.argmin(np.abs(times - 8))]
    axes[0].plot(times, energy / normalization, label=label, color=color, lw=1)
    selected = (times >= 3) & (times <= 8)
    axes[1].plot(times[selected], energy[selected] / normalization, color=color, lw=1.3)
    axes[2].plot(times[times >= 3], np.array([row["changePercent"] for row in frames])[times >= 3], color=color, lw=.8, label=label)
axes[0].set(title="Full 46-second hold; each series normalized to its own 8-second energy", ylabel="Normalized dynamic luma")
axes[0].legend(loc="lower right")
axes[1].set(title="3-8 seconds: sawtooth drops disappear", ylabel="Normalized dynamic luma", xlabel="Controlled time (s)")
for time in np.arange(3.15, 8, .45):
    axes[1].axvline(time, color="#888", alpha=.12, lw=.7)
axes[2].axhline(-5, color="#555", ls="--", lw=1, label="-5% regression limit")
axes[2].set(ylabel="Per-frame change (%)", xlabel="Controlled time (s)", ylim=(-22, 3))
axes[2].legend(loc="lower right")
for ax in axes:
    ax.grid(alpha=.2)
fig.suptitle("Same 960x600 / DPR 1 / 60 Hz measurement, all 2,760 frames retained")
fig.savefig(OUTPUT / "brightness-comparison.png", dpi=150)
plt.close(fig)

records = live["records"]
fig, axes = plt.subplots(2, 1, figsize=(14, 6), sharex=True, constrained_layout=True)
times = [row["time"] for row in records]
axes[0].plot(times, [row["intervalMs"] for row in records], color="#277ea0", lw=.6)
axes[0].axhline(1000 / 60, color="#888", ls="--", label="60 Hz frame budget")
axes[0].set(ylabel="Native RAF interval (ms)", ylim=(0, 45))
axes[0].legend()
axes[1].plot(times, [row["renderMs"] for row in records], color="#277ea0", lw=.6)
axes[1].axhline(1000 / 60, color="#888", ls="--")
axes[1].set(ylabel="RAF callback duration (ms)", xlabel="Real wall-clock time (s)", ylim=(0, 20))
for ax in axes:
    ax.grid(alpha=.2)
fig.suptitle("46-second native-clock run: 1440x900, DPR 1, local headless Chromium")
fig.savefig(OUTPUT / "performance.png", dpi=150)
plt.close(fig)

fig, axes = plt.subplots(1, 2, figsize=(12, 4), constrained_layout=True)
times = np.linspace(0, 1.05, 100)
t = times / 1.05
axes[0].plot(times, 1 - t * t * (3 - 2 * t), label="Single smoothstep fade", color="#277ea0")
axes[0].scatter([r["elapsed"] for r in release], [r["fittedScale"] for r in release], color="#ca6942", label="Measured frozen-image alpha")
axes[0].set(xlabel="Time after release (s)", ylabel="Image opacity")
axes[0].legend()
axes[1].plot([r["repetition"] + 1 for r in resume], [r["changePercent"] for r in resume], "o-", color="#277ea0")
axes[1].axhline(-5, color="#888", ls="--")
axes[1].axhline(5, color="#888", ls="--")
axes[1].set(xlabel="Rapid resume number", ylabel="First resumed frame change (%)", ylim=(-6, 6))
for ax in axes:
    ax.grid(alpha=.2)
fig.savefig(OUTPUT / "release-and-resume.png", dpi=150)
plt.close(fig)

font = ImageFont.truetype(findfont("DejaVu Sans"), 24)
pair = Image.new("RGB", (1920, 640), "#111722")
draw = ImageDraw.Draw(pair)
for column, phase in enumerate(["before", "after"]):
    image = Image.open(OUTPUT / f"{phase}-hold-8s.png").convert("RGB")
    pair.paste(image, (column * 960, 40))
    draw.text((column * 960 + 16, 6), f"{phase.title()} / 8 s / {'480' if phase == 'before' else '360'} stars", font=font, fill="#d0d8e4")
pair.save(OUTPUT / "visual-comparison.png")

summary = {
    "baselineRevision": before["baselineRevision"],
    "recording": {key: value for key, value in recording.items() if key != "frames"},
    "controlledBefore": before["summary"], "controlledAfter": after["summary"],
    "live": {key: value for key, value in live.items() if key != "records"},
    "release": release, "resume": resume, "fractionalDprFreeze": freeze_dpr,
    "encodedVideo": {key: value for key, value in encoded_video.items() if key != "frames"},
    "recordingDiagnostic": {"compressedVideo": lossy_video["steady"], "simultaneousRawWorstDropPercent": lossy_raw["rawCanvasWorstDropPercent"], "simultaneousRawJumpsOver5Percent": lossy_raw["rawCanvasJumpsOver5Percent"]},
    "browserTests": tests, "productionSmoke": production,
}
(OUTPUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
payload = {"summary": summary, "input": recording, "before": before, "after": after}
(OUTPUT / "report-data.js").write_text("window.STABILITY_REPORT=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";", encoding="utf-8")
stamp = datetime.fromisoformat(tests["startTime"].replace("Z", "+00:00")).astimezone(timezone(timedelta(hours=8))).date().isoformat()
verification = f"""Astral Flow 第二轮验收记录
日期：{stamp}（Asia/Shanghai）；任务起于 2026-10-30。
验证对象：main@1b1db04 加本轮本地修改；本轮交付 revision 从 Git 日志定位。

实际构建：npm run build 成功。TypeScript 严格检查与 Vite 生产包通过。
实际完整测试：npm test，{tests['expected']} passed，{tests['duration']/1000:.1f} 秒。
unexpected={tests['unexpected']}，flaky={tests['flaky']}，skipped={tests['skipped']}。
机器测试结果：browser-tests.json。不是沿用初版十项测试的通过记录。

原始录屏：2550×1314，24 FPS，256 帧；全部解码，8 张总览视觉复核。
F169→F170 下降 13.347%，骤降中位间隔 0.458333 秒。
同一次旧重建调用前后直接量测约 15%–19% 能量下降，确认两套模型不等价。
原视频及四张图片已保留 source/diagnostics，原片复制 SHA256 已核对相同。

固定 960×600、DPR=1、60 Hz，连续采样 46 秒共 2760 帧：
3–8 秒：旧版最大下降 16.914%，新版约 0.471%，超过 5% 骤降 11→0 次。
12–20 秒：旧版约 15.989%，新版约 0.496%，18→0 次。
36–46 秒：旧版约 15.771%，新版约 0.456%，22→0 次。
覆盖全部窗口、0.45 秒名义倍数和旧版实际重建时刻，避免 RAF 舍入相位漂移漏检。
after-trace.json 每帧保存时间、亮度、Alpha、绘制及读回耗时；读回不计入绘制时间。
high-dpr-stability.json：设备 DPR=3、绘图 DPR=1.75、144 Hz，最大下降约 0.346%。

释放冻结完整画面，只使用单一 1.05 秒曲线；背景、标题、圆环保留。
六次快速续按的首帧变化绝对值最大约 2.345%，最终完全释放 Alpha=0。
分数 DPR 的冻结像素测试：CSS 尺寸重采样误差 {freeze_dpr['before']['relativeDifference']*100:.3f}%→{freeze_dpr['after']['relativeDifference']*100:.3f}%。
复制与淡出均已改为 backing-store 像素一比一，避免薄轨迹变形。
旧有鼠标捕获/取消、失焦/隐藏、触摸、键盘组合、四种尺寸、缩放、reduced-motion 均通过。
时钟敏感测试在 mount 后 pauseAt，用 runFor 精确推进，排除 IPC/读回自行耗时。

真实时间独立测量：1440×900、DPR=1、原生 RAF，持续约 46 秒。
3–46 秒稳态约 {live['windows'][-1]['observedFps']:.1f} 次 RAF/s，回调 P95 {live['windows'][-1]['p95RenderMs']:.2f} ms。
36–46 秒回调 P95 {live['windows'][2]['p95RenderMs']:.2f} ms；8/20/46 秒均保持 360 条轨迹。
无逐帧像素读回或视频编码；摘要排除三次截图前后 0.25 秒，原始帧完整保存。
释放后 state=idle、alpha=0、errors=[]。这是本机无头 Chromium 156，宿主约 180 Hz；
不代表物理 60 Hz 屏幕、完整 GPU 呈现或其他设备性能。

演示录制另作核对：默认 JPEG90/有损 VP9 在弱星轨上带来额外量化波动。
同次压缩录制最大下降 {abs(lossy_video['steady']['worstDropPercent']):.3f}%，直接 Canvas 采样仅 {abs(lossy_raw['rawCanvasWorstDropPercent']):.3f}%。
因此演示改为真实合成器 PNG 帧，按原始时间戳在录制结束后编码 VP9 lossless RGB。
最终演示全部 {encoded_video['frameCount']} 帧已解码，3–8 秒最大下降 {abs(encoded_video['steady']['worstDropPercent']):.3f}%，
超过 5% 下降 {encoded_video['steady']['negativeJumpsOver5Percent']} 次。录制开销与独立性能测量分开。
分支、源码或帧率变化后必须重新验证，不用视频编码波动推断渲染器问题。

生产包：独立 Vite preview 5181，1440×900/DPR1 与 390×844/DPR3，
按压进入 pressing，释放回 idle、Alpha=0，页面无错误；production-smoke.json。
实物手机、Safari、Firefox、云端部署仍未验收。

打开：http://127.0.0.1:5180/docs/flicker-analysis.html
重现：README.md / package.json 的 analyze:flicker、measure:stability、
benchmark:stability、capture:preview、report:stability；PNG 录制需要完整 FFmpeg。
初版原始验收说明：../iteration-01-verification.txt（由 Git 1b1db04 保留）。
"""
(OUTPUT / "verification.txt").write_text(verification, encoding="utf-8")
(OUTPUT.parent / "verification.txt").write_text("Astral Flow 当前验收导航\n\n第二轮完整结果：iteration-02/verification.txt\n机器测试：iteration-02/browser-tests.json\n连续稳定性与性能：iteration-02/summary.json\n报告：../flicker-analysis.html\n\n初版验收已原样保留 iteration-01-verification.txt（Git 1b1db04）。\n本目录同名截图和 interaction.webm 已更新为当前实现；初版图片请按旧 revision 追溯。\n真实设备与其他浏览器的验证边界见本轮记录。\n", encoding="utf-8")
print(json.dumps({"before": before["summary"], "after": after["summary"], "live": live["windows"], "output": str(OUTPUT)}, indent=2))
