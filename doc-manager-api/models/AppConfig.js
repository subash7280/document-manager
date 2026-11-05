import mongoose from 'mongoose';

// ==================================================================
// APPLICATION CONFIG - collection "application_configs"
// ONE document with settings that can be changed in the database
// without redeploying the app, e.g.:
//   {
//     app_name: "Document Manager",
//     exception_mail: ["admin@example.com", "dev@example.com"]
//   }
// app_name       -> shown in exception email subjects
// exception_mail -> who receives an email when something fails
//                   unexpectedly (see notifications/exceptions.js)
// The field names are snake_case on purpose: they match the document
// people add by hand (Compass, mongosh, `npm run seed-config`).
// strict: false keeps any extra fields someone adds later.
// ==================================================================
const appConfigSchema = new mongoose.Schema({
  app_name: String,
  exception_mail: [String]
}, { collection: 'application_configs', strict: false, versionKey: false });

const AppConfig = mongoose.model('AppConfig', appConfigSchema);

export default AppConfig;
