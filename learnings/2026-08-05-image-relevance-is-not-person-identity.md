---
date: 2026-08-05
category: bug
source: manual
---

# Image relevance cannot establish a person's identity

## Situation

The selector searched broad article text and accepted a classroom photo because
the summary mentioned students and a university. The cover itself named Park
Hyung-gyu, so viewers could reasonably mistake unrelated models for people in
the reported event.

## What we learned

Semantic relevance, visual-role matching, person presence, and identity
verification are different gates. A title naming someone does not require their
face. Event, place, institution, document, or object imagery often carries the
story with less reputational risk. Article-body biographical details must not
generate a replacement visual subject.

## Next time

Search person-free contextual imagery first. Reject generic stock imagery when
an identifiable person is present. Only near the end of the fallback chain may
the exact identity be searched and verified; if that fails, use topic-grounded
typography. Never degrade an identity failure into an unrelated human photograph.
