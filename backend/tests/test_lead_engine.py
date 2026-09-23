import asyncio
import os
import unittest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")

from app.lead_analyzer import LeadAnalyzer
from app.lead_discovery import _contains_terms, _curated_seed_urls, _existing_discovery_lead, _is_direct_company_seed, _is_public_url, _public_business_email, _score
from app.main import LeadSearchTaskIn, create_lead_search_task, lead_task_values_from_product_profile


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

    def test_application_terms_allow_hyphens_and_singular_plural_variants(self):
        evidence = "We manufacture water-based flexographic ink for BOPP film printing."
        hits = _contains_terms(evidence, ["water based flexographic inks", "BOPP films", "PVC compounds"])
        self.assertEqual(hits, ["water based flexographic inks", "BOPP films"])

    def test_matching_company_seed_is_not_treated_as_a_directory(self):
        raw = "<title>Example Ink | Water Based Flexographic Inks</title><p>We are a manufacturer of water-based flexographic inks.</p><a href='mailto:sales@example-ink.com'>sales@example-ink.com</a>"
        text = "Example Ink We are a manufacturer of water-based flexographic inks sales@example-ink.com"
        self.assertTrue(_is_direct_company_seed(raw, text, "example-ink.com", ["water based flexographic inks"]))
        directory = "<title>Association Members</title><p>Industry association member directory</p>"
        self.assertFalse(_is_direct_company_seed(directory, "Industry association member directory", "association.example.org", ["water based flexographic inks"]))

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

    def test_pure_crawler_is_the_default_and_uses_sector_entrances(self):
        task = LeadSearchTaskIn(task_name="Fertilizer Malaysia", application_keywords=["controlled release fertilizer"], target_countries=["Malaysia"])
        self.assertEqual(task.discovery_strategy, "public_seed_crawl")
        sources = _curated_seed_urls({"task_name": "Fertilizer", "application_keywords": ["controlled release fertilizer"], "target_countries": ["Malaysia"]})
        self.assertIn(("https://fiam.org.my/index.php?Itemid=118&cat_id=1&option=com_mtree&view=listcats", "马来西亚肥料工业协会公开会员目录"), sources)

    def test_existing_lead_prefers_exact_source_before_domain_match(self):
        rows = [
            {"id": "same-domain", "source_url": "https://example.com/old", "website_domain": "example.com", "company_name": "Example"},
            {"id": "exact-source", "source_url": "https://example.com/products", "website_domain": "example.com", "company_name": "Example Products"},
        ]
        found = _existing_discovery_lead(rows, "https://example.com/products", "example.com", "Example", None)
        self.assertEqual(found["id"], "exact-source")

    def test_recreates_a_soft_deleted_task_by_restoring_it(self):
        from unittest.mock import patch

        calls = []

        async def fake_supabase(path, token, method="GET", payload=None):
            calls.append((path, method, payload))
            if path.startswith("crawl_sources?"):
                return []
            if path.startswith("lead_search_tasks?task_name="):
                return [{"id": "deleted-task"}]
            if path.startswith("lead_search_tasks?id=eq.deleted-task") and method == "PATCH":
                return [{"id": "deleted-task", "task_name": "TDS preset"}]
            raise AssertionError((path, method, payload))

        payload = LeadSearchTaskIn(task_name="TDS preset", application_keywords=["controlled release fertilizer"])
        with patch("app.main.supabase", fake_supabase):
            result = asyncio.run(create_lead_search_task(payload, "Bearer test"))
        self.assertEqual(result["id"], "deleted-task")
        restore = next(item for item in calls if item[1] == "PATCH")
        self.assertIsNone(restore[2]["deleted_at"])
        self.assertFalse(restore[2]["cancel_requested"])


if __name__ == "__main__":
    unittest.main()
