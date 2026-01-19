import { useState, useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { PictureInPicture2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PiPQRCodeProps {
  url: string;
  sessionCode: string;
}

// Validate session code format (alphanumeric, 1-10 chars)
const isValidSessionCode = (code: string): boolean => {
  return /^[A-Z0-9]{1,10}$/.test(code);
};

const PiPQRCode = ({ url, sessionCode }: PiPQRCodeProps) => {
  const [isPiP, setIsPiP] = useState(false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const qrSourceRef = useRef<HTMLDivElement>(null);

  // Create a canvas-based PiP using document picture-in-picture API
  const togglePiP = async () => {
    if (isPiP && pipWindow) {
      pipWindow.close();
      setPipWindow(null);
      setIsPiP(false);
      return;
    }

    // Validate session code before rendering
    if (!isValidSessionCode(sessionCode)) {
      console.error('Invalid session code format');
      return;
    }

    // Check for Document Picture-in-Picture API support
    if ('documentPictureInPicture' in window) {
      try {
        // @ts-ignore - Document PiP API
        const pip = await window.documentPictureInPicture.requestWindow({
          width: 300,
          height: 350,
        });

        // Style the PiP window
        const style = pip.document.createElement('style');
        style.textContent = `
          body {
            margin: 0;
            padding: 16px;
            background: linear-gradient(135deg, #1a1a2e, #16213e);
            font-family: system-ui, -apple-system, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            box-sizing: border-box;
          }
          .qr-container {
            background: white;
            padding: 12px;
            border-radius: 12px;
            margin-bottom: 12px;
          }
          .session-code {
            color: white;
            font-size: 18px;
            font-weight: bold;
            text-align: center;
            letter-spacing: 4px;
          }
          .label {
            color: rgba(255,255,255,0.7);
            font-size: 12px;
            text-align: center;
            margin-top: 8px;
          }
        `;
        pip.document.head.appendChild(style);

        // Create container using safe DOM methods (no innerHTML)
        const container = pip.document.createElement('div');
        
        const qrContainer = pip.document.createElement('div');
        qrContainer.className = 'qr-container';
        qrContainer.id = 'qr-mount';
        
        const sessionCodeEl = pip.document.createElement('div');
        sessionCodeEl.className = 'session-code';
        sessionCodeEl.textContent = sessionCode; // Safe - no HTML parsing
        
        const label = pip.document.createElement('div');
        label.className = 'label';
        label.textContent = 'Scan to listen';
        
        container.appendChild(qrContainer);
        container.appendChild(sessionCodeEl);
        container.appendChild(label);
        pip.document.body.appendChild(container);

        // Clone the QR SVG safely
        const qrSvg = qrSourceRef.current?.querySelector('svg');
        if (qrSvg) {
          const clonedSvg = qrSvg.cloneNode(true) as SVGElement;
          clonedSvg.setAttribute('width', '150');
          clonedSvg.setAttribute('height', '150');
          qrContainer.appendChild(clonedSvg);
        }

        pip.addEventListener('pagehide', () => {
          setIsPiP(false);
          setPipWindow(null);
        });

        setPipWindow(pip);
        setIsPiP(true);
      } catch (err) {
        console.error('Document PiP failed:', err);
      }
    } else {
      // Fallback: open a small popup window with local QR generation
      const popup = window.open(
        '',
        'QR Code',
        `width=300,height=350,left=${window.screen.width - 320},top=20`
      );
      
      if (popup) {
        // Create document structure safely using DOM methods
        popup.document.title = 'Scan to Listen';
        
        const style = popup.document.createElement('style');
        style.textContent = `
          body {
            margin: 0;
            padding: 16px;
            background: linear-gradient(135deg, #1a1a2e, #16213e);
            font-family: system-ui, -apple-system, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            box-sizing: border-box;
          }
          .qr-container {
            background: white;
            padding: 16px;
            border-radius: 12px;
            margin-bottom: 12px;
          }
          .session-code {
            color: white;
            font-size: 24px;
            font-weight: bold;
            text-align: center;
            letter-spacing: 4px;
          }
          .label {
            color: rgba(255,255,255,0.7);
            font-size: 14px;
            text-align: center;
            margin-top: 8px;
          }
        `;
        popup.document.head.appendChild(style);
        
        // Create content using safe DOM methods (no external QR service)
        const qrContainer = popup.document.createElement('div');
        qrContainer.className = 'qr-container';
        
        // Clone the local QR SVG instead of using external service
        const qrSvg = qrSourceRef.current?.querySelector('svg');
        if (qrSvg) {
          const clonedSvg = qrSvg.cloneNode(true) as SVGElement;
          clonedSvg.setAttribute('width', '180');
          clonedSvg.setAttribute('height', '180');
          qrContainer.appendChild(clonedSvg);
        }
        
        const sessionCodeEl = popup.document.createElement('div');
        sessionCodeEl.className = 'session-code';
        sessionCodeEl.textContent = sessionCode; // Safe - textContent, no HTML parsing
        
        const label = popup.document.createElement('div');
        label.className = 'label';
        label.textContent = 'Scan to listen';
        
        popup.document.body.appendChild(qrContainer);
        popup.document.body.appendChild(sessionCodeEl);
        popup.document.body.appendChild(label);
        
        popup.addEventListener('beforeunload', () => {
          setIsPiP(false);
          setPipWindow(null);
        });
        
        setPipWindow(popup);
        setIsPiP(true);
      }
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pipWindow) {
        pipWindow.close();
      }
    };
  }, [pipWindow]);

  return (
    <>
      {/* Hidden QR for cloning into PiP */}
      <div ref={qrSourceRef} className="hidden">
        <QRCodeSVG value={url} size={150} level="H" bgColor="#ffffff" fgColor="#000000" />
      </div>
      
      <Button
        variant="outline"
        size="sm"
        onClick={togglePiP}
        className={`gap-2 ${isPiP ? 'bg-primary/20' : ''}`}
      >
        {isPiP ? (
          <>
            <X className="w-4 h-4" />
            Close PiP
          </>
        ) : (
          <>
            <PictureInPicture2 className="w-4 h-4" />
            PiP QR
          </>
        )}
      </Button>
    </>
  );
};

export default PiPQRCode;
