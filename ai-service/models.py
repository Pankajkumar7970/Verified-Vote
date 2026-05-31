from pydantic import BaseModel, Field, field_validator
from typing import List
import base64


class VerifyRequest(BaseModel):
    reference_embedding: List[float] = Field(
        ...,
        description="Face embedding vector extracted from the voter's reference selfie (stored encrypted in DB).",
        min_length=1,
    )
    live_image_b64: str = Field(
        ...,
        description="Base64-encoded JPEG of the voter's live selfie captured during the voting session.",
    )

    @field_validator("live_image_b64")
    @classmethod
    def validate_base64_image(cls, v: str) -> str:
        try:
            decoded = base64.b64decode(v, validate=True)
        except Exception:
            raise ValueError("live_image_b64 must be a valid base64-encoded string.")
        # JPEG magic bytes: FF D8 FF
        if not decoded[:3] == b"\xff\xd8\xff":
            raise ValueError("live_image_b64 must be a base64-encoded JPEG image.")
        return v

    @field_validator("reference_embedding")
    @classmethod
    def validate_embedding_length(cls, v: List[float]) -> List[float]:
        # VGG-Face produces a 4096-dim embedding; allow flexibility but catch obviously wrong inputs
        if len(v) < 128:
            raise ValueError(
                f"reference_embedding has only {len(v)} dimensions; expected at least 128 (VGG-Face produces 4096)."
            )
        return v


class VerifyResponse(BaseModel):
    match: bool = Field(
        ...,
        description="True if face_score >= face_threshold AND liveness_score >= liveness_threshold.",
    )
    face_score: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Cosine similarity between reference embedding and live image embedding. Range 0.0–1.0.",
    )
    liveness_score: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Passive liveness score. Low = likely spoofed (printed photo / screen replay). Range 0.0–1.0.",
    )
    model: str = Field(
        default="VGG-Face",
        description="DeepFace model used for face comparison.",
    )
    duration_ms: int = Field(
        ...,
        ge=0,
        description="Total processing time in milliseconds.",
    )


class EmbedRequest(BaseModel):
    live_image_b64: str = Field(
        ...,
        description="Base64-encoded JPEG of the voter's selfie at request submission time.",
    )

    @field_validator("live_image_b64")
    @classmethod
    def validate_base64_image(cls, v: str) -> str:
        try:
            decoded = base64.b64decode(v, validate=True)
        except Exception:
            raise ValueError("live_image_b64 must be a valid base64-encoded string.")
        if not decoded[:3] == b"\xff\xd8\xff":
            raise ValueError("live_image_b64 must be a base64-encoded JPEG image.")
        return v


class EmbedResponse(BaseModel):
    embedding: List[float] = Field(
        ...,
        min_length=128,
        description="VGG-Face embedding vector to store encrypted in the database.",
    )
    liveness_score: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Passive liveness score for the same frame.",
    )
    model: str = Field(default="VGG-Face")
    duration_ms: int = Field(..., ge=0)


class HealthResponse(BaseModel):
    status: str = Field(default="ok")
    model: str = Field(default="loaded")


class ErrorResponse(BaseModel):
    detail: str


class BlinkCheckRequest(BaseModel):
    frames_b64: List[str] = Field(
        ...,
        description="List of 2+ base64-encoded JPEG frames captured over ~3 seconds during the blink challenge.",
        min_length=2,
    )


class BlinkCheckResponse(BaseModel):
    blink_detected: bool = Field(
        ...,
        description="True if an eye open→closed→open transition was detected across the frames.",
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence score for the blink detection (0.0–1.0).",
    )
    detail: str = Field(default="", description="Human-readable explanation of the result.")
