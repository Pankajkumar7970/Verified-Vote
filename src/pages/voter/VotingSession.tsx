import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { Fingerprint, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import SelfieCapture from "../../components/SelfieCapture";
import Ballot from "./Ballot";
import { jsPDF } from "jspdf";
import {
  createVotingSessionApi,
  saveVotingSessionToken,
  clearVotingSessionToken,
} from "../../utils/votingSessionApi";

function resolveStorageKey(refCode: string) {
  return `vv_session_resolve_${refCode}`;
}

function loadCachedResolve(refCode: string): {
  phone_mask: string;
  nonce: string;
} | null {
  try {
    const raw = sessionStorage.getItem(resolveStorageKey(refCode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { phone_mask?: string; nonce?: string };
    if (parsed.phone_mask && parsed.nonce) {
      return { phone_mask: parsed.phone_mask, nonce: parsed.nonce };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveCachedResolve(
  refCode: string,
  data: { phone_mask: string; nonce: string },
) {
  sessionStorage.setItem(resolveStorageKey(refCode), JSON.stringify(data));
}

function clearCachedResolve(refCode: string) {
  sessionStorage.removeItem(resolveStorageKey(refCode));
}

export default function VotingSession() {
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get("ref");
  const sessionApi = useMemo(() => createVotingSessionApi(), []);

  const [step, setStep] = useState<
    "resolve" | "otp" | "face" | "ballot" | "receipt" | "error"
  >("resolve");
  const [resolveData, setResolveData] = useState<{
    phone_mask: string;
    nonce: string;
  } | null>(null);
  const [otp, setOtp] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [selfieStatus, setSelfieStatus] = useState<
    "idle" | "verifying" | "failed" | "success"
  >("idle");
  const [receiptToken, setReceiptToken] = useState("");
  const [sessionRef, setSessionRef] = useState("");
  const [sessionExpiryTime, setSessionExpiryTime] = useState<number | null>(
    null,
  ); // Timestamp in ms
  const [timeRemaining, setTimeRemaining] = useState<string | null>(null);
  const [selfieCaptureKey, setSelfieCaptureKey] = useState(0);
  const otpInputRef = useRef<HTMLInputElement>(null);

  const applyToken = (token: string) => {
    saveVotingSessionToken(token);
    // Session token is valid for 15 minutes (900 seconds)
    const expiry = Date.now() + 15 * 60 * 1000;
    setSessionExpiryTime(expiry);
  };

  // Format time remaining as mm:ss
  const formatTime = (ms: number) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  // Countdown timer for session expiry
  useEffect(() => {
    if (!sessionExpiryTime) return;

    const updateTimer = () => {
      const remaining = sessionExpiryTime - Date.now();
      if (remaining > 0) {
        setTimeRemaining(formatTime(remaining));
      } else {
        setTimeRemaining("00:00");
      }
    };

    updateTimer();
    const intervalId = setInterval(updateTimer, 1000);

    return () => clearInterval(intervalId);
  }, [sessionExpiryTime]);

  useEffect(() => {
    if (!refCode || step !== "resolve") return;

    clearVotingSessionToken();

    axios
      .get(`/api/session/status?ref_code=${encodeURIComponent(refCode)}`)
      .then((statusRes) => {
        const st = statusRes.data.state;
        if (statusRes.data.session_token) {
          applyToken(statusRes.data.session_token);
        }
        if (st === "face_verified") {
          setStep("ballot");
          return null;
        }
        if (st === "otp_verified" || st === "face_pending") {
          setStep("face");
          return null;
        }
        if (st === "link_opened") {
          const cached = loadCachedResolve(refCode);
          if (cached) {
            setResolveData(cached);
            setStep("otp");
            return null;
          }
        }
        return axios.post("/api/session/resolve", { ref_code: refCode });
      })
      .then((res) => {
        if (!res) return;
        if (res.data.session_token) {
          applyToken(res.data.session_token);
        }
        if (res.data.resume) {
          if (res.data.state === "face_verified") setStep("ballot");
          else if (
            res.data.state === "otp_verified" ||
            res.data.state === "face_pending"
          )
            setStep("face");
          else setStep("otp");
          if (res.data.nonce) {
            setResolveData({
              phone_mask: res.data.phone_mask,
              nonce: res.data.nonce,
            });
          }
        } else {
          const pending = {
            phone_mask: res.data.phone_mask,
            nonce: res.data.nonce,
          };
          setResolveData(pending);
          if (refCode && pending.nonce) saveCachedResolve(refCode, pending);
          setStep("otp");
        }
      })
      .catch((err) => {
        setErrorMsg(err.response?.data?.error || "Invalid or expired link.");
        setStep("error");
      });
  }, [refCode, step]);

  // Auto-focus OTP input when entering OTP step
  useEffect(() => {
    if (step === "otp" && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [step]);

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6);
    setOtp(pastedData);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.post("/api/session/verify-otp", {
        ref_code: refCode,
        nonce: resolveData?.nonce,
        otp,
      });
      applyToken(res.data.token);
      if (refCode) clearCachedResolve(refCode);
      if (res.data.state === "face_verified") setStep("ballot");
      else setStep("face");
      setErrorMsg("");
    } catch (err: any) {
      setErrorMsg(
        err.response?.data?.error === "invalid_otp"
          ? "Incorrect OTP"
          : "Verification failed",
      );
    }
  };

  const handleResendOtp = async () => {
    if (!refCode) return;
    try {
      const res = await axios.post("/api/session/resolve", {
        ref_code: refCode,
      });
      if (res.data.nonce) {
        const pending = {
          phone_mask: res.data.phone_mask,
          nonce: res.data.nonce,
        };
        setResolveData(pending);
        saveCachedResolve(refCode, pending);
      }
      setErrorMsg("");
    } catch {
      setErrorMsg("Could not resend OTP. Please try again.");
    }
  };

  const handleSelfieCapture = async (b64: string) => {
    setSelfieStatus("verifying");
    setErrorMsg("");
    try {
      const res = await sessionApi.post("/api/session/face-verify", {
        selfie_b64: b64,
      });
      if (res.data.session_id) setSessionRef(res.data.session_id.slice(0, 8));
      if (res.data.success && res.data.state === "face_verified") {
        setSelfieStatus("success");
        setTimeout(() => setStep("ballot"), 1500);
      } else {
        setSelfieStatus("failed");
        setErrorMsg(
          res.data.message ||
            "Face verification did not pass. Please try again.",
        );
      }
    } catch (err: any) {
      const serverError = err.response?.data?.error;
      if (serverError === "session_expired") {
        setErrorMsg("Your session has expired. Please use a new voting link.");
      } else if (serverError === "invalid_token_payload") {
        setErrorMsg(
          "Session token error. Reload the page, enter OTP again, then retry face verify.",
        );
      } else if (
        serverError === "invalid_token" ||
        serverError === "unauthorized"
      ) {
        setErrorMsg("Session expired. Reload the page and verify OTP again.");
      } else if (serverError === "invalid_state") {
        setErrorMsg(
          "Your session could not continue face verification. Reload the page and enter your OTP again.",
        );
      } else if (serverError === "ai_service_unavailable") {
        setErrorMsg(
          "AI verification service is offline. Your session is queued for manual review.",
        );
      } else if (serverError === "missing_baseline_selfie") {
        setErrorMsg(
          "No baseline photo on file. Submit a new authorization request with a live selfie.",
        );
      } else {
        setErrorMsg(
          err.response?.data?.message ||
            serverError ||
            "Face verification failed.",
        );
      }
      setSelfieStatus("failed");
    }
  };

  const handleVoteCast = async (candidateId: string) => {
    try {
      const res = await sessionApi.post("/api/vote/cast", {
        candidate_id: candidateId,
      });
      setReceiptToken(res.data.receipt_token);
      clearVotingSessionToken();
      if (refCode) clearCachedResolve(refCode);
      setStep("receipt");
    } catch {
      setErrorMsg("Failed to submit vote. Your session may have expired.");
    }
  };

  if (!refCode) {
    return (
      <div className="p-8 text-center text-red-600">
        Missing voting link reference code.
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
        <AlertCircle
          className="w-16 h-16 text-red-500 mb-4"
          aria-hidden="true"
        />
        <h2
          className="text-2xl font-serif mb-2"
          role="alert"
          aria-live="assertive"
        >
          Link Invalid or Expired
        </h2>
        <p className="text-gray-600">{errorMsg}</p>
      </div>
    );
  }

  if (step === "resolve") {
    return (
      <div className="flex justify-center p-12">Loading secure session...</div>
    );
  }

  if (step === "otp") {
    return (
      <div className="max-w-md mx-auto p-4 sm:p-8 mt-12 warm-card">
        <h2 className="text-2xl font-serif text-center mb-6">
          Verify Identity
        </h2>
        <p className="text-center text-gray-600 text-sm mb-6">
          An OTP has been sent to: <strong>{resolveData?.phone_mask}</strong>
        </p>
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <label htmlFor="otpInput" className="sr-only">
            One-Time Password
          </label>
          <input
            ref={otpInputRef}
            id="otpInput"
            type="text"
            className="w-full text-center tracking-widest text-lg py-3 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#5A5A40]"
            maxLength={6}
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            onPaste={handleOtpPaste}
            placeholder="000000"
            required
            aria-label="OTP input"
          />
          {errorMsg && (
            <p
              className="text-center text-red-500 text-sm"
              role="alert"
              aria-live="assertive"
            >
              {errorMsg}
            </p>
          )}
          <button type="submit" className="w-full olive-button py-3 text-lg">
            Verify OTP
          </button>
          <button
            type="button"
            onClick={handleResendOtp}
            className="w-full text-sm text-gray-500"
          >
            Resend OTP
          </button>
        </form>
      </div>
    );
  }

  if (step === "face") {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-8 mt-12 text-center">
        <Fingerprint className="w-12 h-12 mx-auto mb-4 text-[#5A5A40]" />
        <h2 className="text-2xl font-serif mb-4">Liveness & Face Match</h2>
        <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg mb-8 text-left">
          <h3 className="font-semibold text-blue-800 mb-2">
            How to pass verification:
          </h3>
          <ul className="text-sm text-blue-700 space-y-1 list-disc pl-5">
            <li>Ensure you are in a well-lit area</li>
            <li>Remove hats, sunglasses, or face coverings</li>
            <li>Look directly at the camera</li>
            <li>Follow the countdown and blink slowly</li>
          </ul>
        </div>
        {(selfieStatus === "idle" || selfieStatus === "verifying") && (
          <div className="bg-white p-4 inline-block border-[10px] border-[#f5f2ed] rounded-3xl shadow-sm">
            <SelfieCapture
              allowUpload={false}
              key={selfieCaptureKey}
              onCapture={handleSelfieCapture}
            />
            {selfieStatus === "verifying" && (
              <div className="mt-4 space-y-2">
                <div className="animate-spin rounded-full h-8 w-8 border-4 border-[#5A5A40] border-t-transparent mx-auto" />
                <p className="text-sm text-gray-600">
                  Verifying match... please wait.
                </p>
              </div>
            )}
          </div>
        )}
        {selfieStatus === "failed" && (
          <div className="py-12 space-y-4">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
            <p className="text-red-700">
              {errorMsg || "Face verification failed or is under review."}
            </p>
            {sessionRef && (
              <p className="text-gray-500 text-sm">Reference: {sessionRef}</p>
            )}
            <button
              type="button"
              onClick={() => {
                setSelfieStatus("idle");
                setErrorMsg("");
                setSelfieCaptureKey((prev) => prev + 1);
              }}
              className="olive-button px-6 py-2 text-sm"
            >
              Try Again
            </button>
          </div>
        )}
        {selfieStatus === "success" && (
          <div className="py-12">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
            <p className="font-medium text-lg mt-4">Verified successfully</p>
          </div>
        )}
      </div>
    );
  }

  if (step === "ballot") {
    const isUrgent =
      sessionExpiryTime && Date.now() > sessionExpiryTime - 2 * 60 * 1000;
    const isWarning =
      sessionExpiryTime &&
      Date.now() > sessionExpiryTime - 5 * 60 * 1000 &&
      !isUrgent;

    return (
      <div>
        {timeRemaining && (
          <div
            className={`p-4 mb-4 text-center flex items-center justify-center gap-2 border ${
              isUrgent
                ? "bg-red-50 border-red-200 text-red-800 animate-pulse"
                : isWarning
                  ? "bg-yellow-50 border-yellow-200 text-yellow-800"
                  : "bg-blue-50 border-blue-200 text-blue-800"
            }`}
          >
            <Clock className="w-5 h-5" />
            <span className="font-semibold">
              Session expires in: {timeRemaining}
            </span>
          </div>
        )}
        <Ballot
          sessionApi={sessionApi}
          onVoteCast={handleVoteCast}
          errorMsg={errorMsg}
          setErrorMsg={setErrorMsg}
          showPrivacy
        />
      </div>
    );
  }

  if (step === "receipt") {
    return (
      <div className="max-w-xl mx-auto p-4 sm:p-8 mt-12 bg-white border shadow-sm text-center">
        <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-3xl font-serif mb-4">Vote Cast Successfully</h2>
        <div className="bg-gray-50 border p-6 text-left rounded-md max-w-sm mx-auto mb-6">
          <p className="text-xs uppercase text-gray-500 mb-1">Receipt Token</p>
          <p className="text-sm font-mono break-all">{receiptToken}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            const doc = new jsPDF();
            const pageWidth = doc.internal.pageSize.getWidth();
            const centerX = pageWidth / 2;

            doc.setFont("helvetica", "bold");
            doc.setFontSize(20);
            doc.text("Verified Vote Receipt", centerX, 25, { align: "center" });

            doc.setFont("helvetica", "normal");
            doc.setFontSize(12);
            doc.text("Date: " + new Date().toLocaleString(), centerX, 40, {
              align: "center",
            });

            doc.setLineWidth(0.5);
            doc.line(20, 50, pageWidth - 20, 50);

            doc.setFontSize(14);
            doc.text("Receipt Token:", 20, 70);

            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            // Split token into lines for better readability
            const tokenLines = doc.splitTextToSize(
              receiptToken,
              pageWidth - 40,
            );
            doc.text(tokenLines, 20, 85);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.text("Keep this receipt for your records.", 20, 120);

            doc.save("verified-vote-receipt.pdf");
          }}
          className="olive-button px-6 py-2 text-sm"
        >
          Download Receipt (PDF)
        </button>
      </div>
    );
  }

  return null;
}
