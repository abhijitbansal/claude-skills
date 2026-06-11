#!/usr/bin/env python3
"""A stand-in for the Claude Code CLI, used to verify Second Wind end to end
without burning real usage.

Behaviour:
  - echoes every line it receives (so resume messages are visible in the pane)
  - on receiving a line starting with "work", prints a fake usage-limit
    message whose reset time is FAKE_LIMIT_IN seconds from now (default 60),
    using the headless epoch format Second Wind parses
"""

import os
import sys
import time

LIMIT_IN = int(os.environ.get("FAKE_LIMIT_IN", "60"))

print("fake-claude ready (esc to interrupt)")
sys.stdout.flush()

for line in sys.stdin:
    line = line.strip()
    print(f"received: {line}")
    if line.startswith("work"):
        reset = int(time.time()) + LIMIT_IN
        print(f"Claude AI usage limit reached|{reset}")
    sys.stdout.flush()
