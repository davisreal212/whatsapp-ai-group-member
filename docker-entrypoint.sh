#!/bin/sh
set -eu

# Railway volumes are mounted after the image filesystem and may be root-owned.
mkdir -p /var/lib/whatsapp-ai/data /var/lib/whatsapp-ai/whatsapp-auth
chown -R app:app /var/lib/whatsapp-ai

exec gosu app "$@"
