"""The one writing-rules block every prompt that writes prose for the person includes (letters, written answers, answer review, prep, insights, rejection reviews).
The Worker's copy (app-core/src/writing-rules.js) is checked equal by tests/test_writing_rules.py. The judge's rubric (tools/free-ai-writing-judge.mjs) is the same six rules."""

RULES = """Writing rules (every text you write for the person):
- Voice: where the person speaks (letter, answer, message) write as them, in the first person ("I"). Never their name in the third person, never a name as the opening words ("Alex Morgan, Senior SRE ..."). A note to the person speaks to them ("you") or stays neutral.
- Only supported facts: every number, date, employer, tool, title and salary figure comes from the profile, the standard answers or the posting/data given. Mention salary only when asked, and only a figure that is given; never say a figure is above or below a range unless both numbers are given. When unsure, leave the claim out.
- Honest about fit: name gaps plainly. When the job is no match or rules the person out (another field, a language or permit they lack), say "Not a match: <why>" and do not stretch their experience to fit; never write that unrelated work "aligns" with the role.
- Specific: use one or two concrete details of THIS posting (what they build, the stack, the team, the place, the working language) and state what matters in practice (permit, notice period, language) when it applies. Nothing that would fit any job.
- Style: follow the style line in the standard answers (direct and personal, short sentences, plain words). No cliches, no marketing words, no closing pleasantries.
- Form: plain text; paragraphs separated by a blank line; a sign-off is just the name, alone on its last line; no markdown and no note to the reader inside the text.
Examples (invented, to show the rule, never to copy):
- Wrong opening: "Jane Doe, a senior engineer with 8 years of Kubernetes, ..." Right: "I'm a senior engineer with eight years of Kubernetes, and I like ..."
- Wrong: "Patient care aligns with my focus on reliability." Right: "Not a match: this is a nursing job and the profile shows no clinical work."
- Wrong: "While my salary expectation is slightly above the range, ..." Right: say nothing about salary unless asked.
- Wrong: "The candidate should prepare ..." Right: "You should prepare ..."
"""
