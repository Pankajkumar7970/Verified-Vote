import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { RefreshCw, Trophy } from 'lucide-react';

export default function PublicResults() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const fetchResults = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await axios.get(`/api/public/elections/${id}/results`);
      setData(res.data.election);
    } catch {
      setError('Results are not published yet.');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  if (error) return <div className="p-8 text-center text-red-600">{error}</div>;
  if (!data && !isLoading) return <div className="p-8 text-center">Loading results...</div>;

  const tally = data?.results_snapshot?.tally || [];
  const totalVotes = tally.reduce((sum: number, row: any) => sum + (row.vote_count || 0), 0);

  const maxVotes = Math.max(...tally.map((row: any) => row.vote_count || 0), 1);

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-8">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl sm:text-3xl font-serif">{data?.name}</h1>
        <button
          onClick={fetchResults}
          disabled={isLoading}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      <p className="text-gray-500 mb-8">{data?.constituency}, {data?.state}</p>

      {totalVotes > 0 && (
        <div className="mb-8 p-4 bg-[#f5f2ed] rounded-lg border border-gray-200">
          <p className="text-lg font-semibold text-gray-800">Total Votes: {totalVotes.toLocaleString()}</p>
        </div>
      )}

      <div className="warm-card overflow-hidden">
        <div className="p-4 sm:p-6">
          <h2 className="text-xl font-serif mb-4 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-[#5A5A40]" /> Results
          </h2>

          <div className="space-y-4 mb-6">
            {tally.map((row: any, index: number) => {
              const percentage = totalVotes > 0 ? (row.vote_count / totalVotes) * 100 : 0;
              return (
                <div key={row.id} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{row.name}</p>
                      <p className="text-sm text-gray-500">{row.party_name}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{row.vote_count.toLocaleString()} votes</p>
                      <p className="text-sm text-gray-500">{percentage.toFixed(1)}%</p>
                    </div>
                  </div>
                  <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${index === 0 ? 'bg-[#5A5A40]' : 'bg-[#5A5A40]/60'}`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[400px]">
              <thead className="bg-[#f5f2ed]">
                <tr>
                  <th className="p-3 text-left">Candidate</th>
                  <th className="p-3 text-left">Party</th>
                  <th className="p-3 text-right">Votes</th>
                  <th className="p-3 text-right">Percentage</th>
                </tr>
              </thead>
              <tbody>
                {tally.map((row: any) => {
                  const percentage = totalVotes > 0 ? (row.vote_count / totalVotes) * 100 : 0;
                  return (
                    <tr key={row.id} className="border-t">
                      <td className="p-3">{row.name}</td>
                      <td className="p-3">{row.party_name}</td>
                      <td className="p-3 text-right">{row.vote_count.toLocaleString()}</td>
                      <td className="p-3 text-right">{percentage.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
