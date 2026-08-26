"""
Binary build monitor -- polls swao-enterprise-win.exe for mtime changes and prints
a notification line when a new build is detected. Intended to be run via the
Monitor tool for session lifetime. Poll interval: 30 seconds.
"""
import os
import sys
import time

TARGET = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "dist-bin", "swao-enterprise-win.exe"
)

def get_mtime(path):
    try:
        return os.path.getmtime(path)
    except OSError:
        return None

def main():
    last_mtime = get_mtime(TARGET)
    print(f"[swao-binary-monitor] watching {TARGET}", flush=True)
    if last_mtime:
        print(f"[swao-binary-monitor] baseline mtime={last_mtime:.0f}", flush=True)
    else:
        print(f"[swao-binary-monitor] WARNING: binary not found at startup", flush=True)

    while True:
        time.sleep(30)
        current = get_mtime(TARGET)
        if current is None:
            continue
        if last_mtime is None or current != last_mtime:
            print(
                f"[swao-binary-monitor] NEW BUILD DETECTED -- mtime={current:.0f} "
                f"size={os.path.getsize(TARGET) // 1024 // 1024}MB "
                f"-- re-trigger swao-qa-smoke and swao-tier-gates",
                flush=True,
            )
            last_mtime = current

if __name__ == "__main__":
    main()
