import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Absolute paths: the API and all scripts read the same configuration.
// Existing process variables take precedence over files.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
