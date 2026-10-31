FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY web ./web
# FaceX weights are fetched from the FaceX GitHub release on first start (see server/index.js); bake them in so cold starts are instant.
RUN node -e "const fs=require('fs');(async()=>{for(const [n,u] of Object.entries({'edgeface_xs_fp32.bin':'https://github.com/facex-engine/facex/releases/download/v1.0.0/edgeface_xs_fp32.bin','det_500m_int8.bin':'https://github.com/facex-engine/facex/releases/download/v1.0.0/det_500m_int8.bin'})){const r=await fetch(u);fs.writeFileSync('web/vendor/facex/'+n,Buffer.from(await r.arrayBuffer()));}})()"
ARG GIT_SHA=dev
ENV PORT=3000 DATA_DIR=/data APP_VERSION=$GIT_SHA
VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.js"]
