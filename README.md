# Doc Manager - Full Project

A private document workspace: sign in with Google or Apple, organize files (max 20 MB) in
folders like Google Drive, and share chosen documents through public links that you can turn off
at any time. Every action is recorded in an activity log (with browser and device), unexpected
errors are emailed to the addresses in the `application_configs` collection, and
`/app/health-check` reports the app's health.

This project contains two folders:
- doc-manager-api/ -> Node.js + Express + GraphQL Yoga API (MongoDB via Mongoose, file bytes in GridFS)
- doc-manager/     -> Vite + React frontend (Bootstrap, light/dark design system, pdf.js viewer)

Quick start (development):
1. `doc-manager-api/`: copy `.env.example` to `.env`, set `MONGO_URI` and your Google/Apple keys (and `SMTP_*` for emails), then `npm install`, `npm run seed-config` and `npm run dev`.
2. `doc-manager/`: `npm install`, `npm run dev`, open http://localhost:5173.

See each README for details, and GRAPHQL_GUIDE.md for a step-by-step guide to how GraphQL is used.


application_configs:
{
   app_name: "Document Manager",
   exception_mail: ["subash.eswaramoorthi.work@gmail.com  ", ]
}