import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import heroCinema from "@/assets/hero-cinema.jpg";

interface HeroSectionProps {
  onHostClick: () => void;
  onListenClick: () => void;
}

const HeroSection = ({ onHostClick, onListenClick }: HeroSectionProps) => {
  return (
    <section className="relative flex flex-col overflow-hidden bg-background" style={{ height: "calc(100vh - 3.5rem)" }}>

      {/* ── Background ── */}
      <div className="absolute inset-0 z-0">
        <img
          src={heroCinema}
          alt=""
          aria-hidden
          className="w-full h-full object-cover"
          style={{ animation: "slowZoom 22s ease-in-out infinite alternate" }}
        />
        {/* Asymmetric overlay: opaque on left (text side), opens up on right */}
        <div className="absolute inset-0 bg-gradient-to-r from-background from-35% via-background/75 via-55% to-background/15" />
        {/* Top + bottom vignette */}
        <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-transparent to-background/85" />
      </div>

      {/* ── Main content ── */}
      <div className="relative z-10 flex-1 flex items-center">
        <div className="w-full max-w-6xl mx-auto px-6 md:px-12 py-12">
          <div className="max-w-[620px]">

            {/* Brand label — small caps, amber, no badge/pill */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.4, ease: "easeOut" }}
              className="text-[11px] font-semibold tracking-[0.28em] uppercase text-primary mb-6"
            >
              SilentCine — Outdoor Cinema
            </motion.p>

            {/* Headline — mixed opacity, no gradient text */}
            <motion.h1
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.4, delay: 0.18, ease: "easeOut" }}
              className="font-display font-bold leading-[0.93] tracking-tight mb-6"
              style={{ fontSize: "clamp(3.2rem, 7.5vw, 5.8rem)" }}
            >
              <span className="block text-foreground">Cinema</span>
              <span className="block text-foreground">outside.</span>
              <span className="block text-foreground/35">Zero noise.</span>
            </motion.h1>

            {/* Description */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.4, delay: 0.36, ease: "easeOut" }}
              className="text-sm md:text-[15px] text-muted-foreground max-w-[360px] leading-relaxed mb-8"
            >
              Film outside. Audio straight to headphones via QR code, perfectly synced.
              <span className="block mt-1">No speakers needed, no neighbors bothered.</span>
            </motion.p>

            {/* CTAs — intentionally asymmetric */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.4, delay: 0.54, ease: "easeOut" }}
              className="flex flex-col sm:flex-row items-start sm:items-center gap-5"
            >
              {/* Primary: flat amber rectangle, no gradient, no rounded-full */}
              <button
                onClick={onHostClick}
                className="group flex items-center gap-3 bg-primary text-primary-foreground px-7 py-4 rounded-lg text-sm font-semibold tracking-wide transition-all duration-200 hover:bg-primary/90 active:scale-[0.98]"
              >
                Host a Screening
                <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>

              {/* Secondary: text link, no box, just an underline */}
              <button
                onClick={onListenClick}
                className="group flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors duration-200"
              >
                <span className="border-b border-current/30 group-hover:border-current/70 pb-px transition-colors duration-200">
                  Join as listener
                </span>
                <ArrowRight className="w-3.5 h-3.5 opacity-40 group-hover:opacity-80 transition-opacity duration-200" />
              </button>
            </motion.div>

          </div>
        </div>
      </div>

      {/* ── How it works strip ── */}
      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.4, delay: 0.8, ease: "easeOut" }}
        className="relative z-10 border-t border-border/25"
      >
        <div className="max-w-6xl mx-auto px-6 md:px-12 py-5">
          <div className="flex flex-col sm:flex-row gap-5 sm:gap-0 sm:divide-x divide-border/25">
            {[
              { num: "01", label: "Upload your film", sub: "Any format, any length" },
              { num: "02", label: "Share the QR code", sub: "On screen or printed" },
              { num: "03", label: "Watch together",   sub: "Audio syncs automatically" },
            ].map((step) => (
              <div
                key={step.num}
                className="sm:px-8 first:pl-0 last:pr-0 flex items-start gap-3.5"
              >
                <span className="font-mono text-[10px] font-semibold text-primary mt-0.5 shrink-0 tabular-nums">
                  {step.num}
                </span>
                <div>
                  <p className="text-xs font-semibold text-foreground/90 tracking-wide">{step.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{step.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.footer>

      <style>{`
        @keyframes slowZoom {
          from { transform: scale(1); }
          to   { transform: scale(1.09); }
        }
      `}</style>
    </section>
  );
};

export default HeroSection;
