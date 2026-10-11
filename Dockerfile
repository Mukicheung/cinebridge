FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 CINEBRIDGE_DATA=/data
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY pyproject.toml ./
COPY cinebridge ./cinebridge
RUN pip install --no-cache-dir --no-deps . && useradd --uid 10001 --create-home cinebridge && mkdir /data && chown cinebridge:cinebridge /data
USER cinebridge
VOLUME /data
EXPOSE 8766
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8766/healthz', timeout=3)"
CMD ["cinebridge", "serve", "--host", "0.0.0.0", "--port", "8766"]
