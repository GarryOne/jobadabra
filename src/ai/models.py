"""The models of the AI steps, as data: three tiers (small, main, big) per family (Claude, OpenAI).

Modules name a tier's model (SMALL_MODEL, MAIN_MODEL, BIG_MODEL: Claude's ids, the contract's reference); an engine of another family maps
it to the same tier there (`for_family`), so no module knows which provider answers. Each tier can be changed without a release: the app
sets JOB_PILOTTO_SMALL_MODEL (Claude) and JOB_PILOTTO_OPENAI_<TIER>_MODEL on this Mac and as variables in the user's Always on repo
(desktop/lib/github.js); an Always on repo runs the engine of the app's own release, which never changes (8 Oct 2026: Haiku 4.5 -> 5.5).
The literals below are only the fallbacks when nothing set them. OpenAI tiers approved by the owner (9 Oct 2026), priced like Claude's:
small gpt-6-luna (= Haiku 5.5), main gpt-6.1-sol (= Sonnet 5.5), big gpt-6.1-sol at high effort (gpt-6-astra costs 2.5x Opus).
"""
import os

SMALL_MODEL = os.getenv('JOB_PILOTTO_SMALL_MODEL') or 'claude-haiku-5-5'
# Main and big read their variables only for the end-to-end journey's and the benchmarks' one-model override (desktop/lib/pipeline-env.js
# sets them from JOB_PILOTTO_MODEL_OVERRIDE; 27 Oct 2026: the job-boards step still ran Sonnet in a Haiku-only benchmark). Users never set them.
MAIN_MODEL = os.getenv('JOB_PILOTTO_MAIN_MODEL') or 'claude-sonnet-5-5'
BIG_MODEL = os.getenv('JOB_PILOTTO_BIG_MODEL') or 'claude-opus-5-5'

# A model id's tier, by its family's naming.
TIER_OF = (('claude-haiku', 'small'), ('claude-sonnet', 'main'), ('claude-opus', 'big'))
OPENAI_DEFAULTS = {'small': 'gpt-6-luna', 'main': 'gpt-6.1-sol', 'big': 'gpt-6.1-sol'}
# The effort a tier runs at in a family when the call names none (big on OpenAI: the main model, thinking harder).
TIER_EFFORT = {('openai', 'big'): 'high'}
FAMILY_PREFIX = {'claude': ('claude-',), 'openai': ('gpt-', 'o1', 'o3', 'o4', 'codex-')}


def tier(model):
    """'small', 'main' or 'big' for a Claude id; None for anything else."""
    return next((name for prefix, name in TIER_OF if str(model).startswith(prefix)), None)


def family_of(model):
    return next((family for family, prefixes in FAMILY_PREFIX.items() if str(model).startswith(prefixes)), None)


def model_for(family, level, env=None):
    env = os.environ if env is None else env
    if family == 'openai':
        return env.get(f'JOB_PILOTTO_OPENAI_{level.upper()}_MODEL') or OPENAI_DEFAULTS[level]
    return {'small': SMALL_MODEL, 'main': MAIN_MODEL, 'big': BIG_MODEL}[level]


def for_family(model, family, effort=None, env=None):
    """(model, effort) for a call that named `model`, on an engine of `family`. A model of that family is kept; another family's maps to
    the same tier (an unknown one to main). The tier's own effort applies only when the call named none."""
    if family_of(model) == family:
        return model, effort
    level = tier(model) or 'main'
    return model_for(family, level, env), effort or TIER_EFFORT.get((family, level))
