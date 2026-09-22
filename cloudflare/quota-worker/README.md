# Cognitus Discord Quota System

The quota system lives entirely in this `staff-cognitus` repository.

## What was added

- `#/quota` — every active staff member can see their own live Discord quota.
- `#/admin/quota` — authorized leadership can see everybody, search/filter staff, set custom targets, add exemptions, add manual message adjustments, and change the quota policy.
- `cloudflare/quota-worker/` — Cloudflare Worker + Durable Object + D1 schema.
- Discord message **contents are never requested or stored**. The Gateway connection uses intents `GUILDS + GUILD_MESSAGES` only and stores aggregate message counts.

## Cloudflare setup

From `cloudflare/quota-worker`:

1. Create the D1 database:
   `npx wrangler d1 create cognitus-quota`

2. Put the returned database ID into `wrangler.toml`.

3. Put the Cognitus Discord server ID into `DISCORD_GUILD_ID` in `wrangler.toml`.

4. Apply the schema:
   `npx wrangler d1 execute cognitus-quota --remote --file=./schema.sql`

5. Store the Discord bot token as a Cloudflare secret:
   `npx wrangler secret put DISCORD_BOT_TOKEN`

6. Deploy:
   `npx wrangler deploy`

7. Add the Worker custom domain:
   `quota-api.cognitus-solutions.org`

The portal already points to that hostname.

## Discord application

The bot must be installed in the Cognitus Discord server. The quota tracker does **not** need Message Content intent.

After the Worker is deployed, open **Staff / Command → Quota Administration → Quota Settings** and enter:

- the Discord role ID(s) that identify Cognitus staff;
- optional channel IDs that are allowed to count;
- optional channel IDs that must never count;
- the default message requirement and quota period.

If Included Channels is blank, all server channels count except those in Excluded Channels.

## Authorization

Staff can only call `/api/me`.

Organization-wide quota APIs require Owner / Co-Owner or existing Cognitus leadership permissions such as staff management, HR records, permissions management, system management, or audit access.

The Worker validates the caller's existing Firebase ID token through Firestore before returning quota data. No new Firestore collections or Firestore Security Rules are required.

## Data stored in D1

Only quota metadata is stored:

- Firebase staff UID ↔ Discord user ID mapping
- daily aggregate message counts per staff member/channel
- last qualifying activity timestamp
- quota periods and targets
- exemptions
- manual adjustments
- quota audit entries

Message text, attachments, embeds, reactions, and message bodies are not stored.
