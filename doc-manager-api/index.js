import mongoose from 'mongoose';
import { config } from './config.js';
import { createApp } from './app.js';
import { createProviders } from './auth/providers.js';
import { getAppConfig } from './services/appConfig.js';
import { startJobs } from './services/jobs/index.js';
import { createMailer } from './services/mailer.js';

// ==================================================================
// START
// Connects to MongoDB first, then starts listening. If the database is
// unreachable the server stops with an error instead of running broken.
// ==================================================================
if (!config.mongoUri) {
  console.error('MONGO_URI is not set. Add it to doc-manager-api/.env');
  process.exit(1);
}

await mongoose.connect(config.mongoUri);
console.log('MongoDB connected');

const providers = createProviders(config);
const enabled = Object.keys(providers);
console.log(`Sign-in providers: ${enabled.length ? enabled.join(', ') : 'none configured (see README)'}`);

const mailer = createMailer(config.smtp);
const appConfig = await getAppConfig();
console.log(`Exception emails: ${!mailer ? 'off (SMTP_HOST not set)' : appConfig.exceptionMail.length
  ? `to ${appConfig.exceptionMail.length} address(es) from application_configs`
  : 'off (no exception_mail in application_configs - run `npm run seed-config`)'}`);

const app = createApp({ config, providers, mailer });
const reportException = app.locals.reportException;

// ------------------------------------------------------------------
// CRASH REPORTS: errors that escaped every try/catch.
//   unhandledRejection -> a forgotten await/catch somewhere: report it
//                         and keep serving.
//   uncaughtException  -> the process is in an unknown state: report
//                         it, then exit so the host (Render) restarts it.
// ------------------------------------------------------------------
process.on('unhandledRejection', (reason) => {
  reportException({ source: 'Server process', action: 'Unhandled promise rejection', error: reason });
});
process.on('uncaughtException', async (err) => {
  console.error(err);
  await Promise.race([
    reportException({ source: 'Server process', action: 'Uncaught exception (the server restarts)', error: err }),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]);
  process.exit(1);
});

app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
  console.log(`App origin (open this in the browser): ${config.appOrigin}`);
  console.log(`Health check: http://localhost:${config.port}/app/health-check`);
  if (!config.isProduction) console.log(`GraphiQL playground (sign in first): ${config.appOrigin}/graphql`);
  startJobs({ config, reportException });
});
