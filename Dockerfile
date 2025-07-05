FROM node:18-alpine

WORKDIR /app

# Install cron, Python, and build dependencies
RUN apk add --no-cache dcron python3 py3-pip py3-pandas py3-numpy py3-scipy \
    build-base python3-dev py3-scikit-learn

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

# Run database initialization during build
RUN npm run import

# Start cron and the application with better logging
CMD crond -f -d 8 & npm start