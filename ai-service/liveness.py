import numpy as np
import cv2
import logging
import os
from skimage.feature import local_binary_pattern

logger = logging.getLogger(__name__)

_face_cascade_path = os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml')
_face_cascade = cv2.CascadeClassifier(_face_cascade_path)

# ── Tuning constants ──────────────────────────────────────────────────────────
# Weights must sum to 1.0
_LBP_WEIGHT        = 0.45   # Strongest discriminator for printed vs. live skin
_FREQ_RATIO_WEIGHT = 0.30   # High/low frequency energy ratio
_CHROMA_WEIGHT     = 0.25   # Colour channel variance desaturation check

# LBP: uniform patterns on a circle of 8 points, radius 1.
# Live skin has a high proportion of *non-uniform* LBP codes (organic micro-texture).
# Printed paper/screens have mostly uniform codes (smooth, repeating surface).
_LBP_RADIUS   = 1
_LBP_N_POINTS = 8 * _LBP_RADIUS
# Fraction of non-uniform codes in a live face is typically 0.35–0.55.
# In prints it's typically 0.10–0.22.
_LBP_LIVE_MIN    = 0.20   # below this → very likely print
_LBP_LIVE_TARGET = 0.50   # at or above this → max score
# ─────────────────────────────────────────────────────────────────────────────


def detect_liveness(image: np.ndarray) -> float:
    """
    Compute a passive liveness score for the given BGR image.

    Returns a float in [0.0, 1.0].  High → likely live.  Low → likely spoof.

    Raises ValueError if the image array is empty or malformed.
    """
    if image is None or image.size == 0:
        raise ValueError("Image array is empty; cannot compute liveness score.")
    if image.ndim < 2:
        raise ValueError(f"Expected at least a 2-D array, got shape {image.shape}.")

    try:
        gray = _to_grayscale(image)

        # 1. Blank or solid-color image check
        # If the standard deviation of pixel intensities is very low, the image lacks any texture or content.
        if float(np.std(gray)) < 5.0:
            logger.debug("Liveness rejected: image is completely blank or solid-color.")
            return 0.0

        # 2. Face ROI extraction
        # Keep detector tolerant for webcam/mobile noise and fall back to center crop if needed.
        # Reduced minNeighbors from 5 → 4 for better elderly face detection
        faces = _face_cascade.detectMultiScale(
            gray, scaleFactor=1.1, minNeighbors=4, minSize=(40, 40)
        )
        used_fallback_roi = False
        face_bgr = None
        face_gray = None

        if len(faces) == 0:
            used_fallback_roi = True
            h_img, w_img = gray.shape[:2]
            side = int(min(h_img, w_img) * 0.75)
            sx = max((w_img - side) // 2, 0)
            sy = max((h_img - side) // 2, 0)
            face_gray = gray[sy : sy + side, sx : sx + side]
            face_bgr = image[sy : sy + side, sx : sx + side] if image.ndim == 3 else None
            logger.debug("Liveness: no face from cascade, using center ROI fallback.")

            # Additional check: if even the fallback ROI looks like no person, return 0
            fallback_std = float(np.std(face_gray))
            if fallback_std < 10.0:
                logger.debug("Liveness rejected: fallback ROI also has no content (no person).")
                return 0.0
        else:
            # Crop to the largest detected face for all subsequent analysis.
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            
            # Check if detected face is too small (less than 80x80)
            if w < 80 or h < 80:
                logger.debug("Liveness rejected: detected face is too small.")
                return 0.0
                
            face_gray = gray[y : y + h, x : x + w]
            face_bgr  = image[y : y + h, x : x + w] if image.ndim == 3 else None
            logger.debug(f"Liveness: detected {len(faces)} faces, using largest at ({x}, {y}) size {w}x{h}")

        # Preprocess: apply mild Gaussian blur for glasses/glare tolerance (elderly-friendly)
        processed_gray = cv2.GaussianBlur(face_gray, (3, 3), 0.5)

        lbp_component        = _lbp_score(processed_gray)
        freq_ratio_component = _freq_ratio_score(processed_gray)
        chroma_component     = _chroma_score(face_bgr) if face_bgr is not None else 0.5

        score = (
            _LBP_WEIGHT        * lbp_component
            + _FREQ_RATIO_WEIGHT * freq_ratio_component
            + _CHROMA_WEIGHT     * chroma_component
        )
        if used_fallback_roi:
            # Reduced penalty from 0.9 → 0.95 for elderly users
            score *= 0.95
        score = round(float(np.clip(score, 0.0, 1.0)), 4)

        logger.debug(
            "Liveness detection complete",
            extra={
                "lbp_component":        lbp_component,
                "freq_ratio_component": freq_ratio_component,
                "chroma_component":     chroma_component,
                "used_fallback":        used_fallback_roi,
                "final_score":          score,
            },
        )
        return score

    except Exception as exc:
        logger.error("Liveness detection failed: %s", exc, exc_info=True)
        return 0.0  # Fail safe — never silently pass an unanalysable frame


# ── Private helpers ───────────────────────────────────────────────────────────


def _to_grayscale(image: np.ndarray) -> np.ndarray:
    if image.ndim == 2:
        return image
    if image.shape[2] == 4:
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def _lbp_score(face_gray: np.ndarray) -> float:
    """
    Local Binary Pattern non-uniformity score.

    LBP encodes the micro-texture of each pixel by comparing it to its
    ring of neighbours.  'Uniform' LBP codes (at most two 0→1 or 1→0
    transitions) dominate on smooth / repetitive surfaces like paper and
    screens.  Live skin, with its pores, creases, and subsurface
    scattering, produces a much higher fraction of 'non-uniform' codes.

    We use method='uniform' so scikit-image labels uniform codes 0–_LBP_N_POINTS
    and collects ALL non-uniform codes into a single bin (_LBP_N_POINTS + 1).
    The fraction of pixels landing in that non-uniform bin is our discriminator.
    """
    lbp = local_binary_pattern(face_gray, _LBP_N_POINTS, _LBP_RADIUS, method='uniform')
    n_pixels       = lbp.size
    non_uniform_bin = _LBP_N_POINTS + 1           # scikit-image convention
    non_uniform_frac = float(np.sum(lbp == non_uniform_bin)) / n_pixels

    # Map the fraction onto [0, 1] using our calibrated live range
    score = (non_uniform_frac - _LBP_LIVE_MIN) / (_LBP_LIVE_TARGET - _LBP_LIVE_MIN)
    return float(np.clip(score, 0.0, 1.0))


def _freq_ratio_score(face_gray: np.ndarray) -> float:
    """
    High-to-low frequency energy *ratio* in log-magnitude FFT spectrum.

    The original module used raw high-frequency energy, which is high for
    both live faces AND sharp prints (paper texture).  The ratio is much
    more discriminative: live faces have a larger proportion of energy in
    the high-frequency bins *relative to* the low-frequency bins.  Prints
    on flat surfaces tend to have a steeper roll-off, keeping more energy
    in the low-frequency region (the macro structure of the face dominates,
    while fine skin detail is absent or attenuated).

    Score is normalised empirically: live ratio ≈ 0.9–1.2, print ≈ 0.5–0.75.
    """
    fft_shift = np.fft.fftshift(np.fft.fft2(np.float32(face_gray)))
    magnitude  = np.log(np.abs(fft_shift) + 1.0)

    overall_mean  = float(magnitude.mean())
    high_freq_mask = magnitude > overall_mean
    low_freq_mask  = magnitude <= overall_mean

    if not low_freq_mask.any() or not high_freq_mask.any():
        return 0.0

    high_mean = float(magnitude[high_freq_mask].mean())
    low_mean  = float(magnitude[low_freq_mask].mean())

    if low_mean == 0:
        return 0.0

    ratio = high_mean / low_mean
    # Empirical calibration: ratio 0.5 → score 0.0,  ratio 1.2 → score 1.0
    score = (ratio - 0.5) / (1.2 - 0.5)
    return float(np.clip(score, 0.0, 1.0))


def _chroma_score(face_bgr: np.ndarray) -> float:
    """
    Chrominance variance score (Cb and Cr channels from YCrCb).

    Printed photographs and low-quality screens reproduce colour less
    accurately than a live camera capture, particularly in the Cb/Cr
    chrominance channels.  Skin in live captures has modest but consistent
    chrominance variance driven by sub-surface blood vessels, micro-shadows,
    and specular highlights.  Flat prints or screens tend to have either
    uniformly low chrominance variance (desaturated print) or artificially
    boosted uniformity (OLED screen replay).

    Updated thresholds for elderly-friendly: 30→0.0, 110→1.0 (lower minimum)
    """
    if face_bgr is None or face_bgr.size == 0:
        return 0.5   # neutral — cannot score without colour

    ycrcb = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2YCrCb).astype(np.float32)
    cb_var = float(ycrcb[:, :, 2].var())
    cr_var = float(ycrcb[:, :, 1].var())
    mean_chroma_var = (cb_var + cr_var) / 2.0

    # Updated thresholds for elderly-friendly: 30→0.0, 110→1.0
    score = (mean_chroma_var - 30.0) / (110.0 - 30.0)
    return float(np.clip(score, 0.0, 1.0))
