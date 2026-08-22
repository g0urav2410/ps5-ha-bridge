FROM node:20-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./
COPY lib ./lib
COPY public ./public
COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
