import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** Capture actual compositor PNGs; encode only after interaction has finished.
 * Default JPEG/VP9 recording can pulse on very faint subpixel lines. This path
 * preserves RGB with VP9 lossless gbrp, rather than changing product brightness.
 */
export async function startPngRecording(context, page, outputUrl) {
  let binary = process.env.FFMPEG_PATH || 'ffmpeg';
  try {
    const { stdout } = await execute(binary, ['-hide_banner', '-decoders'], { windowsHide: true });
    if (!/\bpng\s/.test(stdout)) throw new Error('PNG decoder unavailable');
  } catch {
    // Optional installed analysis runtime; never install or alter dependencies.
    const { stdout } = await execute('python', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { windowsHide: true });
    binary = stdout.trim();
  }
  const session = await context.newCDPSession(page);
  const frames = [];
  const capture = event => {
    const timestamp = event.metadata.timestamp;
    if (!frames.length || timestamp - frames.at(-1).timestamp >= .039) {
      frames.push({ timestamp, buffer: Buffer.from(event.data, 'base64') });
    }
    void session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  };
  session.on('Page.screencastFrame', capture);
  await session.send('Page.startScreencast', { format: 'png', maxWidth: 960, maxHeight: 600, everyNthFrame: 1 });
  return {
    async stop() {
      await session.send('Page.stopScreencast');
      session.off('Page.screencastFrame', capture);
      await session.detach();
      if (frames.length < 2) throw new Error('PNG recording produced no usable frames.');
      const temporaryRoot = fileURLToPath(new URL('.capture/', outputUrl));
      await mkdir(temporaryRoot, { recursive: true });
      const directory = await mkdtemp(join(temporaryRoot, 'png-'));
      const concat = ['ffconcat version 1.0'];
      for (let index = 0; index < frames.length; index++) {
        const name = `frame-${String(index).padStart(4, '0')}.png`;
        await writeFile(join(directory, name), frames[index].buffer);
        concat.push(`file '${name}'`);
        concat.push(`duration ${index + 1 < frames.length ? Math.max(.001, frames[index + 1].timestamp - frames[index].timestamp).toFixed(6) : '0.120000'}`);
      }
      concat.push(`file 'frame-${String(frames.length - 1).padStart(4, '0')}.png'`);
      const manifest = join(directory, 'frames.ffconcat');
      await writeFile(manifest, concat.join('\n'));
      await execute(binary, ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', manifest, '-an', '-c:v', 'libvpx-vp9', '-lossless', '1', '-pix_fmt', 'gbrp', '-cpu-used', '4', '-row-mt', '1', '-threads', '4', '-r', '25', '-vsync', 'cfr', '-y', fileURLToPath(outputUrl)], { windowsHide: true, maxBuffer: 1024 * 1024 });
      return { method: 'Actual CDP compositor PNG frames, original timestamps, post-capture VP9 lossless RGB (gbrp), 25 FPS presentation. Not a performance benchmark.', compositorFrames: frames.length, capturedDuration: frames.at(-1).timestamp - frames[0].timestamp };
    },
  };
}
