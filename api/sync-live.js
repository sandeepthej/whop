import { fetchLiveContentRewardsCampaigns } from '../live_sync.js';

export default async function handler(req, res) {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const campaigns = await fetchLiveContentRewardsCampaigns();
    return res.status(200).json({
      success: true,
      count: campaigns.length,
      campaigns,
      timestamp: Date.now()
    });
  } catch (err) {
    console.error('Vercel API live sync error:', err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
