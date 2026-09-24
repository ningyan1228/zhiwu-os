import json

import pytest

from app.manual_plus import build_manual_plus_prompt, parse_manual_plus_candidates


TASK_ID = "11111111-1111-1111-1111-111111111111"


def test_manual_plus_json_requires_matching_task_and_official_sources():
    payload = {
        "format_version": "zhiwu-os-chatgpt-discovery/v1",
        "task_id": TASK_ID,
        "companies": [{
            "company_name": "Example Fertilizer",
            "official_website": "https://example.com/products/coated-urea",
            "country": "Brazil",
            "lead_layer": "直接需求候选",
            "match_score": 91,
            "source_urls": ["https://example.com/products/coated-urea"],
        }],
    }
    result = parse_manual_plus_candidates(json.dumps(payload), expected_task_id=TASK_ID)
    assert result[0]["root_domain"] == "example.com"
    assert result[0]["suggested_score"] == 91


def test_manual_plus_csv_is_supported_and_duplicate_domains_are_removed():
    raw = """company_name,official_website,country,source_urls,match_score
Company One,https://one.example/products,Brazil,https://one.example/products,70
Duplicate,https://one.example/contact,Brazil,https://one.example/contact,60
Company Two,https://two.example,India,https://two.example/about,55
"""
    result = parse_manual_plus_candidates(raw, expected_task_id=TASK_ID)
    assert [row["company_name"] for row in result] == ["Company One", "Company Two"]


def test_manual_plus_rejects_wrong_task_and_non_public_urls():
    with pytest.raises(ValueError, match="另一个客户发现任务"):
        parse_manual_plus_candidates(json.dumps({"task_id": "wrong", "companies": []}), expected_task_id=TASK_ID)
    with pytest.raises(ValueError, match="没有可导入"):
        parse_manual_plus_candidates(json.dumps({"task_id": TASK_ID, "companies": [{
            "company_name": "Private", "official_website": "http://127.0.0.1", "source_urls": ["http://127.0.0.1"]
        }]}), expected_task_id=TASK_ID)


def test_prompt_is_application_led_and_demands_raw_json():
    task = {
        "id": TASK_ID,
        "task_name": "包衣剂需求客户",
        "target_region": "Brazil",
        "candidate_limit": 20,
        "application_snapshot": [{
            "application_name": "聚氨酯包膜尿素",
            "description": "用于控释肥颗粒包膜",
            "target_company_types": ["controlled release fertilizer manufacturer"],
            "official_business_evidence": "官网展示包膜肥生产能力",
            "search_terms": ["polymer coated urea manufacturer Brazil"],
        }],
    }
    prompt = build_manual_plus_prompt(task, [{"query_text": "coated fertilizer producer Brazil"}], [])
    assert "只找需求端或实际下游应用企业" in prompt
    assert "最终只返回一个合法 JSON 对象" in prompt
    assert TASK_ID in prompt
    assert "聚氨酯包膜尿素" in prompt
