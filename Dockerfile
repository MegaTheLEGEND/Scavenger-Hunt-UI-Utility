FROM node:20-alpine

WORKDIR /app

# Download latest repo from GitHub
RUN wget -q https://github.com/MegaTheLEGEND/Scavenger-Hunt-UI-Utility/archive/refs/heads/main.zip \
    && unzip main.zip \
    && mv Scavenger-Hunt-UI-Utility-main/* . \
    && rm -rf Scavenger-Hunt-UI-Utility-main main.zip

# Install dependencies
RUN npm install --legacy-peer-deps && npm cache clean --force

# Build the Next.js app
RUN npm run build

# Stash default data outside volume mount so entrypoint can seed it
RUN cp -r /app/data /app/data-default

EXPOSE 3000

# Seed data volume on first run, then start the app
CMD sh -c '[ ! -f /app/data/game.json ] && cp -r /app/data-default/. /app/data/; npm start'
