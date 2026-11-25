"""Printer setup and launchd integration for the FeedX bridge."""
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
import browser_authorization

WEB = "https://fnb-system-staging.vercel.app"
PRINTERS = WEB + "/factory/settings/labels?section=printers"
SERVICE = "my.feedx.staging.print-bridge"
APP = "FeedX Print Bridge Staging"
ENVIRONMENT = "Staging"
VERSION = "1.3.0"
PAUSE = bridge.ROOT / "setup.pause"


def public_key():
    with bridge.HTTP.open(WEB + "/api/factory-print-bridge-config", timeout=15) as response:
        return json.load(response)["publishableKey"]


def check_idle(config, session):
    if bridge.JOURNAL.exists():
        raise bridge.BridgeError("A print recovery is pending. Reconnect, then review the Job Order’s print history.")
    if bridge.rpc(config, session, "setup_queue", p_device=config["device"]):
        raise bridge.BridgeError("Review queued or uncertain Job Order prints before changing this printer or running a test.")


def authorize(config):
    config = dict(config)
    pending = bridge.ROOT / "pending-device.json"
    saved = bridge.load(pending) or {}
    config.setdefault("device", saved.get("device") or str(uuid.uuid4()))
    config.setdefault("name", f"{bridge.socket.gethostname()[:85]} (macOS)")
    bridge.save(pending, {"device": config["device"]})
    config["key"] = public_key()
    session = browser_authorization.authorize(config["key"], bridge.ENDPOINT, ENVIRONMENT)
    if config.get("owner") and config["owner"] != session["user"]:
        raise bridge.BridgeError("Authorize with the original operator to preserve this device.")
    config["owner"] = session["user"]
    return config, session


def discover():
    printers = {p["Name"]: (p["Name"], None) for p in bridge.cups_printers()}
    try:
        addresses = bridge.native_command(["discover"]).decode().splitlines()
    except (OSError, subprocess.SubprocessError):
        addresses = []
    for address in addresses:
        if bridge.re.fullmatch(r"[0-9a-fA-F]{2}([-:][0-9a-fA-F]{2}){5}", address):
            printers[f"D520 Bluetooth · {address[-5:]}"] = (bridge.BLUETOOTH, address)
    return printers


def configure(config, session, selection, media):
    if bridge.CALIBRATION.exists():
        raise bridge.BridgeError("Review the previous calibration first.")
    if config.get("printer"):
        check_idle(config, session)
    if selection not in discover().values():
        raise bridge.BridgeError("Printer changed. Rescan and select it again.")
    try:
        width, height, gap = map(float, media)
    except (ValueError, TypeError):
        raise bridge.BridgeError("Enter valid stock dimensions and gap in millimetres.") from None
    if not 20 <= width <= 120 or not 20 <= height <= 200 or not 0 <= gap <= 10:
        raise bridge.BridgeError("Enter width 20–120, length 20–200 and gap 0–10 mm.")
    selected, address = selection
    settings = dict(printer=selected, bluetooth_address=address,
                    transport="tspl" if address else "spooler", gap=gap if address else 0,
                    stock_width=width, stock_height=height, invert=config.get("invert", True))
    previous = dict(config, stock_width=config.get("stock_width", 80), stock_height=config.get("stock_height", 90))
    if any(previous.get(name) != value for name, value in settings.items()):
        config["calibrated_labels"] = 0
    config.update(settings, guided_setup=True, require_calibration=True)


def register(config, session):
    bridge.device_status(config, session, bridge.inventory(config, probe_bluetooth=False), "Offline")
    bridge.store_session(config, session)
    bridge.save(bridge.CONFIG, config)
    (bridge.ROOT / "pending-device.json").unlink(missing_ok=True)


def configure_and_check(config, session, selection, media):
    config = dict(config)
    with setup_lock():
        session = session or existing_session(config)
        configure(config, session, selection, media)
        register(config, session)
    return config, connection_result(config)


def save_authorization(config, session):
    with setup_lock():
        register(config, session)
    return config, connection_result(config)


def calibrate(config, review=None):
    config = dict(config)
    with setup_lock():
        session = existing_session(config)
        pending = bridge.load(bridge.CALIBRATION)
        if review is not None:
            if not pending:
                raise bridge.BridgeError("No calibration is waiting for review.")
            bridge.acknowledge_calibration(config, pending, review)
        else:
            if pending:
                raise bridge.BridgeError("Review the pending test before sending another.")
            check_idle(config, session)
            if not bridge.claim_bluetooth(config, session):
                raise bridge.BridgeError("This D520 is active on another FeedX Bridge.")
            copies = 3 if config["transport"] == "tspl" and config.get("calibrated_labels") == 1 else 1
            bridge.local_test(config, copies)
    return config


def open_feedx():
    subprocess.run(["/usr/bin/open", PRINTERS], check=False)


def safe_issue(error):
    if isinstance(error, (bridge.BridgeError, browser_authorization.AuthorizationError)):
        return str(error)
    if isinstance(error, urllib.error.HTTPError) and error.code in (400, 401, 403):
        return "FeedX could not authorize this Bridge. Use Authorize again with the original operator."
    return "The Bridge could not finish this step. Check the network, printer and FeedX sign-in."


def store_setup_issue(operation, error):
    with contextlib.suppress(OSError):
        bridge.save(bridge.ROOT / "setup-diagnostics.json", {
            "time": int(time.time()), "version": VERSION, "operation": operation,
            "type": type(error).__name__, "httpStatus": error.code if isinstance(error, urllib.error.HTTPError) else None,
            "nativeCode": error.returncode if isinstance(error, subprocess.CalledProcessError) else None,
        })


def export_setup_issue(destination):
    value = bridge.load(bridge.ROOT / "setup-diagnostics.json") or {"version": VERSION, "status": "No setup failure recorded."}
    destination.write_text(json.dumps(value, indent=2))


def connection_result(config):
    try:
        return wait_for_connection(config)
    except bridge.BridgeError as error:
        return {"available": False, "reported": False, "detail": str(error)}


def resume(config):
    # Restart only an older worker. The setup lock waits for active submissions to finish.
    if (bridge.load(bridge.ROOT / "worker-version.json") or {}).get("version") != VERSION:
        with setup_lock():
            pass
    return wait_for_connection(config)


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
            raise bridge.BridgeError("FeedX sign-in expired. Choose Authorize again and sign in as the original bridge operator.") from None
        raise
    except subprocess.CalledProcessError:
        raise bridge.BridgeError("FeedX sign-in is unavailable in Keychain. Choose Authorize again to restore it.") from None


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
        import tkinter
        assert tkinter.TkVersion >= 8.6 and bridge.NATIVE.is_file() and len(bridge.calibration(1)[0]) == 80 * 719
        return
    if sys.argv[1:] == ["--window-self-test"]:
        from setup_window import SetupWindow
        SetupWindow(sys.modules[__name__], verify_only=True)
        return
    if sys.argv[1:] == ["background"]:
        if is_paused():
            return
        with bridge.lock():
            config = bridge.load(bridge.CONFIG)
            if config:
                bridge.save(bridge.ROOT / "worker-version.json", {"version": VERSION})
                bridge.run(dict(config, guided_worker=True, coordinate_bluetooth=True), paused=is_paused)
        return
    from setup_window import SetupWindow
    os.umask(0o077)
    bridge.ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = bridge.ROOT.lstat()
    if not bridge.stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
        raise bridge.BridgeError("Bridge data directory must be private and owned by this Mac user.")
    with (bridge.ROOT / "window.lock").open("a") as window:
        try:
            fcntl.flock(window, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        SetupWindow(sys.modules[__name__])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        if sys.argv[1:] not in (["background"], ["--self-test"], ["--window-self-test"]):
            store_setup_issue("startup", error)
        sys.exit(1)
