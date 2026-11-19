"""Native dialogs and launchd integration for the existing Staging bridge."""
import contextlib
import fcntl
import json
import math
import os
import plistlib
import ssl
import subprocess
import sys
import time
import urllib.request
import urllib.error
import uuid
from pathlib import Path

import certifi
import bridge

WEB = "https://fnb-system-staging.vercel.app"
PRINTERS = WEB + "/factory/settings/labels?section=printers"
SERVICE = "my.feedx.staging.print-bridge"
APP = "FeedX Print Bridge Staging"
PAUSE = bridge.ROOT / "setup.pause"


def script(source, *args):
    return subprocess.check_output(["/usr/bin/osascript", "-e", "use scripting additions\n" + source, "--", *args],
                                   stderr=subprocess.DEVNULL, text=True).removesuffix("\n")


def dialog(text, buttons=("OK",)):
    options = ", ".join(json.dumps(b) for b in buttons)
    return script('on run argv\nreturn button returned of (display dialog (item 1 of argv) '
                  f'with title "{APP}" buttons {{{options}}} default button 1)\nend run', text)


def field(text, default="", hidden=False):
    return script('on run argv\nreturn text returned of (display dialog (item 1 of argv) '
                  f'with title "{APP}" default answer (item 2 of argv)'
                  + (' with hidden answer' if hidden else '') + ')\nend run', text, default)


def choose(text, choices, default=""):
    result = script('on run argv\nset selected to choose from list (items 3 thru -1 of argv) '
                    f'with title "{APP}" with prompt (item 1 of argv) default items {{item 2 of argv}}\n'
                    'if selected is false then return ""\nreturn item 1 of selected\nend run',
                    text, default, *choices)
    if not result:
        raise KeyboardInterrupt
    return result


def public_key():
    with bridge.HTTP.open(WEB + "/api/factory-print-bridge-config", timeout=15) as response:
        return json.load(response)["publishableKey"]


def check_idle(config, session):
    if bridge.JOURNAL.exists():
        raise bridge.BridgeError("A print recovery is pending. Reconnect, then review the Job Order’s print history.")
    if bridge.rpc(config, session, "setup_queue", p_device=config["device"]):
        raise bridge.BridgeError("Review queued or uncertain Job Order prints before changing this printer or running a test.")


def authorize(config):
    config = dict(config or {})
    config.setdefault("device", str(uuid.uuid4()))
    config.setdefault("name", f"{bridge.socket.gethostname()[:85]} (macOS)")
    config["key"] = public_key()
    email = field("Sign in as the authorized FeedX Staging operator. Enter your email.").strip()
    password = field("Enter your FeedX Staging password.", hidden=True)
    session = bridge.auth(config, "password", email=email, password=password)
    config["owner"] = session["user"]
    return config, session


def configure(config, session):
    if bridge.CALIBRATION.exists():
        raise bridge.BridgeError("Review the previous calibration before changing printer or media.")
    if config.get("printer"):
        check_idle(config, session)
    queues = {p["Name"]: p for p in bridge.cups_printers()}
    selected = choose("Select an installed CUPS printer or a Bluetooth-paired D520.",
                      [*queues, bridge.BLUETOOTH], config.get("printer", ""))
    try:
        address = bridge.bluetooth_probe(config.get("bluetooth_address")) if selected == bridge.BLUETOOTH else None
    except (OSError, subprocess.SubprocessError):
        raise bridge.BridgeError("D520 unavailable. Check power and pairing, and close Labelife before retrying.") from None
    if selected in queues and queues[selected]["WorkOffline"]:
        raise bridge.BridgeError("The selected CUPS queue is offline or not accepting jobs.")
    width = float(field("Stock width in millimetres (20–120).", str(config.get("stock_width", 80))))
    height = float(field("Stock length in the feed direction (20–200 mm).", str(config.get("stock_height", 90))))
    if not all(map(math.isfinite, [width, height])) or not 20 <= width <= 120 or not 20 <= height <= 200:
        raise bridge.BridgeError("Enter a valid stock width and length in millimetres.")
    gap = 0 if not address else float(field("Enter the stock gap in millimetres (0–10).", str(config.get("gap", 2))))
    if not 0 <= gap <= 10:
        raise bridge.BridgeError("Enter a gap between 0 and 10 mm.")
    dialog("Load the label in portrait orientation. The D520 uses the calibrated feed direction. For CUPS, use portrait, actual size, and set the gap and stock in the printer driver.")
    settings = dict(printer=selected, bluetooth_address=address,
                    transport="tspl" if address else "spooler", gap=gap,
                    stock_width=width, stock_height=height, invert=config.get("invert", True))
    previous = dict(config, stock_width=config.get("stock_width", 80), stock_height=config.get("stock_height", 90))
    if any(previous.get(name) != value for name, value in settings.items()):
        config["calibrated_labels"] = 0
    config.update(settings, guided_setup=True, require_calibration=True)


def report_connection(config, session):
    printers = bridge.inventory(config)
    available = any(p["Name"] == config["printer"] and not p["WorkOffline"] for p in printers)
    status = "Offline" if not available else "Ready" if bridge.calibration_status(config) == "Passed" else "Error"
    bridge.device_status(config, session, printers, status)
    return available


def register(config, session):
    bridge.store_session(config, session)
    bridge.save(bridge.CONFIG, config)
    report_connection(config, session)


def calibrate(config, session):
    pending = bridge.load(bridge.CALIBRATION)
    if not pending:
        check_idle(config, session)
        copies = 3 if config["transport"] == "tspl" and config.get("calibrated_labels") == 1 else 1
        if dialog(f"Confirm the printer is idle with {config.get('stock_width', 80):g} × {config.get('stock_height', 90):g} mm stock. Send {copies} calibration label(s)?",
                  ("Cancel", "Send Test")) != "Send Test":
            return
        bridge.device_status(config, session, bridge.inventory(config), "Error")
        bridge.local_test(config, copies)
        pending = bridge.load(bridge.CALIBRATION)
    if pending:
        result = dialog(f"Inspect the printer and clear any held output. Did all {pending['quantity']} calibration label(s) print correctly, with the corner mark at the upper left and the complete frame visible?",
                        ("Review Later", "Inspected / Issue", "All Passed"))
        if result != "Review Later":
            bridge.acknowledge_calibration(config, pending, "PASSED" if result == "All Passed" else "INSPECTED")
    if bridge.calibration_status(config) == "Passed":
        dialog("Calibration passed. The bridge starts in the background and appears in FeedX → Label Management → Printers.")
        subprocess.run(["/usr/bin/open", PRINTERS], check=False)


def launch_agent():
    agent = Path.home() / "Library/LaunchAgents" / (SERVICE + ".plist")
    agent.parent.mkdir(parents=True, exist_ok=True)
    program = ([str(Path(sys.executable).with_name("feedx-worker")), "background"]
               if getattr(sys, "frozen", False) else [sys.executable, __file__, "background"])
    data = plistlib.dumps(dict(Label=SERVICE, ProgramArguments=program, RunAtLoad=True,
                               KeepAlive={"SuccessfulExit": False}, ThrottleInterval=10))
    if not agent.exists() or agent.read_bytes() != data:
        tmp = agent.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(agent)
    domain = f"gui/{os.getuid()}"
    for args in (["bootstrap", domain, str(agent)], ["kickstart", f"{domain}/{SERVICE}"]):
        subprocess.run(["/bin/launchctl", *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if subprocess.run(["/bin/launchctl", "print", f"{domain}/{SERVICE}"],
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        raise bridge.BridgeError("Background startup could not be registered. Open the installed app from Applications.")


@contextlib.contextmanager
def setup_lock():
    # Serialize dialogs and let a running worker finish its current journal operation.
    os.umask(0o077)
    bridge.ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = bridge.ROOT.lstat()
    if not bridge.stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
        raise bridge.BridgeError("Bridge data directory must be private and owned by this Mac user.")
    with (bridge.ROOT / "setup.lock").open("a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        PAUSE.touch()
        try:
            until = time.monotonic() + 90
            while True:
                worker = bridge.lock()
                try:
                    worker.__enter__()
                    break
                except bridge.BridgeError:
                    if time.monotonic() >= until:
                        raise
                    time.sleep(1)
            try:
                yield
            finally:
                worker.__exit__(None, None, None)
        finally:
            PAUSE.unlink(missing_ok=True)
            config = bridge.load(bridge.CONFIG)
            if config and all(config.get(key) for key in ("device", "owner", "key", "printer", "transport")):
                launch_agent()


def is_paused():
    if not PAUSE.exists():
        return False
    with (bridge.ROOT / "setup.lock").open("a") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        PAUSE.unlink(missing_ok=True)
    return False


def existing_session(config):
    try:
        session = bridge.read_session(config)
        if int(time.time()) >= session["expires_at"] - 120:
            session = bridge.auth(config, "refresh_token", refresh_token=session["refresh_token"])
            bridge.store_session(config, session)
        return session
    except urllib.error.HTTPError as error:
        if error.code in (400, 401):
            raise bridge.BridgeError("FeedX sign-in expired. Choose Reauthorize and sign in as the original bridge operator.") from None
        raise
    except subprocess.CalledProcessError:
        raise bridge.BridgeError("FeedX sign-in is unavailable in Keychain. Choose Reauthorize to restore it.") from None


def wait_for_connection(config):
    # The worker owns Keychain refresh, Bluetooth and print recovery. Setup only waits for its next report.
    started = time.time()
    deadline = time.monotonic() + 45
    if config["transport"] == "tspl":
        (bridge.ROOT / "connection-request").touch()
    launch_agent()
    while time.monotonic() < deadline:
        report = bridge.load(bridge.ROOT / "connection-status.json")
        if report and report["device"] == config["device"] and report["time"] >= started:
            if not report["reported"]:
                raise bridge.BridgeError(report["detail"])
            return report
        time.sleep(0.5)
    raise bridge.BridgeError("No fresh Bridge report arrived. Finish any active print, confirm the latest Bridge is installed, and try again.")


def main():
    if getattr(sys, "frozen", False):
        bridge.NATIVE = Path(sys.executable).parents[1] / "Resources/d520-rfcomm"
    bridge.HTTP = urllib.request.build_opener(bridge.NoRedirect(),
        urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=certifi.where())))
    if sys.argv[1:] == ["--self-test"]:
        assert bridge.NATIVE.is_file() and len(bridge.calibration(1)[0]) == 80 * 719
        return
    if sys.argv[1:] == ["background"]:
        if is_paused():
            return
        with bridge.lock():
            config = bridge.load(bridge.CONFIG)
            if config:
                bridge.run(dict(config, guided_worker=True), paused=is_paused)
        return
    config = bridge.load(bridge.CONFIG)
    actions = (("Reconnect", "Connection Check") if config else ()) + (
        "Connect / Configure", "Test / Review Calibration", "Reauthorize", "Open FeedX")
    action = choose("Manage this computer’s FeedX Staging printer.", actions)
    if action == "Open FeedX":
        subprocess.run(["/usr/bin/open", PRINTERS], check=False)
        return
    if action in ("Reconnect", "Connection Check") and config:
        report = wait_for_connection(config)
        dialog("Connection check passed and FeedX status was refreshed." if report["available"] else
               f"FeedX status was refreshed. {report['detail']}")
        return
    with setup_lock():
        config = bridge.load(bridge.CONFIG)
        if action == "Reauthorize":
            if not config:
                raise bridge.BridgeError("Run Connect / Configure first.")
            config, session = authorize(config)
            config["guided_setup"] = True
            register(config, session)
            dialog("Computer reauthorized. Its printer, device identity and recovery evidence were preserved.")
        elif action == "Connect / Configure":
            if config:
                session = existing_session(config)
            else:
                config, session = authorize(config)
            configure(config, session)
            register(config, session)
            dialog("Printer registered. Open Test / Review Calibration when you are ready to send a test.")
        elif not config:
            raise bridge.BridgeError("Run Connect / Configure first.")
        elif action == "Test / Review Calibration":
            calibrate(config, existing_session(config))



if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, subprocess.CalledProcessError):
        sys.exit(1)
    except Exception as error:
        if sys.argv[1:] in (["background"], ["--self-test"]):
            sys.exit(1)
        with contextlib.suppress(Exception):
            dialog(str(error) if isinstance(error, bridge.BridgeError) else
                   "Setup could not finish. Check the printer, network and FeedX sign-in. Open the setup app to retry.")
        sys.exit(1)
