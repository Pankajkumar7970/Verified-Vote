import React from 'react';
import { Navigate, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../../store/AuthContext';
import { LogOut, ShieldCheck } from 'lucide-react';

export default function AdminLayout() {
  const { isAuthenticated, admin, logout } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  return (
    <div className="min-h-screen bg-[#f5f2ed] flex flex-col font-sans">
      <header className="bg-white border-b border-[rgba(26,26,26,0.1)] shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-[#5A5A40]" />
            <h1 className="text-xl font-serif font-semibold tracking-tight mr-4">Electoral Admin</h1>
            <nav className="flex space-x-4 ml-4">
              <Link to="/admin/requests" className="text-sm font-medium hover:text-[#5A5A40]">Requests</Link>
              {admin?.role === 'super_admin' && (
                <>
                  <Link to="/admin/elections" className="text-sm font-medium hover:text-[#5A5A40]">Elections</Link>
                  <Link to="/admin/parties" className="text-sm font-medium hover:text-[#5A5A40]">Parties</Link>
                  <Link to="/admin/audit" className="text-sm font-medium hover:text-[#5A5A40]">Audit Logs</Link>
                </>
              )}
            </nav>
            <span className="px-2 py-1 bg-[#5A5A40]/10 text-[#5A5A40] text-xs uppercase tracking-wider rounded-md ml-4">
              {admin?.role.replace('_', ' ')}
            </span>
          </div>
          <div className="flex items-center gap-6">
            <span className="text-sm text-gray-600">Logged in as {admin?.username}</span>
            <button 
              onClick={logout}
              className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-red-700 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
