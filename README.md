# Beast Vote 💖

Live pink voting game with QR codes, emoji pops, and meme sounds.

```
npm start
```

The terminal prints:
- **QR sheet**: `http://<your-ip>:3000/`, with all 4 QR codes and links (printable)
- **Host screens**: `/host/q1?key=…` … `/host/q4?key=…`. Open these on the laptop or projector and keep the key private.
- **Voter links**: `/v/q1` … `/v/q4` (these are what the QR codes open)

Phones must be on the same Wi-Fi as this laptop. Turn the VPN off if phones can't connect.

## Flow
1. Open the host screen and tap **Let's go** to enable sound.
2. Click **Start voting**. The 3:00 timer starts. People scan and vote; counts stay hidden.
3. When the timer ends, voting closes. Nothing is revealed automatically.
4. Click **Reveal answer**. A drumroll plays, then the results and question-specific sounds play on every screen.
5. Click **Next question**. **Reset** clears a question's votes.

## Settings (env vars)
| var | default | |
|---|---|---|
| `PORT` | 3000 | |
| `ADMIN_KEY` | random, saved in data.json | host key |
| `VOTE_SECONDS` | 180 | voting length |
| `LAN_IP` | auto (Wi-Fi) | IP used in QR links |
| `PUBLIC_URL` | – | e.g. a tunnel URL, used in QR links instead of the LAN IP |

Winners and question text are in `questions.js`. Votes are saved in `data.json`.
