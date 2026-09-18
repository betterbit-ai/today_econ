---
date: 2026-09-17
scope: project
status: active
source: manual
---

# Use a reviewed visual library instead of daily ChatGPT image file handoff

## Decision

Daily ChatGPT cloud editorial selects a verified local visual-library asset ID
and writes only that text reference into an assisted review package. GitHub
Actions uses the existing committed asset and verifies its integrity before rendering.
OpenAI ImageGen is reserved for human-supervised library replenishment.

## Context and constraints

The ChatGPT cloud runtime generated a real PNG but could not provide that file's
bytes, URL, or file reference to a custom MCP tool. Oracle can safely write
bytes that it receives, but inventing a URL bridge would either require the Mac
to stay on or permit arbitrary remote fetches. The project already owned 43
reviewed 9:16 generated assets across 14 topics. A visually inspected OpenAI
ImageGen asset adds one market-themed variation.

## Alternatives considered

- Daily OpenAI Image API from Oracle | rejected for this phase because it adds
  separate recurring API cost.
- Chrome extraction of ChatGPT's image data URI | rejected because it requires
  the Mac and browser bridge for every run.
- Arbitrary model-supplied image URL download | rejected because it weakens the
  MCP trust boundary and does not solve scheduled runtime access.

## Revisit when

ChatGPT exposes a supported generated-file-to-MCP reference, or the project
approves a separate image API budget after the text-and-library assisted path has
performance evidence.
