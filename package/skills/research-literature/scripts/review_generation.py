#!/usr/bin/env python3
"""Retain review assets and reuse the sibling research-report PDF backend.

Pi writes the evidence and LaTeX; this helper does not search or call a model.
"""

import argparse
from datetime import datetime, timezone
from functools import lru_cache
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
SKILL = Path(__file__).resolve().parents[1]
REPORT = SKILL.parent / "research-report"
FORMATS = {".pdf", ".png", ".jpg", ".jpeg"}
KINDS = {"reproduced", "adapted", "synthesis", "plot"}
SHORT_RUNNING_TITLE = "Literature Review"


@lru_cache(maxsize=1)
def backend():
    path = REPORT / "scripts/report_generation.py"
    if not path.is_file():
        raise ValueError(f"Missing shared research-report skill: {path}; install both skills together")
    spec = importlib.util.spec_from_file_location("literature_report_backend", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def root_path(value: Path) -> Path:
    root = value.resolve()
    if root.is_relative_to(SKILL) or root.is_relative_to(REPORT):
        raise ValueError("Write artifacts in the project/assigned directory, not an installed skill")
    return root


def path_in(root: Path, name: str) -> Path:
    return backend().local_path(root, name)


def review_dir(root: Path) -> Path:
    return path_in(root, "literature/review")


def rows(path: Path) -> list[dict]:
    if not path.is_file():
        raise ValueError(f"Missing retained evidence/index: {path}")
    result = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        item = json.loads(line)
        if not isinstance(item, dict):
            raise ValueError(f"{path}:{number}: expected a JSON object")
        result.append(item)
    return result


def indexed(items: list[dict], label: str) -> dict:
    result = {}
    for item in items:
        ident = backend().required_text(item.get("id"), f"{label}.id")
        if ident in result:
            raise ValueError(f"Duplicate {label} id: {ident}")
        result[ident] = item
    return result


def papers(root: Path) -> dict:
    result = indexed(rows(path_in(root, "literature/papers.jsonl")), "paper")
    for item in result.values():
        backend().required_text(item.get("title"), "paper.title")
        if not item.get("url") and not item.get("doi"):
            raise ValueError("Each paper needs url or doi")
    return result


def validate_asset(record: dict, sources: dict, root: Path):
    ident = backend().required_text(record.get("id"), "asset.id")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", ident):
        raise ValueError("asset.id must contain only ASCII letters, digits, _ or -")
    if record.get("kind") not in KINDS:
        raise ValueError("asset.kind must be reproduced, adapted, synthesis or plot")
    backend().required_text(record.get("caption"), "asset.caption")
    backend().required_text(record.get("credit"), "asset.credit")
    provenance = record.get("sources")
    if not isinstance(provenance, list) or not provenance:
        raise ValueError("An asset needs source paper ids and original locators")
    for source in provenance:
        if not isinstance(source, dict) or source.get("paper_id") not in sources:
            raise ValueError(f"Unknown asset source: {source}")
        backend().required_text(source.get("locator"), "asset.source.locator")
    if record["kind"] in {"reproduced", "adapted"}:
        backend().required_text(record.get("source_url"), "asset.source_url")
        backend().required_text(record.get("reuse_basis"), "asset.reuse_basis")
    else:
        backend().required_text(record.get("derivation"), "asset.derivation")
    if record["kind"] == "plot":
        for field in ("data", "script"):
            value = backend().required_text(record.get(field), f"asset.{field}")
            if not value.startswith("literature/") or not path_in(root, value).is_file():
                raise ValueError(f"A numerical plot needs retained literature/ {field}: {value}")


def retain_asset(root: Path, source: Path, metadata: Path) -> dict:
    record = backend().read_json(metadata)
    validate_asset(record, papers(root), root)
    suffix = source.suffix.lower()
    if suffix not in FORMATS:
        raise ValueError("Retain PDF/PNG/JPG/JPEG; convert SVG or a relevant PDF region first")
    content = source.read_bytes()
    if not content:
        raise ValueError("Cannot retain an empty image")
    index_path = path_in(root, "literature/assets.jsonl")
    existing = rows(index_path) if index_path.is_file() else []
    assets = indexed(existing, "asset")
    target = f"literature/assets/{record['id']}{suffix}"
    record.update(path=target, sha256=hashlib.sha256(content).hexdigest())
    if record["id"] in assets:
        previous = assets[record["id"]]
        comparison = {key: value for key, value in previous.items() if key != "retained_at"}
        if comparison != record or not path_in(root, target).is_file() or path_in(root, target).read_bytes() != content:
            raise ValueError("Asset id already exists with different content/metadata; use a new id")
        return {"ok": True, "asset": previous}
    record["retained_at"] = datetime.now(timezone.utc).isoformat()
    # Check the asset and complete rewritten index before writing either.
    lines = "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in [*existing, record])
    target_path = path_in(root, target)
    if target_path.exists() and target_path.read_bytes() != content:
        raise ValueError(f"Refusing to overwrite an existing asset: {target}")
    backend().write_files(root, {target: content})
    backend().atomic_write(index_path, lines.encode("utf-8"))
    return {"ok": True, "asset": record}


def init_review(root: Path, language: str) -> dict:
    folder = review_dir(root)
    backend().get_preset().packages(language)
    titles = ["研究范围与问题", "方法谱系与代表性工作", "证据与评估比较", "分歧、局限与研究缺口", "结论"]
    if language == "en":
        titles = ["Scope and Questions", "Methods and Representative Work", "Evidence and Evaluation", "Disagreements, Limitations and Gaps", "Conclusion"]
    sections = [{"id": i, "title": title, "file": f"sections/{i:02d}-section.tex"}
                for i, title in enumerate(titles, 1)]
    manifest = {"journal": "ICML2026", "language": language, "style": "preprint",
                "title": "", "running_title": SHORT_RUNNING_TITLE, "abstract": "", "keywords": [],
                "authors": [], "sections": sections, "bibliography": "references.bib", "figures": []}
    files = {"report.json": backend().json_bytes(manifest), "references.bib": b""}
    files.update({section["file"]: b"" for section in sections})
    backend().write_files(folder, files)
    return {"ok": True, "manifest": str(folder / "report.json"), "ready_to_render": False}


def validate_candidates(root: Path, source_index: dict, assets: dict, selected: set) -> dict:
    candidates = indexed(rows(path_in(root, "literature/figure-candidates.jsonl")), "figure candidate")
    if not candidates:
        raise ValueError("Record original figure inspection and selection before completing the illustrated review")
    inspected = 0
    for ident, item in candidates.items():
        if item.get("paper_id") not in source_index:
            raise ValueError(f"Unknown figure candidate paper: {item.get('paper_id')}")
        for field in ("source_url", "locator", "reason", "inspection"):
            backend().required_text(item.get(field), f"figure candidate.{field}")
        decision = item.get("decision")
        if decision not in {"include", "adapt", "omit", "unavailable", "no_figure"}:
            raise ValueError("Figure candidate decision must be include, adapt, omit, unavailable or no_figure")
        expected_viewed = decision in {"include", "adapt", "omit"}
        if type(item.get("viewed")) is not bool or item["viewed"] != expected_viewed:
            raise ValueError("Only actually inspected original figures may be marked include/adapt/omit")
        inspected += int(item["viewed"])
        if decision in {"include", "adapt"}:
            asset_id = item.get("asset_id")
            expected_kind = "reproduced" if decision == "include" else "adapted"
            if asset_id not in selected or asset_id not in assets:
                raise ValueError(f"Selected original figure {ident} has no included retained asset")
            if assets[asset_id].get("candidate_id") != ident or assets[asset_id].get("kind") != expected_kind:
                raise ValueError(f"Original figure {ident} does not match its retained asset")
            if item["paper_id"] not in {source["paper_id"] for source in assets[asset_id].get("sources", [])}:
                raise ValueError(f"Original figure {ident} and asset sources disagree")
    for asset_id in selected:
        asset = assets[asset_id]
        if asset.get("kind") in {"reproduced", "adapted"}:
            candidate_id = asset.get("candidate_id")
            expected_decision = "include" if asset["kind"] == "reproduced" else "adapt"
            if (candidate_id not in candidates or candidates[candidate_id].get("asset_id") != asset_id
                    or candidates[candidate_id].get("decision") != expected_decision):
                raise ValueError(f"Original asset {asset_id} needs a matching inspected candidate")
    warnings = [] if inspected else ["No original figure was inspected; disclose the recorded access/no-figure limits. Original synthesis figures do not establish full-text coverage."]
    return {"figure_candidates": len(candidates), "inspected_original_figures": inspected, "warnings": warnings}


def validate_review(root: Path, rendered: bool = False) -> dict:
    """Validate retained provenance and image bytes, without claiming scientific verification."""
    source_index = papers(root)
    evidence = indexed(rows(path_in(root, "literature/evidence.jsonl")), "evidence")
    if not evidence:
        raise ValueError("Retain the evidence needed for the review before writing it")
    for item in evidence.values():
        if item.get("paper_id") not in source_index:
            raise ValueError(f"Unknown evidence paper: {item.get('paper_id')}")
        for field in ("locator", "content"):
            backend().required_text(item.get(field), f"evidence.{field}")
        if item.get("kind") not in {"quote", "paraphrase", "data"}:
            raise ValueError("evidence.kind must be quote, paraphrase or data")
        if item.get("readLevel") not in {"abstract", "fulltext"}:
            raise ValueError("Review evidence must identify actually read abstract/fulltext material")
    manifest = backend().read_json(review_dir(root) / "report.json")
    figures = manifest.get("figures", [])
    if not isinstance(figures, list) or not figures:
        raise ValueError("An illustrated review needs a retained, evidence-grounded figure (an original synthesis diagram is allowed)")
    assets = indexed(rows(path_in(root, "literature/assets.jsonl")), "asset")
    body = "\n".join(
        path_in(review_dir(root), section["file"]).read_text(encoding="utf-8")
        for section in manifest.get("sections", [])
    )
    used = set(re.findall(r"\\includegraphics\*?(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}", backend().strip_comments(body)))
    if not used.intersection(figure.get("path") for figure in figures if isinstance(figure, dict)):
        raise ValueError("Retained figures must actually be included in a review section")
    for figure in figures:
        if not isinstance(figure, dict) or figure.get("asset_id") not in assets:
            raise ValueError("Every review figure must reference a retained asset_id")
        asset = assets[figure["asset_id"]]
        validate_asset(asset, source_index, root)
        name = backend().required_text(asset.get("path"), "asset.path")
        if not name.startswith("literature/assets/"):
            raise ValueError("Retained assets must be inside literature/assets/")
        original = path_in(root, name)
        if hashlib.sha256(original.read_bytes()).hexdigest() != asset.get("sha256"):
            raise ValueError(f"Retained asset has changed: {name}")
        value = figure.get("path") if rendered else figure.get("source", figure.get("path"))
        selected = Path(backend().required_text(value, "figure source/path"))
        selected = selected if selected.is_absolute() else review_dir(root) / selected
        selected = path_in(root, selected.resolve().relative_to(root).as_posix())
        if selected.read_bytes() != original.read_bytes():
            raise ValueError(f"Figure does not match the retained asset: {figure.get('path')}")
    selection = validate_candidates(root, source_index, assets,
                                    {figure["asset_id"] for figure in figures if figure["path"] in used})
    return {"ok": True, "papers": len(source_index), "evidence": len(evidence), "figures": len(figures), **selection}


def render_review(root: Path, force: bool = False) -> dict:
    validation = validate_review(root)
    folder = review_dir(root)
    manifest_path = folder / "report.json"
    manifest = backend().read_json(manifest_path)
    # Separate the full title from a known short, ASCII running head before TeX.
    # This changes derived layout metadata only, never the scientific title/body.
    if manifest.get("running_title") != SHORT_RUNNING_TITLE:
        manifest["running_title"] = SHORT_RUNNING_TITLE
        backend().atomic_write(manifest_path, backend().json_bytes(manifest))
    result = backend().render_report(folder / "report.json", folder, force)
    result["warnings"] = list(dict.fromkeys([*validation["warnings"], *result["warnings"]]))
    result["running_title"] = SHORT_RUNNING_TITLE
    result["pdf"] = None
    result.pop("report_pdf", None)
    result["review_pdf"] = None
    result["note"] = "Review source assembled; compile to publish literature-review.pdf."
    return result


def check_review(root: Path) -> dict:
    result = validate_review(root, rendered=True)
    structural = backend().check_paper(review_dir(root))
    return {**result, **structural, "warnings": list(dict.fromkeys([*result["warnings"], *structural["warnings"]]))}


def compile_review(root: Path, engine: str, timeout: int) -> dict:
    folder = review_dir(root)
    target = path_in(root, "literature-review.pdf")
    status = {"ok": False, "pdf": None, "review_pdf": None, "errors": [], "warnings": []}
    try:
        if (root / "literature-review.pdf").is_symlink():
            raise ValueError("literature-review.pdf must be a regular output file")
        check = check_review(root)
        if not check["ok"]:
            raise ValueError("Preflight failed: " + "; ".join(check["errors"]))
        status = backend().compile_report(folder, engine, timeout)
        status["warnings"] = list(dict.fromkeys([*check["warnings"], *status["warnings"]]))
        status.pop("report_pdf", None)
        status.update(pdf=None, review_pdf=None)
        if status["ok"]:
            # Shared report output is an internal artifact, never a second final PDF.
            intermediate = folder / "report.pdf"
            backend().atomic_write(target, intermediate.read_bytes())
            intermediate.unlink()
            status.update(pdf=str(target), review_pdf=str(target))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        status.update(ok=False, pdf=None, review_pdf=None)
        status["errors"].append(str(exc))
        if folder.is_dir():
            log = path_in(folder, "build.log")
            previous = log.read_text(encoding="utf-8") if log.is_file() else ""
            backend().atomic_write(log, (previous + "\nREVIEW ERROR: " + str(exc) + "\n").encode())
    if folder.is_dir():
        backend().atomic_write(path_in(folder, "build-status.json"), backend().json_bytes(status))
    return status


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "retain", "render", "check", "compile"):
        command = commands.add_parser(name)
        command.add_argument("--root", type=Path, default=Path.cwd(), help="Artifact root: project or assigned output directory")
        if name == "init":
            command.add_argument("--language", choices=("zh", "en"), default="zh")
        elif name == "retain":
            command.add_argument("--file", type=Path, required=True)
            command.add_argument("--metadata", type=Path, required=True)
        elif name == "render":
            command.add_argument("--force", action="store_true")
        elif name == "compile":
            command.add_argument("--engine", choices=("xelatex", "lualatex"), default="xelatex")
            command.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    try:
        root = root_path(args.root)
        if args.command == "init":
            result = init_review(root, args.language)
        elif args.command == "retain":
            result = retain_asset(root, args.file, args.metadata)
        elif args.command == "render":
            result = render_review(root, args.force)
        elif args.command == "check":
            result = check_review(root)
        else:
            result = compile_review(root, args.engine, args.timeout)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["ok"] else 1
    except (OSError, ValueError, KeyError, TypeError, ImportError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
