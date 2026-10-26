# Lessons

Written by the weekly improvement review (Claude, thread "Self-running agent loops"). The ideas loop reads the newest 15 lines.

- 2026-10-21: First run. No lessons yet.
- 2026-10-25: No Yes/Pass answers on loop cards yet, so nothing to tune from taste. The 19 scripts in Studio are waiting to be filmed; ideas should stay on these proven topics (website clutter, menus, brand systems, building in public) until answers come in.
- 2026-10-25: Google post (2/2) and spotlight (1/1) drafts failed the self-check with no reason logged. Reasons are now written to Loop runs; next review tunes the prompt from them.
- 2026-10-25: Loop runs stopped after Oct 22 12:00 (Mac time). Failures used to go only to the pm2 log; they now land in Loop runs with status fail.
- 2026-10-26: Failure logging showed the cause: Hub calls fail on network blips ("fetch failed", Google's busy page) and LM Studio times out at 4 minutes when shared with reel-watch, so Monday's ideas run was lost. Hub calls now retry 3 times, LM Studio gets a second, longer try, and a failed scheduled loop retries twice more 20 minutes apart.
