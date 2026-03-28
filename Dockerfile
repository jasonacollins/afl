FROM node:18-alpine

WORKDIR /app

ENV TZ=Australia/Sydney

# Install cron, Python, and build dependencies
RUN apk add --no-cache dcron tzdata python3 py3-pip py3-pandas py3-numpy py3-scipy \
    build-base python3-dev py3-scikit-learn && \
    ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone

# Install scikit-optimize via pip with system packages override
RUN pip install --no-cache-dir --break-system-packages scikit-optimize

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Create data directory for SQLite and logs directory
RUN mkdir -p data data/temp data/backups
# Create logs directory
RUN mkdir -p logs && touch logs/afl-sync.log

# Set proper permissions for logs
RUN chmod 777 logs/afl-sync.log
RUN chmod 777 logs

# Add crontab file
COPY crontab /etc/crontabs/root
RUN chmod 600 /etc/crontabs/root

# Expose port
EXPOSE 3001

# Attempt database initialization during build (non-fatal — the real DB is
# volume-mounted at runtime, so a build-time failure when the Squiggle API
# is unreachable is harmless).
RUN npm run import || echo "WARNING: npm run import failed (Squiggle API may be down). Continuing build."

# Start cron and the application with better logging
CMD crond -f -d 8 & npm start
