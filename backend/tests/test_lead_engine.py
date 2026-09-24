import asyncio
import os
import unittest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")

from app.lead_analyzer import LeadAnalyzer
from app.lead_discovery import _address_excerpt, _application_profile, _contains_terms, _curated_seed_urls, _customer_lead_source_type, _existing_discovery_lead, _is_direct_company_seed, _is_public_url, _public_business_email, _reviewed_seed_company_name, _reviewed_seed_profile, _same_site_domain, _score
from app.customer_development import canonical_domain, draft_email, nl_fc_pu_application_terms, nl_fc_pu_queries, public_http_url, score_lead
from app.tds_discovery import application_search_terms, extract_explicit_applications
from app.tds_presets import BUILTIN_TDS_PRESETS, builtin_tds_preset_summaries
from app.main import LeadSearchTaskIn, application_discovery_provider, application_match_status, application_task_profile, bootstrap_tds_preset, create_lead_search_task, lead_task_values_from_product_profile


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

    def test_application_profile_extracts_short_official_evidence_phrases(self):
        profile = _application_profile({
            "discovery_mode": "需求客户",
            "application_keywords": [
                "controlled release fertilizer manufacturer coating line",
                "polyurethane coated urea manufacturer",
            ],
            "target_company_types": ["缓释肥制造商"],
        })
        self.assertIn("controlled release fertilizer", profile["evidence_terms"])
        self.assertIn("coated urea", profile["evidence_terms"])

    def test_matching_company_seed_is_not_treated_as_a_directory(self):
        raw = "<title>Example Ink | Water Based Flexographic Inks</title><p>We are a manufacturer of water-based flexographic inks.</p><a href='mailto:sales@example-ink.com'>sales@example-ink.com</a>"
        text = "Example Ink We are a manufacturer of water-based flexographic inks sales@example-ink.com"
        self.assertTrue(_is_direct_company_seed(raw, text, "example-ink.com", ["water based flexographic inks"]))
        directory = "<title>Association Members</title><p>Industry association member directory</p>"
        self.assertFalse(_is_direct_company_seed(directory, "Industry association member directory", "association.example.org", ["water based flexographic inks"]))

    def test_reviewed_company_seed_uses_stable_company_identity(self):
        self.assertEqual(
            _reviewed_seed_company_name("https://www.kingentaglobal.com/polymer-coated-controlled-release-fertilizer-crf-technology/"),
            "Kingenta Global",
        )
        self.assertEqual(_reviewed_seed_company_name("https://locations.th.simplot.com/example"), "J.R. Simplot Company")
        self.assertIsNone(_reviewed_seed_company_name("https://association.example.org/members"))
        self.assertEqual(_reviewed_seed_profile("https://uregold.com/")["reviewed_role"], "chemistry_mismatch")
        self.assertEqual(_reviewed_seed_profile("https://www.lebanonturf.com/technologies/pcu")["reviewed_role"], "indirect_user")

    def test_official_contact_fields_ignore_www_and_form_noise(self):
        self.assertTrue(_same_site_domain("apac@kingentaglobal.com".split("@", 1)[1], "www.kingentaglobal.com"))
        self.assertTrue(_same_site_domain("lebanonturf.com", "www.lebanonturf.com"))
        self.assertFalse(_same_site_domain("gmail.com", "www.lebanonturf.com"))
        noisy = "Email Address ConfirmEmail Phone My Comment or Question is About General Products Address 1600 E. Cumberland St. Lebanon PA 17042 Phone 1-800-233-0628 Email customerservice@lebanonturf.com"
        self.assertEqual(_address_excerpt(noisy), "1600 E. Cumberland St. Lebanon PA 17042")
        self.assertIsNone(_address_excerpt("Address direct demand candidate production manufacturer"))

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

    def test_crawler_source_labels_are_valid_customer_lead_source_types(self):
        self.assertEqual(_customer_lead_source_type("自定义公开目录"), "行业目录")
        self.assertEqual(_customer_lead_source_type("印度肥料协会公开会员目录"), "协会目录")
        self.assertEqual(_customer_lead_source_type("已核验肥料制造商官网种子"), "官网")

    def test_nl_fc_pu_queries_and_evidence_score_are_deterministic(self):
        queries = nl_fc_pu_queries()
        self.assertTrue(any('controlled release urea' in query[0] for query in queries))
        self.assertTrue(any(query[1] == 'maps' for query in queries))
        self.assertIn('fertilizante revestido', nl_fc_pu_application_terms())
        score = score_lead(target_country='Brazil', lead_country='Brazil', evidence_roles={'应用或产品', '客户身份', '近期活动'}, has_official_website=True, has_public_contact=True, duplicate=False, rejected=False)
        self.assertEqual(score.score, 100)
        self.assertEqual(canonical_domain('https://www.example.com/contact'), 'example.com')
        self.assertFalse(public_http_url('http://192.168.1.5/private'))

    def test_development_draft_is_review_length_and_evidence_bound(self):
        subject, body = draft_email(company_name='Example Fertilizantes', company_fact='it manufactures controlled-release fertilizer.', product_claim='a coating material intended for controlled-release fertilizer granules and coated-fertilizer processes, subject to technical confirmation.')
        self.assertIn('Example Fertilizantes', subject)
        self.assertGreaterEqual(len(body.split()), 80)
        self.assertLessEqual(len(body.split()), 130)

    def test_tds_application_extraction_requires_an_explicit_use_marker(self):
        applications = extract_explicit_applications([
            "Product name: Internal Grade X\nApplications: controlled release fertilizer coating; coated urea.\nStorage: keep dry.",
            "This material has good appearance.\nNo application declaration on this page.",
        ])
        self.assertTrue(applications)
        self.assertTrue(all(item["evidence_status"] == "TDS明确" for item in applications))
        self.assertFalse(any("Internal Grade X" == item["application_name"] for item in applications))
        terms = application_search_terms({"application_name": "coated urea", "target_company_types": ["manufacturer"]}, "Brazil")
        self.assertTrue(all("Internal Grade X" not in item for item in terms))

    def test_builtin_tds_presets_are_source_bound_and_search_by_application(self):
        self.assertEqual(len(BUILTIN_TDS_PRESETS), 3)
        self.assertEqual([item["application_count"] for item in builtin_tds_preset_summaries()], [4, 4, 4])
        for preset in BUILTIN_TDS_PRESETS.values():
            self.assertEqual(len(preset["content_sha256"]), 64)
            self.assertTrue(preset["applications"])
            for application in preset["applications"]:
                self.assertEqual(application["evidence_status"], "TDS明确")
                self.assertTrue(application["evidence_excerpt"])
                self.assertTrue(application["target_company_types"])
                self.assertTrue(application["official_business_evidence"])
                self.assertFalse(any("NL-W1201" in term for term in application["search_terms"]))
        elo_terms = " ".join(
            term for item in BUILTIN_TDS_PRESETS["epoxidized-linseed-oil"]["applications"]
            for term in item["search_terms"]
        ).casefold()
        self.assertNotIn("pvc", elo_terms)

    def test_bootstrap_builtin_tds_preserves_existing_application_edits(self):
        from unittest.mock import patch

        calls = []
        existing_application = {
            "id": "application-1", "tds_document_id": "document-1",
            "application_name": "未处理 PP 基材的水性涂层底涂与附着力促进",
            "selected": True, "description": "用户已编辑",
        }

        async def fake_supabase(path, token, method="GET", payload=None):
            calls.append((path, method, payload))
            if path.startswith("tds_documents?content_sha256="):
                return [{"id": "document-1", "original_file_name": "existing.pdf"}]
            if path.startswith("tds_applications?tds_document_id=eq.document-1"):
                return [existing_application]
            if path == "tds_applications" and method == "POST":
                return [{"id": f"application-{len(calls)}", **payload}]
            raise AssertionError((path, method, payload))

        with patch("app.main.supabase", fake_supabase):
            result = asyncio.run(bootstrap_tds_preset("nl-w1201", "Bearer test"))
        self.assertTrue(result["reused"])
        self.assertEqual(result["applications"][0]["description"], "用户已编辑")
        inserted = [payload for _, method, payload in calls if method == "POST"]
        self.assertEqual(len(inserted), 3)
        self.assertTrue(all(payload["selected"] is False for payload in inserted))

    def test_application_task_profile_uses_applications_not_product_grade(self):
        applications, company_types, exclusions = application_task_profile({"application_snapshot": [{
            "application_name": "water-based ink for BOPP film",
            "substrate_or_object": "BOPP packaging film",
            "material_function": "adhesion promoter",
            "search_terms": ["water based flexographic ink manufacturer"],
            "local_search_terms": ["fabricante tinta flexográfica base água"],
            "target_company_types": ["ink manufacturer", "flexible packaging converter"],
            "exclusion_notes": "exclude resin suppliers",
        }]})
        self.assertIn("water-based ink for BOPP film", applications)
        self.assertIn("water based flexographic ink manufacturer", applications)
        self.assertIn("fabricante tinta flexográfica base água", applications)
        self.assertIn("ink manufacturer", company_types)
        self.assertEqual(exclusions, ["exclude resin suppliers"])
        self.assertFalse(any("NL-" in value for value in applications))

    def test_application_match_remains_pending_without_process_proof(self):
        status, reason, pending = application_match_status({
            "lead_layer": "直接需求候选",
            "discovered_application_keywords": ["coated urea"],
            "product_evidence_summary": "Official product page lists coated urea.",
        }, {"application_name": "coated urea", "description": "controlled-release fertilizer"})
        self.assertEqual(status, "应用相关但工艺未知")
        self.assertIn("Official product page", reason)
        self.assertIn("人工确认", pending)

        translated_status, _, _ = application_match_status({
            "lead_layer": "直接需求候选",
            "discovered_application_keywords": ["controlled release fertilizer"],
            "product_evidence_summary": "Official product page lists controlled release fertilizer.",
        }, {
            "application_name": "缓释肥包膜生产",
            "search_terms": ["controlled release fertilizer manufacturer"],
        })
        self.assertEqual(translated_status, "应用相关但工艺未知")

    def test_application_provider_can_use_curated_public_directories(self):
        from unittest.mock import patch

        async def fake_supabase(path, token, method="GET", payload=None):
            if path.startswith("crawl_sources?"):
                return []
            raise AssertionError(path)

        task = {"application_snapshot": [{"application_name": "controlled release fertilizer coating", "target_company_types": ["fertilizer manufacturer"]}]}
        with patch("app.main.supabase", fake_supabase):
            provider, notice = asyncio.run(application_discovery_provider("Bearer test", None, task))
        self.assertEqual(provider, "内置公开行业目录纯爬虫")
        self.assertIn("公开入口", notice)

    def test_application_provider_uses_builtin_card_search_terms(self):
        from unittest.mock import patch

        async def fake_supabase(path, token, method="GET", payload=None):
            if path.startswith("crawl_sources?"):
                return []
            raise AssertionError(path)

        task = {"application_snapshot": [{
            "application_name": "缓释肥与控释肥的喷涂包膜生产",
            "search_terms": ["controlled release fertilizer", "fertilizer coating"],
            "target_company_types": ["缓释肥制造商"],
        }]}
        with patch("app.main.supabase", fake_supabase):
            provider, notice = asyncio.run(application_discovery_provider("Bearer test", None, task))
        self.assertEqual(provider, "内置公开行业目录纯爬虫")
        self.assertIn("10 个", notice)

    def test_curated_sources_keep_fertilizer_out_of_generic_coating_directories(self):
        fertilizer = _curated_seed_urls({"application_keywords": ["fertilizer coating", "controlled release fertilizer"]})
        self.assertGreaterEqual(len(fertilizer), 10)
        self.assertFalse(any("油墨" in label or "胶黏剂" in label for _, label in fertilizer))
        self.assertTrue(any("alliednutrients.com" in url for url, _ in fertilizer))
        elo = _curated_seed_urls({"application_keywords": ["polymer compound", "industrial coating", "adhesive", "sealant", "printing ink"]})
        labels = [label for _, label in elo]
        self.assertTrue(any("油墨" in label for label in labels))
        self.assertTrue(any("胶黏剂" in label for label in labels))
        self.assertFalse(any("肥料" in label for label in labels))


if __name__ == "__main__":
    unittest.main()
