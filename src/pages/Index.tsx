import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import HeroSection from "@/components/HeroSection";
import HostSession from "@/components/HostSession";
import ListenerView from "@/components/ListenerView";

type View = "home" | "host" | "listener";

const Index = () => {
  const [currentView, setCurrentView] = useState<View>("home");

  return (
    <div className="min-h-screen bg-background">
      <AnimatePresence mode="wait">
        {currentView === "home" && (
          <motion.div
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <HeroSection
              onHostClick={() => setCurrentView("host")}
              onListenClick={() => setCurrentView("listener")}
            />
          </motion.div>
        )}

        {currentView === "host" && (
          <motion.div
            key="host"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <HostSession onBack={() => setCurrentView("home")} />
          </motion.div>
        )}

        {currentView === "listener" && (
          <motion.div
            key="listener"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ListenerView onBack={() => setCurrentView("home")} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Index;
