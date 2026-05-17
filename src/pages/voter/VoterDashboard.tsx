import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useVoterAuth } from '../../store/VoterContext';
import { useTranslation } from 'react-i18next';
import { FileText, CheckCircle, AlertCircle, Plus, Upload, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Election {
  id: string;
  name: string;
  election_date: string;
  request_deadline: string;
}

export default function VoterDashboard() {
  const { logout } = useVoterAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [appealingRequest, setAppealingRequest] = useState<string | null>(null);
  const [appealFile, setAppealFile] = useState<File | null>(null);

  const { data: elections, isLoading: loadingElections } = useQuery({
    queryKey: ['voter-elections'],
    queryFn: async () => {
      const res = await axios.get('/api/voter/elections');
      return res.data.elections as Election[];
    }
  });

  const { data: requests, isLoading: loadingRequests } = useQuery({
    queryKey: ['voter-requests'],
    queryFn: async () => {
      const res = await axios.get('/api/voter/requests');
      return res.data.requests;
    }
  });

  const withdrawMutation = useMutation({
    mutationFn: async (id: string) => axios.post(`/api/voter/requests/${id}/withdraw`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['voter-requests'] })
  });

  const appealMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string, file: File }) => {
      const fd = new FormData();
      fd.append('doc', file);
      return axios.post(`/api/voter/requests/${id}/appeal`, fd);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voter-requests'] });
      setAppealingRequest(null);
      setAppealFile(null);
    }
  });

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-8 space-y-12 pb-24 font-sans relative">
      <div className="flex justify-between items-end border-b pb-4 mt-8">
         <div>
           <h2 className="text-3xl font-serif text-[#1a1a1a]">My Portal</h2>
           <p className="text-sm text-gray-500 mt-1">Manage your active voting requests and view upcoming elections.</p>
         </div>
         <button onClick={logout} className="text-sm text-red-600 font-medium hover:underline">Log out</button>
      </div>

      <section>
        <h3 className="text-xl font-medium mb-6 flex items-center gap-2"><FileText className="w-5 h-5 text-[#5A5A40]" /> Your Active Requests</h3>
        {loadingRequests ? <div className="animate-pulse h-24 bg-gray-100 rounded-md"></div> : 
          (!requests || requests.length === 0) ? (
            <div className="warm-card p-8 text-center text-gray-500 border-dashed border-2">
              <p>You have no active voting authorization requests.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {requests.map((req: any) => (
                 <div key={req.id} className="warm-card p-6 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-white border border-[rgba(26,26,26,0.1)]">
                   <div className="flex-1">
                     <p className="font-semibold">{req.election_name}</p>
                     <p className="text-sm text-gray-500 capitalize">{req.reason_category} - {new Date(req.created_at).toLocaleDateString()}</p>
                     {req.status === 'rejected' && <p className="text-sm text-red-600 mt-2 font-medium">This request was rejected. You may appeal with missing documents.</p>}
                   </div>
                   <div className="flex items-center gap-4 flex-wrap sm:flex-nowrap">
                      {!['withdrawn', 'rejected', 'appeal_resolved', 'final_approved'].includes(req.status) && (
                        <button 
                           onClick={() => withdrawMutation.mutate(req.id)}
                           className="text-xs text-red-500 hover:underline"
                        >
                           Withdraw
                        </button>
                      )}
                      {req.status === 'rejected' && (
                        <button 
                           onClick={() => setAppealingRequest(req.id)}
                           className="text-xs text-blue-600 font-medium hover:underline px-3 py-1 border border-blue-200 rounded"
                        >
                           Submit Appeal
                        </button>
                      )}
                      <span className="px-3 py-1 bg-[#5A5A40]/10 text-[#5A5A40] text-sm uppercase tracking-wider rounded-md font-semibold font-mono whitespace-nowrap">
                        {req.status.replace(/_/g, ' ')}
                      </span>
                   </div>
                 </div>
              ))}
            </div>
          )
        }
      </section>

      <section>
        <h3 className="text-xl font-medium mb-6 flex items-center gap-2"><CheckCircle className="w-5 h-5 text-[#5A5A40]" /> Upcoming Elections</h3>
        {loadingElections ? <div className="animate-pulse h-24 bg-gray-100 rounded-md"></div> : 
          (!elections || elections.length === 0) ? (
            <div className="p-8 text-center text-gray-500">
              <p>No active elections found for your registered constituency.</p>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2">
              {elections.map((elec) => {
                 return (
                   <div key={elec.id} className="warm-card p-6 relative overflow-hidden group hover:shadow-lg transition-all border border-[rgba(26,26,26,0.1)]">
                     <h4 className="font-semibold text-lg">{elec.name}</h4>
                     <p className="text-sm text-gray-600 mt-2 pb-6">Election Date: {new Date(elec.election_date).toLocaleDateString()}</p>
                     <p className="text-xs text-red-600 mb-6">Deadline: {new Date(elec.request_deadline).toLocaleDateString()}</p>
                     
                     <button 
                       onClick={() => navigate(`/request?electionId=${elec.id}`)}
                       className="olive-button w-full text-sm font-medium hover:bg-[#4a4a35]"
                     >
                       <Plus className="w-4 h-4 inline-block mr-2" /> Apply for Postal Ballot
                     </button>
                   </div>
                 )
              })}
            </div>
          )
        }
      </section>

      {/* Appeal Modal */}
      {appealingRequest && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-serif text-xl">Submit Appeal</h3>
              <button onClick={() => { setAppealingRequest(null); setAppealFile(null); }}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-4">Please upload any additional documents to support your appeal.</p>
            <input 
               type="file" 
               accept="image/jpeg,image/png,application/pdf"
               onChange={e => e.target.files && setAppealFile(e.target.files[0])}
               className="w-full text-sm font-medium text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-gray-100 mb-6" 
            />
            <button 
               onClick={() => appealFile && appealMutation.mutate({ id: appealingRequest, file: appealFile })}
               disabled={!appealFile || appealMutation.isPending}
               className="olive-button w-full disabled:opacity-50"
            >
               {appealMutation.isPending ? 'Submitting...' : 'Upload & Appeal'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
