import { motion, useReducedMotion } from "framer-motion";

export default function PageTransition({ children }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { x: "100%", opacity: 0.9 }}
      animate={{ x: 0, opacity: 1 }}
      exit={reduceMotion ? { opacity: 1 } : { x: "-30%", opacity: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      style={{ minHeight: "100dvh" }}
    >
      {children}
    </motion.div>
  );
}
