/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Routes, Route, useNavigate, Link, useLocation } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { Shield } from 'lucide-react';
import { AuthProvider } from './store/AuthContext';
import { VoterProvider, useVoterAuth } from './store/VoterContext';
import { FontSizeProvider } from './store/FontSizeContext';
import AdminLogin from './pages/admin/AdminLogin';
import AdminLayout from './pages/admin/AdminLayout';
import RequestQueue from './pages/admin/RequestQueue';
import PartyManagement from './pages/admin/PartyManagement';
import ElectionManagement from './pages/admin/ElectionManagement';
import VoterDashboard from './pages/voter/VoterDashboard';
import RequestForm from './pages/voter/RequestForm';
import VotingSession from './pages/voter/VotingSession';
import VerifyReceipt from './pages/voter/VerifyReceipt';
import AuditLogs from './pages/admin/AuditLogs';
import ElectionResults from './pages/admin/ElectionResults';

function Navbar() {
  const { t, i18n } = useTranslation();
  
  const toggleLanguage = () => {
    i18n.changeLanguage(i18n.language === 'en' ? 'hi' : 'en');
  };

  return (
    <header className="border-b border-[rgba(26,26,26,0.1)] bg-white/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-[#5A5A40]" />
          <h1 className="text-xl font-semibold tracking-tight text-[#1a1a1a]">
            {t('app.title', 'VerifiedVote')}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/verify-receipt" className="text-sm font-medium hover:text-[#5A5A40] transition-colors">Verify Receipt</Link>
          <Link to="/admin/login" className="text-sm font-medium hover:text-[#5A5A40] transition-colors">Admin Portal</Link>
          <button 
            onClick={toggleLanguage}
            className="text-sm font-medium hover:text-[#5A5A40] transition-colors"
          >
            {i18n.language === 'en' ? 'हिंदी' : 'English'}
          </button>
        </div>
      </div>
    </header>
  );
}

function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [voterId, setVoterId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post('/api/auth/verify-voter', { voter_id: voterId.trim() });
      navigate('/otp', { state: { session_nonce: response.data.session_nonce } });
    } catch (err: any) {
      if (err.response?.data?.error === 'voter_not_found') {
        setError('Your Voter ID was not found in the electoral rolls. Please check the ID or contact the election office.');
      } else if (err.response?.data?.error === 'too_many_requests') {
        setError('Too many requests. Please try again later.');
      } else {
        setError(t('errors.invalidVoterId', 'Invalid Voter ID format. Expected 3 letters + 7 digits.'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <div className="warm-card max-w-md w-full p-8 relative overflow-hidden">
        <div className="oversized-number absolute -top-4 -left-2 pointer-events-none select-none">
          01
        </div>
        
        <div className="relative z-10">
          <h2 className="text-2xl mb-2">{t('auth.verifyVoter', 'Verify Voter ID')}</h2>
          <p className="text-sm text-gray-500 mb-6 font-sans">
            Please enter your Voter ID to access the remote voting portal.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md mb-6" role="alert" aria-live="polite">
              <span className="block sm:inline text-sm">{error}</span>
            </div>
          )}

          <form onSubmit={handleVerify} className="space-y-6">
            <div>
              <label htmlFor="voterId" className="block text-sm font-medium text-gray-700 mb-1">
                {t('auth.voterIdLabel', 'Voter ID Number')}
              </label>
              <input
                id="voterId"
                type="text"
                placeholder="ABC1234567"
                required
                value={voterId}
                onChange={(e) => setVoterId(e.target.value.toUpperCase())}
                className="w-full px-4 py-2 bg-[#f5f2ed] border border-[rgba(26,26,26,0.2)] rounded-md focus:outline-none focus:ring-2 focus:ring-[#5A5A40] uppercase"
              />
            </div>
            
            <button
              type="submit"
              disabled={loading}
              className="w-full olive-button flex justify-center items-center font-medium font-sans disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export function VerifyOTP() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useVoterAuth();
  
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const sessionNonce = location.state?.session_nonce;

  if (!sessionNonce) {
    navigate('/');
    return null;
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await axios.post('/api/auth/verify-otp', { otp, session_nonce: sessionNonce });
      login(response.data.token);
      navigate('/dashboard');
    } catch (err: any) {
      if (err.response?.data?.error === 'max_attempts_reached') {
        setError('Too many attempts. Please request a new OTP.');
      } else if (err.response?.data?.error === 'otp_expired') {
        setError('This OTP has expired. Please request a new one.');
      } else {
        setError('Incorrect OTP. Please check and re-enter.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <div className="warm-card max-w-md w-full p-8 relative overflow-hidden">
        <div className="oversized-number absolute -top-4 -left-2 pointer-events-none select-none">
          02
        </div>
        
        <div className="relative z-10">
          <h2 className="text-2xl mb-2">Security Verification</h2>
          <p className="text-sm text-gray-500 mb-6 font-sans">
            Enter the 6-digit OTP sent to your registered mobile number.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md mb-6" role="alert" aria-live="polite">
              <span className="block sm:inline text-sm">{error}</span>
            </div>
          )}

          <form onSubmit={handleVerify} className="space-y-6">
            <div>
              <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-1">
                One-Time Password
              </label>
              <input
                id="otp"
                type="text"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="000000"
                required
                className="w-full px-4 py-3 bg-[#f5f2ed] border border-[rgba(26,26,26,0.2)] rounded-md focus:outline-none focus:ring-2 focus:ring-[#5A5A40] text-center text-xl tracking-widest font-mono"
              />
            </div>
            
            <button disabled={loading} type="submit" className="w-full olive-button flex justify-center items-center font-medium font-sans disabled:opacity-50">
              {loading ? 'Verifying...' : 'Verify'}
            </button>
            <button type="button" onClick={() => navigate('/')} className="w-full text-sm text-gray-500 hover:text-[#1a1a1a]">Request New OTP</button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <VoterProvider>
        <FontSizeProvider>
        <div className="min-h-screen text-[#1a1a1a]">
          <Routes>
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/verify-receipt" element={<VerifyReceipt />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route path="dashboard" element={<RequestQueue />} />
              <Route path="requests" element={<RequestQueue />} />
              <Route path="elections" element={<ElectionManagement />} />
              <Route path="elections/:id/results" element={<ElectionResults />} />
              <Route path="parties" element={<PartyManagement />} />
              <Route path="audit" element={<AuditLogs />} />
            </Route>
            
            <Route path="/*" element={
              <>
                <Navbar />
                <main>
                  <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/otp" element={<VerifyOTP />} />
                    <Route path="/dashboard" element={<VoterDashboard />} />
                    <Route path="/request" element={<RequestForm />} />
                    <Route path="/vote" element={<VotingSession />} />
                  </Routes>
                </main>
              </>
            } />
          </Routes>
        </div>
        </FontSizeProvider>
      </VoterProvider>
    </AuthProvider>
  );
}
