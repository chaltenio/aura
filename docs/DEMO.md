# Demo script (2 minutes) and pitch

## Setup (5 minutes before)
1. Server up: Fly URL from `scripts/deploy.sh status`, or `npm start` + `npm run tunnel` on a laptop.
2. Open `/screen` on the TV. It shows the join QR, counters and the live feed.
3. Two team members already registered with 3 selfies each (lighting of the room, not a hallway).
4. Phones: sound on, ringer switch not on silent, `/me` open on the "victim" phone with sound armed.

## The 2 minutes
| t | Say | Do |
|---|---|---|
| 0:00 | "Point your phone at someone in this room and know who they are. Opt-in only. Faces never leave the phone." | Show `/screen` QR. |
| 0:15 | "Registration is 60 seconds: name, GitHub, consent, three selfies. Only a 512-number signature is uploaded." | Scan QR on a judge's phone, register them live. |
| 0:50 | "Now I hunt." | `/hunt`, point at the judge, card appears with name, handle, bio, pushes this week, recent repos. |
| 1:10 | "And I haunt them. Now they can haunt me back." | Tap Haunt. Their phone shrieks and flashes "You've been haunted by ...". The judge taps **Haunt back** on that alert; the presenter's phone shrieks "... haunted you back!". Screen feed updates. |
| 1:30 | "Every match is computed on the phone: a detector, landmarks, an aligned ArcFace crop, a 7 MB open-source embedder. The server only ever sees signatures and events." | Show `/calibrate` matrix if asked how good it is. |
| 1:50 | "Kill switch: one tap and you vanish from every phone." | Toggle Findable off on `/me`; the hunter's phone stops naming them. |

## Numbers to have ready
- Strangers score at most 0.36; the same person scores 0.47 to 0.79 across years of photos; threshold 0.4 (RESEARCH.md section D).
- Models: 9 MB Human + 7 MB FaceX, cached after first load; 3 to 5 fps on an iPhone.
- Built today from an empty folder; see docs/INTEGRATION_LOG.md and the commit history.

## Likely questions
- **Privacy / consent?** Opt-in toggle at registration, gallery only serves consenting people, kill switch is immediate, server data is deleted after the event, no face ever goes to a hosted model (Anthropic policy and our rule).
- **Why not an app?** One URL, works in iOS Safari and Android Chrome, nobody installs anything at a conference.
- **Lookalikes / twins?** Abstain band and 3-frame vote; a wrong name on a stranger is the failure we tuned against.
- **What do I get out of it?** /me lists tonight's connections with GitHub/LinkedIn links; one tap copies them.
- **Where do the agents come in?** Shelled built features X and Y (see EDGE_CASES.md); the matchmaker / narrator (if landed) use Claude for names and events only.

## Proof of launch (rules require one)
- A 2-minute phone video of the table above, or an X post with the public link and a screenshot of `/screen`.
