# VerifiedVote AI Service — Dockerfile
# Target: Koyeb free tier (GPU optional, CPU default)
# Base: python:3.11-slim to keep image size manageable

FROM python:3.11-slim

# ── System dependencies ───────────────────────────────────────────────────────
# libgl1 + libglib2.0-0 are required by opencv-python-headless
# libgomp1 is required by some numpy/deepface C extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# ── Working directory ─────────────────────────────────────────────────────────
WORKDIR /app

# ── Python dependencies ───────────────────────────────────────────────────────
# Copy requirements first for better Docker layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Pre-download DeepFace VGG-Face weights at build time ─────────────────────
# This bakes the model weights into the image so the container starts fast
# (no download on first request) and works without outbound internet at runtime.
# Architecture rule: "Model loaded at service startup — not on first request."
RUN python - <<'EOF'
from deepface import DeepFace
import numpy as np, cv2, os

# Trigger weight download using a blank dummy image
dummy = np.ones((224, 224, 3), dtype=np.uint8) * 255
cv2.imwrite("/tmp/_build_warmup.jpg", dummy)
DeepFace.represent(
    img_path="/tmp/_build_warmup.jpg",
    model_name="VGG-Face",
    detector_backend="opencv",
    enforce_detection=False,
)
os.remove("/tmp/_build_warmup.jpg")
print("VGG-Face weights downloaded and cached.")
EOF

# ── Application code ──────────────────────────────────────────────────────────
COPY main.py liveness.py models.py ./

# ── Non-root user for security ────────────────────────────────────────────────
RUN useradd --create-home --shell /bin/bash appuser
USER appuser

# ── Runtime ───────────────────────────────────────────────────────────────────
EXPOSE 8000

# --workers 1: DeepFace model is not fork-safe; use single worker.
# --timeout-keep-alive 30: slightly longer than Node's 10s request timeout.
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--timeout-keep-alive", "30", \
     "--log-level", "info"]
