import { formatPercent } from "@board/contracts";
import { animate, motion, useReducedMotion, type AnimationOptions, type DOMKeyframesDefinition } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { BoostIcon } from "./Icons";
import type { BoosterHand } from "./types";

// The Booster's deal: the week's hand as sticky notes — face up for a moment so you see what's in it, then
// over, shuffled and fanned out for you to pick from (hover lifts a card; a click or a tap takes it). A card is
// turned over only once the server says what the deal put under it, so the pick is a real draw. The card rises,
// flips with a foil shine and the boost is stamped on; once every pick is made the rest turn over too, showing
// what was where. Skip passes all of it by: a card is picked at random for each pick left, and the hand is laid
// out as that leaves it. Shown on the week recap's last page, and over the board when a pick was left
// (BoosterReveal).

type Phase = "dealing" | "picking" | "drawing" | "done";

interface Spot {
  x: number;
  y: number;
  rotate: number;
  scale: number;
}

// Where everything goes on a stage `w` × `h` for `n` cards and `picks` picks: the cards' size, the grid they're
// dealt into face up, the fan they're picked from, the slots the picked ones rise to, and the rows the rest are
// laid out in once they're turned over (in the fan's order, apart so every name reads) — all from the stage's
// middle. Fixed tilts, so a render is pure.
function layout(w: number, h: number, n: number, picks: number) {
  const size = Math.round(Math.min(108, Math.max(64, w / 6.5)));
  const cell = size + 12;
  const cols = Math.max(1, Math.min(n, Math.floor((w - 16) / cell)));
  const rows = Math.ceil(n / cols);
  const grid: Spot[] = Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    return { x: (i - row * cols - (inRow - 1) / 2) * cell, y: (row - (rows - 1) / 2) * cell, rotate: ((i * 7) % 9) - 4, scale: 1 };
  });
  const radius = Math.min(w * 0.42, 300);
  const spread = (Math.min(66, n * 11) * Math.PI) / 180;
  const fan: Spot[] = Array.from({ length: n }, (_, i) => {
    const a = (n === 1 ? 0 : i / (n - 1) - 0.5) * spread;
    return { x: Math.sin(a) * radius, y: (1 - Math.cos(a)) * radius * 0.8 + h * 0.2, rotate: ((a * 180) / Math.PI) * 0.75, scale: 1 };
  });
  const scale = picks === 1 ? 1.45 : 1.15;
  const slots: Spot[] = Array.from({ length: picks }, (_, j) => ({ x: (j - (picks - 1) / 2) * size * scale * 1.3, y: -h * 0.24, rotate: 0, scale }));
  const small = 0.8;
  const restCell = size * small + 10;
  const restCols = Math.max(1, Math.min(n - picks, Math.floor((w - 16) / restCell)));
  const restRows = Math.ceil((n - picks) / restCols);
  const rest: Spot[] = Array.from({ length: n - picks }, (_, j) => {
    const row = Math.floor(j / restCols);
    const inRow = row === restRows - 1 ? n - picks - row * restCols : restCols;
    return { x: (j - row * restCols - (inRow - 1) / 2) * restCell, y: h * 0.22 + (row - (restRows - 1) / 2) * restCell, rotate: ((j * 5) % 7) - 3, scale: small };
  });
  return { size, grid, fan, slots, rest };
}

// The sparks thrown out as a card lands — spread by their index, so a render is pure.
const SPARK_COLORS = ["#a855f7", "#7e22ce", "#f0abfc", "#facc15"];
const SPARKS = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2 + (i % 2 ? 0.17 : 0);
  const reach = 100 + (i % 3) * 38;
  return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach * 0.7, color: SPARK_COLORS[i % 4], size: 5 + (i % 3) * 2 };
});

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
// The card a skipped pick takes: any of those left, each as likely.
const anyOf = (cards: number[]) => cards[Math.floor(Math.random() * cards.length)];

// A card moved (instantly when `still`), and a card turned face up or down from where it is — `turns` holds
// each card's turn about its upright (0 face up, 180 face down).
const move = (el: HTMLElement | null | undefined, to: DOMKeyframesDefinition, options: AnimationOptions, still: boolean) =>
  el ? animate(el, to, still ? { duration: 0 } : options) : Promise.resolve();
function turn(el: HTMLElement | null | undefined, turns: number[], i: number, faceUp: boolean, duration: number, still: boolean) {
  const from = turns[i] ?? 0;
  const to = faceUp ? (from >= 180 ? 360 : 0) : 180;
  turns[i] = to % 360;
  if (!el) return Promise.resolve();
  // Left as its latest turn has it — a later one (a skipped deal's) may have overtaken this one.
  return animate(el, { rotateY: [from, to] }, { duration: still ? 0 : duration, ease: [0.4, 0.1, 0.2, 1] }).then(() => {
    el.style.transform = `rotateY(${turns[i]}deg)`;
  });
}
// Which card sits on top (a CSS variable, so a hovered card can still rise above the rest).
const layer = (el: HTMLElement | null | undefined, z: number) => el?.style.setProperty("--z", String(z));

// What each card's face says: the hand's tasks while it's dealt face up, then each card's own task once the
// server has turned it over.
const facesOf = (hand: BoosterHand) => hand.revealed ?? hand.names.map((name, i) => hand.picked.find((p) => p.card === i)?.text ?? name);

// `hand` laid out where it has got to, at once: its picked cards in their slots, face up, and the rest in the
// fan — or, once every pick is made, turned over in their rows.
function settle(g: ReturnType<typeof layout>, hand: BoosterHand, cards: (HTMLElement | null)[], flips: (HTMLElement | null)[], turns: number[]) {
  const all = Array.from({ length: hand.cards }, (_, i) => i);
  const unpicked = all.filter((i) => !hand.picked.some((p) => p.card === i));
  all.forEach((i) => {
    const at = hand.picked.findIndex((p) => p.card === i);
    const spot = at >= 0 ? g.slots[at] : hand.revealed ? g.rest[unpicked.indexOf(i)] : g.fan[i];
    layer(cards[i], at >= 0 ? 80 + at : i + 1);
    move(cards[i], { ...spot, opacity: hand.revealed && at < 0 ? 0.6 : 1 }, {}, true);
    turn(flips[i], turns, i, at >= 0 || !!hand.revealed, 0, true);
  });
}

interface BoosterDealProps {
  hand: BoosterHand;
  // Take a card: the hand with it turned over, or null when the server refused.
  onPick: (card: number) => Promise<BoosterHand | null>;
  // Every pick made and landed (at once, for a hand already picked).
  onLanded?: () => void;
}

export function BoosterDeal({ hand, onPick, onLanded }: BoosterDealProps) {
  const reduce = !!useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const flips = useRef<(HTMLSpanElement | null)[]>([]);
  const turns = useRef<number[]>([]);
  const alive = useRef(true);
  // Whether the deal is still to play out — a skip stops it where it is.
  const dealing = useRef(true);
  // What the deal plays from: the hand as it was first shown (a pick updates it without dealing again).
  const start = useRef({ hand, reduce });
  // The hand as the server last gave it.
  const latest = useRef(hand);
  const landedRef = useRef(onLanded);
  useLayoutEffect(() => {
    landedRef.current = onLanded;
  });

  const [phase, setPhase] = useState<Phase>("dealing");
  // The stage's layout, once it's measured.
  const [geo, setGeo] = useState<ReturnType<typeof layout> | null>(null);
  const size = geo?.size ?? 96;
  const [faces, setFaces] = useState<string[]>(() => facesOf(hand));
  const [picked, setPicked] = useState(() => hand.picked.map((p) => ({ card: p.card, amount: p.amount })));
  const [spent, setSpent] = useState(!!hand.revealed);
  const [failed, setFailed] = useState(false);

  // The deal, once: in face up, over, shuffled, fanned. A hand already picked from (back on the page, or a pick
  // left from the recap) goes straight to where it was.
  useEffect(() => {
    alive.current = true;
    const stage = stageRef.current;
    if (!stage) return;
    const { hand: dealt, reduce: still } = start.current;
    const g = layout(stage.clientWidth, stage.clientHeight, dealt.cards, dealt.picks);
    setGeo(g);
    const all = Array.from({ length: dealt.cards }, (_, i) => i);
    const el = (i: number) => cards.current[i];
    const going = () => alive.current && dealing.current;

    const run = async () => {
      if (dealt.picked.length > 0 || still) {
        settle(g, dealt, cards.current, flips.current, turns.current);
        if (dealt.revealed) {
          setPhase("done");
          landedRef.current?.();
        } else setPhase("picking");
        return;
      }
      // In, face up: here's what's in the hand.
      all.forEach((i) => {
        layer(el(i), i + 1);
        const spot = g.grid[i];
        move(el(i), { x: spot.x, rotate: spot.rotate, y: [spot.y + 30, spot.y], scale: [0.6, 1], opacity: [0, 1] }, { delay: i * 0.055, type: "spring", stiffness: 420, damping: 20 }, false);
      });
      await wait(420 + dealt.cards * 55 + 650);
      if (!going()) return;
      // Over, one after another, then into one stack.
      all.forEach((i) => window.setTimeout(() => going() && turn(flips.current[i], turns.current, i, false, 0.36, false), i * 45));
      await wait(360 + dealt.cards * 45 + 120);
      if (!going()) return;
      await Promise.all(all.map((i) => move(el(i), { x: ((i * 5) % 7) - 3, y: ((i * 3) % 7) - 3, rotate: ((i * 11) % 15) - 7 }, { duration: 0.42, delay: i * 0.03, ease: [0.5, 0, 0.2, 1] }, false)));
      // Riffled twice, quicker the second time.
      for (const [k, d] of [[1, 0.2], [2, 0.14]] as const) {
        if (!going()) return;
        await Promise.all(all.map((i) => move(el(i), { x: (i % 2 ? 1 : -1) * g.size * 0.72, y: ((i * 5) % 13) - 6, rotate: i % 2 ? 8 : -8 }, { duration: d, ease: [0.4, 0, 0.2, 1] }, false)));
        if (!going()) return;
        all.forEach((i) => layer(el(i), ((i + k) % 2) * 10 + i + 1));
        await Promise.all(all.map((i) => move(el(i), { x: ((i * 7) % 7) - 3, y: ((i * 3) % 9) - 4, rotate: ((i * 13) % 13) - 6 }, { duration: d, ease: [0.4, 0, 0.2, 1] }, false)));
      }
      if (!going()) return;
      // Fanned out to pick from.
      all.forEach((i) => layer(el(i), i + 1));
      await Promise.all(all.map((i) => move(el(i), { ...g.fan[i] }, { delay: i * 0.04, type: "spring", stiffness: 300, damping: 20 }, false)));
      if (going()) setPhase("picking");
    };
    run();
    return () => {
      alive.current = false;
    };
  }, []);

  async function pick(card: number) {
    const g = geo;
    const el = cards.current[card];
    if (phase !== "picking" || !g || picked.some((p) => p.card === card)) return;
    setPhase("drawing");
    setFailed(false);
    // It charges while the server draws.
    const charge = el && !reduce ? animate(el, { scale: [1, 1.07, 1] }, { duration: 0.5, repeat: Infinity }) : undefined;
    const next = await onPick(card);
    charge?.stop();
    if (!alive.current) return;
    const mine = next?.picked.find((p) => p.card === card);
    if (!next || !mine) {
      setFailed(true);
      setPhase("picking");
      move(el, { scale: 1 }, { duration: 0.2 }, reduce);
      return;
    }
    latest.current = next;
    // Its face now says what the deal put there — while it's still face down.
    setFaces((f) => f.map((name, i) => (i === card ? mine.text : name)));
    const slot = g.slots[picked.length] ?? g.slots[g.slots.length - 1];
    layer(el, 80 + picked.length);
    await move(el, { ...slot }, { type: "spring", stiffness: 240, damping: 21 }, reduce);
    if (!alive.current) return;
    await turn(flips.current[card], turns.current, card, true, 0.52, reduce);
    if (!alive.current) return;
    // It lands: the boost is stamped on, sparks fly and the stage shakes.
    setPicked((p) => [...p, { card, amount: mine.amount }]);
    if (!reduce) move(stageRef.current, { x: [0, -7, 6, -3, 2, 0] }, { duration: 0.4 }, false);
    if (!next.revealed) {
      setPhase("picking");
      return;
    }
    // Every pick made: the rest turn over, showing what was where.
    await wait(reduce ? 0 : 900);
    if (!alive.current) return;
    setFaces(next.revealed);
    setSpent(true);
    const rest = Array.from({ length: next.cards }, (_, i) => i).filter((i) => !next.picked.some((p) => p.card === i));
    rest.forEach((i, n) => window.setTimeout(() => alive.current && turn(flips.current[i], turns.current, i, true, 0.36, reduce), reduce ? 0 : n * 60));
    rest.forEach((i, n) => move(cards.current[i], { ...g.rest[n], opacity: 0.6 }, { type: "spring", stiffness: 260, damping: 24, delay: n * 0.05 }, reduce));
    await wait(reduce ? 0 : 360 + rest.length * 60);
    if (!alive.current) return;
    setPhase("done");
    landedRef.current?.();
  }

  // Skip it: a card is picked at random for every pick still to make, and the hand is laid out as that leaves
  // it — no dealing, flipping or waiting. A pick the server turns away leaves the fan to pick from by hand.
  async function skip() {
    const g = geo;
    if (!g || (phase !== "dealing" && phase !== "picking")) return;
    dealing.current = false;
    setPhase("drawing");
    setFailed(false);
    let refused = false;
    while (!refused && latest.current.picked.length < latest.current.picks) {
      const taken = latest.current.picked.map((p) => p.card);
      const free = Array.from({ length: latest.current.cards }, (_, i) => i).filter((i) => !taken.includes(i));
      const next = await onPick(anyOf(free));
      if (!alive.current) return;
      if (next) latest.current = next;
      else refused = true;
    }
    const now = latest.current;
    setFaces(facesOf(now));
    setPicked(now.picked.map((p) => ({ card: p.card, amount: p.amount })));
    setSpent(!!now.revealed);
    settle(g, now, cards.current, flips.current, turns.current);
    setFailed(refused);
    setPhase(now.revealed ? "done" : "picking");
    if (now.revealed) landedRef.current?.();
  }

  const g = geo;
  const left = hand.picks - picked.length;
  const amount = picked[0]?.amount;
  const prompt =
    phase !== "picking"
      ? null
      : failed
        ? "Couldn't draw that card. Try again."
        : left < hand.picks
          ? `Pick ${left} more`
          : hand.picks === 1
            ? "Pick a card"
            : `Pick ${hand.picks} cards`;

  return (
    <div className="booster-deal">
      <div className="booster-stage" ref={stageRef} style={{ "--s": `${size}px` } as CSSProperties}>
        {/* Each landing's rays and sparks, behind the cards, with room for the rays' whole circle. */}
        <div className="booster-burst" aria-hidden>
          {g &&
            picked.map((p, j) => (
              <div key={p.card} className="booster-burst-at" style={{ transform: `translate(${g.slots[j].x}px, ${g.slots[j].y}px)` }}>
                <div className="booster-rays" />
                {!reduce &&
                  SPARKS.map((s, i) => (
                    <motion.span
                      key={i}
                      style={{ background: s.color, width: s.size, height: s.size }}
                      initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                      animate={{ x: s.x, y: s.y, opacity: 0, scale: 0.3 }}
                      transition={{ duration: 0.9, ease: [0.2, 0.8, 0.3, 1] }}
                    />
                  ))}
              </div>
            ))}
        </div>

        {faces.map((name, i) => {
          const mine = picked.find((p) => p.card === i);
          const canPick = phase === "picking" && !mine;
          return (
            <button
              key={i}
              type="button"
              ref={(node) => {
                cards.current[i] = node;
              }}
              className={`booster-card${canPick ? " can-pick" : ""}${mine ? " won" : ""}${spent && !mine ? " spent" : ""}`}
              style={{ opacity: 0, "--z": i + 1 } as CSSProperties}
              disabled={!canPick}
              aria-label={mine ? `${name}, picked` : spent ? name : `Card ${i + 1}`}
              onClick={() => pick(i)}
            >
              <span className="booster-lift">
                <span
                  className="booster-flip"
                  ref={(node) => {
                    flips.current[i] = node;
                  }}
                >
                  <span className="booster-face front">
                    <span className="booster-name">{name}</span>
                    {mine && <span className="booster-plus">+{formatPercent(mine.amount)}</span>}
                    {mine && !reduce && <i className="booster-shine" />}
                  </span>
                  <span className="booster-face back">
                    <BoostIcon size={Math.round(size * 0.36)} />
                  </span>
                </span>
              </span>
            </button>
          );
        })}

        {g &&
          picked.map((p, j) => {
            const slot = g.slots[j];
            const half = (g.size * slot.scale) / 2;
            return (
              <motion.div
                key={p.card}
                className="booster-stamp"
                style={{ left: `calc(50% + ${slot.x + half * 0.7}px)`, top: `calc(50% + ${slot.y - half}px)` }}
                initial={reduce ? false : { opacity: 0, scale: 2.6, rotate: -20 }}
                animate={{ opacity: 1, scale: 1, rotate: -8 }}
                transition={{ type: "spring", stiffness: 520, damping: 15, delay: 0.05 }}
              >
                +{formatPercent(p.amount)}
              </motion.div>
            );
          })}
      </div>

      <div className="booster-under">
        {prompt && <p className={`booster-prompt${failed ? " failed" : ""}`}>{prompt}</p>}
        {(phase === "dealing" || phase === "picking") && (
          <button type="button" className="ghost-btn skip-btn" onClick={skip}>
            Skip
          </button>
        )}
        <motion.p
          className="booster-explain"
          initial={false}
          animate={{ opacity: phase === "done" ? 1 : 0, y: phase === "done" ? 0 : 8 }}
          transition={{ delay: phase === "done" ? 0.3 : 0 }}
        >
          {amount !== undefined && (
            <>
              Every completion earns <b>+{formatPercent(amount)}</b> this week.
            </>
          )}
        </motion.p>
      </div>
    </div>
  );
}
