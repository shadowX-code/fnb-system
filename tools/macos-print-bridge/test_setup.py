"""Hardware-free regression checks for native setup and startup."""
import fcntl
import subprocess
import tempfile
import unittest
import urllib.error
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import Mock, patch

import bridge
import setup_app as setup


class SetupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = {
            "device": "existing-device", "key": "public-fixture", "owner": "original-operator", "name": "Fixture Mac",
            "printer": bridge.BLUETOOTH, "transport": "tspl", "gap": 2, "invert": True,
            "bluetooth_address": "fixture", "calibrated_labels": 3,
        }
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name, path in [
            ("ROOT", self.root), ("CONFIG", self.root / "config.json"),
            ("CALIBRATION", self.root / "calibration.json"), ("JOURNAL", self.root / "journal.json"),
        ]:
            self.stack.enter_context(patch.object(bridge, name, path))
        self.stack.enter_context(patch.object(setup, "PAUSE", self.root / "setup.pause"))

    def test_returning_configuration_preserves_identity_calibration_and_archived_evidence(self):
        evidence = self.root / "recovery-evidence"
        evidence.mkdir()
        (evidence / "original.json").write_bytes(b'{"detail":"missing ACK","review":"PASSED"}')
        with patch.object(setup, "choose", return_value=bridge.BLUETOOTH),              patch.object(setup, "field", side_effect=["80", "90", "2"]),              patch.object(setup, "dialog"), patch.object(bridge, "rpc", return_value=0),              patch.object(bridge, "bluetooth_probe", return_value="fixture"),              patch.object(bridge, "cups_printers", return_value=[]):
            setup.configure(self.config, {})
        self.assertEqual(self.config["calibrated_labels"], 3)
        self.assertEqual(self.config["device"], "existing-device")
        self.assertEqual((evidence / "original.json").read_bytes(), b'{"detail":"missing ACK","review":"PASSED"}')

    def test_printer_change_is_blocked_by_pending_recovery_without_clearing_it(self):
        bridge.JOURNAL.write_text('{"stage":"submitting"}')
        with patch.object(bridge, "rpc") as rpc, patch.object(bridge, "bluetooth_probe") as probe:
            with self.assertRaisesRegex(bridge.BridgeError, "recovery is pending"):
                setup.check_idle(self.config, {})
        self.assertTrue(bridge.JOURNAL.exists())
        rpc.assert_not_called()
        probe.assert_not_called()

    def test_reconnect_reuses_existing_device_and_reports_current_status(self):
        bridge.save(bridge.CONFIG, self.config)
        printers = [{"Name": bridge.BLUETOOTH, "WorkOffline": True}]
        with patch.object(setup.sys, "argv", ["setup"]), \
             patch.object(setup, "choose", return_value="Reconnect"), \
             patch.object(setup, "existing_session", return_value={"user": "original-operator"}), \
             patch.object(setup, "dialog"), patch.object(setup, "launch_agent") as launch, \
             patch.object(bridge, "store_session"), patch.object(bridge, "inventory", return_value=printers), \
             patch.object(bridge, "device_status") as status, patch.object(bridge, "prepare") as print_job:
            setup.main()
        config = bridge.load(bridge.CONFIG)
        self.assertEqual((config["device"], config["calibrated_labels"]), ("existing-device", 3))
        self.assertTrue(config["guided_setup"])
        self.assertEqual(status.call_args.args[3], "Offline")
        launch.assert_called_once()
        print_job.assert_not_called()

    def test_reauthorization_rejects_another_owner(self):
        response = {"access_token": "fixture", "refresh_token": "fixture",
                    "expires_in": 3600, "user": {"id": "different-operator"}}
        with patch.object(bridge, "post", return_value=response):
            with self.assertRaisesRegex(bridge.BridgeError, "original bridge operator"):
                bridge.auth(self.config, "password", email="fixture", password="fixture")

    def test_expired_sign_in_directs_operator_to_reauthorize(self):
        expired = {"expires_at": 0, "refresh_token": "fixture"}
        with patch.object(bridge, "read_session", return_value=expired),              patch.object(bridge, "auth", side_effect=urllib.error.HTTPError("fixture", 400, "", {}, None)):
            with self.assertRaisesRegex(bridge.BridgeError, "Choose Reauthorize"):
                setup.existing_session(self.config)

    def test_single_instance_lock_rejects_second_worker_and_releases_after_exit(self):
        with bridge.lock():
            with self.assertRaisesRegex(bridge.BridgeError, "already running"):
                with bridge.lock():
                    self.fail("Second bridge acquired the lock")
        with bridge.lock():
            pass

    def test_live_setup_pause_and_abandoned_pause_are_distinguished(self):
        with (self.root / "setup.lock").open("a") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            setup.PAUSE.touch()
            self.assertTrue(setup.is_paused())
            self.assertTrue(setup.PAUSE.exists())
        self.assertFalse(setup.is_paused())
        self.assertFalse(setup.PAUSE.exists())

    def test_setup_exit_clears_pause_and_restarts_one_worker(self):
        bridge.save(bridge.CONFIG, dict(self.config, key="fixture-key", owner="fixture-owner"))
        with patch.object(setup, "launch_agent") as launch:
            with self.assertRaisesRegex(ValueError, "cancelled"):
                with setup.setup_lock():
                    self.assertTrue(setup.PAUSE.exists())
                    raise ValueError("cancelled")
            launch.assert_called_once()
        self.assertFalse(setup.PAUSE.exists())

    def test_launchagent_has_stable_identity_and_does_not_kill_active_submission(self):
        home = self.root / "home"
        with patch.object(setup.Path, "home", return_value=home),              patch.object(setup.subprocess, "run", return_value=Mock(returncode=0)) as run:
            setup.launch_agent()
            setup.launch_agent()
        import plistlib
        state = plistlib.loads((home / "Library/LaunchAgents" / (setup.SERVICE + ".plist")).read_bytes())
        self.assertEqual(state["Label"], setup.SERVICE)
        self.assertEqual(state["KeepAlive"], {"SuccessfulExit": False})
        commands = [call.args[0] for call in run.call_args_list]
        self.assertFalse(any("-k" in command for command in commands))
        self.assertEqual(sum(command[1] == "kickstart" for command in commands), 2)

    def test_register_synchronizes_connected_offline_and_calibration_status(self):
        for online, calibrated, expected in [(True, 3, "Ready"), (False, 3, "Offline"), (True, 0, "Error")]:
            with self.subTest(expected=expected):
                config = dict(self.config, calibrated_labels=calibrated)
                printers = [{"Name": bridge.BLUETOOTH, "WorkOffline": not online}]
                with patch.object(bridge, "store_session"), patch.object(bridge, "inventory", return_value=printers),                      patch.object(bridge, "rpc") as rpc:
                    setup.register(config, {})
                self.assertEqual(rpc.call_args.kwargs["p_status"], expected)
                self.assertEqual(rpc.call_args.kwargs["p_device"], "existing-device")

    def test_connection_check_reports_without_preparing_a_job(self):
        with patch.object(bridge, "inventory", return_value=[{"Name": bridge.BLUETOOTH, "WorkOffline": True}]), \
             patch.object(bridge, "rpc") as rpc, patch.object(bridge, "prepare") as prepare:
            self.assertFalse(setup.report_connection(self.config, {}))
        self.assertEqual(rpc.call_args.args[2], "device")
        self.assertEqual(rpc.call_args.kwargs["p_status"], "Offline")
        prepare.assert_not_called()

    def test_cancelled_calibration_never_submits_or_creates_marker(self):
        with patch.object(bridge, "rpc", return_value=0),              patch.object(setup, "dialog", return_value="Cancel"),              patch.object(bridge, "local_test") as submit:
            setup.calibrate(self.config, {})
        submit.assert_not_called()
        self.assertFalse(bridge.CALIBRATION.exists())


class SessionRecoveryTest(unittest.TestCase):
    def test_keychain_unavailable_at_start_recovers_without_starting_another_worker(self):
        with patch.object(bridge, "read_session", side_effect=[
            subprocess.CalledProcessError(1, "Keychain"),
            {"expires_at": 999999999999},
        ]) as read, patch.object(bridge, "cycle") as cycle,              patch.object(bridge.time, "sleep"):
            bridge.run({}, paused=Mock(side_effect=[False, False, True]))
        self.assertEqual(read.call_count, 2)
        cycle.assert_called_once()

    def test_rotated_session_is_persisted_before_work_resumes_without_refresh_replay(self):
        previous = {"expires_at": 0, "refresh_token": "previous"}
        refreshed = {"expires_at": 999999999999, "refresh_token": "rotated"}
        events = []
        def store(config, session):
            events.append("persist")
            if len(events) == 1:
                raise OSError("temporary keychain error")
        def cycle(config, session):
            events.append("cycle")
        with patch.object(bridge, "read_session", return_value=previous),              patch.object(bridge, "auth", return_value=refreshed) as auth,              patch.object(bridge, "store_session", side_effect=store),              patch.object(bridge, "cycle", side_effect=cycle), patch.object(bridge.time, "sleep"):
            bridge.run({}, paused=Mock(side_effect=[False, False, True]))
        auth.assert_called_once()
        self.assertEqual(events, ["persist", "persist", "cycle"])

    def test_network_recovery_retries_report_only_with_original_claim(self):
        with tempfile.TemporaryDirectory() as work:
            journal = Path(work) / "journal.json"
            with patch.object(bridge, "JOURNAL", journal):
                bridge.save(journal, {"stage": "submitting", "job": "existing-job", "claim": "existing-claim"})
                reports = Mock(side_effect=[OSError("network down"), {}])
                with patch.object(bridge, "read_session", return_value={"expires_at": 999999999999}),                      patch.object(bridge, "rpc", reports), patch.object(bridge.time, "sleep"),                      patch.object(bridge, "prepare") as submit, patch.object(bridge, "inventory") as inventory:
                    bridge.run({"device": "existing-device"}, paused=Mock(side_effect=[False, False, True]))
                submit.assert_not_called()
                inventory.assert_not_called()
                self.assertFalse(journal.exists())
                self.assertEqual([c.args[2] for c in reports.call_args_list], ["report", "report"])
                self.assertTrue(all(c.kwargs["p_claim"] == "existing-claim" for c in reports.call_args_list))
