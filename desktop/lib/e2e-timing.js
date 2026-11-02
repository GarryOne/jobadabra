// Waits the end-to-end journey may shorten so a test does not sit through them (never for a user): JOBADABRA_E2E_<NAME> in milliseconds, only with JOBADABRA_E2E set.
export const e2eMs = (name, fallback, env = process.env) => (env.JOBADABRA_E2E ? Number(env[`JOBADABRA_E2E_${name}`]) || fallback : fallback);
