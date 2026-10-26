import { soundEngine } from './audio.js';

class WhopRewardsTracker {
  constructor() {
    this.campaigns = this.loadCampaigns();
    this.notifications = this.loadNotifications();
    this.totalMilestonesTriggered = parseInt(localStorage.getItem('whop_milestone_hits') || '0', 10);
    this.currentFilter = 'all';
    this.searchQuery = '';
    this.sortBy = 'burn';
    this.viewMode = localStorage.getItem('whop_view_mode') || 'list'; // Default to clean compact list view!

    // Live Sync & Auto-polling
    this.isAutoSyncing = true;
    this.autoSyncTimer = null;
    this.lastSyncTimestamp = Date.now();

    // Simulation state
    this.isSimulating = false;
    this.simSpeedMultiplier = 5;
    this.simTimer = null;

    // Desktop notifications
    this.desktopNotifAllowed = ('Notification' in window) && Notification.permission === 'granted';

    this.initUI();
    this.render();
    this.updateStats();

    // Connect to live Whop Content Rewards API immediately to pull all 77+ campaigns
    this.syncLiveFromWhop(false);
    this.startAutoSync();
  }

  loadCampaigns() {
    try {
      const stored = localStorage.getItem('whop_rewards_campaigns_v4');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error('Failed to load campaigns from storage', e);
    }
    return [];
  }

  saveCampaigns() {
    try {
      localStorage.setItem('whop_rewards_campaigns_v4', JSON.stringify(this.campaigns));
    } catch (e) {
      console.error('Failed to save campaigns', e);
    }
  }

  loadNotifications() {
    try {
      const stored = localStorage.getItem('whop_rewards_notifs_v4');
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error('Failed to load notifications', e);
    }
    return [];
  }

  saveNotifications() {
    try {
      localStorage.setItem('whop_rewards_notifs_v4', JSON.stringify(this.notifications.slice(0, 100)));
    } catch (e) {
      console.error('Failed to save notifications', e);
    }
  }

  // DIRECT ACCESS: Live Sync with contentrewards.com + Auto-Discovery of New Campaigns
  async syncLiveFromWhop(showToastOnSuccess = true) {
    const spinner = document.getElementById('syncSpinner');
    const syncBtnText = document.getElementById('syncBtnText');
    if (spinner) spinner.classList.add('spinning');
    if (syncBtnText) syncBtnText.innerText = 'Syncing...';

    try {
      const res = await fetch('/api/sync-live');
      const data = await res.json();

      if (data && data.success && Array.isArray(data.campaigns)) {
        let updatedCount = 0;
        let newArrivals = [];
        const isFirstLoad = this.campaigns.length === 0;

        for (const live of data.campaigns) {
          const existing = this.campaigns.find(c => c.id === live.id || c.title.toLowerCase() === live.title.toLowerCase());
          if (existing) {
            const oldBudget = existing.currentBudget;
            const newBudget = live.currentBudget;

            // Update live financial figures
            existing.totalBudget = live.totalBudget || existing.totalBudget;
            existing.currentBudget = newBudget;
            existing.cpm = live.cpm || existing.cpm;
            existing.burnRatePerHour = live.burnRatePerHour || existing.burnRatePerHour;
            if (live.category) existing.category = live.category;

            // Trigger loop milestones if budget finished during this sync interval!
            this.checkMilestoneTriggers(existing, oldBudget, newBudget);
            updatedCount++;
          } else {
            // BRAND NEW CAMPAIGN ARRIVED ON CONTENT REWARDS!
            const spent = Math.max(0, live.totalBudget - live.currentBudget);
            const interval = 500;
            const newCamp = {
              id: live.id,
              title: live.title,
              brand: live.brand,
              category: live.category,
              totalBudget: live.totalBudget,
              currentBudget: live.currentBudget,
              cpm: live.cpm,
              pinned: isFirstLoad && updatedCount < 3, // Pin top 3 on fresh install
              milestoneInterval: interval,
              lastNotifiedMilestoneCount: Math.floor(spent / interval),
              url: live.url,
              burnRatePerHour: live.burnRatePerHour || 180,
              avatar: live.avatar || '',
              isNew: !isFirstLoad, // Only mark as new arrival if app was already running
              arrivedAt: Date.now()
            };
            this.campaigns.push(newCamp);
            if (!isFirstLoad) {
              newArrivals.push(newCamp);
              this.triggerNewCampaignAlert(newCamp);
            }
          }
        }

        this.lastSyncTimestamp = Date.now();
        this.updateSyncBadge();
        this.saveCampaigns();
        this.render();
        this.updateStats();

        if (showToastOnSuccess) {
          this.showToast({
            title: '⚡ Whop Live Sync Completed',
            message: `Loaded all <strong>${this.campaigns.length} live campaigns</strong> directly from Content Rewards!${newArrivals.length > 0 ? ` <strong>${newArrivals.length} new campaigns</strong> arrived!` : ''}`,
            type: 'info'
          });
        }
      }
    } catch (err) {
      console.warn('Live sync error:', err);
    } finally {
      if (spinner) spinner.classList.remove('spinning');
      if (syncBtnText) syncBtnText.innerText = 'Sync Live Whop';
    }
  }

  // Trigger alert when a brand drops a new campaign on Content Rewards
  triggerNewCampaignAlert(campaign) {
    soundEngine.playMilestone();

    this.showToast({
      title: '🎉 NEW CAMPAIGN DROPPED ON WHOP!',
      message: `<strong>${campaign.title}</strong> by <strong>${campaign.brand}</strong> is now live!<br>Pool: <strong>$${campaign.totalBudget.toLocaleString()}</strong> • Rate: <strong>$${campaign.cpm.toFixed(2)} CPM</strong>. Added to your list!`,
      type: 'milestone'
    });

    if (this.desktopNotifAllowed && ('Notification' in window) && Notification.permission === 'granted') {
      try {
        new Notification(`🎉 New Whop Campaign: ${campaign.title}`, {
          body: `Brand: ${campaign.brand} • Pool: $${campaign.totalBudget.toLocaleString()} • $${campaign.cpm.toFixed(2)} CPM. Pin now!`,
          icon: '/favicon.ico'
        });
      } catch (e) {}
    }

    const discordUrl = localStorage.getItem('whop_discord_webhook');
    const discordEnabled = localStorage.getItem('whop_discord_enabled') === 'true';
    if (discordEnabled && discordUrl) {
      try {
        fetch(discordUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'WhopClip Radar',
            avatar_url: 'https://contentrewards.com/icon.png',
            embeds: [{
              title: `🎉 NEW CAMPAIGN LIVE ON CONTENT REWARDS!`,
              description: `**${campaign.title}** has just been added!\n\n` +
                           `🏢 **Brand:** ${campaign.brand}\n` +
                           `💰 **Total Pool Budget:** $${campaign.totalBudget.toLocaleString()}\n` +
                           `💵 **Payout Rate:** $${campaign.cpm.toFixed(2)} CPM\n` +
                           `🏷️ **Category:** ${campaign.category}`,
              color: 0x06b6d4,
              url: campaign.url,
              footer: { text: 'WhopClip Radar • Content Rewards Auto-Discovery' },
              timestamp: new Date().toISOString()
            }]
          })
        }).catch(err => console.warn('Discord new campaign webhook error', err));
      } catch (e) {}
    }
  }

  // Auto-Sync background loop (30s)
  startAutoSync() {
    this.stopAutoSync();
    if (!this.isAutoSyncing) return;

    this.autoSyncTimer = setInterval(() => {
      this.syncLiveFromWhop(false);
    }, 30000); // Polls every 30 seconds
  }

  stopAutoSync() {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
  }

  updateSyncBadge() {
    const badge = document.getElementById('syncTimeBadge');
    if (!badge) return;
    const diffSec = Math.round((Date.now() - this.lastSyncTimestamp) / 1000);
    badge.innerText = diffSec < 5 ? 'Just now' : `${diffSec}s ago`;
  }

  // Core Loop Milestone Tracking Engine
  checkMilestoneTriggers(campaign, oldBudget, newBudget) {
    if (newBudget >= oldBudget) return;

    const total = campaign.totalBudget;
    const interval = campaign.milestoneInterval || 500;

    const oldSpent = total - oldBudget;
    const newSpent = total - newBudget;

    const oldMilestoneCount = Math.floor(oldSpent / interval);
    const newMilestoneCount = Math.floor(newSpent / interval);

    if (newMilestoneCount > oldMilestoneCount) {
      for (let i = oldMilestoneCount + 1; i <= newMilestoneCount; i++) {
        const completedAmountAtMilestone = i * interval;
        this.triggerMilestoneNotification(campaign, interval, completedAmountAtMilestone, newBudget);
      }
      campaign.lastNotifiedMilestoneCount = newMilestoneCount;
      this.saveCampaigns();
    }
  }

  triggerMilestoneNotification(campaign, interval, totalSpentSoFar, remainingBudget) {
    this.totalMilestonesTriggered++;
    localStorage.setItem('whop_milestone_hits', this.totalMilestonesTriggered.toString());

    const remainingPercent = Math.max(0, Math.round((remainingBudget / campaign.totalBudget) * 100));
    const viewsGenerated = Math.round((totalSpentSoFar / campaign.cpm) * 1000).toLocaleString();

    const notifObj = {
      id: 'notif-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      interval: interval,
      totalSpentSoFar: totalSpentSoFar,
      remainingBudget: remainingBudget,
      remainingPercent: remainingPercent,
      viewsGenerated: viewsGenerated,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    this.notifications.unshift(notifObj);
    this.saveNotifications();

    soundEngine.playMilestone();

    this.showToast({
      title: `🔔 Loop Alert: $${interval} Completed!`,
      message: `<strong>${campaign.title}</strong> has finished another <strong>$${interval}</strong> of its pool.<br>Total Finished: <strong>$${totalSpentSoFar.toLocaleString()}</strong> • Remaining: <strong>$${Math.round(remainingBudget).toLocaleString()}</strong> (${remainingPercent}%)`,
      type: 'milestone'
    });

    if (this.desktopNotifAllowed && ('Notification' in window) && Notification.permission === 'granted') {
      try {
        new Notification(`WhopClip Alert: $${interval} Completed!`, {
          body: `${campaign.title} finished another $${interval}! Remaining: $${Math.round(remainingBudget).toLocaleString()} (${remainingPercent}%)`,
          icon: '/favicon.ico'
        });
      } catch (err) {
        console.warn('Desktop notification error', err);
      }
    }

    const discordUrl = localStorage.getItem('whop_discord_webhook');
    const discordEnabled = localStorage.getItem('whop_discord_enabled') === 'true';
    if (discordEnabled && discordUrl) {
      try {
        fetch(discordUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'WhopClip Radar',
            avatar_url: 'https://contentrewards.com/icon.png',
            embeds: [{
              title: `🎯 $${interval} Loop Milestone: ${campaign.title}`,
              description: `Another **$${interval}** of the campaign pool has been completed by clippers!\n\n` +
                           `💰 **Total Finished So Far:** $${totalSpentSoFar.toLocaleString()}\n` +
                           `📦 **Remaining Budget:** $${Math.round(remainingBudget).toLocaleString()} (${remainingPercent}% remaining)\n` +
                           `📈 **Views Generated:** ~${viewsGenerated} views (@ $${campaign.cpm.toFixed(2)} CPM)`,
              color: 0x10b981,
              url: campaign.url,
              footer: { text: 'WhopClip Radar • Content Rewards Monitor' },
              timestamp: new Date().toISOString()
            }]
          })
        }).catch(err => console.warn('Discord webhook failed to send', err));
      } catch (err) {
        console.warn('Discord webhook error', err);
      }
    }

    this.renderNotificationFeed();
    this.updateStats();
  }

  // Update Remaining Balance manually
  updateCampaignBalance(campaignId, newRemaining) {
    const camp = this.campaigns.find(c => c.id === campaignId);
    if (!camp) return;

    const oldBudget = camp.currentBudget;
    const validatedNewBudget = Math.max(0, Math.min(camp.totalBudget, Number(newRemaining)));

    camp.currentBudget = validatedNewBudget;
    this.checkMilestoneTriggers(camp, oldBudget, validatedNewBudget);
    this.saveCampaigns();
    this.render();
    this.updateStats();
  }

  // Pin / Unpin Campaign
  togglePin(campaignId) {
    const camp = this.campaigns.find(c => c.id === campaignId);
    if (camp) {
      camp.pinned = !camp.pinned;
      soundEngine.playClick();
      this.saveCampaigns();
      this.render();
      this.updateStats();
    }
  }

  // Set Milestone Notification Interval ($100, $200, $300, $500, etc.)
  setCampaignMilestoneInterval(campaignId, interval) {
    const camp = this.campaigns.find(c => c.id === campaignId);
    if (camp && interval > 0) {
      camp.milestoneInterval = Number(interval);
      const spent = camp.totalBudget - camp.currentBudget;
      camp.lastNotifiedMilestoneCount = Math.floor(spent / camp.milestoneInterval);
      soundEngine.playClick();
      this.saveCampaigns();
      this.render();
      this.showToast({
        title: 'Loop Interval Updated',
        message: `Alerts for <strong>${camp.title}</strong> set to notify every <strong>$${interval}</strong> completed.`,
        type: 'info'
      });
    }
  }

  // Live Simulation Engine for Verification
  toggleSimulation() {
    this.isSimulating = !this.isSimulating;
    const btn = document.getElementById('toggleSimBtn');
    const text = document.getElementById('simBtnText');
    const icon = document.getElementById('simBtnIcon');

    if (this.isSimulating) {
      text.innerText = 'Pause';
      icon.innerText = '⏸';
      btn.classList.add('active');
      this.startSimTimer();
      this.showToast({
        title: 'Test Drain Started',
        message: `Simulating creator view payouts at ${this.simSpeedMultiplier}x speed. Watch the budget drain and trigger milestone alerts!`,
        type: 'info'
      });
    } else {
      text.innerText = 'Sim';
      icon.innerText = '▶';
      btn.classList.remove('active');
      this.stopSimTimer();
    }
  }

  startSimTimer() {
    this.stopSimTimer();
    this.simTimer = setInterval(() => {
      this.simulateDrainTick();
    }, 1500);
  }

  stopSimTimer() {
    if (this.simTimer) {
      clearInterval(this.simTimer);
      this.simTimer = null;
    }
  }

  simulateDrainTick() {
    const activeCamps = this.campaigns.filter(c => c.currentBudget > 0);
    if (activeCamps.length === 0) {
      this.toggleSimulation();
      return;
    }

    const targetCamp = activeCamps.find(c => c.pinned && Math.random() > 0.3) || 
                       activeCamps[Math.floor(Math.random() * activeCamps.length)];

    const baseDrain = Math.floor((Math.random() * 25 + 15) * (this.simSpeedMultiplier / 2));
    const oldBudget = targetCamp.currentBudget;
    const newBudget = Math.max(0, oldBudget - baseDrain);

    targetCamp.currentBudget = newBudget;
    this.checkMilestoneTriggers(targetCamp, oldBudget, newBudget);
    this.saveCampaigns();
    this.render();
    this.updateStats();
  }

  simulateSingleMilestone(dropAmount = 300) {
    const pinned = this.campaigns.filter(c => c.pinned && c.currentBudget >= dropAmount);
    const target = pinned.length > 0 ? pinned[0] : this.campaigns.find(c => c.currentBudget >= dropAmount);

    if (target) {
      const oldBudget = target.currentBudget;
      const newBudget = oldBudget - dropAmount;
      target.currentBudget = newBudget;
      this.checkMilestoneTriggers(target, oldBudget, newBudget);
      this.saveCampaigns();
      this.render();
      this.updateStats();
    } else {
      this.showToast({
        title: 'Cannot Drain',
        message: 'No campaign has at least $' + dropAmount + ' remaining budget.',
        type: 'warning'
      });
    }
  }

  // Quick Text & URL Parser
  parseCampaignText(rawText) {
    if (!rawText) return null;
    const urlMatch = rawText.match(/https?:\/\/[^\s]+/i);
    const url = urlMatch ? urlMatch[0] : '';

    const moneyMatches = rawText.match(/\$([0-9,]+(\.[0-9]{2})?)/g) || [];
    const numbers = moneyMatches.map(m => parseFloat(m.replace(/[$,]/g, ''))).filter(n => !isNaN(n));

    let totalBudget = 5000;
    let currentBudget = 4500;
    let cpm = 1.50;

    if (numbers.length >= 2) {
      totalBudget = Math.max(numbers[0], numbers[1]);
      currentBudget = Math.min(numbers[0], numbers[1]);
    } else if (numbers.length === 1) {
      totalBudget = numbers[0];
      currentBudget = numbers[0];
    }

    const cpmMatch = rawText.match(/cpm[:\s]*\$?([0-9.]+)/i);
    if (cpmMatch && cpmMatch[1]) {
      cpm = parseFloat(cpmMatch[1]);
    }

    let title = 'Whop Content Rewards Campaign';
    if (url) {
      const parts = url.split('/').filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && last.length > 3) {
        title = last.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      }
    } else {
      const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length > 0 && lines[0].length < 60) {
        title = lines[0];
      }
    }

    return {
      title,
      brand: 'Whop Creator Space',
      category: 'General UGC',
      totalBudget,
      currentBudget,
      cpm,
      url: url || 'https://contentrewards.com'
    };
  }

  // UI Setup & Listeners
  initUI() {
    // Direct Live Sync Button
    document.getElementById('syncLiveBtn').addEventListener('click', () => {
      this.syncLiveFromWhop(true);
    });

    // Auto-Sync Checkbox
    const autoSyncCheckbox = document.getElementById('autoSyncCheckbox');
    autoSyncCheckbox.addEventListener('change', (e) => {
      this.isAutoSyncing = e.target.checked;
      if (this.isAutoSyncing) {
        this.startAutoSync();
        this.showToast({
          title: 'Auto-Sync Active',
          message: 'Polling real-time Content Rewards campaign budgets every 30 seconds.',
          type: 'info'
        });
      } else {
        this.stopAutoSync();
        this.showToast({
          title: 'Auto-Sync Paused',
          message: 'Auto-polling paused. You can sync manually anytime with the "Sync Live Whop" button.',
          type: 'info'
        });
      }
    });

    // Sound controls
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    let soundMuted = false;
    toggleAudioBtn.addEventListener('click', () => {
      soundMuted = !soundMuted;
      soundEngine.setMuted(soundMuted);
      toggleAudioBtn.classList.toggle('muted', soundMuted);
      toggleAudioBtn.style.opacity = soundMuted ? '0.4' : '1';
    });

    document.getElementById('testSoundBtn').addEventListener('click', () => {
      soundEngine.playMilestone();
    });

    // Desktop Notification Permission
    const enableNotifBtn = document.getElementById('enableNotifBtn');
    const notifStatusText = document.getElementById('notifStatusText');
    if (this.desktopNotifAllowed) {
      notifStatusText.innerText = 'Active';
      enableNotifBtn.classList.replace('btn-outline-amber', 'btn-outline-cyan');
    }
    enableNotifBtn.addEventListener('click', async () => {
      if ('Notification' in window) {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          this.desktopNotifAllowed = true;
          notifStatusText.innerText = 'Active';
          enableNotifBtn.classList.replace('btn-outline-amber', 'btn-outline-cyan');
          this.showToast({
            title: 'Notifications Activated',
            message: 'You will receive continuous desktop notifications every time a campaign finishes its budget loop milestone.',
            type: 'info'
          });
        }
      }
    });

    // Simulation controls
    document.getElementById('toggleSimBtn').addEventListener('click', () => this.toggleSimulation());
    const simSpeedSelect = document.getElementById('simSpeedSelect');
    simSpeedSelect.addEventListener('change', (e) => {
      this.simSpeedMultiplier = parseInt(e.target.value, 10);
      document.getElementById('simSpeedBadge').innerText = `${this.simSpeedMultiplier}x`;
    });

    // Test Milestone Button
    document.getElementById('simulateMilestoneBtn').addEventListener('click', () => {
      this.simulateSingleMilestone(300);
    });

    // Clear Notification Log
    document.getElementById('clearNotifsBtn').addEventListener('click', () => {
      this.notifications = [];
      this.saveNotifications();
      this.renderNotificationFeed();
    });

    // Pin first button in empty state
    document.getElementById('pinFirstBtn').addEventListener('click', () => {
      if (this.campaigns.length > 0) {
        this.campaigns[0].pinned = true;
        this.saveCampaigns();
        this.render();
        this.updateStats();
      }
    });

    // View Mode Toggle (Compact List vs Cards View)
    const viewListBtn = document.getElementById('viewListBtn');
    const viewGridBtn = document.getElementById('viewGridBtn');

    const updateViewButtons = () => {
      if (this.viewMode === 'list') {
        viewListBtn.classList.add('active', 'btn-outline-cyan');
        viewListBtn.classList.remove('btn-ghost');
        viewGridBtn.classList.remove('active', 'btn-outline-cyan');
        viewGridBtn.classList.add('btn-ghost');
      } else {
        viewGridBtn.classList.add('active', 'btn-outline-cyan');
        viewGridBtn.classList.remove('btn-ghost');
        viewListBtn.classList.remove('active', 'btn-outline-cyan');
        viewListBtn.classList.add('btn-ghost');
      }
    };
    updateViewButtons();

    viewListBtn.addEventListener('click', () => {
      this.viewMode = 'list';
      localStorage.setItem('whop_view_mode', 'list');
      updateViewButtons();
      this.render();
    });

    viewGridBtn.addEventListener('click', () => {
      this.viewMode = 'grid';
      localStorage.setItem('whop_view_mode', 'grid');
      updateViewButtons();
      this.render();
    });

    // Pin Campaign Selector Modal
    const pinSelectorModal = document.getElementById('pinSelectorModal');
    const openPinSelectorBtn = document.getElementById('openPinSelectorBtn');
    const pickerSearchInput = document.getElementById('pickerSearchInput');
    const clearPickerSearchBtn = document.getElementById('clearPickerSearchBtn');

    openPinSelectorBtn.addEventListener('click', () => {
      if (pickerSearchInput) {
        pickerSearchInput.value = '';
        if (clearPickerSearchBtn) clearPickerSearchBtn.style.display = 'none';
      }
      this.renderPickerTable();
      pinSelectorModal.style.display = 'flex';
      if (pickerSearchInput) setTimeout(() => pickerSearchInput.focus(), 150);
    });

    if (pickerSearchInput) {
      pickerSearchInput.addEventListener('input', () => {
        if (clearPickerSearchBtn) {
          clearPickerSearchBtn.style.display = pickerSearchInput.value ? 'block' : 'none';
        }
        this.renderPickerTable();
      });
    }

    if (clearPickerSearchBtn) {
      clearPickerSearchBtn.addEventListener('click', () => {
        pickerSearchInput.value = '';
        clearPickerSearchBtn.style.display = 'none';
        pickerSearchInput.focus();
        this.renderPickerTable();
      });
    }

    document.getElementById('pickerPinTop5Btn').addEventListener('click', () => {
      // Sort by totalBudget descending, pin top 5
      const sorted = [...this.campaigns].sort((a, b) => b.totalBudget - a.totalBudget);
      sorted.slice(0, 5).forEach(c => c.pinned = true);
      soundEngine.playClick();
      this.saveCampaigns();
      this.renderPickerTable();
      this.render();
      this.updateStats();
    });

    document.getElementById('pickerPinHighCpmBtn').addEventListener('click', () => {
      this.campaigns.forEach(c => {
        if (c.cpm >= 2.0) c.pinned = true;
      });
      soundEngine.playClick();
      this.saveCampaigns();
      this.renderPickerTable();
      this.render();
      this.updateStats();
    });

    document.getElementById('pickerClearAllBtn').addEventListener('click', () => {
      this.campaigns.forEach(c => c.pinned = false);
      soundEngine.playClick();
      this.saveCampaigns();
      this.renderPickerTable();
      this.render();
      this.updateStats();
    });

    document.getElementById('pickerCatSelect').addEventListener('change', () => {
      this.renderPickerTable();
    });

    // Search and filter inputs
    const searchInput = document.getElementById('campaignSearchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      clearSearchBtn.style.display = this.searchQuery ? 'block' : 'none';
      this.render();
    });
    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      this.searchQuery = '';
      clearSearchBtn.style.display = 'none';
      this.render();
    });

    // Filter pills
    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.currentFilter = e.currentTarget.dataset.filter;
        this.render();
      });
    });

    // Sort select
    document.getElementById('campaignSortSelect').addEventListener('change', (e) => {
      this.sortBy = e.target.value;
      this.render();
    });

    // Discord Webhook Modal
    const webhookModal = document.getElementById('webhookModal');
    const discordWebhookInput = document.getElementById('discordWebhookInput');
    const discordWebhookEnabled = document.getElementById('discordWebhookEnabled');

    const savedUrl = localStorage.getItem('whop_discord_webhook') || '';
    const savedEnabled = localStorage.getItem('whop_discord_enabled') === 'true';
    if (discordWebhookInput) discordWebhookInput.value = savedUrl;
    if (discordWebhookEnabled) discordWebhookEnabled.checked = savedEnabled;

    document.getElementById('openWebhookModalBtn').addEventListener('click', () => {
      webhookModal.style.display = 'flex';
    });

    document.getElementById('saveDiscordWebhookBtn').addEventListener('click', () => {
      const url = discordWebhookInput.value.trim();
      const enabled = discordWebhookEnabled.checked;
      localStorage.setItem('whop_discord_webhook', url);
      localStorage.setItem('whop_discord_enabled', enabled.toString());
      webhookModal.style.display = 'none';
      this.showToast({
        title: 'Discord Settings Saved',
        message: enabled && url ? 'Milestone loop alerts will now be sent to your Discord channel!' : 'Discord webhook notifications updated.',
        type: 'info'
      });
    });

    document.getElementById('testDiscordWebhookBtn').addEventListener('click', () => {
      const url = discordWebhookInput.value.trim();
      if (!url) {
        alert('Please enter a valid Discord Webhook URL first.');
        return;
      }
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'WhopClip Radar Test',
          content: '🔔 **WhopClip Radar Connected!** You will receive milestone notifications here whenever campaign budgets complete.'
        })
      }).then(res => {
        if (res.ok) {
          alert('Test ping sent successfully to Discord!');
        } else {
          alert(`Discord returned status: ${res.status}. Check your webhook URL.`);
        }
      }).catch(err => {
        alert('Failed to connect to Discord Webhook: ' + err.message);
      });
    });

    // Add Modal Handlers
    const addModal = document.getElementById('addModal');
    document.getElementById('openAddModalBtn').addEventListener('click', () => {
      addModal.style.display = 'flex';
    });

    document.getElementById('addCampaignForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('newTitle').value.trim();
      const brand = document.getElementById('newBrand').value.trim();
      const category = document.getElementById('newCategory').value;
      const totalBudget = parseFloat(document.getElementById('newTotalBudget').value);
      const currentBudget = parseFloat(document.getElementById('newCurrentBudget').value);
      const cpm = parseFloat(document.getElementById('newCpm').value);
      const milestoneInterval = parseInt(document.getElementById('newMilestoneInterval').value, 10);
      const url = document.getElementById('newWhopUrl').value.trim() || 'https://contentrewards.com';
      const pinImmediately = document.getElementById('newPinImmediately').checked;

      const spent = totalBudget - currentBudget;
      const initialMilestoneCount = Math.floor(spent / milestoneInterval);

      const newCamp = {
        id: 'camp-custom-' + Date.now(),
        title,
        brand,
        category,
        totalBudget,
        currentBudget,
        cpm,
        pinned: pinImmediately,
        milestoneInterval,
        lastNotifiedMilestoneCount: initialMilestoneCount,
        url,
        burnRatePerHour: Math.round(totalBudget * 0.05),
        avatar: '',
        isNew: true
      };

      this.campaigns.unshift(newCamp);
      this.saveCampaigns();
      this.render();
      this.updateStats();
      addModal.style.display = 'none';
      e.target.reset();

      this.showToast({
        title: 'Campaign Added',
        message: `<strong>${title}</strong> added! Tracking budget loop every <strong>$${milestoneInterval}</strong>.`,
        type: 'info'
      });
    });

    // Import Modal Handlers
    const importModal = document.getElementById('importModal');
    document.getElementById('openImportModalBtn').addEventListener('click', () => {
      importModal.style.display = 'flex';
      document.getElementById('parsePreview').style.display = 'none';
      document.getElementById('confirmImportBtn').style.display = 'none';
      document.getElementById('importRawText').value = '';
    });

    let detectedParsedData = null;
    document.getElementById('parseImportBtn').addEventListener('click', () => {
      const rawText = document.getElementById('importRawText').value;
      const parsed = this.parseCampaignText(rawText);
      if (parsed) {
        detectedParsedData = parsed;
        const preview = document.getElementById('parsePreview');
        const previewDetails = document.getElementById('previewDetails');
        previewDetails.innerHTML = `
          <div><strong>Title:</strong> ${parsed.title}</div>
          <div><strong>Total Pool:</strong> $${parsed.totalBudget.toLocaleString()}</div>
          <div><strong>Current Remaining:</strong> $${parsed.currentBudget.toLocaleString()}</div>
          <div><strong>CPM:</strong> $${parsed.cpm.toFixed(2)}</div>
          <div><strong>Whop URL:</strong> <a href="${parsed.url}" target="_blank" style="color:var(--accent-cyan);">${parsed.url}</a></div>
        `;
        preview.style.display = 'block';
        document.getElementById('confirmImportBtn').style.display = 'inline-flex';
      }
    });

    document.getElementById('confirmImportBtn').addEventListener('click', () => {
      if (detectedParsedData) {
        const spent = detectedParsedData.totalBudget - detectedParsedData.currentBudget;
        const newCamp = {
          id: 'camp-import-' + Date.now(),
          title: detectedParsedData.title,
          brand: detectedParsedData.brand,
          category: detectedParsedData.category,
          totalBudget: detectedParsedData.totalBudget,
          currentBudget: detectedParsedData.currentBudget,
          cpm: detectedParsedData.cpm,
          pinned: true,
          milestoneInterval: 300,
          lastNotifiedMilestoneCount: Math.floor(spent / 300),
          url: detectedParsedData.url,
          burnRatePerHour: Math.round(detectedParsedData.totalBudget * 0.04),
          avatar: '',
          isNew: true
        };
        this.campaigns.unshift(newCamp);
        this.saveCampaigns();
        this.render();
        this.updateStats();
        importModal.style.display = 'none';
        this.showToast({
          title: 'Import Successful',
          message: `Pinned <strong>${newCamp.title}</strong> to your focus watchlist with $300 loop tracking.`,
          type: 'info'
        });
      }
    });

    // Payout Calculator Modal Handlers
    const calcModal = document.getElementById('calcModal');
    document.getElementById('openCalcBtn').addEventListener('click', () => {
      this.populateCalculator();
      calcModal.style.display = 'flex';
    });

    document.querySelectorAll('.pill-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.getElementById('calcViewsInput').value = e.target.dataset.views;
        this.recalculatePayout();
      });
    });

    document.getElementById('calcViewsInput').addEventListener('input', () => this.recalculatePayout());
    document.getElementById('calcCpmInput').addEventListener('input', () => this.recalculatePayout());
    document.getElementById('calcCampaignSelect').addEventListener('change', (e) => {
      const camp = this.campaigns.find(c => c.id === e.target.value);
      if (camp) {
        document.getElementById('calcCpmInput').value = camp.cpm;
        this.recalculatePayout();
      }
    });

    // Balance Edit Modal Handlers
    const balanceModal = document.getElementById('balanceModal');
    document.getElementById('saveBalanceBtn').addEventListener('click', () => {
      if (activeEditingCampaignId) {
        const val = parseFloat(document.getElementById('editRemainingBudget').value);
        this.updateCampaignBalance(activeEditingCampaignId, val);
        balanceModal.style.display = 'none';
      }
    });

    document.querySelectorAll('.adjust-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const drop = parseFloat(e.target.dataset.drop);
        const input = document.getElementById('editRemainingBudget');
        const current = parseFloat(input.value) || 0;
        input.value = Math.max(0, current - drop);
      });
    });

    // Modal close triggers
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = e.currentTarget.dataset.close;
        const targetModal = document.getElementById(targetId);
        if (targetModal) targetModal.style.display = 'none';
      });
    });

    document.querySelectorAll('.modal-backdrop').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
      });
    });
  }

  populateCalculator() {
    const select = document.getElementById('calcCampaignSelect');
    select.innerHTML = this.campaigns.map(c => `
      <option value="${c.id}">${c.title} (Remaining: $${c.currentBudget.toLocaleString()} | CPM: $${c.cpm})</option>
    `).join('');

    if (this.campaigns.length > 0) {
      document.getElementById('calcCpmInput').value = this.campaigns[0].cpm;
      this.recalculatePayout();
    }
  }

  recalculatePayout() {
    const views = parseFloat(document.getElementById('calcViewsInput').value) || 0;
    const cpm = parseFloat(document.getElementById('calcCpmInput').value) || 0;
    const campId = document.getElementById('calcCampaignSelect').value;
    const camp = this.campaigns.find(c => c.id === campId);

    const projectedPayout = (views / 1000) * cpm;
    document.getElementById('calcProjectedPayout').innerText = `$${projectedPayout.toFixed(2)}`;
    document.getElementById('calcViewsSub').innerText = `Based on ${views.toLocaleString()} projected views at $${cpm.toFixed(2)} CPM`;

    if (camp) {
      document.getElementById('calcPoolRemaining').innerText = `$${Math.round(camp.currentBudget).toLocaleString()}`;
      const share = camp.currentBudget > 0 ? ((projectedPayout / camp.currentBudget) * 100).toFixed(1) : 0;
      document.getElementById('calcPoolClaimShare').innerText = `${share}%`;

      const badge = document.getElementById('calcPoolSafetyBadge');
      if (camp.currentBudget <= 0) {
        badge.className = 'badge badge-rose';
        badge.innerText = 'Pool Depleted';
      } else if (projectedPayout > camp.currentBudget) {
        badge.className = 'badge badge-rose';
        badge.innerText = 'Risk: Payout exceeds remaining pool!';
      } else if (camp.currentBudget < 500) {
        badge.className = 'badge badge-amber';
        badge.innerText = 'High Risk (< $500 pool left)';
      } else {
        badge.className = 'badge badge-emerald';
        badge.innerText = 'Safe to Clip & Submit';
      }
    }
  }

  showToast({ title, message, type = 'info' }) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = '🔔';
    if (type === 'milestone') icon = '🎯';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-body">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-close">&times;</button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.remove();
    });

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 350);
    }, 6000);
  }

  openBalanceModal(campaignId) {
    const camp = this.campaigns.find(c => c.id === campaignId);
    if (!camp) return;

    activeEditingCampaignId = campaignId;
    const modal = document.getElementById('balanceModal');
    const info = document.getElementById('balanceCampInfo');
    info.innerHTML = `
      <div style="font-weight:700; color:#fff; font-size:1.05rem;">${camp.title}</div>
      <div style="color:var(--text-muted); font-size:0.8rem;">Total Budget: $${camp.totalBudget.toLocaleString()} • Currently Logged: $${camp.currentBudget.toLocaleString()}</div>
    `;

    document.getElementById('editRemainingBudget').value = camp.currentBudget;
    modal.style.display = 'flex';
  }

  renderPickerTable() {
    const tbody = document.getElementById('pickerTableBody');
    if (!tbody) return;
    const catSelect = document.getElementById('pickerCatSelect');
    const selectedCat = catSelect ? catSelect.value : 'all';
    const searchInput = document.getElementById('pickerSearchInput');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    let list = [...this.campaigns];

    // Filter by search query
    if (query) {
      list = list.filter(c => 
        c.title.toLowerCase().includes(query) ||
        c.brand.toLowerCase().includes(query) ||
        c.category.toLowerCase().includes(query)
      );
    }

    // Filter by category
    if (selectedCat === 'roblox') {
      list = list.filter(c => c.category.toLowerCase().includes('roblox') || c.category.toLowerCase().includes('gaming'));
    } else if (selectedCat === 'podcast') {
      list = list.filter(c => c.category.toLowerCase().includes('podcast') || c.category.toLowerCase().includes('stream') || c.category.toLowerCase().includes('comedy'));
    } else if (selectedCat === 'brand') {
      list = list.filter(c => c.category.toLowerCase().includes('brand') || c.category.toLowerCase().includes('tech') || c.category.toLowerCase().includes('crypto') || c.category.toLowerCase().includes('business') || c.category.toLowerCase().includes('ugc'));
    }

    const modalPinnedCount = document.getElementById('modalPinnedCount');
    if (modalPinnedCount) modalPinnedCount.innerText = this.campaigns.filter(c => c.pinned).length;
    const pickerTotalDisplay = document.getElementById('pickerTotalDisplay');
    if (pickerTotalDisplay) pickerTotalDisplay.innerText = this.campaigns.length;

    const pickerMatchCount = document.getElementById('pickerMatchCount');
    if (pickerMatchCount) {
      pickerMatchCount.innerText = query ? `Showing ${list.length} of ${this.campaigns.length}` : `Showing all ${this.campaigns.length} campaigns`;
    }

    if (list.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            No campaigns found matching "<strong>${query}</strong>". Try clearing your search.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = list.map(camp => {
      const isNearDepletion = camp.currentBudget < 1000;
      return `
        <tr class="${camp.pinned ? 'is-pinned-row' : ''}" data-id="${camp.id}">
          <td style="text-align: center;">
            <button class="table-pin-btn ${camp.pinned ? 'pinned' : ''}" data-action="picker-pin" title="${camp.pinned ? 'Unpin' : 'Pin to Watchlist'}">
              ${camp.pinned ? '📌 Pinned' : '+ Pin'}
            </button>
          </td>
          <td>
            <div class="table-camp-title">${camp.title}</div>
            <div class="table-camp-brand">${camp.brand} • <span style="color:var(--accent-cyan); font-size:0.68rem;">${camp.category}</span></div>
          </td>
          <td>
            <span class="table-mono-val">$${Math.round(camp.totalBudget).toLocaleString()}</span>
          </td>
          <td>
            <span class="table-mono-val" style="color:${isNearDepletion ? 'var(--accent-rose)' : 'var(--text-main)'};">
              $${Math.round(camp.currentBudget).toLocaleString()}
            </span>
          </td>
          <td>
            <span class="badge badge-cpm">$${camp.cpm.toFixed(2)}</span>
          </td>
          <td>
            <span style="font-size:0.75rem; color:var(--accent-amber); font-weight:600;">Every $${camp.milestoneInterval || 500}</span>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('[data-action="picker-pin"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        if (row) {
          this.togglePin(row.dataset.id);
          this.renderPickerTable();
        }
      });
    });
  }

  // Render Logic
  render() {
    this.renderPinnedSection();
    this.renderDirectoryGrid();
    this.renderNotificationFeed();
  }

  renderPinnedSection() {
    const pinnedCamps = this.campaigns.filter(c => c.pinned);
    const pinnedGrid = document.getElementById('pinnedCardsGrid');
    const emptyState = document.getElementById('pinnedEmptyState');
    const badgeCount = document.getElementById('pinnedBadgeCount');

    badgeCount.innerText = pinnedCamps.length;

    if (pinnedCamps.length === 0) {
      emptyState.style.display = 'block';
      pinnedGrid.innerHTML = '';
      return;
    }

    emptyState.style.display = 'none';
    pinnedGrid.innerHTML = pinnedCamps.map(camp => this.createCampaignCardHtml(camp, true)).join('');
    this.attachCardEventListeners(pinnedGrid);
  }

  renderDirectoryGrid() {
    const grid = document.getElementById('campaignsGrid');
    let filtered = [...this.campaigns];

    if (this.searchQuery) {
      filtered = filtered.filter(c => 
        c.title.toLowerCase().includes(this.searchQuery) ||
        c.brand.toLowerCase().includes(this.searchQuery) ||
        c.category.toLowerCase().includes(this.searchQuery)
      );
    }

    // Filter pill selection
    if (this.currentFilter === 'pinned') {
      filtered = filtered.filter(c => c.pinned);
    } else if (this.currentFilter === 'new-arrivals') {
      filtered = filtered.filter(c => c.isNew);
    } else if (this.currentFilter === 'roblox') {
      filtered = filtered.filter(c => c.category.toLowerCase().includes('roblox') || c.category.toLowerCase().includes('gaming'));
    } else if (this.currentFilter === 'podcasts') {
      filtered = filtered.filter(c => c.category.toLowerCase().includes('podcast') || c.category.toLowerCase().includes('stream') || c.category.toLowerCase().includes('comedy'));
    } else if (this.currentFilter === 'brands') {
      filtered = filtered.filter(c => c.category.toLowerCase().includes('brand') || c.category.toLowerCase().includes('tech') || c.category.toLowerCase().includes('crypto') || c.category.toLowerCase().includes('ugc') || c.category.toLowerCase().includes('business'));
    } else if (this.currentFilter === 'high-cpm') {
      filtered = filtered.filter(c => c.cpm >= 1.50);
    } else if (this.currentFilter === 'ending') {
      filtered = filtered.filter(c => c.currentBudget < 1000);
    }

    // Sorting
    if (this.sortBy === 'burn') {
      filtered.sort((a, b) => (b.burnRatePerHour || 0) - (a.burnRatePerHour || 0));
    } else if (this.sortBy === 'budget-high') {
      filtered.sort((a, b) => b.totalBudget - a.totalBudget);
    } else if (this.sortBy === 'remaining-high') {
      filtered.sort((a, b) => b.currentBudget - a.currentBudget);
    } else if (this.sortBy === 'cpm-high') {
      filtered.sort((a, b) => b.cpm - a.cpm);
    } else if (this.sortBy === 'alphabetical') {
      filtered.sort((a, b) => a.title.localeCompare(b.title));
    }

    // Update filter badge counters
    const totalLiveSpan = document.getElementById('totalLiveCount');
    if (totalLiveSpan) totalLiveSpan.innerText = this.campaigns.length;
    const filterPinnedSpan = document.getElementById('filterPinnedCount');
    if (filterPinnedSpan) filterPinnedSpan.innerText = this.campaigns.filter(c => c.pinned).length;
    const filterNewSpan = document.getElementById('filterNewCount');
    if (filterNewSpan) filterNewSpan.innerText = this.campaigns.filter(c => c.isNew).length;

    // Update Header Pin Selector Button Counter
    const btnPinCount = document.getElementById('btnPinCount');
    if (btnPinCount) btnPinCount.innerText = this.campaigns.filter(c => c.pinned).length;
    const btnTotalCount = document.getElementById('btnTotalCount');
    if (btnTotalCount) btnTotalCount.innerText = this.campaigns.length;

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align:center; padding:3rem; color:var(--text-muted);">
          <div style="font-size:2rem; margin-bottom:0.5rem;">🔍</div>
          <p>No campaigns match your filter or search query.</p>
        </div>
      `;
      return;
    }

    // Render Compact Table List View or Grid Cards View
    if (this.viewMode === 'list') {
      grid.className = 'campaigns-table-container';
      grid.innerHTML = `
        <div style="overflow-x: auto; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);">
          <table class="compact-directory-table">
            <thead>
              <tr>
                <th style="width: 80px; text-align: center;">PIN</th>
                <th>CAMPAIGN & BRAND</th>
                <th>CATEGORY</th>
                <th>TOTAL POOL</th>
                <th>REMAINING BUDGET</th>
                <th>CPM RATE</th>
                <th>LOOP ALERT</th>
                <th style="text-align: right;">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(camp => this.createCompactRowHtml(camp)).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else {
      grid.className = 'campaigns-grid';
      grid.innerHTML = filtered.map(camp => this.createCampaignCardHtml(camp, false)).join('');
    }

    this.attachCardEventListeners(grid);
  }

  createCompactRowHtml(camp) {
    const spent = Math.max(0, camp.totalBudget - camp.currentBudget);
    const percentSpent = Math.min(100, Math.round((spent / camp.totalBudget) * 100));
    const percentRemaining = Math.max(0, 100 - percentSpent);
    const interval = camp.milestoneInterval || 500;
    const isNearDepletion = camp.currentBudget < 1000;

    return `
      <tr class="${camp.pinned ? 'is-pinned-row' : ''}" data-id="${camp.id}">
        <td style="text-align: center;">
          <button class="table-pin-btn ${camp.pinned ? 'pinned' : ''}" data-action="pin" title="${camp.pinned ? 'Unpin' : 'Pin to Focus Watchlist'}">
            ${camp.pinned ? '📌 Pinned' : '+ Pin'}
          </button>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
            <span class="table-camp-title">${camp.title}</span>
            ${camp.isNew ? `<span class="badge" style="background:rgba(6,182,212,0.2); color:#38bdf8; border:1px solid #06b6d4; font-size:0.65rem;">NEW</span>` : ''}
          </div>
          <div class="table-camp-brand">${camp.brand}</div>
        </td>
        <td>
          <span class="badge" style="background:rgba(255,255,255,0.06); color:var(--text-muted); font-size:0.68rem;">${camp.category}</span>
        </td>
        <td>
          <span class="table-mono-val">$${Math.round(camp.totalBudget).toLocaleString()}</span>
        </td>
        <td>
          <div class="table-mono-val" style="color:${isNearDepletion ? 'var(--accent-rose)' : 'var(--text-main)'};">
            $${Math.round(camp.currentBudget).toLocaleString()}
          </div>
          <span style="font-size:0.7rem; color:${isNearDepletion ? 'var(--accent-rose)' : 'var(--text-dim)'};">
            ${isNearDepletion ? '⚠️ Ending Soon' : `${percentRemaining}% Left`}
          </span>
        </td>
        <td>
          <span class="badge badge-cpm">$${camp.cpm.toFixed(2)} CPM</span>
        </td>
        <td>
          <div class="milestone-pills" style="gap:0.25rem;">
            <button class="milestone-pill ${interval === 100 ? 'active' : ''}" data-action="set-interval" data-interval="100">$100</button>
            <button class="milestone-pill ${interval === 300 ? 'active' : ''}" data-action="set-interval" data-interval="300">$300</button>
            <button class="milestone-pill ${interval === 500 ? 'active' : ''}" data-action="set-interval" data-interval="500">$500</button>
          </div>
        </td>
        <td style="text-align: right;">
          <div style="display:inline-flex; align-items:center; gap:0.35rem;">
            <button class="btn btn-xs btn-outline-cyan" data-action="sync-balance" title="Sync newest balance">
              ✏️
            </button>
            <a href="${camp.url}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-secondary" title="View on Content Rewards">
              Open ↗
            </a>
          </div>
        </td>
      </tr>
    `;
  }

  createCampaignCardHtml(camp, isPinnedDeck = false) {
    const spent = Math.max(0, camp.totalBudget - camp.currentBudget);
    const percentSpent = Math.min(100, Math.round((spent / camp.totalBudget) * 100));
    const percentRemaining = Math.max(0, 100 - percentSpent);

    const interval = camp.milestoneInterval || 500;
    const currentLoopSpent = spent % interval;
    const progressToNextMilestone = Math.min(100, Math.round((currentLoopSpent / interval) * 100));
    const nextMilestoneIn = Math.round(interval - currentLoopSpent);

    const isNearDepletion = camp.currentBudget < 1000;
    const hoursLeft = camp.burnRatePerHour > 0 ? (camp.currentBudget / camp.burnRatePerHour).toFixed(1) : '∞';

    const initials = camp.brand ? camp.brand.split(' ').map(w => w[0]).join('').substring(0, 2) : 'CR';

    return `
      <div class="camp-card ${camp.pinned ? 'is-pinned' : ''}" data-id="${camp.id}">
        <!-- Top Row -->
        <div class="card-top">
          <div class="card-brand-row">
            ${camp.avatar ? `<img src="${camp.avatar}" alt="" class="card-brand-avatar" style="object-fit:cover;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><div class="card-brand-avatar" style="display:none;">${initials}</div>` : `<div class="card-brand-avatar">${initials}</div>`}
            <div class="card-title-col">
              <div style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
                <span class="card-title">${camp.title}</span>
                ${camp.isNew ? `<span class="badge" style="background:rgba(6,182,212,0.2); color:#38bdf8; border:1px solid #06b6d4;">✨ NEW</span>` : ''}
              </div>
              <span class="card-brand-name">${camp.brand} • <span style="color:var(--accent-cyan);">${camp.category}</span></span>
            </div>
          </div>
          <div class="card-actions-top">
            <span class="badge badge-cpm">$${camp.cpm.toFixed(2)} CPM</span>
            <button class="btn-pin ${camp.pinned ? 'pinned' : ''}" data-action="pin" title="${camp.pinned ? 'Unpin Campaign' : 'Pin to Focus Watchlist'}">
              📌
            </button>
          </div>
        </div>

        <!-- Budget Figures Row -->
        <div class="card-budget-row">
          <div class="budget-col">
            <span class="budget-label">Total Completed (Spent)</span>
            <span class="budget-val spent">$${Math.round(spent).toLocaleString()}</span>
            <span style="font-size:0.7rem; color:var(--text-muted);">${percentSpent}% Finished</span>
          </div>
          <div class="budget-col">
            <span class="budget-label">Remaining Pool</span>
            <span class="budget-val ${isNearDepletion ? 'critical' : 'remaining'}">$${Math.round(camp.currentBudget).toLocaleString()}</span>
            <span style="font-size:0.7rem; color:${isNearDepletion ? 'var(--accent-rose)' : 'var(--text-muted)'};">
              ${isNearDepletion ? '⚠️ Ending Soon (< $1K)' : `${percentRemaining}% Remaining`}
            </span>
          </div>
        </div>

        <!-- Progress Bar for Total Budget -->
        <div class="progress-box">
          <div class="progress-header">
            <span>Pool Depletion Progress</span>
            <span>$${Math.round(spent).toLocaleString()} / $${Math.round(camp.totalBudget).toLocaleString()}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${isNearDepletion ? 'depleting' : ''}" style="width: ${percentSpent}%;"></div>
          </div>
        </div>

        <!-- Notification Loop Configuration Box -->
        <div class="milestone-config-box">
          <div class="milestone-config-top">
            <span class="milestone-config-title">
              🔔 Loop Alert: Every <strong>$${interval}</strong>
            </span>
            <span class="milestone-status-tag">
              Next in: <strong>$${nextMilestoneIn}</strong> (${progressToNextMilestone}%)
            </span>
          </div>
          <div class="milestone-pills">
            <span style="font-size:0.68rem; color:var(--text-dim); align-self:center;">Interval:</span>
            <button class="milestone-pill ${interval === 100 ? 'active' : ''}" data-action="set-interval" data-interval="100">$100</button>
            <button class="milestone-pill ${interval === 200 ? 'active' : ''}" data-action="set-interval" data-interval="200">$200</button>
            <button class="milestone-pill ${interval === 300 ? 'active' : ''}" data-action="set-interval" data-interval="300">$300</button>
            <button class="milestone-pill ${interval === 500 ? 'active' : ''}" data-action="set-interval" data-interval="500">$500</button>
            <input type="number" class="custom-step-input" placeholder="Custom" data-action="custom-interval" value="${[100, 200, 300, 500].includes(interval) ? '' : interval}" title="Custom dollar step size" />
          </div>
        </div>

        <!-- Card Footer -->
        <div class="card-footer">
          <div class="velocity-stats">
            <span title="Estimated budget spent per hour">⚡ ~$${camp.burnRatePerHour || 180}/hr</span>
            <span>•</span>
            <span title="Estimated runway until budget reaches $0">⏳ ~${hoursLeft}h left</span>
          </div>
          <div class="card-btns">
            <button class="btn btn-xs btn-outline-cyan" data-action="sync-balance" title="Sync newest balance from Whop">
              ✏️ Sync
            </button>
            <a href="${camp.url}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-secondary" title="View campaign on Whop / Content Rewards">
              Open ↗
            </a>
          </div>
        </div>
      </div>
    `;
  }

  attachCardEventListeners(container) {
    container.querySelectorAll('[data-action="pin"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const card = e.target.closest('.camp-card');
        if (card) this.togglePin(card.dataset.id);
      });
    });

    container.querySelectorAll('[data-action="set-interval"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const card = e.target.closest('.camp-card');
        const interval = parseInt(e.target.dataset.interval, 10);
        if (card && interval) {
          this.setCampaignMilestoneInterval(card.dataset.id, interval);
        }
      });
    });

    container.querySelectorAll('[data-action="custom-interval"]').forEach(input => {
      input.addEventListener('change', (e) => {
        const card = e.target.closest('.camp-card');
        const val = parseInt(e.target.value, 10);
        if (card && val > 0) {
          this.setCampaignMilestoneInterval(card.dataset.id, val);
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') e.target.blur();
      });
    });

    container.querySelectorAll('[data-action="sync-balance"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const card = e.target.closest('.camp-card');
        if (card) this.openBalanceModal(card.dataset.id);
      });
    });
  }

  renderNotificationFeed() {
    const feed = document.getElementById('notifFeed');
    const empty = document.getElementById('notifEmpty');

    if (this.notifications.length === 0) {
      if (empty) empty.style.display = 'flex';
      feed.innerHTML = '';
      if (empty) feed.appendChild(empty);
      return;
    }

    if (empty) empty.style.display = 'none';
    feed.innerHTML = this.notifications.map(n => `
      <div class="notif-item">
        <div class="notif-item-left">
          <div class="notif-icon-ring">🎯</div>
          <div>
            <div class="notif-content-title">
              $${n.interval} Milestone Reached in ${n.campaignTitle}
            </div>
            <div class="notif-content-detail">
              Total Spent: <strong>$${n.totalSpentSoFar.toLocaleString()}</strong> • Remaining Pool: <strong>$${Math.round(n.remainingBudget).toLocaleString()}</strong> (${n.remainingPercent}% left) • ~${n.viewsGenerated} views
            </div>
          </div>
        </div>
        <div class="notif-time">${n.timestamp}</div>
      </div>
    `).join('');
  }

  updateStats() {
    const pinnedCount = this.campaigns.filter(c => c.pinned).length;
    const totalPool = this.campaigns.reduce((sum, c) => sum + c.totalBudget, 0);
    const totalCurrent = this.campaigns.reduce((sum, c) => sum + c.currentBudget, 0);
    const totalSpent = totalPool - totalCurrent;
    const percentSpent = totalPool > 0 ? Math.round((totalSpent / totalPool) * 100) : 0;

    document.getElementById('statPinnedCount').innerText = pinnedCount;
    document.getElementById('statTotalPool').innerText = `$${Math.round(totalPool).toLocaleString()}`;
    document.getElementById('statTotalSpent').innerText = `$${Math.round(totalSpent).toLocaleString()}`;
    document.getElementById('statSpentPercent').innerText = `${percentSpent}% finished`;
    document.getElementById('statMilestoneHits').innerText = this.totalMilestonesTriggered;
  }
}

let activeEditingCampaignId = null;

window.addEventListener('DOMContentLoaded', () => {
  window.whopTracker = new WhopRewardsTracker();
});
