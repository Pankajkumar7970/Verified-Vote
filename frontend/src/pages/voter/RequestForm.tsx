import React, { useState, useEffect } from "react";
import axios from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Save, Upload, Camera } from "lucide-react";
import SelfieCapture from "../../components/features/SelfieCapture";
import { toast } from "react-hot-toast";

export default function RequestForm() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const electionId = searchParams.get("electionId");
  const [loading, setLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [form, setForm] = useState({
    reason_category: "medical",
    reason_detail: "",
    doc_type: "hospital_letter",
  });
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [voterIdPhoto, setVoterIdPhoto] = useState<File | null>(null);
  const [voterIdError, setVoterIdError] = useState<string | null>(null);
  const [selfieB64, setSelfieB64] = useState<string | null>(null);
  const [blinkFrames, setBlinkFrames] = useState<string[]>([]);
  const [livenessRetry, setLivenessRetry] = useState(false);
  const [hasDraftDoc, setHasDraftDoc] = useState(false);
  const [hasDraftVoterId, setHasDraftVoterId] = useState(false);
  const [hasDraftSelfie, setHasDraftSelfie] = useState(false);

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const VOTER_ID_ACCEPTED_TYPES = ["image/jpeg", "image/png"];
  const DOC_ACCEPTED_TYPES = ["image/jpeg", "image/png", "application/pdf"];

  const validateFile = (
    file: File | null,
    acceptedTypes: string[],
    fieldName: string,
  ): string | null => {
    if (!file) return null;

    const isValidType = acceptedTypes.some((type) => {
      if (type.includes("*")) {
        const mimeType = type.split("*")[0];
        return file.type.startsWith(mimeType);
      }
      return file.type === type;
    });

    if (!isValidType) {
      const typeNames = acceptedTypes
        .map((t) => t.replace("application/", "").replace("image/", ""))
        .join(", ");
      return `${fieldName} must be one of: ${typeNames}`;
    }

    if (file.size > MAX_FILE_SIZE) {
      return `${fieldName} is too large. Maximum size is 10MB.`;
    }

    return null;
  };

  useEffect(() => {
    const loadDraft = async () => {
      if (!electionId) return;
      try {
        const response = await axios.get(
          `/api/voter/requests/draft/${electionId}`,
        );
        if (response.data.draft) {
          setDraftId(response.data.draft.id);
          if (response.data.draft.reason_category) {
            setForm((prev) => ({
              ...prev,
              reason_category: response.data.draft.reason_category,
              reason_detail: response.data.draft.reason_detail || "",
              doc_type: response.data.draft.doc_type || "hospital_letter",
            }));
          }
          if (response.data.draft.has_doc) setHasDraftDoc(true);
          if (response.data.draft.has_voter_id_photo) setHasDraftVoterId(true);
          if (response.data.draft.has_selfie) setHasDraftSelfie(true);
          toast.success("Draft loaded!");
        }
      } catch (err) {
        // Ignore draft load errors
      }
    };
    loadDraft();
  }, [electionId]);

  if (!electionId) {
    return <div className="p-8">No election specified.</div>;
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (
    e: React.DragEvent,
    setter: (file: File | null) => void,
    acceptTypes: string[],
    errorSetter: (error: string | null) => void,
    fieldName: string,
  ) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = Array.from(e.dataTransfer.files)[0];
    if (droppedFile) {
      const error = validateFile(droppedFile, acceptTypes, fieldName);
      if (error) {
        errorSetter(error);
        toast.error(error);
      } else {
        errorSetter(null);
        setter(droppedFile);
      }
    }
  };

  const handleSaveDraft = async (e: React.MouseEvent) => {
    e.preventDefault();
    setSavingDraft(true);
    try {
      const formData = new FormData();
      formData.append("election_id", electionId);
      if (form.reason_category)
        formData.append("reason_category", form.reason_category);
      if (form.reason_detail)
        formData.append("reason_detail", form.reason_detail);
      if (form.doc_type) formData.append("doc_type", form.doc_type);
      if (file) formData.append("doc", file);
      if (voterIdPhoto) formData.append("voter_id_photo", voterIdPhoto);
      if (selfieB64) formData.append("selfie_b64", selfieB64);

      const response = await axios.post("/api/voter/requests/draft", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setDraftId(response.data.request_id);
      toast.success("Draft saved successfully!");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to save draft");
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate both files
    const voterIdValidationError = validateFile(
      voterIdPhoto,
      VOTER_ID_ACCEPTED_TYPES,
      "Voter ID photo",
    );
    const docValidationError = validateFile(
      file,
      DOC_ACCEPTED_TYPES,
      "Supporting document",
    );

    if (voterIdValidationError) {
      setVoterIdError(voterIdValidationError);
      return;
    }
    if (docValidationError) {
      setFileError(docValidationError);
      return;
    }

    // FIX 2: Use proper if blocks instead of inline return setError(...)
    // Previously: `return setError("...")` — works by accident (setError
    // returns void so it equals returning undefined), but is misleading.
    if (!file && !hasDraftDoc) {
      setError("Please upload a supporting document.");
      return;
    }
    if (!voterIdPhoto && !hasDraftVoterId) {
      setError("Please upload a photo of your Voter ID card.");
      return;
    }
    if (!selfieB64 && !hasDraftSelfie) {
      setError("A live verification photo is required (use the camera).");
      return;
    }

    setShowConfirm(true);
  };

  const confirmSubmit = async () => {
    setShowConfirm(false);
    setLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("election_id", electionId);
      formData.append("reason_category", form.reason_category);
      formData.append("reason_detail", form.reason_detail);
      formData.append("doc_type", form.doc_type);

      // FIX 1: Only append files when they are actually present.
      // Previously both branches appended file/voterIdPhoto/selfieB64
      // unconditionally even though all three are nullable. FormData.append()
      // with null sends the literal string "null" to the server — the server
      // receives a corrupt value instead of falling back to the saved draft.
      if (file) formData.append("doc", file);
      if (voterIdPhoto) formData.append("voter_id_photo", voterIdPhoto);
      if (selfieB64) formData.append("selfie_b64", selfieB64);
      if (blinkFrames.length > 0) {
        formData.append("blink_frames", JSON.stringify(blinkFrames));
      }

      // FIX 1 (cont): The two branches (draftId vs no draftId) had identical
      // body construction duplicated — now unified above, only the endpoint differs.
      if (draftId) {
        await axios.post(
          `/api/voter/requests/${draftId}/submit-draft`,
          formData,
          { headers: { "Content-Type": "multipart/form-data" } },
        );
      } else {
        await axios.post("/api/voter/requests/submit", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      navigate("/dashboard");
    } catch (err: any) {
      if (err.response?.data?.error === "liveness_failed") {
        setSelfieB64(null);
        setLivenessRetry(true);
        setError(
          err.response?.data?.message ||
          "Your selfie did not pass the liveness check. Please capture a new photo in good lighting.",
        );
      } else if (err.response?.data?.error === "duplicate_request") {
        setError(
          "You already have an active request or appeal for this election. Please withdraw it or wait for a final decision before submitting a new one.",
        );
      } else if (err.response?.data?.error === "missing_voter_id_photo") {
        setError("Please upload a photo of your Voter ID.");
      } else if (err.response?.data?.error === "missing_selfie") {
        setError("Please capture a live photo with your camera.");
      } else {
        setError(
          err.response?.data?.message ||
          "Failed to submit. Check file sizes (max 10MB each).",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-8 pt-8 pb-24 font-sans">
      <button
        type="button"
        onClick={() => navigate("/dashboard")}
        className="mb-6 flex items-center text-sm text-gray-500 hover:text-[#1a1a1a]"
      >
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
      </button>

      <div className="warm-card p-6 sm:p-10 space-y-8">
        <div>
          <h2 className="text-3xl font-serif">Apply for Postal Ballot</h2>
          <p className="text-gray-500 mt-2 text-sm leading-relaxed">
            Your request will be reviewed manually. Face matching runs only when
            you vote using your SMS link.
          </p>
        </div>

        {/* Step-by-Step Indicator */}
        <div className="flex items-center justify-between w-full max-w-lg mx-auto mb-8">
          <div className="flex flex-col items-center">
            <div className="w-8 h-8 rounded-full bg-[#5A5A40] text-white flex items-center justify-center text-sm font-semibold">
              1
            </div>
            <p className="text-xs text-gray-700 mt-2 text-center">Details</p>
          </div>
          <div className="flex-1 h-0.5 bg-[#5A5A40]/30 mx-2"></div>
          <div className="flex flex-col items-center">
            <div className="w-8 h-8 rounded-full bg-[#5A5A40]/30 text-gray-500 flex items-center justify-center text-sm font-semibold">
              2
            </div>
            <p className="text-xs text-gray-500 mt-2 text-center">Documents</p>
          </div>
          <div className="flex-1 h-0.5 bg-gray-300 mx-2"></div>
          <div className="flex flex-col items-center">
            <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-semibold">
              3
            </div>
            <p className="text-xs text-gray-500 mt-2 text-center">Verify</p>
          </div>
          <div className="flex-1 h-0.5 bg-gray-300 mx-2"></div>
          <div className="flex flex-col items-center">
            <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-semibold">
              4
            </div>
            <p className="text-xs text-gray-500 mt-2 text-center">Submit</p>
          </div>
        </div>

        {error && (
          <div
            className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md"
            role="alert"
            aria-live="assertive"
          >
            <span className="block sm:inline text-sm font-semibold">
              {error}
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label
                htmlFor="reasonCategory"
                className="block text-sm font-medium mb-1"
              >
                Reason Category
              </label>
              <select
                id="reasonCategory"
                className="w-full border px-4 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] focus:ring-[#5A5A40]"
                value={form.reason_category}
                onChange={(e) =>
                  setForm({ ...form, reason_category: e.target.value })
                }
              >
                <option value="medical">Medical / Disability</option>
                <option value="military">Military Service</option>
                <option value="abroad">Abroad / NRI</option>
                <option value="remote_work">
                  Remote Work / Essential Services
                </option>
              </select>
            </div>
            <div>
              <label
                htmlFor="docType"
                className="block text-sm font-medium mb-1"
              >
                Document Type
              </label>
              <select
                id="docType"
                className="w-full border px-4 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] focus:ring-[#5A5A40]"
                value={form.doc_type}
                onChange={(e) => setForm({ ...form, doc_type: e.target.value })}
              >
                <option value="disability_cert">Disability Certificate</option>
                <option value="army_id">Army ID</option>
                <option value="passport">Passport</option>
                <option value="hospital_letter">Hospital Letter</option>
                <option value="work_contract">Work Contract</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="voterIdPhoto"
              className="block text-sm font-medium mb-1"
            >
              Voter ID photo (JPG/PNG, max 10MB) *
            </label>
            <label
              htmlFor="voterIdPhoto"
              className={`block border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${voterIdPhoto || hasDraftVoterId
                ? "border-[#5A5A40] bg-[#5A5A40]/10"
                : "border-gray-300 hover:border-[#5A5A40]"
                } ${voterIdError ? "border-red-500" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) =>
                handleDrop(
                  e,
                  setVoterIdPhoto,
                  VOTER_ID_ACCEPTED_TYPES,
                  setVoterIdError,
                  "Voter ID photo",
                )
              }
            >
              {voterIdPhoto ? (
                <div className="space-y-2">
                  <Upload className="w-8 h-8 text-[#5A5A40] mx-auto" />
                  <p className="text-sm text-gray-700">{voterIdPhoto.name}</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setVoterIdPhoto(null);
                      setVoterIdError(null);
                    }}
                    className="text-sm text-red-600 underline"
                  >
                    Change
                  </button>
                </div>
              ) : hasDraftVoterId ? (
                <div className="space-y-2">
                  <Upload className="w-8 h-8 text-[#5A5A40] mx-auto" />
                  <p className="text-sm text-gray-700">saved_voter_id_photo.jpg</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setHasDraftVoterId(false);
                    }}
                    className="text-sm text-red-600 underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="w-8 h-8 text-gray-400 mx-auto" />
                  <p className="text-sm text-gray-600">
                    Drag and drop your Voter ID photo here, or click to select
                  </p>
                </div>
              )}
            </label>
            <input
              id="voterIdPhoto"
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const selectedFile = e.target.files?.[0] ?? null;
                if (selectedFile) {
                  const error = validateFile(
                    selectedFile,
                    VOTER_ID_ACCEPTED_TYPES,
                    "Voter ID photo",
                  );
                  if (error) {
                    setVoterIdError(error);
                    toast.error(error);
                  } else {
                    setVoterIdError(null);
                    setVoterIdPhoto(selectedFile);
                  }
                }
              }}
              aria-label="Upload Voter ID photo"
            />
            {voterIdError && (
              <p className="text-sm text-red-600 mt-2">{voterIdError}</p>
            )}
          </div>

          <div>
            <label htmlFor="docFile" className="block text-sm font-medium mb-1">
              Supporting document (PDF/JPG/PNG, max 10MB) *
            </label>
            <label
              htmlFor="docFile"
              className={`block border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${file || hasDraftDoc
                ? "border-[#5A5A40] bg-[#5A5A40]/10"
                : "border-gray-300 hover:border-[#5A5A40]"
                } ${fileError ? "border-red-500" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) =>
                handleDrop(
                  e,
                  setFile,
                  DOC_ACCEPTED_TYPES,
                  setFileError,
                  "Supporting document",
                )
              }
            >
              {file ? (
                <div className="space-y-2">
                  <Upload className="w-8 h-8 text-[#5A5A40] mx-auto" />
                  <p className="text-sm text-gray-700">{file.name}</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setFile(null);
                      setFileError(null);
                    }}
                    className="text-sm text-red-600 underline"
                  >
                    Change
                  </button>
                </div>
              ) : hasDraftDoc ? (
                <div className="space-y-2">
                  <Upload className="w-8 h-8 text-[#5A5A40] mx-auto" />
                  <p className="text-sm text-gray-700">saved_document.pdf</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setHasDraftDoc(false);
                    }}
                    className="text-sm text-red-600 underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="w-8 h-8 text-gray-400 mx-auto" />
                  <p className="text-sm text-gray-600">
                    Drag and drop your supporting document here, or click to
                    select
                  </p>
                </div>
              )}
            </label>
            <input
              id="docFile"
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              className="hidden"
              onChange={(e) => {
                const selectedFile = e.target.files?.[0] ?? null;
                if (selectedFile) {
                  const error = validateFile(
                    selectedFile,
                    DOC_ACCEPTED_TYPES,
                    "Supporting document",
                  );
                  if (error) {
                    setFileError(error);
                    toast.error(error);
                  } else {
                    setFileError(null);
                    setFile(selectedFile);
                  }
                }
              }}
              aria-label="Upload supporting document"
            />
            {fileError && (
              <p className="text-sm text-red-600 mt-2">{fileError}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="reasonDetail"
              className="block text-sm font-medium mb-1"
            >
              Details / Notes (Optional)
            </label>
            <textarea
              id="reasonDetail"
              className="w-full border px-4 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] focus:ring-[#5A5A40] h-24 resize-none"
              value={form.reason_detail}
              maxLength={500}
              onChange={(e) =>
                setForm({ ...form, reason_detail: e.target.value })
              }
            />
          </div>

          <div className="pt-6 border-t border-[rgba(26,26,26,0.1)]">
            <label className="block text-sm font-medium mb-4">
              Live verification photo *
            </label>
            <p className="text-xs text-gray-500 mb-4">
              Use your camera only (no file upload). This photo is stored for
              face match when you vote.
            </p>
            {livenessRetry && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
                Previous photo failed liveness. Face the camera directly with
                even lighting and try again.
              </p>
            )}
            {hasDraftSelfie && !selfieB64 ? (
              <div className="space-y-2 mt-4">
                <div className="relative border-2 border-[#5A5A40] rounded-md overflow-hidden aspect-square w-32 sm:w-48 bg-[#5A5A40]/10 flex flex-col items-center justify-center">
                  <Camera className="w-8 h-8 text-[#5A5A40] mb-2" />
                  <p className="text-sm text-gray-700 font-medium text-center px-4">Saved Draft Selfie</p>
                </div>
                <button
                  type="button"
                  onClick={() => setHasDraftSelfie(false)}
                  className="block text-sm text-red-600 underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <SelfieCapture
                allowUpload={false}
                value={selfieB64}
                onCapture={(b64, frames) => {
                  setSelfieB64(b64);
                  setBlinkFrames(frames || []);
                  setLivenessRetry(false);
                }}
                onClear={() => {
                  setSelfieB64(null);
                  setBlinkFrames([]);
                }}
              />
            )}
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={savingDraft}
              className="w-full border border-[#5A5A40] text-[#5A5A40] flex justify-center items-center py-3 text-lg disabled:opacity-50 rounded-md"
            >
              <Save className="w-5 h-5 mr-2" />
              {savingDraft ? "Saving draft..." : "Save Draft"}
            </button>
            <button
              type="submit"
              disabled={loading || (!file && !hasDraftDoc) || (!voterIdPhoto && !hasDraftVoterId) || (!selfieB64 && !hasDraftSelfie)}
              className="w-full olive-button flex justify-center items-center py-3 text-lg disabled:opacity-50"
            >
              {loading ? "Submitting securely..." : "Submit Request"}
            </button>
          </div>
        </form>
      </div>

      {showConfirm && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
            <h3
              id="confirm-dialog-title"
              className="text-lg font-semibold mb-4"
            >
              Confirm Submission
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to submit this postal ballot application?
              Please review your documents and information before proceeding.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSubmit}
                disabled={loading}
                className="px-4 py-2 olive-button rounded-md disabled:opacity-50"
              >
                {loading ? "Submitting..." : "Confirm Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}