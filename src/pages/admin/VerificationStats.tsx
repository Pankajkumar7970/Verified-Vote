import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

export default function VerificationStats() {
  const { id: electionId } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['verification-stats', electionId],
    queryFn: async () =>
      (await axios.get(`/api/admin/verification/${electionId}/distribution`)).data.distribution,
    enabled: !!electionId,
  });

  return (
    <div className="space-y-6">
      <Link to="/admin/elections" className="text-sm text-[#5A5A40] hover:underline">
        ← Elections
      </Link>
      <h2 className="text-3xl font-serif">Verification scores</h2>
      <div className="warm-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-[#f5f2ed] text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Count</th>
              <th className="px-4 py-3">Passed</th>
              <th className="px-4 py-3">Avg face</th>
              <th className="px-4 py-3">Avg liveness</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : data?.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-gray-500">
                  No verification data yet.
                </td>
              </tr>
            ) : (
              data?.map(
                (row: {
                  verification_type: string;
                  total: number;
                  passed: number;
                  avg_face_score: string;
                  avg_liveness_score: string;
                }) => (
                  <tr key={row.verification_type}>
                    <td className="px-4 py-3 capitalize">{row.verification_type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3">{row.total}</td>
                    <td className="px-4 py-3">{row.passed}</td>
                    <td className="px-4 py-3">{row.avg_face_score}</td>
                    <td className="px-4 py-3">{row.avg_liveness_score}</td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
