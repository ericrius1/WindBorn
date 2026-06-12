// Landing hero. Placeholder: canvas-2D rain of ripple rings on dark water.
// The Mirror series replaces this with the real WebGPU glass-dawn surface —
// keep the export name and signature.

import type { Demo } from "../lib/demoShell";

interface Ring {
  x: number;
  y: number;
  born: number;
  max: number;
}

export function mountHomeHero(container: HTMLElement): Demo {
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

  return { frame };
}
