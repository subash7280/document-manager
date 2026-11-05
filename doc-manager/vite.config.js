import { defineConfig } from 'vite';

// ==================================================================
// VITE (development server + build)
// The browser talks ONLY to this server (http://localhost:5173).
// Requests for the API are forwarded ("proxied") to the backend, so
// the app and the API share one origin and the session cookie is a
// normal first-party cookie. Production does the same (see README).
// ==================================================================
const API = process.env.API_PROXY_TARGET || 'http://localhost:5000';

export default defineConfig({
  server: {
    proxy: {
      '/graphql': API,
      '/auth': API,
      '/api': API,
      '/app': API
    },
    // Ask Chrome/Edge to send the exact Windows version and phone model
    // with API requests, for the activity log (the API sends this too).
    headers: {
      'Accept-CH': 'Sec-CH-UA-Platform-Version, Sec-CH-UA-Model, Sec-CH-UA-Full-Version-List'
    }
  },
  test: {
    include: ['src/**/*.test.js']
  }
});
