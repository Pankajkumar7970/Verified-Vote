/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, lazy, Suspense } from "react";
import {
  Routes,
  Route,
  useNavigate,
  Link,
  useLocation,
  Navigate,
} from "react-router-dom";
import axios from "axios";
import { useTranslation } from "react-i18next";
import {
  Shield,
  Loader2,
  X,
  Info,
  CheckCircle2,
  AlertCircle,
  Menu,
} from "lucide-react";
import { AuthProvider } from "./store/AuthContext";
import { VoterProvider, useVoterAuth } from "./store/VoterContext";
import { FontSizeProvider, useFontSize } from "./store/FontSizeContext";
import { Turnstile } from "@marsidev/react-turnstile";
import { Toaster, toast } from "react-hot-toast";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminLayout from "./pages/admin/AdminLayout";
import VerifyReceipt from "./pages/voter/VerifyReceipt";
import VoterRoute from "./components/features/VoterRoute";
import Skeleton from "./components/ui/Skeleton";

const RequestQueue = lazy(() => import("./pages/admin/RequestQueue"));
const PartyManagement = lazy(() => import("./pages/admin/PartyManagement"));
const ElectionManagement = lazy(
  () => import("./pages/admin/ElectionManagement"),
);
const VoterDashboard = lazy(() => import("./pages/voter/VoterDashboard"));
const RequestForm = lazy(() => import("./pages/voter/RequestForm"));
const VotingSession = lazy(() => import("./pages/voter/VotingSession"));
const AuditLogs = lazy(() => import("./pages/admin/AuditLogs"));
const ElectionResults = lazy(() => import("./pages/admin/ElectionResults"));
const AdminSessions = lazy(() => import("./pages/admin/AdminSessions"));
const PublicResults = lazy(() => import("./pages/voter/PublicResults"));
const CandidateManagement = lazy(
  () => import("./pages/admin/CandidateManagement"),
);
const AdminCron = lazy(() => import("./pages/admin/AdminCron"));
const VerificationStats = lazy(() => import("./pages/admin/VerificationStats"));

// Global Axios Interceptors
axios.interceptors.request.use((config) => {
  if (!config.headers["X-Request-ID"]) {
    config.headers["X-Request-ID"] = crypto.randomUUID();
  }
  return config;
});

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    // Global error handling
    const apiError = error.response?.data?.error;
    const apiMessage = error.response?.data?.message;

    // Don't show toast for certain errors that will be handled locally
    const skipToast = error.config?.skipToast;

    if (!skipToast) {
      const errorText =
        apiMessage || apiError || "An unexpected error occurred";
      toast.error(errorText);
    }

    return Promise.reject(error);
  },
);

function Navbar() {
  const { t, i18n } = useTranslation();
  const { fontSize, setFontSize, highContrast, setHighContrast } =
    useFontSize();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleLanguage = () => {
    i18n.changeLanguage(i18n.language === "en" ? "hi" : "en");
  };

  const cycleFont = () => {
    const order = ["normal", "large", "xlarge"] as const;
    const idx = order.indexOf(fontSize);
    setFontSize(order[(idx + 1) % order.length]);
  };

  return (
    <header className="border-b border-[rgba(26,26,26,0.1)] bg-white/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-[#5A5A40]" />
          <h1 className="text-xl font-semibold tracking-tight text-[#1a1a1a]">
            {t("app.title", "VerifiedVote")}
          </h1>
        </div>
        <div className="hidden md:flex items-center gap-4">
          <Link
            to="/verify-receipt"
            className="text-sm font-medium hover:text-[#5A5A40] transition-colors"
          >
            Verify Receipt
          </Link>
          <Link
            to="/admin/login"
            className="text-sm font-medium hover:text-[#5A5A40] transition-colors"
          >
            Admin Portal
          </Link>
          <button
            type="button"
            onClick={cycleFont}
            className="text-sm font-medium hover:text-[#5A5A40]"
            aria-label="Change font size"
          >
            Aa
          </button>
          <button
            type="button"
            onClick={() => setHighContrast(!highContrast)}
            className="text-sm font-medium hover:text-[#5A5A40]"
            aria-label="Toggle high contrast"
          >
            {highContrast ? "Contrast on" : "Contrast"}
          </button>
          <button
            type="button"
            onClick={toggleLanguage}
            className="text-sm font-medium hover:text-[#5A5A40]"
          >
            {i18n.language === "en" ? "हिंदी" : "English"}
          </button>
        </div>
        <button
          className="md:hidden p-2 text-[#5A5A40]"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          aria-label="Toggle Menu"
        >
          {isMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>
      
      {/* Mobile Menu Dropdown */}
      {isMenuOpen && (
        <div className="md:hidden border-t border-[rgba(26,26,26,0.1)] bg-white">
          <div className="px-4 py-3 space-y-3 flex flex-col items-start">
            <Link
              to="/verify-receipt"
              onClick={() => setIsMenuOpen(false)}
              className="text-sm font-medium hover:text-[#5A5A40] w-full text-left py-2"
            >
              Verify Receipt
            </Link>
            <Link
              to="/admin/login"
              onClick={() => setIsMenuOpen(false)}
              className="text-sm font-medium hover:text-[#5A5A40] w-full text-left py-2"
            >
              Admin Portal
            </Link>
            <button
              type="button"
              onClick={() => { cycleFont(); setIsMenuOpen(false); }}
              className="text-sm font-medium hover:text-[#5A5A40] w-full text-left py-2"
            >
              Change Font Size (Aa)
            </button>
            <button
              type="button"
              onClick={() => { setHighContrast(!highContrast); setIsMenuOpen(false); }}
              className="text-sm font-medium hover:text-[#5A5A40] w-full text-left py-2"
            >
              Toggle Contrast
            </button>
            <button
              type="button"
              onClick={() => { toggleLanguage(); setIsMenuOpen(false); }}
              className="text-sm font-medium hover:text-[#5A5A40] w-full text-left py-2"
            >
              {i18n.language === "en" ? "हिंदी" : "English"}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [voterId, setVoterId] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileLoading, setTurnstileLoading] = useState(true);
  const [showTooltip, setShowTooltip] = useState(false);

  // If Cloudflare's script never loads (network blocked / unreachable), unlock the
  // form after 6 s. The backend skips Turnstile when TURNSTILE_SECRET_KEY is unset.
  useEffect(() => {
    const timer = setTimeout(() => setTurnstileLoading(false), 6000);
    return () => clearTimeout(timer);
  }, []);

  // Check if voter ID matches expected format: 3 letters + 7 characters
  const isValidFormat = /^[A-Za-z]{3}.{7}$/.test(voterId);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const payload = {
        voter_id: voterId.trim(),
        mobile_number: mobileNumber.trim(),
        turnstile_token: turnstileToken,
      };
      const response = await axios.post("/api/auth/verify-voter", payload);
      toast.success("Voter ID verified!");
      navigate("/otp", {
        state: { session_nonce: response.data.session_nonce },
      });
    } catch (err: any) {
      const apiError = err.response?.data?.error;
      const apiMessage = err.response?.data?.message;
      let errorText = "Could not verify voter ID. Please try again.";

      if (apiError === "verification_failed") {
        errorText =
          apiMessage ||
          "Voter ID not found in the electoral roll. Use a test ID such as ABC1234567.";
      } else if (apiError === "too_many_requests") {
        errorText = "Too many requests. Please try again in 15 minutes.";
      } else if (
        apiError === "turnstile_required" ||
        apiError === "turnstile_failed"
      ) {
        errorText =
          "Security check failed. Clear TURNSTILE_SECRET_KEY in .env for local testing.";
      } else if (apiError === "internal_error") {
        errorText =
          "Server error — run: npm run migrate (database may need updates).";
      } else if (apiError === "invalid_voter_id") {
        errorText =
          "Invalid Voter ID format. Expected 3 letters + 7 characters (e.g. ABC1234567).";
      } else {
        errorText = apiMessage || errorText;
      }

      toast.error(errorText);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setVoterId("");
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <div className="warm-card max-w-md w-full p-6 sm:p-8 relative overflow-hidden">
        <div className="oversized-number absolute -top-4 -left-2 pointer-events-none select-none">
          01
        </div>

        <div className="relative z-10">
          <h2 className="text-2xl mb-2">
            {t("auth.verifyVoter", "Verify Voter ID")}
          </h2>
          <p className="text-sm text-gray-500 mb-6 font-sans">
            Please enter your Voter ID to access the remote voting portal.
          </p>
          <div className="relative">
            <p className="text-xs text-gray-400 mb-4 font-mono bg-gray-50 p-2 rounded flex items-center justify-between">
              <span>Dev test: ABC1234567 or XYZ9876543 — OTP is 123456</span>
              <button
                type="button"
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                className="ml-2 text-gray-400 hover:text-gray-600"
              >
                <Info className="w-3 h-3" />
              </button>
            </p>
            {showTooltip && (
              <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs p-2 rounded shadow-lg z-20">
                These are test IDs for local development only!
              </div>
            )}
          </div>

          <form onSubmit={handleVerify} className="space-y-6">
            <div>
              <label
                htmlFor="voterId"
                className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2"
              >
                {t("auth.voterIdLabel", "Voter ID Number")}
                {voterId.length > 0 &&
                  (isValidFormat ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-yellow-600" />
                  ))}
              </label>
              <div className="relative">
                <input
                  id="voterId"
                  type="text"
                  placeholder="ABC1234567"
                  required
                  value={voterId}
                  onChange={(e) => setVoterId(e.target.value.toUpperCase())}
                  className={`w-full px-4 py-2 bg-[#f5f2ed] border rounded-md focus:outline-none focus:ring-2 uppercase pr-10 ${voterId.length > 0
                      ? isValidFormat
                        ? "border-green-400 focus:ring-green-400"
                        : "border-yellow-400 focus:ring-yellow-400"
                      : "border-[rgba(26,26,26,0.2)] focus:ring-[#5A5A40]"
                    }`}
                />
                {voterId && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {voterId.length > 0 && !isValidFormat && (
                <p className="text-xs text-yellow-600 mt-1">
                  Expected: 3 letters + 7 characters (e.g. ABC1234567)
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="mobileNumber"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t("auth.mobileNumberLabel", "Mobile Number (with country code)")}
              </label>
              <input
                id="mobileNumber"
                type="tel"
                placeholder="+919876543210"
                required
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
                className="w-full px-4 py-2 bg-[#f5f2ed] border border-[rgba(26,26,26,0.2)] rounded-md focus:outline-none focus:ring-2 focus:ring-[#5A5A40]"
              />
            </div>

            <div className="flex justify-center my-4">
              {turnstileLoading && (
                <div className="flex items-center gap-2 text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading security check...</span>
                </div>
              )}
              <Turnstile
                siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
                onSuccess={(token) => {
                  setTurnstileToken(token);
                  setTurnstileLoading(false);
                }}
                onLoad={() => setTurnstileLoading(false)}
                onError={() => setTurnstileLoading(false)}
                onUnsupported={() => setTurnstileLoading(false)}
              />
            </div>

            <button
              type="submit"
              disabled={loading || turnstileLoading}
              className="w-full olive-button flex justify-center items-center font-medium font-sans disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Continue"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function VerifyOTP() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useVoterAuth();

  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [otpError, setOtpError] = useState(false);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const sessionNonce = location.state?.session_nonce;

  useEffect(() => {
    otpInputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [countdown]);

  if (!sessionNonce) {
    navigate("/");
    return null;
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setOtpError(false);

    try {
      const response = await axios.post("/api/auth/verify-otp", {
        otp,
        session_nonce: sessionNonce,
      });
      toast.success("OTP verified!");
      login(response.data.token);
      navigate("/dashboard");
    } catch (err: any) {
      setOtpError(true);
      let errorText = "Incorrect OTP. Please check and re-enter.";

      if (err.response?.data?.error === "max_attempts_reached") {
        errorText = "Too many attempts. Please request a new OTP.";
      } else if (err.response?.data?.error === "otp_expired") {
        errorText = "This OTP has expired. Please request a new one.";
      }

      toast.error(errorText);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setResending(true);
    setOtpError(false);
    try {
      await axios.post("/api/auth/resend-otp", {
        session_nonce: sessionNonce,
      });
      toast.success("OTP resent successfully!");
      setCountdown(60);
    } catch (err: any) {
      const errorText =
        err.response?.data?.message ||
        "Failed to resend OTP. Please try again.";
      toast.error(errorText);
    } finally {
      setResending(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6);
    setOtp(pastedData);
    setOtpError(false);
    if (pastedData.length === 6) {
      otpInputRefs.current[5]?.focus();
    } else {
      otpInputRefs.current[pastedData.length - 1]?.focus();
    }
  };

  const handleChange = (index: number, value: string) => {
    const newValue = value.replace(/\D/g, "");
    let newOtp = otp.split("");
    newOtp[index] = newValue;
    const finalOtp = newOtp.join("").slice(0, 6);
    setOtp(finalOtp);
    setOtpError(false);

    if (newValue && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <div className="warm-card max-w-md w-full p-8 relative overflow-hidden">
        <div className="oversized-number absolute -top-4 -left-2 pointer-events-none select-none">
          02
        </div>

        <div className="relative z-10">
          <h2 className="text-2xl mb-2">Security Verification</h2>
          <p className="text-sm text-gray-500 mb-6 font-sans">
            Enter the 6-digit OTP sent to your registered mobile number.
          </p>

          <form onSubmit={handleVerify} className="space-y-6">
            <div>
              <label
                htmlFor="otp-0"
                className="block text-sm font-medium text-gray-700 mb-3"
              >
                One-Time Password
              </label>
              <div className="flex gap-3 justify-center">
                {[0, 1, 2, 3, 4, 5].map((index) => (
                  <input
                    key={index}
                    ref={(el) => {
                      otpInputRefs.current[index] = el;
                    }}
                    id={`otp-${index}`}
                    type="text"
                    pattern="[0-9]"
                    maxLength={1}
                    value={otp[index] || ""}
                    onChange={(e) => handleChange(index, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(index, e)}
                    onPaste={index === 0 ? handlePaste : undefined}
                    className={`w-12 h-14 text-center text-xl font-mono border-2 rounded-lg focus:outline-none focus:ring-2 transition-all ${otpError
                        ? "border-red-500 focus:ring-red-500 bg-red-50"
                        : "border-gray-300 focus:ring-[#5A5A40] focus:border-[#5A5A40] bg-[#f5f2ed]"
                      }`}
                  />
                ))}
              </div>
              {otpError && (
                <p className="text-sm text-red-600 mt-3 text-center">
                  Incorrect OTP. Please try again.
                </p>
              )}
            </div>

            <button
              disabled={loading || otp.length < 6}
              type="submit"
              className="w-full olive-button flex justify-center items-center font-medium font-sans disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Verify"
              )}
            </button>
            <button
              type="button"
              onClick={handleResendOTP}
              disabled={resending || loading || countdown > 0}
              className="w-full text-sm text-gray-500 hover:text-[#1a1a1a] disabled:opacity-50"
            >
              {resending
                ? "Resending..."
                : countdown > 0
                  ? `Resend in ${countdown}s`
                  : "Resend OTP"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <VoterProvider>
        <FontSizeProvider>
          <div className="min-h-screen text-[#1a1a1a]">
            <Toaster position="top-right" />
            <Routes>
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/verify-receipt" element={<VerifyReceipt />} />
              <Route
                path="/results/:id"
                element={
                  <Suspense fallback={<div className="p-8">Loading…</div>}>
                    <PublicResults />
                  </Suspense>
                }
              />
              <Route path="/admin" element={<AdminLayout />}>
                <Route
                  index
                  element={<Navigate to="/admin/requests" replace />}
                />
                <Route
                  path="dashboard"
                  element={
                    <Suspense fallback={<div className="p-8">Loading…</div>}>
                      <RequestQueue />
                    </Suspense>
                  }
                />
                <Route
                  path="requests"
                  element={
                    <Suspense fallback={<div className="p-8">Loading…</div>}>
                      <RequestQueue />
                    </Suspense>
                  }
                />
                <Route
                  path="elections"
                  element={
                    <Suspense fallback={<div className="p-8">Loading…</div>}>
                      <ElectionManagement />
                    </Suspense>
                  }
                />
                <Route
                  path="elections/:id/candidates"
                  element={
                    <Suspense fallback={<div className="p-8">Loading…</div>}>
                      <CandidateManagement />
                    </Suspense>
                  }
                />
                <Route
                  path="elections/:id/verification"
                  element={
                    <Suspense fallback={<div className="p-8">Loading…</div>}>
                      <VerificationStats />
                    </Suspense>
                  }
                />
                <Route
                  path="elections/:id/results"
                  element={
                    <Suspense fallback={<div className="p-8">Loading…</div>}>
                      <ElectionResults />
                    </Suspense>
                  }
                />
                <Route
                  path="parties"
                  element={
                    <Suspense fallback={<div className="p-8">Loading…</div>}>
                      <PartyManagement />
                    </Suspense>
                  }
                />
                <Route
                  path="audit"
                  element={
                    <Suspense fallback={<div className="p-8">Loading…</div>}>
                      <AuditLogs />
                    </Suspense>
                  }
                />
                <Route
                  path="sessions"
                  element={
                    <Suspense fallback={<div className="p-8">Loading…</div>}>
                      <AdminSessions />
                    </Suspense>
                  }
                />
                <Route
                  path="cron"
                  element={
                    <Suspense fallback={<div className="p-8">Loading…</div>}>
                      <AdminCron />
                    </Suspense>
                  }
                />
              </Route>

              <Route
                path="/*"
                element={
                  <>
                    <Navbar />
                    <main>
                      <Routes>
                        <Route path="/" element={<Home />} />
                        <Route path="/otp" element={<VerifyOTP />} />
                        <Route
                          path="/dashboard"
                          element={
                            <VoterRoute>
                              <Suspense
                                fallback={<div className="p-8">Loading…</div>}
                              >
                                <VoterDashboard />
                              </Suspense>
                            </VoterRoute>
                          }
                        />
                        <Route
                          path="/request"
                          element={
                            <VoterRoute>
                              <Suspense
                                fallback={<div className="p-8">Loading…</div>}
                              >
                                <RequestForm />
                              </Suspense>
                            </VoterRoute>
                          }
                        />
                        <Route
                          path="/vote"
                          element={
                            <Suspense
                              fallback={<div className="p-8">Loading…</div>}
                            >
                              <VotingSession />
                            </Suspense>
                          }
                        />
                      </Routes>
                    </main>
                  </>
                }
              />
            </Routes>
          </div>
        </FontSizeProvider>
      </VoterProvider>
    </AuthProvider>
  );
}
