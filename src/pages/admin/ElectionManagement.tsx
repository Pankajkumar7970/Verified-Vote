import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Plus, Power, Eye } from 'lucide-react';
import { useAuth } from '../../store/AuthContext';
import { Link } from 'react-router-dom';

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

export default function ElectionManagement() {
  const { user, admin } = useAuth();
  const queryClient = useQueryClient();
  const [newElection, setNewElection] = useState({ name: '', constituency: '', state: '', election_date: '', request_deadline: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data: elections, isLoading } = useQuery({
    queryKey: ['admin-elections'],
    queryFn: async () => {
      const res = await axios.get('/api/admin/elections');
      return res.data.elections as Election[];
    }
  });

  const createMutation = useMutation({
    mutationFn: async (payload: typeof newElection) => {
      return axios.post('/api/admin/elections', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-elections'] });
      setNewElection({ name: '', constituency: '', state: '', election_date: '', request_deadline: '' });
      setError('');
    },
    onError: () => {
      setError('Failed to create election.');
    }
  });

  const activateMutation = useMutation({
    mutationFn: async (id: string) => {
      return axios.post(`/api/admin/elections/${id}/activate`);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-elections'] });
      setSuccess(`Election activated. Issued ${data.data.sessions_created} voting links via SMS.`);
      setTimeout(() => setSuccess(''), 5000);
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || 'Failed to activate election.');
      setTimeout(() => setError(''), 5000);
    }
  });

  if (admin?.role !== 'super_admin') {
     return <div className="p-8 text-center text-gray-500">Only Super Admins can manage elections.</div>;
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newElection.name.trim() || !newElection.constituency || !newElection.election_date) return;
    createMutation.mutate(newElection);
  };

  return (
    <div className="p-4 sm:p-8 space-y-8 max-w-6xl mx-auto">
       <div className="flex justify-between items-end border-b pb-4">
         <div>
           <h2 className="text-3xl font-serif text-[#1a1a1a]">Elections</h2>
           <p className="text-sm text-gray-500 mt-1">Manage elections in the system.</p>
         </div>
      </div>

      {success && <div className="bg-green-50 text-green-700 p-4 border border-green-200 rounded-md">{success}</div>}
      {error && <div className="bg-red-50 text-red-700 p-4 border border-red-200 rounded-md">{error}</div>}

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
                       onChange={e => setNewElection({...newElection, name: e.target.value})}
                       required
                       placeholder="2026 Assembly Election"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Constituency *</label>
                    <input 
                       className="w-full border px-3 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] text-sm"
                       value={newElection.constituency}
                       onChange={e => setNewElection({...newElection, constituency: e.target.value})}
                       required
                       placeholder="North West"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">State *</label>
                    <input 
                       className="w-full border px-3 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] text-sm"
                       value={newElection.state}
                       onChange={e => setNewElection({...newElection, state: e.target.value})}
                       required
                       placeholder="Delhi"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Election Date *</label>
                    <input 
                       type="date"
                       className="w-full border px-3 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] text-sm"
                       value={newElection.election_date}
                       onChange={e => setNewElection({...newElection, election_date: e.target.value})}
                       required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Request Deadline (UTC) *</label>
                    <input 
                       type="datetime-local"
                       className="w-full border px-3 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] text-sm"
                       value={newElection.request_deadline}
                       onChange={e => setNewElection({...newElection, request_deadline: e.target.value})}
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
            <div className="warm-card bg-white border border-[rgba(26,26,26,0.1)] overflow-hidden">
               {isLoading ? <div className="p-8 text-center text-gray-400">Loading...</div> : 
                 (elections?.length === 0) ? <div className="p-8 text-center text-gray-400">No elections scheduled.</div> : (
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
                         {elections?.map(e => (
                            <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                               <td className="p-4 font-medium">{e.name}</td>
                               <td className="p-4 text-gray-500">{e.constituency}, {e.state}</td>
                               <td className="p-4 text-gray-500">{new Date(e.election_date).toLocaleDateString()}</td>
                               <td className="p-4 uppercase text-xs flex items-center justify-between">
                                 <span>{e.status}</span>
                                 {e.status === 'upcoming' && (
                                     <button 
                                        onClick={() => {
                                          if(confirmId === e.id) {
                                             activateMutation.mutate(e.id);
                                             setConfirmId(null);
                                          } else {
                                             setConfirmId(e.id);
                                             setTimeout(() => setConfirmId(null), 3000);
                                          }
                                        }}
                                        disabled={activateMutation.isPending}
                                        className={`ml-4 text-[10px] px-2 py-1 rounded border disabled:opacity-50 ${confirmId === e.id ? 'bg-red-100 text-red-800 border-red-200 hover:bg-red-200' : 'bg-green-100 text-green-800 border-green-200 hover:bg-green-200'}`}
                                     >
                                       <Power className="inline w-3 h-3 mr-1" /> {confirmId === e.id ? 'Confirm?' : 'Activate'}
                                     </button>
                                 )}
                                 {(e.status === 'voting' || e.status === 'completed') && (
                                     <Link to={`/admin/elections/${e.id}/results`} className="ml-4 text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-1 border border-blue-200 bg-blue-50 px-2 py-1 rounded">
                                       <Eye className="w-3 h-3" /> Results
                                     </Link>
                                 )}
                               </td>
                            </tr>
                         ))}
                      </tbody>
                   </table>
                 )
               }
            </div>
         </div>
      </div>
    </div>
  );
}
