import React from 'react';
import { Navigate } from 'react-router-dom';
import { useVoterAuth } from "../../store/VoterContext";

export default function VoterRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useVoterAuth();
  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
