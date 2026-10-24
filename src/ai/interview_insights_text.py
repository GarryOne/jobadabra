"""Interview insights' constants and its one AI call's words: limits, categories, the pattern kinds, DATA_VERSION, the output schema and the system prompt.
Guarded by tests/test_interview_insights.py (and its siblings)."""



CATEGORY = 'Interview patterns'
BASIS = 'Interviews'
MIN_SUPPORT = 2  # interviews a pattern needs before it is stated as a pattern
ROUND_TYPES = ('Recruiter screen', 'Technical', 'Hiring manager', 'Other')
REVIEW_SECTIONS = {'Strengths': 'strengths', 'Weak spots': 'weak_spots', 'Practise before the next round': 'practice',
                   'Signals from them': 'signals', 'Could count against you': 'against'}
MAX_REVIEW_CHARS = 8000
# The transcripts of the newest interviews, so a pattern can be checked against what was said (owner, 30 Sep 2026). A 30-minute
# call is ~25k characters; the budget keeps a refresh around $0.05-0.08 with Sonnet. Older ones: their review only.
TRANSCRIPT_CHARS = 30000
TRANSCRIPT_BUDGET = 75000


KINDS = ('weakness', 'strength', 'note')  # the icon of a pattern on the card
# 2 = the redesigned card's words (titles, kinds, keyword lines, the banner sentence). A saved insight of an older version is
# regenerated once on Refresh even when no review changed, so it fills them in.
DATA_VERSION = 6  # 6 = one moment backs one pattern, three kinds of gap, strengths kept, "you" (30 Sep 2026)

SCHEMA = {
    'type': 'object', 'additionalProperties': False,
    'required': ['nothing_useful', 'headline', 'headline_detail', 'patterns', 'next_steps', 'confidence'],
    'properties': {
        'nothing_useful': {'type': 'boolean', 'description': 'true only when the reviews give nothing to conclude or act on'},
        'headline': {'type': 'string', 'description': 'One sentence, max 120 characters: the most useful conclusion'},
        'headline_detail': {'type': 'string', 'description': 'One sentence, max 120 characters, under the headline: what the same pattern covered ("The same pattern appeared in tenure and unblocking questions"); "" when there is nothing to add'},
        'patterns': {'type': 'array', 'description': '0-4 patterns, most useful first', 'items': {
            'type': 'object', 'additionalProperties': False, 'required': ['round_type', 'title', 'kind', 'pattern', 'evidence'],
            'properties': {
                'round_type': {'type': 'string', 'enum': list(ROUND_TYPES) + ['All']},
                'title': {'type': 'string', 'description': 'The recurring behaviour in plain words, max 55 characters: what the candidate does and when ("Answers stay general when asked for a named example", "Rambles on questions about their own choices"); never a vague label like "gaps in specifics" or "soft-skill issues", and not one topic ("can\'t name IoT protocols")'},
                'kind': {'type': 'string', 'enum': list(KINDS), 'description': 'weakness = something that costs you; strength = something that lands well; note = anything else'},
                'pattern': {'type': 'string', 'description': 'One or two short sentences, max 200 characters, with at least two concrete instances from different interviews: what was asked and what was missing, in the reviews\' words ("IoT protocols (Zephyr), AWS certification (Huxley)")'},
                'evidence': {'type': 'array', 'items': {
                    'type': 'object', 'additionalProperties': False, 'required': ['interview', 'quote'],
                    'properties': {'interview': {'type': 'string', 'description': 'The label, e.g. "I2"'},
                                   'quote': {'type': 'string', 'description': 'Words copied exactly from that interview\'s review, at most 25 words'}}}},
            }}},
        'next_steps': {'type': 'array', 'description': '1-3 concrete things to do before the next interview', 'items': {
            'type': 'object', 'additionalProperties': False, 'required': ['action', 'title', 'focus', 'interviews'],
            'properties': {'action': {'type': 'string', 'description': 'max 140 characters'},
                           'title': {'type': 'string', 'description': 'What to do, naming the concrete thing, max 55 characters ("Learn the IoT protocol basics"; not "Close the gaps")'},
                           'focus': {'type': 'string', 'description': 'The concrete topics from the reviews, 2-4 short keywords joined by " • ", max 70 characters ("MQTT • CoAP • AWS certification"); "" if none'},
                           'interviews': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Labels it comes from'}}}},
        'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
    },
}

SYSTEM = f"""You read the candidate's own interview reviews (made by Jobadabra from their interviews) and say what \
they show together, so the next interview goes better. You get the reviews grouped by round type (recruiter screen, \
technical, hiring manager, other); each interview has a label (I1, I2…).

Rules:
- Only what the reviews say. Never invent interviews, questions, companies, numbers or feedback.
- Every piece of evidence copies words exactly from that interview's review (summary, strengths, weak spots, practice, \
signals, weak answers, topics, next step) and names its label. No paraphrased quotes.
- A pattern needs at least {MIN_SUPPORT} different interviews behind it. With fewer, write it as an observation from \
that one interview ("In I1, …"), not as something that keeps happening.
- Keep round types apart: don't draw one conclusion from a recruiter screen and a technical round together unless \
the same thing clearly shows in both; set round_type to the group it comes from ("All" only then).
- next_steps: 1-3 concrete things to practise or prepare before the next interview, each citing the interviews it comes from.
- A pattern is a behaviour that recurs across interviews, said plainly: what the candidate does and when ("Answers stay \
general when asked for a named example"). It is not a single topic ("can't name IoT protocols" is one finding, not a \
pattern) and not a vague label ("gaps in specifics", "technical credentials").
- Name the instances. The concrete topics from the reviews are the evidence: in the detail, name at least two instances from \
different interviews with what was asked and what was missing (IoT protocols in one, an AWS certification in another). \
Use the reviews' own nouns. A behaviour you can't back with named instances from two interviews is dropped: fewer, \
sharper patterns beat generic ones; one interview's single topic is at most an observation ("In I1, …").
- Evidence for a pattern includes a quote from each interview it claims, the sentence that shows the instance. Every \
instance you name belongs to the interview it happened in: check it there before you attribute it.
- Merge only the same behaviour, never the same category: not knowing a protocol, not holding a certification and a \
long-winded answer are three different things, even if all are "about specifics".
- Look first at how the answers met what the interviewer said they need (a client's stated pain points, the role's focus): \
missing that in several interviews is often the most useful pattern.
- When a strength and a weakness touch (honest about a gap vs underselling it), say how to keep the strength.
- Before grouping, sort every weak moment into one of three kinds and never mix them in a pattern: a knowledge gap (asked \
directly and did not know, e.g. could not name IoT protocols), a volunteered gap (offered a limit unprompted), or a delivery \
problem (the answer was long, unstructured, off the question or had no outcome). A gap counts as "without a bridge" only \
if the answer stopped there: check the transcript, and when related experience followed, it is not that pattern.
- Each moment (a question and its answer) backs one pattern only: pick the pattern it shows best.
- Include at least one strength when the reviews show one landing well in more than one interview; it tells the \
candidate what to keep doing.
- Address the candidate as "you" in every sentence, never "he" or "the candidate"
- You also get the transcript of the newest interviews (speech-to-text, so words can be garbled). Use it to check what was \
actually asked and answered; quote it only for a clear, readable sentence. The review stays the main source.
- Each pattern also gets a short title and a kind (weakness / strength / note); each step a short heading and a keyword \
line of the topics to cover; the headline gets one line under it (headline_detail). Same rules: only what the reviews say.
- confidence: low with 1-2 interviews or thin reviews; medium with 3-5 consistent ones; high only with more and consistent evidence.
- If the reviews contain nothing useful to conclude, set nothing_useful=true, say so in the headline, leave the lists empty.
- Direct and specific, like a sharp colleague. No filler, no encouragement, no emojis.
"""
