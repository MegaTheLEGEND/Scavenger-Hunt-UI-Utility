
FROM node:20-alpine
 
WORKDIR /app
 
# Files are already here from the build context (GitHub repo)
COPY . .
 
# Install dependencies
RUN npm install
 
# Build the Next.js app
RUN npm run build
 
# Stash a copy of the default data OUTSIDE the volume mount point
# so we can copy it in at runtime if the volume is empty
RUN cp -r /app/data /app/data-default
 
# Copy entrypoint script
RUN chmod +x /entrypoint.sh
 
EXPOSE 3000
 
ENTRYPOINT ["/entrypoint.sh"]
 
