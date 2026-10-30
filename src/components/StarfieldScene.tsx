import { useEffect, useRef } from 'react';
import { StarTrailEngine } from '../engine/StarTrailEngine';

export default function StarfieldScene() {
  const sceneRef = useRef<HTMLElement>(null);
  const backgroundRef = useRef<HTMLCanvasElement>(null);
  const trailsRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<StarTrailEngine | null>(null);
  const statusRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const scene = sceneRef.current!;
    const background = backgroundRef.current!;
    const trails = trailsRef.current!;
    scene.dataset.state = 'idle';
    scene.setAttribute('aria-pressed', 'false');
    let engine: StarTrailEngine;
    try {
      engine = new StarTrailEngine(background, trails, state => {
        scene.dataset.state = state;
        scene.setAttribute('aria-pressed', String(state === 'pressing'));
        if (statusRef.current) statusRef.current.textContent = state === 'pressing'
          ? 'The stars are moving. Release to let the trails fade.'
          : state === 'idle' ? 'The sky is still. Hold to set the stars in motion.' : 'The star trails are fading.';
      });
    } catch {
      if (statusRef.current) statusRef.current.textContent = 'Your browser does not support Canvas 2D.';
      return;
    }
    engineRef.current = engine;
    const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
    engine.setReducedMotion(motionPreference.matches);
    let activePointer: number | null = null;
    const heldKeys = new Set<string>();
    const syncInput = () => engine.setPressed(activePointer !== null || heldKeys.size > 0);

    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || activePointer !== null) return;
      event.preventDefault();
      activePointer = event.pointerId;
      scene.focus({ preventScroll: true });
      scene.setPointerCapture(event.pointerId);
      syncInput();
    };
    const pointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== activePointer) return;
      activePointer = null;
      if (scene.hasPointerCapture(event.pointerId)) scene.releasePointerCapture(event.pointerId);
      syncInput();
    };
    const keyDown = (event: KeyboardEvent) => {
      if ((event.code !== 'Space' && event.code !== 'Enter') || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      if (event.repeat || heldKeys.has(event.code)) return;
      heldKeys.add(event.code);
      syncInput();
    };
    const keyUp = (event: KeyboardEvent) => {
      if (!heldKeys.has(event.code)) return;
      event.preventDefault();
      heldKeys.delete(event.code);
      syncInput();
    };
    const releaseInputs = () => {
      const pointer = activePointer;
      activePointer = null;
      heldKeys.clear();
      if (pointer !== null && scene.hasPointerCapture(pointer)) scene.releasePointerCapture(pointer);
      engine.setPressed(false);
    };
    const visibilityChange = () => {
      if (document.hidden) { releaseInputs(); engine.suspend(); }
    };
    const resize = () => {
      const bounds = scene.getBoundingClientRect();
      engine.resize(bounds.width, bounds.height);
    };
    const preferenceChange = () => {
      engine.setReducedMotion(motionPreference.matches);
      releaseInputs();
      engine.suspend();
    };
    const contextMenu = (event: Event) => event.preventDefault();
    const observer = new ResizeObserver(resize);
    observer.observe(scene);
    resize();
    scene.dataset.ready = 'true';
    scene.addEventListener('pointerdown', pointerDown);
    scene.addEventListener('pointerup', pointerEnd);
    scene.addEventListener('pointercancel', pointerEnd);
    scene.addEventListener('lostpointercapture', pointerEnd);
    scene.addEventListener('contextmenu', contextMenu);
    window.addEventListener('pointerup', pointerEnd);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', releaseInputs);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', visibilityChange);
    motionPreference.addEventListener('change', preferenceChange);

    return () => {
      observer.disconnect();
      scene.removeEventListener('pointerdown', pointerDown);
      scene.removeEventListener('pointerup', pointerEnd);
      scene.removeEventListener('pointercancel', pointerEnd);
      scene.removeEventListener('lostpointercapture', pointerEnd);
      scene.removeEventListener('contextmenu', contextMenu);
      window.removeEventListener('pointerup', pointerEnd);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', releaseInputs);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibilityChange);
      motionPreference.removeEventListener('change', preferenceChange);
      engine.dispose();
      engineRef.current = null;
      delete scene.dataset.ready;
    };
  }, []);

  return (
    <main
      className="starfield-scene"
      ref={sceneRef}
      role="button"
      tabIndex={0}
      aria-label="Astral Flow. Hold anywhere, or hold Space or Enter, to set the stars in motion. Release to let them fade."
      aria-pressed="false"
      aria-describedby="interaction-instructions"
      data-state="idle"
    >
      <canvas className="scene-canvas scene-background" ref={backgroundRef} aria-hidden="true" />
      <canvas className="scene-canvas scene-trails" ref={trailsRef} aria-hidden="true" />
      <div className="scene-vignette" aria-hidden="true" />
      <div className="scene-copy">
        <h1>Astral Flow</h1>
        <p>Following the silent movement of distant stars.</p>
      </div>
      <div className="celestial-center" aria-hidden="true" />
      <p className="sr-only" id="interaction-instructions">Hold the screen, mouse button, Space, or Enter to create star trails. Release to return to a quiet sky.</p>
      <span ref={statusRef} className="sr-only" role="status" aria-live="polite">The sky is still. Hold to set the stars in motion.</span>
    </main>
  );
}
