#!/usr/bin/env python3
"""FeedX Staging macOS printer bridge. Python 3.9+, standard library only."""
import argparse
import base64
import contextlib
import fcntl
import getpass
import hashlib
import json
import math
import os
import re
import socket
import stat
import subprocess
import sys
import time
import urllib.request
import urllib.error
import uuid
from datetime import datetime, timezone
from pathlib import Path
from zlib import compress

ROOT = Path.home() / "Library/Application Support/FeedX Print Bridge Staging"
ENDPOINT = "https://ujkzdaaadnvcfayuldmh.supabase.co"
KEYCHAIN = "my.feedx.staging.print-bridge"
BLUETOOTH = "D520 (Bluetooth)"
NATIVE_SOURCE = Path(__file__).with_name("D520RFCOMM.m")
NATIVE = ROOT / "d520-rfcomm"
CONFIG = ROOT / "config.json"
JOURNAL = ROOT / "journal.json"
CALIBRATION = ROOT / "calibration.json"
LANG = dict(os.environ, LC_ALL="C")
BLUETOOTH_PROBE_INTERVAL = 60
BLUETOOTH_PROBE_FRESHNESS = 90


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


def command(args, data=None, timeout=10, *, pass_fds=()):
    child = subprocess.Popen(args, stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=LANG, pass_fds=pass_fds)
    try:
        stdout, _ = child.communicate(data, timeout=timeout)
    except subprocess.TimeoutExpired:
        # A stuck Bluetooth kernel write can leave even a killed child waiting for the driver.
        # Return immediately so the caller can persist Unknown and avoid any resend.
        child.kill()
        raise
    finally:
        for stream in (child.stdin, child.stdout):
            if stream and not stream.closed:
                stream.close()
    if child.returncode:
        raise subprocess.CalledProcessError(child.returncode, args)
    return stdout


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


def build_bluetooth():
    try:
        command(["/usr/bin/xcrun", "clang", "-fobjc-arc", "-framework", "Foundation",
                 "-framework", "IOBluetooth", str(NATIVE_SOURCE), "-o", str(NATIVE)], timeout=60)
    except (OSError, subprocess.SubprocessError):
        raise BridgeError("Could not build the Bluetooth helper. Install Apple's Command Line Tools.") from None


def native_command(args, data=None, timeout=18):
    with (ROOT / "bluetooth.lock").open("a") as channel:
        try:
            fcntl.flock(channel, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BridgeError("The previous Bluetooth session is still closing. Check the printer again shortly.") from None
        # A timed-out helper retains the lock until the OS actually releases the process.
        return command([str(NATIVE), *args], data, timeout, pass_fds=(channel.fileno(),))


def bluetooth_probe(address=None):
    args = ["probe"] + ([address] if address else [])
    reported = native_command(args).decode().strip()
    if not re.fullmatch(r"[0-9a-fA-F]{2}([-:][0-9a-fA-F]{2}){5}", reported):
        raise BridgeError("The Bluetooth helper returned an invalid device identity.")
    return reported


BLUETOOTH_CHECK_ERRORS = {
    2: "D520 pairing was not found. Check that D520 is paired in macOS.",
    3: "D520 did not expose its Bluetooth serial service. Check power and range.",
    4: "D520 Bluetooth serial connection is busy or unavailable. Close Labelife or other printer apps, check power, then try Connection Check again.",
    5: "D520 opened the Bluetooth channel but did not answer the bitmap-mode check.",
    10: "D520 did not release the Bridge channel cleanly. Wait a moment and run Connection Check again.",
}


def record_connection(config, *, available=False, detail=None, reported=False, observed_at=None):
    if not config.get("guided_worker"):
        return
    with contextlib.suppress(OSError):
        save(ROOT / "connection-status.json", {
            "device": config["device"], "time": time.time() if observed_at is None else observed_at, "available": available,
            "detail": detail, "reported": reported,
        })


def inventory(config=None, probe_bluetooth=True):
    printers = cups_printers()[:75]
    address = config.get("bluetooth_address") if config else None
    if config and config["transport"] == "tspl":
        offline = True
        detail = None
        if address and probe_bluetooth:
            try:
                offline = bluetooth_probe(address) != address
            except subprocess.CalledProcessError as error:
                detail = BLUETOOTH_CHECK_ERRORS.get(error.returncode, "D520 connection check failed.")
            except subprocess.TimeoutExpired:
                detail = "D520 did not respond in time. Check power, range and other printer apps."
            except BridgeError as error:
                detail = str(error)
            except OSError:
                detail = "D520 could not be checked. Check its pairing and Bridge installation."
        row = {"Name": config["printer"], "WorkOffline": offline, "Platform": "macOS",
               "Connection": "Bluetooth Classic SPP"}
        if address and probe_bluetooth:
            row.update(ConnectionCheckedAt=datetime.now(timezone.utc).isoformat(), ConnectionDetail=detail)
        printers.append(row)
    return printers


class BluetoothStatus:
    def __init__(self):
        self.printer = None
        self.checked = float("-inf")
        self.observed_at = 0
        self.interval = BLUETOOTH_PROBE_INTERVAL
        self.failures = 0
        self.published = None

    def inventory(self, config):
        now = time.monotonic()
        try:
            requested = (ROOT / "connection-request").stat().st_mtime > self.observed_at
        except FileNotFoundError:
            requested = False
        probe_due = now - self.checked >= (min(self.interval, 10) if requested else self.interval)
        printers = inventory(config, probe_bluetooth=probe_due)
        # The configured Bluetooth row follows the CUPS inventory.
        if probe_due:
            self.printer = printers[-1]
            self.checked = time.monotonic()
            self.observed_at = datetime.fromisoformat(self.printer["ConnectionCheckedAt"]).timestamp()
            self.failures = min(3, self.failures + 1) if self.printer["WorkOffline"] else 0
            self.interval = (BLUETOOTH_PROBE_INTERVAL, 15, 30, BLUETOOTH_PROBE_INTERVAL)[self.failures]
        if self.printer:
            printers[-1] = dict(self.printer, WorkOffline=self.printer["WorkOffline"]
                                or time.monotonic() - self.checked > BLUETOOTH_PROBE_FRESHNESS)
        return printers


def claim_bluetooth(config, session):
    address = config.get("bluetooth_address")
    if not address:
        return True
    identity = address.replace("-", "").replace(":", "").upper()
    if not re.fullmatch(r"[0-9A-F]{12}", identity):
        raise BridgeError("Select the paired D520 again in Printer Setup.")
    key = hashlib.sha256(identity.encode("ascii")).hexdigest()
    return rpc(config, session, "bluetooth_lease", p_device=config["device"], p_printer_key=key)


def device_status(config, session, printers, status):
    printers = [
        dict(row, BridgeVersion="1.3.0", Calibration=calibration_status(config),
             StockWidthMm=config.get("stock_width", 80), StockHeightMm=config.get("stock_height", 90))
        if row["Name"] == config["printer"] else row for row in printers
    ]
    return rpc(config, session, "device", p_device=config["device"], p_name=config["name"],
               p_printer=config["printer"], p_transport=config["transport"], p_status=status, p_printers=printers)


def calibration_status(config):
    if CALIBRATION.exists():
        return "Needs review"
    count = config.get("calibrated_labels", 0)
    if count >= (3 if config["transport"] == "tspl" else 1):
        return "Passed"
    if count == 1:
        return "Single label passed"
    return "Pending" if config["transport"] == "tspl" or config.get("require_calibration") else "Not reported"


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


def lzo_literal_block(block):
    """A valid LZO1X block made from one literal run and an end marker."""
    size = len(block)
    if size <= 238:
        prefix = bytes([17 + size])
    else:
        zeros, tail = divmod(size - 19, 255)
        prefix = bytes(zeros + 1) + bytes([tail + 1])
    return prefix + block + b"\x11\x00\x00"


def tspl(pixels, w, h, mm_w, mm_h, copies, gap, invert):
    header = (f"\r\nREFERENCE 0,0\r\nOFFSET 0 mm\r\nSIZE {mm_w:g} mm,{mm_h:g} mm\r\n"
              f"GAP {gap:g} mm,0\r\nDIRECTION 1,0\r\nCLS\r\nBITMAP 0,0,{(w + 7) // 8},{h},4,")
    if invert:
        pixels = pixels.translate(bytes(255 - x for x in range(256)))
    payload = bytearray(header.encode())
    for offset in range(0, len(pixels), 4096):
        block = lzo_literal_block(pixels[offset:offset + 4096])
        payload.extend(len(block).to_bytes(4, "little"))
        payload.extend(block)
    payload.extend(bytes(4))
    payload.extend(f"\r\nPRINT 1,{copies}\r\n".encode())
    return bytes(payload)


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
        return lambda: send_bluetooth(config["bluetooth_address"], payload)
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


def send_bluetooth(address, payload):
    try:
        native_command(["print", address], payload, 45)
    except subprocess.CalledProcessError as error:
        detail = {
            4: "D520 RFCOMM channel could not open.",
            6: "D520 RFCOMM write failed or stopped before submitting all bytes.",
            7: "D520 returned a negative acknowledgment.",
            8: "D520 write completed, but no print acknowledgment was observed.",
            9: "The native helper rejected the label payload.",
        }.get(error.returncode, "D520 transport failed.")
        raise BridgeError(detail) from None
    return "The D520 acknowledged the Bluetooth submission. Verify physical output."


def outcome(state, status, detail):
    state.update(stage="reporting", outcome=status, detail=detail)
    save(JOURNAL, state)


def cycle(config, session, bluetooth_status=None):
    state = load(JOURNAL)
    if state and state["stage"] == "submitting":
        outcome(state, "Unknown", "Bridge restarted during submission. Inspect the printer and any CUPS job.")
    if state and state["stage"] == "reporting":
        rpc(config, session, "report", p_device=config["device"], p_job=state["job"],
            p_claim=state["claim"], p_state=state["outcome"], p_detail=state["detail"])
        clear(JOURNAL)
        return
    calibrating = CALIBRATION.exists() or (
        config["transport"] == "tspl"
        and (not config.get("bluetooth_address") or config.get("calibrated_labels") != 3)
    ) or (config.get("require_calibration") and calibration_status(config) != "Passed")
    if bluetooth_status is not None:
        allowed = not config.get("coordinate_bluetooth") or claim_bluetooth(config, session)
        if allowed:
            printers = bluetooth_status.inventory(config)
        else:
            detail = "This D520 is active on another FeedX Bridge. Stop that Bridge or wait for it to go offline."
            observed = datetime.now(timezone.utc)
            printers = inventory(config, probe_bluetooth=False)
            printers[-1].update(WorkOffline=True, ConnectionCheckedAt=observed.isoformat(), ConnectionDetail=detail)
            bluetooth_status.printer = None
            bluetooth_status.checked = float("-inf")
            bluetooth_status.observed_at = observed.timestamp()
            device_status(config, session, printers, "Offline")
            record_connection(config, detail=detail, reported=True, observed_at=observed.timestamp())
            return
    else:
        printers = inventory(config, probe_bluetooth=not calibrating or config.get("guided_setup", False) or config.get("guided_worker", False))
    selected = next((p for p in printers if p["Name"] == config["printer"]), None)
    available = bool(selected and not selected["WorkOffline"])
    ready = not calibrating and available
    device_status(config, session, printers, "Error" if calibrating else "Ready" if ready else "Offline")
    if bluetooth_status is None or bluetooth_status.published != bluetooth_status.checked:
        record_connection(config, available=available, reported=True,
                          detail=(selected or {}).get("ConnectionDetail") or (
                              None if available else "Printer unavailable. Check the configured printer and its connection."),
                          observed_at=bluetooth_status.observed_at if bluetooth_status is not None else None)
        if bluetooth_status is not None:
            bluetooth_status.published = bluetooth_status.checked
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
        values = label(job)
        if config.get("guided_setup") and values[3:5] != (config.get("stock_width", 80), config.get("stock_height", 90)):
            outcome(state, "Failed", "Label dimensions differ from the calibrated stock. No label submitted.")
            return
        submit = prepare(config, values, f"FeedX-{state['job']}")
    except (ValueError, KeyError, TypeError, OSError, BridgeError, subprocess.SubprocessError):
        outcome(state, "Failed", "Invalid label raster or unsupported media settings. No label submitted.")
        return
    if remaining() <= 60:
        outcome(state, "Unknown", "Claim has insufficient time remaining. Inspect print history.")
        return
    if config.get("coordinate_bluetooth") and not claim_bluetooth(config, session):
        outcome(state, "Failed", "The D520 is active on another FeedX Bridge. No label submitted.")
        return
    state["stage"] = "submitting"
    save(JOURNAL, state)
    try:
        detail = submit()
    except BridgeError as error:
        outcome(state, "Unknown", f"{error} Inspect physical output before recovery.")
    except (OSError, subprocess.SubprocessError):
        outcome(state, "Unknown", "Submission failed or was interrupted. Inspect the printer and any CUPS job before recovery.")
    else:
        outcome(state, "Sent", detail)


def calibration(copies, width_mm=80, height_mm=90):
    w, h = (math.floor(mm * 203 / 25.4 + 0.5) for mm in (width_mm, height_mm))
    stride = (w + 7) // 8
    pixels = bytearray(stride * h)
    # An inset frame and asymmetric corner markers reveal scaling and orientation.
    inset = 32
    for y in range(inset, h - inset):
        for x in range(inset, w - inset):
            if (x in (inset, inset + 1, w - inset - 2, w - inset - 1)
                    or y in (inset, inset + 1, h - inset - 2, h - inset - 1)
                    or (x < 122 and 51 < y < 60) or (51 < x < 60 and y < 103)):
                pixels[y * stride + x // 8] |= 128 >> (x % 8)
    return bytes(pixels), w, h, width_mm, height_mm, copies


def local_test(config, copies):
    if JOURNAL.exists() or CALIBRATION.exists():
        raise BridgeError("Resolve the pending print or calibration before testing again.")
    if config["transport"] == "tspl" and not config.get("bluetooth_address"):
        raise BridgeError("Run setup --bluetooth to configure the D520 adapter.")
    if copies == 3 and not config.get("calibrated_labels"):
        raise BridgeError("Verify one calibration label before running the three-label test.")
    if not any(p["Name"] == config["printer"] and not p["WorkOffline"] for p in inventory(config)):
        raise BridgeError("The configured printer is unavailable.")
    submit = prepare(config, calibration(copies, config.get("stock_width", 80), config.get("stock_height", 90)), "FeedX TEST Calibration")
    save(CALIBRATION, {"stage": "submitting", "quantity": copies})
    try:
        detail = submit()
    except BridgeError as error:
        save(CALIBRATION, {"stage": "unknown", "quantity": copies, "detail": str(error)})
        print(f"Unknown. {error} Inspect physical output before acknowledging.", file=sys.stderr)
        return 1
    except (OSError, subprocess.SubprocessError):
        print("Unknown. Inspect physical output and any CUPS job before acknowledging.", file=sys.stderr)
        return 1
    save(CALIBRATION, {"stage": "sent", "quantity": copies, "detail": detail})
    print(detail, "After inspecting the result, run acknowledge-test.")
    return 0


def setup(config, args):
    if JOURNAL.exists() or CALIBRATION.exists():
        raise BridgeError("Resolve the pending print or calibration before changing configuration.")
    address = None
    if args.bluetooth:
        build_bluetooth()
        address = bluetooth_probe()
        printer = BLUETOOTH
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
    settings = dict(printer=printer, transport="tspl" if args.bluetooth else "spooler",
                    gap=args.gap, invert=args.invert, bluetooth_address=address)
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


def run(config, paused=lambda: False):
    session = None
    pending_session = False
    backoff = 5
    bluetooth_status = BluetoothStatus() if config.get("transport") == "tspl" and config.get("bluetooth_address") else None
    print("FeedX Staging bridge running. Ctrl-C stops it.")
    while not paused():
        try:
            if session is None:
                session = read_session(config)
            if pending_session:
                store_session(config, session)
                pending_session = False
            if int(time.time()) >= session["expires_at"] - 120:
                session = auth(config, "refresh_token", refresh_token=session["refresh_token"])
                pending_session = True
                store_session(config, session)
                pending_session = False
            if bluetooth_status is None:
                cycle(config, session)
            else:
                cycle(config, session, bluetooth_status)
            backoff = 5
        except urllib.error.HTTPError as error:
            auth_failed = error.code in (400, 401, 403)
            record_connection(config, detail="FeedX sign-in or Bridge authorization failed. Reauthorize with the original operator."
                              if auth_failed else "FeedX did not accept the status update. Check the network and retry.")
            if auth_failed and not pending_session:
                session = None
            backoff = min(60, backoff * 2)
        except (OSError, ValueError, KeyError, BridgeError, subprocess.SubprocessError):
            record_connection(config, detail="The Bridge could not report to FeedX. Check the network and Keychain sign-in.")
            print("Bridge connection or printer error. Check FeedX history, printer and sign-in.", file=sys.stderr)
            backoff = min(60, backoff * 2)
        time.sleep(backoff)


def acknowledge_calibration(config, result, review):
    evidence = ROOT / "recovery-evidence"
    evidence.mkdir(mode=0o700, exist_ok=True)
    save(evidence / f"setup-{uuid.uuid4()}.json", dict(result, review=review,
         reviewed_at=datetime.now().astimezone().isoformat()))
    if config:
        config["calibrated_labels"] = result["quantity"] if review == "PASSED" else 0
        save(CONFIG, config)
    clear(CALIBRATION)


def main():
    parser = argparse.ArgumentParser(description="FeedX macOS Print Bridge (Staging)")
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("printers")
    sub.add_parser("bluetooth-probe")
    install = sub.add_parser("setup")
    target = install.add_mutually_exclusive_group(required=True)
    target.add_argument("--queue")
    target.add_argument("--bluetooth", "--serial", dest="bluetooth", action="store_true")
    install.add_argument("--gap", type=float, default=2)
    polarity = install.add_mutually_exclusive_group()
    polarity.add_argument("--invert", action="store_true")
    polarity.add_argument("--no-invert", dest="invert", action="store_false")
    install.set_defaults(invert=True)
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
        if args.action == "bluetooth-probe":
            build_bluetooth()
            bluetooth_probe((config or {}).get("bluetooth_address"))
            print("D520 Bluetooth Classic SPP responded with bitmap mode 4.")
        elif args.action == "setup":
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
            acknowledge_calibration(config, result, review)
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
