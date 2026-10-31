'use client';
// Shows the real value on first render, then springs to new values; snaps under reduced motion.
import { useEffect } from "react";
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";

export default function AnimatedNumber({ value, format = (n) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const reduce = useReducedMotion();
  const spring = useSpring(value, { stiffness: 260, damping: 32 });
  const text = useTransform(spring, format);
  useEffect(() => {
    if (reduce) spring.jump(value);
    else spring.set(value);
  }, [value, reduce, spring]);
  return <motion.span>{text}</motion.span>;
}
