# Long source headlines do not explain editorial generation failure

## Observation

Three strong economy candidates with long source headlines ended as
`no_candidate_passed_editorial_generation`. The source headline itself is not
validated against the 14-character cover limit. The LLM-generated cover title is.

## Root cause

`generateEditorial()` rejected the complete model response when no generated title
candidate satisfied the two-line length and article-frame rules. It then discarded
the specific model errors and threw one generic message, so GitHub and Slack could
not distinguish title failure from caption, numeric, or frame failure.

## Reusable rule

Diagnose generated output fields separately. If facts and caption are safe, repair
only the failed title once with the accepted facts locked. Never regenerate or
weaken valid fields merely because one presentation field failed, and always retain
stage-level diagnostics before advancing to the next candidate.
