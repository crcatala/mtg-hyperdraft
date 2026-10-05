---
id: mh-yv08
status: open
deps: [mh-n7y8]
links: []
created: 2026-10-05T03:45:30Z
type: task
priority: 4
assignee: cc-vps
parent: mh-uwgh
tags: [companions, art, stretch]
---
# Deferred: expression frames for companions (eyes closed, angry, happy mouth)

Part of epic mh-uwgh (decision D10 deliberately defers this). Only revisit if procedural motion alone feels too flat after the animation lab review.

## Why
Single-image companions can't change expression. 2-3 extra frames per companion (e.g. eyes closed/happy, angry, surprised) swapped during reactions would add a lot of life, but cost 20-30 generated images that must stay visually consistent with the existing art.

## Work (sketch)
Use the image-gen skill's edit mode on public/roster/companions/<id>.webp to produce 2-3 frames per companion with the same pose/silhouette/background-free output, then let reactions reference a `face` frame in the animation engine. Evaluate consistency on 2 companions first (e.g. Hex and Gloop) before committing to all 10.

## Acceptance Criteria

- A 2-companion pilot is shown to the human with a go/no-go before generating the rest.
- If go: all companions have the agreed frames, the engine can swap frames per reaction, and bundle size growth is reported.

