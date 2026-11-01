// A search draft's roles as the app keeps them: one list, target_roles (21 Oct 2026, 8c8bd70), from which role_keywords are derived on every save.
// Every e2e suite that writes role_keywords goes through withRoles; desktop/e2e/test/search-roles.test.mjs fails for one that does not.
import {view as viewRoles} from '../../lib/target-roles.js';

export const withRoles = (search, fragments) => ({...search, role_keywords: fragments, jobs_board_search_queries: [], target_roles: viewRoles({role_keywords: fragments})});
