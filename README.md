# Grain Ticket Scanner

Mobile-first React + Express app for scanning grain elevator tickets, reviewing extracted fields, and saving approved rows to Google Sheets.

## Project Structure

```text
server/index.js       Express API, OpenAI OCR, Google Sheets writes, dropdown reads
src/main.jsx          React mobile UI and review workflow
src/styles.css        Mobile-first app styling
index.html            Vite frontend shell
netlify.toml          Netlify frontend build config
render.yaml           Render backend starter config
.env.example          Local and hosted environment variable reference
```

## Current Sheet Layout

Rows are written to `Form Responses 1` with the existing blank column B preserved:

```text
A Timestamp
B blank
C Date?
D Crop?
E Ticket number
F Bushels
G Delivered To
H Hauled By
I Moisture
J Hauled From
```

Ticket numbers are saved as text so leading zeros are preserved.

## Dropdown Tabs

Create these tabs in the same Google Sheet:

```text
Bins
Haulers
Destinations
```

Put dropdown values in column A, starting on row 2. Row 1 can be a header.

Examples:

```text
Bins!A1 = Bin Name
Bins!A2 = House 42 ft
Bins!A3 = House Back 24 ft

Haulers!A1 = Hauler
Haulers!A2 = Eli
Haulers!A3 = Dennie

Destinations!A1 = Destination
Destinations!A2 = Rock Port
Destinations!A3 = Gavilon
```

The app loads these values from Google Sheets on page load, refreshes them about once per minute, and refreshes when the browser regains focus. Missing tabs are handled gracefully; users can still choose `Other` and type a value.

The backend also includes starter dropdown values so the app is usable even before the tabs are filled out:

```text
Destinations: Rock Port, Purdue, GPC, Newburgh, CO-OP, Bunge
Haulers: Todd, Denie, Jeremy, Jared, Zac, Eli
Bins: Joe Gray 30 ft, House 42 ft, House Front 24ft, House Back 24ft, 30ft ft By Jared's, 18ft By Jared's, 42 ft By Jared's, Shivers Bin by Jared's, 27 ft On Hill By Jared's, Buchta Front 24 ft, Buchta Back 24 ft, Field, Fall out of Bin, House 48 ft
```

Values added to the sheet tabs are merged into those starter lists.

## Environment Variables

Required backend variables:

```text
OPENAI_API_KEY=your_openai_api_key_here
GOOGLE_SHEET_ID=1yujW3z162d55zZou-cLZLkp8_ve1-gbqI2MjVRP_fWE
GOOGLE_SHEET_TAB=Form Responses 1
GOOGLE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
CORS_ORIGIN=http://localhost:5173
```

Use this locally:

```text
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./google-service-account.json
```

The backend prefers `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY`. It only falls back to `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` when that local file exists. You can also use this hosted fallback if you prefer pasting the whole service account JSON:

```text
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

Optional:

```text
PORT=3001
DROPDOWN_CACHE_MS=60000
```

Required frontend variable on Netlify:

```text
VITE_API_URL=https://your-render-api-url.onrender.com
```

For local frontend development:

```text
VITE_API_URL=http://localhost:3001
```

## Local Setup

1. Install Node.js LTS.

2. Install packages:

   ```bash
   npm install
   ```

3. Create `.env`:

   ```bash
   cp .env.example .env
   ```

4. Add your OpenAI key and Google settings to `.env`.

5. Put the Google service account key in the project folder:

   ```text
   google-service-account.json
   ```

6. Share the Google Sheet with the `client_email` from the JSON key and give it Editor access.

7. Start locally:

   ```bash
   npm run dev
   ```

8. Open:

   ```text
   http://localhost:5173
   ```

## Render Backend Deployment

1. Push this project to GitHub.

2. In Render, create a new **Web Service** from the repo.

3. Use:

   ```text
   Build Command: npm install
   Start Command: npm start
   ```

4. Add backend environment variables in Render:

   ```text
   OPENAI_API_KEY
   GOOGLE_SHEET_ID
   GOOGLE_SHEET_TAB
   GOOGLE_CLIENT_EMAIL
   GOOGLE_PRIVATE_KEY
   CORS_ORIGIN
   DROPDOWN_CACHE_MS
   ```

5. For `GOOGLE_CLIENT_EMAIL`, use the `client_email` value from your service account JSON.

6. For `GOOGLE_PRIVATE_KEY`, use the `private_key` value from your service account JSON. Keep the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` text. If the key contains `\n`, leave those escaped newline characters in place.

7. Set `CORS_ORIGIN` to your Netlify site URL after Netlify is created.

8. Deploy and copy the Render service URL.

On startup, Render logs should say:

```text
Google Sheets credentials source: environment variables
```

## Netlify Frontend Deployment

1. In Netlify, create a new site from the same GitHub repo.

2. Netlify will use `netlify.toml`:

   ```text
   Build Command: npm run build
   Publish Directory: dist
   ```

3. Add this Netlify environment variable:

   ```text
   VITE_API_URL=https://your-render-api-url.onrender.com
   ```

4. Deploy the site.

5. Go back to Render and set:

   ```text
   CORS_ORIGIN=https://your-netlify-site.netlify.app
   ```

6. Redeploy Render after changing `CORS_ORIGIN`.

## Daily Use

1. Hauler opens the Netlify link.
2. Hauler takes or uploads a ticket photo.
3. App extracts Date, Crop, Ticket number, Bushels, Delivered To, and Moisture.
4. Hauler reviews and edits fields.
5. Hauler chooses or types Hauled By and Hauled From.
6. Hauler submits.
7. App shows `Ticket submitted successfully`.
8. Row appears in Google Sheets.

## Updating Dropdown Values

No code changes are needed.

Edit the Google Sheet tabs:

```text
Bins
Haulers
Destinations
```

Add, remove, or rename values in column A. The app will pick them up after the short cache expires or when users reload/refocus the app.

## Recommended Commit Messages

```text
Add Google Sheets driven dropdowns
Harden ticket submit validation and sheet writes
Add mobile success flow for harvest use
Prepare Netlify and Render deployment config
Document production deployment workflow
```
