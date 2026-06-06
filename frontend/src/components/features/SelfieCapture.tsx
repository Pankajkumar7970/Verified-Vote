import React, { useRef, useState, useEffect, useCallback } from "react";
import { Camera, RotateCcw, Eye, Check, X } from "lucide-react";

function stripDataUrl(dataUrl: string): string {
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

type CaptureMode = "idle" | "started" | "challenge" | "review" | "done";

export default function SelfieCapture({
  onCapture,
  value,
  onClear,
  allowUpload = true,
}: {
  onCapture: (rawBase64: string, blinkFrames?: string[]) => void;
  value?: string | null;
  onClear?: () => void;
  allowUpload?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [mode, setMode] = useState<CaptureMode>("idle");
  const [camError, setCamError] = useState("");
  const [ready, setReady] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [reviewFrame, setReviewFrame] = useState<string | null>(null);
  const [reviewFrames, setReviewFrames] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [capturedB64, setCapturedB64] = useState<string | null>(null);

  // ─── FIX 1: Split "stop tracks" from "reset UI" ───────────────────────────
  // stopTracks() only kills the MediaStream — it does NOT touch mode or any
  // other UI state. Call this whenever you want the camera off but need the
  // current UI state preserved (e.g. switching to review).
  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // resetToIdle() is the full reset: tracks + all UI state back to baseline.
  // Only call this when you genuinely want to go back to the idle screen.
  const resetToIdle = useCallback(() => {
    stopTracks();
    setMode("idle");
    setReady(false);
    setCountdown(3);
    setReviewFrame(null);
    setReviewFrames([]);
    setCapturedB64(null);
    setCamError("");
  }, [stopTracks]);

  // Parent explicitly cleared the value → go back to idle
  const prevValueRef = useRef<string | null | undefined>(value);
  useEffect(() => {
    if (prevValueRef.current !== undefined && !value && mode === "done") {
      resetToIdle();
    }
    prevValueRef.current = value;
  }, [value, mode, resetToIdle]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopTracks();
  }, [stopTracks]);

  // Attach stream to <video> once camera is active
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (mode !== "started" || !video || !stream) return;

    video.srcObject = stream;
    setReady(false);
    const onReady = () => setReady(true);
    video.addEventListener("loadedmetadata", onReady);
    video
      .play()
      .catch(() =>
        setCamError("Could not start camera preview. Try upload instead."),
      );
    return () => video.removeEventListener("loadedmetadata", onReady);
  }, [mode]);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || !ready) return null;
    const { videoWidth: w, videoHeight: h } = video;
    if (!w || !h) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    return stripDataUrl(canvas.toDataURL("image/jpeg", 0.92));
  }, [ready]);

  // ─── FIX 2: startChallenge calls stopTracks(), NOT stopStream() ──────────
  // Previously calling stopStream() here reset mode→"idle" and wiped all
  // state right after setMode("review"), causing the review screen to never
  // appear (or flash and disappear) because React batches the state updates
  // and the mode reset from stopStream won the race.
  const startChallenge = useCallback(() => {
    if (!ready) return;
    setMode("challenge");
    setCountdown(3);

    const frames: string[] = [];
    let tick = 0;
    const totalTicks = 4;
    const frameInterval = 500;

    const firstFrame = captureFrame();
    if (firstFrame) frames.push(firstFrame);

    const interval = setInterval(() => {
      tick++;

      if (tick % 2 === 0) {
        setCountdown((c) => Math.max(0, c - 1));
      }

      const frame = captureFrame();
      if (frame) frames.push(frame);

      if (tick >= totalTicks) {
        clearInterval(interval);
        const primaryFrame =
          frames[Math.floor(frames.length / 2)] || frames[0];

        if (primaryFrame && frames.length >= 3) {
          // ✅ Stop tracks only — do NOT call resetToIdle/stopStream which
          //    would clobber the mode we're about to set.
          stopTracks();
          setReviewFrame(primaryFrame);
          setReviewFrames(frames);
          setMode("review"); // This now sticks because stopTracks doesn't touch mode
        } else {
          setCamError("Could not capture enough frames. Please try again.");
          resetToIdle();
        }
      }
    }, frameInterval);
  }, [ready, captureFrame, stopTracks, resetToIdle]);

  const startVideo = async () => {
    setCamError("");
    if (
      !window.isSecureContext &&
      !["localhost", "127.0.0.1"].includes(window.location.hostname)
    ) {
      setCamError(
        'Camera needs HTTPS or localhost. Please use "Upload photo" instead.',
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('Camera not supported. Please use "Upload photo" instead.');
      return;
    }
    try {
      stopTracks(); // clean up any previous stream without resetting UI
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setMode("started");
    } catch {
      setCamError(
        'Camera permission denied. Please use "Upload photo" instead.',
      );
    }
  };

  const handleFileUpload = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setCamError("Please choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setCamError("File too large. Please choose an image under 10MB.");
      return;
    }
    setUploadProgress(0);
    const reader = new FileReader();

    let progress = 0;
    const progressInterval = setInterval(() => {
      progress += Math.random() * 20;
      if (progress > 90) progress = 90;
      setUploadProgress(progress);
    }, 100);

    reader.onload = () => {
      clearInterval(progressInterval);
      setUploadProgress(100);
      const result = reader.result as string;
      const stripped = stripDataUrl(result);
      setTimeout(() => {
        stopTracks(); // clean up camera if it was running
        setReviewFrame(stripped);
        setReviewFrames([]);
        setMode("review");
        setUploadProgress(0);
        setCamError("");
      }, 300);
    };
    reader.onerror = () => {
      clearInterval(progressInterval);
      setUploadProgress(0);
      setCamError("Could not read image file.");
    };
    reader.readAsDataURL(file);

    setTimeout(() => {
      const input = document.querySelector(
        '[data-testid="selfie-upload-input"]',
      ) as HTMLInputElement;
      if (input) input.value = "";
    }, 1000);
  };

  const confirmPhoto = () => {
    if (reviewFrame) {
      setCapturedB64(reviewFrame);
      setMode("done");
      onCapture(reviewFrame, reviewFrames.length > 0 ? reviewFrames : undefined);
    }
  };

  const retakePhoto = () => {
    setReviewFrame(null);
    setReviewFrames([]);
    setCapturedB64(null);
    setCountdown(3);
    setMode("idle");
  };

  const displayValue = value || capturedB64;

  // ── Already have a confirmed photo ────────────────────────────────────────
  if (displayValue) {
    return (
      <div className="space-y-3">
        <div className="relative inline-block border-2 border-green-500 rounded-md overflow-hidden aspect-square w-32 sm:w-48">
          <img
            src={`data:image/jpeg;base64,${displayValue}`}
            alt="Verification selfie"
            className="w-full h-full object-cover"
          />
        </div>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-sm text-[#5A5A40] hover:underline flex items-center gap-1"
          >
            <RotateCcw className="w-4 h-4" /> Retake photo
          </button>
        )}
      </div>
    );
  }

  const isActive = mode === "started" || mode === "challenge";

  return (
    <div className="space-y-6">
      {/* Instructions */}
      {mode !== "done" && !value && (
        <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl">
          <h4 className="text-lg font-semibold text-blue-800 mb-2">
            Photo Tips
          </h4>
          <ul className="text-sm text-blue-700 space-y-1 list-disc pl-5">
            <li>Ensure you are in good lighting</li>
            <li>Look directly at the camera</li>
            <li>Remove any hats, sunglasses, or face coverings</li>
            <li>Make sure your entire face is visible</li>
          </ul>
        </div>
      )}

      {camError && (
        <div
          className="text-red-700 text-lg p-4 bg-red-50 border-2 border-red-300 rounded-xl"
          role="alert"
          aria-live="assertive"
        >
          {camError}
        </div>
      )}

      <div className="bg-gray-100 rounded-2xl overflow-hidden aspect-square sm:aspect-video flex items-center justify-center relative w-full min-h-[280px]">
        {mode === "review" && reviewFrame ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <img
              src={`data:image/jpeg;base64,${reviewFrame}`}
              alt="Captured photo preview"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/30 flex items-end justify-center pb-8">
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={retakePhoto}
                  className="bg-white text-red-600 px-8 py-4 rounded-full text-xl font-semibold flex items-center gap-2 shadow-lg"
                >
                  <X className="w-6 h-6" /> Retake
                </button>
                <button
                  type="button"
                  onClick={confirmPhoto}
                  className="olive-button px-8 py-4 rounded-full text-xl font-semibold flex items-center gap-2 shadow-lg"
                >
                  <Check className="w-6 h-6" /> Use Photo
                </button>
              </div>
            </div>
          </div>
        ) : !isActive ? (
          <button
            type="button"
            onClick={startVideo}
            className="olive-button flex items-center gap-3 px-8 py-4 text-xl"
          >
            <Camera className="w-8 h-8" /> Start Camera
          </button>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />

            {/* Face centering overlay */}
            {ready && (
              <div className="absolute inset-0 pointer-events-none z-10">
                <div className="absolute inset-0 flex flex-col justify-between opacity-20">
                  <div className="h-px bg-white w-full"></div>
                  <div className="h-px bg-white w-full"></div>
                </div>
                <div className="absolute inset-0 flex flex-row justify-between opacity-20">
                  <div className="w-px bg-white h-full"></div>
                  <div className="w-px bg-white h-full"></div>
                </div>
                <div className="w-3/5 h-3/5 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border-4 border-white rounded-full"></div>
              </div>
            )}

            {/* Challenge overlay */}
            {mode === "challenge" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-end pb-12 z-20 pointer-events-none">
                <div className="w-full max-w-sm mx-4 space-y-4">
                  <div className="flex justify-center">
                    <div className="relative w-32 h-32">
                      <svg
                        className="w-full h-full transform -rotate-90"
                        viewBox="0 0 100 100"
                      >
                        <circle
                          cx="50"
                          cy="50"
                          r="45"
                          stroke="rgba(255,255,255,0.2)"
                          strokeWidth="8"
                          fill="none"
                        />
                        <circle
                          cx="50"
                          cy="50"
                          r="45"
                          stroke="white"
                          strokeWidth="8"
                          fill="none"
                          strokeDasharray="283"
                          strokeDashoffset={283 - 283 * (countdown / 3)}
                          className="transition-all duration-500"
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-5xl font-extrabold text-white">
                          {countdown}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-black/70 text-white rounded-3xl px-8 py-6 text-center space-y-3">
                    <p className="text-xl font-semibold flex items-center gap-3 justify-center">
                      <Eye className="w-8 h-8 flex-shrink-0" />
                      Keep blinking slowly!
                    </p>
                    <div className="w-full bg-white/30 rounded-full h-2">
                      <div
                        className="bg-white h-2 rounded-full transition-all duration-500"
                        style={{ width: `${(1 - countdown / 3) * 100}%` }}
                      />
                    </div>
                    <p className="text-base">Almost done...</p>
                  </div>
                </div>
              </div>
            ) : ready ? (
              <div className="absolute inset-0 flex flex-col items-center justify-between py-8 z-20">
                <div className="bg-black/70 text-white rounded-3xl px-8 py-6 text-center max-w-sm mx-4">
                  <p className="text-xl font-semibold flex items-center gap-3 justify-center">
                    <Eye className="w-8 h-8 flex-shrink-0" />
                    Look at the big circle
                  </p>
                  <p className="text-lg mt-3">
                    and <strong>blink slowly 2–3 times</strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={startChallenge}
                  className="mb-4 bg-[#5A5A40] text-white px-10 py-5 rounded-full shadow-xl text-2xl font-semibold"
                  aria-label="Start blink challenge"
                >
                  I'm Ready
                </button>
              </div>
            ) : (
              <p className="relative z-20 text-xl text-gray-700 bg-white/90 px-6 py-3 rounded-2xl">
                Starting camera...
              </p>
            )}
          </>
        )}
      </div>

      {/* Upload progress */}
      {uploadProgress > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm text-gray-700">
            <span>Processing photo...</span>
            <span>{Math.round(uploadProgress)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-[#5A5A40] h-3 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        {allowUpload && (
          <label className="inline-flex items-center gap-3 text-xl text-[#5A5A40] cursor-pointer border-2 border-[#5A5A40]/30 px-8 py-4 rounded-xl hover:bg-[#5A5A40]/10 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-[#5A5A40]">
            Upload photo instead
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              data-testid="selfie-upload-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileUpload(f);
              }}
            />
          </label>
        )}
        {isActive && (
          <button
            type="button"
            onClick={resetToIdle}
            className="text-xl text-gray-600 hover:underline"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}