"""Protocol and CLI behavior; synthetic fixtures are not real academic reviews."""

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "review_output.py"
SPEC = importlib.util.spec_from_file_location("review_output", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ReviewOutputTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.target = self.root / "综述.md"
        self.target.write_text("# 综述\n范围与原文分析。\n", encoding="utf-8")
        self.evidence = self.root / "来源.json"
        self.evidence.write_text('{"source": "synthetic test fixture"}', encoding="utf-8")
        self.review_file = self.root / "review.json"
        self.manifest = self.root / "inputs.json"
        self.output = self.root / "review.md"
        self.review = {
            "schema_version": 1, "input_type": "literature",
            "target": MODULE.file_record(self.target),
            "coverage": {"checked": ["综述全文"], "unavailable": [], "not_checked": ["未联网扩大检索"]},
            "review_status": "reviewed", "summary": "本测试评估一份叙述性综述。未声称开展新实验。",
            "strengths": ["材料限定了综述范围（第 1 节）。"], "issues": [],
            "questions_for_authors": [], "overall_score": 7,
            "score_rationale": "在既定范围内给出有依据的综合。", "confidence": 3,
            "confidence_rationale": "核验了提供的正文，未扩大检索。",
            "recommendation": "Accept", "next_actions": [],
        }

    def save(self, review=None):
        self.review_file.write_text(json.dumps(self.review if review is None else review, ensure_ascii=False), encoding="utf-8")

    def cli(self, *args, success=True):
        result = subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0 if success else 1, result.stdout + result.stderr)
        return result

    def snapshot(self):
        self.cli("snapshot", "--target", self.target, "--input-type", "literature",
                 "--evidence", self.evidence, "--evidence", self.evidence, "--output", self.manifest)

    def issue(self, **changes):
        issue = {
            "id": "R1", "severity": "major", "location": "综述.md:第 1 节",
            "finding": "所引来源不能支持因果解释。", "evidence_status": "verified",
            "evidence": ["来源.json:source；综述.md:第 1 节"], "impact": "影响主要结论。",
            "suggested_action": "缩小为关联结论。", "acceptance_criteria": "结论与原文的证据强度一致。",
        }
        issue.update(changes)
        return issue

    def test_snapshot_and_render_literature_without_experiments(self):
        self.snapshot()
        manifest = MODULE.read_json(self.manifest)
        self.assertEqual(len(manifest["evidence"]), 1)
        self.assertEqual(manifest["target"], MODULE.file_record(self.target))
        self.save()
        self.cli("check", "--review", self.review_file, "--manifest", self.manifest)
        self.cli("render", "--review", self.review_file, "--manifest", self.manifest)
        rendered = self.output.read_text(encoding="utf-8")
        self.assertIn(self.review["summary"], rendered)
        self.assertIn("7/10", rendered)
        self.assertIn("Accept", rendered)
        self.assertIn("未联网扩大检索", rendered)

    def test_invalid_values_and_missing_required_fields(self):
        invalid = [("overall_score", True), ("overall_score", 11), ("overall_score", 7.5),
                   ("confidence", 0), ("confidence", False), ("confidence", "3"),
                   ("schema_version", True), ("summary", "  "), ("strengths", "none"),
                   ("recommendation", []), ("review_status", []), ("input_type", "code")]
        for field, value in invalid:
            with self.subTest(field=field, value=value):
                review = copy.deepcopy(self.review)
                review[field] = value
                with self.assertRaises(ValueError):
                    MODULE.validate_review(review)
        for field in self.review:
            with self.subTest(missing=field):
                review = copy.deepcopy(self.review)
                del review[field]
                with self.assertRaises(ValueError):
                    MODULE.validate_review(review)

    def test_major_issue_and_recommendation_consistency(self):
        self.review["issues"] = [self.issue()]
        with self.assertRaises(ValueError):
            MODULE.validate_review(self.review)
        self.review.update(review_status="needs_revision", recommendation="Reject", overall_score=4)
        MODULE.validate_review(self.review)
        self.save()
        self.cli("render", "--review", self.review_file)
        rendered = self.output.read_text(encoding="utf-8")
        for field in ("location", "finding", "impact", "suggested_action", "acceptance_criteria"):
            self.assertIn(self.review["issues"][0][field], rendered)

    def test_insufficient_evidence_is_not_forced_to_score(self):
        self.review.update(overall_score=None, recommendation="Not Assessed", review_status="insufficient_evidence")
        self.review["coverage"] = {"checked": [], "unavailable": ["关键章节无法读取"], "not_checked": []}
        MODULE.validate_review(self.review)
        self.assertIn("未评分", MODULE.render_review(self.review))
        self.review["recommendation"] = "Reject"
        with self.assertRaises(ValueError):
            MODULE.validate_review(self.review)

    def test_issue_ids_evidence_and_rereview(self):
        self.review.update(review_status="needs_revision", recommendation="Reject", overall_score=4)
        self.review["issues"] = [self.issue(), self.issue()]
        with self.assertRaises(ValueError):
            MODULE.validate_review(self.review)
        self.review["issues"] = [self.issue(evidence=[])]
        with self.assertRaises(ValueError):
            MODULE.validate_review(self.review)
        self.review["issues"][0]["evidence_status"] = "unverifiable"
        MODULE.validate_review(self.review)
        self.review["previous_review"] = str(self.root / "prior" / "review.json")
        self.review["resolved_issues"] = [{"id": "R2", "evidence": ["新来源:第 2 节"], "explanation": "已核验原文。"}]
        MODULE.validate_review(self.review)
        self.assertIn("已核验原文。", MODULE.render_review(self.review))
        self.review["resolved_issues"][0]["id"] = "R1"
        with self.assertRaises(ValueError):
            MODULE.validate_review(self.review)

    def test_changed_or_missing_inputs_do_not_replace_report(self):
        self.snapshot()
        self.save()
        self.cli("render", "--review", self.review_file, "--manifest", self.manifest)
        previous = self.output.read_bytes()
        self.evidence.write_text("updated source", encoding="utf-8")
        result = self.cli("render", "--review", self.review_file, "--manifest", self.manifest, "--force", success=False)
        self.assertIn("Input changed", result.stderr)
        self.assertEqual(self.output.read_bytes(), previous)
        self.evidence.unlink()
        self.cli("check", "--review", self.review_file, "--manifest", self.manifest, success=False)
        self.assertEqual(self.output.read_bytes(), previous)

    def test_no_overwrite_or_input_clobber_even_with_force(self):
        self.snapshot()
        self.save()
        self.cli("render", "--review", self.review_file)
        self.cli("render", "--review", self.review_file, success=False)
        self.cli("render", "--review", self.review_file, "--force")
        for destination in (self.target, self.evidence, self.review_file, self.manifest):
            with self.subTest(destination=destination):
                original = destination.read_bytes()
                self.cli("render", "--review", self.review_file, "--manifest", self.manifest,
                         "--output", destination, "--force", success=False)
                self.assertEqual(destination.read_bytes(), original)
        self.cli("snapshot", "--target", self.target, "--output", self.target, "--force", success=False)

    def test_malformed_json_or_target_mismatch_produces_no_report(self):
        self.review_file.write_text('{"overall_score": NaN}', encoding="utf-8")
        self.cli("render", "--review", self.review_file, success=False)
        self.review_file.write_text('{"summary":"a","summary":"b"}', encoding="utf-8")
        self.cli("render", "--review", self.review_file, success=False)
        self.snapshot()
        self.review["target"]["sha256"] = "0" * 64
        self.save()
        self.cli("render", "--review", self.review_file, "--manifest", self.manifest, success=False)
        self.assertFalse(self.output.exists())

    def test_missing_or_empty_target_cannot_be_snapshotted(self):
        self.target.write_text("", encoding="utf-8")
        self.cli("snapshot", "--target", self.target, "--output", self.manifest, success=False)
        self.target.unlink()
        self.cli("snapshot", "--target", self.target, "--output", self.manifest, success=False)
        self.assertFalse(self.manifest.exists())


if __name__ == "__main__":
    unittest.main()
