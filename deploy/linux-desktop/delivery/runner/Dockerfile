# The upstream runner image contains the official binary and Docker CLI.
# A byte-identical registry mirror may be supplied for constrained networks.
ARG RUNNER_IMAGE=ghcr.io/actions/actions-runner@sha256:660f7b9d1e0007274f7c867e220b3c382137ef5a30d8e501a025ad50dbd5fb9d
FROM ${RUNNER_IMAGE}
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv build-essential pkg-config libsecret-1-dev dnsmasq-base \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -c 'import sys; assert sys.version_info >= (3, 12)' \
    && chmod 755 /home/runner \
    && dpkg-query -W > /opt/runner-packages.txt
COPY entrypoint.py /opt/cindy-runner-entrypoint.py
COPY dns-sidecar.py /opt/cindy-runner-dns.py
USER 1001:1001
WORKDIR /home/runner
ENTRYPOINT ["python3", "/opt/cindy-runner-entrypoint.py"]
