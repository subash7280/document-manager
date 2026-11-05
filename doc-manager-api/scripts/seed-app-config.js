// ==================================================================
// CREATE THE application_configs DOCUMENT
//   npm run seed-config
// Adds the settings document if the collection is empty. If one already
// exists it is left alone and simply printed, so running this twice is
// safe. Edit the values below (or the document in MongoDB Compass)
// to change the app name or who receives exception emails.
// ==================================================================
import mongoose from 'mongoose';
import { config } from '../config.js';
import AppConfig from '../models/AppConfig.js';

const DEFAULTS = {
  app_name: 'Document Manager',
  exception_mail: ['subash.e@spantechnologyservices.com']
};

if (!config.mongoUri) {
  console.error('MONGO_URI is not set. Add it to doc-manager-api/.env');
  process.exit(1);
}

await mongoose.connect(config.mongoUri);
try {
  const existing = await AppConfig.findOne().lean();
  if (existing) {
    console.log('application_configs already has a document (left unchanged):');
    console.log(existing);
  } else {
    const created = await AppConfig.create(DEFAULTS);
    console.log('Created the application_configs document:');
    console.log(created.toObject());
  }
} finally {
  await mongoose.disconnect();
}
