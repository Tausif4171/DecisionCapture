FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/frontend ./apps/frontend

RUN npm install
RUN npm run build -w @decisioncapture/shared
RUN npm run build -w @decisioncapture/frontend

EXPOSE 3000

CMD ["npm", "run", "start", "-w", "@decisioncapture/frontend"]
