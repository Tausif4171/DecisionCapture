FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/frontend ./apps/frontend

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm install
RUN npm run build -w @decisioncapture/shared
RUN npm run build -w @decisioncapture/frontend

EXPOSE 3000

CMD ["npm", "run", "start", "-w", "@decisioncapture/frontend"]
