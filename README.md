# WhopClip Radar 🎯

> **Real-time Campaign Pool Tracker & Milestone Loop Notification Engine for Whop Content Rewards clippers.**

![WhopClip Radar](https://raw.githubusercontent.com/sandeepthej/whop-rewards-tracker/main/preview.png)

## ⚡ Overview

**WhopClip Radar** is a specialized real-time tool built for video clippers participating in **Whop Content Rewards**. It connects directly to live Content Rewards campaign feeds, tracks remaining budget depletion down to the cent across 77+ active campaigns ($1.3M+ total pool), and automatically fires notifications every time a campaign completes a milestone (e.g., every $100, $200, $300, or $500 finished from pool).

---

## 🌟 Key Features

- **⚡ Direct Live Access to 100% of Content Rewards Campaigns**:
  - Pulls real-time data from Content Rewards' live React Server Component stream (`/c/discover`).
  - Monitors all 77+ live campaigns ($1.32M+ in total prize pools) including *ForgeGUI*, *Boxabl*, *Pet Simulator 99!*, *Kai Cenat*, *SoFi*, *Decentraland*, *Mark Manson*, *LACY*, etc.
- **✨ Auto-Discovery of New Campaigns ("New Drop" Engine)**:
  - Continuously polls in the background every 30 seconds.
  - When a brand launches a new campaign, it is automatically detected, prepended to your list with a `✨ NEW` badge, and triggers alert chimes and Discord notifications.
- **🔁 Continuous Looping Milestone Notifications**:
  - Configurable notification step size ($100, $200, $300, $500, or custom).
  - Every time that chunk is completed from the pool, triggers:
    - 🔊 Procedural Web Audio chimes (synthesized cash/level-up arpeggios).
    - 🔔 Desktop system push notifications.
    - 💬 Discord Webhook alerts with rich embeds.
    - 📋 Live timestamped audit log.
- **📌 Interactive "Choose & Pin" Campaign Selector**:
  - Instant modal with real-time search to quickly find and pin your priority campaigns.
  - Shortcuts to pin top pools or high-CPM campaigns with 1 click.
- **📋 Dual View Modes**:
  - **Compact List Table** for fast scanning of all 77 campaigns without endless scrolling.
  - **Cards Grid View** for full visual progress metrics and runway estimates.
- **⚡ Clipper Payout & Runway Calculator**:
  - Enter your projected clip views to instantly see your dollar payout and verify whether the remaining pool can cover it.
- **🔒 Zero-Auth Safe**:
  - No Whop login, passwords, session cookies, or private API keys required.

---

## 🚀 Quick Start

### 1. Clone the repository
```bash
git clone https://github.com/<your-username>/whop-rewards-tracker.git
cd whop-rewards-tracker
```

### 2. Install dependencies
```bash
npm install
```

### 3. Start local development server
```bash
npm run dev
```

Open `http://localhost:5173/` in your browser.

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla HTML5, Modern CSS3 (Dark Fintech Design System, Glassmorphism), Vanilla ES6+ JavaScript.
- **Audio Engine**: Procedural Web Audio API synthesizer (zero external audio files).
- **Backend / Proxy**: Vite dev server custom middleware for direct RSC stream fetching.
- **Alerts**: Web Audio API, Notification API, Discord Webhooks.
- **Storage**: Browser LocalStorage for persistent pins, custom loop intervals, and webhook URLs.

---

## 📄 License
MIT License. Created for Content Rewards Clippers.
