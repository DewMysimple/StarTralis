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
桌面初始 480 颗动态星，手机 280；低性能设备降低数量与 DPR。
每颗星有独立半径、角速度、亮度、线宽、激活延迟与尾迹寿命。
使用真实时间积分圆周运动。0.34 秒平滑启动，最初 2.7 秒分批激活。
轨迹画在持久的离屏透明 Canvas，destination-out 做指数擦除；
显示层合成轨迹和即时星头，避免把星头光晕永久烙进尾迹。
每 0.45 秒根据有限运动历史重新校正尾迹，避免 8-bit 透明度舍入
残留在长时间按压后变成完整圆环。轨迹寿命 3.2–10.2 秒。
松开后立即停止运动与发射，约 1.05 秒完成自然消散并停止 RAF。
静态背景、标题、圆环保持；未完全消散时再按下可继续叠加。

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
