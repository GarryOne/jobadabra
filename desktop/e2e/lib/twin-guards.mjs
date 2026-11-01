// The live-test twin driver's safety rules (e2e/twin-drive.mjs), with no browser imports so desktop tests can check them in CI.
// A form's own Submit (any language) is never pressed by a script; our panel's buttons (in a jobadabra shadow root) are ours.
// Job: run the backbone
export const looksLikeSubmit = (text, inOurPanel = false) => !inOurPanel && /\bsubmit\b|envoyer|soumettre|absenden|abschicken|inviare|enviar|verzenden/i.test(String(text || ''));
