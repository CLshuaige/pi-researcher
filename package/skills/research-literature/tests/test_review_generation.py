"""Checks for retained assets, shared-backend reuse and single-PDF publication."""

import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SKILL = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("review_generation", SKILL / "scripts/review_generation.py")
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "project"
        self.root.mkdir()
        self.backend = review.backend()
        review.init_review(self.root, "zh")
        self.folder = self.root / "literature/review"
        self.write_rows("papers.jsonl", [{
            "id": "P001", "title": "Local pipeline fixture, not a research paper",
            "url": "https://example.invalid/fixture", "readLevel": "fulltext",
        }])
        self.write_rows("evidence.jsonl", [{
            "id": "E001", "paper_id": "P001", "kind": "paraphrase", "readLevel": "fulltext",
            "locator": "Fixture specification", "content": "用于代码回归的合成夹具，不是科研证据。",
        }])
        self.candidate = {
            "id": "C001", "paper_id": "P001", "source_url": "https://example.invalid/fixture",
            "locator": "Synthetic fixture figure 1", "viewed": True, "decision": "omit",
            "inspection": "Synthetic inspection fixture; does not claim real paper access.",
            "reason": "Use a synthesis diagram to explain this test pipeline.",
        }
        self.write_rows("figure-candidates.jsonl", [self.candidate])
        self.metadata = self.root / "literature/asset-draft.json"
        self.metadata.write_text(json.dumps({
            "id": "F001", "kind": "synthesis", "caption": "合成测试图",
            "sources": [{"paper_id": "P001", "locator": "Fixture specification"}],
            "credit": "测试夹具自建", "derivation": "Only validates asset retention and publication.",
        }, ensure_ascii=False), encoding="utf-8")
        self.cache = Path(self.temp.name) / "temporary.png"
        self.cache.write_bytes(b"image fixture; real image decoding is checked by the TeX smoke test")

    def write_rows(self, name, items):
        (self.root / "literature" / name).write_text(
            "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in items), encoding="utf-8",
        )

    def prepare(self):
        asset = review.retain_asset(self.root, self.cache, self.metadata)["asset"]
        manifest = self.backend.read_json(self.folder / "report.json")
        manifest.update(title="图文综述生成测试", abstract="本文件只验证生成流程，不构成文献研究。")
        manifest["sections"] = manifest["sections"][:1]
        manifest["figures"] = [{
            "asset_id": "F001", "source": str(self.root / asset["path"]),
            "path": "figures/F001.png", "caption": "合成测试图", "evidence": "F001/P001/E001",
        }]
        self.section = self.folder / manifest["sections"][0]["file"]
        self.section.write_text(
            r"如图~\ref{fig:fixture} 所示，测试本地资源留存~\citep{fixture}。" + "\n"
            r"\begin{figure}\centering\includegraphics[width=\columnwidth]{figures/F001.png}"
            r"\caption{自建测试图，非原论文图。}\label{fig:fixture}\end{figure}", encoding="utf-8",
        )
        (self.folder / "references.bib").write_text(
            "@manual{fixture, title={Local pipeline fixture}, organization={Local tests}, year={2026}}\n",
        )
        (self.folder / "report.json").write_bytes(self.backend.json_bytes(manifest))
        return asset

    def fake_compile(self, folder, engine, timeout):
        data = b"%PDF-fake-publication-fixture"
        (folder / "report.pdf").write_bytes(data)
        (folder / "build.log").write_text("Fake shared compiler completed")
        return {"ok": True, "engine": engine, "pdf": str(folder / "report.pdf"),
                "report_pdf": str(folder / "report.pdf"), "errors": [], "warnings": [],
                "source_sha256": self.backend.source_digest(folder),
                "pdf_sha256": hashlib.sha256(data).hexdigest()}

    def test_scaffold_contains_no_invented_review_or_sources(self):
        manifest = self.backend.read_json(self.folder / "report.json")
        self.assertEqual(manifest["language"], "zh")
        self.assertFalse((self.root / "literature-review.md").exists())
        with self.assertRaises(ValueError):
            review.render_review(self.root)
        self.assertFalse((self.folder / "main.tex").exists())

    def test_retained_bytes_survive_temporary_cache_removal_and_relocation(self):
        asset = self.prepare()
        self.cache.unlink()
        review.render_review(self.root, force=True)
        self.assertTrue(review.check_review(self.root)["ok"])
        self.assertEqual(hashlib.sha256((self.root / asset["path"]).read_bytes()).hexdigest(), asset["sha256"])
        new_root = Path(self.temp.name) / "moved"
        shutil.move(self.root, new_root)
        self.assertTrue(review.check_review(new_root)["ok"])
        review.render_review(new_root)
        self.assertTrue((new_root / "literature/review/icml2026.sty").is_file())

    def test_retain_is_idempotent_and_refuses_changed_identity(self):
        first = review.retain_asset(self.root, self.cache, self.metadata)
        second = review.retain_asset(self.root, self.cache, self.metadata)
        self.assertEqual(first["asset"], second["asset"])
        self.assertEqual(len(review.rows(self.root / "literature/assets.jsonl")), 1)
        self.cache.write_bytes(b"changed image")
        with self.assertRaises(ValueError):
            review.retain_asset(self.root, self.cache, self.metadata)

    def test_tampered_assets_and_missing_evidence_prevent_render(self):
        asset = self.prepare()
        (self.root / asset["path"]).write_bytes(b"changed after retention")
        with self.assertRaisesRegex(ValueError, "has changed"):
            review.render_review(self.root)
        self.assertFalse((self.folder / "main.tex").exists())
        self.write_rows("evidence.jsonl", [])
        with self.assertRaisesRegex(ValueError, "Retain the evidence"):
            review.render_review(self.root)

    def test_figure_catalog_without_actual_section_image_is_rejected(self):
        self.prepare()
        self.section.write_text("正文尚未放图。", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "actually be included"):
            review.render_review(self.root)

    def test_candidate_inspection_is_required_but_original_adoption_is_optional(self):
        self.prepare()
        result = review.validate_review(self.root)
        self.assertEqual(result["inspected_original_figures"], 1)
        self.assertEqual(result["warnings"], [])
        self.write_rows("figure-candidates.jsonl", [])
        with self.assertRaisesRegex(ValueError, "original figure inspection"):
            review.render_review(self.root)
        self.candidate.update(viewed=False, decision="unavailable", inspection="Fixture access failed.",
                              reason="Only abstract material available; boundary disclosed in text.")
        self.write_rows("figure-candidates.jsonl", [self.candidate])
        result = review.render_review(self.root, force=True)
        self.assertTrue(result["ok"])
        self.assertIn("No original figure was inspected", result["warnings"][0])
        self.assertTrue(review.check_review(self.root)["warnings"])

    def test_original_selection_requires_matching_inspected_candidate(self):
        metadata = self.backend.read_json(self.metadata)
        metadata.update(kind="reproduced", candidate_id="C001", source_url=self.candidate["source_url"],
                        reuse_basis="Synthetic test image authored for this test.")
        self.metadata.write_bytes(self.backend.json_bytes(metadata))
        self.prepare()
        with self.assertRaisesRegex(ValueError, "matching inspected candidate"):
            review.validate_review(self.root)
        self.candidate.update(decision="include", asset_id="F001")
        self.write_rows("figure-candidates.jsonl", [self.candidate])
        self.assertTrue(review.validate_review(self.root)["ok"])
        self.candidate["viewed"] = False
        self.write_rows("figure-candidates.jsonl", [self.candidate])
        with self.assertRaisesRegex(ValueError, "actually inspected"):
            review.validate_review(self.root)

    def test_long_running_title_is_shortened_before_render_without_changing_full_title(self):
        self.prepare()
        manifest = self.backend.read_json(self.folder / "report.json")
        manifest["running_title"] = "过长的中文完整题名" * 20
        full_title = manifest["title"]
        (self.folder / "report.json").write_bytes(self.backend.json_bytes(manifest))
        review.render_review(self.root, force=True)
        result = self.backend.read_json(self.folder / "report.json")
        self.assertEqual(result["running_title"], "Literature Review")
        self.assertEqual(result["title"], full_title)
        self.assertIn(r"\icmltitlerunning{Literature Review}", (self.folder / "main.tex").read_text())

    def test_asset_requires_known_source_and_local_numerical_plot_inputs(self):
        metadata = self.backend.read_json(self.metadata)
        metadata["sources"][0]["paper_id"] = "unknown"
        self.metadata.write_bytes(self.backend.json_bytes(metadata))
        with self.assertRaisesRegex(ValueError, "Unknown asset source"):
            review.retain_asset(self.root, self.cache, self.metadata)
        metadata.update(kind="plot", data="../outside.csv", script="literature/assets/draw.py")
        metadata["sources"][0]["paper_id"] = "P001"
        self.metadata.write_bytes(self.backend.json_bytes(metadata))
        with self.assertRaises(ValueError):
            review.retain_asset(self.root, self.cache, self.metadata)

    def test_publishes_only_literature_review_pdf_and_rewrites_status(self):
        self.prepare()
        review.render_review(self.root, force=True)
        with patch.object(self.backend, "compile_report", side_effect=self.fake_compile):
            result = review.compile_review(self.root, "xelatex", 120)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["pdf"], str(self.root / "literature-review.pdf"))
        self.assertNotIn("report_pdf", result)
        self.assertFalse((self.folder / "report.pdf").exists())
        self.assertEqual(self.backend.read_json(self.folder / "build-status.json"), result)
        self.assertFalse((self.root / "literature-review.md").exists())

    def test_missing_compiler_or_evidence_does_not_publish_stale_pdf(self):
        self.prepare()
        review.render_review(self.root, force=True)
        final = self.root / "literature-review.pdf"
        final.write_bytes(b"older successful review")
        with patch.object(self.backend.shutil, "which", return_value=None):
            result = review.compile_review(self.root, "xelatex", 120)
        self.assertFalse(result["ok"])
        self.assertIsNone(result["pdf"])
        self.assertIsNone(result["review_pdf"])
        self.assertEqual(final.read_bytes(), b"older successful review")
        self.write_rows("evidence.jsonl", [])
        result = review.compile_review(self.root, "xelatex", 120)
        self.assertFalse(result["ok"])
        self.assertFalse(self.backend.read_json(self.folder / "build-status.json")["ok"])

    def test_missing_shared_skill_is_reported_without_fallback_copy(self):
        review.backend.cache_clear()
        try:
            with patch.object(review, "REPORT", Path(self.temp.name) / "missing"):
                with self.assertRaisesRegex(ValueError, "Missing shared research-report"):
                    review.backend()
        finally:
            review.backend.cache_clear()

    def test_cli_runs_from_outside_repository(self):
        result = subprocess.run(
            [sys.executable, str(SKILL / "scripts/review_generation.py"), "check", "--root", str(self.root)],
            cwd=self.temp.name, text=True, capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('"ok": false', result.stderr)


if __name__ == "__main__":
    unittest.main()
