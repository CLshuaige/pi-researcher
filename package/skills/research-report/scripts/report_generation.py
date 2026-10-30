#!/usr/bin/env python3
"""Assemble and compile Pi-authored reports using only the Python 3.10+ stdlib."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

SKILL_ROOT = Path(__file__).resolve().parents[1]
# Installed skills are resources, not output directories. Avoid writing import
# caches there when called from a bounded Pi task or a read-only installation.
sys.dont_write_bytecode = True
sys.path.insert(0, str(SKILL_ROOT))

from latex.presets import Journal, get_preset
from latex.validation import (
    CITATIONS, FORBIDDEN_BODY, check_paper, local_path, strip_comments, validate_sources,
)
from prompts.paper_writing import STAGES, build_prompt


def read_json(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return data


def json_bytes(data: dict) -> bytes:
    return (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def atomic_write(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        staging = Path(stream.name)
        try:
            stream.write(data)
            stream.close()
            staging.replace(path)
        finally:
            staging.unlink(missing_ok=True)


def output_root(path: Path) -> Path:
    root = path.resolve()
    if root == SKILL_ROOT or root.is_relative_to(SKILL_ROOT):
        raise ValueError("Generated reports must be outside the installed skill directory")
    return root


def write_files(root: Path, files: dict[str, bytes], force: bool = False):
    # Preflight every collision and symlink before writing any artifact.
    paths = {name: local_path(root, name) for name in files}
    for name, path in paths.items():
        if path.exists() and (not path.is_file() or (path.read_bytes() != files[name] and not force)):
            raise ValueError(f"Refusing to overwrite {path}; inspect it, then use --force for an intentional update")
    for name, path in paths.items():
        if not path.exists() or path.read_bytes() != files[name]:
            atomic_write(path, files[name])


def escape_text(value: str) -> str:
    substitutions = {
        "\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$",
        "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}",
        "~": r"\textasciitilde{}", "^": r"\textasciicircum{}",
    }
    return "".join(substitutions.get(char, char) for char in value)


def required_text(value, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a nonempty string")
    return value.strip()


def init_report(output: Path, language: str = "zh") -> dict:
    root = output_root(output)
    titles = ["引言", "相关工作", "方法", "实验与结果", "讨论与局限", "结论"]
    if language == "en":
        titles = ["Introduction", "Related Work", "Methods", "Experiments and Results", "Discussion and Limitations", "Conclusion"]
    sections = [
        {"id": index, "title": title, "file": f"sections/{index:02d}-section.tex"}
        for index, title in enumerate(titles, 1)
    ]
    manifest = {
        "journal": Journal.ICML2026.value, "language": language, "style": "preprint",
        "title": "", "running_title": "Research Report", "abstract": "", "keywords": [],
        "authors": [], "sections": sections, "bibliography": "references.bib", "figures": [],
    }
    files = {"report.json": json_bytes(manifest), "references.bib": b""}
    files.update({section["file"]: b"" for section in sections})
    # No --force on initialization: retain an existing writing workspace.
    write_files(root, files)
    return {"ok": True, "manifest": str(root / "report.json"), "ready_to_render": False}


def author_block(authors: list, language: str, style: str) -> str:
    if not isinstance(authors, list):
        raise ValueError("authors must be a list")
    if style == "anonymous":
        # Do not put supplied identities into main.tex or PDF metadata.
        return (
            "\\begin{icmlauthorlist}\n\\icmlauthor{Anonymous Authors}{anon}\n"
            "\\end{icmlauthorlist}\n\\icmlaffiliation{anon}{Anonymous Institution}\n"
            "\\icmlcorrespondingauthor{Anonymous Author}{Anonymous}\n"
        )
    if not authors:
        authors = [{
            "name": "作者信息未提供" if language == "zh" else "Author information not supplied",
            "affiliation": "机构信息未提供" if language == "zh" else "Affiliation not supplied",
        }]
    lines, affiliations, contacts = ["\\begin{icmlauthorlist}"], {}, []
    for author in authors:
        if not isinstance(author, dict):
            raise ValueError("Each author must be an object")
        name = escape_text(required_text(author.get("name"), "author.name"))
        affiliation = author.get("affiliation") or ("机构信息未提供" if language == "zh" else "Affiliation not supplied")
        affiliation = required_text(affiliation, "author.affiliation")
        label = affiliations.setdefault(affiliation, f"aff{len(affiliations) + 1}")
        lines.append(f"\\icmlauthor{{{name}}}{{{label}}}")
        if author.get("email"):
            email = escape_text(required_text(author["email"], "author.email"))
            contacts.append(f"\\icmlcorrespondingauthor{{{name}}}{{{email}}}")
    lines.append("\\end{icmlauthorlist}")
    lines.extend(f"\\icmlaffiliation{{{label}}}{{{escape_text(text)}}}" for text, label in affiliations.items())
    lines.extend(contacts)
    if not contacts:
        # The vendor macro otherwise inserts AUTHORERR. Explicitly mark missing
        # contact information without inventing a person or an email address.
        missing = "通讯信息未提供（草稿）" if language == "zh" else "Contact information not supplied (draft)"
        # csname works inside the already-tokenized twocolumn title argument.
        lines.append(f"\\expandafter\\gdef\\csname icmlcorrespondingauthor@text\\endcsname{{{missing}}}")
    return "\n".join(lines) + "\n"


def generate_main_tex(manifest: dict, sections: list[dict], has_bibliography: bool,
                      journal: Journal = Journal.ICML2026) -> str:
    preset = get_preset(journal)
    language = manifest.get("language", "zh")
    style = manifest.get("style", "preprint")
    title = escape_text(required_text(manifest.get("title"), "title"))
    abstract = required_text(manifest.get("abstract"), "abstract")
    if FORBIDDEN_BODY.search(strip_comments(abstract)):
        raise ValueError("abstract must be a LaTeX fragment without wrappers")
    if CITATIONS.search(strip_comments(abstract)):
        raise ValueError("Do not put citations in the abstract")
    keywords = manifest.get("keywords", [])
    if not isinstance(keywords, list) or any(not isinstance(k, str) for k in keywords):
        raise ValueError("keywords must be a list of plain strings")
    running = escape_text(required_text(manifest.get("running_title", "Research Report"), "running_title"))
    section_tex = "\n\n".join(
        f"\\section{{{escape_text(section['title'])}}}\n\\input{{{section['file']}}}"
        for section in sections
    )
    bibliography = (
        f"\\bibliographystyle{{{preset.bibliographystyle}}}\n\\bibliography{{references}}\n"
        if has_bibliography else "% No cited references in this report.\n"
    )
    return (
        "% Generated by research-report. Compile with XeLaTeX (or LuaLaTeX), not pdfLaTeX.\n"
        f"\\documentclass{{{preset.article}}}\n"
        + preset.packages(language, style)
        + f"\\icmltitlerunning{{{running}}}\n"
        + "\\begin{document}\n\\twocolumn[\n"
        + f"\\icmltitle{{{title}}}\n"
        + author_block(manifest.get("authors", []), language, style)
        + f"\\icmlkeywords{{{escape_text(', '.join(keywords))}}}\n"
        + "]\n\\printAffiliationsAndNotice{}\n"
        + f"\\begin{{abstract}}\n{abstract}\n\\end{{abstract}}\n\n"
        + section_tex + "\n\n" + bibliography + "\\end{document}\n"
    )


def render_report(manifest_path: Path, output: Path, force: bool = False) -> dict:
    manifest_path = manifest_path.resolve()
    manifest = read_json(manifest_path)
    root = output_root(output)
    base = manifest_path.parent
    journal = Journal(manifest.get("journal", Journal.ICML2026.value))
    preset = get_preset(journal)
    # Validate locale and template mode even if there are no usable sections.
    preset.packages(manifest.get("language", "zh"), manifest.get("style", "preprint"))
    sections = manifest.get("sections")
    if not isinstance(sections, list) or not sections:
        raise ValueError("sections must be a nonempty list")
    sources, ids = {}, set()
    for section in sections:
        if not isinstance(section, dict):
            raise ValueError("Each section must be an object")
        ident = section.get("id")
        if type(ident) is not int or ident < 1 or ident in ids:
            raise ValueError("Section ids must be unique positive integers")
        ids.add(ident)
        required_text(section.get("title"), "section.title")
        filename = required_text(section.get("file"), "section.file")
        if not filename.startswith("sections/") or not filename.endswith(".tex") or filename in sources:
            raise ValueError("Section files must be unique sections/*.tex paths")
        sources[filename] = required_text(local_path(base, filename).read_text(encoding="utf-8"), filename)
    bib_file = manifest.get("bibliography", "references.bib")
    bibliography = local_path(base, bib_file).read_text(encoding="utf-8") if bib_file else ""
    figures = manifest.get("figures", [])
    if not isinstance(figures, list):
        raise ValueError("figures must be a list")
    figure_paths, files = set(), {}
    for figure in figures:
        if not isinstance(figure, dict):
            raise ValueError("Each figure must be an object")
        target = required_text(figure.get("path"), "figure.path")
        local_path(root, target)
        if not target.startswith("figures/") or Path(target).suffix.lower() not in {".pdf", ".png", ".jpg", ".jpeg"}:
            raise ValueError("Figure paths must be figures/*.pdf, *.png or *.jpg (convert SVG first)")
        if target in figure_paths:
            raise ValueError(f"Duplicate figure path: {target}")
        figure_paths.add(target)
        required_text(figure.get("caption"), "figure.caption")
        required_text(figure.get("evidence"), "figure.evidence")
        source = Path(required_text(figure.get("source", target), "figure.source"))
        source = source if source.is_absolute() else base / source
        if source.suffix.lower() != Path(target).suffix.lower():
            raise ValueError("Figure source and destination must have the same file extension")
        files[target] = source.read_bytes()
    main = generate_main_tex(
        manifest, sections, any(CITATIONS.search(strip_comments(text)) for text in sources.values()), journal,
    )
    sources = {"main.tex": main, **sources}
    validation = validate_sources(root, sources, bibliography, figure_paths)
    if not validation["ok"]:
        raise ValueError("Report validation failed:\n" + "\n".join(validation["errors"]))
    files.update({name: (text.rstrip() + "\n").encode("utf-8") for name, text in sources.items()})
    files["references.bib"] = bibliography.encode("utf-8")
    for filename in preset.files:
        files[filename] = (preset.template_dir / filename).read_bytes()
    # The exported manifest can be rendered again after moving report/ elsewhere.
    portable = {**manifest, "journal": journal.value, "language": manifest.get("language", "zh"),
                "style": manifest.get("style", "preprint"), "bibliography": "references.bib",
                "figures": [{**figure, "source": figure["path"]} for figure in figures]}
    files["report.json"] = json_bytes(portable)
    write_files(root, files, force)
    return {"ok": True, "main_tex": str(root / "main.tex"), "warnings": validation["warnings"],
            "pdf": None, "report_pdf": None,
            "note": "Source assembled; run check and compile before delivering report.pdf."}


def source_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if any(part.startswith(".report-build-") for part in path.relative_to(root).parts):
            continue
        if path.is_file() and path.suffix.lower() in {".tex", ".bib", ".bst", ".sty", ".png", ".jpg", ".jpeg", ".pdf"} and path.relative_to(root).as_posix() not in {"main.pdf", "report.pdf"}:
            digest.update(path.relative_to(root).as_posix().encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


def compile_report(output: Path, engine: str = "xelatex", timeout: int = 120) -> dict:
    root = output_root(output)
    if timeout < 1:
        raise ValueError("timeout must be positive")
    if not root.is_dir():
        raise ValueError(f"Paper directory does not exist: {root}")
    # Check every generated destination before running a tool or writing a log.
    destinations = {name: local_path(root, name) for name in (
        "build.log", "build-status.json", "report.log", "report.blg", "report.bbl", "report.pdf",
    )}
    status = {"ok": False, "engine": engine, "source_sha256": source_digest(root),
              "timestamp": datetime.now(timezone.utc).isoformat(), "pdf": None, "report_pdf": None,
              "errors": [], "warnings": []}
    transcript = []

    def run(command: list[str], cwd: Path, env: dict):
        transcript.append("$ " + " ".join(command) + "\n")
        try:
            result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True,
                                    encoding="utf-8", errors="replace", timeout=timeout, check=False)
        except subprocess.TimeoutExpired as exc:
            partial = exc.stdout or b""
            transcript.append(partial.decode("utf-8", errors="replace") if isinstance(partial, bytes) else partial)
            raise ValueError(f"Compilation timed out after {timeout}s per command") from exc
        transcript.append(result.stdout + "\n" + result.stderr)
        if result.returncode:
            raise ValueError(f"{Path(command[0]).name} exited with status {result.returncode}; see build.log")

    try:
        if (root / "report.pdf").is_symlink():
            raise ValueError("report.pdf must be a regular output file, not a symlink")
        local_path(root, "main.pdf")
        if (root / "main.pdf").exists() and not (root / "main.pdf").is_file():
            raise ValueError("Legacy main.pdf is not a file")
        validation = check_paper(root)
        status["warnings"].extend(validation["warnings"])
        if not validation["ok"]:
            raise ValueError("Preflight failed: " + "; ".join(validation["errors"]))
        executable = shutil.which(engine)
        if not executable:
            raise ValueError(f"Missing {engine}; install a TeX distribution with ctex, Fandol fonts and the ICML package dependencies, or explicitly choose --engine lualatex")
        with tempfile.TemporaryDirectory(prefix=".report-build-", dir=root) as staging:
            build = Path(staging)
            env = os.environ.copy()
            # BibTeX runs in the build directory; inputs remain in report/.
            for variable in ("BIBINPUTS", "BSTINPUTS"):
                env[variable] = str(root) + os.pathsep + env.get(variable, "")
            # Keep TeX font/config caches inside the assigned output directory.
            env["TEXMFVAR"] = str(build / "texmf-var")
            env["TEXMFCONFIG"] = str(build / "texmf-config")
            command = [executable, "-no-shell-escape", "-halt-on-error", "-interaction=nonstopmode",
                       "-file-line-error", "-jobname=report", f"-output-directory={build}", "main.tex"]
            try:
                run(command, root, env)
                aux = (build / "report.aux").read_text(encoding="utf-8", errors="replace")
                has_bibliography = "\\bibdata{" in aux and "\\citation{" in aux
                if has_bibliography:
                    bibtex = shutil.which("bibtex")
                    if not bibtex:
                        raise ValueError("Missing bibtex; references have not been compiled")
                    run([bibtex, "report"], build, env)
                for _ in range(2 if has_bibliography else 1):
                    run(command, root, env)
                log = (build / "report.log").read_text(encoding="utf-8", errors="replace")
                unresolved = re.findall(
                    r"[^\n]*(?:undefined|multiply defined|Missing character:|AUTHORERR|"
                    r"Title exceeds size|page layout violates)[^\n]*", log, re.I,
                )
                if unresolved:
                    raise ValueError("Unresolved TeX diagnostics: " + "; ".join(unresolved[:12]))
                status["warnings"].extend(re.findall(r"[^\n]*(?:Overfull|Underfull)[^\n]*", log))
                pdf = build / "report.pdf"
                if not pdf.is_file() or pdf.stat().st_size == 0:
                    raise ValueError("Compiler returned without a nonempty report.pdf")
                pdf_bytes = pdf.read_bytes()
                atomic_write(destinations["report.pdf"], pdf_bytes)
                # The job directly generates report.pdf. Only clean main.pdf
                # if it was left by an earlier version.
                (root / "main.pdf").unlink(missing_ok=True)
                status.update(ok=True, pdf=str(root / "report.pdf"),
                              report_pdf=str(root / "report.pdf"),
                              pdf_sha256=hashlib.sha256(pdf_bytes).hexdigest())
            finally:
                for name in ("report.log", "report.blg", "report.bbl"):
                    if (build / name).is_file():
                        atomic_write(destinations[name], (build / name).read_bytes())
    except (OSError, ValueError) as exc:
        status["errors"].append(str(exc))
        transcript.append("\nERROR: " + str(exc) + "\n")
    atomic_write(destinations["build.log"], "\n".join(transcript).encode("utf-8"))
    atomic_write(destinations["build-status.json"], json_bytes(status))
    return status


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="Create an unfinished writing workspace without overwriting files")
    init.add_argument("--output", type=Path, default=Path("report"))
    init.add_argument("--language", choices=("zh", "en"), default="zh")
    render = commands.add_parser("render", help="Validate fragments, assemble main.tex and copy the ICML template")
    render.add_argument("--manifest", type=Path, required=True)
    render.add_argument("--output", type=Path, default=Path("report"))
    render.add_argument("--force", action="store_true", help="Intentionally replace changed output files")
    check = commands.add_parser("check", help="Check actual LaTeX inputs, citations, references and figure paths")
    check.add_argument("--output", type=Path, default=Path("report"))
    compile_cmd = commands.add_parser("compile", help="Run XeLaTeX/BibTeX with logs and explicit success status")
    compile_cmd.add_argument("--output", type=Path, default=Path("report"))
    compile_cmd.add_argument("--engine", choices=("xelatex", "lualatex"), default="xelatex")
    compile_cmd.add_argument("--timeout", type=int, default=120, help="Timeout in seconds per command")
    prompts = commands.add_parser("prompt", help="Render a writing prompt for Pi; does not call a model")
    prompts.add_argument("--stage", choices=tuple(STAGES), required=True)
    prompts.add_argument("--context", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "prompt":
            print(build_prompt(args.stage, read_json(args.context)))
            return 0
        if args.command == "init":
            result = init_report(args.output, args.language)
        elif args.command == "render":
            result = render_report(args.manifest, args.output, args.force)
        elif args.command == "check":
            result = check_paper(output_root(args.output))
        else:
            result = compile_report(args.output, args.engine, args.timeout)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["ok"] else 1
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
