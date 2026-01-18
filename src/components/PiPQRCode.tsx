import { useState, useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { PictureInPicture2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PiPQRCodeProps {
  url: string;
  sessionCode: string;
}

const PiPQRCode = ({ url, sessionCode }: PiPQRCodeProps) => {
  const [isPiP, setIsPiP] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);

  // Create a canvas-based PiP using document picture-in-picture API
  const togglePiP = async () => {
    if (isPiP && pipWindow) {
      pipWindow.close();
      setPipWindow(null);
      setIsPiP(false);
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

        // Create QR code container
        const container = pip.document.createElement('div');
        container.innerHTML = `
          <div class="qr-container" id="qr-mount"></div>
          <div class="session-code">${sessionCode}</div>
          <div class="label">Scan to listen</div>
        `;
        pip.document.body.appendChild(container);

        // Render QR code into PiP
        const qrMount = pip.document.getElementById('qr-mount');
        if (qrMount) {
          // Create a canvas with QR code
          const canvas = document.createElement('canvas');
          const size = 150;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          
          // Draw white background
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size, size);
          }
          
          // We'll use an SVG-to-canvas approach
          const svgString = `
            <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
              <foreignObject width="100%" height="100%">
                <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;">
                  ${document.querySelector('.pip-qr-source')?.innerHTML || ''}
                </div>
              </foreignObject>
            </svg>
          `;
          
          // Create image from SVG
          const img = new Image();
          const blob = new Blob([svgString], { type: 'image/svg+xml' });
          const urlBlob = URL.createObjectURL(blob);
          
          img.onload = () => {
            if (ctx) {
              ctx.drawImage(img, 0, 0, size, size);
              URL.revokeObjectURL(urlBlob);
            }
          };
          img.src = urlBlob;
          
          // Fallback: Just clone the QR SVG
          const qrSvg = document.querySelector('.pip-qr-source svg');
          if (qrSvg) {
            const clonedSvg = qrSvg.cloneNode(true) as SVGElement;
            clonedSvg.setAttribute('width', '150');
            clonedSvg.setAttribute('height', '150');
            qrMount.appendChild(clonedSvg);
          }
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
      // Fallback: open a small popup window
      const popup = window.open(
        '',
        'QR Code',
        `width=300,height=350,left=${window.screen.width - 320},top=20`
      );
      
      if (popup) {
        popup.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Scan to Listen</title>
            <style>
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
            </style>
          </head>
          <body>
            <div class="qr-container">
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}" width="180" height="180" />
            </div>
            <div class="session-code">${sessionCode}</div>
            <div class="label">Scan to listen</div>
          </body>
          </html>
        `);
        
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
      <div className="pip-qr-source hidden">
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
