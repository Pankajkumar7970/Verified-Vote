import React, { useRef, useState, useCallback } from 'react';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import { Camera, Check, Upload, ArrowLeft } from 'lucide-react';
import { useVoterAuth } from '../../store/VoterContext';

function WebCamCapture({ onCapture }: { onCapture: (b64: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [camError, setCamError] = useState('');

  const startVideo = async () => {
    try {
      setCamError('');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      streamRef.current = stream;
      setHasStarted(true);
    } catch (err) {
      setCamError("Camera access is required for verification.");
    }
  };

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg");
    onCapture(dataUrl);

    // Stop Stream
    streamRef.current?.getTracks().forEach(t => t.stop());
  };

  return (
    <div className="bg-gray-100 rounded-md overflow-hidden aspect-square sm:aspect-video flex items-center justify-center relative">
      {camError ? (
         <div className="text-red-500 text-sm p-4 text-center bg-red-50 border border-red-200 rounded">{camError}</div>
      ) : !hasStarted ? (
        <button onClick={startVideo} type="button" className="olive-button flex items-center gap-2">
           <Camera className="w-5 h-5" /> Start Camera
        </button>
      ) : (
        <>
          <video ref={videoRef} autoPlay playsInline muted className="min-w-full min-h-full object-cover" />
          <button 
             type="button"
             onClick={captureFrame} 
             className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white/20 hover:bg-white/40 text-black p-4 rounded-full backdrop-blur-md transition-all shadow-lg border border-white/50"
          >
             <Camera className="w-8 h-8 text-white" />
          </button>
        </>
      )}
    </div>
  );
}

export default function RequestForm() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const electionId = searchParams.get('electionId');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { token } = useVoterAuth();

  const [form, setForm] = useState({
     reason_category: 'medical',
     reason_detail: '',
     doc_type: 'hospital_letter'
  });
  const [file, setFile] = useState<File | null>(null);
  const [selfieB64, setSelfieB64] = useState<string | null>(null);

  if (!electionId) {
    return <div className="p-8">No election specified.</div>;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setError('Please upload a supporting document.');
    if (!selfieB64) return setError('A verification photo is required.');

    setLoading(true);
    setError('');

    const formData = new FormData();
    formData.append('election_id', electionId);
    formData.append('reason_category', form.reason_category);
    formData.append('reason_detail', form.reason_detail);
    formData.append('doc_type', form.doc_type);
    formData.append('doc', file);
    formData.append('selfie_b64', selfieB64); 

    try {
      await axios.post('/api/voter/requests/submit', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      navigate('/dashboard');
    } catch (err: any) {
      if (err.response?.data?.error === 'duplicate_request') {
        setError(err.response.data.message);
      } else {
        setError('Failed to submit the request. Please ensure files are within 10MB.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-8 pt-8 pb-24 font-sans">
      <button onClick={() => navigate('/dashboard')} className="mb-6 flex items-center text-sm text-gray-500 hover:text-[#1a1a1a]">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
      </button>

      <div className="warm-card p-6 sm:p-10 space-y-8">
        <div>
          <h2 className="text-3xl font-serif">Apply for Postal Ballot</h2>
          <p className="text-gray-500 mt-2 text-sm leading-relaxed">Ensure all details are accurate. Misrepresentation may lead to immediate rejection.</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md" role="alert" aria-live="polite">
            <span className="block sm:inline text-sm font-semibold">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-1">Reason Category</label>
              <select 
                className="w-full border px-4 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] focus:ring-[#5A5A40]"
                value={form.reason_category}
                onChange={e => setForm({...form, reason_category: e.target.value})}
              >
                <option value="medical">Medical / Disability</option>
                <option value="military">Military Service</option>
                <option value="abroad">Abroad / NRI</option>
                <option value="remote_work">Remote Work / Essential Services</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Document Type</label>
              <select 
                className="w-full border px-4 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] focus:ring-[#5A5A40]"
                value={form.doc_type}
                onChange={e => setForm({...form, doc_type: e.target.value})}
              >
                <option value="disability_cert">Disability Certificate</option>
                <option value="army_id">Army ID</option>
                <option value="passport">Passport</option>
                <option value="hospital_letter">Hospital Letter</option>
                <option value="work_contract">Work Contract</option>
              </select>
            </div>
          </div>

           <div>
              <label className="block text-sm font-medium mb-1">Upload Document (PDF/JPG/PNG, Max 10MB)</label>
              <input 
                type="file" 
                accept="image/jpeg,image/png,application/pdf"
                className="w-full text-sm font-medium text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-[#5A5A40]/10 file:text-[#5A5A40] hover:file:bg-[#5A5A40]/20 max-w-full"
                onChange={e => e.target.files && setFile(e.target.files[0])}
              />
           </div>

           <div>
              <label className="block text-sm font-medium mb-1">Details / Notes (Optional)</label>
              <textarea 
                className="w-full border px-4 py-2 rounded-md bg-[#f5f2ed] border-[rgba(26,26,26,0.1)] focus:ring-[#5A5A40] h-24 resize-none"
                value={form.reason_detail}
                maxLength={500}
                onChange={e => setForm({...form, reason_detail: e.target.value})}
              />
           </div>

           <div className="pt-6 border-t border-[rgba(26,26,26,0.1)]">
              <label className="block text-sm font-medium mb-4">Liveness Verification Photo</label>
              <p className="text-xs text-gray-500 mb-4">A live photo is required to create your biometric baseline. Ensure you are in a well-lit area without sunglasses or hats.</p>
              
              {!selfieB64 ? 
                 <WebCamCapture onCapture={(b64) => setSelfieB64(b64.split(',')[1])} /> : 
                 <div className="relative inline-block border-2 border-green-500 rounded-md overflow-hidden aspect-square w-32 sm:w-48">
                    <img src={`data:image/jpeg;base64,${selfieB64}`} alt="Selfie Validation" className="w-full h-full object-cover" />
                    <div className="absolute top-2 right-2 bg-green-500 text-white rounded-full p-1"><Check className="w-4 h-4" /></div>
                 </div>
              }
           </div>

           <button 
             type="submit" 
             disabled={loading || !file || !selfieB64}
             className="w-full olive-button flex justify-center items-center py-3 text-lg disabled:opacity-50"
           >
             {loading ? 'Submitting securely...' : 'Submit Request'}
           </button>
        </form>
      </div>
    </div>
  );
}
