"""Integration checks for assembly, portability and compiler failure reporting.

Compiler fault injection below tests orchestration, not real PDF typography.
"""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SKILL = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("report_generation", SKILL / "scripts/report_generation.py")
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "draft"
        self.paper = self.root / "paper"
        report.init_report(self.source)
        self.manifest = report.read_json(self.source / "report.json")
        self.manifest.update(title="中文报告：A&B_50%", abstract=r"这是一份流程验证报告，未开展科学实验。")
        self.manifest["sections"] = self.manifest["sections"][:1]
        (self.source / self.manifest["sections"][0]["file"]).write_text(
            "本报告仅检查文档生成流程，不主张任何实验结论。\n", encoding="utf-8",
        )

    def save_manifest(self):
        (self.source / "report.json").write_bytes(report.json_bytes(self.manifest))

    def render(self):
        self.save_manifest()
        return report.render_report(self.source / "report.json", self.paper)

    def test_chinese_default_and_original_template_copy(self):
        self.assertTrue(self.render()["ok"])
        main = (self.paper / "main.tex").read_text()
        self.assertIn(r"\usepackage[preprint]{icml2026}", main)
        self.assertIn("fontset=fandol", main)
        self.assertIn(r"\icmltitle{中文报告：A\&B\_50\%}", main)
        self.assertIn(r"\twocolumn[", main)
        self.assertIn("摘要", main)
        self.assertNotIn("example.com", main)
        self.assertNotIn(r"\bibliography{", main)
        self.assertTrue(report.check_paper(self.paper)["ok"])
        for filename in report.get_preset().files:
            self.assertEqual((self.paper / filename).read_bytes(), (SKILL / "latex/icml2026" / filename).read_bytes())
        self.assertFalse((self.paper / "example_paper.bib").exists())

    def test_empty_scaffold_cannot_be_delivered(self):
        with self.assertRaises(ValueError):
            report.render_report(self.source / "report.json", self.paper)
        self.assertFalse(self.paper.exists())

    def test_citations_figures_and_relocation(self):
        # An image fixture is enough for assembly; actual image decoding is TeX's job.
        image = self.root / "input.png"
        image.write_bytes(b"image fixture")
        self.manifest["figures"] = [{
            "source": str(image), "path": "figures/observed.png", "caption": "流程检查图",
            "evidence": "测试夹具，非科研指标或证据",
        }]
        section = self.source / self.manifest["sections"][0]["file"]
        section.write_text(
            r"如图~\ref{fig:observed} 所示。\citep{fixture}" + "\n"
            r"\begin{figure}\centering\includegraphics[width=\columnwidth]{figures/observed.png}"
            r"\caption{流程检查图}\label{fig:observed}\end{figure}", encoding="utf-8",
        )
        (self.source / "references.bib").write_text(
            "@misc{fixture, title={Test fixture, not a research citation}, year={2026}}\n",
        )
        self.render()
        self.assertTrue(report.check_paper(self.paper)["ok"])
        portable = report.read_json(self.paper / "report.json")
        self.assertEqual(portable["figures"][0]["source"], "figures/observed.png")
        moved = self.root / "moved"
        shutil.move(self.paper, moved)
        image.unlink()
        shutil.rmtree(self.source)
        report.render_report(moved / "report.json", self.root / "rerendered")
        self.assertTrue(report.check_paper(self.root / "rerendered")["ok"])

    def test_validation_prevents_partial_output(self):
        section = self.source / self.manifest["sections"][0]["file"]
        for invalid in (r"不支持的引用\citep{missing}", r"\section{重复标题}正文", r"\ref{unknown}"):
            with self.subTest(invalid=invalid):
                section.write_text(invalid, encoding="utf-8")
                with self.assertRaises(ValueError):
                    self.render()
                self.assertFalse(self.paper.exists())

    def test_refuses_overwrite_and_symlink_escape(self):
        self.paper.mkdir()
        (self.paper / "main.tex").write_text("hand edited")
        with self.assertRaises(ValueError):
            self.render()
        self.assertEqual((self.paper / "main.tex").read_text(), "hand edited")
        self.assertFalse((self.paper / "icml2026.sty").exists())
        (self.paper / "main.tex").unlink()
        outside = self.root / "outside"
        outside.mkdir()
        (self.paper / "sections").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.render()
        self.assertEqual(list(outside.iterdir()), [])

    def test_on_disk_check_finds_missing_images_and_broken_references(self):
        self.render()
        section = self.paper / self.manifest["sections"][0]["file"]
        section.write_text(r"\includegraphics{figures/absent.pdf}\citep{missing}", encoding="utf-8")
        result = report.check_paper(self.paper)
        self.assertFalse(result["ok"])
        self.assertTrue(any("Missing figure" in item for item in result["errors"]))
        self.assertTrue(any("Undefined citations" in item for item in result["errors"]))

    def fake_compilers(self):
        executable = self.root / "fake-tex"
        executable.write_text(
            f"#!{sys.executable}\n"
            "import os, pathlib, sys\n"
            "target = next((x.split('=', 1)[1] for x in sys.argv if x.startswith('-output-directory=')), None)\n"
            "if target is None:\n"
            "    print('fake BibTeX failure' if os.getenv('FAIL_BIB') else 'fake BibTeX success')\n"
            "    sys.exit(2 if os.getenv('FAIL_BIB') else 0)\n"
            "target = pathlib.Path(target)\n"
            "job = next((x.split('=', 1)[1] for x in sys.argv if x.startswith('-jobname=')), 'main')\n"
            "(target / (job + '.aux')).write_text('\\\\bibdata{references}\\n\\\\citation{fixture}' if os.getenv('USE_BIB') else '')\n"
            "(target / (job + '.log')).write_text('Missing character: no glyph' if os.getenv('MISSING_GLYPH') else 'successful test compiler')\n"
            "(target / (job + '.pdf')).write_bytes(b'%PDF-fake-fixture')\n"
            "print('fake TeX invoked')\n", encoding="utf-8",
        )
        executable.chmod(0o755)
        return str(executable)

    def test_compiler_success_status_and_bibtex_failure(self):
        self.render()
        compiler = self.fake_compilers()
        with patch.object(report.shutil, "which", return_value=compiler):
            status = report.compile_report(self.paper)
            self.assertTrue(status["ok"], status)
            old_pdf = (self.paper / "report.pdf").read_bytes()
            self.assertFalse((self.paper / "main.pdf").exists())
            self.assertEqual(status["pdf"], str(self.paper / "report.pdf"))
            self.assertEqual(status["report_pdf"], str(self.paper / "report.pdf"))
            self.assertEqual(status["source_sha256"], report.source_digest(self.paper))
            self.assertTrue(status["pdf_sha256"])
            self.assertIn("-no-shell-escape", (self.paper / "build.log").read_text())
            with patch.dict(os.environ, {"USE_BIB": "1", "FAIL_BIB": "1"}):
                status = report.compile_report(self.paper)
            self.assertFalse(status["ok"])
            self.assertIsNone(status["pdf"])
            self.assertIsNone(status["report_pdf"])
            self.assertIn("fake BibTeX failure", (self.paper / "build.log").read_text())
            self.assertFalse((self.paper / "main.pdf").exists())
            self.assertEqual((self.paper / "report.pdf").read_bytes(), old_pdf)
        self.assertEqual(list(self.paper.glob(".report-build-*")), [])

    def test_success_removes_legacy_duplicate(self):
        self.render()
        (self.paper / "main.pdf").write_bytes(b"previous compiler output")
        with patch.object(report.shutil, "which", return_value=self.fake_compilers()):
            status = report.compile_report(self.paper)
        self.assertTrue(status["ok"], status)
        self.assertTrue((self.paper / "report.pdf").is_file())
        self.assertFalse((self.paper / "main.pdf").exists())

    def test_missing_compiler_glyphs_and_timeout_are_failures(self):
        self.render()
        with patch.object(report.shutil, "which", return_value=None):
            status = report.compile_report(self.paper)
            self.assertFalse(status["ok"])
            self.assertIsNone(status["report_pdf"])
            self.assertFalse((self.paper / "report.pdf").exists())
        with patch.object(report.shutil, "which", return_value=self.fake_compilers()):
            with patch.dict(os.environ, {"MISSING_GLYPH": "1"}):
                self.assertFalse(report.compile_report(self.paper)["ok"])
            with patch.object(report.subprocess, "run", side_effect=subprocess.TimeoutExpired("xelatex", 1)):
                status = report.compile_report(self.paper, timeout=1)
                self.assertFalse(status["ok"])
                self.assertIn("timed out", status["errors"][0])
        self.assertIsNone(report.read_json(self.paper / "build-status.json")["pdf"])

    def test_english_and_anonymous_overrides(self):
        self.manifest.update(language="en", style="anonymous", authors=[{"name": "Private Author", "email": "private@invalid.test"}])
        self.render()
        text = (self.paper / "main.tex").read_text()
        self.assertNotIn("{ctex}", text)
        self.assertIn(r"\usepackage{icml2026}", text)
        self.assertNotIn("Private Author", text)
        self.assertNotIn("private@invalid.test", text)

    def test_cli_works_outside_repository_and_builds_prompts(self):
        context = self.root / "context.json"
        context.write_text('{"task":"中文流程测试"}', encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(SKILL / "scripts/report_generation.py"), "prompt", "--stage", "outline", "--context", str(context)],
            cwd=self.root, text=True, capture_output=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("本次使用简体中文", result.stdout)
        self.assertIn("中文流程测试", result.stdout)

    def test_relocated_skill_needs_no_original_project(self):
        self.save_manifest()
        installed = self.root / "installed-skill"
        shutil.copytree(SKILL, installed)
        environment = os.environ.copy()
        environment.pop("PYTHONDONTWRITEBYTECODE", None)
        result = subprocess.run(
            [sys.executable, str(installed / "scripts/report_generation.py"), "render",
             "--manifest", str(self.source / "report.json"), "--output", str(self.paper)],
            cwd=self.root, text=True, capture_output=True, check=False, env=environment,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(report.check_paper(self.paper)["ok"])
        self.assertEqual(list(installed.rglob("__pycache__")), [])


if __name__ == "__main__":
    unittest.main()
