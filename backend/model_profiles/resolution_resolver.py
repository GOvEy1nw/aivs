"""Curated resolution resolver for AiVS model profiles.

Maps simple frontend labels (``1080p``, ``16:9``) to the exact ``WxH``
value WanGP expects. Per the Phase 4 brief: for each
(model + resolution tier + aspect ratio), choose the exact WanGP
resolution closest to the 'true' expected size, preferring lower pixel
count when ambiguous. The frontend never sends a vague value like
``1080p`` to WanGP — only the resolved exact value (e.g. ``1920x1088``).

The table below is the curated source of truth, not a WanGP scrape.
WanGP may offer multiple resolutions for the same apparent tier/aspect
(e.g. 1080p 1:1 has both 1088x1088 and 1440x1440); AiVS picks one.
"""

from __future__ import annotations

from model_profiles.profiles import AspectRatio, ModelProfile, ResolutionTier

# Curated (profile_id, tier, aspect) -> (width, height) table.
# Built from WanGP's DEFAULT_RESOLUTION_CHOICES, filtered to AiVS's
# supported aspect ratios and minimum 540p tier,
# then collapsed to one best value per (tier, aspect) preferring the
# smaller pixel count when multiple candidates exist.
_RESOLUTION_TABLE: dict[tuple[str, ResolutionTier, AspectRatio], tuple[int, int]] = {
    # Z-Image Turbo
    ("z_image_turbo", "540p", "1:1"): (544, 544),
    ("z_image_turbo", "540p", "16:9"): (960, 544),
    ("z_image_turbo", "540p", "9:16"): (544, 960),
    ("z_image_turbo", "720p", "1:1"): (1024, 1024),
    ("z_image_turbo", "720p", "16:9"): (1280, 720),
    ("z_image_turbo", "720p", "9:16"): (720, 1280),
    ("z_image_turbo", "1080p", "1:1"): (1088, 1088),
    ("z_image_turbo", "1080p", "16:9"): (1920, 1088),
    ("z_image_turbo", "1080p", "9:16"): (1088, 1920),
    # Krea 2 Turbo (same resolution table; capped at 1440p per profile)
    ("krea2_turbo", "540p", "1:1"): (544, 544),
    ("krea2_turbo", "540p", "16:9"): (960, 544),
    ("krea2_turbo", "540p", "9:16"): (544, 960),
    ("krea2_turbo", "720p", "1:1"): (1024, 1024),
    ("krea2_turbo", "720p", "16:9"): (1280, 720),
    ("krea2_turbo", "720p", "9:16"): (720, 1280),
    ("krea2_turbo", "1080p", "1:1"): (1088, 1088),
    ("krea2_turbo", "1080p", "16:9"): (1920, 1088),
    ("krea2_turbo", "1080p", "9:16"): (1088, 1920),
    ("krea2_turbo", "1440p", "1:1"): (1456, 1456),
    ("krea2_turbo", "1440p", "16:9"): (2560, 1440),
    ("krea2_turbo", "1440p", "9:16"): (1440, 2560),
    # Flux 2 Klein 4B (no WanGP resolution cap; same curated WxH)
    ("flux2_klein_4b", "540p", "1:1"): (544, 544),
    ("flux2_klein_4b", "540p", "16:9"): (960, 544),
    ("flux2_klein_4b", "540p", "9:16"): (544, 960),
    ("flux2_klein_4b", "720p", "1:1"): (1024, 1024),
    ("flux2_klein_4b", "720p", "16:9"): (1280, 720),
    ("flux2_klein_4b", "720p", "9:16"): (720, 1280),
    ("flux2_klein_4b", "1080p", "1:1"): (1088, 1088),
    ("flux2_klein_4b", "1080p", "16:9"): (1920, 1088),
    ("flux2_klein_4b", "1080p", "9:16"): (1088, 1920),
    ("flux2_klein_4b", "1440p", "1:1"): (1456, 1456),
    ("flux2_klein_4b", "1440p", "16:9"): (2560, 1440),
    ("flux2_klein_4b", "1440p", "9:16"): (1440, 2560),
    # HiDream O1 Dev (no WanGP resolution cap; same curated WxH)
    ("hidream_o1_dev", "540p", "1:1"): (544, 544),
    ("hidream_o1_dev", "540p", "16:9"): (960, 544),
    ("hidream_o1_dev", "540p", "9:16"): (544, 960),
    ("hidream_o1_dev", "720p", "1:1"): (1024, 1024),
    ("hidream_o1_dev", "720p", "16:9"): (1280, 720),
    ("hidream_o1_dev", "720p", "9:16"): (720, 1280),
    ("hidream_o1_dev", "1080p", "1:1"): (1088, 1088),
    ("hidream_o1_dev", "1080p", "16:9"): (1920, 1088),
    ("hidream_o1_dev", "1080p", "9:16"): (1088, 1920),
    ("hidream_o1_dev", "1440p", "1:1"): (1456, 1456),
    ("hidream_o1_dev", "1440p", "16:9"): (2560, 1440),
    ("hidream_o1_dev", "1440p", "9:16"): (1440, 2560),
    # LTX 2.5 Fast video
    ("ltx2_25_fast", "540p", "1:1"): (544, 544),
    ("ltx2_25_fast", "540p", "16:9"): (960, 544),
    ("ltx2_25_fast", "540p", "9:16"): (544, 960),
    ("ltx2_25_fast", "720p", "1:1"): (1024, 1024),
    ("ltx2_25_fast", "720p", "16:9"): (1280, 720),
    ("ltx2_25_fast", "720p", "9:16"): (720, 1280),
    ("ltx2_25_fast", "1080p", "1:1"): (1088, 1088),
    ("ltx2_25_fast", "1080p", "16:9"): (1920, 1088),
    ("ltx2_25_fast", "1080p", "9:16"): (1088, 1920),
}

_SHARED_IMAGE_RESOLUTION_PROFILE_IDS = (
    "flux2_klein_9b",
    "qwen_image_2512_20B",
    "qwen_image_21_7b_pruna",
    "qwen_image_edit_plus2_20B",
    "krea2_turbo_edit",
    "ideogram4_int8",
    "ideogram4_turbotime_int8",
)
for profile_id in _SHARED_IMAGE_RESOLUTION_PROFILE_IDS:
    for (source_id, tier, aspect), dimensions in tuple(_RESOLUTION_TABLE.items()):
        if source_id == "flux2_klein_4b":
            _RESOLUTION_TABLE[(profile_id, tier, aspect)] = dimensions

for (source_id, tier, aspect), dimensions in tuple(_RESOLUTION_TABLE.items()):
    if source_id == "ltx2_25_fast":
        for profile_id in ("ltx2_25_quality", "minimax_h3_fast", "minimax_h3_quality"):
            _RESOLUTION_TABLE[(profile_id, tier, aspect)] = dimensions

# WanGP's built-in list does not contain every requested ratio at every tier.
# These curated 16-aligned sizes use built-in choices where available and
# preserve each tier's established pixel budget elsewhere.
_ADDITIONAL_ASPECT_RESOLUTIONS: dict[
    ResolutionTier, dict[AspectRatio, tuple[int, int]]
] = {
    "540p": {
        "21:9": (1280, 544),
        "9:21": (544, 1280),
        "4:3": (832, 624),
        "3:4": (624, 832),
        "3:2": (864, 576),
        "2:3": (576, 864),
    },
    "720p": {
        "21:9": (1280, 544),
        "9:21": (544, 1280),
        "4:3": (1104, 832),
        "3:4": (832, 1104),
        "3:2": (1248, 832),
        "2:3": (832, 1248),
    },
    "1080p": {
        "21:9": (1920, 832),
        "9:21": (832, 1920),
        "4:3": (1664, 1248),
        "3:4": (1248, 1664),
        "3:2": (1536, 1024),
        "2:3": (1024, 1536),
    },
    "1440p": {
        "21:9": (2688, 1152),
        "9:21": (1152, 2688),
        "4:3": (1920, 1440),
        "3:4": (1440, 1920),
        "3:2": (2160, 1440),
        "2:3": (1440, 2160),
    },
}

_PROFILE_RESOLUTION_TIERS: dict[str, tuple[ResolutionTier, ...]] = {
    "z_image_turbo": ("540p", "720p", "1080p"),
    "ltx2_25_fast": ("540p", "720p", "1080p"),
    "ltx2_25_quality": ("540p", "720p", "1080p"),
    "minimax_h3_fast": ("540p", "720p", "1080p"),
    "minimax_h3_quality": ("540p", "720p", "1080p"),
    **{
        profile_id: ("540p", "720p", "1080p", "1440p")
        for profile_id in (
            "krea2_turbo",
            "flux2_klein_4b",
            "flux2_klein_9b",
            "qwen_image_2512_20B",
            "qwen_image_21_7b_pruna",
            "hidream_o1_dev",
            "krea2_turbo_edit",
            "qwen_image_edit_plus2_20B",
            "ideogram4_int8",
            "ideogram4_turbotime_int8",
        )
    },
}
for profile_id, tiers in _PROFILE_RESOLUTION_TIERS.items():
    for tier in tiers:
        for aspect, dimensions in _ADDITIONAL_ASPECT_RESOLUTIONS[tier].items():
            _RESOLUTION_TABLE[(profile_id, tier, aspect)] = dimensions


def resolve_resolution(
    profile: ModelProfile,
    tier: ResolutionTier,
    aspect: AspectRatio,
) -> tuple[int, int]:
    """Return the exact ``(width, height)`` for a profile/tier/aspect.

    Raises KeyError if the combination is not curated — the caller should
    treat that as an invalid combination that must not be exposed to the
    user (the frontend should hide it, the backend should reject it).
    """
    return _RESOLUTION_TABLE[(profile.id, tier, aspect)]


def is_combination_supported(
    profile: ModelProfile,
    tier: ResolutionTier,
    aspect: AspectRatio,
) -> bool:
    """True if AiVS has a curated exact resolution for this combination."""
    return (profile.id, tier, aspect) in _RESOLUTION_TABLE
