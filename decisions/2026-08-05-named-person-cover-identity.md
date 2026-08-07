---
date: 2026-08-05
scope: project
status: active
source: manual
---

# Prefer contextual imagery and keep verified portraits as the penultimate fallback

## Decision

Naming a real person in the two-line title does not make that person's face the
default cover. DIEM first searches for rights-cleared, person-free imagery of the
reported event, institution, place, document, product, or object. A verified
portrait is only the last photographic fallback before project-owned typography.

Generic stock images whose provider metadata identifies a person are never
accepted as a substitute, even when occupation, age, nationality, or setting
seems relevant. Every context photo additionally needs affirmative building,
document, place, product, object, or landscape metadata; missing metadata fails
closed to the next image or typography.
If a portrait is used, identity must be traceable from an exact Korean Wikipedia
person page to a freely licensed Wikimedia Commons file, or from equally strict
official metadata. If neither contextual imagery nor a verified portrait is
available, DIEM uses topic-grounded typography rather than an unrelated person.

## Context and constraints

Keyword overlap only proves that a photo is about a similar setting. It does not
prove that a depicted person is the named subject, and showing the correct face
can still add avoidable reputational risk or over-personalize an institutional
story. A presidential policy story may be represented more accurately by the
relevant presidential office, briefing setting, document, or policy object.

A Park Hyung-gyu article was paired with unrelated classroom models. That failure
shows that the hard boundary is not “find the right-looking person,” but “never
publish an unverified person.” The project also requires reusable licensing
metadata and cannot rely on scraped press photos without explicit reuse rights.

## Alternatives considered

- Search the named person's portrait first — rejected because it creates needless
  identity and repetition risk when a truthful contextual image exists.
- Accept high-scoring Pexels or Unsplash portraits — rejected because model
  identity is unknown even when occupation, race, age, or setting appears similar.
- Reject the article when no portrait exists — rejected because a person-free
  contextual image or topic-grounded typography can report the event truthfully.

## Revisit when

Automated person detection produces unacceptable false positives, or a
rights-cleared contextual-image provider makes a different hierarchy materially
safer without adding paid infrastructure.
