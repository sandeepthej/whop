// Live RSC Parser for 100% of Content Rewards / Whop campaigns
export async function fetchLiveContentRewardsCampaigns() {
  const url = 'https://contentrewards.com/c/discover';
  const campaignsMap = new Map();

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'RSC': '1',
        'Accept': 'text/x-component'
      }
    });

    if (res.ok) {
      const text = await res.text();

      // Regex to extract all campaign records from React Server Component stream
      const regex = /"availableBudgetRaw":([0-9.]+).*?"brand":"([^"]*)".*?"budgetSpentRaw":([0-9.]+).*?"budgetTotalRaw":([0-9.]+).*?"category":"([^"]*)".*?"id":"([a-f0-9-]+)".*?"title":"([^"]*)".*?"payoutSortRaw":([0-9.]+)/g;

      let m;
      while ((m = regex.exec(text)) !== null) {
        const id = m[6];
        if (!campaignsMap.has(id)) {
          let title = m[7].replace(/^\$\$/, '$').trim();
          let brand = m[2] ? m[2].trim() : 'Whop Creator Community';
          let category = m[5] ? m[5].trim() : 'Clipping & UGC';
          let cpm = parseFloat(m[8]) || 1.50;
          if (cpm === 0) cpm = 1.50; // Fallback default CPM for reward campaigns

          const totalBudget = Math.round(parseFloat(m[4]) || 5000);
          const currentBudget = Math.round((parseFloat(m[1]) || 0) * 100) / 100;
          const spent = Math.round((parseFloat(m[3]) || 0) * 100) / 100;

          campaignsMap.set(id, {
            id,
            title,
            brand,
            category,
            totalBudget,
            currentBudget,
            spent,
            cpm,
            url: `https://contentrewards.com/c/campaigns/${id}`,
            burnRatePerHour: Math.round(spent * 0.04) || 160,
            platforms: ['tiktok', 'instagram', 'youtube']
          });
        }
      }
    }
  } catch (err) {
    console.error('Error fetching live RSC campaigns:', err);
  }

  return Array.from(campaignsMap.values());
}
