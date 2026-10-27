// The canonical writing-preferences section shared by the Profile editor and the automatic saved-line organizer.
export const STYLE_HEADING = 'Cover letter style';
/** Recognize the app's own section heading, never the meaning of an applicant's line. */
export const isStyle = title => /^cover letter style$/i.test(String(title || '').replace(/^[^\p{L}\p{N}]+/u, '').trim());
