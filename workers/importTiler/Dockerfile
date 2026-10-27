FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ca-certificates git libsqlite3-dev zlib1g-dev \
	&& git clone --depth 1 --branch 2.79.0 https://github.com/felt/tippecanoe.git /src \
	&& make -C /src -j"$(nproc)" tippecanoe

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libsqlite3-0 zlib1g && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/tippecanoe /usr/local/bin/tippecanoe
COPY server.mjs /app/server.mjs
CMD ["node", "/app/server.mjs"]
