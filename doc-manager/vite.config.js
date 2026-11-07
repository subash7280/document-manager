import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {

    // Load environment variables
    const env = loadEnv(mode, process.cwd(), '');

    console.log('API_PROXY_TARGET:', env.API_PROXY_TARGET);

    const API = env.API_PROXY_TARGET || 'http://localhost:5000';

    return {
        server: {
            proxy: {
                '/graphql': {
                    target: API,
                    changeOrigin: true
                },
                '/auth': {
                    target: API,
                    changeOrigin: true
                },
                '/api': {
                    target: API,
                    changeOrigin: true
                },
                '/app': {
                    target: API,
                    changeOrigin: true
                }
            },
            headers: {
                'Accept-CH': 'Sec-CH-UA-Platform-Version, Sec-CH-UA-Model, Sec-CH-UA-Full-Version-List'
            }
        },
        test: {
            include: ['src/**/*.test.js']
        }
    };
});