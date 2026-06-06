import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  CheckCircle2,
  XCircle,
  Search,
  Copy,
  Check,
  Share2,
} from "lucide-react";

export default function VerifyReceipt() {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showError, setShowError] = useState(false);
  const [shareSupported, setShareSupported] = useState(false);

  useEffect(() => {
    setShareSupported(!!navigator.share);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleShare = async () => {
    if (!navigator.share) return;
    try {
      const shareText = `I've verified my vote on VerifiedVote! My receipt token is: ${token}`;
      await navigator.share({
        title: "My VerifiedVote Receipt",
        text: shareText,
        url: window.location.href,
      });
    } catch (err) {
      console.error("Failed to share:", err);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    setShowResult(false);
    setShowError(false);

    try {
      const res = await axios.get(
        `/api/public/verify-receipt/${encodeURIComponent(token.trim())}`,
      );
      setResult(res.data.data);
      setShowResult(true);
    } catch (err: any) {
      setError(err.response?.data?.message || "Receipt not found or invalid.");
      setShowError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (showResult || showError) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [showResult, showError]);

  return (
    <div className="max-w-xl mx-auto p-8 pt-16">
      <h1 className="text-3xl font-serif text-[#1a1a1a] mb-2">
        Verify Your Vote
      </h1>
      <p className="text-gray-600 mb-8">
        Enter the receipt token provided to you after casting your vote to
        confirm it was securely recorded. Note that this validates the inclusion
        of your vote, but strictly masks your choice and identity.
      </p>

      <form onSubmit={verify} className="flex flex-col sm:flex-row gap-4 mb-8">
        <div className="flex-1 flex">
          <input
            type="text"
            placeholder="Enter your cryptographic receipt token..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="flex-1 border p-3 rounded-l text-sm focus:ring focus:ring-[#5A5A40]/30 font-mono"
            required
          />
          {token && (
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 border-t border-r border-b border-gray-300 bg-white hover:bg-gray-50 flex items-center justify-center"
              title="Copy to clipboard"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-600" />
              ) : (
                <Copy className="w-4 h-4 text-gray-600" />
              )}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {shareSupported && token && (
            <button
              type="button"
              onClick={handleShare}
              className="px-4 py-3 border border-gray-300 rounded-md hover:bg-gray-50 flex items-center gap-2"
              title="Share receipt"
            >
              <Share2 className="w-4 h-4" />
              <span className="hidden sm:inline">Share</span>
            </button>
          )}
          <button
            type="submit"
            disabled={loading || !token.trim()}
            className="olive-button flex items-center justify-center gap-2"
          >
            {loading ? (
              "Verifying..."
            ) : (
              <>
                <Search className="w-4 h-4" /> Verify
              </>
            )}
          </button>
        </div>
      </form>

      {showError && (
        <div className="bg-red-50 text-red-700 p-6 border border-red-200 rounded flex gap-4 mt-6">
          <XCircle className="w-8 h-8 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-lg mb-1">Verification Failed</h3>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      {showResult && result && (
        <div className="bg-[#f5f2ed] border border-[rgba(26,26,26,0.1)] p-6 rounded flex gap-4 mt-6">
          <CheckCircle2 className="w-8 h-8 shrink-0 text-green-600 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-lg mb-3">
              Verified Successfully
            </h3>
            <div className="grid grid-cols-1 gap-3">
              <div className="flex justify-between items-center bg-white p-3 rounded border border-gray-100">
                <span className="text-sm text-gray-600">Election</span>
                <span className="text-sm font-medium">
                  {result.election_name}
                </span>
              </div>
              <div className="flex justify-between items-center bg-white p-3 rounded border border-gray-100">
                <span className="text-sm text-gray-600">Cast At</span>
                <span className="text-sm font-medium">
                  {new Date(result.cast_at).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center bg-white p-3 rounded border border-gray-100">
                <span className="text-sm text-gray-600">Status</span>
                <span className="text-sm font-medium text-green-700">
                  Securely Appended
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
