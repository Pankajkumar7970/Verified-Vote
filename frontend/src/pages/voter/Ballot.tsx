import React, { useState, useEffect } from "react";
import type { AxiosInstance } from "axios";
import { ShieldCheck } from "lucide-react";

interface Candidate {
  id: string;
  name: string;
  party_name: string;
  party_abbrev: string;
}

export default function Ballot({
  onVoteCast,
  errorMsg,
  setErrorMsg,
  sessionApi,
  showPrivacy = false,
}: {
  onVoteCast: (id: string) => void;
  errorMsg: string;
  setErrorMsg: (msg: string) => void;
  sessionApi: AxiosInstance;
  showPrivacy?: boolean;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [privacyAccepted, setPrivacyAccepted] = useState(!showPrivacy);

  // Auto-save/load from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("ballotSelection");
    if (saved) {
      setSelectedCandidate(saved);
    }
  }, []);

  useEffect(() => {
    if (selectedCandidate) {
      localStorage.setItem("ballotSelection", selectedCandidate);
    }
  }, [selectedCandidate]);

  // Clear saved selection on component unmount or when vote is cast
  useEffect(() => {
    return () => {
      localStorage.removeItem("ballotSelection");
    };
  }, []);

  useEffect(() => {
    sessionApi
      .get("/api/vote/candidates")
      .then((res) => {
        setCandidates(res.data.candidates);
        setLoading(false);
      })
      .catch((err) => {
        const code = err.response?.data?.error;
        if (code === "invalid_token_payload" || code === "invalid_token") {
          setErrorMsg(
            "Session token missing. Reload the voting link and verify OTP again.",
          );
        } else {
          setErrorMsg(
            "Failed to load candidates. Ensure candidates exist for this election.",
          );
        }
        setLoading(false);
      });
  }, [sessionApi, setErrorMsg]);

  if (loading) return <div className="p-12 text-center">Loading ballot...</div>;

  if (showPrivacy && !privacyAccepted) {
    return (
      <div className="max-w-lg mx-auto p-8 mt-12 warm-card text-center space-y-6">
        <h2 className="text-2xl font-serif">Vote privately</h2>
        <p className="text-gray-600 text-sm leading-relaxed">
          Please ensure you are voting privately and without pressure. Your vote
          is secret and cannot be traced to you.
        </p>
        <button
          type="button"
          className="olive-button w-full"
          onClick={() => setPrivacyAccepted(true)}
          aria-label="Continue to ballot"
        >
          I understand — continue
        </button>
      </div>
    );
  }

  if (confirming && selectedCandidate) {
    const candidate = candidates.find((c) => c.id === selectedCandidate);
    return (
      <div className="max-w-md mx-auto p-8 mt-12 bg-white border border-gray-200 rounded-xl text-center shadow-sm">
        <ShieldCheck className="w-12 h-12 text-[#5A5A40] mx-auto mb-4" />
        <h2 className="text-2xl font-serif mb-6">Confirm Your Vote</h2>

        <div className="bg-[#f5f2ed] p-6 rounded-lg mb-6">
          <p className="text-sm text-gray-500 uppercase tracking-wider mb-2">
            You are voting for
          </p>
          <p className="text-xl font-medium">{candidate?.name}</p>
          <p className="text-gray-600">{candidate?.party_name}</p>
        </div>

        {/* Warning about vote finality */}
        <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg mb-6 text-left">
          <p className="text-yellow-800 font-semibold flex items-center gap-2">
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            Important
          </p>
          <p className="text-yellow-700 text-sm mt-2">
            This action cannot be undone. Once you cast your vote, it will be
            finalized and you will not be able to change it.
          </p>
        </div>

        {errorMsg && <p className="text-red-600 text-sm mb-4">{errorMsg}</p>}

        <div className="flex gap-4">
          <button
            onClick={() => setConfirming(false)}
            className="flex-1 py-3 px-4 border rounded-md hover:bg-gray-50 text-gray-700 font-medium"
          >
            Go Back
          </button>
          <button
            onClick={() => {
              localStorage.removeItem("ballotSelection");
              onVoteCast(selectedCandidate);
            }}
            className="flex-1 py-3 px-4 olive-button font-medium"
          >
            Confirm & Cast
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-8 mt-4 sm:mt-12">
      <div className="mb-8 border-b pb-4">
        <h2 className="text-3xl font-serif text-[#1a1a1a]">Official Ballot</h2>
        <p className="text-gray-500 mt-2">
          Select one candidate and click 'Continue'. Your choice will be
          encrypted.
        </p>
      </div>

      {errorMsg && (
        <p
          className="text-red-500 mb-4 bg-red-50 p-3 rounded"
          role="alert"
          aria-live="assertive"
        >
          {errorMsg}
        </p>
      )}

      <div className="space-y-3">
        {candidates.map((c) => (
          <label
            key={c.id}
            className={`block p-5 border-2 rounded-xl cursor-pointer transition-all duration-200
              ${
                selectedCandidate === c.id
                  ? "border-[#5A5A40] bg-[#5A5A40]/10 shadow-md scale-[1.01]"
                  : "border-gray-200 hover:border-[#5A5A40]/50 hover:bg-[#5A5A40]/5"
              }
            `}
          >
            <div className="flex items-center gap-4">
              <div
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                  selectedCandidate === c.id
                    ? "border-[#5A5A40] bg-[#5A5A40]"
                    : "border-gray-300"
                }`}
              >
                {selectedCandidate === c.id && (
                  <div className="w-3 h-3 rounded-full bg-white" />
                )}
              </div>
              <input
                type="radio"
                name="candidate"
                value={c.id}
                checked={selectedCandidate === c.id}
                onChange={() => setSelectedCandidate(c.id)}
                className="sr-only"
                aria-label={`Vote for ${c.name}, ${c.party_name}`}
              />
              <div className="flex-1">
                <p className="font-semibold text-lg">{c.name}</p>
                <p className="text-gray-600 text-sm">
                  {c.party_name} {c.party_abbrev ? `(${c.party_abbrev})` : ""}
                </p>
              </div>
            </div>
          </label>
        ))}
      </div>

      <div className="mt-12 pt-6 border-t flex justify-end">
        <button
          onClick={() => setConfirming(true)}
          disabled={!selectedCandidate}
          className="olive-button px-8 py-3 text-lg font-medium disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
