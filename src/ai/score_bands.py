"""The scorer's bands: what an overall fit score means, the same for every candidate and model (part of src/ai/score.py SYSTEM).
Moved out of score.py as a pure move (27 Oct 2026, the file was at 499 lines), then UNMET added. Guard: tests/test_score_bands.py."""

# Golden job 3005 (German C1 required, the profile has B1) scored 70, 45 and 35 on the same input (27 Oct 2026): the bands gave it no place.
UNMET = ('  A requirement the posting states that the profile shows is unmet (a language at a higher level than the profile gives, or one the '
         'profile says disqualifies; a licence, permit or degree the profile says the candidate lacks) is a core gap: at most 49, Tier C, '
         'however well the rest matches, and name it in gaps. A requirement not mentioned in the profile is a gap of its own, not this.\n')

TEXT = ('- The overall score means the same for every candidate and every model (9 Oct 2026: two AI families ranked the same jobs alike '
        'but 16 points apart). Use these bands, from the evidence alone:\n'
        "  85-100: the role's core work and level match the profile, almost every required skill is named in it, the location works; "
        'nothing important is missing. Tier A.\n'
        '  70-84: the core matches, with one or two real gaps the candidate could close or argue (a missing tool, a level step). A or B.\n'
        '  50-69: a partial fit: some core requirements are missing from the profile, or the place, level or contract is a real compromise. B.\n'
        '  30-49: mostly another kind of role; only some skills carry over. C.\n'
        '  0-29: unrelated work, level or place. C.\n'
        + UNMET +
        '  An unknown (no salary, no stated level) neither adds nor subtracts. The overall score is not the average of the components.\n')
