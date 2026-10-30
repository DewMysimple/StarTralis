Astral Flow
===========

React + Vite + TypeScript + Canvas 2D 全屏星轨作品。

工程记忆与版本管理
------------------
工程记忆入口：wiki_memory/README.md（standard 模式）。
维护协议：wiki_memory/AGENTS.md；项目指令：根目录 AGENTS.md。
仓库：https://github.com/DewMysimple/StarTralis
用户持续要求：每次完整对话产生的项目修改，验证后都要提交并推送。
后续日常任务直接遵循项目协议，无需重新调用个人 wiki-memory 技能。

运行
----
需要 Node.js 22.12+ 或支持当前 Vite 的更高版本。
  npm install
  npm run dev

开发地址：http://127.0.0.1:5180/
鼠标左键、触屏或触控笔按住任意位置；也可按住 Space / Enter。
持续约 6–8 秒形成丰富星轨；松开后约 1.05 秒消散。

  npm run build       TypeScript 检查与生产构建，输出 dist/
  npm run preview     预览生产构建，地址 http://127.0.0.1:4173/
  npm test            Playwright 浏览器验收
  npm run capture:preview  开发服务器启动后，录制真实时间交互与流畅度数据
  npm run benchmark:stability  原生时间持续按压 46 秒，记录帧间隔与绘制耗时
  npm run measure:stability    受控 60 Hz 连续采样 46 秒，保存亮度与 Alpha
  npm run report:stability     根据已有测量更新本轮图表与报告数据

浏览器测试会复用本机已安装的 Chromium。没有浏览器时运行：
  npx playwright install chromium

源码
----
src/components/StarfieldScene.tsx  页面、Pointer Events、键盘与生命周期
src/engine/StarParticle.ts        独立轨道参数与固定容量的真实运动历史
src/engine/StarTrailEngine.ts     Canvas 渲染、累积、消散、适配与调度
src/styles/global.css            全屏背景、字体、留白、圆环和响应式布局
src/App.tsx / src/main.tsx        React 入口

视觉与运动
----------
背景没有使用图片或视频。205 颗静态星点独立绘制；手机 165 颗。
桌面初始 360 颗动态星，手机 240；低性能设备为 280 / 200 颗。
每颗星有独立半径、角速度、亮度、线宽、激活延迟与尾迹寿命。
使用真实时间积分圆周运动。0.34 秒平滑启动，最初 2.7 秒分批激活。
每帧使用同一套有限历史与时间衰减函数绘制连续圆弧；轨迹实时
连接到当前星头，不再在增量绘制和周期性重建之间切换。
每星固定 384 槽，约 30 Hz 采样；寿命 3.2–10.2 秒，过期样本剪除。
松开后冻结完整动态画面，用单一 1.05 秒曲线淡出并停止 RAF。
运动时间在释放时暂停；续按继承已衰减历史与端点，保持连接。
静态背景、标题、圆环保持。普通轨迹较暗，少数亮星与星头突出。

适配与性能
----------
ResizeObserver 监听场景；尺寸变化后重新配置像素缓冲与轨道。
DPR 上限：桌面 2，手机 1.75，低性能 1.25，并有像素预算。
单一 RAF；idle / 后台不运行动画；卸载时移除事件和观察器。
粒子与历史存在普通对象 / TypedArray，帧更新不进入 React State。
辉光纹理仅缓存一次；静态星点不逐帧重绘；无 Three.js 或动画库。
尊重 prefers-reduced-motion，使用更少星体与原速度 20% 的运动。

参考视频分析
------------
docs/reference-analysis.html 可直接打开，或通过开发服务器访问：
http://127.0.0.1:5180/docs/reference-analysis.html

报告包含原片单帧步进、时间定位、逐帧数据曲线、关键帧解读及逐秒总览。
全部 1518 帧（2956×1440，30 FPS，50.6 秒）已解码量测。
docs/reference/frames.json 保存全部逐帧数值，帧号从 0 开始。
docs/reference/frame-*.jpg 为选取的 27 个关键帧。
docs/verification/ 为本次浏览器视觉验收截图及测量记录。

分析脚本为 scripts/analyze_reference.py。重新提取：
  npm run analyze:reference
分析脚本需要 Python 的 opencv-python、numpy、Pillow；网页不依赖它们。

原片有标题轮换和多次轨迹增长、减弱。网页按照 prompt_01.txt
保留固定 Astral Flow 标题，以按住和松开控制，未自动播放视频时间轴。
分析报告和 source/ 原素材属于本地研究文件，不进入 dist/ 产品包。

第二轮闪烁修复与验收
--------------------
http://127.0.0.1:5180/docs/flicker-analysis.html
docs/verification/iteration-02/ 保存逐帧数据、前后曲线、关键帧和性能记录。

用户录屏为 2550×1314、24 FPS、256 帧，全部解码量测并检查全帧总览。
固定 960×600、DPR=1、60 Hz 采样中，3–8 秒最大单帧亮度下降
从 16.91% 降至约 0.47%；20 / 46 秒窗口均没有超过 5% 的骤降。
16 项浏览器测试通过，含快速续按、冻结淡出、高 DPR 144 Hz 连续采样、分数 DPR 像素冻结。
真实时间 46 秒测量独立于受控采样，不在每帧读取像素或编码视频。
这些结果来自本机 Chromium；实物手机、Safari / Firefox 尚未验收。

重现旧版（脚本固定从 Git 1b1db04 提取旧引擎，不修改当前源码）：
  node scripts/measure-stability.mjs before
重新分析本轮录屏：
  npm run analyze:flicker -- --video source/diagnostics/PixPin_2026-10-30_22-46-44.mp4
Python 本轮图表另需 matplotlib；所有分析依赖均不进入网页运行包。
演示录制使用真实合成器 PNG 帧，再按原始时间戳编码 VP9 无损 RGB；
需要支持 PNG 解码和 libvpx-vp9 的完整 FFmpeg（PATH / FFMPEG_PATH，或已安装的 imageio-ffmpeg）。
PNG 中间帧在 docs/verification/.capture/，按临时产物忽略，不推送。
原生性能测量与录制分开，避免把视频压缩对微弱细线的量化当成渲染波动。
