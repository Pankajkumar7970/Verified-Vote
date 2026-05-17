import React, { useState } from 'react';
import axios from 'axios';
import { CheckCircle2, XCircle, Search } from 'lucide-react';

export default function VerifyReceipt() {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await axios.get(`/api/public/verify-receipt/${encodeURIComponent(token.trim())}`);
      setResult(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Receipt not found or invalid.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto p-8 pt-16">
      <h1 className="text-3xl font-serif text-[#1a1a1a] mb-2">Verify Your Vote</h1>
      <p className="text-gray-600 mb-8">
        Enter the receipt token provided to you after casting your vote to confirm it was securely recorded. 
        Note that this validates the inclusion of your vote, but strictly masks your choice and identity.
      </p>

      <form onSubmit={verify} className="flex flex-col sm:flex-row gap-4 mb-8">
         <input 
           type="text" 
           placeholder="Enter your cryptographic receipt token..." 
           value={token}
           onChange={e => setToken(e.target.value)}
           className="flex-1 border p-3 rounded text-sm focus:ring focus:ring-[#5A5A40]/30 font-mono"
           required
         />
         <button 
           type="submit" 
           disabled={loading || !token.trim()}
           className="olive-button flex items-center justify-center gap-2"
         >
           {loading ? 'Verifying...' : <><Search className="w-4 h-4" /> Verify</>}
         </button>
      </form>

      {error && (
        <div className="bg-red-50 text-red-700 p-6 border border-red-200 rounded flex gap-4 mt-6">
           <XCircle className="w-6 h-6 shrink-0 mt-0.5" />
           <div>
             <h3 className="font-medium text-lg">Verification Failed</h3>
             <p className="text-sm mt-1">{error}</p>
           </div>
        </div>
      )}

      {result && (
        <div className="bg-[#f5f2ed] border border-[rgba(26,26,26,0.1)] p-6 rounded flex gap-4 mt-6">
           <CheckCircle2 className="w-6 h-6 shrink-0 text-green-600 mt-0.5" />
           <div>
             <h3 className="font-medium text-lg">Verified Successfully</h3>
             <ul className="text-sm mt-3 space-y-2 text-gray-700">
               <li><strong className="text-black">Election:</strong> {result.election_name}</li>
               <li><strong className="text-black">Cast At:</strong> {new Date(result.cast_at).toLocaleString()}</li>
               <li><strong className="text-black">Status:</strong> Securely appended to the tally register.</li>
             </ul>
           </div>
        </div>
      )}
    </div>
  );
}
