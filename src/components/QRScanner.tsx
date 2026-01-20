import { useState, useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { motion, AnimatePresence } from "framer-motion";
import { X, Camera, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QRScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}

const QRScanner = ({ isOpen, onClose, onScan }: QRScannerProps) => {
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const startScanner = async () => {
      try {
        setError(null);
        
        // Create scanner instance
        scannerRef.current = new Html5Qrcode("qr-reader");
        
        await scannerRef.current.start(
          { facingMode },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          (decodedText) => {
            // Extract session code from URL or use as-is
            let code = decodedText;
            
            // Check if it's a URL with /listen/ path
            try {
              const url = new URL(decodedText);
              const pathMatch = url.pathname.match(/\/listen\/([A-Z0-9]+)/i);
              if (pathMatch) {
                code = pathMatch[1].toUpperCase();
              }
            } catch {
              // Not a URL, use as session code directly
              code = decodedText.toUpperCase();
            }
            
            // Stop scanner and return code
            stopScanner();
            onScan(code);
            onClose();
          },
          () => {
            // Ignore scan failures (no QR found in frame)
          }
        );
      } catch (err) {
        console.error("Scanner error:", err);
        setError("Unable to access camera. Please check permissions.");
      }
    };

    startScanner();

    return () => {
      stopScanner();
    };
  }, [isOpen, facingMode, onScan, onClose]);

  const stopScanner = () => {
    if (scannerRef.current?.isScanning) {
      scannerRef.current.stop().catch(console.error);
    }
  };

  const toggleCamera = async () => {
    stopScanner();
    setFacingMode(prev => prev === "environment" ? "user" : "environment");
  };

  const handleClose = () => {
    stopScanner();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/90 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4">
            <h2 className="text-white font-display text-lg font-bold">
              Scan QR Code
            </h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="text-white hover:bg-white/20"
            >
              <X className="w-6 h-6" />
            </Button>
          </div>

          {/* Scanner Area */}
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            <div 
              ref={containerRef}
              className="relative w-full max-w-sm aspect-square rounded-2xl overflow-hidden bg-black"
            >
              <div id="qr-reader" className="w-full h-full" />
              
              {/* Scanning overlay frame */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 border-2 border-white/30 rounded-2xl" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border-2 border-primary rounded-lg">
                  {/* Corner accents */}
                  <div className="absolute -top-0.5 -left-0.5 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg" />
                  <div className="absolute -top-0.5 -right-0.5 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg" />
                  <div className="absolute -bottom-0.5 -left-0.5 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg" />
                  <div className="absolute -bottom-0.5 -right-0.5 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg" />
                </div>
              </div>

              {/* Error message */}
              {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <div className="text-center p-6">
                    <Camera className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-white mb-2">{error}</p>
                    <Button variant="outline" onClick={() => setFacingMode(facingMode)}>
                      Try Again
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Instructions */}
            <p className="text-white/70 text-sm text-center mt-6 max-w-xs">
              Point your camera at the QR code displayed on the projection screen
            </p>

            {/* Switch camera button */}
            <Button
              variant="outline"
              onClick={toggleCamera}
              className="mt-4 bg-white/10 border-white/20 text-white hover:bg-white/20"
            >
              <SwitchCamera className="w-4 h-4 mr-2" />
              Switch Camera
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default QRScanner;
