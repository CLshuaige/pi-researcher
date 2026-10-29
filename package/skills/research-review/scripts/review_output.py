#!/usr/bin/env python3
"""Record local review inputs, validate a review, and render review.md (no model calls)."""

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


RECOMMENDATIONS = {"Strong Accept", "Accept", "Borderline", "Reject", "Strong Reject", "Not Assessed"}
STATUSES = {"reviewed", "needs_revision", "insufficient_evidence"}


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def string_list(value):
    return isinstance(value, list) and all(nonempty(item) for item in value)


def file_record(path):
    path = Path(path).resolve(strict=True)
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            size += len(block)
            digest.update(block)
    return {"path": str(path), "sha256": digest.hexdigest(), "bytes": size}


def reject_constant(value):
    raise ValueError(f"Invalid JSON constant: {value}")


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"),
                      parse_constant=reject_constant, object_pairs_hook=unique_keys)


def validate_record(record, label):
    if not isinstance(record, dict):
        raise ValueError(f"{label} must be an object")
    if not nonempty(record.get("path")) or not Path(record["path"]).is_absolute():
        raise ValueError(f"{label}.path must be an absolute file path")
    if not isinstance(record.get("sha256"), str) or not re.fullmatch(r"[0-9a-fA-F]{64}", record["sha256"]):
        raise ValueError(f"{label}.sha256 must be a SHA-256 hex digest")


def validate_review(review):
    """Validate observable protocol invariants, not scientific correctness."""
    if not isinstance(review, dict):
        raise ValueError("Review must be an object")
    if type(review.get("schema_version")) is not int or review["schema_version"] != 1:
        raise ValueError("schema_version must be integer 1")
    if review.get("input_type") not in ("paper", "literature"):
        raise ValueError("input_type must be paper or literature")
    validate_record(review.get("target"), "target")
    for field in ("summary", "score_rationale", "confidence_rationale"):
        if not nonempty(review.get(field)):
            raise ValueError(f"{field} must be a nonempty string")
    for field in ("strengths", "questions_for_authors", "next_actions"):
        if not string_list(review.get(field)):
            raise ValueError(f"{field} must be an array of nonempty strings")
    coverage = review.get("coverage")
    if not isinstance(coverage, dict):
        raise ValueError("coverage must be an object")
    for field in ("checked", "unavailable", "not_checked"):
        if not string_list(coverage.get(field)):
            raise ValueError(f"coverage.{field} must be an array of nonempty strings")
    if not any(coverage[field] for field in ("checked", "unavailable", "not_checked")):
        raise ValueError("coverage must describe actual checks or limitations")
    status = review.get("review_status")
    if not isinstance(status, str) or status not in STATUSES:
        raise ValueError("Invalid review_status")
    recommendation = review.get("recommendation")
    if not isinstance(recommendation, str) or recommendation not in RECOMMENDATIONS:
        raise ValueError("Invalid recommendation")
    score = review.get("overall_score")
    if "overall_score" not in review or (score is not None and (type(score) is not int or not 1 <= score <= 10)):
        raise ValueError("overall_score must be integer 1..10 or null")
    confidence = review.get("confidence")
    if type(confidence) is not int or not 1 <= confidence <= 5:
        raise ValueError("confidence must be integer 1..5")
    if (score is None) != (recommendation == "Not Assessed") or (score is None) != (status == "insufficient_evidence"):
        raise ValueError("null score, Not Assessed and insufficient_evidence must occur together")

    issues = review.get("issues")
    if not isinstance(issues, list):
        raise ValueError("issues must be an array")
    seen = set()

    def issue_id(item):
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not re.fullmatch(r"R[1-9][0-9]*", item["id"]):
            raise ValueError("Each issue must have an ID such as R1")
        if item["id"] in seen:
            raise ValueError(f"Duplicate issue ID: {item['id']}")
        seen.add(item["id"])

    for issue in issues:
        issue_id(issue)
        if issue.get("severity") not in ("major", "minor", "suggestion"):
            raise ValueError(f"{issue['id']}: invalid severity")
        if issue.get("evidence_status") not in ("verified", "not_reported", "unverifiable"):
            raise ValueError(f"{issue['id']}: invalid evidence_status")
        for field in ("location", "finding", "impact", "suggested_action", "acceptance_criteria"):
            if not nonempty(issue.get(field)):
                raise ValueError(f"{issue['id']}.{field} must be a nonempty string")
        if not string_list(issue.get("evidence")) or (issue["evidence_status"] == "verified" and not issue["evidence"]):
            raise ValueError(f"{issue['id']}: evidence must be a string array, nonempty when verified")
    if any(issue["severity"] == "major" for issue in issues):
        if status == "reviewed" or recommendation in ("Accept", "Strong Accept"):
            raise ValueError("Unresolved major issues conflict with reviewed/Accept/Strong Accept")

    if "previous_review" in review and (not nonempty(review["previous_review"]) or not Path(review["previous_review"]).is_absolute()):
        raise ValueError("previous_review must be an absolute path")
    resolved = review.get("resolved_issues", [])
    if not isinstance(resolved, list):
        raise ValueError("resolved_issues must be an array")
    if resolved and not review.get("previous_review"):
        raise ValueError("resolved_issues requires previous_review")
    for issue in resolved:
        issue_id(issue)
        if not string_list(issue.get("evidence")) or not issue["evidence"] or not nonempty(issue.get("explanation")):
            raise ValueError(f"{issue['id']}: resolved issue needs evidence and explanation")


def check_manifest(manifest, review):
    if not isinstance(manifest, dict) or type(manifest.get("schema_version")) is not int or manifest["schema_version"] != 1:
        raise ValueError("Invalid input manifest schema_version")
    if manifest.get("input_type") != review["input_type"]:
        raise ValueError("Manifest input_type differs from review")
    target = manifest.get("target")
    validate_record(target, "manifest.target")
    if (target["path"], target["sha256"].lower()) != (review["target"]["path"], review["target"]["sha256"].lower()):
        raise ValueError("Review target differs from manifest")
    evidence = manifest.get("evidence")
    if not isinstance(evidence, list):
        raise ValueError("manifest.evidence must be an array")
    for record in [target, *evidence]:
        validate_record(record, "manifest file")
        if file_record(record["path"])["sha256"] != record["sha256"].lower():
            raise ValueError(f"Input changed since snapshot: {record['path']}")


def render_review(review):
    lines = ["# 研究成果评审", "", f"对象：{review['target']['path']}", "",
             f"SHA-256：`{review['target']['sha256']}`", "",
             f"类型：{review['input_type']}；评审状态：{review['review_status']}", "",
             "本报告为指定材料范围内的模拟学术评审。", "", "## 核验范围", ""]

    def bullets(items, empty="无列项。"):
        lines.extend([*(f"- {item}" for item in items), ""] if items else [empty, ""])

    for field, title in (("checked", "实际检查"), ("unavailable", "无法访问"), ("not_checked", "未核验")):
        lines.extend([f"### {title}", ""])
        bullets(review["coverage"][field])
    lines.extend(["## Summary（摘要）", "", review["summary"], "", "## Strengths（优势）", ""])
    bullets(review["strengths"], "未列出有足够依据的优势。")
    lines.extend(["## Weaknesses（问题与改进）", ""])
    if not review["issues"]:
        lines.extend(["在所述核验范围内未列出具体问题；这不证明未覆盖范围不存在问题。", ""])
    for issue in review["issues"]:
        lines.extend([f"### {issue['id']} · {issue['severity']}", "", issue["finding"], "",
                      f"- 位置：{issue['location']}", f"- 证据状态：{issue['evidence_status']}",
                      f"- 影响：{issue['impact']}", f"- 最小修正：{issue['suggested_action']}",
                      f"- 验收条件：{issue['acceptance_criteria']}", "", "证据或已查范围：", ""])
        bullets(issue["evidence"], "无可访问的直接证据，见核验限制。")
    lines.extend(["## Questions for authors（作者问题）", ""])
    bullets(review["questions_for_authors"])
    score = "未评分" if review["overall_score"] is None else f"{review['overall_score']}/10"
    lines.extend(["## Overall Score（整体评分）", "", score, "", review["score_rationale"], "",
                  "## Confidence（置信度）", "", f"{review['confidence']}/5", "", review["confidence_rationale"], "",
                  "## Recommendation（接收建议）", "", review["recommendation"], "", "## 后续动作建议", ""])
    bullets(review["next_actions"])
    if review.get("previous_review"):
        lines.extend(["## 复审记录", "", f"此前评审：{review['previous_review']}", ""])
        for issue in review.get("resolved_issues", []):
            lines.extend([f"### {issue['id']} · 已解决", "", issue["explanation"], ""])
            bullets(issue["evidence"])
    return "\n".join(lines).rstrip() + "\n"


def write_output(path, text, force, protected):
    path = Path(path).resolve()
    if path in {Path(item).resolve() for item in protected}:
        raise ValueError(f"Output would overwrite an input: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w" if force else "x", encoding="utf-8") as output:
        output.write(text)
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    snapshot = sub.add_parser("snapshot", help="Record explicit local input files")
    snapshot.add_argument("--target", required=True)
    snapshot.add_argument("--input-type", choices=("paper", "literature"), default="paper")
    snapshot.add_argument("--evidence", action="append", default=[])
    snapshot.add_argument("--output", required=True)
    snapshot.add_argument("--force", action="store_true")
    for command in ("check", "render"):
        child = sub.add_parser(command)
        child.add_argument("--review", required=True)
        child.add_argument("--manifest")
        if command == "render":
            child.add_argument("--output")
            child.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command == "snapshot":
            target = file_record(args.target)
            if target["bytes"] == 0:
                raise ValueError("Review target is empty")
            evidence = []
            seen = {target["path"]}
            for source in args.evidence:
                record = file_record(source)
                if record["path"] not in seen:
                    evidence.append(record)
                    seen.add(record["path"])
            manifest = {"schema_version": 1, "input_type": args.input_type,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "target": target, "evidence": evidence}
            output = write_output(args.output, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", args.force, seen)
        else:
            review = read_json(args.review)
            validate_review(review)
            protected = [args.review, review["target"]["path"]]
            if args.manifest:
                manifest = read_json(args.manifest)
                check_manifest(manifest, review)
                protected.extend([args.manifest, *(item["path"] for item in manifest["evidence"])])
            if args.command == "check":
                print("Review protocol valid" + ("; recorded inputs unchanged" if args.manifest else "; input versions not checked"))
                return 0
            destination = args.output or str(Path(args.review).parent / "review.md")
            output = write_output(destination, render_review(review), args.force, protected)
        print(output)
        return 0
    except (OSError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
