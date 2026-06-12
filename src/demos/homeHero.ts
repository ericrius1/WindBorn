// Landing hero: the glass-dawn lake from The Mirror's finale, full-bleed
// behind the title. WebGPU when available; otherwise the original canvas-2D
// ripple rain stays as the graceful fallback.

import type { Demo } from "../lib/demoShell";

export function mountHomeHero(container: HTMLElement): Demo {
  if (!navigator.gpu) return mountRippleRain(container);
  return mountGlassDawnHero(container);
}

// ---- WebGPU glass dawn -------------------------------------------------------------

function mountGlassDawnHero(container: HTMLElement): Demo {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "width:100%;height:100%;display:block";
  container.appendChild(canvas);

  // Build asynchronously behind a synchronous Demo facade — frame() idles
  // until the renderer is ready.
  let ready = false;
  let disposed = false;
  let frameImpl: (() => void) | null = null;
  let disposeImpl: (() => void) | null = null;

  (async () => {
    const [{ ACESFilmicToneMapping, PerspectiveCamera, Scene, WebGPURenderer }, { buildGlassDawn, DAWN_CAMERA }] =
      await Promise.all([import("three/webgpu"), import("./mirror/glassDawnScene")]);
    if (disposed) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const renderer = new WebGPURenderer({ canvas, antialias: true });
    await renderer.init();
    if (disposed) {
      renderer.dispose();
      return;
    }
    renderer.toneMapping = ACESFilmicToneMapping;

    const scene = new Scene();
    const camera = new PerspectiveCamera(46, 1, 0.1, 2500);
    const width = Math.max(container.clientWidth, 320) * dpr;
    const height = Math.max(container.clientHeight, 240) * dpr;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;

    const dawn = buildGlassDawn(scene, width, height, { reflectionScale: 0.45 });
    dawn.attachPointer(canvas, camera);

    const resize = (): void => {
      const w = Math.max(container.clientWidth, 320) * dpr;
      const h = Math.max(container.clientHeight, 240) * dpr;
      if (canvas.width === Math.floor(w) && canvas.height === Math.floor(h)) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      dawn.reflection.setSize(w * 0.45, h * 0.45);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    // A slow, endless drift around the snag; no drag (the hero is backdrop).
    let azimuth = DAWN_CAMERA.azimuth;
    let last = performance.now();
    let t = 0;

    frameImpl = () => {
      const nowMs = performance.now();
      const dt = Math.min((nowMs - last) / 1000, 0.1);
      last = nowMs;
      t += dt;
      azimuth += dt * 0.006;
      camera.position.set(
        DAWN_CAMERA.target.x + DAWN_CAMERA.distance * Math.cos(DAWN_CAMERA.polar) * Math.cos(azimuth),
        DAWN_CAMERA.target.y + DAWN_CAMERA.distance * Math.sin(DAWN_CAMERA.polar),
        DAWN_CAMERA.target.z + DAWN_CAMERA.distance * Math.cos(DAWN_CAMERA.polar) * Math.sin(azimuth),
      );
      camera.lookAt(DAWN_CAMERA.target);
      dawn.update(t, dt);
      dawn.renderReflection(renderer, scene, camera);
      renderer.render(scene, camera);
    };
    disposeImpl = () => {
      observer.disconnect();
      dawn.dispose();
      renderer.dispose();
    };
    camera.updateProjectionMatrix();
    ready = true;
  })().catch((err) => {
    console.error("glass dawn hero failed; falling back", err);
    canvas.remove();
    const fallback = mountRippleRain(container);
    frameImpl = () => fallback.frame();
    disposeImpl = () => fallback.dispose?.();
    ready = true;
  });

  return {
    frame() {
      if (ready && frameImpl) frameImpl();
    },
    dispose() {
      disposed = true;
      disposeImpl?.();
    },
  };
}

// ---- canvas-2D fallback: rain of ripple rings ------------------------------------------

interface Ring {
  x: number;
  y: number;
  born: number;
  max: number;
}

function mountRippleRain(container: HTMLElement): Demo {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "width:100%;height:100%;display:block";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const rings: Ring[] = [];
  let last = 0;

  const frame = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = container.clientWidth * dpr;
    const h = container.clientHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const t = performance.now();
    if (t - last > 420 && rings.length < 24) {
      last = t;
      rings.push({ x: Math.random() * w, y: h * (0.35 + Math.random() * 0.6), born: t, max: 40 + Math.random() * 120 });
    }
    ctx.fillStyle = "#0a0e14";
    ctx.fillRect(0, 0, w, h);
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      const age = (t - r.born) / 2600;
      if (age > 1) {
        rings.splice(i, 1);
        continue;
      }
      const rad = age * r.max * dpr;
      const squash = 0.36; // fake perspective: rings are ellipses
      ctx.strokeStyle = `rgba(140, 180, 210, ${0.34 * (1 - age)})`;
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, rad, rad * squash, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  return { frame, dispose() {} };
}
