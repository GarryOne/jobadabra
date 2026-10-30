// Engine answer identities, validation and recording for the visit question family.
import {familyTests} from './ai-answers-engine-fixtures.mjs';
familyTests(["visit"]);

import {contextCase} from './ai-answers-engine-fixtures.mjs';
contextCase('visit', body => { body.system[0].text = body.system[0].text.replace('When unsure, keep it.', 'When unsure, leave it out.'); });
contextCase('visit', body => { body.messages[0].content = body.messages[0].content.replace('fixture list', 'another list'); });
