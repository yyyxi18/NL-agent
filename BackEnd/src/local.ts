import { app } from './app';
import { env } from './config/env';

app.listen(env.port, () => {
  console.info(`NL-agent API listening on port ${env.port}`);
});
