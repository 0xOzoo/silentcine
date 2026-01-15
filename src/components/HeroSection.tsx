import { motion } from "framer-motion";
import { Play, Headphones, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import heroCinema from "@/assets/hero-cinema.jpg";

interface HeroSectionProps {
  onHostClick: () => void;
  onListenClick: () => void;
}

const HeroSection = ({ onHostClick, onListenClick }: HeroSectionProps) => {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <img
          src={heroCinema}
          alt="Outdoor cinema"
          className="w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
      </div>

      {/* Ambient glow effect */}
      <div className="absolute inset-0 z-0 ambient-glow" />

      <div className="container relative z-10 px-4 py-20">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-center max-w-4xl mx-auto"
        >
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary/50 backdrop-blur-sm border border-border mb-8"
          >
            <Radio className="w-4 h-4 text-primary animate-pulse-glow" />
            <span className="text-sm text-muted-foreground">Silent Cinema Experience</span>
          </motion.div>

          {/* Main Heading */}
          <h1 className="font-display text-5xl md:text-7xl lg:text-8xl font-bold mb-6 tracking-tight">
            <span className="text-foreground">Movies Outdoors,</span>
            <br />
            <span className="text-gradient">Sound in Your Pocket</span>
          </h1>

          {/* Subtitle */}
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Host outdoor screenings without disturbing neighbors. Viewers scan a QR code 
            to stream synchronized audio directly to their phones.
          </p>

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="flex flex-col sm:flex-row gap-4 justify-center items-center"
          >
            <Button variant="hero" size="xl" onClick={onHostClick}>
              <Play className="w-5 h-5" />
              Host a Screening
            </Button>
            <Button variant="cinema" size="xl" onClick={onListenClick}>
              <Headphones className="w-5 h-5" />
              Join & Listen
            </Button>
          </motion.div>

          {/* Feature highlights */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.8 }}
            className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {[
              { icon: "📱", title: "Scan & Play", desc: "Just scan the QR code" },
              { icon: "🎧", title: "Your Device", desc: "Use headphones or speakers" },
              { icon: "🤫", title: "Zero Noise", desc: "Perfect for neighborhoods" },
            ].map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 + index * 0.1, duration: 0.5 }}
                className="cinema-card p-6 rounded-2xl border border-border"
              >
                <div className="text-3xl mb-3">{feature.icon}</div>
                <h3 className="font-display font-semibold text-foreground mb-1">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
};

export default HeroSection;
