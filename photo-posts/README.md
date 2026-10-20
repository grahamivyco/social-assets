# Guild photo posts

Real guild photos in, branded carousels and single posts out (Needlework Guild of Minnesota brand: sage, rose, Cormorant Garamond, DM Sans, the Minnesota thread logo).

## How it works

1. **Collect** photos into an inbox, one folder per post.
2. **Note** credits, consent and captions in `photos.csv` (optional but flagged if missing).
3. **Render** with `make-posts.js`. Out come 1080x1350 JPGs, 3 caption options per post, draft queue rows and a review checklist.
4. **Approve**: check `review.md`, pick a caption, then the images go to social-assets and the rows go to the queue Sheet as `draft`.

## Where photos come from

| Source | Works now? | How |
|---|---|---|
| Content Inbox in Drive, folder "Needlework Guild" | Yes | Drop photos in a subfolder named for the post (like `retreat`). Tell Claude in the project to make posts from it. |
| A folder on Graham's Mac | Yes | Same folder layout. Run the script locally or ask Claude to pull it. |
| Guild website photos | Yes | Already pulled once (31 photos, `ngm-photos/` on the Mac). |
| Guild Instagram | Yes, if the guild IG is a business or creator account | `collect-ig.js` reads its public posts through Open Frame's IG account (Business Discovery). No guild admin needed. |
| Guild Facebook Page | No | Needs Graham as admin on the Page. Then the Graph API can pull Page photos and member posts the same way. |
| Member submissions | Yes | Members email or text photos to Graham, he drops them in the Drive inbox. Ask for name + OK to post in the same message. |

## Inbox layout

```
inbox/
  retreat/            -> carousel (3+ photos: photo cover, framed slides, end card)
    01-group.jpg
    02-tables.jpg
    photos.csv
  come-and-stitch/    -> pair post (2 photos)
  monthly-meeting/    -> single post (1 photo)
    post.json         -> optional: own kicker, title, body, captions
  loose-photo.jpg     -> single post
```

Folder names with built-in copy: `come-and-stitch`, `tea-and-stitch`, `retreat`, `member-work`, `workshop`, `library`. Anything else uses general guild copy, or its `post.json`.
Files are used in name order, so number them. The first photo is the cover.

## photos.csv columns

```
file,caption,credit,quote,people,consent,focus
```

- caption: line under the photo. `*word*` is the italic rose accent
- credit: shows as "Photo: name" and in the caption
- quote: a member's own words, shown instead of the caption
- people: yes if faces are in it
- consent: yes, or no to leave the photo out
- focus: crop point, like `center 30%` to keep heads in frame

## Run it

Once, in this folder:

```
npm install
```

Each time:

```
node make-posts.js ~/path/to/inbox ./out --date 2026-10-27
```

Pull guild Instagram photos (Page token from the n8n "Open Frame Page" credential):

```
IG_TOKEN=paste-token-here node collect-ig.js ./inbox/from-instagram
```

## Rules baked in

- Every post gets 3 captions with a full https:// link on its own line after a blank line
- IG carousels max 10 cards, so 8 photos max per carousel
- iPhone HEIC photos convert automatically on a Mac
- Photos with people and no recorded consent are flagged in `review.md`. Photos with consent=no are skipped
- Do not use class-project photos from Retreat teachers (Summer House Stitche Workes, Maggie T) without their OK. They are the designers' images
