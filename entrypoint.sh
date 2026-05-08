#!/bin/sh

# Copy default data files to volume if they don't exist yet
if [ ! -f /app/data/game.json ]; then
  echo "Initializing data volume from defaults..."
  cp -r /app/data-default/. /app/data/
fi

exec npm start
