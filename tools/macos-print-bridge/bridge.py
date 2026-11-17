#!/usr/bin/env python3
"""FeedX Staging macOS printer bridge. Python 3.9+, standard library only."""
import argparse
import base64
import contextlib
import fcntl
import getpass
import json
import math
import os
import re
import socket
import stat
import subprocess
import sys
import termios
import time
import tty
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from zlib import compress

ROOT = Path.home() / "Library/Application Support/FeedX Print Bridge Staging"
ENDPOINT = "https://ujkzdaaadnvcfayuldmh.supabase.co"
KEYCHAIN = "my.feedx.staging.print-bridge"
SERIAL = "/dev/cu.D520"
SCRIPT = Path(__file__).resolve()
CONFIG = ROOT / "config.json"
JOURNAL = ROOT / "journal.json"
CALIBRATION = ROOT / "calibration.json"
LANG = dict(os.environ, LC_ALL="C")


class BridgeError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


HTTP = urllib.request.build_opener(NoRedirect())


def post(path, key, body, access=None):
    headers = {"apikey": key, "Content-Type": "application/json"}
    if access:
        headers["Authorization"] = f"Bearer {access}"
    request = urllib.request.Request(
        ENDPOINT + path, json.dumps(body).encode(), headers, method="POST"
    )
    with HTTP.open(request, timeout=30) as response:
        return json.load(response)


def rpc(config, session, name, **body):
    return post("/rest/v1/rpc/factory_label_" + name, config["key"], body, session["access_token"])


def command(args, data=None, timeout=10):
    return subprocess.run(args, input=data, capture_output=True, check=True, timeout=timeout, env=LANG).stdout


def save(path, value):
    temp = path.with_suffix(".tmp")
    with temp.open("w") as stream:
        json.dump(value, stream)
        stream.flush()
        # F_FULLFSYNC (51) asks macOS to flush the device cache before a submission.
        if sys.platform == "darwin":
            fcntl.fcntl(stream, 51)
        else:
            os.fsync(stream.fileno())
    temp.replace(path)
    sync_parent(path)


def sync_parent(path):
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def clear(path):
    path.unlink()
    sync_parent(path)


def load(path):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return None


@contextlib.contextmanager
def lock():
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = ROOT.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise BridgeError("Bridge data directory must be private and owned by this macOS user.")
    with (ROOT / "bridge.lock").open("a") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BridgeError("A bridge or calibration command is already running for this user.") from None
        yield


def store_session(config, session):
    value = base64.b64encode(json.dumps(session).encode()).decode()
    # security's interactive input keeps credentials out of process arguments.
    args = f"add-generic-password -U -s {KEYCHAIN} -a {config['device']} -w {value}\n"
    command(["/usr/bin/security", "-i"], args.encode(), 30)
    if read_session(config) != session:
        raise BridgeError("Could not verify the session in macOS Keychain.")


def read_session(config):
    value = command(["/usr/bin/security", "find-generic-password", "-s", KEYCHAIN, "-a", config["device"], "-w"])
    return json.loads(base64.b64decode(value.strip(), validate=True))


def auth(config, grant, **body):
    result = post("/auth/v1/token?grant_type=" + grant, config["key"], body)
    session = {key: result[key] for key in ("access_token", "refresh_token", "user")}
    session["user"] = session["user"]["id"]
    session["expires_at"] = int(time.time()) + int(result["expires_in"])
    if config.get("owner", session["user"]) != session["user"]:
        raise BridgeError("Sign in as the original bridge operator to preserve device ownership.")
    return session


def cups_printers():
    try:
        printers = command(["/usr/bin/lpstat", "-p"]).decode()
        accepting = command(["/usr/bin/lpstat", "-a"]).decode()
    except (OSError, subprocess.SubprocessError):
        return []
    ready = set(re.findall(r"^(\S+) accepting requests", accepting, re.M))
    return [
        {"Name": name, "WorkOffline": name not in ready or state == "disabled", "Platform": "macOS", "Connection": "CUPS"}
        for name, state in re.findall(r"^printer (\S+) (is|now|disabled)\b", printers, re.M)
    ]


def serial_worker(probe):
    if not stat.S_ISCHR(os.stat(SERIAL).st_mode):
        raise BridgeError("Bluetooth serial endpoint unavailable.")
    fd = os.open(SERIAL, os.O_RDWR | os.O_NOCTTY)
    try:
        # TIOCEXCL keeps another local opener out for this submission.
        fcntl.ioctl(fd, termios.TIOCEXCL)
        if not probe:
            tty.setraw(fd)
            settings = termios.tcgetattr(fd)
            settings[2] |= termios.CLOCAL | termios.CREAD
            settings[4] = settings[5] = termios.B115200
            termios.tcsetattr(fd, termios.TCSANOW, settings)
            remaining = memoryview(sys.stdin.buffer.read())
            while remaining:
                count = os.write(fd, remaining)
                if count <= 0:
                    raise BridgeError("Bluetooth write stopped.")
                remaining = remaining[count:]
            termios.tcdrain(fd)
    finally:
        os.close(fd)


def serial_command(probe=False, data=None):
    command([sys.executable, str(SCRIPT), "_probe" if probe else "_serial"], data, 6 if probe else 45)


def inventory(config=None):
    printers = cups_printers()[:75]
    if Path(SERIAL).exists() or (config and config["transport"] == "tspl"):
        offline = True
        if config and config["transport"] == "tspl":
            try:
                serial_command(probe=True)
                offline = False
            except (OSError, subprocess.SubprocessError):
                pass
        printers.append({"Name": SERIAL, "WorkOffline": offline, "Platform": "macOS", "Connection": "Bluetooth serial"})
    return printers


def device_status(config, session, printers, status):
    return rpc(config, session, "device", p_device=config["device"], p_name=config["name"],
               p_printer=config["printer"], p_transport=config["transport"], p_status=status, p_printers=printers)


def label(job):
    raster, snapshot = job["raster"], job["snapshot"]
    w, h, copies = raster["width"], raster["height"], job["quantity"]
    mm_w, mm_h = snapshot["width_mm"], snapshot["height_mm"]
    if (raster["format"] != "mono1" or any(type(x) is not int for x in (w, h, copies))
            or not 20 <= mm_w <= 120 or not 20 <= mm_h <= 200 or not 1 <= copies <= 10000
            or (w, h) != tuple(math.floor(x * 203 / 25.4 + 0.5) for x in (mm_w, mm_h))):
        raise ValueError("Invalid label dimensions or quantity.")
    pixels = base64.b64decode(raster["data"], validate=True)
    if len(pixels) != (w + 7) // 8 * h:
        raise ValueError("Invalid packed raster length.")
    return pixels, w, h, mm_w, mm_h, copies


def tspl(pixels, w, h, mm_w, mm_h, copies, gap, invert):
    header = f"SIZE {mm_w:g} mm,{mm_h:g} mm\r\nGAP {gap:g} mm,0\r\nDIRECTION 1\r\nCLS\r\nBITMAP 0,0,{(w + 7) // 8},{h},0,"
    if invert:
        pixels = pixels.translate(bytes(255 - x for x in range(256)))
    return header.encode() + pixels + f"\r\nPRINT 1,{copies}\r\n".encode()


def pdf(pixels, w, h, mm_w, mm_h, copies):
    width, height = mm_w * 72 / 25.4, mm_h * 72 / 25.4
    page = f"q {width:.6f} 0 0 {height:.6f} 0 0 cm /Label Do Q".encode()
    image = compress(pixels)
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width:.6f} {height:.6f}] "
         "/Resources << /XObject << /Label 5 0 R >> >> /Contents 4 0 R >>").encode(),
        f"<< /Length {len(page)} >>\nstream\n".encode() + page + b"\nendstream",
        (f"<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /DeviceGray "
         f"/BitsPerComponent 1 /Decode [1 0] /Interpolate false /Filter /FlateDecode /Length {len(image)} >>\nstream\n").encode()
        + image + b"\nendstream",
    ]
    result = bytearray(b"%PDF-1.4\n%\xff\xff\xff\xff\n")
    offsets = []
    for index, value in enumerate(objects, 1):
        offsets.append(len(result))
        result.extend(f"{index} 0 obj\n".encode() + value + b"\nendobj\n")
    start = len(result)
    result.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        result.extend(f"{offset:010d} 00000 n \n".encode())
    result.extend(f"trailer\n<< /Root 1 0 R /Size {len(objects) + 1} >>\nstartxref\n{start}\n%%EOF\n".encode())
    return bytes(result)


def prepare(config, values, title):
    if config["transport"] == "tspl":
        payload = tspl(*values, gap=config["gap"], invert=config["invert"])
        return lambda: send_serial(payload)
    _, _, _, w, h, copies = values
    queue = config["printer"]
    options = command(["/usr/bin/lpoptions", "-p", queue, "-l"]).decode()
    if not re.search(r"^PageSize/[^:]*:.*\bCustom\.", options, re.M):
        raise BridgeError("The CUPS driver must expose a custom PageSize for exact label dimensions.")
    payload = pdf(*values)
    args = ["/usr/bin/lp", "-d", queue, "-n", str(copies), "-t", title,
            "-o", f"media=Custom.{w:g}x{h:g}mm", "-o", "print-scaling=none",
            "-o", "orientation-requested=3", "-o", "Resolution=203dpi",
            "-o", "job-sheets=none", "-"]
    return lambda: send_cups(args, payload)


def send_cups(args, payload):
    receipt = command(args, payload, 45).decode()
    match = re.search(r"request id is ([\w.-]+-\d+)\b", receipt)
    if not match:
        raise BridgeError("CUPS receipt missing.")
    return f"CUPS accepted job {match[1]}. Verify physical output."


def send_serial(payload):
    serial_command(data=payload)
    return "macOS Bluetooth serial accepted the write. Verify physical output."


def outcome(state, status, detail):
    state.update(stage="reporting", outcome=status, detail=detail)
    save(JOURNAL, state)


def cycle(config, session):
    state = load(JOURNAL)
    if state and state["stage"] == "submitting":
        outcome(state, "Unknown", "Bridge restarted during submission. Inspect the printer and any CUPS job.")
    printers = inventory(config)
    calibrating = CALIBRATION.exists() or (
        config["transport"] == "tspl" and config.get("calibrated_labels") != 3
    )
    ready = not calibrating and any(p["Name"] == config["printer"] and not p["WorkOffline"] for p in printers)
    device_status(config, session, printers, "Error" if calibrating else "Ready" if ready else "Offline")
    if state and state["stage"] == "reporting":
        rpc(config, session, "report", p_device=config["device"], p_job=state["job"],
            p_claim=state["claim"], p_state=state["outcome"], p_detail=state["detail"])
        clear(JOURNAL)
        return
    if not ready:
        return
    if state is None:
        state = {"stage": "claiming", "claim": str(uuid.uuid4())}
        save(JOURNAL, state)
    elif state["stage"] != "claiming":
        raise BridgeError("Unrecognized journal state. Inspect print history.")
    job = rpc(config, session, "claim", p_device=config["device"], p_claim=state["claim"])
    if not job or job["state"] != "Printing":
        clear(JOURNAL)
        return
    state["job"] = str(uuid.UUID(job["id"]))
    remaining = lambda: datetime.fromisoformat(job["lease_until"].replace("Z", "+00:00")).timestamp() - time.time()
    if remaining() <= 60:
        outcome(state, "Unknown", "Claim expired or has insufficient time remaining. Inspect print history.")
        return
    try:
        submit = prepare(config, label(job), f"FeedX-{state['job']}")
    except (ValueError, KeyError, TypeError, OSError, BridgeError, subprocess.SubprocessError):
        outcome(state, "Failed", "Invalid label raster or unsupported media settings. No label submitted.")
        return
    if remaining() <= 60:
        outcome(state, "Unknown", "Claim has insufficient time remaining. Inspect print history.")
        return
    state["stage"] = "submitting"
    save(JOURNAL, state)
    try:
        detail = submit()
    except (OSError, BridgeError, subprocess.SubprocessError):
        outcome(state, "Unknown", "Submission failed or was interrupted. Inspect the printer and any CUPS job before recovery.")
    else:
        outcome(state, "Sent", detail)


def calibration(copies):
    w, h = 639, 719
    stride = (w + 7) // 8
    pixels = bytearray(stride * h)
    # An inset frame and asymmetric corner markers reveal scaling and orientation.
    for y in range(16, h - 16):
        for x in range(16, w - 16):
            if (x in (16, 17, w - 18, w - 17) or y in (16, 17, h - 18, h - 17)
                    or (x < 110 and 35 < y < 44) or (35 < x < 44 and y < 87)):
                pixels[y * stride + x // 8] |= 128 >> (x % 8)
    return bytes(pixels), w, h, 80, 90, copies


def local_test(config, copies):
    if JOURNAL.exists() or CALIBRATION.exists():
        raise BridgeError("Resolve the pending print or calibration before testing again.")
    if copies == 3 and not config.get("calibrated_labels"):
        raise BridgeError("Verify one calibration label before running the three-label test.")
    if not any(p["Name"] == config["printer"] and not p["WorkOffline"] for p in inventory(config)):
        raise BridgeError("The configured printer is unavailable.")
    submit = prepare(config, calibration(copies), "FeedX-80x90-Calibration")
    save(CALIBRATION, {"stage": "submitting", "quantity": copies})
    try:
        detail = submit()
    except (OSError, BridgeError, subprocess.SubprocessError):
        print("Unknown. Inspect physical output and any CUPS job before acknowledging.", file=sys.stderr)
        return 1
    save(CALIBRATION, {"stage": "sent", "quantity": copies, "detail": detail})
    print(detail, "After inspecting the result, run acknowledge-test.")
    return 0


def setup(config, args):
    if JOURNAL.exists() or CALIBRATION.exists():
        raise BridgeError("Resolve the pending print or calibration before changing configuration.")
    if args.serial:
        if input("Use the experimental D520 Bluetooth serial transport? Type D520: ") != "D520":
            raise BridgeError("Bluetooth setup canceled.")
        printer = SERIAL
        if not Path(SERIAL).exists():
            raise BridgeError("The D520 serial endpoint is unavailable on this Mac.")
    else:
        printer = args.queue
        if not any(p["Name"] == printer for p in cups_printers()):
            raise BridgeError("Select an installed CUPS queue from the printers list.")
    key = getpass.getpass("FeedX Staging publishable/anon key: ").strip()
    if key.startswith("ey"):
        try:
            payload = key.split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        except (ValueError, IndexError):
            claims = {}
        if claims.get("role") != "anon" or claims.get("ref") != "ujkzdaaadnvcfayuldmh":
            raise BridgeError("A Staging anon key is required.")
    elif not key.startswith("sb_publishable_"):
        raise BridgeError("A Staging publishable key is required.")
    settings = dict(printer=printer, transport="tspl" if args.serial else "spooler",
                    gap=args.gap, invert=not args.no_invert)
    calibrated = (config or {}).get("calibrated_labels", 0)
    if any((config or {}).get(name) != value for name, value in settings.items()):
        calibrated = 0
    config = dict(config or {}, key=key, calibrated_labels=calibrated, **settings)
    config.setdefault("device", str(uuid.uuid4()))
    config.setdefault("name", f"{socket.gethostname()[:85]} (macOS)")
    session = auth(config, "password", email=input("FeedX Staging operator email: ").strip(),
                   password=getpass.getpass("Password: "))
    config["owner"] = session["user"]
    # Persist the device ID before registration so a lost response cannot create another device.
    store_session(config, session)
    save(CONFIG, config)
    device_status(config, session, inventory(config), "Offline")
    print("Registered in Staging. Run start, or test-print 1 for local calibration.")


def run(config):
    session = read_session(config)
    backoff = 5
    print("FeedX Staging bridge running. Ctrl-C stops it.")
    while True:
        try:
            if int(time.time()) >= session["expires_at"] - 120:
                refreshed = auth(config, "refresh_token", refresh_token=session["refresh_token"])
                store_session(config, refreshed)
                session = refreshed
            cycle(config, session)
            backoff = 5
        except (OSError, ValueError, KeyError, BridgeError, subprocess.SubprocessError):
            print("Bridge connection or printer error. Check FeedX history, printer and sign-in.", file=sys.stderr)
            backoff = min(60, backoff * 2)
        time.sleep(backoff)


def main():
    if sys.argv[1:] in (["_serial"], ["_probe"]):
        serial_worker(sys.argv[1] == "_probe")
        return 0
    parser = argparse.ArgumentParser(description="FeedX macOS Print Bridge (Staging)")
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("printers")
    install = sub.add_parser("setup")
    target = install.add_mutually_exclusive_group(required=True)
    target.add_argument("--queue")
    target.add_argument("--serial", action="store_true")
    install.add_argument("--gap", type=float, default=2)
    install.add_argument("--no-invert", action="store_true")
    sub.add_parser("start")
    test = sub.add_parser("test-print")
    test.add_argument("quantity", type=int, choices=(1, 3))
    sub.add_parser("acknowledge-test")
    args = parser.parse_args()
    if args.action == "printers":
        print(json.dumps(inventory(), indent=2))
        return 0
    with lock():
        config = load(CONFIG)
        if args.action == "setup":
            if not 0 <= args.gap <= 10:
                raise BridgeError("Gap must be between 0 and 10 mm.")
            setup(config, args)
        elif args.action == "acknowledge-test":
            result = load(CALIBRATION)
            if not result:
                raise BridgeError("No calibration is pending.")
            review = input("Inspect the labels and clear held jobs. Type PASSED for correct output, or INSPECTED to clear without passing: ")
            if review not in ("PASSED", "INSPECTED"):
                raise BridgeError("Calibration remains pending.")
            if config:
                config["calibrated_labels"] = result["quantity"] if review == "PASSED" else 0
                save(CONFIG, config)
            clear(CALIBRATION)
        elif not config:
            raise BridgeError("Run setup before using this command.")
        elif args.action == "start":
            run(config)
        elif args.action == "test-print":
            return local_test(config, args.quantity)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except BridgeError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        # HTTP and subprocess errors may contain credentials or job data.
        print("Bridge command failed. Check CUPS/Bluetooth, Keychain and Staging sign-in.", file=sys.stderr)
        sys.exit(1)
