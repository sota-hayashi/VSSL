"""生データの読み込みと，今回の対象でないファイルの除外（analysis.md「処理の流れ」1）．"""
import json

import pandas as pd

from . import settings


def target_reason(d, target):
    """対象から外す理由を返す．対象なら None．"""
    rule = settings.TARGETS[target]
    meta = d["meta"]
    sid = meta.get("subjectId") or ""
    if sid in settings.TEST_IDS:
        return "test ID"
    prefix = rule["id_prefix"]
    if prefix is not None and not sid.startswith(prefix):
        return f"ID does not start with '{prefix}'"
    if prefix is None and sid.startswith(settings.TARGETS["pilot"]["id_prefix"]):
        return "pilot ID"
    if rule["versions"] is not None and meta.get("version") not in rule["versions"]:
        return f"version {meta.get('version')}"
    if meta.get("debug"):
        return "debug"
    if meta.get("status") != "completed":
        return f"status {meta.get('status')}"
    return None


def load(raw_dir, target):
    """対象のデータのリストと，全ファイルの読み込みの記録（DataFrame）を返す．"""
    data, log = [], []
    for path in sorted(raw_dir.glob("*.json")):
        row = {"file": path.name}
        try:
            d = json.loads(path.read_text())
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            row.update(included=False, reason=f"cannot read: {e}")
            log.append(row)
            continue
        meta = d.get("meta", {})
        row.update(subject=meta.get("subjectId"), version=meta.get("version"),
                   status=meta.get("status"), debug=meta.get("debug"))
        reason = target_reason(d, target)
        row.update(included=reason is None, reason=reason)
        log.append(row)
        if reason is None:
            data.append(d)
    return data, pd.DataFrame(log)
