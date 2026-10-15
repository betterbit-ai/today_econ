# Bind embedding rows to the exact hydrated query

The planner precomputed similarity from ranking headlines, then applied the
same row after body hydration changed the article signature. For the actual
YTN index-crash article (052/0002419090), the preliminary query
`economy | 코스피` scored 0.801856 against an October 11 NISA article.
The hydrated `economy | 코스피 | 증시 변동` scored 0.726894 and correctly
remained a distinct event under the unchanged thresholds.

Reuse scores only when their query equals the current signature. Otherwise
compute the current query. Preserve matched publication, score, and signature
for rejected candidates. Cached row position alone does not establish query
identity. PR #172 includes regression tests for both false positive and false
negative stale-cache outcomes.
