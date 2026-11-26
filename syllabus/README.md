# Syllabus files

One JSON file per subject: `<board>-<code>.json`. Topic headings are written in our own words from the public syllabus outlines — **not** copied from exam-board documents.

Anything marked `"verify": true` is something Claude wasn't fully sure of (wording, numbering, which tier it belongs to, or whether it's still on the current syllabus). Please check those against the official syllabus PDF on the Cambridge website and delete the flag once confirmed.

## Format

```jsonc
{
  "board": "cambridge",
  "boardName": "Cambridge International",
  "code": "0606",
  "subject": "Additional Mathematics",
  "grading": "A*–E",
  "tiers": null,                 // or ["Core", "Extended"]
  "defaultTier": null,           // or "Extended"
  "notes": "Shown to the tutor as extra context.",
  "sections": [
    {
      "id": "functions",
      "title": "Functions",
      "topics": [
        {
          "id": "functions-basics",
          "title": "Functions",
          "subtopics": ["Domain and range", "..."],   // in both tiers
          "extended": ["..."],                         // optional: Extended tier only
          "tier": "extended",                          // optional: whole topic is Extended only
          "verify": true                               // optional: please check
        }
      ]
    }
  ]
}
```

## Adding a subject

1. Copy an existing file, rename it (e.g. `cambridge-0580.json`) and fill in the topics.
2. Add one line for it in `syllabus/index.ts`.
3. Run `npm test` from the repo root to check it loads.
