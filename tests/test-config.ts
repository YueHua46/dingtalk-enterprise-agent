import { loadConfig as loadAppConfig } from '../src/config.js';

export function loadConfig(env: NodeJS.ProcessEnv = {}) {
  return loadAppConfig({ FILE_WORKER_MODE: 'off', ...env });
}
