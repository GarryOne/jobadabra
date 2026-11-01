# The Ready to send image (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md): Chromium, the extension as the app ships it, and the night's runner. No secret, no user data baked in: the token and the batch arrive at run time.
# Cloudflare Container, standard-1; the Worker POSTs /run {site, token}. Build from the repo root: docker build -f hosted/ready-fill/Dockerfile .
FROM mcr.microsoft.com/playwright:v1.49.1-noble
WORKDIR /night
COPY hosted/ready-fill/package.json ./
RUN npm install --no-audit --no-fund --omit=dev
COPY desktop/ready-fill/*.mjs ./
COPY hosted/ready-fill/*.mjs ./
COPY extension ./extension
COPY app-core/src ./app-core/src
# The app's form-address rule, at /desktop/lib so `../../desktop/lib/form-address.js` resolves from /night as it does in the repo; its package.json says it is an ES module.
COPY desktop/lib/form-address.js /desktop/lib/form-address.js
COPY desktop/package.json /desktop/package.json
ENV NODE_ENV=production EXTENSION_DIR=/night/extension
EXPOSE 8080
CMD ["node", "main.mjs"]
