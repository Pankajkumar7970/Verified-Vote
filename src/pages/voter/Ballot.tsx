import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ShieldCheck } from 'lucide-react';

interface Candidate {
  id: string;
  name: string;
  party_name: string;
  party_abbrev: string;
}

export default function Ballot({ onVoteCast, errorMsg, setErrorMsg }: { onVoteCast: (id: string) => void, errorMsg: string, setErrorMsg: (msg: string) => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/api/vote/candidates')
      .then(res => {
        setCandidates(res.data.candidates);
        setLoading(false);
      })
      .catch(err => {
        setErrorMsg('Failed to load candidates.');
        setLoading(false);
      });
  }, [setErrorMsg]);

  if (loading) return <div className="p-12 text-center">Loading encrypted ballot...</div>;

  if (confirming && selectedCandidate) {
    const candidate = candidates.find(c => c.id === selectedCandidate);
    return (
      <div className="max-w-md mx-auto p-8 mt-12 bg-white border border-gray-200 rounded-xl text-center shadow-sm">
        <ShieldCheck className="w-12 h-12 text-[#5A5A40] mx-auto mb-4" />
        <h2 className="text-2xl font-serif mb-6">Confirm Your Vote</h2>
        
        <div className="bg-[#f5f2ed] p-6 rounded-lg mb-8">
          <p className="text-sm text-gray-500 uppercase tracking-wider mb-2">You are voting for</p>
          <p className="text-xl font-medium">{candidate?.name}</p>
          <p className="text-gray-600">{candidate?.party_name}</p>
        </div>

        {errorMsg && <p className="text-red-600 text-sm mb-4">{errorMsg}</p>}

        <div className="flex gap-4">
          <button 
             onClick={() => setConfirming(false)}
             className="flex-1 py-3 px-4 border rounded-md hover:bg-gray-50 text-gray-700 font-medium"
          >
             Go Back
          </button>
          <button 
             onClick={() => onVoteCast(selectedCandidate)}
             className="flex-1 py-3 px-4 olive-button font-medium"
          >
             Confirm & Cast
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-8 mt-4 sm:mt-12">
      <div className="mb-8 border-b pb-4">
         <h2 className="text-3xl font-serif text-[#1a1a1a]">Official Ballot</h2>
         <p className="text-gray-500 mt-2">Select one candidate and click 'Continue'. Your choice will be encrypted.</p>
      </div>
      
      {errorMsg && <p className="text-red-500 mb-4 bg-red-50 p-3 rounded">{errorMsg}</p>}

      <div className="space-y-3">
        {candidates.map(c => (
          <label 
            key={c.id} 
            className={`block p-4 border rounded-xl cursor-pointer transition-colors
              ${selectedCandidate === c.id ? 'border-[#5A5A40] bg-[#5A5A40]/5 shadow-sm' : 'border-gray-200 hover:border-gray-300'}
            `}
          >
            <div className="flex items-center gap-4">
               <input 
                 type="radio" 
                 name="candidate" 
                 value={c.id}
                 checked={selectedCandidate === c.id}
                 onChange={() => setSelectedCandidate(c.id)}
                 className="w-5 h-5 accent-[#5A5A40]"
                 aria-label={`Vote for ${c.name}, ${c.party_name}`}
               />
               <div className="flex-1">
                 <p className="font-medium text-lg">{c.name}</p>
                 <p className="text-gray-600 text-sm">{c.party_name} {c.party_abbrev ? `(${c.party_abbrev})` : ''}</p>
               </div>
            </div>
          </label>
        ))}
      </div>

      <div className="mt-12 pt-6 border-t flex justify-end">
        <button 
           onClick={() => setConfirming(true)}
           disabled={!selectedCandidate}
           className="olive-button px-8 py-3 text-lg font-medium disabled:opacity-50"
        >
           Continue
        </button>
      </div>
    </div>
  );
}
