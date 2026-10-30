#!/usr/bin/env python3
"""Process-local Matplotlib CJK setup; no font downloads or global settings."""

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True


def configure_chinese_font(text="中文图表", font_path=None):
    """Select a font covering the planned labels before creating any artists.

    Return FontProperties with an explicit filename for use in text/legend calls.
    Re-run in every plotting process; addfont is not a persistent installation.
    """
    import matplotlib
    from matplotlib import font_manager, ft2font

    labels = text if isinstance(text, str) else "\n".join(text)
    needed = {ord(char) for char in labels if ord(char) >= 128 and not char.isspace()}
    candidates = []
    if font_path is not None:
        candidates.append(Path(font_path).expanduser().resolve())
    else:
        kpsewhich = shutil.which("kpsewhich")
        if kpsewhich:
            for name in ("FandolHei-Regular.otf", "FandolSong-Regular.otf"):
                result = subprocess.run([kpsewhich, name], capture_output=True, text=True, timeout=15, check=False)
                if result.returncode == 0 and result.stdout.strip():
                    candidates.append(Path(result.stdout.strip()))
        for family in ("Noto Sans CJK SC", "Source Han Sans SC", "AR PL UMing CN", "Microsoft YaHei", "PingFang SC"):
            try:
                candidates.append(Path(font_manager.findfont(
                    font_manager.FontProperties(family=[family]), fallback_to_default=False,
                )))
            except ValueError:
                continue
    problems = []
    for path in dict.fromkeys(candidates):
        if not path.is_file():
            problems.append(f"Missing font file: {path}")
            continue
        face = ft2font.FT2Font(str(path))
        missing = sorted(needed - set(face.get_charmap()))
        if missing:
            problems.append(f"{path.name} lacks " + " ".join(f"U+{code:04X}" for code in missing[:12]))
            continue
        font_manager.fontManager.addfont(str(path))
        font = font_manager.FontProperties(fname=str(path))
        matplotlib.rcParams["font.family"] = [font.get_name(), "sans-serif"]
        matplotlib.rcParams["axes.unicode_minus"] = False
        return font
    raise ValueError("No font covers the planned Chinese labels. Install/configure a CJK font before plotting. " + "; ".join(problems))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text", default="中文图表", help="All planned non-Latin labels to check")
    parser.add_argument("--font", type=Path, help="Optional actual font file")
    args = parser.parse_args()
    try:
        font = configure_chinese_font(args.text, args.font)
        print(json.dumps({"ok": True, "font": font.get_file(), "family": font.get_name()}, ensure_ascii=False))
        return 0
    except (ImportError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
