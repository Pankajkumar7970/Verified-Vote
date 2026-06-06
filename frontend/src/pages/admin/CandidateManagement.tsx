import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Search } from 'lucide-react';

export default function CandidateManagement() {
  const { id: electionId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [partyId, setPartyId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: candidates, isLoading } = useQuery({
    queryKey: ['candidates', electionId],
    queryFn: async () => {
      const res = await axios.get(`/api/admin/elections/${electionId}/candidates`);
      return res.data.candidates;
    },
    enabled: !!electionId,
  });

  const { data: parties } = useQuery({
    queryKey: ['parties'],
    queryFn: async () => (await axios.get('/api/admin/parties')).data.parties,
  });

  const filteredCandidates = candidates?.filter((c: { name: string; party_name: string }) => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    c.party_name.toLowerCase().includes(searchQuery.toLowerCase())
  ) ?? [];

  const addMutation = useMutation({
    mutationFn: () =>
      axios.post(`/api/admin/elections/${electionId}/candidates`, {
        name,
        party_id: partyId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates', electionId] });
      setName('');
      setPartyId('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (candidateId: string) => axios.delete(`/api/admin/elections/candidates/${candidateId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['candidates', electionId] }),
  });

  if (!electionId) return <div className="p-8">Missing election ID.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/admin/elections" className="text-sm text-[#5A5A40] hover:underline">
          ← Elections
        </Link>
        <h2 className="text-3xl font-serif">Candidates</h2>
      </div>

      <div className="warm-card p-6 space-y-4 max-w-lg">
        <h3 className="font-semibold">Add candidate</h3>
        <input
          className="w-full border px-3 py-2 rounded text-sm"
          placeholder="Candidate name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Candidate name"
        />
        <select
          className="w-full border px-3 py-2 rounded text-sm"
          value={partyId}
          onChange={(e) => setPartyId(e.target.value)}
          aria-label="Party"
        >
          <option value="">
            {parties?.length === 0 ? 'Create a Party first in Party Management' : 'Select party'}
          </option>
          {parties?.map((p: { id: string; name: string }) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="olive-button"
          disabled={!name || !partyId || addMutation.isPending}
          onClick={() => addMutation.mutate()}
        >
          Add candidate
        </button>
        {addMutation.isError && (
          <p className="text-red-500 text-sm mt-2">
            {(addMutation.error as any).response?.data?.message || (addMutation.error as any).response?.data?.error || 'Failed to add candidate. Make sure you are a Super Admin.'}
          </p>
        )}
      </div>

      <div className="warm-card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">
            Loading…
          </div>
        ) : (
          <>
            <div className="p-4 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search candidates..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]"
                />
              </div>
            </div>
            <table className="w-full text-sm text-left">
              <thead className="bg-[#f5f2ed] text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Party</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredCandidates.map((c: { id: string; name: string; party_name: string }) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3">{c.name}</td>
                    <td className="px-4 py-3">{c.party_name}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="text-red-600 text-xs"
                        onClick={() => deleteMutation.mutate(c.id)}
                        aria-label={`Delete ${c.name}`}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
