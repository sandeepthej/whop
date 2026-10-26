import { defineConfig } from 'vite';
import { fetchLiveContentRewardsCampaigns } from './live_sync.js';

export default defineConfig({
  server: {
    port: 5173
  },
  plugins: [
    {
      name: 'whop-live-api-plugin',
      configureServer(server) {
        server.middlewares.use('/api/sync-live', async (req, res, next) => {
          try {
            res.setHeader('Content-Type', 'application/json');
            const campaigns = await fetchLiveContentRewardsCampaigns();
            res.end(JSON.stringify({ success: true, count: campaigns.length, campaigns, timestamp: Date.now() }));
          } catch (err) {
            console.error('API Error fetching live campaigns:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
        });
      }
    }
  ]
});
