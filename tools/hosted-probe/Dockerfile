# The engine image for the one-off hosted Always on cost probe (private spec jobadabra-lab:docs/specs/2026-10-16-hosted-always-on.md §3): public engine code, no secrets, fixture config.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends time && rm -rf /var/lib/apt/lists/*
WORKDIR /engine
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src ./src
COPY config ./config
COPY tools/hosted-probe/probe_server.py ./probe_server.py
ENV JOBADABRA_NO_DOTENV=1 JOBADABRA_STORE=sqlite JOBADABRA_APP_DIR=/work/app PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "probe_server.py"]
