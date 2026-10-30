"""Local structural checks, not a TeX parser or a scientific evidence validator."""

from collections import Counter
from pathlib import Path, PurePosixPath
import re


CITATIONS = re.compile(
    r"\\(?:citep|citet|citealp|citealt|citeauthor|citeyearpar|citeyear|cite|nocite)"
    r"\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^}]+)\}"
)
GRAPHICS = re.compile(r"\\includegraphics\*?(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}")
INPUTS = re.compile(r"\\(?:input|include)\s*\{([^}]+)\}")
FORBIDDEN_BODY = re.compile(
    r"\\(?:documentclass|usepackage|section\*?|bibliography|bibliographystyle)\b"
    r"|\\(?:begin|end)\s*\{(?:document|abstract|thebibliography)\}"
)


def strip_comments(text: str) -> str:
    lines = []
    for line in text.splitlines():
        for index, char in enumerate(line):
            if char != "%":
                continue
            backslashes = len(line[:index]) - len(line[:index].rstrip("\\"))
            if backslashes % 2 == 0:
                line = line[:index]
                break
        lines.append(line)
    return "\n".join(lines)


def local_path(root: Path, value: str) -> Path:
    """Keep portable artifact paths inside root, including existing symlinks."""
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError(f"Invalid local path: {value!r}")
    parts = PurePosixPath(value)
    if parts.is_absolute() or ".." in parts.parts or not parts.parts:
        raise ValueError(f"Path must stay inside the report output directory: {value}")
    if not re.fullmatch(r"[A-Za-z0-9_./-]+", value):
        raise ValueError(f"Use portable ASCII paths without spaces: {value}")
    root = root.resolve()
    path = (root / value).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError(f"Path leaves the report output directory: {value}")
    return path


def bib_keys(text: str) -> list[str]:
    return [
        key.strip()
        for kind, key in re.findall(r"@([A-Za-z]+)\s*[{(]\s*([^,\s]+)\s*,", text)
        if kind.lower() not in {"comment", "preamble", "string"}
    ]


def validate_sources(root: Path, sources: dict[str, str], bibliography: str,
                     figure_paths: set[str]) -> dict:
    """Check an in-memory document before rendering, or files read from disk."""
    errors, warnings = [], []
    keys = bib_keys(bibliography)
    duplicates = sorted(k for k, count in Counter(keys).items() if count > 1)
    if duplicates:
        errors.append("Duplicate BibTeX keys: " + ", ".join(duplicates))
    defined_keys = set(keys)
    labels, refs = [], set()
    used_figures, used_keys = set(), set()
    for name, raw in sources.items():
        text = strip_comments(raw)
        if name != "main.tex" and FORBIDDEN_BODY.search(text):
            errors.append(f"{name}: section contains a document/section/bibliography wrapper")
        if "```" in text or re.search(r"^\s*#{1,6}\s|!\[[^\]]*\]\(", text, re.M):
            errors.append(f"{name}: Markdown found in LaTeX")
        labels.extend(re.findall(r"\\label\s*\{([^}]+)\}", text))
        for match in re.finditer(r"\\(?:ref|eqref|autoref|pageref|cref|Cref)\*?\s*\{([^}]+)\}", text):
            refs.update(k.strip() for k in match[1].split(","))
        for match in CITATIONS.finditer(text):
            used_keys.update(k.strip() for k in match[1].split(",") if k.strip() != "*")
        for match in GRAPHICS.finditer(text):
            image = match[1]
            used_figures.add(image)
            try:
                local_path(root, image)
            except ValueError as exc:
                errors.append(f"{name}: {exc}")
            if image not in figure_paths:
                errors.append(f"{name}: image not in validated catalog: {image}")
        for match in INPUTS.finditer(text):
            target = match[1]
            if not Path(target).suffix:
                target += ".tex"
            if target not in sources:
                errors.append(f"{name}: missing/unlisted input: {target}")
    missing_keys = sorted(used_keys - defined_keys)
    if missing_keys:
        errors.append("Undefined citations: " + ", ".join(missing_keys))
    for key, count in Counter(labels).items():
        if count > 1:
            errors.append(f"Duplicate label: {key}")
    missing_refs = sorted(refs - set(labels))
    if missing_refs:
        errors.append("Undefined cross-references: " + ", ".join(missing_refs))
    unused = sorted(figure_paths - used_figures)
    if unused:
        warnings.append("Catalog figures not used: " + ", ".join(unused))
    return {"ok": not errors, "errors": errors, "warnings": warnings}


def check_paper(root: Path) -> dict:
    """Validate the actual on-disk input graph, bibliography and graphics."""
    errors, sources, seen = [], {}, set()

    def visit(name: str):
        if name in seen:
            return
        seen.add(name)
        try:
            path = local_path(root, name)
            sources[name] = path.read_text(encoding="utf-8")
        except (ValueError, OSError) as exc:
            errors.append(f"{name}: {exc}")
            return
        for match in INPUTS.finditer(strip_comments(sources[name])):
            target = match[1]
            if not Path(target).suffix:
                target += ".tex"
            visit(target)

    visit("main.tex")
    figures = {
        match[1]
        for text in sources.values()
        for match in GRAPHICS.finditer(strip_comments(text))
    }
    for image in figures:
        try:
            if not local_path(root, image).is_file():
                errors.append(f"Missing figure: {image}")
        except ValueError as exc:
            errors.append(str(exc))
    bibliography = ""
    for match in re.finditer(r"\\bibliography\s*\{([^}]+)\}", strip_comments(sources.get("main.tex", ""))):
        for value in match[1].split(","):
            try:
                filename = value.strip()
                filename += "" if filename.endswith(".bib") else ".bib"
                bibliography += local_path(root, filename).read_text(encoding="utf-8") + "\n"
            except (ValueError, OSError) as exc:
                errors.append(str(exc))
    catalog = figures
    manifest_path = root / "report.json"
    if manifest_path.is_file():
        import json
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            catalog = {f["path"] for f in manifest.get("figures", [])}
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            errors.append(f"Invalid report.json figure catalog: {exc}")
    result = validate_sources(root, sources, bibliography, catalog)
    result["errors"].extend(errors)
    result["ok"] = not result["errors"]
    return result
