# Reply test kit

Checks whether the local model (LM Studio on the Mac) writes comment and DM replies to the standard Graham wants, and
compares the live prompts with candidate ones. Free: the script only calls LM Studio. Claude reads the results once as a
judge and tutor; it is never called from here or from n8n.

Run on the Mac (LM Studio running, model loaded):

```
node ~/social-assets/loops/tools/reply-eval/run.js
```

Takes about 10 minutes. Writes `~/open-frame/reply-eval/<time>/summary.md` (scores table + every reply) and `results.json`.

- `cases.json`: 23 comments on 4 sample posts and 17 DMs, including anonymized real Inbox rows. Each has the right
  send/hold call and a reference reply (used only for grading).
- Variants: `c0` and `d0` are the live prompts (comment prompt read from `n8n/comment-replies.json`, DM prompt from
  `~/open-frame/dm-voice.md` on the Mac). `c1`-`c3`, `d1`-`d2` are candidates in `prompts/`. Drop a new
  `prompts/comment-v2.md` or `dm-v2.md` and it runs as `c-v2` / `d-v2`.
- Options: `--only c0,c2` `--reps 1` `--model <lm studio id>` `--out <folder>`.
- Rule checks per reply: first person, emoji, exclamation, em dash, @mention, hashtag, hype words, stiff phrases, prices,
  AI claims, links (comments), length. Plus whether the send/hold call was right and whether the n8n filter would drop it.
