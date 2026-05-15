# playchart-bot

Discord bot for [Playchart](https://playchart.gg). Long-running Node process. Talks to the Playchart app over an authenticated HTTP API — no direct database access.

```
// PING //
// PONG // rt 47ms / ws 84ms
```

## Quick start

```bash
# 1. Install
npm install

# 2. Copy env template and fill in values
cp .env.example .env
# Edit .env — see comments inside for what each value is

# 3. Register slash commands with Discord (one-time, per environment)
npm run register

# 4. Run the bot
npm run dev
```

If everything's wired up, the bot will log `// READY //` and you can run `/ping` in your server.

## Architecture

- **Long-running process.** Connects to Discord's gateway via WebSocket. Stays online.
- **Hosted on Railway.** One service, one process.
- **No database access.** All data comes from `playchart.gg/api/bot/*`. Auth via bearer token.
- **Cron jobs in-process.** `node-cron` triggers the weekly poll. No external scheduler.

```
┌─────────────┐    bearer    ┌──────────────────┐
│ playchart   │ ◀──────────  │  playchart-bot   │
│   .gg API   │              │   (Railway)      │
└─────────────┘              └────────┬─────────┘
                                      │ gateway
                                      ▼
                              ┌──────────────────┐
                              │     Discord      │
                              └──────────────────┘
```

## Project layout

```
src/
  index.ts              entry point — wires client, events, jobs
  env.ts                env var validation (fail fast on boot)
  commands/
    index.ts            registry of all commands
    ping.ts             sanity-check command
  events/
    ready.ts            fires when gateway connects
    interactionCreate.ts  routes slash commands to handlers
  jobs/                 (cron jobs — wired in Step 6)
  lib/
    api.ts              Playchart API client
    log.ts              tiny logger with brand-voice prefixes
scripts/
  register-commands.ts  one-time: push slash command defs to Discord
```

## Adding a new command

1. Create `src/commands/<name>.ts` exporting `{ data, execute }`.
2. Import it in `src/commands/index.ts` and add to the `commands` array.
3. Run `npm run register` to push the new command def to Discord.
4. Restart the bot (`npm run dev` will auto-restart).

That's the whole pattern. No autoloading magic.

## Deploying to Railway

1. Push this repo to GitHub.
2. In Railway, "New Project" → "Deploy from GitHub repo" → pick this repo.
3. Set environment variables in Railway's UI from `.env.example`.
4. Set the start command to `npm run build && npm start` (or rely on `npm start` if Railway runs build automatically — it usually does).
5. Deploy. The bot should come online within a minute.

After the first deploy, also run `npm run register` once locally with `DISCORD_GUILD_ID` set to your prod guild (or unset, for global registration). Discord stores command definitions on their end — you only need to update them when you add or change commands.
