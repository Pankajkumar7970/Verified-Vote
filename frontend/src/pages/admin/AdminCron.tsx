import React from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

export default function AdminCron() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-cron'],
    queryFn: async () => (await axios.get('/api/admin/cron')).data.jobs,
  });

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-serif">Cron Jobs</h2>
      <div className="warm-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-[#f5f2ed] text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Job</th>
              <th className="px-4 py-3">Last run</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y font-mono text-xs">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="p-6 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : (
              data?.map((j: { job_name: string; last_run_at: string; last_status: string; last_error: string }) => (
                <tr key={j.job_name}>
                  <td className="px-4 py-3">{j.job_name}</td>
                  <td className="px-4 py-3">{j.last_run_at ? new Date(j.last_run_at).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3">{j.last_status || '—'}</td>
                  <td className="px-4 py-3 text-red-600 truncate max-w-xs">{j.last_error || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
