# Media Hub · SEIL

Password-protected internal tool (GitHub Pages):

1. **הפיכת אקסל למצגת** – Excel / links → "Media Sample Reviews" PowerPoint + Golden Sample update.
2. **עדכון סיכום תכנים ברשתות** – refresh Instagram / TikTok / Facebook / YouTube views in the Techie content summary Excel.

All data (history, golden sample, settings, tokens) is stored **encrypted** (AES-256-GCM, PBKDF2-SHA256 600k) – settings in `config.enc` on `main`, data on the `data` branch.
Scraping runs through Apify; optional Claude API for headline translation & positive quotes.
