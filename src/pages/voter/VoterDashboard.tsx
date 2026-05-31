import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useVoterAuth } from "../../store/VoterContext";
import {
  FileText,
  CheckCircle,
  Plus,
  X,
  History,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Eye,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ChevronFirst,
  ChevronLast,
  Calendar,
  FileCheck,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Election {
  id: string;
  name: string;
  election_date: string;
  request_deadline: string;
}

type Tab = "active" | "history";

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function VoterDashboard() {
  const { logout } = useVoterAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("active");
  const [appealingRequest, setAppealingRequest] = useState<string | null>(null);
  const [appealFile, setAppealFile] = useState<File | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<
    "date_desc" | "date_asc" | "election_name" | "status"
  >("date_desc");
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending":
      case "reviewer_approved":
        return <Clock className="w-4 h-4" />;
      case "approved":
      case "final_approved":
        return <CheckCircle2 className="w-4 h-4" />;
      case "rejected":
        return <XCircle className="w-4 h-4" />;
      case "withdrawn":
        return <X className="w-4 h-4" />;
      case "draft":
        return <FileText className="w-4 h-4" />;
      default:
        return <FileCheck className="w-4 h-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
      case "reviewer_approved":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "approved":
      case "final_approved":
        return "bg-green-100 text-green-800 border-green-200";
      case "rejected":
        return "bg-red-100 text-red-800 border-red-200";
      case "withdrawn":
      case "draft":
        return "bg-gray-100 text-gray-800 border-gray-200";
      default:
        return "bg-blue-100 text-blue-800 border-blue-200";
    }
  };

  const getStatusProgress = (status: string) => {
    switch (status) {
      case "pending":
        return 25;
      case "reviewer_approved":
        return 50;
      case "final_approved":
      case "approved":
        return 100;
      case "rejected":
      case "withdrawn":
        return 0;
      case "draft":
        return 10;
      default:
        return 25;
    }
  };

  const { data: elections, isLoading: loadingElections } = useQuery({
    queryKey: ["voter-elections"],
    queryFn: async () => {
      const res = await axios.get("/api/voter/elections");
      return res.data.elections as Election[];
    },
  });

  const { data: requestsData, isLoading: loadingRequests } = useQuery({
    queryKey: ["voter-requests", tab, currentPage, pageSize],
    queryFn: async () => {
      const res = await axios.get("/api/voter/requests", {
        params: { scope: tab, page: currentPage, limit: pageSize },
      });
      return {
        requests: res.data.requests,
        pagination: res.data.pagination as PaginationInfo,
      };
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: async (id: string) =>
      axios.post(`/api/voter/requests/${id}/withdraw`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["voter-requests"] });
    },
  });

  const appealMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append("doc", file);
      return axios.post(`/api/voter/requests/${id}/appeal`, fd);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["voter-requests"] });
      setAppealingRequest(null);
      setAppealFile(null);
    },
  });

  const handlePageChange = (newPage: number) => {
    if (
      newPage >= 1 &&
      (!requestsData?.pagination ||
        newPage <= requestsData.pagination.totalPages)
    ) {
      setCurrentPage(newPage);
    }
  };

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    setCurrentPage(1);
  };

  const filteredAndSortedRequests = (requests: any[]) => {
    let result = [...requests];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (req) =>
          req.election_name.toLowerCase().includes(query) ||
          req.reason_category.toLowerCase().includes(query) ||
          req.status.toLowerCase().includes(query),
      );
    }

    switch (sortBy) {
      case "date_asc":
        result.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        break;
      case "date_desc":
        result.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        break;
      case "election_name":
        result.sort((a, b) => a.election_name.localeCompare(b.election_name));
        break;
      case "status":
        result.sort((a, b) => a.status.localeCompare(b.status));
        break;
    }

    return result;
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-8 space-y-12 pb-24 font-sans relative">
      <div className="flex justify-between items-end border-b pb-4 mt-8">
        <div>
          <h2 className="text-3xl font-serif text-[#1a1a1a]">My Portal</h2>
          <p className="text-sm text-gray-500 mt-1">
            Manage your active voting requests and view upcoming elections.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["voter-requests"] });
              queryClient.invalidateQueries({ queryKey: ["voter-elections"] });
            }}
            className="p-2 text-gray-600 hover:text-[#5A5A40] hover:bg-gray-100 rounded-full transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={logout}
            className="text-sm text-red-600 font-medium hover:underline"
          >
            Log out
          </button>
        </div>
      </div>

      <section>
        <div className="space-y-4 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h3 className="text-xl font-medium flex items-center gap-2">
              <FileText className="w-5 h-5 text-[#5A5A40]" /> Your Requests
            </h3>
            <div
              className="flex rounded-md border border-[rgba(26,26,26,0.15)] overflow-hidden text-sm"
              role="tablist"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === "active"}
                aria-controls="requests-panel"
                onClick={() => handleTabChange("active")}
                className={`px-4 py-2 flex-1 sm:flex-none focus:outline-none focus:ring-2 inset-ring focus:ring-[#5A5A40] ${tab === "active" ? "bg-[#5A5A40] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                Active
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "history"}
                aria-controls="requests-panel"
                onClick={() => handleTabChange("history")}
                className={`px-4 py-2 flex items-center justify-center gap-1 flex-1 sm:flex-none focus:outline-none focus:ring-2 inset-ring focus:ring-[#5A5A40] ${tab === "history" ? "bg-[#5A5A40] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                <History className="w-4 h-4" /> History
              </button>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Search requests..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md bg-[#f5f2ed] focus:outline-none focus:ring-2 focus:ring-[#5A5A40] text-sm"
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 rounded-md bg-[#f5f2ed] focus:outline-none focus:ring-2 focus:ring-[#5A5A40] text-sm"
            >
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="election_name">Election name (A-Z)</option>
              <option value="status">Status</option>
            </select>
          </div>
        </div>

        {loadingRequests ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="warm-card p-6 space-y-3">
                <div className="h-5 bg-gray-200 rounded w-1/3 animate-pulse" />
                <div className="h-4 bg-gray-200 rounded w-1/2 animate-pulse" />
                <div className="h-4 bg-gray-200 rounded w-1/4 animate-pulse" />
              </div>
            ))}
          </div>
        ) : !requestsData?.requests || requestsData.requests.length === 0 ? (
          <div className="warm-card p-12 text-center border-dashed border-2">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg mb-2">
              {tab === "active"
                ? "You have no active voting authorization requests."
                : "No completed or archived requests yet."}
            </p>
            {tab === "active" && (
              <button
                onClick={() => navigate("/request")}
                className="text-[#5A5A40] font-medium hover:underline"
              >
                Apply for your first postal ballot
              </button>
            )}
          </div>
        ) : filteredAndSortedRequests(requestsData.requests).length === 0 ? (
          <div className="warm-card p-12 text-center border-dashed border-2">
            <AlertCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg">
              No requests match your search criteria.
            </p>
          </div>
        ) : (
          <div id="requests-panel" role="tabpanel" className="space-y-4">
            {filteredAndSortedRequests(requestsData.requests).map(
              (req: any) => (
                <div
                  key={req.id}
                  className="warm-card p-6 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-white border border-[rgba(26,26,26,0.1)]"
                >
                  <div className="flex-1 w-full">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-lg">
                          {req.election_name}
                        </p>
                        <p className="text-sm text-gray-500 capitalize flex items-center gap-1 mt-1">
                          <Calendar className="w-4 h-4" />
                          {req.reason_category} —{" "}
                          {new Date(req.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        onClick={() => setSelectedRequest(req)}
                        className="p-1 hover:bg-gray-100 rounded transition-colors"
                        title="View details"
                      >
                        <Eye className="w-5 h-5 text-gray-500" />
                      </button>
                    </div>
                    <div className="mt-4 space-y-3">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all duration-500 ${
                            getStatusProgress(req.status) === 100
                              ? "bg-green-500"
                              : getStatusProgress(req.status) > 0
                                ? "bg-yellow-500"
                                : "bg-red-500"
                          }`}
                          style={{ width: `${getStatusProgress(req.status)}%` }}
                        />
                      </div>
                    </div>
                    {req.status === "rejected" && (
                      <div className="mt-3 bg-red-50 p-3 rounded-md border border-red-100">
                        {tab === "active" && (
                          <p className="text-sm text-red-700 font-medium mb-1">
                            This request was rejected. You may appeal with
                            missing documents.
                          </p>
                        )}
                        {req.rejection_reason && (
                          <p className="text-sm text-red-600">
                            <strong>Reason:</strong> {req.rejection_reason}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-4 flex-wrap sm:flex-nowrap">
                    {tab === "active" &&
                      ![
                        "withdrawn",
                        "rejected",
                        "appeal_resolved",
                        "final_approved",
                      ].includes(req.status) && (
                        <button
                          onClick={() => withdrawMutation.mutate(req.id)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Withdraw
                        </button>
                      )}
                    {tab === "active" && req.status === "rejected" && (
                      <button
                        onClick={() => setAppealingRequest(req.id)}
                        className="text-xs text-blue-600 font-medium hover:underline px-3 py-1 border border-blue-200 rounded"
                      >
                        Submit Appeal
                      </button>
                    )}
                    {tab === "active" && req.status === "draft" && (
                      <button
                        onClick={() => navigate(`/request?electionId=${req.election_id}`)}
                        className="text-xs text-[#5A5A40] font-medium hover:underline px-3 py-1 border border-[#5A5A40] rounded"
                      >
                        Continue Draft
                      </button>
                    )}
                    <span
                      className={`px-4 py-2 text-sm uppercase tracking-wider rounded-md font-semibold flex items-center gap-2 border-2 ${getStatusColor(req.status)}`}
                    >
                      {getStatusIcon(req.status)}
                      {req.status === "reviewer_approved"
                        ? "Under Review"
                        : req.status.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
              ),
            )}

            {/* Pagination Controls */}
            {requestsData.pagination &&
              requestsData.pagination.totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between mt-6 pt-4 border-t border-[rgba(26,26,26,0.1)] gap-4">
                  <div className="text-sm text-gray-500">
                    Showing page {requestsData.pagination.page} of{" "}
                    {requestsData.pagination.totalPages}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handlePageChange(1)}
                      disabled={requestsData.pagination.page <= 1}
                      className="p-2 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="First page"
                    >
                      <ChevronFirst className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() =>
                        handlePageChange(requestsData.pagination.page - 1)
                      }
                      disabled={requestsData.pagination.page <= 1}
                      className="p-2 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="flex items-center gap-1 px-2">
                      {Array.from(
                        {
                          length: Math.min(
                            5,
                            requestsData.pagination.totalPages,
                          ),
                        },
                        (_, i) => {
                          let pageNum;
                          if (requestsData.pagination.totalPages <= 5) {
                            pageNum = i + 1;
                          } else if (requestsData.pagination.page <= 3) {
                            pageNum = i + 1;
                          } else if (
                            requestsData.pagination.page >=
                            requestsData.pagination.totalPages - 2
                          ) {
                            pageNum =
                              requestsData.pagination.totalPages - 4 + i;
                          } else {
                            pageNum = requestsData.pagination.page - 2 + i;
                          }
                          return (
                            <button
                              key={pageNum}
                              onClick={() => handlePageChange(pageNum)}
                              className={`w-8 h-8 rounded-md text-sm font-medium ${
                                pageNum === requestsData.pagination.page
                                  ? "bg-[#5A5A40] text-white"
                                  : "hover:bg-gray-100 text-gray-700"
                              }`}
                            >
                              {pageNum}
                            </button>
                          );
                        },
                      )}
                    </div>
                    <button
                      onClick={() =>
                        handlePageChange(requestsData.pagination.page + 1)
                      }
                      disabled={
                        requestsData.pagination.page >=
                        requestsData.pagination.totalPages
                      }
                      className="p-2 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() =>
                        handlePageChange(requestsData.pagination.totalPages)
                      }
                      disabled={
                        requestsData.pagination.page >=
                        requestsData.pagination.totalPages
                      }
                      className="p-2 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Last page"
                    >
                      <ChevronLast className="w-4 h-4" />
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
        )}
      </section>

      <section>
        <h3 className="text-xl font-medium mb-6 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-[#5A5A40]" /> Upcoming Elections
        </h3>
        {loadingElections ? (
          <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="warm-card p-6 space-y-3">
                <div className="h-6 bg-gray-200 rounded w-2/3 animate-pulse" />
                <div className="h-4 bg-gray-200 rounded w-1/2 animate-pulse" />
                <div className="h-4 bg-gray-200 rounded w-1/3 animate-pulse" />
                <div className="h-10 bg-gray-200 rounded w-full animate-pulse mt-4" />
              </div>
            ))}
          </div>
        ) : !elections || elections.length === 0 ? (
          <div className="p-12 text-center text-gray-500 space-y-2 max-w-lg mx-auto">
            <CheckCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-lg">
              No elections are open for requests in your area right now.
            </p>
            <p className="text-sm text-gray-400">
              Elections only appear after a super admin{" "}
              <strong>activates</strong> them, and the constituency and state
              must match your voter registration.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {elections.map((elec) => (
              <div
                key={elec.id}
                className="warm-card p-6 relative overflow-hidden group hover:shadow-lg transition-all border border-[rgba(26,26,26,0.1)]"
              >
                <h4 className="font-semibold text-lg">{elec.name}</h4>
                <p className="text-sm text-gray-600 mt-2 pb-4">
                  Election Date:{" "}
                  {new Date(elec.election_date).toLocaleDateString()}
                </p>
                <p className="text-xs text-red-600 mb-6">
                  Deadline:{" "}
                  {new Date(elec.request_deadline).toLocaleDateString()}
                </p>
                <button
                  onClick={() => navigate(`/request?electionId=${elec.id}`)}
                  className="olive-button w-full text-sm font-medium hover:bg-[#4a4a35]"
                >
                  <Plus className="w-4 h-4 inline-block mr-2" /> Apply for
                  Postal Ballot
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {selectedRequest && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="details-dialog-title"
        >
          <div className="bg-white rounded-lg p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 id="details-dialog-title" className="font-serif text-xl">
                Request Details
              </h3>
              <button
                type="button"
                onClick={() => setSelectedRequest(null)}
                aria-label="Close details dialog"
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Election</p>
                <p className="font-medium">{selectedRequest.election_name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Reason Category</p>
                <p className="capitalize">{selectedRequest.reason_category}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Submitted On</p>
                <p>
                  {new Date(selectedRequest.created_at).toLocaleDateString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <span
                  className={`inline-flex items-center gap-2 px-3 py-1 rounded-md text-sm font-medium border-2 mt-1 ${getStatusColor(selectedRequest.status)}`}
                >
                  {getStatusIcon(selectedRequest.status)}
                  {selectedRequest.status === "reviewer_approved"
                    ? "Under Review"
                    : selectedRequest.status.replace(/_/g, " ")}
                </span>
              </div>
              {selectedRequest.rejection_reason && (
                <div className="bg-red-50 p-3 rounded-md border border-red-100">
                  <p className="text-sm text-red-700 font-medium">
                    Rejection Reason
                  </p>
                  <p className="text-sm text-red-600">
                    {selectedRequest.rejection_reason}
                  </p>
                </div>
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSelectedRequest(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {appealingRequest && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="appeal-dialog-title"
        >
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 id="appeal-dialog-title" className="font-serif text-xl">
                Submit Appeal
              </h3>
              <button
                type="button"
                onClick={() => {
                  setAppealingRequest(null);
                  setAppealFile(null);
                }}
                aria-label="Close appeal dialog"
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Please upload any additional documents to support your appeal.
            </p>
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(e) =>
                e.target.files && setAppealFile(e.target.files[0])
              }
              className="w-full text-sm font-medium text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-gray-100 mb-6"
            />
            <button
              onClick={() =>
                appealFile &&
                appealMutation.mutate({
                  id: appealingRequest,
                  file: appealFile,
                })
              }
              disabled={!appealFile || appealMutation.isPending}
              className="olive-button w-full disabled:opacity-50"
            >
              {appealMutation.isPending ? "Submitting..." : "Upload & Appeal"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
