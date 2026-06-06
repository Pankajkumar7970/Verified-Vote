import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import DOMPurify from "dompurify";
import { useAuth } from "../../store/AuthContext";
import { XCircle, ChevronLeft, ChevronRight } from "lucide-react";
import AdminSecurePreview from "../../components/features/AdminSecurePreview";

interface VotingRequest {
  id: string;
  voter_id: string;
  status: string;
  reason_category: string;
  reason_detail: string;
  face_score_at_request: number;
  created_at: string;
  has_selfie_embedding?: boolean;
  can_preview?: {
    supporting_doc: boolean;
    voter_id: boolean;
    selfie: boolean;
    appeal_doc: boolean;
  };
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface StatsData {
  [key: string]: number;
}

export default function RequestQueue() {
  const { admin } = useAuth();
  const queryClient = useQueryClient();
  const [selectedRequest, setSelectedRequest] = useState<VotingRequest | null>(
    null,
  );
  const [actionNote, setActionNote] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterByStatus, setFilterByStatus] = useState<string>("all");
  const [filterByElection, setFilterByElection] = useState<string>("all");
  const [sortBy, setSortBy] = useState<
    "date_desc" | "date_asc" | "category" | "status"
  >("date_desc");

  const { data: electionsData } = useQuery({
    queryKey: ["admin-elections"],
    queryFn: async () => {
      const res = await axios.get("/api/admin/elections");
      return res.data.elections as Array<{
        id: string;
        name: string;
        constituency: string;
        state: string;
      }>;
    },
  });
  const elections = electionsData || [];

  const { data, isLoading } = useQuery({
    queryKey: ["admin-requests", currentPage, pageSize, filterByElection],
    queryFn: async () => {
      const params: any = { page: currentPage, limit: pageSize };
      if (filterByElection !== "all") {
        params.election_id = filterByElection;
      }
      const res = await axios.get("/api/admin/requests", { params });
      return {
        requests: res.data.requests as VotingRequest[],
        pagination: res.data.pagination as PaginationInfo,
        stats: res.data.stats as StatsData,
      };
    },
  });

  const handleOpenReview = async (req: VotingRequest) => {
    setSelectedRequest(req);
    if (admin?.role === "reviewer" && req.status === "pending") {
      try {
        await axios.post(`/api/admin/requests/${req.id}/status`, {
          status: "under_review",
        });
        queryClient.invalidateQueries({ queryKey: ["admin-requests"] });
        setSelectedRequest((prev) => prev ? { ...prev, status: "under_review" } : null);
      } catch (err) {
        console.error("Failed to transition status to under_review", err);
      }
    } else if (admin?.role === "super_admin" && req.status === "appealed") {
      try {
        await axios.post(`/api/admin/requests/${req.id}/status`, {
          status: "appeal_under_review",
        });
        queryClient.invalidateQueries({ queryKey: ["admin-requests"] });
        setSelectedRequest((prev) => prev ? { ...prev, status: "appeal_under_review" } : null);
      } catch (err) {
        console.error("Failed to transition status to appeal_under_review", err);
      }
    }
  };

  const statusMutation = useMutation({
    mutationFn: async ({
      id,
      status,
      reason,
      note,
      appeal_outcome,
    }: {
      id: string;
      status: string;
      reason?: string;
      note?: string;
      appeal_outcome?: string;
    }) => {
      await axios.post(`/api/admin/requests/${id}/status`, {
        status,
        reason,
        note,
        appeal_outcome,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-requests"] });
      setSelectedRequest(null);
      setActionNote("");
      setRejectionReason("");
      setErrorMsg("");
    },
    onError: (err: any) => {
      setErrorMsg(
        err.response?.data?.message ||
          err.response?.data?.error ||
          "Failed to update request",
      );
    },
  });

  const handleAction = (
    id: string,
    status: string,
    appealOutcome?: "approved" | "rejected",
  ) => {
    setErrorMsg("");
    let reason = undefined;
    const needsRejectionReason =
      status === "rejected" ||
      (status === "appeal_resolved" && appealOutcome === "rejected");
    if (needsRejectionReason) {
      if (!rejectionReason) {
        setErrorMsg("Rejection reason is mandatory.");
        return;
      }
      reason = rejectionReason;
    }

    let computedStatus = status;
    if (status === "approve") {
      computedStatus =
        admin?.role === "reviewer"
          ? "reviewer_approved"
          : "superadmin_approved";
    }

    statusMutation.mutate({
      id,
      status: computedStatus,
      reason,
      note: actionNote,
      appeal_outcome: appealOutcome,
    });
  };

  if (isLoading)
    return <div className="p-8 font-sans">Loading authorization queue...</div>;

  const isSuperAdmin = admin?.role === "super_admin";
  const isReviewer = admin?.role === "reviewer";

  const stats = {
    total: data?.pagination.total || 0,
    reviewerApproved: data?.stats?.reviewer_approved || 0,
    appealed: data?.stats?.appealed || 0,
    rejected: data?.stats?.rejected || 0,
    approved:
      (data?.stats?.superadmin_approved || 0) +
      (data?.stats?.approved || 0) +
      (data?.stats?.final_approved || 0),
  };

  // Filter and sort requests
  const filteredRequests = (data?.requests || []).filter((req) => {
    // Status filter
    if (filterByStatus !== "all" && req.status !== filterByStatus) {
      return false;
    }
    // Search filter (search in request ID and reason category)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      const matchesId = req.id.toLowerCase().includes(query);
      const matchesCategory = req.reason_category.toLowerCase().includes(query);
      const matchesStatus = req.status
        .replace(/_/g, " ")
        .toLowerCase()
        .includes(query);
      return matchesId || matchesCategory || matchesStatus;
    }
    return true;
  });

  // Sort filtered requests
  const sortedRequests = [...filteredRequests].sort((a, b) => {
    switch (sortBy) {
      case "date_asc":
        return (
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      case "date_desc":
        return (
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      case "category":
        return a.reason_category.localeCompare(b.reason_category);
      case "status":
        return a.status.localeCompare(b.status);
      default:
        return 0;
    }
  });

  const handlePageChange = (newPage: number) => {
    if (
      newPage >= 1 &&
      (!data?.pagination || newPage <= data.pagination.totalPages)
    ) {
      setCurrentPage(newPage);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-3xl font-serif text-[#1a1a1a]">
            Authorization Queue
          </h2>
          <p className="text-sm text-gray-500 mt-2 font-sans">
            Manage remote voting authorization requests
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        <div className="warm-card p-4 text-center">
          <p className="text-2xl font-serif font-bold text-[#5A5A40]">
            {stats.total}
          </p>
          <p className="text-xs text-gray-500 mt-1">Total Requests</p>
        </div>
        <div className="warm-card p-4 text-center">
          <p className="text-2xl font-serif font-bold text-yellow-600">
            {stats.reviewerApproved}
          </p>
          <p className="text-xs text-gray-500 mt-1">Reviewer Approved</p>
        </div>
        {admin?.role === "super_admin" && (
          <div className="warm-card p-4 text-center">
            <p className="text-2xl font-serif font-bold text-purple-600">
              {stats.appealed}
            </p>
            <p className="text-xs text-gray-500 mt-1">Appealed</p>
          </div>
        )}
        <div className="warm-card p-4 text-center">
          <p className="text-2xl font-serif font-bold text-green-600">
            {stats.approved}
          </p>
          <p className="text-xs text-gray-500 mt-1">Approved</p>
        </div>
        <div className="warm-card p-4 text-center">
          <p className="text-2xl font-serif font-bold text-red-600">
            {stats.rejected}
          </p>
          <p className="text-xs text-gray-500 mt-1">Rejected</p>
        </div>
      </div>

      {/* Filter & Search Controls */}
      <div className="warm-card p-4 font-sans mb-4">
        <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
          <input
            type="text"
            placeholder="Search requests..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#5A5A40]"
          />
          <select
            value={filterByElection}
            onChange={(e) => setFilterByElection(e.target.value)}
            className="w-full sm:w-64 max-w-xs px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#5A5A40] text-sm truncate"
          >
            <option value="all">All Elections</option>
            {elections.map((ele) => (
              <option key={ele.id} value={ele.id}>
                {ele.name} ({ele.constituency}, {ele.state})
              </option>
            ))}
          </select>
          <select
            value={filterByStatus}
            onChange={(e) => setFilterByStatus(e.target.value)}
            className="w-full sm:w-48 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#5A5A40] text-sm"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="under_review">Under Review</option>
            <option value="reviewer_approved">Reviewer Approved</option>
            <option value="superadmin_approved">Super Admin Approved</option>
            <option value="final_approved">Final Approved</option>
            <option value="rejected">Rejected</option>
            {isSuperAdmin && (
              <>
                <option value="appealed">Appealed</option>
                <option value="appeal_under_review">Appeal Under Review</option>
                <option value="appeal_resolved">Appeal Resolved</option>
              </>
            )}
            <option value="withdrawn">Withdrawn</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="w-full sm:w-48 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#5A5A40] text-sm"
          >
            <option value="date_desc">Date: Newest First</option>
            <option value="date_asc">Date: Oldest First</option>
            <option value="category">Category: A-Z</option>
            <option value="status">Status: A-Z</option>
          </select>
        </div>
      </div>

      <div className="warm-card overflow-hidden font-sans">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#f5f2ed] border-b text-gray-500 uppercase tracking-wider text-xs">
            <tr>
              <th className="px-6 py-4 font-medium">Request ID</th>
              <th className="px-6 py-4 font-medium">Category</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium">Date</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedRequests.map((req) => (
              // Simple list items
              <tr key={req.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 font-mono text-xs flex items-center">
                  {((isReviewer &&
                    ["pending", "under_review"].includes(req.status)) ||
                    (isSuperAdmin &&
                      ["reviewer_approved", "appealed", "appeal_under_review"].includes(
                        req.status,
                      ))) && (
                    <span
                      className="w-2 h-2 rounded-full bg-orange-500 mr-2 flex-shrink-0"
                      title="Action required"
                    ></span>
                  )}
                  {req.id.substring(0, 8)}...
                </td>
                <td className="px-6 py-4 capitalize">{req.reason_category}</td>
                <td className="px-6 py-4 capitalize font-semibold">
                  {req.status.replace(/_/g, " ")}
                </td>
                <td className="px-6 py-4">
                  {new Date(req.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 text-right">
                  <button
                    onClick={() => handleOpenReview(req)}
                    className="text-[#5A5A40] hover:underline font-medium"
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination Controls */}
        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="px-6 py-4 border-t border-[rgba(26,26,26,0.1)] flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Showing page {data.pagination.page} of{" "}
              {data.pagination.totalPages}
            </div>
            <div className="flex items-center gap-2">
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

      {selectedRequest && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 font-sans"
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-request-title"
        >
          <div className="warm-card w-full max-w-2xl bg-white flex flex-col max-h-[min(90vh,100%)] overflow-hidden shadow-xl">
            <div className="shrink-0 flex justify-between items-start gap-4 p-6 pb-4 border-b border-[rgba(26,26,26,0.1)]">
              <h3 id="review-request-title" className="text-2xl font-serif">
                Review Request
              </h3>
              <button
                type="button"
                onClick={() => {
                  setSelectedRequest(null);
                  setErrorMsg("");
                }}
                aria-label="Close review dialog"
              >
                <XCircle className="w-6 h-6 text-gray-400" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
              {errorMsg && (
                <div
                  className="bg-red-50 text-red-600 p-3 rounded text-sm"
                  role="alert"
                  aria-live="assertive"
                >
                  {errorMsg}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Category</p>
                  <p className="font-medium capitalize">
                    {selectedRequest.reason_category}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">
                    Liveness score (at request)
                  </p>
                  <p className="font-medium">
                    {selectedRequest.face_score_at_request != null
                      ? selectedRequest.face_score_at_request.toFixed(2)
                      : "—"}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-sm text-gray-500">Detail</p>
                <p
                  className="text-sm bg-gray-50 p-2 rounded mt-1"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(
                      selectedRequest.reason_detail || "",
                    ),
                  }}
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-6">
                {selectedRequest.can_preview?.voter_id && (
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-2">
                      Voter ID photo
                    </p>
                    <AdminSecurePreview
                      requestId={selectedRequest.id}
                      kind="voter_id"
                      alt="Voter ID"
                    />
                  </div>
                )}
                {selectedRequest.can_preview?.selfie ? (
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-2">
                      Baseline selfie
                    </p>
                    <AdminSecurePreview
                      requestId={selectedRequest.id}
                      kind="selfie"
                      alt="Request selfie"
                    />
                  </div>
                ) : selectedRequest.has_selfie_embedding ? (
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-2">
                      Baseline selfie
                    </p>
                    <p className="text-sm text-gray-500">
                      Stored as encrypted embedding only (no image file).
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-6">
                {selectedRequest.can_preview?.supporting_doc && (
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-2">
                      Supporting document
                    </p>
                    <AdminSecurePreview
                      requestId={selectedRequest.id}
                      kind="supporting_doc"
                      alt="Supporting document"
                      linkLabel="Open supporting document"
                    />
                  </div>
                )}
                {isSuperAdmin && selectedRequest.can_preview?.appeal_doc && (
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-2">
                      Appeal document
                    </p>
                    <AdminSecurePreview
                      requestId={selectedRequest.id}
                      kind="appeal_doc"
                      alt="Appeal document"
                      linkLabel="Open appeal document"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Internal Note (mandatory for approval)
                </label>
                <textarea
                  className="w-full border p-2 rounded"
                  rows={3}
                  value={actionNote}
                  onChange={(e) => setActionNote(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Rejection Reason
                </label>
                <textarea
                  className="w-full border p-2 rounded"
                  rows={2}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                />
              </div>
            </div>

            <div className="shrink-0 flex flex-wrap justify-end gap-3 p-4 sm:p-6 border-t border-[rgba(26,26,26,0.1)] bg-white">
              {isSuperAdmin &&
                ["appealed", "appeal_under_review"].includes(
                  selectedRequest.status,
                ) && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        handleAction(
                          selectedRequest.id,
                          "appeal_resolved",
                          "rejected",
                        )
                      }
                      className="px-4 py-2 border text-red-600 border-red-200 hover:bg-red-50 rounded"
                    >
                      Reject appeal
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleAction(
                          selectedRequest.id,
                          "appeal_resolved",
                          "approved",
                        )
                      }
                      disabled={!actionNote}
                      className="olive-button rounded disabled:opacity-50"
                    >
                      Approve appeal
                    </button>
                  </>
                )}
              {((isReviewer &&
                ["pending", "under_review"].includes(selectedRequest.status)) ||
                (isSuperAdmin &&
                  selectedRequest.status === "reviewer_approved")) &&
                !["appealed", "appeal_under_review"].includes(
                  selectedRequest.status,
                ) && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleAction(selectedRequest.id, "rejected")}
                      className="px-4 py-2 border text-red-600 border-red-200 hover:bg-red-50 rounded"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAction(selectedRequest.id, "approve")}
                      disabled={!actionNote}
                      className="olive-button rounded disabled:opacity-50"
                    >
                      Approve
                    </button>
                  </>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
