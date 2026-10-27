// The cover-letter panel copy by status, shared by rendering and unit tests.
(() => {
  const PROFILE = 'Profile → Cover letter';
  const STATUS_COPY = {
    missing: {title: 'Cover letter needed', reason: 'Create and review a cover letter before applying.', action: `Create in ${PROFILE}`},
    draft: {title: 'Cover letter needs review', reason: 'Review and approve your draft before applying.', action: `Review in ${PROFILE}`},
    invalid: {title: 'Cover letter needs attention', action: `Complete in ${PROFILE}`},
  };
  const DELIVERY_FAILURE = {
    title: 'Cover letter wasn’t kept',
    reason: 'The form did not keep the cover letter. Open its letter control and paste or attach it manually, then check again.',
    action: 'Show on form',
  };

  window.__jobPilottoCoverLetterNotice = (status, rejected = false) => {
    if (rejected) return {...DELIVERY_FAILURE};
    const copy = STATUS_COPY[status?.state] || {
      title: 'Cover letter needs attention',
      action: `Open ${PROFILE}`,
    };
    return {title: copy.title, reason: copy.reason || status?.reason || 'Check your cover letter in Profile before applying.', action: copy.action};
  };
})();
