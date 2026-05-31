import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Ramp up to 50 users
    { duration: '1m', target: 50 },   // Stay at 50
    { duration: '30s', target: 0 },   // Ramp down
  ],
};

export default function () {
  const payload = JSON.stringify({
    embedding_a: Array(512).fill(0.1), // Mock embedding
    embedding_b: Array(512).fill(0.1),
  });
  
  const res = http.post('http://localhost:8000/verify', payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'face_score is valid': (r) => r.json().face_score <= 1.0,
  });
  
  sleep(1);
}
