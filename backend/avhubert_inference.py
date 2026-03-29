"""
AV-HuBERT lip-reading inference for the Zariya backend.

Setup (required once):
  1. git clone https://github.com/facebookresearch/av_hubert.git
  2. cd av_hubert && git submodule update --init --recursive
  3. cd fairseq && pip install -e .   (use the fairseq submodule inside av_hubert)
  4. pip install -r av_hubert/requirements.txt

Checkpoints:
  - Pretrained (self-supervised): e.g. avhubert_base_lrs3_433h.pt — no text head;
    use a finetuned lip-reading checkpoint for real words.
  - Finetuned seq2seq / CTC: download from the AV-HuBERT model zoo (see their README).

Environment:
  AVHUBERT_ROOT       — path to the cloned av_hubert repo root (contains avhubert/ and fairseq/)
  AVHUBERT_MODEL_PATH — path to the .pt checkpoint
  AVHUBERT_CROP       — mouth crop size for the model (default 88, LRS3-style)
"""

from __future__ import annotations

import os
import sys
import traceback
from pathlib import Path
from typing import Any, List, Optional, Tuple

import numpy as np

_BACKEND: Optional[Tuple[Any, ...]] = None
_LOAD_ERROR: Optional[str] = None

# LRS3-style normalization (common defaults; finetuned checkpoints may differ slightly)
_DEFAULT_MEAN = 0.421
_DEFAULT_STD = 0.165


def _backend_dir() -> Path:
    return Path(__file__).resolve().parent


def default_avhubert_root() -> Path:
    return Path(os.environ.get("AVHUBERT_ROOT", _backend_dir() / "third_party" / "av_hubert"))


def default_model_path() -> Path:
    return Path(
        os.environ.get(
            "AVHUBERT_MODEL_PATH",
            _backend_dir() / "models" / "avhubert" / "avhubert_base_lrs3_433h.pt",
        )
    )


def _register_user_modules(avhubert_root: Path) -> Path:
    """Ensure fairseq can find AV-HuBERT tasks/models."""
    from argparse import Namespace

    from fairseq import utils

    user_dir = avhubert_root / "avhubert"
    if not (user_dir / "hubert.py").is_file():
        raise FileNotFoundError(
            f"Invalid AVHUBERT_ROOT: missing {user_dir / 'hubert.py'}. "
            "Clone https://github.com/facebookresearch/av_hubert and init submodules."
        )
    utils.import_user_module(Namespace(user_dir=str(user_dir)))
    if str(user_dir) not in sys.path:
        sys.path.insert(0, str(user_dir))
    # Registration side effects (model/task registration)
    import hubert_pretraining  # noqa: F401
    import hubert  # noqa: F401
    import hubert_asr  # noqa: F401
    return user_dir


def load_avhubert(
    model_path: Optional[Path] = None,
    avhubert_root: Optional[Path] = None,
) -> Tuple[bool, Optional[str]]:
    """
    Load checkpoint + task + generator. Safe to call multiple times (singleton).
    Returns (ok, error_message).
    """
    global _BACKEND, _LOAD_ERROR

    if _BACKEND is not None:
        return True, None
    if _LOAD_ERROR is not None:
        return False, _LOAD_ERROR

    mp = Path(model_path or default_model_path())
    root = Path(avhubert_root or default_avhubert_root())

    if not mp.is_file():
        _LOAD_ERROR = f"Checkpoint not found: {mp}"
        return False, _LOAD_ERROR

    try:
        import torch
        from fairseq import checkpoint_utils
        from fairseq.dataclass.configs import GenerationConfig

        _register_user_modules(root)

        models, saved_cfg, task = checkpoint_utils.load_model_ensemble_and_task(
            [str(mp)],
            strict=False,
            arg_overrides={},
        )

        use_cuda = torch.cuda.is_available()
        for m in models:
            m.eval()
            if use_cuda:
                m.cuda()
            else:
                m.cpu()

        gen_cfg = GenerationConfig()
        if saved_cfg is not None and hasattr(saved_cfg, "generation") and saved_cfg.generation is not None:
            gen_cfg = saved_cfg.generation

        try:
            generator = task.build_generator(models, gen_cfg)
        except Exception as gen_exc:
            print(
                "[AVHUBERT] build_generator failed (common for *pretrained* SSL checkpoints). "
                "Use a finetuned lip-reading / seq2seq .pt from the AV-HuBERT model zoo for text.\n"
                f"   Reason: {gen_exc}"
            )
            generator = None

        tgt_dict = getattr(task, "target_dictionary", None)
        _BACKEND = (models, task, generator, saved_cfg, use_cuda, tgt_dict, mp, root)
        print(f"[AVHUBERT] Loaded checkpoint: {mp}")
        print(f"[AVHUBERT] AV-HuBERT repo: {root}")
        return True, None
    except Exception as e:
        _LOAD_ERROR = f"{e!s}"
        traceback.print_exc()
        return False, _LOAD_ERROR


def _prepare_video(
    frames: np.ndarray,
    crop: int,
    mean: float,
    std: float,
) -> "torch.Tensor":
    """frames: (T, H, W) uint8/float — returns (1, 1, T, H', W') float32."""
    import torch
    import torch.nn.functional as F

    if frames.ndim != 3:
        raise ValueError(f"Expected (T,H,W) mouth stack, got {frames.shape}")

    x = torch.from_numpy(frames.astype(np.float32))
    if x.max() > 1.5:
        x = x / 255.0
    x = x.unsqueeze(1)  # T, 1, H, W
    x = x.unsqueeze(0)  # 1, T, 1, H, W
    x = x.permute(0, 2, 1, 3, 4).contiguous()  # 1, 1, T, H, W

    _, _, t, h, w = x.shape
    if h != crop or w != crop:
        x = x.reshape(1 * 1 * t, 1, h, w)
        x = F.interpolate(x, size=(crop, crop), mode="bilinear", align_corners=False)
        x = x.view(1, 1, t, crop, crop)

    x = (x - mean) / std
    return x


def _decode_hypo(tokens: "torch.Tensor", task, generator) -> str:
    """Turn token ids into a word string (LRS3 BPE/char style)."""
    dictionary = task.target_dictionary
    if dictionary is None:
        return ""

    ignore = set()
    if hasattr(generator, "symbols_to_strip_from_output"):
        ignore = set(generator.symbols_to_strip_from_output)
    ignore.add(dictionary.pad())
    if hasattr(dictionary, "eos") and dictionary.eos() is not None:
        ignore.add(dictionary.eos())

    chars = dictionary.string(tokens.int().cpu(), extra_symbols_to_ignore=ignore)
    text = " ".join("".join(chars.split()).replace("|", " ").split())
    return text.strip()


def predict_lip_reading_text(
    frames: List[np.ndarray],
    model_path: Optional[Path] = None,
    avhubert_root: Optional[Path] = None,
) -> Optional[str]:
    """
    Run AV-HuBERT on a deque/list of mouth ROI frames (each HxW grayscale).

    Returns decoded text, or None on failure / empty hypothesis.
    """
    if not frames or len(frames) < 8:
        return None

    ok, err = load_avhubert(model_path=model_path, avhubert_root=avhubert_root)
    if not ok or _BACKEND is None:
        print(f"[AVHUBERT] Not loaded: {err}")
        return None

    import torch

    models, task, generator, _saved_cfg, use_cuda, _tgt_dict, _mp, _root = _BACKEND

    if generator is None:
        print("[AVHUBERT] No sequence generator — use a finetuned lip-reading checkpoint for text.")
        return None

    try:
        stack = np.stack(frames, axis=0)
        crop = int(os.environ.get("AVHUBERT_CROP", "88"))
        mean = float(os.environ.get("AVHUBERT_IMAGE_MEAN", str(_DEFAULT_MEAN)))
        std = float(os.environ.get("AVHUBERT_IMAGE_STD", str(_DEFAULT_STD)))
        video = _prepare_video(stack, crop=crop, mean=mean, std=std)
        if use_cuda:
            video = video.cuda()

        source = {"audio": None, "video": video}
        net_input = {"source": source, "padding_mask": None}
        sample = {"net_input": net_input, "id": torch.LongTensor([0]).to(video.device)}

        # Encoder-decoder seq2seq (finetuned lip-reading checkpoints)
        with torch.no_grad():
            if hasattr(task, "inference_step"):
                hypos = task.inference_step(generator, models, sample)
            else:
                print("[AVHUBERT] Task has no inference_step; cannot decode.")
                return None

        if not hypos or len(hypos) == 0 or len(hypos[0]) == 0:
            return None

        best = hypos[0][0]
        toks = best["tokens"]
        text = _decode_hypo(toks, task, generator)
        if text:
            print(f"[AVHUBERT] Hypothesis: {text!r}")
        return text or None
    except Exception as e:
        print(f"[AVHUBERT] Inference failed: {e}")
        traceback.print_exc()
        return None


def get_status() -> dict:
    """Health / debug info for /health (does not trigger model load)."""
    root = default_avhubert_root()
    mp = default_model_path()
    out = {
        "avhubert_root": str(root),
        "avhubert_root_exists": root.is_dir(),
        "model_path": str(mp),
        "model_exists": mp.is_file(),
        "loaded": _BACKEND is not None,
        "last_load_error": _LOAD_ERROR,
    }
    if _BACKEND is not None:
        _, _, gen, *_rest = _BACKEND
        out["has_generator"] = gen is not None
    return out
