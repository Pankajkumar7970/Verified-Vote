import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Terminal, ChevronLeft, ChevronRight, Search, ChevronDown, ChevronUp } from 'lucide-react';

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function AuditLogs() {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Server-side filter states
  const [actorType, setActorType] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityType, setEntityType] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: [
      'admin-audit', 
      currentPage, 
      pageSize, 
      searchQuery, 
      actorType, 
      actionFilter, 
      entityType, 
      ipAddress, 
      startDate, 
      endDate
    ],
    queryFn: async () => {
      const res = await axios.get('/api/admin/audit', {
        params: { 
          page: currentPage, 
          limit: pageSize,
          search: searchQuery || undefined,
          actor_type: actorType || undefined,
          action: actionFilter || undefined,
          entity_type: entityType || undefined,
          ip_address: ipAddress || undefined,
          start_date: startDate ? new Date(startDate).toISOString() : undefined,
          end_date: endDate ? new Date(endDate).toISOString() : undefined,
        },
      });
      return {
        logs: res.data.logs,
        pagination: res.data.pagination as PaginationInfo,
      };
    }
  });

  const handleFilterChange = (setter: (val: string) => void, val: string) => {
    setter(val);
    setCurrentPage(1);
  };

  const toggleLogExpand = (id: string) => {
    const newExpanded = new Set(expandedLogs);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedLogs(newExpanded);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && (!data?.pagination || newPage <= data.pagination.totalPages)) {
      setCurrentPage(newPage);
    }
  };

  const logs = data?.logs ?? [];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
         <h1 className="text-2xl font-serif">Audit Logs</h1>
         <div className="flex items-center gap-4 flex-wrap">
           <div className="relative">
             <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
             <input
               type="text"
               placeholder="Search by Action/IDs..."
               value={searchQuery}
               onChange={(e) => handleFilterChange(setSearchQuery, e.target.value)}
               className="pl-10 pr-4 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40] w-64"
             />
           </div>
           <button
             type="button"
             className="text-sm olive-button px-4 py-2"
             aria-label="Export audit logs as CSV"
             onClick={async () => {
               const res = await axios.get('/api/admin/audit/export', { responseType: 'blob' });
               const url = URL.createObjectURL(res.data);
               const a = document.createElement('a');
               a.href = url;
               a.download = `audit-export-${Date.now()}.csv`;
               a.click();
               URL.revokeObjectURL(url);
             }}
           >
             Export CSV
           </button>
         </div>
      </div>

      {/* Sleek responsive dynamic filter panel */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Actor Type</label>
          <select
            value={actorType}
            onChange={(e) => handleFilterChange(setActorType, e.target.value)}
            className="w-full p-2 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#5A5A40]"
          >
            <option value="">All Actors</option>
            <option value="system">System</option>
            <option value="admin">Admin</option>
            <option value="voter">Voter</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Action</label>
          <input
            type="text"
            placeholder="e.g. request_approved"
            value={actionFilter}
            onChange={(e) => handleFilterChange(setActionFilter, e.target.value)}
            className="w-full p-2 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#5A5A40]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Entity Type</label>
          <select
            value={entityType}
            onChange={(e) => handleFilterChange(setEntityType, e.target.value)}
            className="w-full p-2 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#5A5A40]"
          >
            <option value="">All Entities</option>
            <option value="voter">Voter</option>
            <option value="election">Election</option>
            <option value="candidate">Candidate</option>
            <option value="party">Party</option>
            <option value="voting_request">Voting Request</option>
            <option value="voting_session">Voting Session</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">IP Address</label>
          <input
            type="text"
            placeholder="Filter by IP..."
            value={ipAddress}
            onChange={(e) => handleFilterChange(setIpAddress, e.target.value)}
            className="w-full p-2 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#5A5A40]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => handleFilterChange(setStartDate, e.target.value)}
            className="w-full p-2 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#5A5A40]"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => handleFilterChange(setEndDate, e.target.value)}
            className="w-full p-2 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-[#5A5A40]"
          />
        </div>
      </div>
      
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
         <div className="overflow-x-auto min-h-[500px]">
           <table className="w-full text-left text-sm whitespace-nowrap">
             <thead className="bg-[#f5f2ed] border-b text-gray-600">
               <tr>
                 <th className="p-4 font-medium sticky top-0 bg-[#f5f2ed]">Timestamp</th>
                 <th className="p-4 font-medium sticky top-0 bg-[#f5f2ed]">Action</th>
                 <th className="p-4 font-medium sticky top-0 bg-[#f5f2ed]">Actor</th>
                 <th className="p-4 font-medium sticky top-0 bg-[#f5f2ed]">Entity</th>
                 <th className="p-4 font-medium sticky top-0 bg-[#f5f2ed]">IP</th>
                 <th className="p-4 font-medium sticky top-0 bg-[#f5f2ed]"></th>
               </tr>
             </thead>
             <tbody className="divide-y font-mono text-xs">
               {isLoading ? (
                 <tr><td colSpan={6} className="p-8 text-center text-gray-500">Loading audit logs...</td></tr>
               ) : logs.length === 0 ? (
                 <tr><td colSpan={6} className="p-8 text-center text-gray-500">No logs found</td></tr>
               ) : (
                 logs.map((l: any) => (
                   <React.Fragment key={l.id}>
                     <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => toggleLogExpand(l.id)}>
                       <td className="p-4">{new Date(l.created_at).toLocaleString()}</td>
                       <td className="p-4 font-semibold text-blue-600">{l.action}</td>
                       <td className="p-4">{l.actor_type}:{l.actor_id?.slice(0, 8)}...</td>
                       <td className="p-4">{l.entity_type}:{l.entity_id?.slice(0, 8)}...</td>
                       <td className="p-4">{l.ip_address || 'system'}</td>
                       <td className="p-4">
                         {expandedLogs.has(l.id) ? (
                           <ChevronUp className="w-4 h-4 text-gray-500" />
                         ) : (
                           <ChevronDown className="w-4 h-4 text-gray-500" />
                         )}
                       </td>
                     </tr>
                     {expandedLogs.has(l.id) && (
                       <tr>
                         <td colSpan={6} className="p-4 bg-gray-50 border-t border-gray-100">
                           <div className="space-y-2">
                             <h4 className="text-sm font-semibold text-gray-700">Metadata:</h4>
                             <pre className="bg-white p-4 rounded border border-gray-200 overflow-auto max-h-64 text-xs">
                               {typeof l.metadata === 'object' 
                                 ? JSON.stringify(l.metadata, null, 2) 
                                 : l.metadata || 'No metadata'}
                             </pre>
                           </div>
                         </td>
                       </tr>
                     )}
                   </React.Fragment>
                 ))
               )}
             </tbody>
           </table>
           
           {/* Pagination Controls */}
           {data?.pagination && data.pagination.totalPages > 1 && (
            <div className="px-6 py-4 border-t border-[rgba(26,26,26,0.1)] flex items-center justify-between flex-wrap gap-4">
              <div className="text-sm text-gray-500">
                Showing page {data.pagination.page} of {data.pagination.totalPages} (Total: {data.pagination.total})
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => handlePageChange(data.pagination.page - 1)}
                  disabled={data.pagination.page <= 1}
                  className="p-2 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-gray-600">{data.pagination.page}</span>
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
      </div>
    </div>
  );
}
