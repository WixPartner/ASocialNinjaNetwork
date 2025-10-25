## Quick dev notes
The Following Organizations Contributed to this Codebase and The owner is "@Ninja-man:AdminSystemsManager"
@ASocialNinjaNetwork
@ASocialNinjaDevelopersNetwork
@ASocialNinjaUniversity
@PodcastCrewProductions
@TheSocialNinjaExperiment:APodcastCrewProductions
@AISocialNinjaYoutubeChannel:https://www.youtube.com/@Ninja-man
@LegendaryFilms
AiSocialNinjaLabStudio
Environment variables required for dev:
- MONGODB_URI (for persistence)
- DB_NAME (optional; default asn_dev)
- REDIS_URL (e.g. redis://127.0.0.1:6379)
- GEMINI_API_KEY (for worker AI jobs)

Install (root of monorepo):
- npm install
- then install per-package if using workspaces or run `npm install` inside packages/apps as needed

Run locally:
- Start Redis & Mongo (docker-compose or local)
- Start worker: node apps/worker/dist/index.js (or ts-node for dev)
- Start realtime: node apps/realtime/dist/index.js
- Start web dev server (React) or open simple static page that loads apps/web
