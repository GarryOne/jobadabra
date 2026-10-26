"""Say an answer schema's field descriptions in the prompt itself: some models (Free AI's) read the prompt and skip the schema's descriptions."""


def text(schema):
    """Each described field as "name: description", nested ones as "parent.name", a repeated field (the same name and note) once (E2E quality on Free AI, 26 Oct 2026:
    SRE jobs read as engineering, empty Technologies, a null Growth on a senior role, while each rule sat only in the schema).
    Guard: tests/test_facts_prompt_fields.py."""
    lines, seen = [], set()

    def walk(properties, prefix):
        for name, spec in properties.items():
            note = spec.get('description')
            if note and (name, note) not in seen:   # the same field's note once ("evidence" in every fact); a shared note under two names twice
                seen.add((name, note))
                lines.append(f'{prefix}{name}: {note}')
            inner = spec.get('properties') or (spec.get('items') or {}).get('properties')
            if inner:
                walk(inner, f'{prefix}{name}.')

    walk(schema['properties'], '')
    return '\n'.join(lines)
