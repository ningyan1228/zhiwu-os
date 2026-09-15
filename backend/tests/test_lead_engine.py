import asyncio
import os
import unittest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")

from app.lead_analyzer import LeadAnalyzer
from app.lead_discovery import _is_public_url, _public_business_email, _score
from app.main import LeadSearchTaskIn, lead_task_values_from_product_profile


class LeadEngineUnitTests(unittest.TestCase):
    def test_ssrf_and_non_http_urls_are_rejected(self):
        self.assertFalse(_is_public_url("http://127.0.0.1/admin")[0])
        self.assertFalse(_is_public_url("http://localhost:8000")[0])
        self.assertFalse(_is_public_url("file:///etc/passwd")[0])

    def test_public_business_email_filters_placeholders(self):
        raw = "<a href='mailto:sales@example-chem.com'>sales@example-chem.com</a> example@example.com"
        self.assertEqual(_public_business_email(raw, "example-chem.com"), "sales@example-chem.com")

    def test_rule_score_is_bounded_and_explained(self):
        score, reasons, _ = _score(
            {"target_countries": ["India"]}, "India manufacturer packaging", "https://example.com",
            "sales@example.com", "Example", False, ["packaging"], "直接需求候选",
        )
        self.assertGreaterEqual(score, 0)
        self.assertLessEqual(score, 100)
        self.assertTrue(reasons)

    def test_rules_only_analyzer_needs_no_api_key(self):
        result = asyncio.run(LeadAnalyzer().analyze(company="Example", task_name="ELO", rule_score=62, evidence="public evidence"))
        self.assertEqual(result.confidence_score, 62)
        self.assertEqual(result.score_adjustment, 0)

    def test_task_snapshot_uses_enabled_keywords_and_sources(self):
        from unittest.mock import patch

        async def fake_supabase(path, token, method="GET", payload=None):
            if path.startswith("products?"):
                return [{"id": "product-1", "profile_status": "已确认", "technical_keywords": ["ELO"], "product_code": "NL-ELO", "product_name": "Epoxidized Linseed Oil", "confirmed_applications": ["PVC flooring"], "target_company_types": ["manufacturer"], "exclusion_rules": ["competitor"]}]
            if path.startswith("product_keywords?"):
                return [{"keyword": "bio based plasticizer", "keyword_type": "include", "country": "India"}, {"keyword": "raw material supplier", "keyword_type": "exclude", "country": None}]
            if path.startswith("crawl_sources?"):
                return [{"start_url": "https://directory.example.org/members", "country": "India"}, {"start_url": "https://elsewhere.example.org", "country": "Germany"}]
            raise AssertionError(path)

        payload = LeadSearchTaskIn(task_name="ELO India", product_id="product-1", target_countries=["India"], source_urls=["https://manual.example.org"], max_results=20)
        with patch("app.main.supabase", fake_supabase):
            result = asyncio.run(lead_task_values_from_product_profile(payload, "Bearer test"))
        self.assertIn("bio based plasticizer", result["product_keywords"])
        self.assertIn("raw material supplier", result["profile_exclusion_rules"])
        self.assertIn("https://directory.example.org/members", result["source_urls"])
        self.assertNotIn("https://elsewhere.example.org", result["source_urls"])


if __name__ == "__main__":
    unittest.main()
