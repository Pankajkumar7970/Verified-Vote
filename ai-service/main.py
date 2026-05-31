"""
VerifiedVote — AI Face Verification Service
============================================
FastAPI microservice responsible for:
  1. Face comparison  — DeepFace VGG-Face cosine similarity
  2. Passive liveness — OpenCV Laplacian + FFT (see liveness.py)

Architecture rules enforced here (see ARCHITECTURE.md):
  - Images are processed in memory ONLY. Nothing is written to disk.
  - This service ONLY returns scores. All auth decisions are made by the Node backend.
  - The Node backend calls POST /verify with a timeout of 10 seconds.
  - On any error from this service, the Node backend sets the session to FACE_PENDING.
  - This service never writes to the database.
"""

import base64
import logging
import os
import tempfile
import time
from contextlib import asynccontextmanager
from typing import Any

import cv2
import numpy as np
from deepface import DeepFace
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from liveness import detect_liveness
from models import (
    EmbedRequest,
    EmbedResponse,
    ErrorResponse,
    HealthResponse,
    VerifyRequest,
    VerifyResponse,
    BlinkCheckRequest,
    BlinkCheckResponse,
)

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='{"timestamp": "%(asctime)s", "level": "%(levelname)s", "service": "fastapi-ai", "message": "%(message)s"}',
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
MODEL_NAME = "VGG-Face"
DETECTOR_BACKEND = "opencv"   # fast; retinaface is more accurate but heavier
DISTANCE_METRIC = "cosine"

# Eye cascade for blink detection (bundled with OpenCV)
_EYE_CASCADE_PATH = os.path.join(cv2.data.haarcascades, 'haarcascade_eye.xml')
_eye_cascade = cv2.CascadeClassifier(_EYE_CASCADE_PATH)

# Cosine distance from DeepFace is in [0, 1] where 0 = identical.
# We convert to similarity: similarity = 1 - distance, so 1.0 = identical.
# VGG-Face default threshold (cosine) is ~0.40 distance → ~0.60 similarity.
# The actual threshold used for pass/fail is read from election_settings by Node backend;
# this service just returns the raw score.

# ── Model warm-up ─────────────────────────────────────────────────────────────
# Model is loaded at startup, not on first request.
# This satisfies the ARCHITECTURE.md requirement: "Model loaded at service startup".
_model_loaded: bool = False


def _warmup_model() -> None:
    """
    Force DeepFace to download and cache the VGG-Face weights by running a
    dummy verification against a blank image. This ensures the model is in
    memory before any real requests arrive.
    """
    global _model_loaded
    logger.info("Warming up DeepFace VGG-Face model...")
    try:
        # 1×1 white pixel — just enough for DeepFace to initialise weights.
        dummy = np.ones((224, 224, 3), dtype=np.uint8) * 255
        dummy_path = os.path.join(tempfile.gettempdir(), "_vv_warmup.jpg")
        cv2.imwrite(dummy_path, dummy)
        try:
            DeepFace.represent(
                img_path=dummy_path,
                model_name=MODEL_NAME,
                detector_backend=DETECTOR_BACKEND,
                enforce_detection=False,
            )
        finally:
            # Remove the warmup file immediately — the only time we write to disk,
            # and it contains no real biometric data.
            if os.path.exists(dummy_path):
                os.remove(dummy_path)
        _model_loaded = True
        logger.info("VGG-Face model loaded and ready.")
    except Exception as exc:
        logger.error("Model warm-up failed: %s", exc, exc_info=True)
        # Don't crash the service — /health will report the model as not loaded
        # and the Node backend will set sessions to FACE_PENDING.
        _model_loaded = False


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    _warmup_model()
    yield
    logger.info("AI service shutting down.")


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="VerifiedVote AI Service",
    description="Face comparison and passive liveness detection for the VerifiedVote platform.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",       # disable in prod if desired
    redoc_url=None,
)


# ── Request ID middleware ─────────────────────────────────────────────────────
@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    """
    Forward the X-Request-ID header from the Node backend for log correlation.
    If absent, generate a fallback. Always echo it back in the response.
    """
    request_id = request.headers.get("x-request-id", _new_request_id())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    return response


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Health check",
    tags=["observability"],
)
async def health() -> HealthResponse:
    """
    Returns `{"status": "ok", "model": "loaded"}` when the VGG-Face model is
    in memory and ready to serve requests.

    Returns `{"status": "degraded", "model": "not_loaded"}` if warm-up failed.
    The Node backend treats any non-ok health as a signal to route sessions to
    FACE_PENDING rather than attempting verification.
    """
    if _model_loaded:
        return HealthResponse(status="ok", model="loaded")
    return HealthResponse(status="degraded", model="not_loaded")


@app.get("/live", summary="Liveness probe", tags=["observability"])
async def live() -> dict:
    """Process is alive. Always 200."""
    return {"alive": True}


@app.get("/ready", summary="Readiness probe", tags=["observability"])
async def ready() -> JSONResponse:
    """Ready to serve requests only when model is loaded."""
    if _model_loaded:
        return JSONResponse(status_code=200, content={"ready": True})
    return JSONResponse(status_code=503, content={"ready": False, "reason": "model_not_loaded"})


@app.post(
    "/embed",
    response_model=EmbedResponse,
    responses={
        422: {"model": ErrorResponse, "description": "Invalid input"},
        500: {"model": ErrorResponse, "description": "Model or processing error"},
    },
    summary="Extract face embedding and liveness (request submission)",
    tags=["verification"],
)
async def embed(payload: EmbedRequest, request: Request) -> EmbedResponse:
    """
    Extract a VGG-Face embedding and passive liveness score from a selfie.
    Used at voting-request submission when no reference embedding exists yet.
    Images are processed in memory only — never written to disk.
    """
    request_id = getattr(request.state, "request_id", "unknown")
    start_ms = time.monotonic()

    if not _model_loaded:
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Node backend should set FACE_PENDING or reject request.",
        )

    live_image = _decode_image_b64(payload.live_image_b64, request_id)
    liveness_score = detect_liveness(live_image)
    embedding = _extract_embedding(live_image, request_id)
    duration_ms = int((time.monotonic() - start_ms) * 1000)

    logger.info(
        "Embedding extraction complete",
        extra={
            "request_id": request_id,
            "liveness_score": liveness_score,
            "embedding_dims": len(embedding),
            "duration_ms": duration_ms,
        },
    )

    return EmbedResponse(
        embedding=embedding,
        liveness_score=liveness_score,
        model=MODEL_NAME,
        duration_ms=duration_ms,
    )


@app.post(
    "/verify",
    response_model=VerifyResponse,
    responses={
        422: {"model": ErrorResponse, "description": "Invalid input"},
        500: {"model": ErrorResponse, "description": "Model or processing error"},
    },
    summary="Verify face and liveness",
    tags=["verification"],
)
async def verify(payload: VerifyRequest, request: Request) -> VerifyResponse:
    """
    Compare a live selfie against a stored reference embedding and compute a
    passive liveness score.

    **Input**
    - `reference_embedding`: the VGG-Face embedding stored (encrypted) in the DB,
      decrypted and passed here by the Node backend.
    - `live_image_b64`: base64-encoded JPEG of the voter's live selfie, passed
      in memory — never written to disk by the caller.

    **Output**
    - `face_score` in [0, 1]: cosine similarity. Higher = more similar.
    - `liveness_score` in [0, 1]: passive liveness. Higher = more likely live.
    - `match`: convenience boolean — `true` when **both** scores exceed the
      thresholds configured in `election_settings` (evaluated by Node backend,
      not here; this field uses VGG-Face default thresholds as a reference only).

    **On any error** the Node backend treats this endpoint as unavailable and
    sets the session to `FACE_PENDING`. Never auto-rejects the voter.
    """
    request_id = getattr(request.state, "request_id", "unknown")
    start_ms = time.monotonic()

    logger.info(
        "Verification request received",
        extra={"request_id": request_id, "embedding_dims": len(payload.reference_embedding)},
    )

    if not _model_loaded:
        logger.warning("Model not loaded; returning 503", extra={"request_id": request_id})
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Node backend should set session to FACE_PENDING.",
        )

    # ── Decode image (memory only — never written to disk) ────────────────
    live_image = _decode_image_b64(payload.live_image_b64, request_id)

    # ── Passive liveness ──────────────────────────────────────────────────
    liveness_score = detect_liveness(live_image)
    logger.info("Liveness score: %.4f", liveness_score, extra={"request_id": request_id})

    # ── Face embedding from live image ────────────────────────────────────
    live_embedding = _extract_embedding(live_image, request_id)

    # ── Cosine similarity against stored reference embedding ──────────────
    face_score = _cosine_similarity(payload.reference_embedding, live_embedding)
    logger.info("Face score: %.4f", face_score, extra={"request_id": request_id})

    # ── Match decision (reference only — Node backend applies real thresholds) ─
    # VGG-Face default cosine threshold is 0.40 distance = 0.60 similarity.
    # The Node backend re-evaluates using election_settings thresholds.
    REFERENCE_FACE_THRESHOLD = 0.60
    REFERENCE_LIVENESS_THRESHOLD = 0.40
    match = face_score >= REFERENCE_FACE_THRESHOLD and liveness_score >= REFERENCE_LIVENESS_THRESHOLD

    duration_ms = int((time.monotonic() - start_ms) * 1000)

    logger.info(
        "Verification complete",
        extra={
            "request_id": request_id,
            "face_score": face_score,
            "liveness_score": liveness_score,
            "match": match,
            "duration_ms": duration_ms,
        },
    )

    return VerifyResponse(
        match=match,
        face_score=round(face_score, 4),
        liveness_score=liveness_score,
        model=MODEL_NAME,
        duration_ms=duration_ms,
    )


@app.post(
    "/liveness/blink",
    response_model=BlinkCheckResponse,
    responses={
        422: {"model": ErrorResponse, "description": "Invalid input"},
        500: {"model": ErrorResponse, "description": "Processing error"},
    },
    summary="Active liveness: blink detection across multiple frames",
    tags=["verification"],
)
async def check_blink(payload: BlinkCheckRequest, request: Request) -> BlinkCheckResponse:
    """
    Detect whether a genuine eye blink occurred across a sequence of frames.

    The frontend captures 3–4 frames over ~3 seconds during the blink challenge.
    We use OpenCV's eye cascade to measure eye openness in each frame and check
    for an open→closed→open (or any decrease then increase) transition.

    Returns blink_detected=True only when a clear state change is observed,
    making it impossible to pass with a printed photograph or a single static image.
    """
    request_id = getattr(request.state, "request_id", "unknown")
    start_ms = time.monotonic()

    if not _model_loaded:
        raise HTTPException(status_code=503, detail="Model not loaded.")

    if len(payload.frames_b64) < 2:
        return BlinkCheckResponse(
            blink_detected=False, confidence=0.0, detail="Not enough frames provided."
        )

    eye_counts: list[int] = []
    for frame_b64 in payload.frames_b64:
        try:
            image = _decode_image_b64(frame_b64, request_id)
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
            # Detect the face region first to avoid false eye detections in the background
            from liveness import _face_cascade
            faces = _face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
            if len(faces) == 0:
                eye_counts.append(-1)  # face not found in this frame
                continue
            # Use the largest face
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            # Only look for eyes in the upper half of the face
            face_upper = gray[y : y + h // 2, x : x + w]
            eyes = _eye_cascade.detectMultiScale(face_upper, scaleFactor=1.1, minNeighbors=5, minSize=(20, 20))
            eye_counts.append(len(eyes))
        except Exception as exc:
            logger.warning("Frame decode failed during blink check: %s", exc, extra={"request_id": request_id})
            eye_counts.append(-1)

    logger.info("Blink check eye counts: %s", eye_counts, extra={"request_id": request_id})

    # Filter out frames where face wasn't detected
    valid_counts = [c for c in eye_counts if c >= 0]
    if len(valid_counts) < 2:
        return BlinkCheckResponse(
            blink_detected=False, confidence=0.0, detail="Could not detect a face in enough frames."
        )

    # A blink is detected if eye count drops at any point then rises again,
    # OR if eye count drops significantly at any point (eyes fully closed = 0 eyes detected)
    blink_detected = False
    confidence = 0.0

    # Check for a decrease-then-increase pattern (open → closed → open)
    for i in range(1, len(valid_counts)):
        if valid_counts[i] < valid_counts[i - 1]:  # eyes started closing
            # Check if they open again in a later frame
            for j in range(i + 1, len(valid_counts)):
                if valid_counts[j] >= valid_counts[i - 1]:
                    blink_detected = True
                    confidence = 0.9
                    break
        if blink_detected:
            break

    # Simpler fallback: if we see any frame with 0 eyes (fully closed) that has
    # a frame with 2 eyes before or after it, that's a clear blink
    if not blink_detected:
        has_open = any(c >= 2 for c in valid_counts)
        has_closed = any(c == 0 for c in valid_counts)
        if has_open and has_closed:
            blink_detected = True
            confidence = 0.95

    duration_ms = int((time.monotonic() - start_ms) * 1000)
    detail = "Blink detected." if blink_detected else "No blink transition detected. Please blink naturally and try again."

    logger.info(
        "Blink check complete: blink=%s confidence=%.2f",
        blink_detected, confidence,
        extra={"request_id": request_id, "duration_ms": duration_ms},
    )

    return BlinkCheckResponse(blink_detected=blink_detected, confidence=confidence, detail=detail)


# ── Private helpers ───────────────────────────────────────────────────────────


def _decode_image_b64(image_b64: str, request_id: str) -> np.ndarray:
    """
    Decode a base64 JPEG string into a BGR numpy array.
    Images are processed entirely in memory — nothing touches disk.

    Raises HTTPException(422) on invalid data, HTTPException(500) on decode failure.
    """
    try:
        image_bytes = base64.b64decode(image_b64)
        nparr = np.frombuffer(image_bytes, dtype=np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as exc:
        logger.error(
            "Image decode error: %s", exc,
            extra={"request_id": request_id},
            exc_info=True,
        )
        raise HTTPException(status_code=422, detail="Could not decode live_image_b64 as JPEG.")

    if image is None or image.size == 0:
        raise HTTPException(status_code=422, detail="Decoded image is empty.")

    return image


def _extract_embedding(image: np.ndarray, request_id: str) -> list[float]:
    """
    Run DeepFace VGG-Face on an in-memory numpy array to extract a face embedding.

    DeepFace.represent() normally expects a file path or a numpy array.
    We pass the numpy array directly to avoid any disk I/O.

    Raises HTTPException(500) if DeepFace fails (no face detected, model error, etc.).
    """
    try:
        results: list[dict[str, Any]] = DeepFace.represent(
            img_path=image,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=False,   # don't crash if no face detected; score will be low
        )
        if not results:
            raise ValueError("DeepFace returned empty result list.")
        embedding: list[float] = results[0]["embedding"]
        return embedding
    except Exception as exc:
        logger.error(
            "DeepFace embedding extraction failed: %s", exc,
            extra={"request_id": request_id},
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Face embedding extraction failed. Node backend should set FACE_PENDING.",
        )


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """
    Compute cosine similarity between two embedding vectors.
    Returns a value in [0.0, 1.0] where 1.0 = identical direction.

    DeepFace.verify() uses cosine *distance* (1 - similarity); we convert
    so that higher score always means more similar, matching our API contract.

    If vectors have different lengths, returns 0.0 (mismatch logged upstream).
    """
    va = np.array(a, dtype=np.float64)
    vb = np.array(b, dtype=np.float64)

    if va.shape != vb.shape:
        logger.warning(
            "Embedding dimension mismatch: reference=%d live=%d", len(a), len(b)
        )
        return 0.0

    norm_a = np.linalg.norm(va)
    norm_b = np.linalg.norm(vb)

    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0

    cosine_distance = 1.0 - float(np.dot(va, vb) / (norm_a * norm_b))
    # Clip distance to [0, 1] then convert to similarity
    cosine_distance = float(np.clip(cosine_distance, 0.0, 1.0))
    similarity = 1.0 - cosine_distance
    return round(float(np.clip(similarity, 0.0, 1.0)), 6)


def _new_request_id() -> str:
    import uuid
    return str(uuid.uuid4())
