"""Dumps the app's own prose prompts and schemas as JSON for the Free AI writing eval (tools/free-ai-writing-eval.mjs): prep, weekly insight, rejection review, interview review, interview patterns.
Usage: python3 tools/free-ai-writing-prompts.py   (prints {feature: {system, schema}}; the system text ends where the profile is appended)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.ai import insights, insights_text, interview_insights_text, interviews_ai, prep, rejection  # noqa: E402

print(json.dumps({
    'prep': {'system': prep.SYSTEM, 'schema': prep.SCHEMA},
    'weekly': {'system': insights_text.WEEKLY_SYSTEM.format(min_group=insights.MIN_GROUP), 'schema': insights_text.WEEKLY_SCHEMA},
    'rejection': {'system': rejection.SYSTEM, 'schema': rejection.SCHEMA},
    'interview': {'system': interviews_ai.SYSTEM, 'schema': interviews_ai.SCHEMA},   # the call review; the profile is appended
    'patterns': {'system': interview_insights_text.SYSTEM, 'schema': interview_insights_text.SCHEMA},   # the interview insights
}, ensure_ascii=False))
