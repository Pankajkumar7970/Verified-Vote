import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { Fingerprint, CheckCircle2, AlertCircle } from 'lucide-react';
import SelfieCapture from '../../components/SelfieCapture';
import Ballot from './Ballot';

export default function VotingSession() {
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref');
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [step, setStep] = useState<'resolve' | 'otp' | 'face' | 'ballot' | 'receipt' | 'error'>('resolve');
  const [resolveData, setResolveData] = useState<{ phone_mask: string; nonce: string; } | null>(null);
  const [otp, setOtp] = useState('');
  const [token, setToken] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [selfieStatus, setSelfieStatus] = useState<'idle' | 'verifying' | 'failed' | 'success'>('idle');
  const [receiptToken, setReceiptToken] = useState('');

  useEffect(() => {
    if (refCode && step === 'resolve') {
      axios.post('/api/session/resolve', { ref_code: refCode })
        .then(res => {
          setResolveData(res.data);
          setStep('otp');
        })
        .catch(err => {
          setErrorMsg(err.response?.data?.message || 'Invalid or expired link.');
          setStep('error');
        });
    }
  }, [refCode, step]);

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.post('/api/session/verify-otp', {
        ref_code: refCode,
        nonce: resolveData?.nonce,
        otp
      });
      setToken(res.data.token);
      axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;
      setStep('face');
      setErrorMsg('');
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error === 'invalid_otp' ? 'Incorrect OTP' : 'Verification failed');
    }
  };

  const handleSelfieCapture = async (b64: string) => {
    setSelfieStatus('verifying');
    try {
      const res = await axios.post('/api/session/face-verify', { selfie_b64: b64 });
      if (res.data.success && res.data.state === 'face_verified') {
        setSelfieStatus('success');
        setTimeout(() => setStep('ballot'), 1500);
      } else {
        setSelfieStatus('failed');
      }
    } catch (err: any) {
      setSelfieStatus('failed');
    }
  };

  const handleVoteCast = async (candidateId: string) => {
     try {
       const res = await axios.post('/api/vote/cast', { candidate_id: candidateId });
       setReceiptToken(res.data.receipt_token);
       setStep('receipt');
     } catch(err) {
       setErrorMsg('Failed to submit vote. Your session may have expired.');
     }
  };

  // Render Logic
  if (!refCode) {
    return <div className="p-8 text-center text-red-600">Missing Voting Link reference code.</div>;
  }

  if (step === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
        <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
        <h2 className="text-2xl font-serif mb-2">Link Invalid or Expired</h2>
        <p className="text-gray-600">{errorMsg}</p>
      </div>
    );
  }

  if (step === 'resolve') {
    return <div className="flex justify-center p-12">Loading secure session...</div>;
  }

  if (step === 'otp') {
    return (
      <div className="max-w-md mx-auto p-4 sm:p-8 mt-12 warm-card">
        <h2 className="text-2xl font-serif text-center mb-6">Verify Identity</h2>
        <p className="text-center text-gray-600 text-sm mb-6">
          An OTP has been sent to your registered mobile number: <strong>{resolveData?.phone_mask}</strong>
        </p>
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <input
            type="text"
            className="w-full text-center tracking-widest text-lg py-3 border rounded-md"
            maxLength={6}
            value={otp}
            onChange={e => setOtp(e.target.value.replace(/\\D/g, ''))}
            placeholder="• • • • • •"
            required
            aria-label="OTP input"
          />
          {errorMsg && <p className="text-center text-red-500 text-sm" role="alert">{errorMsg}</p>}
          <button type="submit" className="w-full olive-button py-3 text-lg mt-4">
            Verify OTP
          </button>
        </form>
      </div>
    );
  }

  if (step === 'face') {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-8 mt-12 text-center">
        <Fingerprint className="w-12 h-12 mx-auto mb-4 text-[#5A5A40]" />
        <h2 className="text-2xl font-serif mb-4">Liveness & Face Match</h2>
        <p className="text-gray-600 mb-8 max-w-md mx-auto">
          Please capture your selfie. We will compare this against the photo you submitted during authorization.
        </p>

        {selfieStatus === 'idle' && (
          <div className="bg-white p-4 inline-block border-[10px] border-[#f5f2ed] rounded-3xl shadow-sm">
            <SelfieCapture onCapture={handleSelfieCapture} />
          </div>
        )}

        {selfieStatus === 'verifying' && (
           <div className="py-12">Verifying match... please wait.</div>
        )}

        {selfieStatus === 'failed' && (
           <div className="py-12 space-y-4">
             <AlertCircle className="w-12 h-12 text-red-500 mx-auto" />
             <p className="text-red-700">Face verification failed or liveness not detected.</p>
             <p className="text-gray-500 text-sm">Your session has been flagged for human review. Please try again later or contact support.</p>
           </div>
        )}

        {selfieStatus === 'success' && (
           <div className="py-12 space-y-4">
             <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
             <p className="font-medium text-lg">Verified successfully</p>
           </div>
        )}
      </div>
    );
  }

  if (step === 'ballot') {
    return <Ballot onVoteCast={handleVoteCast} errorMsg={errorMsg} setErrorMsg={setErrorMsg} />;
  }

  if (step === 'receipt') {
    return (
      <div className="max-w-xl mx-auto p-4 sm:p-8 mt-12 bg-white border shadow-sm text-center">
        <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-3xl font-serif mb-4">Vote Cast Successfully</h2>
        <p className="text-gray-600 mb-8">
          Thank you for participating in the democratic process remotely.
        </p>

        <div className="bg-gray-50 border p-6 text-left rounded-md w-full max-w-sm mx-auto">
           <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">Receipt Token</p>
           <p className="text-sm font-mono break-all">{receiptToken}</p>
           <p className="text-xs text-gray-400 mt-4">Timestamp: {new Date().toISOString()}</p>
        </div>

        <button 
           onClick={() => window.print()}
           className="mt-8 px-6 py-2 border rounded-md hover:bg-gray-50 text-sm font-medium"
        >
          Print Receipt
        </button>
      </div>
    );
  }

  return null;
}
