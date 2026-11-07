import dotenv from 'dotenv';

// ==================================================================
// CONFIGURATION
// Every setting comes from environment variables (the .env file in
// development). createConfig() is a function so tests can build their
// own configuration without touching process.env.
// ==================================================================
dotenv.config();

export function createConfig(env = process?.env) {
    // The address people open in the browser (the React app). The API is
    // served from the SAME origin (see README "Deployment"), so session
    // cookies are first-party cookies.
    const newURL = new URL(env.APP_ORIGIN || 'http://localhost:5173');
    console.log('newURL :>> ', newURL);
    const appOrigin = newURL.origin;
    console.log('appOrigin :>> ', appOrigin);

    const google = (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
        ?
        {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            issuer: env.GOOGLE_ISSUER || 'https://accounts.google.com',
        }
        :
        null;

    const apple = env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY
        ?
        {
            clientId: env.APPLE_CLIENT_ID, // the "Services ID", e.g. com.example.docs.web
            teamId: env.APPLE_TEAM_ID,
            keyId: env.APPLE_KEY_ID,
            // .env files cannot hold real line breaks, so "\n" is accepted too.
            privateKey: env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            issuer: env.APPLE_ISSUER || 'https://appleid.apple.com',
        }
        :
        null;

    const port = Number(env.PORT) || 5000;

    // Outgoing email (exception reports). Off when SMTP_HOST is empty.
    const smtpPort = Number(env.SMTP_PORT) || 587;
    const smtp = (env.SMTP_HOST)
        ?
        {
            host: env.SMTP_HOST,
            port: smtpPort,
            secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : smtpPort === 465,
            user: env.SMTP_USER || undefined,
            pass: env.SMTP_PASS || undefined,
            from: env.MAIL_FROM || env.SMTP_USER,
        }
        :
        null;

    // Scheduled health check (services/jobs/index.js). Render sets
    // RENDER_EXTERNAL_URL (the service's public https address) by itself.
    const publicApiUrl = (env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/+$/, '');
    const keepAlive = {
        enabled: env.KEEP_ALIVE_ENABLED !== 'false',
        intervalMinutes: Math.max(5, (Number(env.KEEP_ALIVE_INTERVAL_MINUTES) || 8 * 60)),
        url: env.KEEP_ALIVE_URL || `${publicApiUrl}/app/health-check`,
    };

    return {
        isProduction: env.NODE_ENV === 'production',
        port,
        mongoUri: env.MONGO_URI,
        appOrigin,
        // Browsers only keep "Secure" cookies on https (and localhost).
        secureCookies: appOrigin.startsWith('https://'),
        // Number of reverse proxies in front of the API (Netlify, Render,
        // nginx...). Needed for correct client IPs in rate limiting.
        trustProxy: env.TRUST_PROXY ? Number(env.TRUST_PROXY) : 0,
        // Folder with the built React app (doc-manager/dist). When set, this
        // server also serves the UI, so UI + API share one origin.
        clientDist: env.CLIENT_DIST || null,
        google,
        apple,
        smtp,
        keepAlive,
        // How long the application_configs document is cached (ms).
        appConfigCacheMs: 60 * 1000,
    };
}

export const config = createConfig();
console.log('config :>> ', config);