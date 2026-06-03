FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p /app/data
ENV PORT=20128 HOST=0.0.0.0 DATA_DIR=/app/data
EXPOSE 20128
CMD ["node","src/index.js"]
