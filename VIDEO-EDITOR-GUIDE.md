# Video editor (added in v1.24.0)

When someone picks a video on the Create page, an editing screen opens. Nothing is uploaded until they tap **Export and post**. Then the edited video is uploaded and posted in one step, using the caption already typed. The original is never uploaded.

## What it does
- **Trim** the start and end (blue handles or typed times).
- **Remove sections** from the middle (orange handles, then "Remove section"). Several sections can be removed. They are joined into one video. Undo, redo and "Restore" are included.
- **Appearance**: brightness, contrast, saturation, warmth. Each has its own Reset, plus "Reset all adjustments" and a before/after button.
- **Preview** plays only the kept parts, in order, with the color changes applied.
- **Export** records a new video file on the device. The new file contains only the kept footage, the color changes and the matching sound (unless "Remove the sound" is ticked).

## How it works, and what it costs
- Everything runs in the browser on the phone or computer. No server, no extra service, no extra cost, no new library. Appwrite is not involved until the edited file is uploaded the same way as before.
- The edited video is re-recorded while it plays. Exporting takes about as long as the edited video (50 seconds of video takes about 50 seconds). The page must stay open and on screen.
- Because it re-records, the picture is re-compressed once. The size menu (about 480p, 720p, 1080p, or the original size up to 1080p) changes quality and file size.
- Output is MP4 where the browser can write it, otherwise WebM. Input is anything the browser can play (MP4, MOV, WebM).
- Limits in `config.js`: `editorMaxInputMB` (300) and `editorMaxSeconds` (300). The sound is held in memory while editing, so very long videos are refused on purpose.
- The upload limit is still the family's `maxVideoMB`. The editor checks the exported size against it before anything is uploaded.
- No Appwrite changes and no new function deployment are needed for this feature.

## Why not FFmpeg in the browser
FFmpeg for the browser downloads about 30 MB, runs slowly on phones, and its faster multi-thread version needs special security headers that GitHub Pages does not let you set. Re-recording needs none of that.

## Install, deploy, test (beginner steps)
1. Open your `FamilyCircle` repository on GitHub. Click **Add file → Upload files**.
2. Drag in these changed files from the project folder: `video-editor.js`, `app.js`, `styles.css`, `index.html`, `config.js`, `VIDEO-EDITOR-GUIDE.md`. (If you already got them from the push, skip steps 1 and 2.)
3. Click **Commit changes**. GitHub Pages republishes by itself in about a minute.
4. Open the site and hard-refresh (phone: close the tab and reopen it; computer: Ctrl+Shift+R). The footer should say **1.24.0**.
5. Go to **Create → Video** and choose a short video. The editing screen should open. Nothing should upload yet.
6. Drag the blue handles, or type times into Start and End.
7. Move the orange handles around a part, tap **Remove section**, and do it again for a second part. Tap **Play** and check it jumps over the removed parts.
8. Move the Brightness slider. Tap **Show original colors** to compare, then tap it again.
9. Tap **Export and post**. Keep the screen on until it finishes.
10. The editor closes and the video uploads and posts by itself. You land on the feed.
11. Find the post and play it. The removed parts should be gone and the sound should match the picture.
12. Download the video from the post's ⋯ menu and play it in your phone's normal video app to confirm it plays outside the site.
13. Privacy check: sign in as someone from a different family (or a second account) and confirm they cannot see the post or the file.

## What was checked, and how
Checked on the exported files with ffprobe/ffmpeg, plus by decoding the file in a browser (desktop Chromium):
- Trim both ends plus two removed sections: the exported file had the expected length and the right sections in the right order. A tone that changes pitch every second matched the original second at every sample point, so the sound stayed in sync.
- Portrait (180×320) and landscape (320×180) both exported at their own shape.
- Brightness, contrast, saturation and warmth were measured in the exported pixels and matched the formula used by the preview (within a few levels).
- WebM from Chromium has no length stored in it. The editor writes one in, and the result reports a length and can be seeked.
- Cancel during export, cancel with unsaved edits, errors for unreadable files, too-long files, too-big files, a too-big export, and a short that is too long.
- Only the edited file reached the upload call. The original never did.

Not checked (no device available here): iPhone/Safari, Android Chrome, Firefox, real phone memory limits, HEVC or 4K input, videos near the 5-minute limit, and the H.264 MP4 path some browsers use. Please test on the phones your family uses before relying on it.

## Known limits
- Right after a cut, the picture can trail the sound by a few frames. The sound itself is exact.
- If the page goes to the background during export, the export stops and your edits are kept.
- A video with no readable sound exports without sound, and the editor says so.
- "Also keep the original" was not added.
