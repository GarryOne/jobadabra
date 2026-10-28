// The files the store on this Mac keeps the person's texts in, in the app's folder (no imports: lib/pipeline-env.js and the
// store both read it, and a cycle through the engine call must not see it uninitialised).
export const TEXT_FILES = {profile: 'profile.md', answers: 'answers.md', knowledge: 'knowledge.md', portrait: 'portrait.md'};
