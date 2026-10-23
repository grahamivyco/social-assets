# Viral scout

Liz's method, automated: watch the top creators in the niche, save every video that blew up, find what repeats, rebuild it in Open Frame's voice. Free tools only.

## How it works
1. **Every Monday 7:30** n8n "Open Frame viral scout" reads the creators to study from the "Open Frame outreach" Sheet:
   - `Viral creators` tab (handle, status, note): the big names Graham adds by hand. Blank status or `active` = checked.
   - `Creators` tab: the brand scout's `active` creators.
   Up to 50 a week.
2. Instagram's own API (business_discovery, the "Open Frame Page" credential) returns each creator's last 50 posts with likes and comments. It works only for creator and business accounts.
3. **Outlier rule:** a Reel counts when likes + 3 × comments is at least **3×** that creator's median over the last 12 months (at least 8 posts). Up to 3 per creator a week. A fixed bar like "2M views" only fits huge niches; beating their own normal works for any size. Instagram doesn't give view counts for other accounts.
4. New outliers go to the `Outliers` tab and to the watch tool on the Mac (`127.0.0.1:5680/scout`), which downloads, transcribes and runs the edit breakdown.
5. **Every Monday 12:00** `patterns.py` (pm2 cron) writes `Watched/_patterns/<date>.md`: medians (length, words per minute, cuts, shot length, captions), the local AI's read of repeating hook formulas, formats, edit patterns and topics, 5 rebuilds for Open Frame, and a hook bank. `_patterns/hook-bank.md` keeps every hook.

Videos Graham shares himself ("Watch with Claude") land in the same report as "saved".

## Setup on the Mac (once)
1. Sheet "Open Frame outreach": tabs `Viral creators` (handle, status, note) and `Outliers` (permalink, handle, followers, posted, likes, comments, ratio, caption, status, found_at).
2. n8n: Import from URL `https://raw.githubusercontent.com/grahamivyco/social-assets/main/watch/scout/n8n-viral-scout.json`, pick the Google service account in the 3 Sheet nodes and "Open Frame Page" in the IG node, then Publish.
3. `pm2 restart video-watch` (for the /scout route).
4. `pm2 start ~/social-assets/watch/patterns.py --name viral-patterns --interpreter python3.13 --cron "0 12 * * 1" --no-autorestart && pm2 save`
5. LM Studio running with `qwen/qwen3.5-9b` on Monday at noon (same as the DM replies). Without it the report still has the numbers and hook bank.

## Files
- `code/creators-to-check.js`, `code/find-outliers.js`: the n8n Code nodes. `build-workflow.py` builds `n8n-viral-scout.json`.
- `../patterns.py`: the report.
