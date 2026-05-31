import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { ChevronLeft, ChevronRight, X, Search, Filter } from "lucide-react";

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function AdminSessions() {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterState, setFilterState] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-sessions", currentPage, pageSize],
    queryFn: async () => {
      const res = await axios.get("/api/admin/sessions", {
        params: { page: currentPage, limit: pageSize },
      });
      return {
        sessions: res.data.sessions,
        pagination: res.data.pagination as PaginationInfo,
      };
    },
  });

  const filteredSessions =
    data?.sessions?.filter((s: any) => {
      const matchesSearch =
        s.ref_code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.election_name?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFilter = filterState === "all" || s.state === filterState;
      return matchesSearch && matchesFilter;
    }) || [];

  const pendingSessions =
    data?.sessions?.filter((s: any) => s.state === "face_pending") || [];

  const approveMutation = useMutation({
    mutationFn: (id: string) =>
      axios.post(`/api/admin/sessions/${id}/approve-face`, { note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sessions"] });
      setSelected(null);
      setNote("");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      axios.post(`/api/admin/sessions/${id}/revoke`, { reason: note }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["admin-sessions"] }),
  });

  const handlePageChange = (newPage: number) => {
    if (
      newPage >= 1 &&
      (!data?.pagination || newPage <= data.pagination.totalPages)
    ) {
      setCurrentPage(newPage);
    }
  };

  if (isLoading) return <div className="p-8">Loading sessions...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-3xl font-serif">Voting Sessions</h2>
        <div className="flex items-center gap-4 flex-wrap">
          {pendingSessions.length > 0 && (
            <div className="bg-red-100 border border-red-300 px-4 py-2 rounded-md flex items-center gap-2">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-red-700">
                {pendingSessions.length} session
                {pendingSessions.length > 1 ? "s" : ""} requiring review
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <select
            value={filterState}
            onChange={(e) => setFilterState(e.target.value)}
            className="p-2 rounded border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]"
          >
            <option value="all">All States</option>
            <option value="link_opened">Link Opened</option>
            <option value="face_pending">Face Pending</option>
            <option value="face_verified">Face Verified</option>
            <option value="voting">Voting</option>
            <option value="vote_cast">Vote Cast</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      </div>

      <div className="warm-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-[#f5f2ed] text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Ref</th>
              <th className="px-4 py-3">Election</th>
              <th className="px-4 py-3">State</th>
              <th className="px-4 py-3">Face</th>
              <th className="px-4 py-3">Liveness</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filteredSessions.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-500">
                  No sessions found
                </td>
              </tr>
            ) : (
              filteredSessions.map((s: any) => (
                <tr
                  key={s.id}
                  className={s.state === "face_pending" ? "bg-yellow-50" : ""}
                >
                  <td className="px-4 py-3 font-mono text-xs flex items-center gap-2">
                    {s.ref_code}
                    {s.state === "face_pending" && (
                      <span className="bg-yellow-200 text-yellow-800 text-xs px-2 py-1 rounded-full">
                        Review
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{s.election_name}</td>
                  <td className="px-4 py-3 capitalize">
                    {s.state.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-3">
                    {s.face_score != null ? s.face_score.toFixed(2) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {s.liveness_score != null
                      ? s.liveness_score.toFixed(2)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {s.state === "face_pending" && (
                      <button
                        type="button"
                        className="text-green-700 text-xs mr-2"
                        onClick={() => setSelected(s)}
                      >
                        Review
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-red-600 text-xs"
                      onClick={() => revokeMutation.mutate(s.id)}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination Controls */}
        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="px-6 py-4 border-t border-[rgba(26,26,26,0.1)] flex items-center justify-between flex-wrap gap-4">
            <div className="text-sm text-gray-500">
              Showing page {data.pagination.page} of{" "}
              {data.pagination.totalPages}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => handlePageChange(data.pagination.page - 1)}
                disabled={data.pagination.page <= 1}
                className="p-2 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-gray-600">
                {data.pagination.page}
              </span>
              <button
                onClick={() => handlePageChange(data.pagination.page + 1)}
                disabled={data.pagination.page >= data.pagination.totalPages}
                className="p-2 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(parseInt(e.target.value));
                  setCurrentPage(1);
                }}
                className="ml-4 p-2 rounded border border-gray-300 text-sm"
              >
                <option value={10}>10 per page</option>
                <option value={20}>20 per page</option>
                <option value={50}>50 per page</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Review Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 font-sans">
          <div className="warm-card w-full max-w-4xl bg-white max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-[rgba(26,26,26,0.1)] p-4 flex justify-between items-center">
              <h3 className="text-xl font-serif">
                Review Session: {selected.ref_code}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setNote("");
                }}
                aria-label="Close"
              >
                <X className="w-6 h-6 text-gray-400" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Photo Comparison */}
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-gray-600">
                    Baseline Photo (Request)
                  </h4>
                  {selected.baseline_selfie_url ? (
                    <img
                      src={selected.baseline_selfie_url}
                      alt="Baseline"
                      className="w-full h-64 object-contain rounded border border-gray-200 bg-gray-50"
                    />
                  ) : (
                    <div className="w-full h-64 flex items-center justify-center rounded border border-gray-200 bg-gray-50 text-gray-400">
                      No baseline photo
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-gray-600">
                    Live Photo (Voting)
                  </h4>
                  {selected.voting_selfie_url ? (
                    <img
                      src={selected.voting_selfie_url}
                      alt="Live"
                      className="w-full h-64 object-contain rounded border border-gray-200 bg-gray-50"
                    />
                  ) : (
                    <div className="w-full h-64 flex items-center justify-center rounded border border-gray-200 bg-gray-50 text-gray-400">
                      No live photo
                    </div>
                  )}
                </div>
              </div>

              {/* Scores */}
              <div className="grid grid-cols-2 gap-4">
                <div className="warm-card p-4">
                  <p className="text-sm text-gray-500">Face Match Score</p>
                  <p className="text-2xl font-serif">
                    {selected.face_score != null
                      ? selected.face_score.toFixed(2)
                      : "—"}
                  </p>
                </div>
                <div className="warm-card p-4">
                  <p className="text-sm text-gray-500">Liveness Score</p>
                  <p className="text-2xl font-serif">
                    {selected.liveness_score != null
                      ? selected.liveness_score.toFixed(2)
                      : "—"}
                  </p>
                </div>
              </div>

              {/* Note and Actions */}
              <div className="space-y-4">
                <label className="block text-sm font-medium mb-1">
                  Review Note (Required)
                </label>
                <textarea
                  className="w-full border p-2 rounded"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  aria-label="Review note"
                />
                <div className="flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={() => revokeMutation.mutate(selected.id)}
                    className="px-4 py-2 border text-red-600 border-red-200 hover:bg-red-50 rounded"
                  >
                    Revoke Session
                  </button>
                  <button
                    type="button"
                    className="olive-button"
                    disabled={!note}
                    onClick={() => approveMutation.mutate(selected.id)}
                  >
                    Approve Face Verification
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
