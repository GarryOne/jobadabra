// The real-sized Free AI form set: the questions real application forms asked (labels and field types taken from the pool's recorded runs, in their own language), grouped as small forms, each
// with what the demo applicant's profile says is right. Only labels and types come from the recordings; options are invented, answers never come from anyone's real data (tools/free-ai-form-cases.mjs builds the requests).
// A field is [label, type, options|null, expect]. expect: {v:[accepted values]}, {empty:true}, {m:'regex'}, plus {cat:'category'}; {within:true} = any answer must be one of the options exactly (empty is fine).
const YN = ['Yes', 'No'], JN = ['Ja', 'Nein'], OUI = ['Oui', 'Non'];
const SOFTNO = {v: ['No', 'Nein'], maybeEmpty: true};
const NO = {v: ['No']}, YES = {v: ['Yes']}, LEGAL = {empty: true, cat: 'legal'}, CONSENT = {v: ['checked'], cat: 'consent'}, DEMO = {empty: true, cat: 'demographic'}, OWN = {empty: true}, FREE = {within: true};
const DECLINE = (...extra) => ({v: ['Decline to self-identify', 'Prefer not to say', 'I do not wish to answer', ...extra], cat: 'demographic'});

export const FORMS = [
  // Work authorisation, sponsorship, location: knockouts
  ['sponsor-us', [['Will you now or in the future require sponsorship for employment visa status?', 'radio', YN, NO]]],
  ['sponsor-combobox', [['Do you now or in the future require visa sponsorship?', 'combobox', ['Yes', 'No', 'Not sure'], NO]]],
  ['right-to-work', [['Do you have the right to work in the country you are applying in?', 'combobox', ['Yes', 'No'], YES]]],
  ['eu-citizen', [['Do you have EU citizenship or a valid work permit', 'radio', YN, YES]]],
  ['eu-efta-de', [['Sind Sie EU/EFTA/CH Staatsbürger(in)? (Erforderlich)', 'radio', JN, {v: ['Ja']}]]],
  ['permit-fr', [['Avez-vous un permis de travail pour exercer dans le pays ?', 'select', ['Oui', 'Non'], {v: ['Oui']}]]],
  ['work-fr-ashby', [['Avez-vous le droit de travailler en France ?', 'radio', OUI, {v: ['Oui']}]]],
  ['legally-authorised', [['Are you legally authorised to work full-time in the country of the role?', 'combobox', YN, YES]]],
  ['hybrid-office', [['Are you willing and able to work from our Utrecht office three days a week?', 'radio', YN, FREE]]],
  ['based-sydney', [['Are you based in Sydney, Australia?', 'radio', YN, {v: ['No']}]]],
  ['us-person', [['Please indicate whether you are a “U.S. person”.', 'combobox', ['Yes, I am a U.S. person', 'No, I am not a U.S. person'], {v: ['No, I am not a U.S. person']}]]],
  ['clearance', [['This role may require security clearance. Are you able to obtain one?', 'combobox', ['Yes', 'No', 'Not sure'], OWN]]],
  ['location-list', [['In what location(s) are you available to work?', 'combobox', ['Zurich, Switzerland', 'London, UK', 'Berlin, Germany', 'Remote'], {within: true, v: ['Zurich, Switzerland', 'Remote']}]]],
  // Place and availability
  ['country', [['Country', 'combobox', ['Germany', 'Switzerland', 'United Kingdom', 'United States'], {v: ['Switzerland']}]]],
  ['country-de', [['Land', 'select', ['Deutschland', 'Österreich', 'Schweiz', 'Frankreich'], {v: ['Schweiz']}]]],
  ['city', [['Where do you live? (City)', 'text', null, {m: 'zurich|zürich', maybeEmpty: true}]]],
  ['location-fr', [['Quelle est votre localisation ? (Région seulement)', 'text', null, {m: 'zurich|zürich|suisse|switzerland', maybeEmpty: true}]]],
  ['notice', [['What is your current notice period?', 'textarea', null, {m: '2 months|two months|8 weeks'}]]],
  ['start-de', [['Verfügbar ab', 'text', null, {m: '2 monat|zwei monat|2 months|8 woch'}]]],
  // Why (27 Oct 2026, consent proof): demo Profile says 2 months, Answers says 3; retain the French inputs but require a proposal instead of choosing a conflicting fact.
  ['available-fr', [['Disponibilité', 'select', ['Immédiate', 'Dans 1 mois', 'Dans 2 mois', 'Dans 3 mois', 'Plus de 3 mois'], {v: ['Dans 2 mois', 'Dans 3 mois'], use: 'propose', single: true}]]],
  // Money
  ['salary-gross-eur', [['What are your salary expectations? (in Euros GROSS per year)', 'text', null, {m: '\\d'}]]],
  ['salary-de', [['Gehaltsvorstellung', 'text', null, {m: '1[34]\\d'}]]],
  ['salary-fr', [['Quelles sont vos attentes salariales ?', 'text', null, {m: '1[34]\\d'}]]],
  // Languages
  ['german', [['Deutschkenntnisse', 'select', ['Keine', 'Grundkenntnisse', 'B1', 'B2', 'C1', 'Muttersprache'], {v: ['B1']}]]],
  ['english-fr', [["Niveau d'anglais (Obligatoire)", 'select', ['Débutant', 'Intermédiaire', 'Courant', 'Bilingue'], {v: ['Courant', 'Bilingue']}]]],
  ['english-proficiency', [['What is your English proficiency level?', 'combobox', ['A2', 'B1', 'B2', 'C1', 'C2 / native'], {v: ['C1', 'C2 / native']}]]],
  ['languages-multi', [['Please select all the languages you speak fluently', 'combobox', ['English', 'German', 'French', 'Spanish', 'Italian'], {within: true, v: ['English', 'Spanish', 'English, Spanish']}]]],
  ['english-tomorrow', [['Êtes-vous capable de travailler en anglais demain ?', 'radio', OUI, {v: ['Oui']}]]],
  // Experience
  ['years-aws', [['How many years of experience do you have with AWS?', 'text', null, {m: '^[5-9]|^8'}]]],
  ['years-select-fr', [["Nombre d'années d'expérience (Obligatoire)", 'select', ['0-2 ans', '3-5 ans', '6-10 ans', 'Plus de 10 ans'], {v: ['6-10 ans']}]]],
  // Facts only the applicant knows
  ['criminal-record', [['Have you been convicted of any criminal offences?', 'radio', YN, OWN]]],
  ['dismissed', [['Have you been dismissed from any employment in the last 5 years?', 'radio', YN, OWN]]],
  ['adjustments', [['Do you need any reasonable adjustments for the recruitment process?', 'textarea', null, OWN]]],
  ['former-employee', [['Have you ever been employed by Richemont or any of its companies?', 'radio', YN, SOFTNO]]],
  ['relatives', [['Do you have any first-degree relatives (spouse, parent, child) working at the company?', 'combobox', YN, SOFTNO]]],
  ['referred', [['Wurde dir die Stelle von eine*r Mitarbeiter*in empfohlen?', 'text', null, SOFTNO]]],
  // Contact and identity
  ['name-two', [['Votre Prénom', 'text', null, {v: ['Alex'], cat: 'contact'}], ['Votre Nom de famille', 'text', null, {v: ['Morgan'], cat: 'contact'}]]],
  ['name-full', [['Full name', 'text', null, {v: ['Alex Morgan'], cat: 'contact'}]]],
  ['name-given', [['Given Name(s)', 'text', null, {v: ['Alex'], cat: 'contact'}], ['Family Name', 'text', null, {v: ['Morgan'], cat: 'contact'}]]],
  ['email-phone', [['Email address', 'email', null, OWN], ['Phone number', 'tel', null, OWN]]],
  ['address', [['Strasse, Nummer', 'text', null, OWN], ['Postleitzahl (Erforderlich)', 'text', null, OWN]]],
  // Consent meanings are gated by the saved setting; attestations remain personal review.
  ['consent-privacy-en', [['By checking this box, I consent to the company collecting and processing my personal data as described in the Recruitment Privacy Notice.', 'checkbox', null, CONSENT]]],
  ['consent-de', [['Ich habe die Datenschutzerklärung gelesen und akzeptiere sie.', 'checkbox', null, CONSENT]]],
  ['consent-fr', [['Protection des données personnelles (Obligatoire): j’accepte le traitement de mes données.', 'checkbox', null, CONSENT]]],
  ['consent-native', [['Privacy policy for applicants', 'select', ['Choose', 'Acconsento', 'Non acconsento'], {v: ['Acconsento'], cat: 'consent'}]]],
  ['consent-custom-unread-options', [['Privacy policy for applicants', 'combobox', null, {empty: true, cat: 'consent'}]]],
  ['consent-factual-attestation', [['I certify that my qualifications and statements are accurate', 'checkbox', null, LEGAL]]],
  ['data-release-radio', [['Datenfreigabe', 'radio', ['Meine Daten dürfen an andere Unternehmen der Gruppe weitergegeben werden', 'Nicht weitergeben'], LEGAL]]],
  // Demographics: decline, or leave for the person
  ['gender-decline', [['Gender', 'select', ['Male', 'Female', 'Decline to self-identify'], DECLINE()]]],
  ['gender-no-decline', [['What gender do you identify as?', 'radio', ['Woman', 'Man', 'Non-binary'], DEMO]]],
  ['sex-combobox', [['What is your sex?', 'combobox', ['Female', 'Male', 'Prefer not to say'], DECLINE('Prefer not to say')]]],
  ['hispanic', [['Are you Hispanic/Latino?', 'combobox', ['Yes', 'No', 'Decline to self-identify'], DECLINE()]]],
  ['veteran', [['Veteran status', 'select', ['I am a veteran', 'I am not a veteran', 'I do not wish to answer'], DECLINE()]]],
  ['age-range', [['What is your age range?', 'radio', ['Under 30', '30-39', '40-49', '50 or over'], DEMO]]],
  ['salutation-de', [['Anrede (Erforderlich)', 'select', ['Herr', 'Frau', 'Divers'], DEMO]]],
  ['salutation-fr', [['Civilité : Mlle / Mme / M', 'radio', ['Mlle', 'Mme', 'M.'], DEMO]]],
  // Written answers
  ['motivation-fr', [['Quelles sont vos motivations pour rejoindre notre équipe ?', 'text', null, {cat: 'written'}]]],
  ['values', [['Which one of our company values resonates the most with you, and why?', 'text', null, {cat: 'written'}]]],
  ['cover-letter-box', [['Write your cover letter here', 'textarea', null, {cat: 'written'}]]],
  // How did you hear, preferences, mixed
  ['hear-select', [['How did you hear about this job?', 'combobox', ['LinkedIn', 'Company website', 'Job board', 'Referral', 'Other'], FREE]]],
  ['hear-fr', [["Comment avez-vous été informé de cette opportunité ?", 'select', ['Site carrière', 'LinkedIn', 'Cooptation', 'Autre'], FREE]]],
  ['mixed-lever', [['Would you now or at any time require employer sponsorship?', 'textarea', null, {m: '^(no|nein|not)\\b'}], ['Gender', 'select', ['Male', 'Female', 'Decline to self-identify'], DECLINE()], ['I consent to the Talent Privacy Policy given.', 'checkbox', null, CONSENT]]],
  ['mixed-ch', [['Anrede', 'radio', ['Herr', 'Frau'], DEMO], ['Vorname', 'text', null, {v: ['Alex'], cat: 'contact'}], ['Nachname', 'text', null, {v: ['Morgan'], cat: 'contact'}], ['Bitte bestätigen: Ich bin mit der Datenschutzerklärung einverstanden', 'checkbox', null, CONSENT]]],
];
