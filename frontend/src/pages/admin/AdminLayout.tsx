import React, { useState } from "react";
import { Navigate, Outlet, Link, useLocation } from "react-router-dom";
import { useAuth } from "../../store/AuthContext";
import {
  LogOut,
  ShieldCheck,
  Menu,
  FileText,
  Calendar,
  Users,
  Clock,
  Settings,
  ListOrdered,
} from "lucide-react";

export default function AdminLayout() {
  const { isAuthenticated, admin, logout } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  return (
    <div className="min-h-screen bg-[#f5f2ed] flex font-sans">
      {/* Sidebar */}
      <aside
        className={`bg-white border-r border-[rgba(26,26,26,0.1)] shadow-sm flex flex-col sticky top-0 h-screen transition-all duration-300 ${
          sidebarCollapsed ? "w-16" : "w-64"
        }`}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-[rgba(26,26,26,0.1)]">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-6 h-6 text-[#5A5A40]" />
              <h1 className="text-lg font-serif font-semibold tracking-tight">
                Electoral Admin
              </h1>
            </div>
          )}
          {sidebarCollapsed && (
            <ShieldCheck className="w-6 h-6 text-[#5A5A40] mx-auto" />
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1 rounded hover:bg-gray-100"
          >
            <Menu className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto">
          <ul className="space-y-1 px-2">
            <li>
              <Link
                to="/admin/requests"
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${
                  location.pathname === "/admin/requests"
                    ? "bg-[#5A5A40]/10 text-[#5A5A40]"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                <FileText className="w-5 h-5 flex-shrink-0" />
                {!sidebarCollapsed && <span>Requests</span>}
              </Link>
            </li>
            {admin?.role === "super_admin" && (
              <>
                <li>
                  <Link
                    to="/admin/elections"
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${
                      location.pathname === "/admin/elections"
                        ? "bg-[#5A5A40]/10 text-[#5A5A40]"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Calendar className="w-5 h-5 flex-shrink-0" />
                    {!sidebarCollapsed && <span>Elections</span>}
                  </Link>
                </li>
                <li>
                  <Link
                    to="/admin/parties"
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${
                      location.pathname === "/admin/parties"
                        ? "bg-[#5A5A40]/10 text-[#5A5A40]"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Users className="w-5 h-5 flex-shrink-0" />
                    {!sidebarCollapsed && <span>Parties</span>}
                  </Link>
                </li>
                <li>
                  <Link
                    to="/admin/sessions"
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${
                      location.pathname === "/admin/sessions"
                        ? "bg-[#5A5A40]/10 text-[#5A5A40]"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Clock className="w-5 h-5 flex-shrink-0" />
                    {!sidebarCollapsed && <span>Sessions</span>}
                  </Link>
                </li>
                <li>
                  <Link
                    to="/admin/cron"
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${
                      location.pathname === "/admin/cron"
                        ? "bg-[#5A5A40]/10 text-[#5A5A40]"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <Settings className="w-5 h-5 flex-shrink-0" />
                    {!sidebarCollapsed && <span>Cron</span>}
                  </Link>
                </li>
                <li>
                  <Link
                    to="/admin/audit"
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${
                      location.pathname === "/admin/audit"
                        ? "bg-[#5A5A40]/10 text-[#5A5A40]"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <ListOrdered className="w-5 h-5 flex-shrink-0" />
                    {!sidebarCollapsed && <span>Audit Logs</span>}
                  </Link>
                </li>
              </>
            )}
          </ul>
        </nav>

        <div className="border-t border-[rgba(26,26,26,0.1)] p-4">
          {!sidebarCollapsed && (
            <div className="mb-3">
              <p className="text-xs text-gray-500 uppercase tracking-wider">
                Role
              </p>
              <p className="text-sm font-medium text-[#5A5A40]">
                {admin?.role.replace("_", " ")}
              </p>
              <p className="text-xs text-gray-600 mt-1">
                Logged in as {admin?.username}
              </p>
            </div>
          )}
          <button
            onClick={logout}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:text-red-700 hover:bg-red-50 w-full ${
              sidebarCollapsed ? "justify-center" : ""
            }`}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!sidebarCollapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-[rgba(26,26,26,0.1)] shadow-sm h-16 flex items-center justify-between px-4 sm:px-6 lg:px-8">
          <h1 className="text-xl font-serif font-semibold tracking-tight">
            Dashboard
          </h1>
        </header>
        <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
