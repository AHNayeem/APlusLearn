"use client";

import { useEffect, useRef } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";

/**
 * Entrance animation used across marketing sections (§31).
 *
 * Deliberately restrained: a short fade and a small rise, once, when the
 * element scrolls into view. `useReducedMotion` collapses it to a plain fade
 * for anyone who has asked for less motion (§34).
 */
export function Reveal({ children, delay = 0, y = 16, className, as = "div" }) {
  const reduced = useReducedMotion();
  const MotionTag = motion[as] ?? motion.div;

  return (
    <MotionTag
      initial={{ opacity: 0, y: reduced ? 0 : y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: reduced ? 0.2 : 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </MotionTag>
  );
}

/** Staggers children — each item reveals slightly after the last. */
export function RevealGroup({ children, className, stagger = 0.07, as = "div" }) {
  const reduced = useReducedMotion();
  const MotionTag = motion[as] ?? motion.div;

  return (
    <MotionTag
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-60px" }}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: reduced ? 0 : stagger } },
      }}
      className={className}
    >
      {children}
    </MotionTag>
  );
}

export function RevealItem({ children, className, y = 16, as = "div" }) {
  const reduced = useReducedMotion();
  const MotionTag = motion[as] ?? motion.div;

  return (
    <MotionTag
      variants={{
        hidden: { opacity: 0, y: reduced ? 0 : y },
        visible: { opacity: 1, y: 0, transition: { duration: reduced ? 0.2 : 0.5, ease: [0.22, 1, 0.36, 1] } },
      }}
      className={className}
    >
      {children}
    </MotionTag>
  );
}

/** Counts a number up when it scrolls into view — used on stat rows. */
export function CountUp({ value, duration = 1.1, prefix = "", suffix = "", className }) {
  const reduced = useReducedMotion();
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => Math.round(latest).toLocaleString("en-CA"));
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  useEffect(() => {
    if (!inView) return undefined;
    if (reduced) {
      count.set(value);
      return undefined;
    }
    const controls = animate(count, value, { duration, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [inView, reduced, value, duration, count]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {/* The visible number is driven by a motion value; the static one keeps
          it readable to assistive tech and before hydration. */}
      <motion.span aria-hidden="true">{rounded}</motion.span>
      <span className="sr-only">{value.toLocaleString("en-CA")}</span>
      {suffix}
    </span>
  );
}
