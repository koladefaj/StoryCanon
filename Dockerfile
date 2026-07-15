FROM debian:bookworm-slim

# Install dependencies needed by the installer script
RUN apt-get update && apt-get install -y \
    curl \
    bash \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Non-interactive install: there's no TTY during `docker build`, so skip the
# LLM-provider prompt. Add OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY
# at `docker run` time (see README) rather than baking one into the image.
ENV SUPERMEMORY_NO_PROMPT=1

# Run the official Supermemory installer script inside the container
RUN curl -fsSL https://supermemory.ai/install | bash

# Expose Supermemory's local server port
EXPOSE 6767

# Run the server when the container starts
CMD ["sh", "-c", "~/.local/bin/supermemory-server"]
