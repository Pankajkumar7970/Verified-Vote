import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { ShieldCheck, Eye, LockKeyhole } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';

export default function ElectionResults() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showPublishDialog, setShowPublishDialog] = useState(false);

  const { data: resultsData, isLoading } = useQuery({
    queryKey: ['election-results', id],
    queryFn: async () => {
      const res = await axios.get(`/api/admin/elections/${id}/results`);
      return res.data.results;
    }
  });

  const { data: elections } = useQuery({
    queryKey: ['admin-elections'],
    queryFn: async () => {
      const res = await axios.get('/api/admin/elections');
      return res.data.elections;
    }
  });

  const election = elections?.find((e: any) => e.id === id);

  const publishMutation = useMutation({
    mutationFn: async () => {
      return axios.post(`/api/admin/elections/${id}/publish-results`, { password });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-elections'] });
      queryClient.invalidateQueries({ queryKey: ['election-results', id] });
      setSuccessMsg('Results published successfully.');
      setShowPublishDialog(false);
      setPassword('');
      setTimeout(() => setSuccessMsg(''), 5000);
    },
    onError: (err: any) => {
      setErrorMsg(err.response?.data?.error || 'Failed to publish results');
      setTimeout(() => setErrorMsg(''), 5000);
    }
  });

  if (isLoading || !election) return <div className="p-8">Loading results...</div>;

  return (
    <div className="p-4 sm:p-8">
      <button onClick={() => navigate('/admin/elections')} className="text-sm text-gray-500 hover:text-black mb-6">&larr; Back to Elections</button>

      <div className="mb-8 flex items-end justify-between border-b border-[rgba(26,26,26,0.1)] pb-4">
         <div>
           <h1 className="text-3xl font-serif tracking-tight text-[#1a1a1a] flex items-center gap-2">
             <Eye className="w-8 h-8 text-[#5A5A40]" /> Election Results
           </h1>
           <p className="text-gray-500 mt-1">{election.name} — {election.status.toUpperCase()}</p>
         </div>

         {election.status === 'voting' && (
           <button onClick={() => setShowPublishDialog(true)} className="olive-button flex items-center gap-2">
              <LockKeyhole className="w-4 h-4" /> Publish & Complete
           </button>
         )}
      </div>

      {successMsg && <div className="bg-green-50 text-green-700 p-4 border border-green-200 rounded-md mb-6">{successMsg}</div>}

      <div className="grid sm:grid-cols-2 gap-6">
         {resultsData?.tally?.map((t: any) => (
            <div key={t.id} className="warm-card p-6 bg-white border border-[rgba(26,26,26,0.1)] shadow-sm">
               <p className="text-xl font-medium mb-1">{t.name}</p>
               <p className="text-gray-500 text-sm mb-4">{t.party_name}</p>
               <div className="text-3xl font-serif text-[#5A5A40]">{t.vote_count} <span className="text-sm font-sans text-gray-400">votes</span></div>
            </div>
         ))}
      </div>

      {showPublishDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="publish-dialog-title">
           <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-2xl">
              <ShieldCheck className="w-12 h-12 text-[#5A5A40] mb-4" />
              <h3 id="publish-dialog-title" className="text-xl font-serif mb-2">Security Verification</h3>
              <p className="text-sm text-gray-600 mb-6">Enter your admin password to finalize the election and cryptographically sign the results.</p>
              
              {errorMsg && <p className="text-red-600 text-sm mb-4">{errorMsg}</p>}

              <label htmlFor="adminPassword" className="sr-only">Admin Password</label>
              <input 
                 id="adminPassword"
                 type="password" 
                 placeholder="Admin Password"
                 value={password}
                 onChange={e => setPassword(e.target.value)}
                 className="w-full px-4 py-2 border rounded border-gray-300 mb-6 focus:ring focus:ring-[#5A5A40]/30"
              />

              <div className="flex gap-4">
                 <button onClick={() => { setShowPublishDialog(false); setPassword(''); }} className="flex-1 px-4 py-2 border rounded hover:bg-gray-50">Cancel</button>
                 <button 
                   onClick={() => publishMutation.mutate()} 
                   disabled={publishMutation.isPending || !password}
                   className="flex-1 olive-button disabled:opacity-50"
                 >
                   Confirm Publish
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
