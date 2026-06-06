import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Plus, Power, Eye, X, Copy, Settings } from "lucide-react";
import { useAuth } from "../../store/AuthContext";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";

interface Election {
  id: string;
  name: string;
  constituency: string;
  state: string;
  election_date: string;
  request_deadline: string;
  status: string;
  created_at: string;
}

type PasswordAction = { type: "activate" | "start-voting"; electionId: string };

export default function ElectionManagement() {
  const { admin } = useAuth();
  const queryClient = useQueryClient();
  const [newElection, setNewElection] = useState({
    name: "",
    constituency: "",
    state: "",
    election_date: "",
    request_deadline: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [passwordModal, setPasswordModal] = useState<PasswordAction | null>(
    null,
  );
  const [password, setPassword] = useState("");
  const [activeTab, setActiveTab] = useState<"active" | "history">("active");

  // Election Settings Modal State
  const [selectedSettingsId, setSelectedSettingsId] = useState<string | null>(
    null,
  );
  const [settingsForm, setSettingsForm] = useState({
    face_match_threshold: 0.6,
    liveness_threshold: 0.4,
    session_window_minutes: 15,
    withdrawal_deadline_hours: 48,
    max_otp_attempts: 3,
  });

  const { data: electionSettings, isLoading: loadingSettings } = useQuery({
    queryKey: ["election-settings", selectedSettingsId],
    queryFn: async () => {
      if (!selectedSettingsId) return null;
      const res = await axios.get(
        `/api/admin/elections/${selectedSettingsId}/settings`,
      );
      return res.data.settings;
    },
    enabled: !!selectedSettingsId,
  });

  React.useEffect(() => {
    if (electionSettings) {
      setSettingsForm({
        face_match_threshold: electionSettings.face_match_threshold ?? 0.6,
        liveness_threshold: electionSettings.liveness_threshold ?? 0.4,
        session_window_minutes: electionSettings.session_window_minutes ?? 15,
        withdrawal_deadline_hours:
          electionSettings.withdrawal_deadline_hours ?? 48,
        max_otp_attempts: electionSettings.max_otp_attempts ?? 3,
      });
    }
  }, [electionSettings]);

  const saveSettingsMutation = useMutation({
    mutationFn: async (payload: typeof settingsForm) => {
      return axios.patch(
        `/api/admin/elections/${selectedSettingsId}/settings`,
        payload,
        {
          skipToast: true, // We'll handle toast locally
        },
      );
    },
    onSuccess: () => {
      toast.success("Election settings updated successfully!");
      setSelectedSettingsId(null);
    },
    onError: (err: any) => {
      const errorMsg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        "Failed to update election settings.";
      toast.error(errorMsg);
    },
  });

  const { data: states } = useQuery({
    queryKey: ["geo-states"],
    queryFn: async () =>
      (await axios.get("/api/admin/geo/states")).data.states as {
        name: string;
        code: string;
      }[],
  });

  const { data: constituencies, isLoading: loadingConstituencies } = useQuery({
    queryKey: ["geo-constituencies", newElection.state],
    queryFn: async () =>
      (
        await axios.get("/api/admin/geo/constituencies", {
          params: { state: newElection.state },
        })
      ).data.constituencies as string[],
    enabled: !!newElection.state,
  });

  const { data: elections, isLoading } = useQuery({
    queryKey: ["admin-elections"],
    queryFn: async () => {
      const res = await axios.get("/api/admin/elections");
      return res.data.elections as Election[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: typeof newElection) =>
      axios.post("/api/admin/elections", payload, {
        skipToast: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-elections"] });
      setNewElection({
        name: "",
        constituency: "",
        state: "",
        election_date: "",
        request_deadline: "",
      });
      toast.success("Election created successfully!");
    },
    onError: (err: any) => {
      const errorMsg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        "Failed to create election.";
      toast.error(errorMsg);
    },
  });

  const activateMutation = useMutation({
    mutationFn: async ({
      id,
      password: pwd,
    }: {
      id: string;
      password: string;
    }) =>
      axios.post(
        `/api/admin/elections/${id}/activate`,
        { password: pwd },
        {
          skipToast: true,
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-elections"] });
      toast.success("Election is now active — voters can submit requests.");
      closePasswordModal();
    },
    onError: (err: any) => {
      const errorMsg =
        err.response?.data?.error || "Failed to activate election.";
      toast.error(errorMsg);
    },
  });

  const startVotingMutation = useMutation({
    mutationFn: async ({
      id,
      password: pwd,
    }: {
      id: string;
      password: string;
    }) =>
      axios.post(
        `/api/admin/elections/${id}/start-voting`,
        { password: pwd },
        {
          skipToast: true,
        },
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-elections"] });
      toast.success(
        `Voting started. ${data.data.sessions_created} voting links queued via SMS.`,
      );
      closePasswordModal();
    },
    onError: (err: any) => {
      const errorMsg = err.response?.data?.error || "Failed to start voting.";
      toast.error(errorMsg);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (id: string) =>
      axios.post(`/api/admin/elections/${id}/duplicate`, {
        skipToast: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-elections"] });
      toast.success("Election duplicated successfully!");
    },
    onError: (err: any) => {
      const errorMsg =
        err.response?.data?.error || "Failed to duplicate election.";
      toast.error(errorMsg);
    },
  });

  const closePasswordModal = () => {
    setPasswordModal(null);
    setPassword("");
  };

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordModal || !password) return;
    if (passwordModal.type === "activate") {
      activateMutation.mutate({ id: passwordModal.electionId, password });
    } else {
      startVotingMutation.mutate({ id: passwordModal.electionId, password });
    }
  };

  if (admin?.role !== "super_admin") {
    return (
      <div className="p-8 text-center text-gray-500">
        Only Super Admins can manage elections.
      </div>
    );
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !newElection.name.trim() ||
      !newElection.constituency ||
      !newElection.state ||
      !newElection.election_date ||
      !newElection.request_deadline
    ) {
      setError("Please fill in all required fields.");
      return;
    }

    try {
      const payload = {
        ...newElection,
        election_date: new Date(newElection.election_date).toISOString(),
        request_deadline: new Date(newElection.request_deadline).toISOString(),
      };
      createMutation.mutate(payload);
    } catch (err) {
      setError("Invalid date format provided.");
    }
  };

  const passwordPending =
    activateMutation.isPending || startVotingMutation.isPending;

  const activeElections =
    elections?.filter((e) => e.status !== "results_published") || [];
  const completedElections =
    elections?.filter((e) => e.status === "results_published") || [];

  const renderElectionTable = (
    electionsToRender: Election[],
    isHistory: boolean = false,
  ) => {
    if (electionsToRender.length === 0) {
      return (
        <div className="p-8 text-center text-gray-400">
          No {isHistory ? "completed" : "scheduled"} elections.
        </div>
      );
    }
    return (
      <table className="w-full text-left text-sm">
        <thead className="bg-[#5A5A40]/5 border-b border-[rgba(26,26,26,0.1)]">
          <tr>
            <th className="p-4 font-semibold text-[#5A5A40]">Name</th>
            <th className="p-4 font-semibold text-[#5A5A40]">Location</th>
            <th className="p-4 font-semibold text-[#5A5A40]">Date</th>
            <th className="p-4 font-semibold text-[#5A5A40]">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgba(26,26,26,0.1)]">
          {electionsToRender.map((e) => (
            <tr key={e.id} className="hover:bg-gray-50 transition-colors">
              <td className="p-4 font-medium">{e.name}</td>
              <td className="p-4 text-gray-500">
                {e.constituency}, {e.state}
              </td>
              <td className="p-4 text-gray-500">
                {new Date(e.election_date).toLocaleDateString()}
              </td>
              <td className="p-4 uppercase text-xs flex items-center justify-between flex-wrap gap-2">
                <span>{e.status}</span>
                {!isHistory && (
                  <>
                    {e.status === "draft" && (
                      <button
                        type="button"
                        onClick={() =>
                          confirmId === e.id
                            ? setPasswordModal({
                                type: "activate",
                                electionId: e.id,
                              })
                            : setConfirmId(e.id)
                        }
                        className="text-[10px] px-2 py-1 rounded border bg-green-100 text-green-800"
                      >
                        <Power className="inline w-3 h-3 mr-1" />{" "}
                        {confirmId === e.id ? "Confirm activate" : "Activate"}
                      </button>
                    )}
                    {e.status === "active" && (
                      <button
                        type="button"
                        onClick={() =>
                          setPasswordModal({
                            type: "start-voting",
                            electionId: e.id,
                          })
                        }
                        className="text-[10px] px-2 py-1 rounded border bg-blue-100 text-blue-800"
                      >
                        Start voting
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedSettingsId(e.id)}
                      className="text-[10px] px-2 py-1 rounded border bg-amber-50 text-amber-800 hover:bg-amber-100"
                    >
                      <Settings className="inline w-3 h-3 mr-1" /> Settings
                    </button>
                    <button
                      type="button"
                      onClick={() => duplicateMutation.mutate(e.id)}
                      className="text-[10px] px-2 py-1 rounded border bg-gray-100 text-gray-700 hover:bg-gray-200"
                    >
                      <Copy className="inline w-3 h-3 mr-1" /> Duplicate
                    </button>
                    <Link
                      to={`/admin/elections/${e.id}/candidates`}
                      className="text-[10px] text-[#5A5A40] border px-2 py-1 rounded"
                    >
                      Candidates
                    </Link>
                    <Link
                      to={`/admin/elections/${e.id}/verification`}
                      className="text-[10px] text-gray-600 border px-2 py-1 rounded"
                    >
                      Scores
                    </Link>
                  </>
                )}
                {(e.status === "voting" ||
                  e.status === "results_published") && (
                  <Link
                    to={`/admin/elections/${e.id}/results`}
                    className="text-[10px] text-blue-600 border border-blue-200 bg-blue-50 px-2 py-1 rounded inline-flex items-center gap-1"
                  >
                    <Eye className="w-3 h-3" /> Results
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="p-4 sm:p-8 space-y-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-end border-b pb-4">
        <div>
          <h2 className="text-3xl font-serif text-[#1a1a1a]">Elections</h2>
          <p className="text-sm text-gray-500 mt-1">
            Manage elections in the system.
          </p>
        </div>
      </div>

      {success && (
        <div className="bg-green-50 text-green-700 p-4 border border-green-200 rounded-md">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 text-red-700 p-4 border border-red-200 rounded-md">
          {error}
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-1">
          <div className="warm-card p-6 bg-white border border-[rgba(26,26,26,0.1)]">
            <h3 className="font-semibold mb-4">Create Election</h3>
            {error && <p className="text-xs text-red-600 mb-4">{error}</p>}
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name *</label>
                <input
                  className="w-full border px-3 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] text-sm"
                  value={newElection.name}
                  onChange={(e) =>
                    setNewElection({ ...newElection, name: e.target.value })
                  }
                  required
                  placeholder="2026 Assembly Election"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  State *
                </label>
                <select
                  className="w-full border px-3 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] text-sm"
                  required
                  value={newElection.state}
                  onChange={(e) =>
                    setNewElection({
                      ...newElection,
                      state: e.target.value,
                      constituency: "",
                    })
                  }
                  aria-label="Select state"
                >
                  <option value="">Select state</option>
                  {states?.map((s) => (
                    <option key={s.code} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Constituency *
                </label>
                <select
                  className="w-full border px-3 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] text-sm"
                  required
                  disabled={!newElection.state || loadingConstituencies}
                  value={newElection.constituency}
                  onChange={(e) =>
                    setNewElection({
                      ...newElection,
                      constituency: e.target.value,
                    })
                  }
                  aria-label="Select constituency"
                >
                  <option value="">
                    {!newElection.state
                      ? "Select state first"
                      : loadingConstituencies
                        ? "Loading…"
                        : "Select constituency"}
                  </option>
                  {constituencies?.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  Loaded from India geographic data. Must match voter
                  registration (case-insensitive).
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Election Date *
                </label>
                <input
                  type="date"
                  className="w-full border px-3 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] text-sm"
                  value={newElection.election_date}
                  onChange={(e) =>
                    setNewElection({
                      ...newElection,
                      election_date: e.target.value,
                    })
                  }
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Request Deadline (UTC) *
                </label>
                <input
                  type="datetime-local"
                  className="w-full border px-3 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] text-sm"
                  value={newElection.request_deadline}
                  onChange={(e) =>
                    setNewElection({
                      ...newElection,
                      request_deadline: e.target.value,
                    })
                  }
                  required
                />
              </div>
              <button
                type="submit"
                disabled={createMutation.isPending || !newElection.name}
                className="w-full olive-button py-2 flex justify-center items-center gap-2 text-sm disabled:opacity-50"
              >
                <Plus className="w-4 h-4" /> Create Election
              </button>
            </form>
          </div>
        </div>

        <div className="md:col-span-2">
          <div
            className="flex rounded-md border border-[rgba(26,26,26,0.15)] overflow-hidden text-sm mb-4"
            role="tablist"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "active"}
              aria-controls="active-elections-panel"
              onClick={() => setActiveTab("active")}
              className={`px-4 py-2 flex-1 sm:flex-none focus:outline-none focus:ring-2 inset-ring focus:ring-[#5A5A40] ${activeTab === "active" ? "bg-[#5A5A40] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              Active & Upcoming
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "history"}
              aria-controls="history-elections-panel"
              onClick={() => setActiveTab("history")}
              className={`px-4 py-2 flex-1 sm:flex-none focus:outline-none focus:ring-2 inset-ring focus:ring-[#5A5A40] ${activeTab === "history" ? "bg-[#5A5A40] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              History
            </button>
          </div>

          <div className="warm-card bg-white border border-[rgba(26,26,26,0.1)] overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center text-gray-400">Loading...</div>
            ) : activeTab === "active" ? (
              renderElectionTable(activeElections)
            ) : (
              renderElectionTable(completedElections, true)
            )}
          </div>
        </div>
      </div>

      {passwordModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="password-modal-title"
        >
          <div className="bg-white rounded-lg p-6 w-full max-w-sm shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 id="password-modal-title" className="font-serif text-lg">
                {passwordModal.type === "activate"
                  ? "Activate election"
                  : "Start voting"}
              </h3>
              <button
                type="button"
                onClick={closePasswordModal}
                aria-label="Close"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Enter your super admin password to continue.
            </p>
            <form onSubmit={submitPassword} className="space-y-4">
              <input
                type="password"
                autoFocus
                className="w-full border px-3 py-2 rounded-md text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Admin password"
                aria-label="Admin password"
                required
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closePasswordModal}
                  className="flex-1 border py-2 rounded text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!password || passwordPending}
                  className="flex-1 olive-button py-2 text-sm disabled:opacity-50"
                >
                  {passwordPending ? "Working…" : "Confirm"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedSettingsId && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h3 className="font-serif text-lg text-gray-900 flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#5A5A40]" />
                Election Settings
              </h3>
              <button
                type="button"
                onClick={() => setSelectedSettingsId(null)}
                aria-label="Close"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            {loadingSettings ? (
              <div className="p-8 text-center text-gray-400">
                Loading settings...
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveSettingsMutation.mutate(settingsForm);
                }}
                className="space-y-6"
              >
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Face Match Threshold:{" "}
                    <span className="text-[#5A5A40] font-mono">
                      {settingsForm.face_match_threshold}
                    </span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    className="w-full accent-[#5A5A40]"
                    value={settingsForm.face_match_threshold}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        face_match_threshold: parseFloat(e.target.value),
                      })
                    }
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Cosine similarity limit for matching requests with live
                    voting verification selfies. Higher means stricter matching.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Liveness Threshold:{" "}
                    <span className="text-[#5A5A40] font-mono">
                      {settingsForm.liveness_threshold}
                    </span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    className="w-full accent-[#5A5A40]"
                    value={settingsForm.liveness_threshold}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        liveness_threshold: parseFloat(e.target.value),
                      })
                    }
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Passive liveness detection scoring cutoff. Protects against
                    print/video spoof attacks.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Session (min)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      className="w-full border px-3 py-2 rounded bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] text-sm"
                      value={settingsForm.session_window_minutes}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          session_window_minutes:
                            parseInt(e.target.value) || 15,
                        })
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Max OTP Attempts
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      className="w-full border px-3 py-2 rounded bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] text-sm"
                      value={settingsForm.max_otp_attempts}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          max_otp_attempts: parseInt(e.target.value) || 3,
                        })
                      }
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Withdrawal Deadline (hours)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="168"
                    className="w-full border px-3 py-2 rounded bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] text-sm"
                    value={settingsForm.withdrawal_deadline_hours}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        withdrawal_deadline_hours:
                          parseInt(e.target.value) || 48,
                      })
                    }
                    required
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Hours before election date during which a voter is still
                    allowed to withdraw their request.
                  </p>
                </div>

                <div className="flex gap-3 border-t pt-4">
                  <button
                    type="button"
                    onClick={() => setSelectedSettingsId(null)}
                    className="flex-1 border py-2 rounded text-sm text-gray-600 border-gray-300 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saveSettingsMutation.isPending}
                    className="flex-1 olive-button py-2 text-sm disabled:opacity-50"
                  >
                    {saveSettingsMutation.isPending
                      ? "Saving..."
                      : "Save Settings"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
