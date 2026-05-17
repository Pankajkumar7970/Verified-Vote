import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Plus, Trash2, Users } from 'lucide-react';
import { useAuth } from '../../store/AuthContext';

interface Party {
  id: string;
  name: string;
  abbreviation: string | null;
  is_active: boolean;
}

export default function PartyManagement() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newParty, setNewParty] = useState({ name: '', abbreviation: '' });
  const [error, setError] = useState('');

  const { data: parties, isLoading } = useQuery({
    queryKey: ['admin-parties'],
    queryFn: async () => {
      const res = await axios.get('/api/admin/parties');
      return res.data.parties as Party[];
    }
  });

  const createMutation = useMutation({
    mutationFn: async (payload: { name: string, abbreviation: string }) => {
      return axios.post('/api/admin/parties', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-parties'] });
      setNewParty({ name: '', abbreviation: '' });
      setError('');
    },
    onError: (err: any) => {
      if (err.response?.data?.error === 'party_exists') {
         setError('A party with this name already exists.');
      } else {
         setError('Failed to create party.');
      }
    }
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => axios.delete(`/api/admin/parties/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-parties'] })
  });

  if (user?.role !== 'super_admin') {
     return <div className="p-8 text-center text-gray-500">Only Super Admins can manage parties.</div>;
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newParty.name.trim()) return;
    createMutation.mutate(newParty);
  };

  return (
    <div className="p-4 sm:p-8 space-y-8 max-w-5xl mx-auto">
       <div className="flex justify-between items-end border-b pb-4">
         <div>
           <h2 className="text-3xl font-serif text-[#1a1a1a]">Political Parties</h2>
           <p className="text-sm text-gray-500 mt-1">Manage recognized parties assigned to candidates.</p>
         </div>
      </div>

      <div className="grid md:grid-cols-3 gap-8">
         <div className="md:col-span-1">
            <div className="warm-card p-6 bg-white border border-[rgba(26,26,26,0.1)]">
               <h3 className="font-semibold mb-4">Add New Party</h3>
               
               {error && <p className="text-xs text-red-600 mb-4">{error}</p>}
               
               <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Party Name *</label>
                    <input 
                       className="w-full border px-3 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] text-sm"
                       value={newParty.name}
                       onChange={e => setNewParty({...newParty, name: e.target.value})}
                       required
                       placeholder="e.g. National Democratic Party"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Abbreviation</label>
                    <input 
                       className="w-full border px-3 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] text-sm"
                       value={newParty.abbreviation}
                       onChange={e => setNewParty({...newParty, abbreviation: e.target.value})}
                       placeholder="e.g. NDP"
                    />
                  </div>
                  <button 
                     type="submit"
                     disabled={createMutation.isPending || !newParty.name}
                     className="w-full olive-button py-2 flex justify-center items-center gap-2 text-sm disabled:opacity-50"
                  >
                     <Plus className="w-4 h-4" /> Add Party
                  </button>
               </form>
            </div>
         </div>

         <div className="md:col-span-2">
            <div className="warm-card bg-white border border-[rgba(26,26,26,0.1)] overflow-hidden">
               {isLoading ? <div className="p-8 text-center text-gray-400">Loading...</div> : 
                 (parties?.length === 0) ? <div className="p-8 text-center text-gray-400">No parties added yet.</div> : (
                   <table className="w-full text-left text-sm">
                      <thead className="bg-[#5A5A40]/5 border-b border-[rgba(26,26,26,0.1)]">
                        <tr>
                           <th className="p-4 font-semibold text-[#5A5A40]">Name</th>
                           <th className="p-4 font-semibold text-[#5A5A40]">Abbr.</th>
                           <th className="p-4 font-semibold text-[#5A5A40] text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[rgba(26,26,26,0.1)]">
                         {parties?.map(p => (
                            <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                               <td className="p-4 font-medium">{p.name}</td>
                               <td className="p-4 text-gray-500">{p.abbreviation || '-'}</td>
                               <td className="p-4 text-right">
                                  <button 
                                     onClick={() => {
                                        if (confirm(`Are you sure you want to deactivate ${p.name}?`)) {
                                           deactivateMutation.mutate(p.id);
                                        }
                                     }}
                                     className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded transition-colors"
                                     title="Deactivate Party"
                                  >
                                     <Trash2 className="w-4 h-4" />
                                  </button>
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
