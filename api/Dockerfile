# Container image for the analytics API.
#
# Build from the REPOSITORY ROOT, not from api/:
#     docker build -f api/Dockerfile -t sqlproj-api .
#
# The context has to be the root because the application reads two things from
# outside api/ at runtime:
#   * db/queries/*.sql  - app/sql.py loads the hand-written analytics queries
#                         from disk so the text the tests validate is the exact
#                         text the endpoints execute.
#   * the repo root      - app/config.py and app/sql.py both derive it as
#                         Path(__file__).parents[3].
#
# That last point is why the app is NOT pip-installed into site-packages here.
# Installing it would move app/ to .../site-packages/app/, parents[3] would
# resolve to site-packages' parent, and every analytics endpoint would fail at
# runtime with FileNotFoundError on the first query load. Dependencies are
# installed; the application itself runs from the source tree, at the same
# relative depth it occupies in the repository.

# ---------------------------------------------------------------------------
# Stage 1 - dependencies
# ---------------------------------------------------------------------------
FROM python:3.14-slim AS deps

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Pinned lockfile, copied alone so this layer is cached until deps actually
# change. psycopg[binary] and the uvicorn extras ship wheels for CPython 3.14,
# so no compiler is needed in the image.
COPY api/requirements.txt /tmp/requirements.txt
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

# ---------------------------------------------------------------------------
# Stage 2 - runtime
# ---------------------------------------------------------------------------
FROM python:3.14-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/srv/api/src

COPY --from=deps /opt/venv /opt/venv

WORKDIR /srv

# Preserve the repository's relative layout - see the note above.
COPY api/src   /srv/api/src
COPY db/queries /srv/db/queries

# Run unprivileged. Nothing in the image is written to at runtime.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin appuser \
 && chown -R appuser:appuser /srv
USER appuser

# Render, Railway and Fly all inject $PORT; 8000 is the local default.
ENV PORT=8000
EXPOSE 8000

# Fail the build rather than the deploy if the layout above ever breaks: this
# import chain touches config.py's repo-root derivation and sql.py's query
# directory, which are the two things this Dockerfile is shaped around.
RUN python -c "\
import app.main, app.sql; \
qs = app.sql.available(); \
assert len(qs) >= 8, qs; \
print('layout ok:', len(qs), 'queries visible')"

# Single worker: the free tiers this targets give one shared CPU, and the
# endpoints are synchronous psycopg reads served from FastAPI's threadpool, so
# concurrency comes from the threadpool and the connection pool, not workers.
# More workers would multiply pool sizes past the agent role's CONNECTION LIMIT 5.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
