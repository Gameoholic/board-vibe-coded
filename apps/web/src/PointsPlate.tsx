import { formatPercent, formatPercentFixed, percentDecimals } from "@board/contracts";
import { animate, motion, useMotionValue } from "framer-motion";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface PointsPlateHandle {
  // The value span's box (not the whole plate) — a flyer aims here so it lands between the label and
  // the number rather than merging into the total.
  getValueRect: () => DOMRect | null;
  getBox: () => HTMLDivElement | null;
  // Replay the count's scale pulse (remounts the value span). Magnitude is the caller's to pass.
  pulse: (scale: number) => void;
}

interface PointsPlateProps {
  label: string;
  total: number; // integer thousandths-of-a-percent (see @board/contracts points.ts)
  children?: React.ReactNode; // overlays rendered inside the box (the HUD's particles/shockwaves)
}

// The framed points readout: corner ticks, a label, and a smooth count-up % value. The board HUD
// (`PointsCounter`) is this plate plus particle/shockwave bursts and free-canvas placement on top.
//
// `total` is integer thousandths-of-a-percent; the count-up holds a fixed decimal precision (from
// percentDecimals) for the whole tween rather than trimming only once it lands — trimming just at the
// end is what caused the visible "jump" (e.g. 1.45% → 1.5%) right as it settled.
const PointsPlate = forwardRef<PointsPlateHandle, PointsPlateProps>(({ label, total, children }, ref) => {
  const valueRef = useRef<HTMLSpanElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const display = useMotionValue(total);
  const precisionRef = useRef(percentDecimals(total));
  // The key remounts the value span to replay the pulse; the scale rides along with it so the
  // magnitude belongs to whatever triggered it rather than being fixed.
  const [pulse, setPulse] = useState({ key: 0, scale: 1.22 });

  useEffect(() => {
    precisionRef.current = percentDecimals(total);
    const controls = animate(display, total, { duration: 0.7, ease: [0.16, 1, 0.3, 1] });
    return controls.stop;
  }, [total, display]);

  useEffect(() => {
    const unsubscribe = display.on("change", (v) => {
      if (valueRef.current) valueRef.current.textContent = formatPercentFixed(v, precisionRef.current);
    });
    return unsubscribe;
  }, [display]);

  useImperativeHandle(ref, () => ({
    getValueRect: () => valueRef.current?.getBoundingClientRect() ?? null,
    getBox: () => boxRef.current,
    pulse: (scale) => setPulse((p) => ({ key: p.key + 1, scale })),
  }));

  return (
    <div className="points-counter" ref={boxRef}>
      <span className="corner corner-tl" />
      <span className="corner corner-tr" />
      <span className="corner corner-bl" />
      <span className="corner corner-br" />
      <span className="points-counter-label">{label}</span>
      <motion.span
        key={pulse.key}
        className="points-counter-value"
        animate={{ scale: [1, pulse.scale, 1] }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <span ref={valueRef}>{formatPercent(total)}</span>
      </motion.span>
      {children}
    </div>
  );
});

PointsPlate.displayName = "PointsPlate";

export default PointsPlate;
