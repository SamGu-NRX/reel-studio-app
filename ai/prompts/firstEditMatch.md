# Task: the first edit of a match clip

Turn this match clip into a finished vertical post for the club's account. The footage is fixed; you add the captions, the hook title, the player photo, a fact card or two, punch-ins, the cover and the post kit. Work through these steps in order. Keep tool calls lean: put every call that does not need an earlier call's result into the SAME reply.

## 1. Read

The project and the transcript are below; the match brief follows this task. Read the whole transcript with the brief beside it. Decide in one sentence what the moment is and at which second it turns (the shot, the card, the save): the brief's moment and the commentary's reaction ("he's scored!") tell you.

## 2. Captions

Proofread the commentary against the brief (its player list, its moment text, the venue). Commentary is fast and the speech model garbles it: read each sentence as the commentator meant it ("got the equalises" is "got the equaliser"). For each word in UNSURE WORDS, and for every name-like word, ask: is it a misheard name of a player the brief lists? If certain, call add_caption_correction with the whole misheard phrase and the brief's spelling. Leave everything else as heard, including names the brief does not list. Call set_caption_style only if a frame later shows a real problem.

## 3. Pictures

Call list_library with kind images. Its files are the brief's player photos, named after each player. For the key player, call resolve_asset kind image with the photo's path as intent, LOOK at the still (a player headshot), and commit it. A second player's photo only if the commentary clearly names them.

## 4. Place

In ONE reply:
- the hook title: add_broll text-pop, params.style "label", params.tilt 0, params.text 3 to 7 words stating the moment from the brief, anchored from the first word for about 2 to 4 seconds;
- the key player's photo: add_broll card-above-head (or side-card) with the committed assetId, on the words where the commentary names them, or the words right after the moment turns; about 2 to 3 seconds; never over the key action itself;
- one fact card (text-pop, params.style "label"): the minute and the score after the moment in one line, only what the brief gives, placed after the key action on at least 2 seconds of words;
- set_zoom with 1 to 3 punch-ins: one on the phrase over the key action (scale about 1.15), maybe one on the reaction or celebration; never two back to back.

## 5. Cover

Call cover_candidates with 3 to 4 word ids around the moment and the celebration or reaction, in the same reply as render_draft. In your next reply call set_cover with the atSourceTime of the clearest still, with text of 1 to 3 words carrying the moment.

## 6. Post kit

Call write_post with:
- caption: two or three short lines in the club's voice. Start from the brief's planned caption, keep its facts, tighten it. No claims the clip or the brief does not make, no em dashes.
- hashtags: EXACTLY 5. Start from the brief's planned hashtags; add the club's or the match's own tags to make 5.
- keywords: 3 to 6 phrases a fan would search (player, clubs, the moment).

## 7. Render and look

Call render_draft (with cover_candidates in the same reply). Then call look_at_frames once with 4 to 6 times: about 1 s (the hook title), the photo, the key action, and the last second. Check what your doctrine lists. Fix only real problems (a misspelled name, a card over the action, unreadable text, a wrong photo). If you changed anything visible, render_draft again. Do not render more than twice unless something is broken.

## 8. Finish

Call finish with 1 to 3 plain sentences for the producer: what is on screen (the hook title, whose photo, the cards, the punch-ins) and any name you corrected. No jargon, no em dashes.
