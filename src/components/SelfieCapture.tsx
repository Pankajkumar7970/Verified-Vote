import React, { useRef, useState } from 'react';
import { Camera } from 'lucide-react';

export default function SelfieCapture({ onCapture }: { onCapture: (b64: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [camError, setCamError] = useState('');

  const startVideo = async () => {
    try {
      setCamError('');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      streamRef.current = stream;
      setHasStarted(true);
    } catch (err) {
      setCamError("Camera access is required for verification.");
    }
  };

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    // Strip the data URL prefix here or at the call site. The server expects raw base64.
    const dataUrl = canvas.toDataURL("image/jpeg");
    onCapture(dataUrl.split(',')[1]);

    // Stop Stream
    streamRef.current?.getTracks().forEach(t => t.stop());
  };

  return (
    <div className="bg-gray-100 rounded-md overflow-hidden aspect-square sm:aspect-video flex items-center justify-center relative w-full h-full min-h-[300px]">
      {camError ? (
         <div className="text-red-500 text-sm p-4 text-center bg-red-50 border border-red-200 rounded">{camError}</div>
      ) : !hasStarted ? (
        <button onClick={startVideo} type="button" className="olive-button flex items-center gap-2">
           <Camera className="w-5 h-5" /> Start Camera
        </button>
      ) : (
        <>
          <video ref={videoRef} autoPlay playsInline muted className="min-w-full min-h-full object-cover" />
          <button 
             type="button"
             onClick={captureFrame} 
             className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white/20 hover:bg-white/40 text-black p-4 rounded-full backdrop-blur-md transition-all shadow-lg border border-white/50"
          >
             <Camera className="w-8 h-8 text-white" />
          </button>
        </>
      )}
    </div>
  );
}
