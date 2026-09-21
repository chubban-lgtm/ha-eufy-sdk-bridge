# ha-eufy-sdk-bridge: the SDK + the bridge daemon + go2rtc, in one image.
FROM node:24-alpine
RUN apk add --no-cache ffmpeg curl
WORKDIR /app

ARG GO2RTC_VERSION=1.9.9
ARG TARGETARCH
RUN case "${TARGETARCH:-amd64}" in \
      amd64) g2="go2rtc_linux_amd64" ;; \
      arm64) g2="go2rtc_linux_arm64" ;; \
      arm) g2="go2rtc_linux_arm" ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" && exit 1 ;; \
    esac \
 && curl -fsSL -o /usr/local/bin/go2rtc \
      "https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}/${g2}" \
 && chmod +x /usr/local/bin/go2rtc

ARG SDK_DIST_TAG=
ARG SDK_GIT_REF=
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && if [ -n "$SDK_GIT_REF" ]; then \
      echo "SDK_GIT_REF=$SDK_GIT_REF → building diagnostic SDK from GitHub"; \
      apk add --no-cache git \
      && git clone --depth 1 --branch "$SDK_GIT_REF" https://github.com/chubban-lgtm/eufy-sdk.git /tmp/eufy-sdk \
      && cd /tmp/eufy-sdk \
      && npm ci --no-audit --no-fund \
      && npm run build \
      && test -f dist/index.js \
      && npm pack --pack-destination /tmp \
      && cd /app \
      && npm install --omit=dev --no-audit --no-fund --no-save /tmp/mega-yfue-eufy-sdk-*.tgz \
      && test -f node_modules/@mega-yfue/eufy-sdk/dist/index.js \
      && rm -rf /tmp/eufy-sdk /tmp/mega-yfue-eufy-sdk-*.tgz \
      && node -e "console.log('SDK diagnostic overlay installed:', JSON.parse(require('fs').readFileSync('node_modules/@mega-yfue/eufy-sdk/package.json')).version)"; \
    elif [ -n "$SDK_DIST_TAG" ]; then \
      echo "SDK_DIST_TAG=$SDK_DIST_TAG → overlaying @mega-yfue/eufy-sdk@$SDK_DIST_TAG (dev channel)"; \
      npm install --omit=dev --no-audit --no-fund --no-save "@mega-yfue/eufy-sdk@$SDK_DIST_TAG"; \
      node -e "console.log('SDK now:', JSON.parse(require('fs').readFileSync('node_modules/@mega-yfue/eufy-sdk/package.json')).version)"; \
    fi

COPY server.mjs streams.mjs go2rtc-config.mjs ./
COPY src ./src
COPY bin ./bin
RUN chmod +x bin/start.sh && ln -sf /app/bin/start.sh /usr/local/bin/eufy-sdk-bridge

ENV BRIDGE_APP_DIR=/app BRIDGE_PORT=3000 BRIDGE_HOST=0.0.0.0 \
    GO2RTC_CONFIG=/app/data/go2rtc.yaml EUFY_SESSION=/app/data/.eufy-session.json
RUN mkdir -p /app/data
EXPOSE 3000 1984 8554 8555/udp

CMD [ "eufy-sdk-bridge" ]
