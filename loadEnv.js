import dotenv from 'dotenv';
import path from 'path';
import os from 'os';

const envPath = process.env.ENV_PATH ?? path.join(os.homedir(), 'Documents', 'github_cloud', 'module_api_key', '.env');
dotenv.config({ path: envPath });
