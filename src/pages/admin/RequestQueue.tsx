import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from '../../store/AuthContext';
import { FileText, CheckCircle, XCircle, AlertCircle, Clock } from 'lucide-react';

interface VotingRequest {
  id: string;
  voter_id: string;
  status: string;
  reason_category: string;
  reason_detail: string;
  doc_url?: string;
  appeal_doc_url?: string;
  face_score_at_request: number;
  created_at: string;
}

export default function RequestQueue() {
  const { admin } = useAuth();
  const queryClient = useQueryClient();
  const [selectedRequest, setSelectedRequest] = useState<VotingRequest | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-requests'],
    queryFn: async () => {
      const res = await axios.get('/api/admin/requests');
      return res.data.requests as VotingRequest[];
    }
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status, reason, note }: { id: string, status: string, reason?: string, note?: string }) => {
      await axios.post(`/api/admin/requests/${id}/status`, { status, reason, note });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-requests'] });
      setSelectedRequest(null);
      setActionNote('');
      setRejectionReason('');
      setErrorMsg('');
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.message || err.response?.data?.error || 'Failed to update request');
    }
  });

  const handleAction = (id: string, status: string) => {
    setErrorMsg('');
    let reason = undefined;
    if (status === 'rejected') {
      if (!rejectionReason) {
         setErrorMsg('Rejection reason is mandatory.');
         return;
      }
      reason = rejectionReason;
    }
    
    let computedStatus = status;
    if (status === 'approve') {
       computedStatus = admin?.role === 'reviewer' ? 'reviewer_approved' : 'superadmin_approved';
    }
    
    statusMutation.mutate({ id, status: computedStatus, reason, note: actionNote });
  };

  if (isLoading) return <div className="p-8 font-sans">Loading authorization queue...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-3xl font-serif text-[#1a1a1a]">Authorization Queue</h2>
          <p className="text-sm text-gray-500 mt-2 font-sans">Manage remote voting authorization requests</p>
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
            {data?.map((req) => (
               // Simple list items
               <tr key={req.id} className="hover:bg-gray-50">
                 <td className="px-6 py-4 font-mono text-xs">{req.id.substring(0,8)}...</td>
                 <td className="px-6 py-4 capitalize">{req.reason_category}</td>
                 <td className="px-6 py-4 capitalize font-semibold">{req.status.replace(/_/g, ' ')}</td>
                 <td className="px-6 py-4">{new Date(req.created_at).toLocaleDateString()}</td>
                 <td className="px-6 py-4 text-right">
                   <button onClick={() => setSelectedRequest(req)} className="text-[#5A5A40] hover:underline font-medium">Review</button>
                 </td>
               </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedRequest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 font-sans">
           <div className="warm-card p-8 w-full max-w-2xl bg-white space-y-6">
             <div className="flex justify-between">
               <h3 className="text-2xl font-serif">Review Request</h3>
               <button onClick={() => { setSelectedRequest(null); setErrorMsg(''); }}><XCircle className="w-6 h-6 text-gray-400" /></button>
             </div>
             
             {errorMsg && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{errorMsg}</div>}
             
             <div>
                 <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                       <p className="text-sm text-gray-500">Category</p>
                       <p className="font-medium capitalize">{selectedRequest.reason_category}</p>
                    </div>
                    <div>
                       <p className="text-sm text-gray-500">Selfie Match Score (at request)</p>
                       <p className="font-medium">{selectedRequest.face_score_at_request?.toFixed(1) || 0}%</p>
                    </div>
                 </div>
                 <div className="mb-4">
                    <p className="text-sm text-gray-500">Detail</p>
                    <p className="text-sm bg-gray-50 p-2 rounded">{selectedRequest.reason_detail}</p>
                 </div>
                 
                 <div className="flex gap-4 mb-6">
                    {selectedRequest.doc_url && (
                       <a href={selectedRequest.doc_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                          <FileText className="w-4 h-4" /> View Primary Document
                       </a>
                    )}
                    {selectedRequest.appeal_doc_url && (
                       <a href={selectedRequest.appeal_doc_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-purple-600 hover:underline">
                          <FileText className="w-4 h-4" /> View Appeal Document
                       </a>
                    )}
                 </div>

                 <label className="block text-sm font-medium mb-1">Internal Note (mandatory for approval)</label>
                 <textarea className="w-full border p-2 rounded" rows={3} value={actionNote} onChange={e => setActionNote(e.target.value)} />
             </div>

             <div>
                <label className="block text-sm font-medium mb-1">Rejection Reason</label>
                <textarea className="w-full border p-2 rounded" rows={2} value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} />
             </div>

             <div className="flex justify-end gap-3 pt-4 border-t">
               <button onClick={() => handleAction(selectedRequest.id, 'rejected')} className="px-4 py-2 border text-red-600 border-red-200 hover:bg-red-50 rounded">Reject</button>
               {admin?.role === 'reviewer' && <button onClick={() => handleAction(selectedRequest.id, 'under_review')} className="px-4 py-2 border border-[#5A5A40] text-[#5A5A40] rounded">Start Review</button>}
               <button onClick={() => handleAction(selectedRequest.id, 'approve')} disabled={!actionNote} className="olive-button rounded">Approve</button>
               {(admin?.role === 'super_admin' && selectedRequest.status === 'appealed') && (
                 <button onClick={() => handleAction(selectedRequest.id, 'appeal_resolved')} disabled={!actionNote} className="olive-button rounded bg-purple-700 hover:bg-purple-800 border-purple-700 text-white">Resolve Appeal (Approve)</button> 
               )}
             </div>
           </div>
        </div>
      )}
    </div>
  );
}
