# syntax=docker/dockerfile:1.10@sha256:865e5dd094beca432e8c0a1d5e1c465db5f998dca4e439981029b3b81fb39ed5
# Context is generated exclusively from Git by build-image.py.
ARG BASE_IMAGE
FROM ${BASE_IMAGE} AS prepared
SHELL ["/bin/bash", "-o", "errexit", "-o", "nounset", "-o", "pipefail", "-c"]
WORKDIR /workspace/source
COPY source/ ./
COPY recipe/download-build-assets.mjs recipe/prepare-codex.mjs recipe/prepare-other-assets.mjs recipe/prepare-linux.sh /workspace/recipe/
ARG CINDY_UPSTREAM_VERSION
ENV CINDY_UPSTREAM_VERSION=${CINDY_UPSTREAM_VERSION} CI=1 NODE_OPTIONS=--max-old-space-size=6144 \
    CINDY_AUTH_REGION=cn VITE_CINDY_AUTH_REGION=cn APP_VERSION=${CINDY_UPSTREAM_VERSION}
RUN --mount=type=cache,id=cindy-linux-build-assets,target=/var/cache/cindy-build-assets,sharing=locked \
    mkdir -p /workspace/debs /workspace/sysroot \
    && node /workspace/recipe/download-build-assets.mjs \
    && node /workspace/recipe/prepare-codex.mjs \
    && node /workspace/recipe/prepare-other-assets.mjs \
    && ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile \
    && /bin/sh /workspace/recipe/prepare-linux.sh

FROM prepared AS build
COPY build-recipe/ /workspace/recipe/
ARG CINDY_CLOUD_REVISION
ENV APP_VERSION=${CINDY_UPSTREAM_VERSION}-cloud.${CINDY_CLOUD_REVISION}
RUN /bin/sh /workspace/recipe/build-runtime.sh
RUN python3 /workspace/recipe/assemble-runtime.py /workspace/artifact /layer \
    && python3 /workspace/recipe/audit-runtime-layer.py /layer > /workspace/artifact/runtime-layer-audit.json

FROM scratch AS build-records
COPY --from=build /workspace/artifact/runtime-layer-audit.json /
COPY --from=build /workspace/artifact/agent-source-proof.json /
COPY --from=build /workspace/recipe/overlay-application.json /
# Commit/evidence changes do not invalidate dependency installation or packaging.
COPY recipe/build-inputs.json /

FROM ${BASE_IMAGE} AS runtime
ARG CINDY_SOURCE_COMMIT
ARG CINDY_UPSTREAM_VERSION
ARG CINDY_ENTRYPOINT_SHA256
ARG CINDY_RUNTIME_VERSION
ARG CINDY_CLOUD_REVISION
COPY --from=build --chown=0:0 /layer/ /
ENV HOME=/home/cindy DISPLAY=:99 XDG_RUNTIME_DIR=/tmp/runtime-cindy
LABEL io.cindy.source-commit=${CINDY_SOURCE_COMMIT} \
      io.cindy.entrypoint-sha256=${CINDY_ENTRYPOINT_SHA256} \
      io.cindy.runtime-version=${CINDY_RUNTIME_VERSION} \
      io.cindy.upstream-version=${CINDY_UPSTREAM_VERSION} io.cindy.cloud-revision=${CINDY_CLOUD_REVISION} \
      org.opencontainers.image.version=${CINDY_UPSTREAM_VERSION}-cloud.${CINDY_CLOUD_REVISION} io.cindy.region=cn \
      io.cindy.target-architecture=amd64
USER cindy
ENTRYPOINT ["/usr/local/bin/cindy-seccomp", "/usr/local/bin/cindy-linux-desktop"]
CMD ["/opt/cindy/Cindy"]
