import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../../store/AuthContext";
import { Shield, Eye, EyeOff, ArrowLeft } from "lucide-react";

export default function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await axios.post("/api/admin/auth/login", {
        username,
        password,
      });
      login(response.data.token, {
        username: response.data.username,
        role: response.data.role,
      });
      navigate("/admin/dashboard");
    } catch (err: any) {
      if (err.response?.data?.error === "too_many_requests") {
        setError("Too many login attempts. Please try again later.");
      } else if (err.response?.data?.message) {
        setError(err.response.data.message);
      } else {
        setError(
          "Invalid credentials. Please check your username and password and try again.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f2ed] p-4">
      <div className="warm-card max-w-md w-full p-8 shadow-xl">
        <Link
          to="/"
          className="flex items-center text-sm text-gray-500 hover:text-[#1a1a1a] mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Home
        </Link>

        <div className="flex flex-col items-center mb-8">
          <Shield className="w-12 h-12 text-[#5A5A40] mb-4" />
          <h2 className="text-3xl font-serif text-[#1a1a1a]">Secure Portal</h2>
          <p className="text-sm text-gray-500 font-sans mt-2 tracking-wide uppercase">
            Admin Authorization Access
          </p>
          <p className="text-xs text-gray-400 mt-3 font-mono">
            From .env: SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD
          </p>
        </div>

        {error && (
          <div
            className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md mb-6"
            role="alert"
            aria-live="polite"
          >
            <span className="block sm:inline text-sm">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-4 py-3 bg-white border border-[rgba(26,26,26,0.1)] rounded-md focus:outline-none focus:ring-2 focus:ring-[#5A5A40] font-sans"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 bg-white border border-[rgba(26,26,26,0.1)] rounded-md focus:outline-none focus:ring-2 focus:ring-[#5A5A40] font-sans pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full olive-button py-3 text-lg mt-4 disabled:opacity-50"
          >
            {loading ? "Authenticating..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
