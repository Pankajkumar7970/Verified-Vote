import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Terminal } from 'lucide-react';

export default function AuditLogs() {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['admin-audit'],
    queryFn: async () => {
      const res = await axios.get('/api/admin/audit');
      return res.data.logs;
    }
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
         <h1 className="text-2xl font-serif">Audit Logs</h1>
      </div>
      
      <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
         <div className="overflow-x-auto min-h-[500px]">
           <table className="w-full text-left text-sm whitespace-nowrap">
             <thead className="bg-[#f5f2ed] border-b text-gray-600">
               <tr>
                 <th className="p-4 font-medium sticky top-0 bg-[#f5f2ed]">Timestamp</th>
                 <th className="p-4 font-medium sticky top-0 bg-[#f5f2ed]">Action</th>
                 <th className="p-4 font-medium sticky top-0 bg-[#f5f2ed]">Actor</th>
                 <th className="p-4 font-medium sticky top-0 bg-[#f5f2ed]">Entity</th>
                 <th className="p-4 font-medium sticky top-0 bg-[#f5f2ed]">IP</th>
                 <th className="p-4 font-medium sticky top-0 bg-[#f5f2ed]">Metadata</th>
               </tr>
             </thead>
             <tbody className="divide-y font-mono text-xs">
               {isLoading ? (
                 <tr><td colSpan={6} className="p-8 text-center text-gray-500">Loading audit logs...</td></tr>
               ) : logs?.length === 0 ? (
                 <tr><td colSpan={6} className="p-8 text-center text-gray-500">No logs found</td></tr>
               ) : (
                 logs?.map((l: any) => (
                   <tr key={l.id} className="hover:bg-gray-50">
                     <td className="p-4">{new Date(l.created_at).toLocaleString()}</td>
                     <td className="p-4 font-semibold text-blue-600">{l.action}</td>
                     <td className="p-4">{l.actor_type}:{l.actor_id?.slice(0, 8)}...</td>
                     <td className="p-4">{l.entity_type}:{l.entity_id?.slice(0, 8)}...</td>
                     <td className="p-4">{l.ip_address || 'system'}</td>
                     <td className="p-4 max-w-[200px] truncate" title={l.metadata}>{l.metadata}</td>
                   </tr>
                 ))
               )}
             </tbody>
           </table>
         </div>
      </div>
    </div>
  );
}
