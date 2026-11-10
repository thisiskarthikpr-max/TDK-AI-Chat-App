import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { connectDatabase } from './config/database.js';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const port = Number(process.env.PORT ?? 4000);

try {
  await connectDatabase(process.env.MONGO_URI);
  const app = createApp();

  app.listen(port, () => {
    console.log(`API listening on port ${port}`);
  });
} catch (error) {
  console.error('Unable to start API:', error.message);
  process.exit(1);
}
