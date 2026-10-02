import { animate } from "framer-motion";
import {
  BOUNTY_FX,
  EMBER_COLORS,
  FINISH_FX,
  frostTierFor,
  SHARD_COLORS,
  SUBZERO_COLOR,
  THAW_FX,
  THAW_SUBZERO,
} from "./freezeFxTiers";

// The Freezer's effects: thawing a task lets its frost out, finishing a frosted one cracks, shatters or
// brings the avalanche, and winning a Bounty throws embers — each sized by how full the task's frost was
// (freezeFxTiers.ts holds every magnitude). They're spent particles, not state, so they're drawn on a layer of
// their own over the board (fixed, never taking the pointer) and animated imperatively with framer, like the
// counter's flinch. A row is only ever touched by a CSS class whose animation uses the individual
// `translate`/`scale` properties, so it adds to framer's own transform on the row instead of fighting it.
// Reduced motion plays none of it.

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let layerEl: HTMLDivElement | null = null;
function layer(): HTMLDivElement {
  if (!layerEl?.isConnected) {
    layerEl = document.createElement("div");
    layerEl.className = "freeze-fx";
    layerEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(layerEl);
  }
  return layerEl;
}

function spawn(className: string, style: Partial<CSSStyleDeclaration> = {}): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  Object.assign(el.style, style);
  layer().appendChild(el);
  return el;
}

const centre = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

// Shards flung from (x, y): `gravity` pulls them down as they fly (negative floats them up, like embers);
// `from` scatters where they start along a row's width, so a row breaks apart rather than a point bursting.
function burst(x: number, y: number, n: number, spread: number, colors: string[], gravity = 0, from = 0): void {
  for (let i = 0; i < n; i++) {
    const size = 4 + Math.random() * 7;
    const a = Math.random() * Math.PI * 2;
    const d = spread * (0.4 + Math.random() * 0.6);
    const dx = Math.cos(a) * d;
    const dy = Math.sin(a) * d;
    const shard = spawn("freeze-fx-shard", {
      left: `${x + (Math.random() - 0.5) * 2 * from - size / 2}px`,
      top: `${y - size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      background: colors[i % colors.length],
    });
    const spin = 200 + Math.random() * 300;
    const run = gravity
      ? animate(
          shard,
          {
            x: [0, dx * 0.55, dx],
            y: [0, dy * 0.55 - Math.abs(gravity) * 0.2, dy + gravity],
            rotate: [45, 170, spin],
            scale: [1, 0.9, 0.45],
            opacity: [1, 1, 0],
          },
          { duration: 0.9 + Math.random() * 0.55, times: [0, 0.4, 1], ease: [0.3, 0.1, 0.6, 1] },
        )
      : animate(
          shard,
          { x: [0, dx], y: [0, dy], rotate: [45, spin], scale: [1, 0.35], opacity: [1, 0] },
          { duration: 0.65 + Math.random() * 0.55, ease: [0.15, 0.7, 0.3, 1] },
        );
    run.then(() => shard.remove());
  }
}

function ring(x: number, y: number, radius: number, color: string, delay = 0): void {
  const el = spawn("freeze-fx-ring", { left: `${x - 10}px`, top: `${y - 10}px`, borderColor: color, opacity: "0" });
  animate(el, { scale: [0.2, radius / 10], opacity: [0.95, 0] }, { duration: 0.75, delay: delay / 1000, ease: [0.2, 0.7, 0.3, 1] }).then(() =>
    el.remove(),
  );
}

// Text that rises off a point and fades — what a thaw let out ("+1% frost"), or a count-up to what it pays.
function floatText(x: number, y: number, text: string, className = "", count?: { from: number; to: number; ms: number; format: (n: number) => string }): void {
  const el = spawn(`freeze-fx-text ${className}`);
  el.textContent = count ? count.format(count.from) : text;
  el.style.left = `${x - el.offsetWidth / 2}px`;
  el.style.top = `${y}px`;
  animate(el, { y: [0, -16, -52], scale: [0.8, 1.05, 1], opacity: [0, 1, 0] }, { duration: 1.4 + (count ? count.ms / 1000 : 0), times: [0, 0.25, 1] }).then(() =>
    el.remove(),
  );
  if (count) {
    animate(count.from, count.to, {
      duration: count.ms / 1000,
      ease: [0.2, 0.8, 0.3, 1],
      onUpdate: (n) => {
        el.textContent = count.format(Math.round(n));
      },
    });
  }
}

// A word stamped on: in from big and tilted, a beat held, then lifted off.
function slam(x: number, y: number, text: string, ms: number, className = ""): void {
  const el = spawn(`freeze-fx-stamp ${className}`);
  el.textContent = text;
  el.style.left = `${x - el.offsetWidth / 2}px`;
  el.style.top = `${y - el.offsetHeight / 2}px`;
  animate(
    el,
    { scale: [2.8, 1, 1, 1.04], rotate: [-16, -6, -6, -6], y: [0, 0, 0, -10], opacity: [0, 1, 1, 0] },
    { duration: ms / 1000, times: [0, 0.3, 0.8, 1], ease: [0.3, 1.3, 0.5, 1] },
  ).then(() => el.remove());
}

// Jagged lines from the impact point to the row's edges, drawn as it ices over (App.css draws them in).
function cracks(w: number, h: number, x0: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    let x = x0;
    let y = h / 2;
    let a = Math.random() * Math.PI * 2;
    const pts: string[] = [`${x.toFixed(1)},${y.toFixed(1)}`];
    while (x > -5 && x < w + 5 && y > -5 && y < h + 5 && pts.length < 30) {
      a += (Math.random() - 0.5) * 0.9;
      const step = 10 + Math.random() * 14;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step * 0.6;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return `<polyline pathLength="1" style="--i:${i}" points="${pts.join(" ")}"/>`;
  }).join("");
}

// A sheet of ice sweeps over the row, cracks spread from the impact, and it's gone — the shards take over.
function iceOver(r: DOMRect, impactX: number, ms: number): void {
  const el = spawn("freeze-fx-ice", { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  el.innerHTML = `<svg viewBox="0 0 ${r.width} ${r.height}">${cracks(r.width, r.height, impactX - r.left)}</svg>`;
  animate(el, { clipPath: ["inset(0% 100% 0% 0%)", "inset(0% 0% 0% 0%)"] }, { duration: 0.2, ease: "easeOut" });
  animate(el, { opacity: [1, 1, 0], scale: [1, 1, 1.04] }, { duration: ms / 1000, times: [0, 0.62, 1] }).then(() => el.remove());
}

// A glow over a tab's card, for the moment a Subzero task thaws.
function glow(r: DOMRect, ms: number): void {
  const el = spawn("freeze-fx-glow", { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, opacity: "0" });
  animate(el, { opacity: [0, 1, 0] }, { duration: ms / 1000, times: [0, 0.25, 1] }).then(() => el.remove());
}

// The screen's edges frost over for a moment.
function vignette(ms: number): void {
  const el = spawn("freeze-fx-vignette", { opacity: "0" });
  animate(el, { opacity: [0, 1, 1, 0] }, { duration: ms / 1000, times: [0, 0.18, 0.65, 1] }).then(() => el.remove());
}

// Snow across the whole screen, swaying as it falls.
function snowfall(n: number, ms: number): void {
  for (let i = 0; i < n; i++) {
    const size = 3 + Math.random() * 5;
    const sway = (Math.random() - 0.5) * 120;
    const flake = spawn("freeze-fx-flake", { left: `${Math.random() * window.innerWidth}px`, top: "-12px", width: `${size}px`, height: `${size}px`, opacity: "0" });
    animate(
      flake,
      { x: [0, sway * 0.3, sway, -sway * 0.4], y: [0, window.innerHeight * 0.08, window.innerHeight * 0.55, window.innerHeight + 24], opacity: [0, 1, 1, 0.2] },
      { duration: (ms / 1000) * (0.7 + Math.random() * 0.5), delay: Math.random() * 0.7, times: [0, 0.1, 0.6, 1], ease: "linear" },
    ).then(() => flake.remove());
  }
}

// A row class for a moment (its keyframes in App.css use `translate`/`scale`, adding to framer's transform).
function flashClass(el: Element, className: string, ms: number): void {
  el.classList.add(className);
  window.setTimeout(() => el.classList.remove(className), ms);
}

const ROW_SELECTOR = (taskId: string) => `[data-task-id="${CSS.escape(taskId)}"]`;

/** Thawing lets the frost out of the task's bracket, by how full it was: `frost` is what its frost adds (in
 *  points), shown rising off it. Full frost shivers, shatters, slams "Subzero" on and counts what it pays up
 *  from what it paid on ice (`from` → `to`) — while its tab flashes. Called as the row moves to its tab
 *  (looked up by its task id once it's there). */
export function thawFx(
  taskId: string,
  fill: number,
  { frost, from, to }: { frost: number; from: number; to: number },
  format: (n: number) => string,
): void {
  if (reduced()) return;
  const tier = frostTierFor(fill);
  const fx = THAW_FX[tier];
  if (fx.shards === 0) return;
  // Next frame: the row has just been re-rendered in its new tab.
  requestAnimationFrame(() => {
    const row = document.querySelector<HTMLElement>(ROW_SELECTOR(taskId));
    const bracket = row?.querySelector<HTMLElement>(".points-prefix");
    if (!row || !bracket) return;
    const go = () => {
      const b = bracket.getBoundingClientRect();
      const { x, y } = centre(b);
      burst(x, y, fx.shards, fx.spread, tier === "avalanche" ? [...SHARD_COLORS, SUBZERO_COLOR] : SHARD_COLORS);
      flashClass(bracket, "fx-pulse", 500);
      bracket.style.setProperty("--fx-pulse", String(fx.pulse));
      if (tier !== "avalanche") return floatText(x, b.top - 4, `+${format(frost)} frost`);
      const r = row.getBoundingClientRect();
      slam(r.left + r.width / 2, r.top + r.height / 2, "Subzero", 2000, "subzero");
      floatText(x, b.top - 8, "", "subzero", { from, to, ms: THAW_SUBZERO.countMs, format });
      const card = row.closest(".board-card");
      if (card) glow(card.getBoundingClientRect(), THAW_SUBZERO.flashMs);
    };
    if (tier !== "avalanche") return go();
    flashClass(row, "fx-shiver", THAW_SUBZERO.shiverMs);
    window.setTimeout(go, THAW_SUBZERO.shiverMs);
  });
}

/** Finishing a task: by how full its frost was — Crack, Shatter or the Avalanche — and embers for a Bounty
 *  won. Called as it's ticked, while its row is still where it was. `paid` is what it paid, for the
 *  Avalanche's stamp. */
export function finishFx(taskId: string, fill: number, bounty: boolean, paid: string): void {
  if (reduced()) return;
  const row = document.querySelector<HTMLElement>(ROW_SELECTOR(taskId));
  const bracket = row?.querySelector<HTMLElement>(".points-prefix");
  if (!row || !bracket) return;
  const r = row.getBoundingClientRect();
  const b = bracket.getBoundingClientRect();
  const { x: bx, y: by } = centre(b);
  const { x: cx, y: cy } = centre(r);
  if (bounty) {
    ring(bx, by, BOUNTY_FX.ring, EMBER_COLORS[0]);
    burst(bx, by, BOUNTY_FX.embers, BOUNTY_FX.spread, EMBER_COLORS, -BOUNTY_FX.rise);
  }
  const tier = frostTierFor(fill);
  if (tier === "crack") {
    const box = row.querySelector("input, .box, .checkbox-cell")?.getBoundingClientRect() ?? b;
    const { x, y } = centre(box);
    ring(x, y, FINISH_FX.crack.ring, SHARD_COLORS[0]);
    burst(bx, by, FINISH_FX.crack.shards, FINISH_FX.crack.spread, SHARD_COLORS);
  } else if (tier === "shatter") {
    const fx = FINISH_FX.shatter;
    iceOver(r, bx, fx.coverMs);
    window.setTimeout(() => {
      burst(cx, cy, fx.shards, fx.spread, SHARD_COLORS, fx.gravity, r.width / 2.5);
      fx.rings.forEach((radius, i) => ring(bx, by, radius, i % 2 ? SHARD_COLORS[1] : SHARD_COLORS[0], i * 120));
    }, fx.breakAt);
  } else if (tier === "avalanche") {
    const fx = FINISH_FX.avalanche;
    vignette(fx.vignetteMs);
    // Hit-stop: the row freezes in place, swells and drains of colour before it goes.
    flashClass(row, "fx-hold", fx.holdMs + 200);
    iceOver(r, bx, fx.coverMs);
    window.setTimeout(() => {
      burst(cx, cy, fx.shards, fx.spread, [...SHARD_COLORS, SUBZERO_COLOR], fx.gravity, r.width / 2);
      fx.rings.forEach((radius, i) => ring(bx, by, radius, i % 2 ? SUBZERO_COLOR : SHARD_COLORS[0], i * 140));
      snowfall(fx.snow, fx.snowMs);
      slam(window.innerWidth / 2, window.innerHeight / 2, `Subzero ${paid}`, fx.slamMs, "subzero big");
    }, fx.holdMs);
  }
}
