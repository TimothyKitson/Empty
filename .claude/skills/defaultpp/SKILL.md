---
name: defaultpp
description: The user's default PowerPoint style ("DefaultPP"). A double-wide 32:9 deck with a dark navy background on every slide, big white Cambria titles, big white Calibri text, and an optional photo running full height down one edge. Use this whenever the user asks for a PowerPoint, slides, a presentation, a deck or a .pptx, or wants slides for a school project, history competition, talk or speech, even if they don't say "DefaultPP". Skip it only when they ask for a different look or hand over their own template.
---

# DefaultPP

This is the user's go-to PowerPoint look. They like it simple: a few slides, big readable text and no clutter. When they've asked for something "fancier" before, they ended up saying it was too complicated, so keep it plain unless they ask for more.

## The look

- **Size:** 32:9 double wide (26.667" x 7.5"). This is for a wide screen, so don't fall back to 16:9.
- **Background:** dark navy `1F2433` on every slide.
- **Text:** white on every slide. Titles are bold Cambria and body text is Calibri. Both fonts come from the template's theme.
- **Title slide:** one huge centered title, up to 200pt, filling the slide. If there's a photo, it runs full height down the left edge and the title fills the rest.
- **Content slides:** the title sits top-left at about 60pt. Below it go big bullets (about 48pt) or one indented paragraph (about 54pt). An optional photo can run full height down the right edge.
- **Accent colors** (use rarely, if at all): amber `C47A35` and honey `E8B877`. Both are already in the theme.
- **Avoid:** cards, icons, timelines, color bars, gradients and light backgrounds, unless the user asks for them.

## Content habits

- Aim for about a 5-minute talk: usually 3 to 5 slides. Make only the slides the user asked for. Don't add extra agenda, sources or thank-you slides unless they want them.
- Keep bullets short, about 3 to 8 words each, with at most 5 per slide.
- If the user gives you their own wording, keep their voice. Fix only spelling and obvious errors, and tell them what you changed.
- For school or competition work, double-check dates and facts and mention anything shaky. For example, call out a "Who Was" title when the person may still be alive.
- Speaker notes are fine, but keep them plain.

## How to build it

Write a JSON spec and run the bundled builder. It starts from `assets/template.pptx`, which holds the theme, fonts and 32:9 size. It also sizes the text so nothing overflows.

```bash
python3 <this skill's dir>/scripts/build_deck.py spec.json
```

```json
{
  "output": "Bruce Olson.pptx",
  "title": "Bruce Olson",
  "slides": [
    {"type": "title", "title": "Who Was Bruce Olson?", "photo": "photo.png", "notes": "optional speaker notes"},
    {"type": "bullets", "title": "Fun Facts:", "bullets": ["Born in 1941", "They gave him the name Bruchko"]},
    {"type": "paragraph", "title": "optional title", "text": "A paragraph. Use a newline for a second paragraph."},
    {"type": "bullets", "title": "With a photo", "photo": "photo.png", "bullets": ["Photo runs down the right edge"]}
  ]
}
```

- Slide types are `title`, `bullets` and `paragraph`. `photo` is optional on any slide: it goes on the left for title slides and on the right for the others.
- Paths in the spec resolve against the spec file's folder.
- Add `"size": <pt>` to any slide to set the starting font size. The builder still shrinks text that doesn't fit.
- Name the file after the deck's subject, like `Bruce Olson.pptx`, unless the user picks a name.
- Needs `python-pptx`, `Pillow` and `lxml`. Install them with pip if they're missing.

If the user needs something the builder can't do, open the output in python-pptx and add it by hand. Keep the same colors, fonts and size.

## Check it

Render the deck and look at every slide before handing it over. Check that no text runs off a slide, the photo isn't stretched, and there's no leftover empty placeholder. If the `pptx` skill is available, use its `soffice.py` and `validate.py`. Otherwise run `soffice --headless --convert-to pdf` and `pdftoppm -jpeg`.

## If they want a script to read from

Sometimes the user wants a Word file of what to say. Keep it truly plain: Times New Roman 12pt with no colors, bold, headings styles or borders. Put a plain line like `Slide 1: <slide title>`, then a blank line, then the talk as paragraphs with a first-line indent. Repeat for each slide. Name it after the deck, for example `Bruce Olson.docx`.
