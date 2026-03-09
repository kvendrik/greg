## Features

- [ ] Make search through transcripts possible for Greg
- [ ] pre‑exec approval exists, but pre‑exec policy for auto‑blocking dangerous patterns is still not implemented.
- [ ] Web search retry strategy: limit to 1–2 distinct failures, then mark search as unavailable and move on to avoid latency and noise. Implement alternative search.
- [ ] Add CLIs for WhatsApp, Telegram, and iMessage to include messaging in morning updates
- [ ] Give Greg a way to make calls

## Bugs

- [x] After a `/stop` call and a new prompt the agent continues where it left off
- [ ] Sometimes number don't have spaces before them in messages

Optional

- [ ] When a tool has an error Greg should report it by creating a GH issue for himself
- [ ] Notes save things like "Showed Koen Pragmatic Engineer email" but it doesn't then also save the link. This is where full thread transcripts search would come in handy.
